#!/usr/bin/env node

/**
 * Secure File Operations Migration Utility
 * Provides drop-in replacements for insecure filesystem operations
 * 
 * Usage: Import this instead of direct 'fs' operations
 * Benefits: Automatic security, TOCTOU prevention, atomic operations
 */

import { EnhancedSecureFileOps } from './EnhancedSecureFileOps.js';
import path from 'path';

// Global instance for general use
let globalSecureOps = null;

/**
 * Initialize secure file operations with base directory
 * @param {string} baseDirectory - Base directory for operations
 * @param {Object} config - Configuration options
 */
export function initializeSecureOps(baseDirectory = null, config = {}) {
  globalSecureOps = new EnhancedSecureFileOps(baseDirectory, config);
  return globalSecureOps;
}

/**
 * Get or create global secure operations instance
 */
function getSecureOps() {
  if (!globalSecureOps) {
    globalSecureOps = new EnhancedSecureFileOps();
  }
  return globalSecureOps;
}

/**
 * Secure file read replacement for fs.readFile
 * @param {string} filePath - Path to file
 * @param {Object|string} options - Read options or encoding
 * @returns {Promise<string|Buffer>} File content
 */
export async function readFile(filePath, options = {}) {
  const secureOps = getSecureOps();
  
  // Handle legacy encoding-as-string parameter
  const readOptions = typeof options === 'string' ? { encoding: options } : options;
  
  const result = await secureOps.readFileAtomicSecure(filePath, readOptions);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'ENOENT'; // Maintain compatibility
    throw error;
  }
  
  return result.content;
}

/**
 * Secure file write replacement for fs.writeFile
 * @param {string} filePath - Target file path
 * @param {string|Buffer} data - Data to write
 * @param {Object|string} options - Write options or encoding
 * @returns {Promise<void>}
 */
export async function writeFile(filePath, data, options = {}) {
  const secureOps = getSecureOps();
  
  // Handle legacy encoding-as-string parameter
  const writeOptions = typeof options === 'string' ? { encoding: options } : options;
  
  const result = await secureOps.writeFileAtomicSecure(filePath, data, writeOptions);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'EACCES'; // Maintain compatibility
    throw error;
  }
}

/**
 * Secure file access check replacement for fs.access
 * @param {string} filePath - Path to check
 * @param {number} mode - Access mode (optional)
 * @returns {Promise<void>}
 */
export async function access(filePath, mode = 0) {
  const secureOps = getSecureOps();
  
  const pathValidation = await secureOps.validatePathSecure(filePath);
  
  if (!pathValidation.valid) {
    const error = new Error(pathValidation.reason);
    error.code = 'ENOENT';
    throw error;
  }
  
  // Use the actual path (resolved symlinks if allowed)
  const targetPath = pathValidation.actualPath;
  
  try {
    // Import fs dynamically to avoid circular dependency
    const fs = await import('fs/promises');
    await fs.access(targetPath, mode);
  } catch (error) {
    throw error; // Re-throw original fs error
  }
}

/**
 * Secure file stat replacement for fs.stat
 * @param {string} filePath - Path to file
 * @returns {Promise<Object>} File stats
 */
export async function stat(filePath) {
  const secureOps = getSecureOps();
  
  const pathValidation = await secureOps.validatePathSecure(filePath);
  
  if (!pathValidation.valid) {
    const error = new Error(pathValidation.reason);
    error.code = 'ENOENT';
    throw error;
  }
  
  // Use the actual path (resolved symlinks if allowed)
  const targetPath = pathValidation.actualPath;
  
  try {
    const fs = await import('fs/promises');
    return await fs.stat(targetPath);
  } catch (error) {
    throw error; // Re-throw original fs error
  }
}

/**
 * Secure directory creation replacement for fs.mkdir
 * @param {string} dirPath - Directory path
 * @param {Object} options - Creation options
 * @returns {Promise<void>}
 */
export async function mkdir(dirPath, options = {}) {
  const secureOps = getSecureOps();
  
  const result = await secureOps.createDirectorySecure(dirPath, options);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'EACCES';
    throw error;
  }
}

/**
 * Secure file deletion replacement for fs.unlink
 * @param {string} filePath - File to delete
 * @returns {Promise<void>}
 */
export async function unlink(filePath) {
  const secureOps = getSecureOps();
  
  const pathValidation = await secureOps.validatePathSecure(filePath);
  
  if (!pathValidation.valid) {
    const error = new Error(pathValidation.reason);
    error.code = 'ENOENT';
    throw error;
  }
  
  // Use the actual path (resolved symlinks if allowed)
  const targetPath = pathValidation.actualPath;
  
  try {
    const fs = await import('fs/promises');
    await fs.unlink(targetPath);
  } catch (error) {
    throw error; // Re-throw original fs error
  }
}

/**
 * Secure file copy replacement for fs.copyFile
 * @param {string} srcPath - Source file path
 * @param {string} destPath - Destination file path
 * @param {number} flags - Copy flags (optional)
 * @returns {Promise<void>}
 */
export async function copyFile(srcPath, destPath, flags = 0) {
  const secureOps = getSecureOps();
  
  // Validate both source and destination paths
  const srcValidation = await secureOps.validatePathSecure(srcPath);
  const destValidation = await secureOps.validatePathSecure(destPath, true);
  
  if (!srcValidation.valid) {
    const error = new Error(`Source path validation failed: ${srcValidation.reason}`);
    error.code = 'ENOENT';
    throw error;
  }
  
  if (!destValidation.valid) {
    const error = new Error(`Destination path validation failed: ${destValidation.reason}`);
    error.code = 'EACCES';
    throw error;
  }
  
  try {
    const fs = await import('fs/promises');
    await fs.copyFile(srcValidation.actualPath, destValidation.actualPath, flags);
  } catch (error) {
    throw error; // Re-throw original fs error
  }
}

/**
 * Secure file rename/move replacement for fs.rename
 * @param {string} oldPath - Current file path
 * @param {string} newPath - New file path
 * @returns {Promise<void>}
 */
export async function rename(oldPath, newPath) {
  const secureOps = getSecureOps();
  
  // Validate both old and new paths
  const oldValidation = await secureOps.validatePathSecure(oldPath);
  const newValidation = await secureOps.validatePathSecure(newPath, true);
  
  if (!oldValidation.valid) {
    const error = new Error(`Old path validation failed: ${oldValidation.reason}`);
    error.code = 'ENOENT';
    throw error;
  }
  
  if (!newValidation.valid) {
    const error = new Error(`New path validation failed: ${newValidation.reason}`);
    error.code = 'EACCES';
    throw error;
  }
  
  try {
    const fs = await import('fs/promises');
    await fs.rename(oldValidation.actualPath, newValidation.actualPath);
  } catch (error) {
    throw error; // Re-throw original fs error
  }
}

/**
 * Create secure read stream replacement for createReadStream
 * @param {string} filePath - File to stream
 * @param {Object} options - Stream options
 * @returns {Promise<ReadableStream>}
 */
export async function createReadStream(filePath, options = {}) {
  const secureOps = getSecureOps();
  
  const result = await secureOps.createReadStreamSecure(filePath, options);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'ENOENT';
    throw error;
  }
  
  return result.stream;
}

/**
 * Create secure write stream replacement for createWriteStream
 * @param {string} filePath - Target file path
 * @param {Object} options - Stream options
 * @returns {Promise<WritableStream>}
 */
export async function createWriteStream(filePath, options = {}) {
  const secureOps = getSecureOps();
  
  const result = await secureOps.createWriteStreamSecure(filePath, options);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'EACCES';
    throw error;
  }
  
  return result.stream;
}

/**
 * Directory-specific secure operations factory
 * Creates a secure operations instance bound to a specific directory
 * @param {string} baseDirectory - Base directory path
 * @param {Object} config - Configuration options
 * @returns {Object} Directory-specific secure operations
 */
export function createSecureOpsForDirectory(baseDirectory, config = {}) {
  const secureOps = new EnhancedSecureFileOps(baseDirectory, config);
  
  return {
    // Bound methods for this specific directory
    readFile: (fileName, options = {}) => {
      const filePath = path.join(baseDirectory, fileName);
      return readFileWithOps(secureOps, filePath, options);
    },
    
    writeFile: (fileName, data, options = {}) => {
      const filePath = path.join(baseDirectory, fileName);
      return writeFileWithOps(secureOps, filePath, data, options);
    },
    
    access: (fileName, mode = 0) => {
      const filePath = path.join(baseDirectory, fileName);
      return accessWithOps(secureOps, filePath, mode);
    },
    
    stat: (fileName) => {
      const filePath = path.join(baseDirectory, fileName);
      return statWithOps(secureOps, filePath);
    },
    
    mkdir: (dirName, options = {}) => {
      const dirPath = path.join(baseDirectory, dirName);
      return mkdirWithOps(secureOps, dirPath, options);
    },
    
    unlink: (fileName) => {
      const filePath = path.join(baseDirectory, fileName);
      return unlinkWithOps(secureOps, filePath);
    },
    
    copyFile: (srcName, destName, flags = 0) => {
      const srcPath = path.join(baseDirectory, srcName);
      const destPath = path.join(baseDirectory, destName);
      return copyFileWithOps(secureOps, srcPath, destPath, flags);
    },
    
    rename: (oldName, newName) => {
      const oldPath = path.join(baseDirectory, oldName);
      const newPath = path.join(baseDirectory, newName);
      return renameWithOps(secureOps, oldPath, newPath);
    },
    
    createReadStream: (fileName, options = {}) => {
      const filePath = path.join(baseDirectory, fileName);
      return createReadStreamWithOps(secureOps, filePath, options);
    },
    
    createWriteStream: (fileName, options = {}) => {
      const filePath = path.join(baseDirectory, fileName);
      return createWriteStreamWithOps(secureOps, filePath, options);
    },
    
    // Additional utility methods
    getSecurityStats: () => secureOps.getSecurityStats(),
    cleanup: () => secureOps.cleanup()
  };
}

// Internal helper functions for directory-specific operations
async function readFileWithOps(secureOps, filePath, options) {
  const readOptions = typeof options === 'string' ? { encoding: options } : options;
  const result = await secureOps.readFileAtomicSecure(filePath, readOptions);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'ENOENT';
    throw error;
  }
  
  return result.content;
}

async function writeFileWithOps(secureOps, filePath, data, options) {
  const writeOptions = typeof options === 'string' ? { encoding: options } : options;
  const result = await secureOps.writeFileAtomicSecure(filePath, data, writeOptions);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'EACCES';
    throw error;
  }
}

async function accessWithOps(secureOps, filePath, mode) {
  const pathValidation = await secureOps.validatePathSecure(filePath);
  
  if (!pathValidation.valid) {
    const error = new Error(pathValidation.reason);
    error.code = 'ENOENT';
    throw error;
  }
  
  const fs = await import('fs/promises');
  await fs.access(pathValidation.actualPath, mode);
}

async function statWithOps(secureOps, filePath) {
  const pathValidation = await secureOps.validatePathSecure(filePath);
  
  if (!pathValidation.valid) {
    const error = new Error(pathValidation.reason);
    error.code = 'ENOENT';
    throw error;
  }
  
  const fs = await import('fs/promises');
  return await fs.stat(pathValidation.actualPath);
}

async function mkdirWithOps(secureOps, dirPath, options) {
  const result = await secureOps.createDirectorySecure(dirPath, options);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'EACCES';
    throw error;
  }
}

async function unlinkWithOps(secureOps, filePath) {
  const pathValidation = await secureOps.validatePathSecure(filePath);
  
  if (!pathValidation.valid) {
    const error = new Error(pathValidation.reason);
    error.code = 'ENOENT';
    throw error;
  }
  
  const fs = await import('fs/promises');
  await fs.unlink(pathValidation.actualPath);
}

async function copyFileWithOps(secureOps, srcPath, destPath, flags) {
  const srcValidation = await secureOps.validatePathSecure(srcPath);
  const destValidation = await secureOps.validatePathSecure(destPath, true);
  
  if (!srcValidation.valid) {
    const error = new Error(`Source: ${srcValidation.reason}`);
    error.code = 'ENOENT';
    throw error;
  }
  
  if (!destValidation.valid) {
    const error = new Error(`Destination: ${destValidation.reason}`);
    error.code = 'EACCES';
    throw error;
  }
  
  const fs = await import('fs/promises');
  await fs.copyFile(srcValidation.actualPath, destValidation.actualPath, flags);
}

async function renameWithOps(secureOps, oldPath, newPath) {
  const oldValidation = await secureOps.validatePathSecure(oldPath);
  const newValidation = await secureOps.validatePathSecure(newPath, true);
  
  if (!oldValidation.valid) {
    const error = new Error(`Old path: ${oldValidation.reason}`);
    error.code = 'ENOENT';
    throw error;
  }
  
  if (!newValidation.valid) {
    const error = new Error(`New path: ${newValidation.reason}`);
    error.code = 'EACCES';
    throw error;
  }
  
  const fs = await import('fs/promises');
  await fs.rename(oldValidation.actualPath, newValidation.actualPath);
}

async function createReadStreamWithOps(secureOps, filePath, options) {
  const result = await secureOps.createReadStreamSecure(filePath, options);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'ENOENT';
    throw error;
  }
  
  return result.stream;
}

async function createWriteStreamWithOps(secureOps, filePath, options) {
  const result = await secureOps.createWriteStreamSecure(filePath, options);
  
  if (!result.success) {
    const error = new Error(result.error);
    error.code = 'EACCES';
    throw error;
  }
  
  return result.stream;
}

// Export default functions for easy migration
export default {
  readFile,
  writeFile,
  access,
  stat,
  mkdir,
  unlink,
  copyFile,
  rename,
  createReadStream,
  createWriteStream,
  initializeSecureOps,
  createSecureOpsForDirectory
};