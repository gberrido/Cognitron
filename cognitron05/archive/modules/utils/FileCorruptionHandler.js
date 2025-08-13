#!/usr/bin/env node

/**
 * File Corruption Detection and Recovery System for Cognitron05
 * Provides comprehensive backup/restore mechanisms, data integrity validation,
 * and automatic recovery from file corruption
 */

import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { createSecureOpsForDirectory } from '../security/SecureFileOpsMigration.js';
import { SecureFileOps } from './SecureFileOps.js';
import { MEMORY_CONSTANTS, SECURITY_CONSTANTS } from '../config/SystemConstants.js';

/**
 * File corruption detection and recovery system
 */
export class FileCorruptionHandler {
  constructor(config = {}) {
    this.config = {
      dataDir: config.dataDir || path.join(process.cwd(), 'cognitron05-data'),
      backupDir: config.backupDir || path.join(process.cwd(), 'cognitron05-data', 'backups'),
      checksumDir: config.checksumDir || path.join(process.cwd(), 'cognitron05-data', 'checksums'),
      backupRetentionDays: config.backupRetentionDays || MEMORY_CONSTANTS.BACKUP_RETENTION_DAYS,
      maxBackupCount: config.maxBackupCount || 10,
      verificationLevel: config.verificationLevel || 'checksum', // 'basic', 'checksum', 'full'
      autoBackup: config.autoBackup !== false,
      autoRestore: config.autoRestore !== false,
      ...config
    };

    // Corruption statistics
    this.corruptionStats = {
      totalCorruptions: 0,
      corruptionsByType: new Map(),
      successfulRecoveries: 0,
      failedRecoveries: 0,
      lastCorruption: null,
      backupOperations: 0,
      restoreOperations: 0
    };

    // File integrity tracking
    this.integrityTracker = new Map(); // filePath -> { checksum, lastVerified, size }
    
    // Critical files that require special handling
    this.criticalFiles = new Set([
      'session-state.json',
      'working-context.json',
      'recall-storage.jsonl',
      'archival-storage.json'
    ]);
    
    // Initialize secure file operations for different directories
    this.dataOps = createSecureOpsForDirectory(this.config.dataDir, {
      maxFileSize: 100 * 1024 * 1024, // 100MB max for data files
      allowSymlinks: false,
      validateFileTypes: true,
      allowedMimeTypes: ['application/json', 'text/plain']
    });
    
    this.backupOps = createSecureOpsForDirectory(this.config.backupDir, {
      maxFileSize: 100 * 1024 * 1024, // 100MB max for backup files
      allowSymlinks: false,
      validateFileTypes: true,
      allowedMimeTypes: ['application/json', 'text/plain']
    });
    
    this.checksumOps = createSecureOpsForDirectory(this.config.checksumDir, {
      maxFileSize: 1024 * 1024, // 1MB max for checksum files
      allowSymlinks: false,
      validateFileTypes: true,
      allowedMimeTypes: ['text/plain']
    });
  }

  /**
   * Initialize the file corruption handling system
   */
  async initialize() {
    try {
      // Create required directories
      await SecureFileOps.ensureDirectoryExists(this.config.backupDir);
      await SecureFileOps.ensureDirectoryExists(this.config.checksumDir);
      
      // Load existing integrity data
      await this.loadIntegrityDatabase();
      
      // Perform initial integrity check
      await this.performIntegrityCheck();
      
      // Clean up old backups
      await this.cleanupOldBackups();
      
      console.log('File corruption handler initialized successfully');
      return true;
      
    } catch (error) {
      console.error('Failed to initialize file corruption handler:', error.message);
      throw error;
    }
  }

  /**
   * Create a backup of a file with integrity verification
   */
  async createBackup(filePath, options = {}) {
    try {
      const fileName = path.basename(filePath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `${fileName}.backup.${timestamp}`;
      const backupPath = path.join(this.config.backupDir, backupFileName);

      // Verify source file exists and is readable using secure operations
      try {
        await this.dataOps.access(fileName);
      } catch (error) {
        throw new Error(`Source file does not exist: ${filePath}`);
      }

      const sourceStats = await this.dataOps.stat(fileName);
      if (sourceStats.size === 0 && !options.allowEmpty) {
        throw new Error(`Source file is empty: ${filePath}`);
      }

      // Calculate source file checksum
      const sourceChecksum = await this.calculateFileChecksum(filePath);

      // Create backup with streaming for large files
      if (sourceStats.size > 1024 * 1024) { // 1MB threshold
        await this.createStreamingBackup(filePath, backupPath);
      } else {
        // Small file - direct copy using secure operations
        const data = await SecureFileOps.readFileSecure(this.config.dataDir, fileName);
        await this.backupOps.writeFile(backupFileName, data, 'utf8');
      }

      // Verify backup integrity
      const backupChecksum = await this.calculateFileChecksum(backupPath);
      if (sourceChecksum !== backupChecksum) {
        await this.backupOps.unlink(backupFileName); // Remove corrupted backup
        throw new Error(`Backup verification failed: checksum mismatch for ${fileName}`);
      }

      // Create backup metadata
      const metadata = {
        originalFile: filePath,
        backupFile: backupPath,
        timestamp: new Date().toISOString(),
        checksum: sourceChecksum,
        size: sourceStats.size,
        version: this.getFileVersion(filePath),
        critical: this.criticalFiles.has(fileName)
      };

      const metadataFileName = backupFileName + '.meta';
      await this.backupOps.writeFile(metadataFileName, JSON.stringify(metadata, null, 2), 'utf8');

      // Update statistics
      this.corruptionStats.backupOperations++;

      console.log(`Backup created: ${fileName} -> ${backupFileName}`);
      return {
        success: true,
        backupPath,
        metadata,
        checksum: sourceChecksum
      };

    } catch (error) {
      console.error(`Backup creation failed for ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Restore a file from its most recent valid backup
   */
  async restoreFromBackup(filePath, options = {}) {
    try {
      const fileName = path.basename(filePath);
      
      // Find available backups
      const availableBackups = await this.findAvailableBackups(fileName);
      if (availableBackups.length === 0) {
        throw new Error(`No backups found for ${fileName}`);
      }

      // Sort backups by timestamp (newest first)
      availableBackups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      let restorationError = null;
      
      // Try to restore from backups in order (newest first)
      for (const backup of availableBackups) {
        try {
          console.log(`Attempting restore from backup: ${backup.backupFile}`);
          
          // Verify backup integrity
          const backupIntegrity = await this.verifyBackupIntegrity(backup);
          if (!backupIntegrity.valid) {
            console.warn(`Backup integrity check failed: ${backupIntegrity.error}`);
            continue;
          }

          // Create restoration point (backup current file if it exists)
          if (existsSync(filePath) && !options.skipRestorationPoint) {
            try {
              const restorationPointPath = filePath + '.restoration-point.' + Date.now();
              await fs.copyFile(filePath, restorationPointPath);
              console.log(`Restoration point created: ${restorationPointPath}`);
            } catch (error) {
              console.warn(`Could not create restoration point: ${error.message}`);
            }
          }

          // Perform the restore
          await fs.copyFile(backup.backupFile, filePath);

          // Verify restored file integrity
          const restoredChecksum = await this.calculateFileChecksum(filePath);
          if (restoredChecksum !== backup.checksum) {
            throw new Error(`Restored file checksum mismatch`);
          }

          // Update integrity tracking
          await this.updateFileIntegrity(filePath, restoredChecksum);

          // Update statistics
          this.corruptionStats.restoreOperations++;
          this.corruptionStats.successfulRecoveries++;

          console.log(`File successfully restored: ${fileName} from ${backup.timestamp}`);
          return {
            success: true,
            restoredFrom: backup.backupFile,
            timestamp: backup.timestamp,
            checksum: restoredChecksum
          };

        } catch (error) {
          restorationError = error;
          console.warn(`Restore attempt failed for ${backup.backupFile}: ${error.message}`);
          continue;
        }
      }

      // All restoration attempts failed
      this.corruptionStats.failedRecoveries++;
      throw new Error(`All restoration attempts failed. Last error: ${restorationError?.message || 'Unknown error'}`);

    } catch (error) {
      console.error(`Restoration failed for ${filePath}:`, error.message);
      throw error;
    }
  }

  /**
   * Detect file corruption through various verification methods
   */
  async detectCorruption(filePath, options = {}) {
    try {
      const fileName = path.basename(filePath);
      const verificationLevel = options.verificationLevel || this.config.verificationLevel;

      if (!existsSync(filePath)) {
        return {
          corrupted: true,
          corruptionType: 'file_missing',
          error: 'File does not exist',
          severity: 'critical'
        };
      }

      const fileStats = await fs.stat(filePath);
      const corruption = {
        corrupted: false,
        corruptionType: null,
        error: null,
        severity: 'none',
        checks: {
          fileExists: true,
          fileSize: fileStats.size,
          fileEmpty: fileStats.size === 0
        }
      };

      // Basic checks
      if (fileStats.size === 0 && this.criticalFiles.has(fileName)) {
        corruption.corrupted = true;
        corruption.corruptionType = 'empty_file';
        corruption.error = 'Critical file is empty';
        corruption.severity = 'high';
      }

      // File format specific checks
      if (fileName.endsWith('.json') || fileName.endsWith('.jsonl')) {
        const jsonValidation = await this.validateJsonFile(filePath);
        corruption.checks.jsonValid = jsonValidation.valid;
        if (!jsonValidation.valid) {
          corruption.corrupted = true;
          corruption.corruptionType = 'invalid_json';
          corruption.error = jsonValidation.error;
          corruption.severity = 'high';
        }
      }

      // Checksum verification (if available)
      if (verificationLevel === 'checksum' || verificationLevel === 'full') {
        const checksumValidation = await this.validateFileChecksum(filePath);
        corruption.checks.checksumValid = checksumValidation.valid;
        if (!checksumValidation.valid && checksumValidation.hasStoredChecksum) {
          corruption.corrupted = true;
          corruption.corruptionType = 'checksum_mismatch';
          corruption.error = checksumValidation.error;
          corruption.severity = 'high';
        }
      }

      // Full content validation
      if (verificationLevel === 'full') {
        const contentValidation = await this.validateFileContent(filePath);
        corruption.checks.contentValid = contentValidation.valid;
        if (!contentValidation.valid) {
          corruption.corrupted = true;
          corruption.corruptionType = 'invalid_content';
          corruption.error = contentValidation.error;
          corruption.severity = 'medium';
        }
      }

      // Update corruption statistics
      if (corruption.corrupted) {
        this.updateCorruptionStats(corruption.corruptionType, filePath);
      }

      return corruption;

    } catch (error) {
      console.error(`Corruption detection failed for ${filePath}:`, error.message);
      return {
        corrupted: true,
        corruptionType: 'detection_error',
        error: error.message,
        severity: 'critical'
      };
    }
  }

  /**
   * Automatic recovery from file corruption
   */
  async recoverFromCorruption(filePath, corruptionInfo, options = {}) {
    try {
      const fileName = path.basename(filePath);
      console.log(`🔄 Starting corruption recovery for ${fileName}`);
      console.log(`Corruption type: ${corruptionInfo.corruptionType}`);
      console.log(`Severity: ${corruptionInfo.severity}`);

      const recoveryStrategy = this.determineRecoveryStrategy(corruptionInfo);
      console.log(`Recovery strategy: ${recoveryStrategy.action}`);

      let recoveryResult = null;

      switch (recoveryStrategy.action) {
        case 'restore_from_backup':
          recoveryResult = await this.restoreFromBackup(filePath, options);
          break;

        case 'recreate_empty':
          recoveryResult = await this.recreateEmptyFile(filePath, options);
          break;

        case 'truncate_to_valid':
          recoveryResult = await this.truncateToValidContent(filePath, options);
          break;

        case 'partial_recovery':
          recoveryResult = await this.attemptPartialRecovery(filePath, corruptionInfo, options);
          break;

        case 'manual_intervention':
          recoveryResult = {
            success: false,
            action: 'manual_intervention',
            message: 'Manual intervention required - corruption too severe for automatic recovery'
          };
          break;

        default:
          throw new Error(`Unknown recovery strategy: ${recoveryStrategy.action}`);
      }

      // Log recovery outcome
      console.log(`Recovery completed for ${fileName}:`, recoveryResult);

      return {
        success: recoveryResult.success,
        strategy: recoveryStrategy,
        result: recoveryResult,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`Corruption recovery failed for ${filePath}:`, error.message);
      this.corruptionStats.failedRecoveries++;
      throw error;
    }
  }

  /**
   * Perform comprehensive integrity check on all tracked files
   */
  async performIntegrityCheck(options = {}) {
    const results = {
      totalFiles: 0,
      corruptedFiles: 0,
      recoveredFiles: 0,
      failures: [],
      summary: {}
    };

    try {
      // Check all files in data directory
      const dataFiles = await this.getDataFiles();
      
      for (const filePath of dataFiles) {
        try {
          results.totalFiles++;
          const fileName = path.basename(filePath);

          // Detect corruption
          const corruption = await this.detectCorruption(filePath);
          
          if (corruption.corrupted) {
            results.corruptedFiles++;
            console.warn(`Corruption detected in ${fileName}: ${corruption.error}`);

            // Attempt automatic recovery if enabled
            if (this.config.autoRestore && corruption.severity !== 'none') {
              try {
                const recovery = await this.recoverFromCorruption(filePath, corruption);
                if (recovery.success) {
                  results.recoveredFiles++;
                  console.log(`✅ Successfully recovered ${fileName}`);
                } else {
                  results.failures.push({
                    file: fileName,
                    error: 'Automatic recovery failed',
                    corruption
                  });
                }
              } catch (recoveryError) {
                results.failures.push({
                  file: fileName,
                  error: recoveryError.message,
                  corruption
                });
              }
            }
          }

          // Update file integrity tracking
          if (!corruption.corrupted) {
            const checksum = await this.calculateFileChecksum(filePath);
            await this.updateFileIntegrity(filePath, checksum);
          }

        } catch (error) {
          results.failures.push({
            file: path.basename(filePath),
            error: error.message
          });
        }
      }

      results.summary = {
        healthyFiles: results.totalFiles - results.corruptedFiles,
        corruptionRate: results.totalFiles > 0 ? (results.corruptedFiles / results.totalFiles * 100).toFixed(2) + '%' : '0%',
        recoveryRate: results.corruptedFiles > 0 ? (results.recoveredFiles / results.corruptedFiles * 100).toFixed(2) + '%' : 'N/A'
      };

      console.log(`Integrity check completed: ${results.totalFiles} files, ${results.corruptedFiles} corrupted, ${results.recoveredFiles} recovered`);
      return results;

    } catch (error) {
      console.error('Integrity check failed:', error.message);
      throw error;
    }
  }

  /**
   * Create scheduled backups for critical files
   */
  async createScheduledBackups(options = {}) {
    const results = {
      totalBackups: 0,
      successfulBackups: 0,
      failures: []
    };

    try {
      const dataFiles = await this.getDataFiles();
      const criticalFilePaths = dataFiles.filter(filePath => 
        this.criticalFiles.has(path.basename(filePath))
      );

      for (const filePath of criticalFilePaths) {
        try {
          results.totalBackups++;
          
          // Skip if file doesn't exist or is too recent
          if (!existsSync(filePath)) {
            continue;
          }

          const shouldBackup = await this.shouldCreateBackup(filePath, options);
          if (!shouldBackup) {
            continue;
          }

          const backup = await this.createBackup(filePath, options);
          if (backup.success) {
            results.successfulBackups++;
            console.log(`✅ Scheduled backup created for ${path.basename(filePath)}`);
          }

        } catch (error) {
          results.failures.push({
            file: path.basename(filePath),
            error: error.message
          });
        }
      }

      console.log(`Scheduled backup completed: ${results.successfulBackups}/${results.totalBackups} successful`);
      return results;

    } catch (error) {
      console.error('Scheduled backup failed:', error.message);
      throw error;
    }
  }

  /**
   * Get comprehensive corruption and recovery statistics
   */
  getCorruptionStatistics() {
    return {
      ...this.corruptionStats,
      corruptionsByType: Object.fromEntries(this.corruptionStats.corruptionsByType),
      recoverySuccessRate: this.corruptionStats.totalCorruptions > 0 ? 
        (this.corruptionStats.successfulRecoveries / this.corruptionStats.totalCorruptions * 100).toFixed(2) + '%' : 'N/A',
      integrityTrackerSize: this.integrityTracker.size,
      criticalFilesCount: this.criticalFiles.size
    };
  }

  /**
   * Private method to calculate file checksum
   */
  async calculateFileChecksum(filePath) {
    try {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);
      
      for await (const chunk of stream) {
        hash.update(chunk);
      }
      
      return hash.digest('hex');
    } catch (error) {
      throw new Error(`Failed to calculate checksum for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Private method to validate JSON file format
   */
  async validateJsonFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      
      // Handle JSONL files
      if (filePath.endsWith('.jsonl')) {
        const lines = content.split('\n').filter(line => line.trim());
        for (const line of lines) {
          JSON.parse(line);
        }
      } else {
        JSON.parse(content);
      }
      
      return { valid: true };
    } catch (error) {
      return { 
        valid: false, 
        error: `Invalid JSON: ${error.message}` 
      };
    }
  }

  /**
   * Private method to validate file checksum
   */
  async validateFileChecksum(filePath) {
    try {
      const currentChecksum = await this.calculateFileChecksum(filePath);
      const storedIntegrity = this.integrityTracker.get(filePath);
      
      if (!storedIntegrity) {
        return { 
          valid: true, 
          hasStoredChecksum: false,
          message: 'No stored checksum for comparison' 
        };
      }
      
      const isValid = currentChecksum === storedIntegrity.checksum;
      return {
        valid: isValid,
        hasStoredChecksum: true,
        currentChecksum,
        storedChecksum: storedIntegrity.checksum,
        error: isValid ? null : 'File checksum does not match stored value'
      };
    } catch (error) {
      return { 
        valid: false, 
        hasStoredChecksum: false,
        error: error.message 
      };
    }
  }

  /**
   * Private method to validate file content structure
   */
  async validateFileContent(filePath) {
    try {
      const fileName = path.basename(filePath);
      
      // File-specific content validation
      if (fileName === 'session-state.json') {
        return await this.validateSessionStateContent(filePath);
      } else if (fileName === 'working-context.json') {
        return await this.validateWorkingContextContent(filePath);
      } else if (fileName === 'recall-storage.jsonl') {
        return await this.validateRecallStorageContent(filePath);
      }
      
      return { valid: true, message: 'No specific validation rules for this file type' };
    } catch (error) {
      return { 
        valid: false, 
        error: error.message 
      };
    }
  }

  /**
   * Private method to determine recovery strategy based on corruption type
   */
  determineRecoveryStrategy(corruptionInfo) {
    switch (corruptionInfo.corruptionType) {
      case 'file_missing':
        return {
          action: 'restore_from_backup',
          priority: 'high',
          description: 'Restore missing file from most recent backup'
        };
        
      case 'empty_file':
        return {
          action: 'restore_from_backup',
          priority: 'high',
          description: 'Restore empty file from backup or recreate with defaults'
        };
        
      case 'invalid_json':
        return {
          action: 'restore_from_backup',
          priority: 'high',
          description: 'Restore corrupted JSON file from backup'
        };
        
      case 'checksum_mismatch':
        return {
          action: 'restore_from_backup',
          priority: 'high',
          description: 'Restore file with checksum mismatch from backup'
        };
        
      case 'invalid_content':
        return {
          action: 'partial_recovery',
          priority: 'medium',
          description: 'Attempt to recover valid portions of content'
        };
        
      default:
        return {
          action: 'manual_intervention',
          priority: 'critical',
          description: 'Unknown corruption type requires manual intervention'
        };
    }
  }

  // Additional private methods would continue here...
  // (For brevity, I'm including key methods. The full implementation would have all helper methods)

  /**
   * Private method to update corruption statistics
   */
  updateCorruptionStats(corruptionType, filePath) {
    this.corruptionStats.totalCorruptions++;
    this.corruptionStats.corruptionsByType.set(
      corruptionType,
      (this.corruptionStats.corruptionsByType.get(corruptionType) || 0) + 1
    );
    this.corruptionStats.lastCorruption = {
      timestamp: new Date().toISOString(),
      type: corruptionType,
      file: path.basename(filePath)
    };
  }

  /**
   * Private method to get all data files for monitoring
   */
  async getDataFiles() {
    try {
      const files = await fs.readdir(this.config.dataDir);
      return files
        .filter(file => !file.startsWith('.') && (file.endsWith('.json') || file.endsWith('.jsonl')))
        .map(file => path.join(this.config.dataDir, file));
    } catch (error) {
      console.warn(`Could not read data directory: ${error.message}`);
      return [];
    }
  }

  /**
   * Private method to load integrity database
   */
  async loadIntegrityDatabase() {
    try {
      const integrityPath = path.join(this.config.checksumDir, 'integrity-database.json');
      if (existsSync(integrityPath)) {
        const data = await fs.readFile(integrityPath, 'utf8');
        const integrityData = JSON.parse(data);
        this.integrityTracker = new Map(Object.entries(integrityData));
        console.log(`Integrity database loaded: ${this.integrityTracker.size} files tracked`);
      }
    } catch (error) {
      console.warn('Could not load integrity database:', error.message);
    }
  }

  /**
   * Private method to update file integrity tracking
   */
  async updateFileIntegrity(filePath, checksum) {
    try {
      const stats = await fs.stat(filePath);
      this.integrityTracker.set(filePath, {
        checksum,
        lastVerified: new Date().toISOString(),
        size: stats.size
      });
      
      // Persist integrity database
      const integrityPath = path.join(this.config.checksumDir, 'integrity-database.json');
      const integrityData = Object.fromEntries(this.integrityTracker);
      await fs.writeFile(integrityPath, JSON.stringify(integrityData, null, 2), 'utf8');
    } catch (error) {
      console.warn('Could not update integrity database:', error.message);
    }
  }

  /**
   * Private method to clean up old backups
   */
  async cleanupOldBackups() {
    try {
      const backupFiles = await fs.readdir(this.config.backupDir);
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.backupRetentionDays);
      
      let cleanedCount = 0;
      for (const fileName of backupFiles) {
        if (!fileName.includes('.backup.')) continue;
        
        const filePath = path.join(this.config.backupDir, fileName);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffDate) {
          await fs.unlink(filePath);
          // Also remove metadata file if it exists
          const metadataPath = filePath + '.meta';
          if (existsSync(metadataPath)) {
            await fs.unlink(metadataPath);
          }
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.log(`Cleaned up ${cleanedCount} old backup files`);
      }
    } catch (error) {
      console.warn('Backup cleanup failed:', error.message);
    }
  }

  /**
   * Private method to create streaming backup for large files
   */
  async createStreamingBackup(sourcePath, backupPath) {
    const readStream = createReadStream(sourcePath);
    const writeStream = createWriteStream(backupPath);
    await pipeline(readStream, writeStream);
  }

  /**
   * Private method to get file version (simple timestamp-based)
   */
  getFileVersion(filePath) {
    return Date.now().toString();
  }

  /**
   * Private method to find available backups for a file
   */
  async findAvailableBackups(fileName) {
    try {
      const backupFiles = await fs.readdir(this.config.backupDir);
      const relevantBackups = [];
      
      for (const backupFile of backupFiles) {
        if (backupFile.startsWith(fileName + '.backup.')) {
          const metadataPath = path.join(this.config.backupDir, backupFile + '.meta');
          if (existsSync(metadataPath)) {
            const metadataContent = await fs.readFile(metadataPath, 'utf8');
            const metadata = JSON.parse(metadataContent);
            relevantBackups.push({
              ...metadata,
              backupFile: path.join(this.config.backupDir, backupFile)
            });
          }
        }
      }
      
      return relevantBackups;
    } catch (error) {
      console.warn('Could not find backups:', error.message);
      return [];
    }
  }

  /**
   * Private method to verify backup integrity
   */
  async verifyBackupIntegrity(backup) {
    try {
      if (!existsSync(backup.backupFile)) {
        return { valid: false, error: 'Backup file does not exist' };
      }
      
      const currentChecksum = await this.calculateFileChecksum(backup.backupFile);
      if (currentChecksum !== backup.checksum) {
        return { valid: false, error: 'Backup checksum mismatch' };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Private method to recreate empty file with defaults
   */
  async recreateEmptyFile(filePath, options = {}) {
    const fileName = path.basename(filePath);
    let defaultContent = '';
    
    // Provide sensible defaults based on file type
    if (fileName === 'session-state.json') {
      defaultContent = JSON.stringify({
        sessionId: 'recovered-' + Date.now(),
        timestamp: new Date().toISOString(),
        recovered: true
      }, null, 2);
    } else if (fileName === 'working-context.json') {
      defaultContent = JSON.stringify({
        facts: [],
        preferences: {},
        recovered: true
      }, null, 2);
    } else if (fileName.endsWith('.json')) {
      defaultContent = JSON.stringify({ recovered: true }, null, 2);
    } else if (fileName.endsWith('.jsonl')) {
      defaultContent = '';
    }
    
    await fs.writeFile(filePath, defaultContent, 'utf8');
    return {
      success: true,
      action: 'recreate_empty',
      message: `File recreated with default content`
    };
  }

  /**
   * Private method to truncate file to valid content
   */
  async truncateToValidContent(filePath, options = {}) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      
      if (filePath.endsWith('.jsonl')) {
        // For JSONL, keep only valid lines
        const lines = content.split('\n');
        const validLines = [];
        
        for (const line of lines) {
          if (line.trim()) {
            try {
              JSON.parse(line);
              validLines.push(line);
            } catch (error) {
              // Skip invalid lines
              break; // Stop at first invalid line to maintain chronological order
            }
          }
        }
        
        await fs.writeFile(filePath, validLines.join('\n'), 'utf8');
        return {
          success: true,
          action: 'truncate_to_valid',
          message: `File truncated to ${validLines.length} valid lines`
        };
      }
      
      return {
        success: false,
        action: 'truncate_failed',
        message: 'Truncation not supported for this file type'
      };
    } catch (error) {
      return {
        success: false,
        action: 'truncate_failed',
        message: error.message
      };
    }
  }

  /**
   * Private method to attempt partial recovery
   */
  async attemptPartialRecovery(filePath, corruptionInfo, options = {}) {
    try {
      // First try to restore from backup
      try {
        const backupRestore = await this.restoreFromBackup(filePath, options);
        return backupRestore;
      } catch (backupError) {
        console.warn('Backup restore failed, attempting partial recovery:', backupError.message);
      }
      
      // If no backup, try truncation
      const truncateResult = await this.truncateToValidContent(filePath, options);
      if (truncateResult.success) {
        return truncateResult;
      }
      
      // Last resort: recreate empty
      return await this.recreateEmptyFile(filePath, options);
    } catch (error) {
      return {
        success: false,
        action: 'partial_recovery_failed',
        message: error.message
      };
    }
  }

  /**
   * Private method to validate session state content
   */
  async validateSessionStateContent(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      
      // Check required fields
      if (!data.sessionId || typeof data.sessionId !== 'string') {
        return { valid: false, error: 'Missing or invalid sessionId' };
      }
      
      if (!data.timestamp || typeof data.timestamp !== 'string') {
        return { valid: false, error: 'Missing or invalid timestamp' };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Private method to validate working context content
   */
  async validateWorkingContextContent(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      
      // Check structure
      if (!data.facts || !Array.isArray(data.facts)) {
        return { valid: false, error: 'Missing or invalid facts array' };
      }
      
      if (!data.preferences || typeof data.preferences !== 'object') {
        return { valid: false, error: 'Missing or invalid preferences object' };
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Private method to validate recall storage content
   */
  async validateRecallStorageContent(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        const data = JSON.parse(line);
        
        // Check required fields for recall storage entries
        if (!data.role || !data.content || !data.timestamp) {
          return { valid: false, error: 'Invalid recall storage entry structure' };
        }
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * Private method to check if backup should be created
   */
  async shouldCreateBackup(filePath, options = {}) {
    try {
      const fileName = path.basename(filePath);
      
      // Always backup critical files if they've changed
      if (this.criticalFiles.has(fileName)) {
        const stats = await fs.stat(filePath);
        const lastBackup = await this.getLastBackupTime(fileName);
        
        // Create backup if file is newer than last backup
        return !lastBackup || stats.mtime > new Date(lastBackup);
      }
      
      return false;
    } catch (error) {
      console.warn('Could not determine backup necessity:', error.message);
      return false;
    }
  }

  /**
   * Private method to get last backup time for a file
   */
  async getLastBackupTime(fileName) {
    try {
      const backups = await this.findAvailableBackups(fileName);
      if (backups.length === 0) return null;
      
      // Sort by timestamp and return the most recent
      backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      return backups[0].timestamp;
    } catch (error) {
      return null;
    }
  }
}

export default FileCorruptionHandler;