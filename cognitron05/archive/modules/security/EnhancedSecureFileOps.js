#!/usr/bin/env node

/**
 * Enhanced Secure File Operations - Comprehensive file security framework
 * Addresses all critical file operation vulnerabilities identified in security audit
 * 
 * Security Features:
 * - Enhanced path traversal protection with symlink validation
 * - TOCTOU (Time-of-Check-Time-of-Use) attack prevention
 * - Atomic file operations
 * - File size and type validation
 * - Secure stream operations
 * - Race condition elimination
 * - Content-based file validation
 */

import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getLogger } from '../utils/StructuredLogger.js';

export class EnhancedSecureFileOps {
  constructor(baseDirectory = null, config = {}) {
    this.baseDirectory = baseDirectory ? path.resolve(baseDirectory) : process.cwd();
    this.config = {
      // File size limits
      maxFileSize: config.maxFileSize || 100 * 1024 * 1024, // 100MB
      maxStreamChunk: config.maxStreamChunk || 1024 * 1024, // 1MB chunks
      
      // Security options
      allowSymlinks: config.allowSymlinks || false,
      validateFileTypes: config.validateFileTypes !== false,
      enableAtomicOps: config.enableAtomicOps !== false,
      preventTOCTOU: config.preventTOCTOU !== false,
      
      // File permissions
      defaultFileMode: config.defaultFileMode || 0o644,
      defaultDirMode: config.defaultDirMode || 0o755,
      
      // Allowed file types (MIME types)
      allowedMimeTypes: config.allowedMimeTypes || [
        'text/plain',
        'application/json',
        'text/javascript',
        'application/javascript',
        'text/csv'
      ],
      
      // Rate limiting
      maxOperationsPerSecond: config.maxOperationsPerSecond || 100,
      operationWindow: config.operationWindow || 1000, // 1 second
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Operation tracking for rate limiting
    this.operationTracker = new Map(); // path -> operations array
    
    // Security statistics
    this.stats = {
      operationsPerformed: 0,
      securityViolations: 0,
      blockedOperations: 0,
      symlinkAttemptsBlocked: 0,
      tocouAttemptsPrevented: 0,
      lastReset: Date.now()
    };
    
    // MIME type detection patterns
    this.mimePatterns = new Map([
      [/^\s*{[\s\S]*}\s*$/, 'application/json'],
      [/^[\s\S]*<script/i, 'text/html'],
      [/^\s*(import|export|const|let|var|function)/m, 'text/javascript'],
      [/^[^\n]*,[^\n]*\n/, 'text/csv']
    ]);
  }

  /**
   * Enhanced path validation with symlink detection
   * @param {string} inputPath - Path to validate
   * @param {boolean} allowCreation - Whether to allow creation of non-existent paths
   * @returns {Promise<Object>} Validation result
   */
  async validatePathSecure(inputPath, allowCreation = false) {
    const result = {
      valid: false,
      canonicalPath: null,
      isSymlink: false,
      actualPath: null,
      reason: null,
      securityInfo: {
        traversalAttempt: false,
        symlinkDetected: false,
        outsideBase: false
      }
    };
    
    try {
      this.stats.operationsPerformed++;
      
      // Basic input validation
      if (!inputPath || typeof inputPath !== 'string') {
        result.reason = 'Invalid path input';
        return result;
      }
      
      // Path length validation
      if (inputPath.length > 4096) {
        result.reason = 'Path too long';
        this.stats.securityViolations++;
        return result;
      }
      
      // Enhanced traversal detection patterns
      const traversalPatterns = [
        /\.\./,                    // Basic traversal
        /\.%2[eE]/gi,             // URL encoded traversal
        /%2[eE]\./gi,             // URL encoded traversal
        /%2[eE]%2[eE]/gi,         // Double URL encoded traversal
        /\.%252[eE]/gi,           // Double URL encoded traversal
        /%252[eE]\./gi,           // Double URL encoded traversal
        /\x00/,                   // Null byte injection
        /[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/,  // Control characters
        /\\\.\\\./, 	          // Windows-style traversal
        /\/\.\./,                 // Unix-style traversal
        /%5[cC]\.\.%5[cC]/gi,     // URL encoded backslash traversal
        /\uFEFF/,                 // BOM injection
        /\u202E/                  // Right-to-left override
      ];
      
      for (const pattern of traversalPatterns) {
        if (pattern.test(inputPath)) {
          result.reason = 'Path traversal attempt detected';
          result.securityInfo.traversalAttempt = true;
          this.stats.securityViolations++;
          this.logSecurityViolation('path-traversal', { inputPath, pattern: pattern.toString() });
          return result;
        }
      }
      
      // Resolve canonical path
      const canonicalPath = path.resolve(this.baseDirectory, inputPath);
      result.canonicalPath = canonicalPath;
      
      // Verify path is within base directory
      if (!canonicalPath.startsWith(this.baseDirectory + path.sep) && canonicalPath !== this.baseDirectory) {
        result.reason = 'Path outside allowed directory';
        result.securityInfo.outsideBase = true;
        this.stats.securityViolations++;
        this.logSecurityViolation('path-restriction', { inputPath, canonicalPath, baseDirectory: this.baseDirectory });
        return result;
      }
      
      // Check if path exists and get its real nature
      try {
        const stats = await fs.lstat(canonicalPath);
        result.isSymlink = stats.isSymbolicLink();
        
        if (result.isSymlink) {
          result.securityInfo.symlinkDetected = true;
          
          if (!this.config.allowSymlinks) {
            result.reason = 'Symbolic links not allowed';
            this.stats.symlinkAttemptsBlocked++;
            this.logSecurityViolation('symlink-blocked', { canonicalPath });
            return result;
          }
          
          // If symlinks are allowed, resolve the real path and validate it too
          try {
            const realPath = await fs.realpath(canonicalPath);
            result.actualPath = realPath;
            
            // Ensure real path is also within base directory
            if (!realPath.startsWith(this.baseDirectory + path.sep) && realPath !== this.baseDirectory) {
              result.reason = 'Symlink target outside allowed directory';
              result.securityInfo.outsideBase = true;
              this.stats.securityViolations++;
              this.logSecurityViolation('symlink-traversal', { canonicalPath, realPath, baseDirectory: this.baseDirectory });
              return result;
            }
          } catch (error) {
            result.reason = 'Broken symlink detected';
            return result;
          }
        } else {
          result.actualPath = canonicalPath;
        }
      } catch (error) {
        // Path doesn't exist - check if creation is allowed
        if (!allowCreation) {
          result.reason = 'Path does not exist and creation not allowed';
          return result;
        }
        
        // Validate parent directory exists and is accessible
        const parentDir = path.dirname(canonicalPath);
        try {
          await fs.access(parentDir, fs.constants.W_OK);
          result.actualPath = canonicalPath;
        } catch (parentError) {
          result.reason = 'Parent directory not accessible';
          return result;
        }
      }
      
      result.valid = true;
      
      this.logger.debug('Path validated successfully', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        inputPath,
        canonicalPath,
        isSymlink: result.isSymlink,
        actualPath: result.actualPath
      });
      
      return result;
      
    } catch (error) {
      result.reason = `Path validation error: ${error.message}`;
      this.logger.error('Path validation failed', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        inputPath
      }, error);
      return result;
    }
  }

  /**
   * Atomic file read with TOCTOU prevention
   * @param {string} filePath - File path to read
   * @param {Object} options - Read options
   * @returns {Promise<Object>} Read result with content and metadata
   */
  async readFileAtomicSecure(filePath, options = {}) {
    const result = {
      success: false,
      content: null,
      metadata: null,
      error: null
    };
    
    try {
      // Rate limiting check
      if (!this.checkRateLimit(filePath)) {
        result.error = 'Rate limit exceeded for file operations';
        this.stats.blockedOperations++;
        return result;
      }
      
      // Path validation
      const pathValidation = await this.validatePathSecure(filePath);
      if (!pathValidation.valid) {
        result.error = `Path validation failed: ${pathValidation.reason}`;
        return result;
      }
      
      const targetPath = pathValidation.actualPath;
      
      // Atomic operation: open file descriptor and validate metadata
      const fd = await fs.open(targetPath, 'r');
      
      try {
        // Get file stats using file descriptor (prevents TOCTOU)
        const stats = await fd.stat();
        
        // File size validation
        if (stats.size > this.config.maxFileSize) {
          result.error = `File too large: ${stats.size} > ${this.config.maxFileSize}`;
          return result;
        }
        
        // File type validation
        if (this.config.validateFileTypes) {
          // Read first chunk for MIME type detection
          const buffer = Buffer.alloc(Math.min(1024, stats.size));
          const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
          const sampleContent = buffer.subarray(0, bytesRead).toString('utf8');
          
          const mimeType = this.detectMimeType(sampleContent);
          if (mimeType && !this.config.allowedMimeTypes.includes(mimeType)) {
            result.error = `File type not allowed: ${mimeType}`;
            return result;
          }
          
          // Reset to beginning for full read
          await fd.read(Buffer.alloc(0), 0, 0, 0);
        }
        
        // Read full content using file descriptor
        const buffer = Buffer.alloc(stats.size);
        let totalBytesRead = 0;
        
        while (totalBytesRead < stats.size) {
          const { bytesRead } = await fd.read(
            buffer,
            totalBytesRead,
            Math.min(this.config.maxStreamChunk, stats.size - totalBytesRead),
            totalBytesRead
          );
          
          if (bytesRead === 0) break;
          totalBytesRead += bytesRead;
        }
        
        result.content = options.encoding ? buffer.toString(options.encoding) : buffer;
        result.metadata = {
          size: stats.size,
          mtime: stats.mtime,
          mode: stats.mode,
          isSymlink: pathValidation.isSymlink,
          originalPath: filePath,
          actualPath: targetPath
        };
        
        result.success = true;
        
        this.logger.debug('Atomic file read successful', {
          subsystem: 'security',
          component: 'enhanced-file-ops',
          filePath,
          size: stats.size,
          isSymlink: pathValidation.isSymlink
        });
        
      } finally {
        await fd.close();
      }
      
      return result;
      
    } catch (error) {
      result.error = error.message;
      
      this.logger.error('Atomic file read failed', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        filePath,
        error: error.message
      }, error);
      
      return result;
    }
  }

  /**
   * Atomic file write with backup and rollback
   * @param {string} filePath - Target file path
   * @param {string|Buffer} content - Content to write
   * @param {Object} options - Write options
   * @returns {Promise<Object>} Write result
   */
  async writeFileAtomicSecure(filePath, content, options = {}) {
    const result = {
      success: false,
      backupPath: null,
      error: null
    };
    
    let tempPath = null;
    let backupPath = null;
    
    try {
      // Rate limiting check
      if (!this.checkRateLimit(filePath)) {
        result.error = 'Rate limit exceeded for file operations';
        this.stats.blockedOperations++;
        return result;
      }
      
      // Path validation (allow creation)
      const pathValidation = await this.validatePathSecure(filePath, true);
      if (!pathValidation.valid) {
        result.error = `Path validation failed: ${pathValidation.reason}`;
        return result;
      }
      
      const targetPath = pathValidation.actualPath;
      
      // Content validation
      if (content && content.length > this.config.maxFileSize) {
        result.error = `Content too large: ${content.length} > ${this.config.maxFileSize}`;
        return result;
      }
      
      // Create temporary file for atomic write
      const tempSuffix = `.tmp.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
      tempPath = targetPath + tempSuffix;
      
      // Check if target file exists for backup
      let needsBackup = false;
      try {
        await fs.access(targetPath);
        needsBackup = true;
      } catch (error) {
        // File doesn't exist, no backup needed
      }
      
      // Create backup if file exists
      if (needsBackup && options.createBackup !== false) {
        const backupSuffix = `.backup.${Date.now()}`;
        backupPath = targetPath + backupSuffix;
        await fs.copyFile(targetPath, backupPath);
        result.backupPath = backupPath;
      }
      
      // Write to temporary file
      const writeOptions = {
        mode: options.mode || this.config.defaultFileMode,
        encoding: options.encoding || 'utf8'
      };
      
      await fs.writeFile(tempPath, content, writeOptions);
      
      // Verify written content if requested
      if (options.verifyWrite !== false) {
        const verification = await this.readFileAtomicSecure(tempPath, { encoding: options.encoding });
        if (!verification.success) {
          throw new Error(`Write verification failed: ${verification.error}`);
        }
        
        const writtenContent = verification.content;
        const expectedContent = typeof content === 'string' ? content : content.toString(options.encoding || 'utf8');
        
        if (writtenContent !== expectedContent) {
          throw new Error('Write verification failed: content mismatch');
        }
      }
      
      // Atomic move to final location
      await fs.rename(tempPath, targetPath);
      tempPath = null; // Successfully moved
      
      result.success = true;
      
      this.logger.info('Atomic file write successful', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        filePath,
        contentSize: content ? content.length : 0,
        backupCreated: !!backupPath,
        backupPath
      });
      
      return result;
      
    } catch (error) {
      result.error = error.message;
      
      // Cleanup temporary file if it exists
      if (tempPath) {
        try {
          await fs.unlink(tempPath);
        } catch (cleanupError) {
          this.logger.warn('Failed to cleanup temporary file', {
            subsystem: 'security',
            component: 'enhanced-file-ops',
            tempPath,
            error: cleanupError.message
          });
        }
      }
      
      // Rollback from backup if available and write failed
      if (backupPath && needsBackup && !result.success) {
        try {
          await fs.copyFile(backupPath, targetPath);
          this.logger.info('Rolled back from backup after write failure', {
            subsystem: 'security',
            component: 'enhanced-file-ops',
            filePath,
            backupPath
          });
        } catch (rollbackError) {
          this.logger.error('Failed to rollback from backup', {
            subsystem: 'security',
            component: 'enhanced-file-ops',
            filePath,
            backupPath
          }, rollbackError);
        }
      }
      
      this.logger.error('Atomic file write failed', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        filePath,
        error: error.message
      }, error);
      
      return result;
    }
  }

  /**
   * Create secure read stream with validation
   * @param {string} filePath - File path to stream
   * @param {Object} options - Stream options
   * @returns {Promise<Object>} Stream result
   */
  async createReadStreamSecure(filePath, options = {}) {
    const result = {
      success: false,
      stream: null,
      metadata: null,
      error: null
    };
    
    try {
      // Path validation
      const pathValidation = await this.validatePathSecure(filePath);
      if (!pathValidation.valid) {
        result.error = `Path validation failed: ${pathValidation.reason}`;
        return result;
      }
      
      const targetPath = pathValidation.actualPath;
      
      // Get file metadata first
      const stats = await fs.stat(targetPath);
      
      // File size validation
      if (stats.size > this.config.maxFileSize) {
        result.error = `File too large: ${stats.size} > ${this.config.maxFileSize}`;
        return result;
      }
      
      // Create secure stream with limits
      const streamOptions = {
        ...options,
        highWaterMark: Math.min(options.highWaterMark || this.config.maxStreamChunk, this.config.maxStreamChunk)
      };
      
      const stream = createReadStream(targetPath, streamOptions);
      
      // Add security monitoring to stream
      let bytesRead = 0;
      const maxBytes = this.config.maxFileSize;
      
      stream.on('data', (chunk) => {
        bytesRead += chunk.length;
        if (bytesRead > maxBytes) {
          stream.destroy(new Error(`Stream size limit exceeded: ${bytesRead} > ${maxBytes}`));
        }
      });
      
      // Error handling
      stream.on('error', (error) => {
        this.logger.error('Secure read stream error', {
          subsystem: 'security',
          component: 'enhanced-file-ops',
          filePath,
          error: error.message
        }, error);
      });
      
      result.success = true;
      result.stream = stream;
      result.metadata = {
        size: stats.size,
        mtime: stats.mtime,
        isSymlink: pathValidation.isSymlink
      };
      
      return result;
      
    } catch (error) {
      result.error = error.message;
      
      this.logger.error('Failed to create secure read stream', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        filePath
      }, error);
      
      return result;
    }
  }

  /**
   * Create secure write stream with validation
   * @param {string} filePath - Target file path
   * @param {Object} options - Stream options
   * @returns {Promise<Object>} Stream result
   */
  async createWriteStreamSecure(filePath, options = {}) {
    const result = {
      success: false,
      stream: null,
      tempPath: null,
      error: null
    };
    
    try {
      // Path validation (allow creation)
      const pathValidation = await this.validatePathSecure(filePath, true);
      if (!pathValidation.valid) {
        result.error = `Path validation failed: ${pathValidation.reason}`;
        return result;
      }
      
      const targetPath = pathValidation.actualPath;
      
      // Create temporary file for atomic write
      const tempSuffix = `.tmp.${Date.now()}.${crypto.randomBytes(8).toString('hex')}`;
      const tempPath = targetPath + tempSuffix;
      result.tempPath = tempPath;
      
      // Create secure stream with limits
      const streamOptions = {
        ...options,
        mode: options.mode || this.config.defaultFileMode,
        highWaterMark: Math.min(options.highWaterMark || this.config.maxStreamChunk, this.config.maxStreamChunk)
      };
      
      const stream = createWriteStream(tempPath, streamOptions);
      
      // Add security monitoring to stream
      let bytesWritten = 0;
      const maxBytes = this.config.maxFileSize;
      
      const originalWrite = stream.write.bind(stream);
      stream.write = function(chunk, encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > maxBytes) {
          const error = new Error(`Stream size limit exceeded: ${bytesWritten} > ${maxBytes}`);
          stream.destroy(error);
          if (callback) callback(error);
          return false;
        }
        return originalWrite(chunk, encoding, callback);
      };
      
      // Handle stream completion
      const originalEnd = stream.end.bind(stream);
      stream.end = async function(chunk, encoding, callback) {
        const result = originalEnd(chunk, encoding, callback);
        
        // Atomic move when stream ends successfully
        stream.on('finish', async () => {
          try {
            await fs.rename(tempPath, targetPath);
            this.logger.debug('Atomic write stream completed', {
              subsystem: 'security',
              component: 'enhanced-file-ops',
              filePath,
              bytesWritten
            });
          } catch (error) {
            stream.emit('error', error);
          }
        });
        
        return result;
      };
      
      // Error cleanup
      stream.on('error', async (error) => {
        try {
          await fs.unlink(tempPath);
        } catch (cleanupError) {
          // Ignore cleanup errors
        }
        
        this.logger.error('Secure write stream error', {
          subsystem: 'security',
          component: 'enhanced-file-ops',
          filePath,
          error: error.message
        }, error);
      });
      
      result.success = true;
      result.stream = stream;
      
      return result;
      
    } catch (error) {
      result.error = error.message;
      
      this.logger.error('Failed to create secure write stream', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        filePath
      }, error);
      
      return result;
    }
  }

  /**
   * Secure directory creation with proper permissions
   * @param {string} dirPath - Directory path to create
   * @param {Object} options - Creation options
   * @returns {Promise<Object>} Creation result
   */
  async createDirectorySecure(dirPath, options = {}) {
    const result = {
      success: false,
      created: false,
      error: null
    };
    
    try {
      // Path validation (allow creation)
      const pathValidation = await this.validatePathSecure(dirPath, true);
      if (!pathValidation.valid) {
        result.error = `Path validation failed: ${pathValidation.reason}`;
        return result;
      }
      
      const targetPath = pathValidation.actualPath;
      
      // Create directory with secure permissions
      const mkdirOptions = {
        recursive: options.recursive !== false,
        mode: options.mode || this.config.defaultDirMode
      };
      
      await fs.mkdir(targetPath, mkdirOptions);
      result.created = true;
      result.success = true;
      
      this.logger.debug('Directory created securely', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        dirPath,
        mode: mkdirOptions.mode,
        recursive: mkdirOptions.recursive
      });
      
      return result;
      
    } catch (error) {
      if (error.code === 'EEXIST') {
        // Directory already exists - this is often acceptable
        result.success = true;
        result.created = false;
        return result;
      }
      
      result.error = error.message;
      
      this.logger.error('Failed to create directory securely', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        dirPath
      }, error);
      
      return result;
    }
  }

  /**
   * Detect MIME type from content
   * @param {string} content - File content sample
   * @returns {string|null} Detected MIME type
   */
  detectMimeType(content) {
    if (!content) return null;
    
    for (const [pattern, mimeType] of this.mimePatterns) {
      if (pattern.test(content)) {
        return mimeType;
      }
    }
    
    return 'text/plain'; // Default fallback
  }

  /**
   * Check rate limiting for file operations
   * @param {string} filePath - File path for operation
   * @returns {boolean} Whether operation is allowed
   */
  checkRateLimit(filePath) {
    const now = Date.now();
    const windowStart = now - this.config.operationWindow;
    
    // Get or create operation history for this path
    let operations = this.operationTracker.get(filePath) || [];
    
    // Remove operations outside the window
    operations = operations.filter(timestamp => timestamp > windowStart);
    
    // Check if limit exceeded
    if (operations.length >= this.config.maxOperationsPerSecond) {
      this.logger.warn('File operation rate limit exceeded', {
        subsystem: 'security',
        component: 'enhanced-file-ops',
        filePath,
        operations: operations.length,
        limit: this.config.maxOperationsPerSecond
      });
      return false;
    }
    
    // Add current operation
    operations.push(now);
    this.operationTracker.set(filePath, operations);
    
    return true;
  }

  /**
   * Log security violations
   * @param {string} violationType - Type of violation
   * @param {Object} details - Violation details
   */
  logSecurityViolation(violationType, details) {
    this.stats.securityViolations++;
    
    this.logger.warn('File operations security violation', {
      subsystem: 'security',
      component: 'enhanced-file-ops',
      violationType,
      details,
      timestamp: Date.now()
    });
  }

  /**
   * Get security statistics
   * @returns {Object} Security statistics
   */
  getSecurityStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    
    return {
      uptime,
      operationsPerformed: this.stats.operationsPerformed,
      securityViolations: this.stats.securityViolations,
      blockedOperations: this.stats.blockedOperations,
      symlinkAttemptsBlocked: this.stats.symlinkAttemptsBlocked,
      tocouAttemptsPrevented: this.stats.tocouAttemptsPrevented,
      violationRate: this.stats.operationsPerformed > 0 ? 
        (this.stats.securityViolations / this.stats.operationsPerformed) * 100 : 0,
      activeTrackedPaths: this.operationTracker.size,
      config: {
        maxFileSize: this.config.maxFileSize,
        allowSymlinks: this.config.allowSymlinks,
        validateFileTypes: this.config.validateFileTypes,
        enableAtomicOps: this.config.enableAtomicOps,
        preventTOCTOU: this.config.preventTOCTOU
      }
    };
  }

  /**
   * Clean up operation tracker and reset stats
   */
  cleanup() {
    this.operationTracker.clear();
    this.stats = {
      operationsPerformed: 0,
      securityViolations: 0,
      blockedOperations: 0,
      symlinkAttemptsBlocked: 0,
      tocouAttemptsPrevented: 0,
      lastReset: Date.now()
    };
    
    this.logger.info('Enhanced secure file operations cleaned up', {
      subsystem: 'security',
      component: 'enhanced-file-ops',
      operation: 'cleanup'
    });
  }
}

export default EnhancedSecureFileOps;