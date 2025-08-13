#!/usr/bin/env node

/**
 * Encrypted Storage Adapter - Transparent encryption layer for all data storage
 * 
 * Features:
 * - Transparent encryption/decryption for existing storage systems
 * - Backward compatibility with unencrypted data
 * - Progressive encryption migration
 * - Performance-optimized with caching
 * - Secure key management integration
 * - Compliance-ready audit trails
 * - Cross-platform compatibility
 */

import { EncryptionManager } from './EncryptionManager.js';
import { createSecureOpsForDirectory } from '../security/SecureFileOpsMigration.js';
import { getLogger } from '../utils/StructuredLogger.js';
import path from 'path';

export class EncryptedStorageAdapter {
  constructor(config = {}) {
    this.config = {
      // Encryption settings
      enableEncryption: config.enableEncryption !== false,
      encryptionMode: config.encryptionMode || 'transparent', // 'transparent', 'explicit', 'mixed'
      
      // Storage paths
      dataDir: config.dataDir || './cognitron05-data',
      encryptedDir: config.encryptedDir || './cognitron05-data/encrypted',
      backupDir: config.backupDir || './cognitron05-data/backups',
      
      // Migration settings
      enableMigration: config.enableMigration !== false,
      migrationBatchSize: config.migrationBatchSize || 10,
      keepUnencryptedBackups: config.keepUnencryptedBackups !== false,
      
      // Performance settings
      enableCache: config.enableCache !== false,
      cacheSize: config.cacheSize || 100, // Number of cached items
      cacheTTL: config.cacheTTL || 5 * 60 * 1000, // 5 minutes
      
      // File patterns for encryption
      encryptedPatterns: config.encryptedPatterns || [
        '*.json',           // Configuration files
        '*.jsonl',          // Memory logs
        'users.json',       // User data
        'sessions.json',    // Session data
        '*-memory.json',    // Memory snapshots
        '*-context.json',   // Context data
        '*.log'             // Log files
      ],
      
      // File patterns to exclude from encryption
      excludePatterns: config.excludePatterns || [
        '*.tmp',
        '*.cache',
        '*.lock',
        'package*.json',
        'node_modules/**'
      ],
      
      // Data type configurations
      dataTypeConfigs: config.dataTypeConfigs || {
        'conversation-memory': {
          encrypt: true,
          compress: true,
          backup: true,
          retention: '1 year'
        },
        'user-data': {
          encrypt: true,
          compress: false,
          backup: true,
          retention: 'forever'
        },
        'session-data': {
          encrypt: true,
          compress: false,
          backup: false,
          retention: '30 days'
        },
        'configuration': {
          encrypt: true,
          compress: false,
          backup: true,
          retention: 'forever'
        },
        'logs': {
          encrypt: true,
          compress: true,
          backup: true,
          retention: '90 days'
        }
      },
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Initialize encryption manager
    this.encryptionManager = new EncryptionManager(config.encryption || {});
    
    // Initialize secure file operations
    this.dataOps = createSecureOpsForDirectory(this.config.dataDir, {
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      allowSymlinks: false,
      validateFileTypes: false
    });
    
    this.encryptedOps = createSecureOpsForDirectory(this.config.encryptedDir, {
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      allowSymlinks: false,
      validateFileTypes: false
    });
    
    this.backupOps = createSecureOpsForDirectory(this.config.backupDir, {
      maxFileSize: 1024 * 1024 * 1024, // 1GB
      allowSymlinks: false,
      validateFileTypes: false
    });
    
    // Storage cache
    this.cache = new Map(); // filePath -> { data, encrypted, timestamp, metadata }
    this.cacheStats = { hits: 0, misses: 0, evictions: 0 };
    
    // Migration tracking
    this.migrationStatus = {
      inProgress: false,
      totalFiles: 0,
      processedFiles: 0,
      errors: []
    };
    
    // Statistics
    this.stats = {
      readOperations: 0,
      writeOperations: 0,
      encryptedReads: 0,
      encryptedWrites: 0,
      unencryptedReads: 0,
      unencryptedWrites: 0,
      cacheHits: 0,
      cacheMisses: 0,
      migrationOperations: 0,
      errors: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Initialize encrypted storage adapter
   */
  async initialize() {
    try {
      this.logger.info('Initializing encrypted storage adapter', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        enableEncryption: this.config.enableEncryption,
        encryptionMode: this.config.encryptionMode
      });

      // Create directories
      await this.dataOps.mkdir('.', { recursive: true });
      await this.encryptedOps.mkdir('.', { recursive: true });
      await this.backupOps.mkdir('.', { recursive: true });
      
      // Initialize encryption manager if encryption is enabled
      if (this.config.enableEncryption) {
        await this.encryptionManager.initialize();
      }
      
      // Start cache cleanup
      this.startCacheCleanup();
      
      // Start migration if enabled
      if (this.config.enableMigration && this.config.enableEncryption) {
        await this.startMigration();
      }
      
      this.logger.info('Encrypted storage adapter initialized successfully', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        encryptionEnabled: this.config.enableEncryption
      });
      
      return true;
      
    } catch (error) {
      this.logger.error('Failed to initialize encrypted storage adapter', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter'
      }, error);
      
      throw error;
    }
  }

  /**
   * Read file with automatic decryption
   */
  async readFile(filePath, options = {}) {
    this.stats.readOperations++;
    
    try {
      const resolvedPath = this.resolvePath(filePath);
      const cacheKey = this.getCacheKey(resolvedPath, 'read');
      
      // Check cache first
      if (this.config.enableCache) {
        const cached = this.getFromCache(cacheKey);
        if (cached) {
          this.stats.cacheHits++;
          this.cacheStats.hits++;
          return cached.data;
        }
        this.stats.cacheMisses++;
        this.cacheStats.misses++;
      }
      
      let data;
      let metadata = null;
      let wasEncrypted = false;
      
      // Determine if file should be encrypted
      const shouldEncrypt = this.shouldEncryptFile(resolvedPath);
      
      if (this.config.enableEncryption && shouldEncrypt) {
        // Try to read encrypted version first
        try {
          const encryptedResult = await this.readEncryptedFile(resolvedPath, options);
          if (encryptedResult.success) {
            data = encryptedResult.data;
            metadata = encryptedResult.metadata;
            wasEncrypted = true;
            this.stats.encryptedReads++;
          } else {
            // Fall back to unencrypted version
            data = await this.readUnencryptedFile(resolvedPath, options);
            this.stats.unencryptedReads++;
          }
        } catch (error) {
          // Fall back to unencrypted version
          try {
            data = await this.readUnencryptedFile(resolvedPath, options);
            this.stats.unencryptedReads++;
          } catch (fallbackError) {
            throw error; // Throw original error
          }
        }
      } else {
        // Read unencrypted file
        data = await this.readUnencryptedFile(resolvedPath, options);
        this.stats.unencryptedReads++;
      }
      
      // Cache the result
      if (this.config.enableCache && data !== null) {
        this.addToCache(cacheKey, {
          data,
          encrypted: wasEncrypted,
          metadata,
          timestamp: Date.now()
        });
      }
      
      this.logger.debug('File read successfully', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        filePath: resolvedPath,
        encrypted: wasEncrypted,
        size: typeof data === 'string' ? data.length : data?.length || 0
      });
      
      return data;
      
    } catch (error) {
      this.stats.errors++;
      
      this.logger.error('File read failed', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        filePath,
        error: error.message
      }, error);
      
      throw error;
    }
  }

  /**
   * Write file with automatic encryption
   */
  async writeFile(filePath, data, options = {}) {
    this.stats.writeOperations++;
    
    try {
      const resolvedPath = this.resolvePath(filePath);
      const shouldEncrypt = this.shouldEncryptFile(resolvedPath);
      
      if (this.config.enableEncryption && shouldEncrypt) {
        // Create backup of existing file if requested
        if (this.config.keepUnencryptedBackups) {
          await this.createBackup(resolvedPath);
        }
        
        // Write encrypted version
        await this.writeEncryptedFile(resolvedPath, data, options);
        this.stats.encryptedWrites++;
      } else {
        // Write unencrypted file
        await this.writeUnencryptedFile(resolvedPath, data, options);
        this.stats.unencryptedWrites++;
      }
      
      // Invalidate cache
      if (this.config.enableCache) {
        const cacheKey = this.getCacheKey(resolvedPath, 'read');
        this.cache.delete(cacheKey);
      }
      
      this.logger.debug('File written successfully', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        filePath: resolvedPath,
        encrypted: shouldEncrypt && this.config.enableEncryption,
        size: typeof data === 'string' ? data.length : data?.length || 0
      });
      
      return true;
      
    } catch (error) {
      this.stats.errors++;
      
      this.logger.error('File write failed', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        filePath,
        error: error.message
      }, error);
      
      throw error;
    }
  }

  /**
   * Check if file exists (checks both encrypted and unencrypted versions)
   */
  async fileExists(filePath) {
    try {
      const resolvedPath = this.resolvePath(filePath);
      
      // Check encrypted version first if encryption is enabled
      if (this.config.enableEncryption && this.shouldEncryptFile(resolvedPath)) {
        try {
          const encryptedPath = this.getEncryptedPath(resolvedPath);
          await this.encryptedOps.access(path.basename(encryptedPath));
          return true;
        } catch (error) {
          // Fall through to check unencrypted version
        }
      }
      
      // Check unencrypted version
      try {
        await this.dataOps.access(path.basename(resolvedPath));
        return true;
      } catch (error) {
        return false;
      }
      
    } catch (error) {
      this.logger.error('File existence check failed', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        filePath
      }, error);
      
      return false;
    }
  }

  /**
   * Delete file (removes both encrypted and unencrypted versions)
   */
  async deleteFile(filePath) {
    try {
      const resolvedPath = this.resolvePath(filePath);
      let deleted = false;
      
      // Delete encrypted version if it exists
      if (this.config.enableEncryption) {
        try {
          const encryptedPath = this.getEncryptedPath(resolvedPath);
          const metadataPath = encryptedPath + '.meta';
          
          await this.encryptedOps.unlink(path.basename(encryptedPath));
          await this.encryptedOps.unlink(path.basename(metadataPath));
          deleted = true;
        } catch (error) {
          // File might not exist in encrypted form
        }
      }
      
      // Delete unencrypted version if it exists
      try {
        await this.dataOps.unlink(path.basename(resolvedPath));
        deleted = true;
      } catch (error) {
        // File might not exist in unencrypted form
      }
      
      // Clear from cache
      if (this.config.enableCache) {
        const cacheKey = this.getCacheKey(resolvedPath, 'read');
        this.cache.delete(cacheKey);
      }
      
      if (deleted) {
        this.logger.debug('File deleted successfully', {
          subsystem: 'encryption',
          component: 'encrypted-storage-adapter',
          filePath: resolvedPath
        });
      }
      
      return deleted;
      
    } catch (error) {
      this.stats.errors++;
      
      this.logger.error('File deletion failed', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        filePath
      }, error);
      
      throw error;
    }
  }

  /**
   * Migrate existing unencrypted files to encrypted storage
   */
  async startMigration() {
    if (this.migrationStatus.inProgress) {
      this.logger.warn('Migration already in progress', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter'
      });
      return;
    }
    
    try {
      this.migrationStatus.inProgress = true;
      this.migrationStatus.errors = [];
      
      this.logger.info('Starting encryption migration', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter'
      });
      
      // Find all files that should be encrypted
      const filesToMigrate = await this.findFilesToMigrate();
      this.migrationStatus.totalFiles = filesToMigrate.length;
      this.migrationStatus.processedFiles = 0;
      
      if (filesToMigrate.length === 0) {
        this.logger.info('No files need migration', {
          subsystem: 'encryption',
          component: 'encrypted-storage-adapter'
        });
        this.migrationStatus.inProgress = false;
        return;
      }
      
      // Process files in batches
      const batchSize = this.config.migrationBatchSize;
      for (let i = 0; i < filesToMigrate.length; i += batchSize) {
        const batch = filesToMigrate.slice(i, i + batchSize);
        
        await Promise.all(batch.map(async (filePath) => {
          try {
            await this.migrateFile(filePath);
            this.migrationStatus.processedFiles++;
            this.stats.migrationOperations++;
          } catch (error) {
            this.migrationStatus.errors.push({
              filePath,
              error: error.message
            });
            
            this.logger.error('File migration failed', {
              subsystem: 'encryption',
              component: 'encrypted-storage-adapter',
              filePath
            }, error);
          }
        }));
        
        // Log progress
        this.logger.info('Migration progress', {
          subsystem: 'encryption',
          component: 'encrypted-storage-adapter',
          processed: this.migrationStatus.processedFiles,
          total: this.migrationStatus.totalFiles,
          errors: this.migrationStatus.errors.length
        });
      }
      
      this.migrationStatus.inProgress = false;
      
      this.logger.info('Migration completed', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        totalFiles: this.migrationStatus.totalFiles,
        processedFiles: this.migrationStatus.processedFiles,
        errors: this.migrationStatus.errors.length
      });
      
    } catch (error) {
      this.migrationStatus.inProgress = false;
      
      this.logger.error('Migration failed', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter'
      }, error);
    }
  }

  /**
   * Read encrypted file
   */
  async readEncryptedFile(filePath, options = {}) {
    try {
      const encryptedPath = this.getEncryptedPath(filePath);
      const metadataPath = encryptedPath + '.meta';
      
      // Read encrypted data and metadata
      const encryptedData = await this.encryptedOps.readFile(path.basename(encryptedPath));
      const metadataJson = await this.encryptedOps.readFile(path.basename(metadataPath), 'utf8');
      const metadata = JSON.parse(metadataJson);
      
      // Decrypt data
      const decryptResult = await this.encryptionManager.decryptData(encryptedData, metadata, {
        returnString: options.encoding === 'utf8' || options.encoding === undefined,
        returnBuffer: options.encoding === null
      });
      
      if (!decryptResult.success) {
        throw new Error(decryptResult.error);
      }
      
      return {
        success: true,
        data: decryptResult.decryptedData,
        metadata: decryptResult.originalMetadata
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Write encrypted file
   */
  async writeEncryptedFile(filePath, data, options = {}) {
    const dataType = this.getDataType(filePath);
    const dataTypeConfig = this.config.dataTypeConfigs[dataType] || {};
    
    // Encrypt data
    const encryptResult = await this.encryptionManager.encryptData(data, {
      dataType,
      enableCompression: dataTypeConfig.compress !== false,
      ...options
    });
    
    if (!encryptResult.success) {
      throw new Error(encryptResult.error);
    }
    
    // Save encrypted data and metadata
    const encryptedPath = this.getEncryptedPath(filePath);
    const metadataPath = encryptedPath + '.meta';
    
    await this.encryptedOps.writeFile(path.basename(encryptedPath), encryptResult.encryptedData);
    await this.encryptedOps.writeFile(path.basename(metadataPath), JSON.stringify(encryptResult.metadata, null, 2));
    
    return true;
  }

  /**
   * Read unencrypted file
   */
  async readUnencryptedFile(filePath, options = {}) {
    const fileName = path.basename(filePath);
    const encoding = options.encoding !== null ? (options.encoding || 'utf8') : null;
    
    return await this.dataOps.readFile(fileName, encoding);
  }

  /**
   * Write unencrypted file
   */
  async writeUnencryptedFile(filePath, data, options = {}) {
    const fileName = path.basename(filePath);
    const encoding = options.encoding || 'utf8';
    
    return await this.dataOps.writeFile(fileName, data, encoding);
  }

  /**
   * Create backup of file before encryption
   */
  async createBackup(filePath) {
    try {
      if (!await this.fileExists(filePath)) {
        return;
      }
      
      const data = await this.readUnencryptedFile(filePath);
      const backupFileName = `${path.basename(filePath)}.backup.${Date.now()}`;
      
      await this.backupOps.writeFile(backupFileName, data);
      
      this.logger.debug('Backup created', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        originalFile: filePath,
        backupFile: backupFileName
      });
      
    } catch (error) {
      this.logger.warn('Backup creation failed', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        filePath
      }, error);
    }
  }

  /**
   * Migrate single file from unencrypted to encrypted
   */
  async migrateFile(filePath) {
    try {
      // Read unencrypted file
      const data = await this.readUnencryptedFile(filePath);
      
      // Write encrypted version
      await this.writeEncryptedFile(filePath, data);
      
      // Create backup if configured
      if (this.config.keepUnencryptedBackups) {
        await this.createBackup(filePath);
      }
      
      // Optionally remove unencrypted version after successful encryption
      // await this.dataOps.unlink(path.basename(filePath));
      
      this.logger.debug('File migrated to encrypted storage', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        filePath
      });
      
    } catch (error) {
      throw new Error(`Migration failed for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Find files that need to be migrated to encrypted storage
   */
  async findFilesToMigrate() {
    const filesToMigrate = [];
    
    try {
      // This is a placeholder implementation
      // In production, you would scan the data directory for files matching encryption patterns
      const commonFiles = [
        'working-context.json',
        'recall-storage.jsonl',
        'archival-storage.json',
        'session-state.json',
        'users.json',
        'sessions.json'
      ];
      
      for (const fileName of commonFiles) {
        const filePath = path.join(this.config.dataDir, fileName);
        
        if (await this.fileExists(fileName) && this.shouldEncryptFile(filePath)) {
          // Check if encrypted version already exists
          const encryptedPath = this.getEncryptedPath(filePath);
          const encryptedExists = await this.fileExists(encryptedPath);
          
          if (!encryptedExists) {
            filesToMigrate.push(filePath);
          }
        }
      }
      
    } catch (error) {
      this.logger.error('Failed to find files for migration', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter'
      }, error);
    }
    
    return filesToMigrate;
  }

  /**
   * Determine if file should be encrypted based on patterns
   */
  shouldEncryptFile(filePath) {
    if (!this.config.enableEncryption) {
      return false;
    }
    
    const fileName = path.basename(filePath);
    const relativeDir = path.relative(this.config.dataDir, path.dirname(filePath));
    const relativePath = path.join(relativeDir, fileName);
    
    // Check exclude patterns first
    for (const pattern of this.config.excludePatterns) {
      if (this.matchesPattern(relativePath, pattern)) {
        return false;
      }
    }
    
    // Check include patterns
    for (const pattern of this.config.encryptedPatterns) {
      if (this.matchesPattern(relativePath, pattern)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Simple pattern matching (supports * wildcards)
   */
  matchesPattern(filePath, pattern) {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`, 'i');
    return regex.test(filePath);
  }

  /**
   * Get data type from file path
   */
  getDataType(filePath) {
    const fileName = path.basename(filePath).toLowerCase();
    
    if (fileName.includes('user')) return 'user-data';
    if (fileName.includes('session')) return 'session-data';
    if (fileName.includes('memory') || fileName.includes('context') || fileName.includes('recall') || fileName.includes('archival')) return 'conversation-memory';
    if (fileName.includes('config')) return 'configuration';
    if (fileName.includes('log')) return 'logs';
    
    return 'generic';
  }

  /**
   * Get encrypted file path
   */
  getEncryptedPath(originalPath) {
    const fileName = path.basename(originalPath);
    const encryptedFileName = fileName + '.enc';
    return path.join(this.config.encryptedDir, encryptedFileName);
  }

  /**
   * Resolve file path relative to data directory
   */
  resolvePath(filePath) {
    if (path.isAbsolute(filePath)) {
      return filePath;
    }
    return path.join(this.config.dataDir, filePath);
  }

  /**
   * Get cache key for file operation
   */
  getCacheKey(filePath, operation) {
    return `${operation}:${filePath}`;
  }

  /**
   * Get data from cache
   */
  getFromCache(cacheKey) {
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    
    // Check if cache entry is still valid
    if (Date.now() - cached.timestamp > this.config.cacheTTL) {
      this.cache.delete(cacheKey);
      this.cacheStats.evictions++;
      return null;
    }
    
    return cached;
  }

  /**
   * Add data to cache
   */
  addToCache(cacheKey, data) {
    if (this.cache.size >= this.config.cacheSize) {
      // Remove oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.cacheStats.evictions++;
    }
    
    this.cache.set(cacheKey, data);
  }

  /**
   * Start cache cleanup process
   */
  startCacheCleanup() {
    setInterval(() => {
      this.cleanupCache();
    }, this.config.cacheTTL); // Clean up expired entries
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    let expired = 0;
    
    for (const [key, cached] of this.cache) {
      if (now - cached.timestamp > this.config.cacheTTL) {
        this.cache.delete(key);
        expired++;
      }
    }
    
    this.cacheStats.evictions += expired;
    
    if (expired > 0) {
      this.logger.debug('Cleaned up expired cache entries', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter',
        expired
      });
    }
  }

  /**
   * Get storage statistics
   */
  getStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    
    return {
      uptime,
      enableEncryption: this.config.enableEncryption,
      encryptionMode: this.config.encryptionMode,
      
      // Operations
      readOperations: this.stats.readOperations,
      writeOperations: this.stats.writeOperations,
      encryptedReads: this.stats.encryptedReads,
      encryptedWrites: this.stats.encryptedWrites,
      unencryptedReads: this.stats.unencryptedReads,
      unencryptedWrites: this.stats.unencryptedWrites,
      
      // Cache
      cacheSize: this.cache.size,
      cacheHits: this.cacheStats.hits,
      cacheMisses: this.cacheStats.misses,
      cacheEvictions: this.cacheStats.evictions,
      cacheHitRate: (this.cacheStats.hits + this.cacheStats.misses) > 0 ?
        (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100 : 0,
      
      // Migration
      migrationInProgress: this.migrationStatus.inProgress,
      migrationProgress: this.migrationStatus.totalFiles > 0 ?
        (this.migrationStatus.processedFiles / this.migrationStatus.totalFiles) * 100 : 0,
      migrationErrors: this.migrationStatus.errors.length,
      
      // Encryption stats
      encryptionStats: this.config.enableEncryption ? this.encryptionManager.getStats() : null,
      
      // Error rate
      errors: this.stats.errors,
      errorRate: (this.stats.readOperations + this.stats.writeOperations) > 0 ?
        (this.stats.errors / (this.stats.readOperations + this.stats.writeOperations)) * 100 : 0
    };
  }

  /**
   * Health check for encrypted storage
   */
  async healthCheck() {
    try {
      const stats = this.getStats();
      let encryptionHealth = { healthy: true };
      
      if (this.config.enableEncryption) {
        encryptionHealth = await this.encryptionManager.healthCheck();
      }
      
      const isHealthy = encryptionHealth.healthy && 
                       stats.errorRate < 5 && 
                       (!stats.migrationInProgress || stats.migrationErrors < 10);
      
      return {
        healthy: isHealthy,
        reason: isHealthy ? 'Encrypted storage healthy' : 'Encrypted storage issues detected',
        details: {
          enableEncryption: this.config.enableEncryption,
          encryptionHealthy: encryptionHealth.healthy,
          errorRate: Math.round(stats.errorRate * 100) / 100,
          migrationInProgress: stats.migrationInProgress,
          migrationErrors: stats.migrationErrors,
          cacheHitRate: Math.round(stats.cacheHitRate * 100) / 100
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  /**
   * Shutdown encrypted storage adapter
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down encrypted storage adapter', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter'
      });
      
      // Wait for any ongoing migration to complete
      if (this.migrationStatus.inProgress) {
        this.logger.info('Waiting for migration to complete before shutdown');
        // In production, implement proper migration cancellation
      }
      
      // Shutdown encryption manager
      if (this.config.enableEncryption) {
        await this.encryptionManager.shutdown();
      }
      
      // Clear caches
      this.cache.clear();
      
    } catch (error) {
      this.logger.error('Encrypted storage adapter shutdown failed', {
        subsystem: 'encryption',
        component: 'encrypted-storage-adapter'
      }, error);
    }
  }
}

export default EncryptedStorageAdapter;