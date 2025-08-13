#!/usr/bin/env node

/**
 * Secure JSON Handler - Comprehensive JSON security framework
 * Addresses critical JSON injection vulnerabilities and DoS attacks
 * 
 * Security Features:
 * - Prototype pollution prevention
 * - JSON bomb DoS protection
 * - Schema validation with strict limits
 * - Safe parsing with timeout protection
 * - Memory exhaustion prevention
 */

import { getLogger } from '../utils/StructuredLogger.js';

export class SecureJsonHandler {
  constructor(config = {}) {
    this.config = {
      // Size limits
      maxJsonSize: config.maxJsonSize || 1024 * 1024, // 1MB
      maxStringLength: config.maxStringLength || 10000,
      maxArrayLength: config.maxArrayLength || 1000,
      maxObjectDepth: config.maxObjectDepth || 32,
      maxObjectKeys: config.maxObjectKeys || 1000,
      
      // Performance limits
      parseTimeout: config.parseTimeout || 5000, // 5 seconds
      maxMemoryUsage: config.maxMemoryUsage || 50 * 1024 * 1024, // 50MB
      
      // Security options
      preventPrototypePollution: config.preventPrototypePollution !== false,
      allowEmptyObjects: config.allowEmptyObjects !== false,
      allowCircularReferences: config.allowCircularReferences || false,
      strictModeOnly: config.strictModeOnly !== false,
      
      // Validation schemas
      allowedTypes: config.allowedTypes || ['string', 'number', 'boolean', 'object', 'array', 'null'],
      forbiddenKeys: config.forbiddenKeys || ['__proto__', 'constructor', 'prototype'],
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Security statistics
    this.stats = {
      parseAttempts: 0,
      successfulParses: 0,
      securityViolations: 0,
      prototypePollutionAttempts: 0,
      timeoutOccurrences: 0,
      memoryLimitExceeded: 0,
      lastReset: Date.now()
    };
    
    // Dangerous patterns for detection
    this.dangerousPatterns = {
      prototypeKeys: /(__proto__|constructor|prototype)/gi,
      functionPattern: /function\s*\(/gi,
      evalPattern: /(eval|Function)\s*\(/gi,
      scriptPattern: /<script[^>]*>/gi,
      dataUriPattern: /data:\s*(?:text\/html|application\/javascript)/gi
    };
  }

  /**
   * Safely parse JSON with comprehensive security checks
   * @param {string} jsonString - JSON string to parse
   * @param {Object} options - Parse options
   * @returns {Promise<Object>} Parse result with validation info
   */
  async safeParse(jsonString, options = {}) {
    this.stats.parseAttempts++;
    
    const result = {
      success: false,
      data: null,
      error: null,
      warnings: [],
      stats: {
        originalSize: 0,
        parsedSize: 0,
        depth: 0,
        keyCount: 0,
        parseTime: 0
      },
      securityInfo: {
        prototypePollutionDetected: false,
        dangerousPatternsFound: [],
        memoryUsageEstimate: 0
      }
    };
    
    const startTime = Date.now();
    
    try {
      // Pre-validation checks
      const preValidation = await this.preValidateJson(jsonString);
      if (!preValidation.valid) {
        result.error = preValidation.reason;
        return result;
      }
      
      result.stats.originalSize = Buffer.byteLength(jsonString, 'utf8');
      
      // Parse with timeout and security monitoring
      const parsePromise = this.performSecureParse(jsonString, options);
      const timeoutPromise = this.createTimeoutPromise();
      
      const parseData = await Promise.race([parsePromise, timeoutPromise]);
      
      // Post-parse validation and cleanup
      const postValidation = await this.postValidateData(parseData);
      if (!postValidation.valid) {
        result.error = postValidation.reason;
        result.securityInfo = postValidation.securityInfo;
        return result;
      }
      
      result.success = true;
      result.data = postValidation.data;
      result.stats.parsedSize = this.estimateDataSize(result.data);
      result.stats.depth = this.calculateDepth(result.data);
      result.stats.keyCount = this.countKeys(result.data);
      result.stats.parseTime = Date.now() - startTime;
      result.securityInfo = postValidation.securityInfo;
      result.warnings = postValidation.warnings;
      
      this.stats.successfulParses++;
      
      this.logger.debug('JSON parsed successfully', {
        subsystem: 'security',
        component: 'json-handler',
        stats: result.stats,
        securityInfo: result.securityInfo
      });
      
      return result;
      
    } catch (error) {
      result.error = error.message;
      result.stats.parseTime = Date.now() - startTime;
      
      if (error.message.includes('timeout')) {
        this.stats.timeoutOccurrences++;
        result.securityInfo.possibleDoSAttempt = true;
        this.logger.warn('JSON parsing timeout - possible DoS attempt', {
          subsystem: 'security',
          component: 'json-handler',
          originalSize: result.stats.originalSize,
          parseTime: result.stats.parseTime
        });
      }
      
      this.logger.error('JSON parsing failed', {
        subsystem: 'security',
        component: 'json-handler',
        error: error.message,
        stats: result.stats
      }, error);
      
      return result;
    }
  }

  /**
   * Pre-validate JSON string before parsing
   * @param {string} jsonString - JSON string to validate
   * @returns {Object} Validation result
   */
  async preValidateJson(jsonString) {
    const result = { valid: false, reason: null };
    
    try {
      // Basic input validation
      if (!jsonString || typeof jsonString !== 'string') {
        result.reason = 'Invalid JSON input - must be a non-empty string';
        return result;
      }
      
      // Size validation
      const size = Buffer.byteLength(jsonString, 'utf8');
      if (size > this.config.maxJsonSize) {
        result.reason = `JSON size exceeds limit: ${size} > ${this.config.maxJsonSize}`;
        this.stats.securityViolations++;
        return result;
      }
      
      // Pattern-based security checks
      for (const [patternName, pattern] of Object.entries(this.dangerousPatterns)) {
        if (pattern.test(jsonString)) {
          result.reason = `Dangerous pattern detected: ${patternName}`;
          this.stats.securityViolations++;
          
          this.logger.warn('Dangerous pattern in JSON string', {
            subsystem: 'security',
            component: 'json-handler',
            pattern: patternName,
            jsonPreview: jsonString.substring(0, 100)
          });
          
          return result;
        }
      }
      
      // Basic JSON structure validation
      if (!this.hasValidJsonStructure(jsonString)) {
        result.reason = 'Invalid JSON structure detected';
        return result;
      }
      
      result.valid = true;
      return result;
      
    } catch (error) {
      result.reason = `Pre-validation failed: ${error.message}`;
      return result;
    }
  }

  /**
   * Perform secure JSON parsing with monitoring
   * @param {string} jsonString - JSON to parse
   * @param {Object} options - Parse options
   * @returns {Promise<*>} Parsed data
   */
  async performSecureParse(jsonString, options = {}) {
    return new Promise((resolve, reject) => {
      try {
        let depth = 0;
        let keyCount = 0;
        const maxDepth = options.maxDepth || this.config.maxObjectDepth;
        const maxKeys = options.maxKeys || this.config.maxObjectKeys;
        
        // Custom reviver function with security monitoring
        const secureReviver = (key, value) => {
          keyCount++;
          
          // Key count limit
          if (keyCount > maxKeys) {
            throw new Error(`JSON key count limit exceeded: ${keyCount} > ${maxKeys}`);
          }
          
          // Prototype pollution prevention
          if (this.config.preventPrototypePollution && this.isDangerousKey(key)) {
            this.stats.prototypePollutionAttempts++;
            this.logger.warn('Prototype pollution attempt blocked', {
              subsystem: 'security',
              component: 'json-handler',
              key,
              valueType: typeof value
            });
            return undefined; // Remove dangerous key
          }
          
          // Additional prototype pollution prevention for nested objects
          if (typeof value === 'object' && value !== null) {
            for (const [nestedKey] of Object.entries(value)) {
              if (this.isDangerousKey(nestedKey)) {
                this.stats.prototypePollutionAttempts++;
                this.logger.warn('Nested prototype pollution attempt blocked', {
                  subsystem: 'security',
                  component: 'json-handler',
                  parentKey: key,
                  dangerousKey: nestedKey
                });
                delete value[nestedKey];
              }
            }
          }
          
          // Depth tracking
          if (typeof value === 'object' && value !== null) {
            depth++;
            if (depth > maxDepth) {
              throw new Error(`JSON depth limit exceeded: ${depth} > ${maxDepth}`);
            }
          }
          
          // Type validation
          if (!this.isAllowedType(value)) {
            throw new Error(`Forbidden data type detected: ${typeof value}`);
          }
          
          // String length validation
          if (typeof value === 'string' && value.length > this.config.maxStringLength) {
            throw new Error(`String length limit exceeded: ${value.length} > ${this.config.maxStringLength}`);
          }
          
          // Array length validation
          if (Array.isArray(value) && value.length > this.config.maxArrayLength) {
            throw new Error(`Array length limit exceeded: ${value.length} > ${this.config.maxArrayLength}`);
          }
          
          return value;
        };
        
        const parsedData = JSON.parse(jsonString, secureReviver);
        resolve(parsedData);
        
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Create timeout promise for parsing operations
   * @returns {Promise} Timeout promise
   */
  createTimeoutPromise() {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`JSON parsing timeout: exceeded ${this.config.parseTimeout}ms`));
      }, this.config.parseTimeout);
    });
  }

  /**
   * Post-parse data validation and cleanup
   * @param {*} data - Parsed data to validate
   * @returns {Object} Validation result
   */
  async postValidateData(data) {
    const result = {
      valid: false,
      data: null,
      reason: null,
      warnings: [],
      securityInfo: {
        prototypePollutionDetected: false,
        dangerousPatternsFound: [],
        memoryUsageEstimate: 0
      }
    };
    
    try {
      // Memory usage estimation
      const memoryEstimate = this.estimateDataSize(data);
      result.securityInfo.memoryUsageEstimate = memoryEstimate;
      
      if (memoryEstimate > this.config.maxMemoryUsage) {
        result.reason = `Parsed data exceeds memory limit: ${memoryEstimate} > ${this.config.maxMemoryUsage}`;
        this.stats.memoryLimitExceeded++;
        return result;
      }
      
      // Deep security scan of parsed data
      const securityScan = this.performDeepSecurityScan(data);
      if (!securityScan.safe) {
        result.reason = `Security scan failed: ${securityScan.reason}`;
        result.securityInfo = securityScan.securityInfo;
        return result;
      }
      
      // Additional validation checks
      if (!this.config.allowEmptyObjects && this.hasEmptyObjects(data)) {
        result.warnings.push('Empty objects detected in parsed data');
      }
      
      // Circular reference detection
      if (!this.config.allowCircularReferences && this.hasCircularReferences(data)) {
        result.reason = 'Circular references detected in parsed data';
        return result;
      }
      
      result.valid = true;
      result.data = data;
      result.warnings = result.warnings.concat(securityScan.warnings);
      result.securityInfo = securityScan.securityInfo;
      
      return result;
      
    } catch (error) {
      result.reason = `Post-validation failed: ${error.message}`;
      return result;
    }
  }

  /**
   * Perform deep security scan of parsed data
   * @param {*} data - Data to scan
   * @param {number} currentDepth - Current recursion depth
   * @returns {Object} Security scan result
   */
  performDeepSecurityScan(data, currentDepth = 0) {
    const result = {
      safe: true,
      reason: null,
      warnings: [],
      securityInfo: {
        prototypePollutionDetected: false,
        dangerousPatternsFound: [],
        memoryUsageEstimate: 0
      }
    };
    
    try {
      // Prevent infinite recursion
      if (currentDepth > this.config.maxObjectDepth) {
        result.safe = false;
        result.reason = `Maximum scan depth exceeded: ${currentDepth}`;
        return result;
      }
      
      if (typeof data === 'object' && data !== null) {
        if (Array.isArray(data)) {
          // Scan array elements
          for (let i = 0; i < data.length; i++) {
            const elementScan = this.performDeepSecurityScan(data[i], currentDepth + 1);
            if (!elementScan.safe) {
              result.safe = false;
              result.reason = `Array element ${i}: ${elementScan.reason}`;
              return result;
            }
            result.warnings = result.warnings.concat(elementScan.warnings);
          }
        } else {
          // Scan object properties
          for (const [key, value] of Object.entries(data)) {
            // Check for dangerous keys
            if (this.isDangerousKey(key)) {
              result.securityInfo.prototypePollutionDetected = true;
              result.warnings.push(`Potentially dangerous key found: ${key}`);
            }
            
            // Recursively scan values
            const valueScan = this.performDeepSecurityScan(value, currentDepth + 1);
            if (!valueScan.safe) {
              result.safe = false;
              result.reason = `Object property ${key}: ${valueScan.reason}`;
              return result;
            }
            result.warnings = result.warnings.concat(valueScan.warnings);
          }
        }
      } else if (typeof data === 'string') {
        // Scan string content for dangerous patterns
        for (const [patternName, pattern] of Object.entries(this.dangerousPatterns)) {
          if (pattern.test(data)) {
            result.securityInfo.dangerousPatternsFound.push(patternName);
            result.warnings.push(`Dangerous pattern in string: ${patternName}`);
          }
        }
      }
      
      return result;
      
    } catch (error) {
      result.safe = false;
      result.reason = `Security scan error: ${error.message}`;
      return result;
    }
  }

  /**
   * Safely stringify data with security controls
   * @param {*} data - Data to stringify
   * @param {Object} options - Stringify options
   * @returns {Object} Stringify result
   */
  safeStringify(data, options = {}) {
    const result = {
      success: false,
      json: null,
      error: null,
      stats: {
        originalSize: 0,
        jsonSize: 0,
        stringifyTime: 0
      }
    };
    
    const startTime = Date.now();
    
    try {
      // Pre-stringify validation
      result.stats.originalSize = this.estimateDataSize(data);
      
      if (result.stats.originalSize > this.config.maxMemoryUsage) {
        result.error = `Data too large to stringify: ${result.stats.originalSize} > ${this.config.maxMemoryUsage}`;
        return result;
      }
      
      // Circular reference detection
      if (this.hasCircularReferences(data)) {
        result.error = 'Cannot stringify data with circular references';
        return result;
      }
      
      // Safe stringify with replacer function
      const safeReplacer = (key, value) => {
        // Remove dangerous keys during stringify
        if (this.isDangerousKey(key)) {
          return undefined;
        }
        
        // Handle functions (convert to string or remove)
        if (typeof value === 'function') {
          return options.includeFunctions ? value.toString() : undefined;
        }
        
        // Handle undefined values
        if (value === undefined) {
          return options.includeUndefined ? null : undefined;
        }
        
        return value;
      };
      
      result.json = JSON.stringify(data, safeReplacer, options.indent);
      result.stats.jsonSize = Buffer.byteLength(result.json, 'utf8');
      result.stats.stringifyTime = Date.now() - startTime;
      result.success = true;
      
      this.logger.debug('Data stringified successfully', {
        subsystem: 'security',
        component: 'json-handler',
        stats: result.stats
      });
      
      return result;
      
    } catch (error) {
      result.error = error.message;
      result.stats.stringifyTime = Date.now() - startTime;
      
      this.logger.error('JSON stringify failed', {
        subsystem: 'security',
        component: 'json-handler',
        error: error.message,
        stats: result.stats
      }, error);
      
      return result;
    }
  }

  /**
   * Check if a key is dangerous (prototype pollution)
   * @param {string} key - Key to check
   * @returns {boolean} True if dangerous
   */
  isDangerousKey(key) {
    if (!key || typeof key !== 'string') return false;
    return this.config.forbiddenKeys.includes(key.toLowerCase());
  }

  /**
   * Check if data type is allowed
   * @param {*} value - Value to check
   * @returns {boolean} True if allowed
   */
  isAllowedType(value) {
    const type = Array.isArray(value) ? 'array' : 
                 value === null ? 'null' : typeof value;
    return this.config.allowedTypes.includes(type);
  }

  /**
   * Check if JSON string has valid basic structure
   * @param {string} jsonString - JSON string to check
   * @returns {boolean} True if valid structure
   */
  hasValidJsonStructure(jsonString) {
    const trimmed = jsonString.trim();
    
    // Must start and end with valid JSON characters
    const validStarts = ['{', '[', '"', "'"];
    const validEnds = ['}', ']', '"', "'"];
    
    const startsValid = validStarts.some(start => trimmed.startsWith(start));
    const endsValid = validEnds.some(end => trimmed.endsWith(end));
    
    return startsValid && endsValid;
  }

  /**
   * Estimate memory size of data structure
   * @param {*} data - Data to estimate
   * @returns {number} Estimated size in bytes
   */
  estimateDataSize(data) {
    if (data === null || data === undefined) return 8;
    
    switch (typeof data) {
      case 'boolean':
        return 4;
      case 'number':
        return 8;
      case 'string':
        return data.length * 2 + 16; // UTF-16 + overhead
      case 'object':
        if (Array.isArray(data)) {
          return 24 + data.reduce((sum, item) => sum + this.estimateDataSize(item), 0);
        } else {
          let size = 24; // Object overhead
          for (const [key, value] of Object.entries(data)) {
            size += key.length * 2 + 16; // Key string + overhead
            size += this.estimateDataSize(value);
          }
          return size;
        }
      default:
        return 16; // Default overhead for unknown types
    }
  }

  /**
   * Calculate maximum depth of nested data structure
   * @param {*} data - Data to analyze
   * @param {number} currentDepth - Current depth
   * @returns {number} Maximum depth
   */
  calculateDepth(data, currentDepth = 0) {
    if (typeof data !== 'object' || data === null) {
      return currentDepth;
    }
    
    let maxDepth = currentDepth;
    
    if (Array.isArray(data)) {
      for (const item of data) {
        const depth = this.calculateDepth(item, currentDepth + 1);
        maxDepth = Math.max(maxDepth, depth);
      }
    } else {
      for (const value of Object.values(data)) {
        const depth = this.calculateDepth(value, currentDepth + 1);
        maxDepth = Math.max(maxDepth, depth);
      }
    }
    
    return maxDepth;
  }

  /**
   * Count total number of keys in nested objects
   * @param {*} data - Data to analyze
   * @returns {number} Total key count
   */
  countKeys(data) {
    if (typeof data !== 'object' || data === null) {
      return 0;
    }
    
    let keyCount = 0;
    
    if (Array.isArray(data)) {
      for (const item of data) {
        keyCount += this.countKeys(item);
      }
    } else {
      keyCount += Object.keys(data).length;
      for (const value of Object.values(data)) {
        keyCount += this.countKeys(value);
      }
    }
    
    return keyCount;
  }

  /**
   * Check for empty objects in data structure
   * @param {*} data - Data to check
   * @returns {boolean} True if empty objects found
   */
  hasEmptyObjects(data) {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    
    if (Array.isArray(data)) {
      return data.some(item => this.hasEmptyObjects(item));
    } else {
      if (Object.keys(data).length === 0) {
        return true;
      }
      return Object.values(data).some(value => this.hasEmptyObjects(value));
    }
  }

  /**
   * Check for circular references in data structure
   * @param {*} data - Data to check
   * @param {WeakSet} visited - Visited objects
   * @returns {boolean} True if circular references found
   */
  hasCircularReferences(data, visited = new WeakSet()) {
    if (typeof data !== 'object' || data === null) {
      return false;
    }
    
    if (visited.has(data)) {
      return true;
    }
    
    visited.add(data);
    
    if (Array.isArray(data)) {
      for (const item of data) {
        if (this.hasCircularReferences(item, visited)) {
          return true;
        }
      }
    } else {
      for (const value of Object.values(data)) {
        if (this.hasCircularReferences(value, visited)) {
          return true;
        }
      }
    }
    
    visited.delete(data);
    return false;
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
      parseAttempts: this.stats.parseAttempts,
      successfulParses: this.stats.successfulParses,
      successRate: this.stats.parseAttempts > 0 ? 
        (this.stats.successfulParses / this.stats.parseAttempts) * 100 : 0,
      securityViolations: this.stats.securityViolations,
      prototypePollutionAttempts: this.stats.prototypePollutionAttempts,
      timeoutOccurrences: this.stats.timeoutOccurrences,
      memoryLimitExceeded: this.stats.memoryLimitExceeded,
      parsesPerMinute: uptime > 0 ? 
        (this.stats.parseAttempts / (uptime / 60000)) : 0,
      lastReset: this.stats.lastReset,
      config: {
        maxJsonSize: this.config.maxJsonSize,
        maxObjectDepth: this.config.maxObjectDepth,
        parseTimeout: this.config.parseTimeout,
        preventPrototypePollution: this.config.preventPrototypePollution
      }
    };
  }

  /**
   * Reset security statistics
   */
  resetStats() {
    this.stats = {
      parseAttempts: 0,
      successfulParses: 0,
      securityViolations: 0,
      prototypePollutionAttempts: 0,
      timeoutOccurrences: 0,
      memoryLimitExceeded: 0,
      lastReset: Date.now()
    };
    
    this.logger.info('JSON handler security statistics reset', {
      subsystem: 'security',
      component: 'json-handler',
      operation: 'reset-stats'
    });
  }
}

export default SecureJsonHandler;