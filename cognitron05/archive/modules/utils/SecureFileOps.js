#!/usr/bin/env node

/**
 * Secure File Operations for Cognitron05
 * Provides path traversal protection and secure file handling
 */

import fs from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import path from 'path';
import { InputValidator } from './InputValidator.js';

export class SecureFileOps {
  /**
   * Validate and resolve a secure file path
   * @param {string} baseDir - Base directory to restrict access to
   * @param {string} fileName - File name or relative path
   * @returns {Object} Validation result with safe path or error
   */
  static validateSecurePath(baseDir, fileName) {
    // Validate base directory
    if (!baseDir || typeof baseDir !== 'string') {
      return {
        valid: false,
        error: 'Base directory is required',
        code: 'MISSING_BASE_DIR'
      };
    }

    // Validate file name
    if (!fileName || typeof fileName !== 'string') {
      return {
        valid: false,
        error: 'File name is required',
        code: 'MISSING_FILE_NAME'
      };
    }

    const trimmedFileName = fileName.trim();
    
    // Check for empty file name
    if (trimmedFileName === '') {
      return {
        valid: false,
        error: 'File name cannot be empty',
        code: 'EMPTY_FILE_NAME'
      };
    }

    try {
      // First check for obvious traversal patterns
      if (trimmedFileName.includes('..')) {
        return {
          valid: false,
          error: 'Path traversal sequences (..) are not allowed',
          code: 'PATH_TRAVERSAL_DETECTED'
        };
      }

      // Check for null bytes and other dangerous characters before path validation
      // Enhanced detection for various null byte encodings and control characters
      if (trimmedFileName.includes('\x00') || 
          trimmedFileName.includes('\\x00') ||
          trimmedFileName.includes('%00') ||
          /[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmedFileName)) {
        return {
          valid: false,
          error: 'File name contains unsafe characters',
          code: 'UNSAFE_CHARACTERS'
        };
      }

      // Use InputValidator for additional path validation
      const pathValidation = InputValidator.validateFilePath(trimmedFileName);
      if (!pathValidation.valid) {
        return pathValidation;
      }

      // Resolve absolute paths
      const resolvedBaseDir = path.resolve(baseDir);
      const targetPath = path.resolve(resolvedBaseDir, trimmedFileName);
      
      // Check if target path is within base directory boundaries
      // Both paths must be canonical and the target must start with base + separator
      const normalizedTarget = path.normalize(targetPath);
      const normalizedBase = path.normalize(resolvedBaseDir);
      
      if (!normalizedTarget.startsWith(normalizedBase + path.sep) && normalizedTarget !== normalizedBase) {
        return {
          valid: false,
          error: `Path traversal detected. File must be within: ${resolvedBaseDir}`,
          code: 'PATH_TRAVERSAL_DETECTED'
        };
      }

      return {
        valid: true,
        safePath: targetPath,
        baseDir: resolvedBaseDir,
        fileName: trimmedFileName,
        normalized: path.relative(resolvedBaseDir, targetPath)
      };

    } catch (error) {
      return {
        valid: false,
        error: `Path resolution error: ${error.message}`,
        code: 'PATH_RESOLUTION_ERROR'
      };
    }
  }

  /**
   * Securely read a file with path validation
   * @param {string} baseDir - Base directory
   * @param {string} fileName - File name
   * @param {Object} options - Read options
   * @returns {Promise} File contents or error
   */
  static async readFileSecure(baseDir, fileName, options = {}) {
    const pathValidation = this.validateSecurePath(baseDir, fileName);
    
    if (!pathValidation.valid) {
      const error = new Error(pathValidation.error);
      error.code = pathValidation.code;
      throw error;
    }

    try {
      const { encoding = 'utf-8' } = options;
      const data = await fs.readFile(pathValidation.safePath, encoding);
      
      // Log successful read for security monitoring
      if (process.env.DEBUG) {
        console.log(`[SECURITY] Secure file read: ${pathValidation.normalized}`);
      }
      
      return data;
    } catch (error) {
      // Re-throw with additional context
      const secureError = new Error(`Secure file read failed: ${error.message}`);
      secureError.code = error.code || 'FILE_READ_ERROR';
      secureError.originalError = error;
      throw secureError;
    }
  }

  /**
   * Securely write a file with path validation
   * @param {string} baseDir - Base directory  
   * @param {string} fileName - File name
   * @param {string} data - Data to write
   * @param {Object} options - Write options
   * @returns {Promise} Success or error
   */
  static async writeFileSecure(baseDir, fileName, data, options = {}) {
    const pathValidation = this.validateSecurePath(baseDir, fileName);
    
    if (!pathValidation.valid) {
      const error = new Error(pathValidation.error);
      error.code = pathValidation.code;
      throw error;
    }

    try {
      // Ensure base directory exists
      await this.ensureDirectoryExists(pathValidation.baseDir);
      
      const { encoding = 'utf-8', mode = 0o644 } = options;
      await fs.writeFile(pathValidation.safePath, data, { encoding, mode });
      
      // Log successful write for security monitoring
      if (process.env.DEBUG) {
        console.log(`[SECURITY] Secure file write: ${pathValidation.normalized} (${data.length} bytes)`);
      }
      
      return {
        success: true,
        path: pathValidation.safePath,
        size: data.length
      };
    } catch (error) {
      const secureError = new Error(`Secure file write failed: ${error.message}`);
      secureError.code = error.code || 'FILE_WRITE_ERROR';
      secureError.originalError = error;
      throw secureError;
    }
  }

  /**
   * Securely create a write stream with path validation
   * @param {string} baseDir - Base directory
   * @param {string} fileName - File name
   * @param {Object} options - Stream options
   * @returns {Promise<Object>} Secure write stream wrapper
   */
  static async createWriteStreamSecure(baseDir, fileName, options = {}) {
    const pathValidation = this.validateSecurePath(baseDir, fileName);
    
    if (!pathValidation.valid) {
      const error = new Error(pathValidation.error);
      error.code = pathValidation.code;
      throw error;
    }

    try {
      // Ensure base directory exists
      await this.ensureDirectoryExists(pathValidation.baseDir);
      
      const { mode = 0o644, flags = 'w' } = options;
      const writeStream = createWriteStream(pathValidation.safePath, { 
        mode, 
        flags,
        ...options 
      });

      // Log stream creation for security monitoring
      if (process.env.DEBUG) {
        console.log(`[SECURITY] Secure write stream created: ${pathValidation.normalized}`);
      }

      // Return wrapped stream with additional security context
      return {
        stream: writeStream,
        safePath: pathValidation.safePath,
        baseDir: pathValidation.baseDir,
        fileName: pathValidation.fileName,
        normalized: pathValidation.normalized,
        
        // Enhanced error handling
        onError: (callback) => {
          writeStream.on('error', (error) => {
            console.error(`[SECURITY] Write stream error for ${pathValidation.normalized}:`, error.message);
            callback(error);
          });
        },
        
        // Enhanced completion handling
        onFinish: (callback) => {
          writeStream.on('finish', () => {
            if (process.env.DEBUG) {
              console.log(`[SECURITY] Write stream completed: ${pathValidation.normalized}`);
            }
            callback();
          });
        }
      };
    } catch (error) {
      const secureError = new Error(`Secure write stream creation failed: ${error.message}`);
      secureError.code = error.code || 'STREAM_CREATE_ERROR';
      secureError.originalError = error;
      throw secureError;
    }
  }

  /**
   * Check if a file exists securely
   * @param {string} baseDir - Base directory
   * @param {string} fileName - File name
   * @returns {Promise<boolean>} True if file exists
   */
  static async existsSecure(baseDir, fileName) {
    const pathValidation = this.validateSecurePath(baseDir, fileName);
    
    if (!pathValidation.valid) {
      return false; // Don't reveal path validation errors for existence checks
    }

    try {
      return existsSync(pathValidation.safePath);
    } catch (error) {
      // Don't reveal file system errors for existence checks
      return false;
    }
  }

  /**
   * Ensure directory exists with secure path validation
   * @param {string} dirPath - Directory path to create
   * @returns {Promise} Success or error
   */
  static async ensureDirectoryExists(dirPath) {
    if (!dirPath || typeof dirPath !== 'string') {
      throw new Error('Directory path is required');
    }

    try {
      const resolvedPath = path.resolve(dirPath);
      
      // Enhanced safety check - don't create directories outside allowed areas
      const cwd = process.cwd();
      const normalizedResolved = path.normalize(resolvedPath);
      const normalizedCwd = path.normalize(cwd);
      
      if (!normalizedResolved.startsWith(normalizedCwd + path.sep) && normalizedResolved !== normalizedCwd) {
        throw new Error(`Directory creation outside working directory not allowed: ${resolvedPath}`);
      }

      await fs.mkdir(resolvedPath, { recursive: true, mode: 0o755 });
      
      if (process.env.DEBUG) {
        console.log(`[SECURITY] Directory ensured: ${resolvedPath}`);
      }
      
      return resolvedPath;
    } catch (error) {
      const secureError = new Error(`Directory creation failed: ${error.message}`);
      secureError.code = error.code || 'DIRECTORY_CREATE_ERROR';
      secureError.originalError = error;
      throw secureError;
    }
  }

  /**
   * Get secure file stats
   * @param {string} baseDir - Base directory
   * @param {string} fileName - File name
   * @returns {Promise<Object>} File stats or error
   */
  static async getFileStatsSecure(baseDir, fileName) {
    const pathValidation = this.validateSecurePath(baseDir, fileName);
    
    if (!pathValidation.valid) {
      const error = new Error(pathValidation.error);
      error.code = pathValidation.code;
      throw error;
    }

    try {
      const stats = await fs.stat(pathValidation.safePath);
      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        accessed: stats.atime,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        safePath: pathValidation.safePath,
        normalized: pathValidation.normalized
      };
    } catch (error) {
      const secureError = new Error(`File stats failed: ${error.message}`);
      secureError.code = error.code || 'FILE_STATS_ERROR';
      secureError.originalError = error;
      throw secureError;
    }
  }

  /**
   * Create a validation error with consistent format
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {Object} details - Additional error details
   * @returns {Error} Formatted validation error
   */
  static createSecurityError(message, code = 'SECURITY_ERROR', details = {}) {
    const error = new Error(message);
    error.name = 'SecurityError';
    error.code = code;
    error.details = details;
    error.timestamp = new Date().toISOString();
    return error;
  }
}

export default SecureFileOps;