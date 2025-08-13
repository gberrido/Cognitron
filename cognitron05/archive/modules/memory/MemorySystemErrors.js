#!/usr/bin/env node

/**
 * Standardized Error Types for MemGPT Memory System
 * Provides consistent error classification and recovery strategies
 */

/**
 * Base class for all MemGPT Memory System errors
 */
export class MemorySystemError extends Error {
  constructor(message, code = 'MEMORY_ERROR', severity = 'error', context = {}) {
    super(message);
    this.name = 'MemorySystemError';
    this.code = code;
    this.severity = severity; // 'fatal', 'error', 'warning', 'info'
    this.context = context;
    this.timestamp = new Date().toISOString();
    this.recoverable = true; // Most memory errors are recoverable
    
    // Maintain proper stack trace
    Error.captureStackTrace(this, MemorySystemError);
  }

  /**
   * Convert error to JSON for logging
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp,
      recoverable: this.recoverable,
      stack: this.stack
    };
  }
}

/**
 * Memory corruption or data integrity errors
 */
export class MemoryCorruptionError extends MemorySystemError {
  constructor(message, operation = 'unknown', filePath = null) {
    super(message, 'MEMORY_CORRUPTION', 'fatal', { operation, filePath });
    this.name = 'MemoryCorruptionError';
    this.recoverable = false; // Corruption usually requires reset
  }
}

/**
 * Memory pressure and capacity errors
 */
export class MemoryPressureError extends MemorySystemError {
  constructor(message, currentUsage, maxCapacity, operation = 'unknown') {
    super(message, 'MEMORY_PRESSURE', 'warning', { 
      currentUsage, 
      maxCapacity, 
      operation,
      pressurePercentage: Math.round((currentUsage / maxCapacity) * 100)
    });
    this.name = 'MemoryPressureError';
    this.recoverable = true; // Can be resolved by cleanup
  }
}

/**
 * File system operation errors specific to memory system
 */
export class MemoryFileSystemError extends MemorySystemError {
  constructor(message, operation, filePath, originalError = null) {
    super(message, 'MEMORY_FILESYSTEM', 'error', { 
      operation, 
      filePath,
      originalCode: originalError?.code,
      originalMessage: originalError?.message
    });
    this.name = 'MemoryFileSystemError';
    this.operation = operation;
    this.filePath = filePath;
    this.originalError = originalError;
    this.recoverable = operation !== 'critical_write'; // Most FS errors are recoverable
  }
}

/**
 * JSON parsing and data format errors
 */
export class MemoryDataFormatError extends MemorySystemError {
  constructor(message, dataType, operation = 'parse', rawData = null) {
    super(message, 'MEMORY_DATA_FORMAT', 'error', { 
      dataType, 
      operation,
      dataSize: rawData ? rawData.length : 0
    });
    this.name = 'MemoryDataFormatError';
    this.dataType = dataType;
    this.rawData = rawData;
    this.recoverable = true; // Can fallback to defaults or skip corrupted data
  }
}

/**
 * Session management errors
 */
export class MemorySessionError extends MemorySystemError {
  constructor(message, sessionId, operation = 'unknown') {
    super(message, 'MEMORY_SESSION', 'error', { sessionId, operation });
    this.name = 'MemorySessionError';
    this.sessionId = sessionId;
    this.recoverable = true; // Can create new session
  }
}

/**
 * Search and retrieval operation errors
 */
export class MemorySearchError extends MemorySystemError {
  constructor(message, searchType, query = null, operation = 'search') {
    super(message, 'MEMORY_SEARCH', 'warning', { 
      searchType, 
      query: query ? String(query).substring(0, 100) : null, // Truncate for logging
      operation 
    });
    this.name = 'MemorySearchError';
    this.searchType = searchType;
    this.query = query;
    this.recoverable = true; // Search failures don't break system
  }
}

/**
 * Security violation errors in memory system
 */
export class MemorySecurityError extends MemorySystemError {
  constructor(message, securityCode, operation = 'unknown', filePath = null) {
    super(message, 'MEMORY_SECURITY', 'fatal', { 
      securityCode, 
      operation, 
      filePath 
    });
    this.name = 'MemorySecurityError';
    this.securityCode = securityCode;
    this.recoverable = false; // Security violations are not recoverable
  }
}

/**
 * Configuration and initialization errors
 */
export class MemoryConfigurationError extends MemorySystemError {
  constructor(message, configKey = null, configValue = null) {
    super(message, 'MEMORY_CONFIG', 'fatal', { 
      configKey, 
      configValue: String(configValue).substring(0, 100) // Safe logging
    });
    this.name = 'MemoryConfigurationError';
    this.configKey = configKey;
    this.configValue = configValue;
    this.recoverable = false; // Config errors usually require manual intervention
  }
}

/**
 * Validation errors for memory operations
 */
export class MemoryValidationError extends MemorySystemError {
  constructor(message, field, value, rule) {
    super(message, 'MEMORY_VALIDATION', 'warning', { 
      field, 
      value: String(value).substring(0, 50), // Truncate for safety
      rule 
    });
    this.name = 'MemoryValidationError';
    this.field = field;
    this.value = value;
    this.rule = rule;
    this.recoverable = true; // Validation errors can be corrected
  }
}

/**
 * Error factory for creating standardized memory system errors
 */
export class MemoryErrorFactory {
  /**
   * Create a memory corruption error
   * @param {string} message - Error message
   * @param {string} operation - Operation that caused the error
   * @param {string} filePath - File path involved
   * @returns {MemoryCorruptionError}
   */
  static corruption(message, operation = 'unknown', filePath = null) {
    return new MemoryCorruptionError(message, operation, filePath);
  }

  /**
   * Create a memory pressure error
   * @param {string} message - Error message
   * @param {number} currentUsage - Current memory usage
   * @param {number} maxCapacity - Maximum capacity
   * @param {string} operation - Operation that triggered pressure
   * @returns {MemoryPressureError}
   */
  static pressure(message, currentUsage, maxCapacity, operation = 'unknown') {
    return new MemoryPressureError(message, currentUsage, maxCapacity, operation);
  }

  /**
   * Create a filesystem error
   * @param {string} message - Error message
   * @param {string} operation - File operation
   * @param {string} filePath - File path
   * @param {Error} originalError - Original filesystem error
   * @returns {MemoryFileSystemError}
   */
  static filesystem(message, operation, filePath, originalError = null) {
    return new MemoryFileSystemError(message, operation, filePath, originalError);
  }

  /**
   * Create a data format error
   * @param {string} message - Error message
   * @param {string} dataType - Type of data that failed to parse
   * @param {string} operation - Operation being performed
   * @param {string} rawData - Raw data that failed to parse
   * @returns {MemoryDataFormatError}
   */
  static dataFormat(message, dataType, operation = 'parse', rawData = null) {
    return new MemoryDataFormatError(message, dataType, operation, rawData);
  }

  /**
   * Create a session error
   * @param {string} message - Error message
   * @param {string} sessionId - Session ID
   * @param {string} operation - Session operation
   * @returns {MemorySessionError}
   */
  static session(message, sessionId, operation = 'unknown') {
    return new MemorySessionError(message, sessionId, operation);
  }

  /**
   * Create a search error
   * @param {string} message - Error message
   * @param {string} searchType - Type of search
   * @param {string} query - Search query
   * @param {string} operation - Search operation
   * @returns {MemorySearchError}
   */
  static search(message, searchType, query = null, operation = 'search') {
    return new MemorySearchError(message, searchType, query, operation);
  }

  /**
   * Create a security error
   * @param {string} message - Error message
   * @param {string} securityCode - Security violation code
   * @param {string} operation - Operation that was blocked
   * @param {string} filePath - File path involved
   * @returns {MemorySecurityError}
   */
  static security(message, securityCode, operation = 'unknown', filePath = null) {
    return new MemorySecurityError(message, securityCode, operation, filePath);
  }

  /**
   * Create a configuration error
   * @param {string} message - Error message
   * @param {string} configKey - Configuration key
   * @param {any} configValue - Configuration value
   * @returns {MemoryConfigurationError}
   */
  static configuration(message, configKey = null, configValue = null) {
    return new MemoryConfigurationError(message, configKey, configValue);
  }

  /**
   * Create a validation error
   * @param {string} message - Error message
   * @param {string} field - Field that failed validation
   * @param {any} value - Value that failed validation
   * @param {string} rule - Validation rule that failed
   * @returns {MemoryValidationError}
   */
  static validation(message, field, value, rule) {
    return new MemoryValidationError(message, field, value, rule);
  }

  /**
   * Wrap an existing error in a memory system error
   * @param {Error} originalError - Original error
   * @param {string} operation - Memory operation that failed
   * @param {Object} context - Additional context
   * @returns {MemorySystemError}
   */
  static wrap(originalError, operation = 'unknown', context = {}) {
    const message = `${operation}: ${originalError.message}`;
    
    // Determine appropriate error type based on original error
    if (originalError.code === 'ENOENT' || originalError.code === 'EACCES' || 
        originalError.code === 'EMFILE' || originalError.code === 'ENOSPC') {
      return MemoryErrorFactory.filesystem(message, operation, context.filePath, originalError);
    }
    
    if (originalError instanceof SyntaxError && originalError.message.includes('JSON')) {
      return MemoryErrorFactory.dataFormat(message, 'json', operation, context.rawData);
    }
    
    if (originalError.name === 'SecurityError') {
      return MemoryErrorFactory.security(message, originalError.code, operation, context.filePath);
    }
    
    // Default to generic memory system error
    return new MemorySystemError(message, 'MEMORY_WRAPPED', 'error', { 
      ...context, 
      originalError: {
        name: originalError.name,
        message: originalError.message,
        code: originalError.code
      }
    });
  }
}

/**
 * Recovery strategy recommendations for memory errors
 */
export class MemoryErrorRecovery {
  /**
   * Get recovery strategy for a memory error
   * @param {MemorySystemError} error - Memory system error
   * @returns {Object} Recovery strategy
   */
  static getStrategy(error) {
    switch (error.constructor.name) {
      case 'MemoryCorruptionError':
        return {
          action: 'reset_memory',
          priority: 'high',
          description: 'Memory corruption detected, reset to clean state',
          steps: ['backup_current_state', 'clear_corrupted_data', 'initialize_clean', 'log_incident']
        };
      
      case 'MemoryPressureError':
        return {
          action: 'cleanup_memory',
          priority: 'medium',
          description: 'Memory pressure exceeded threshold, cleanup required',
          steps: ['archive_old_messages', 'update_recursive_summary', 'clear_fifo_queue', 'validate_pressure']
        };
      
      case 'MemoryFileSystemError':
        return {
          action: 'retry_with_fallback',
          priority: 'medium',
          description: 'File system operation failed, retry with fallback',
          steps: ['ensure_directory_exists', 'retry_operation', 'use_temp_file', 'log_filesystem_issue']
        };
      
      case 'MemoryDataFormatError':
        return {
          action: 'skip_corrupted_data',
          priority: 'low',
          description: 'Data format error, skip corrupted entry',
          steps: ['log_corrupted_data', 'skip_entry', 'continue_processing', 'report_statistics']
        };
      
      case 'MemorySessionError':
        return {
          action: 'create_new_session',
          priority: 'medium',
          description: 'Session error, create new session',
          steps: ['save_current_progress', 'generate_new_session_id', 'reinitialize_session', 'log_session_change']
        };
      
      case 'MemorySearchError':
        return {
          action: 'fallback_search',
          priority: 'low',
          description: 'Search failed, use fallback method',
          steps: ['try_alternative_search', 'return_empty_results', 'log_search_failure']
        };
      
      case 'MemorySecurityError':
        return {
          action: 'terminate_operation',
          priority: 'critical',
          description: 'Security violation, terminate operation',
          steps: ['log_security_incident', 'terminate_unsafe_operation', 'alert_administrator']
        };
      
      case 'MemoryConfigurationError':
        return {
          action: 'use_defaults',
          priority: 'high',
          description: 'Configuration error, use default values',
          steps: ['validate_config', 'apply_defaults', 'warn_user', 'continue_with_defaults']
        };
      
      case 'MemoryValidationError':
        return {
          action: 'sanitize_and_retry',
          priority: 'low',
          description: 'Validation failed, sanitize input and retry',
          steps: ['sanitize_input', 'retry_validation', 'use_fallback_value', 'log_validation_issue']
        };
      
      default:
        return {
          action: 'log_and_continue',
          priority: 'medium',
          description: 'Unknown memory error, log and continue',
          steps: ['log_error_details', 'attempt_graceful_recovery', 'continue_operation']
        };
    }
  }
}

export default {
  MemorySystemError,
  MemoryCorruptionError,
  MemoryPressureError,
  MemoryFileSystemError,
  MemoryDataFormatError,
  MemorySessionError,
  MemorySearchError,
  MemorySecurityError,
  MemoryConfigurationError,
  MemoryValidationError,
  MemoryErrorFactory,
  MemoryErrorRecovery
};