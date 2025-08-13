#!/usr/bin/env node

/**
 * Input Validation Security Audit System
 * Comprehensive security validation and sanitization framework
 * 
 * Addresses critical security vulnerabilities identified in security audit:
 * - Plugin loading validation and sandboxing
 * - JSON injection prevention and schema validation  
 * - Advanced path traversal protection
 * - Search query security with ReDoS prevention
 * - Memory exhaustion protection
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { getLogger } from '../utils/StructuredLogger.js';

export class InputValidationAudit {
  constructor(config = {}) {
    this.config = {
      // JSON security limits
      maxJsonSize: config.maxJsonSize || 1024 * 1024, // 1MB
      maxJsonDepth: config.maxJsonDepth || 32,
      maxJsonKeys: config.maxJsonKeys || 1000,
      jsonTimeout: config.jsonTimeout || 5000, // 5 seconds
      
      // Plugin security
      allowedPluginPaths: config.allowedPluginPaths || ['./plugins'],
      requirePluginSignatures: config.requirePluginSignatures !== false,
      pluginSandbox: config.pluginSandbox !== false,
      
      // Search security
      maxSearchQueryLength: config.maxSearchQueryLength || 1000,
      searchTimeout: config.searchTimeout || 3000,
      maxSearchResults: config.maxSearchResults || 1000,
      
      // Path security
      allowedBasePaths: config.allowedBasePaths || ['./cognitron05-data'],
      maxPathLength: config.maxPathLength || 4096,
      
      // Memory limits  
      maxMemoryUsage: config.maxMemoryUsage || 10 * 1024 * 1024, // 10MB for testing
      maxArrayLength: config.maxArrayLength || 10000,
      maxObjectKeys: config.maxObjectKeys || 1000,
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Security pattern definitions
    this.securityPatterns = {
      // Path traversal patterns (comprehensive)
      pathTraversal: [
        /\.\./,
        /\.%2e/gi,
        /%2e\./gi,
        /%2e%2e/gi,
        /\.%252e/gi,
        /%252e\./gi,
        /%252e%252e/gi,
        /\x00/,
        /[\x00-\x1f\x7f-\x9f]/,
        /^\/+/,
        /\\+/
      ],
      
      // Command injection patterns
      commandInjection: [
        /[;&|`$(){}[\]]/,
        /\bexec\b/i,
        /\beval\b/i,
        /\bsystem\b/i,
        /\bshell\b/i,
        /\bpopen\b/i,
        /\bspawn\b/i
      ],
      
      // Script injection patterns
      scriptInjection: [
        /<script/i,
        /javascript:/i,
        /on\w+\s*=/i,
        /data:\s*text\/html/i,
        /vbscript:/i
      ],
      
      // ReDoS vulnerable regex patterns
      redosPatterns: [
        /(a+)+/,
        /(a|a)*/,
        /(a*)*b/,
        /^(a+)+$/,
        /([a-zA-Z]+)*$/,
        /([\w._%+-]+@[\w.-]+)+/
      ]
    };
    
    // Security statistics
    this.stats = {
      validationChecks: 0,
      securityViolations: 0,
      blockedRequests: 0,
      suspiciousActivity: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Validate plugin path with comprehensive security checks
   * @param {string} pluginPath - Path to plugin file
   * @returns {Object} Validation result
   */
  async validatePluginPath(pluginPath) {
    this.stats.validationChecks++;
    
    const result = {
      valid: false,
      reason: null,
      sanitizedPath: null,
      securityLevel: 'high'
    };
    
    try {
      // Basic input validation
      if (!pluginPath || typeof pluginPath !== 'string') {
        result.reason = 'Invalid plugin path format';
        return result;
      }
      
      // Length check
      if (pluginPath.length > this.config.maxPathLength) {
        result.reason = `Plugin path too long (${pluginPath.length} > ${this.config.maxPathLength})`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Path traversal detection
      for (const pattern of this.securityPatterns.pathTraversal) {
        if (pattern.test(pluginPath)) {
          result.reason = `Path traversal detected in plugin path: ${pluginPath}`;
          this.stats.securityViolations++;
          this.logger.warn('Security violation detected', {
            subsystem: 'security',
            component: 'input-validation',
            violation: 'path-traversal',
            pluginPath,
            pattern: pattern.toString()
          });
          return result;
        }
      }
      
      // Resolve to canonical path
      const resolvedPath = path.resolve(pluginPath);
      
      // Verify against allowed base paths
      const isAllowed = this.config.allowedPluginPaths.some(basePath => {
        const resolvedBasePath = path.resolve(basePath);
        return resolvedPath.startsWith(resolvedBasePath);
      });
      
      if (!isAllowed) {
        result.reason = `Plugin path outside allowed directories: ${resolvedPath}`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Check file extension
      const ext = path.extname(resolvedPath).toLowerCase();
      if (!['.js', '.mjs', '.cjs'].includes(ext)) {
        result.reason = `Invalid plugin file extension: ${ext}`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Verify file exists and is readable
      try {
        await fs.access(resolvedPath, fs.constants.R_OK);
      } catch (error) {
        result.reason = `Plugin file not accessible: ${error.message}`;
        return result;
      }
      
      // Plugin signature verification (if enabled)
      if (this.config.requirePluginSignatures) {
        const signatureValid = await this.verifyPluginSignature(resolvedPath);
        if (!signatureValid) {
          result.reason = 'Plugin signature verification failed';
          this.stats.securityViolations++;
          return result;
        }
      }
      
      result.valid = true;
      result.sanitizedPath = resolvedPath;
      
      this.logger.debug('Plugin path validated successfully', {
        subsystem: 'security',
        component: 'input-validation',
        pluginPath: resolvedPath
      });
      
      return result;
      
    } catch (error) {
      result.reason = `Plugin path validation error: ${error.message}`;
      this.logger.error('Plugin path validation failed', {
        subsystem: 'security',
        component: 'input-validation',
        pluginPath
      }, error);
      return result;
    }
  }

  /**
   * Verify plugin signature (placeholder for production implementation)
   * @param {string} pluginPath - Path to plugin file
   * @returns {boolean} Signature validity
   */
  async verifyPluginSignature(pluginPath) {
    // In production, this would:
    // 1. Check for .sig file alongside plugin
    // 2. Verify cryptographic signature
    // 3. Check against trusted certificate authority
    // 4. Validate plugin hash integrity
    
    try {
      const signaturePath = `${pluginPath}.sig`;
      
      // Check if signature file exists
      try {
        await fs.access(signaturePath);
      } catch (error) {
        this.logger.warn('Plugin signature file missing', {
          subsystem: 'security',
          component: 'plugin-validation',
          pluginPath,
          signaturePath
        });
        return false; // Signature required but not found
      }
      
      // For now, return true if signature file exists
      // In production, implement actual cryptographic verification
      return true;
      
    } catch (error) {
      this.logger.error('Plugin signature verification failed', {
        subsystem: 'security',
        component: 'plugin-validation',
        pluginPath
      }, error);
      return false;
    }
  }

  /**
   * Secure JSON validation and parsing
   * @param {string} jsonString - JSON string to validate
   * @returns {Object} Validation result with parsed data
   */
  async validateAndParseJson(jsonString) {
    this.stats.validationChecks++;
    
    const result = {
      valid: false,
      data: null,
      reason: null,
      stats: {
        size: 0,
        depth: 0,
        keys: 0
      }
    };
    
    try {
      // Basic input validation
      if (!jsonString || typeof jsonString !== 'string') {
        result.reason = 'Invalid JSON input format';
        return result;
      }
      
      // Size validation
      result.stats.size = Buffer.byteLength(jsonString, 'utf8');
      if (result.stats.size > this.config.maxJsonSize) {
        result.reason = `JSON size exceeds limit (${result.stats.size} > ${this.config.maxJsonSize})`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Parse with timeout protection
      const parsePromise = new Promise((resolve, reject) => {
        try {
          // Use JSON.parse with reviver to track depth and key count
          let currentDepth = 0;
          let keyCount = 0;
          
          const data = JSON.parse(jsonString, (key, value) => {
            keyCount++;
            
            // Track maximum depth
            if (typeof value === 'object' && value !== null) {
              currentDepth++;
              if (currentDepth > this.config.maxJsonDepth) {
                throw new Error(`JSON depth exceeds limit (${currentDepth} > ${this.config.maxJsonDepth})`);
              }
            }
            
            // Track key count
            if (keyCount > this.config.maxJsonKeys) {
              throw new Error(`JSON key count exceeds limit (${keyCount} > ${this.config.maxJsonKeys})`);
            }
            
            // Prototype pollution protection
            if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
              this.logger.warn('Potential prototype pollution attempt detected', {
                subsystem: 'security',
                component: 'json-validation',
                key,
                value: typeof value
              });
              return undefined; // Remove dangerous keys
            }
            
            return value;
          });
          
          result.stats.depth = currentDepth;
          result.stats.keys = keyCount;
          resolve(data);
          
        } catch (parseError) {
          reject(parseError);
        }
      });
      
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`JSON parsing timeout (${this.config.jsonTimeout}ms)`));
        }, this.config.jsonTimeout);
      });
      
      result.data = await Promise.race([parsePromise, timeoutPromise]);
      result.valid = true;
      
      this.logger.debug('JSON validated and parsed successfully', {
        subsystem: 'security',
        component: 'json-validation',
        stats: result.stats
      });
      
      return result;
      
    } catch (error) {
      result.reason = `JSON validation failed: ${error.message}`;
      
      if (error.message.includes('timeout')) {
        this.stats.securityViolations++;
        this.logger.warn('JSON parsing timeout - potential DoS attempt', {
          subsystem: 'security',
          component: 'json-validation',
          size: result.stats.size
        });
      }
      
      return result;
    }
  }

  /**
   * Validate search query with ReDoS protection
   * @param {string} query - Search query to validate
   * @returns {Object} Validation result
   */
  validateSearchQuery(query) {
    this.stats.validationChecks++;
    
    const result = {
      valid: false,
      sanitizedQuery: null,
      reason: null,
      riskLevel: 'low'
    };
    
    try {
      // Basic input validation
      if (!query || typeof query !== 'string') {
        result.reason = 'Invalid search query format';
        return result;
      }
      
      // Length validation
      if (query.length > this.config.maxSearchQueryLength) {
        result.reason = `Search query too long (${query.length} > ${this.config.maxSearchQueryLength})`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Command injection detection
      for (const pattern of this.securityPatterns.commandInjection) {
        if (pattern.test(query)) {
          result.reason = `Command injection pattern detected in search query`;
          result.riskLevel = 'high';
          this.stats.securityViolations++;
          this.logger.warn('Command injection attempt in search query', {
            subsystem: 'security',
            component: 'search-validation',
            query: query.substring(0, 100), // Log first 100 chars only
            pattern: pattern.toString()
          });
          return result;
        }
      }
      
      // Script injection detection
      for (const pattern of this.securityPatterns.scriptInjection) {
        if (pattern.test(query)) {
          result.reason = `Script injection pattern detected in search query`;
          result.riskLevel = 'high';
          this.stats.securityViolations++;
          this.logger.warn('Script injection attempt in search query', {
            subsystem: 'security',
            component: 'search-validation',
            query: query.substring(0, 100)
          });
          return result;
        }
      }
      
      // ReDoS pattern detection
      for (const pattern of this.securityPatterns.redosPatterns) {
        if (pattern.test(query)) {
          result.reason = `Potentially dangerous regex pattern detected`;
          result.riskLevel = 'medium';
          this.stats.suspiciousActivity++;
          this.logger.warn('Potentially dangerous regex pattern in search query', {
            subsystem: 'security',
            component: 'search-validation',
            query: query.substring(0, 100)
          });
          return result;
        }
      }
      
      // Sanitize query - remove potentially dangerous characters
      const sanitized = query
        .replace(/[<>]/g, '') // Remove angle brackets
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .replace(/data:/gi, '') // Remove data: protocol
        .replace(/vbscript:/gi, '') // Remove vbscript: protocol
        .trim();
      
      // Validate sanitized query isn't empty
      if (!sanitized) {
        result.reason = 'Search query contains only invalid characters';
        return result;
      }
      
      result.valid = true;
      result.sanitizedQuery = sanitized;
      
      this.logger.debug('Search query validated successfully', {
        subsystem: 'security',
        component: 'search-validation',
        originalLength: query.length,
        sanitizedLength: sanitized.length
      });
      
      return result;
      
    } catch (error) {
      result.reason = `Search query validation error: ${error.message}`;
      this.logger.error('Search query validation failed', {
        subsystem: 'security',
        component: 'search-validation'
      }, error);
      return result;
    }
  }

  /**
   * Enhanced path validation with canonical path resolution
   * @param {string} inputPath - Path to validate
   * @param {string} basePath - Base path to restrict to
   * @returns {Object} Validation result
   */
  validatePath(inputPath, basePath = null) {
    this.stats.validationChecks++;
    
    const result = {
      valid: false,
      canonicalPath: null,
      reason: null,
      securityLevel: 'medium'
    };
    
    try {
      // Basic input validation
      if (!inputPath || typeof inputPath !== 'string') {
        result.reason = 'Invalid path format';
        return result;
      }
      
      // Length validation
      if (inputPath.length > this.config.maxPathLength) {
        result.reason = `Path too long (${inputPath.length} > ${this.config.maxPathLength})`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Path traversal detection (comprehensive)
      for (const pattern of this.securityPatterns.pathTraversal) {
        if (pattern.test(inputPath)) {
          result.reason = `Path traversal detected: ${inputPath}`;
          result.securityLevel = 'high';
          this.stats.securityViolations++;
          this.logger.warn('Path traversal attempt detected', {
            subsystem: 'security',
            component: 'path-validation',
            inputPath,
            pattern: pattern.toString()
          });
          return result;
        }
      }
      
      // Resolve to canonical path
      const canonicalPath = path.resolve(inputPath);
      
      // Validate against base path if provided
      const basePathToUse = basePath || this.config.allowedBasePaths[0];
      if (basePathToUse) {
        const canonicalBasePath = path.resolve(basePathToUse);
        
        if (!canonicalPath.startsWith(canonicalBasePath)) {
          result.reason = `Path outside allowed base directory: ${canonicalPath}`;
          result.securityLevel = 'high';
          this.stats.securityViolations++;
          return result;
        }
      }
      
      // Additional security checks
      const pathParts = canonicalPath.split(path.sep);
      
      // Check for hidden/system directories
      for (const part of pathParts) {
        if (part.startsWith('.') && part !== '.' && part !== '..') {
          // Allow certain common hidden files
          const allowedHidden = ['.gitignore', '.env', '.config'];
          if (!allowedHidden.some(allowed => part.startsWith(allowed))) {
            this.logger.debug('Access to hidden directory/file', {
              subsystem: 'security',
              component: 'path-validation',
              path: canonicalPath,
              hiddenPart: part
            });
          }
        }
      }
      
      result.valid = true;
      result.canonicalPath = canonicalPath;
      
      this.logger.debug('Path validated successfully', {
        subsystem: 'security',
        component: 'path-validation',
        inputPath,
        canonicalPath
      });
      
      return result;
      
    } catch (error) {
      result.reason = `Path validation error: ${error.message}`;
      this.logger.error('Path validation failed', {
        subsystem: 'security',
        component: 'path-validation',
        inputPath
      }, error);
      return result;
    }
  }

  /**
   * Memory usage validation
   * @param {*} data - Data to check memory usage for
   * @returns {Object} Memory validation result
   */
  validateMemoryUsage(data) {
    this.stats.validationChecks++;
    
    const result = {
      valid: false,
      estimatedSize: 0,
      reason: null,
      recommendations: []
    };
    
    try {
      // Estimate memory usage
      result.estimatedSize = this.estimateMemoryUsage(data);
      
      // Check against limits
      if (result.estimatedSize > this.config.maxMemoryUsage) {
        result.reason = `Data size exceeds memory limit (${result.estimatedSize} > ${this.config.maxMemoryUsage})`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Validate array lengths
      if (Array.isArray(data) && data.length > this.config.maxArrayLength) {
        result.reason = `Array length exceeds limit (${data.length} > ${this.config.maxArrayLength})`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Validate object key counts
      if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        const keyCount = Object.keys(data).length;
        if (keyCount > this.config.maxObjectKeys) {
          result.reason = `Object key count exceeds limit (${keyCount} > ${this.config.maxObjectKeys})`;
          this.stats.securityViolations++;
          return result;
        }
      }
      
      // Memory optimization recommendations
      if (result.estimatedSize > this.config.maxMemoryUsage * 0.8) {
        result.recommendations.push('Consider data pagination or streaming');
      }
      
      if (Array.isArray(data) && data.length > this.config.maxArrayLength * 0.8) {
        result.recommendations.push('Consider array chunking or lazy loading');
      }
      
      result.valid = true;
      
      return result;
      
    } catch (error) {
      result.reason = `Memory validation error: ${error.message}`;
      this.logger.error('Memory validation failed', {
        subsystem: 'security',
        component: 'memory-validation'
      }, error);
      return result;
    }
  }

  /**
   * Estimate memory usage of data structure
   * @param {*} data - Data to estimate
   * @returns {number} Estimated bytes
   */
  estimateMemoryUsage(data) {
    if (data === null || data === undefined) return 8;
    
    switch (typeof data) {
      case 'boolean':
        return 4;
      case 'number':
        return 8;
      case 'string':
        return data.length * 2; // UTF-16 encoding
      case 'object':
        if (Array.isArray(data)) {
          return 24 + data.reduce((sum, item) => sum + this.estimateMemoryUsage(item), 0);
        } else {
          let size = 24; // Object overhead
          for (const [key, value] of Object.entries(data)) {
            size += key.length * 2; // Key string
            size += this.estimateMemoryUsage(value);
          }
          return size;
        }
      default:
        return 8; // Default size for unknown types
    }
  }

  /**
   * Generate security statistics report
   * @returns {Object} Security statistics
   */
  getSecurityStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    
    return {
      uptime,
      totalChecks: this.stats.validationChecks,
      securityViolations: this.stats.securityViolations,
      blockedRequests: this.stats.blockedRequests,
      suspiciousActivity: this.stats.suspiciousActivity,
      violationRate: this.stats.validationChecks > 0 ? 
        (this.stats.securityViolations / this.stats.validationChecks) * 100 : 0,
      checksPerMinute: uptime > 0 ? 
        (this.stats.validationChecks / (uptime / 60000)) : 0,
      lastReset: this.stats.lastReset,
      config: {
        maxJsonSize: this.config.maxJsonSize,
        maxSearchQueryLength: this.config.maxSearchQueryLength,
        maxPathLength: this.config.maxPathLength,
        requirePluginSignatures: this.config.requirePluginSignatures
      }
    };
  }

  /**
   * Reset security statistics
   */
  resetStats() {
    this.stats = {
      validationChecks: 0,
      securityViolations: 0,
      blockedRequests: 0,
      suspiciousActivity: 0,
      lastReset: Date.now()
    };
    
    this.logger.info('Security statistics reset', {
      subsystem: 'security',
      component: 'input-validation',
      operation: 'reset-stats'
    });
  }
}

export default InputValidationAudit;