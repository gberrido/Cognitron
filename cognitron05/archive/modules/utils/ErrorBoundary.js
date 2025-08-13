#!/usr/bin/env node

/**
 * ErrorBoundary - Comprehensive error handling and recovery system for Cognitron05
 * Provides centralized error classification, logging, and recovery strategies
 */

import fs from 'fs/promises';
import path from 'path';

export class ErrorBoundary {
  constructor(options = {}) {
    this.options = {
      enableLogging: options.enableLogging !== false,
      logFile: options.logFile || 'cognitron05-errors.log',
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 1000,
      gracefulShutdown: options.gracefulShutdown !== false,
      ...options
    };
    
    this.errorCounts = new Map();
    this.isShuttingDown = false;
    this.setupProcessHandlers();
  }

  /**
   * Setup global process error handlers
   */
  setupProcessHandlers() {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.handleCriticalError('uncaughtException', error, { 
        exitProcess: true,
        logLevel: 'fatal'
      });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.handleCriticalError('unhandledRejection', reason, {
        exitProcess: false,
        logLevel: 'error',
        context: { promise }
      });
    });

    // Handle process warnings
    process.on('warning', (warning) => {
      this.logError('process_warning', warning, 'warn');
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      this.handleGracefulShutdown('SIGINT');
    });

    // Handle SIGTERM
    process.on('SIGTERM', () => {
      this.handleGracefulShutdown('SIGTERM');
    });
  }

  /**
   * Main error handler with classification and recovery
   * @param {Error} error - The error that occurred
   * @param {Object} context - Error context information
   * @returns {Object} Error handling result
   */
  async handleError(error, context = {}) {
    const classification = this.classifyError(error);
    const errorId = this.generateErrorId();
    
    const errorInfo = {
      id: errorId,
      timestamp: new Date().toISOString(),
      type: classification.type,
      severity: classification.severity,
      recoverable: classification.recoverable,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      },
      context,
      retryAttempt: context.retryAttempt || 0
    };

    // Log the error
    await this.logError(errorInfo.type, error, classification.severity, errorInfo);

    // Update error count tracking
    this.updateErrorCounts(classification.type);

    // Determine recovery strategy
    const recovery = await this.executeRecoveryStrategy(classification, errorInfo);

    return {
      errorId,
      classification,
      recovery,
      shouldContinue: recovery.success,
      userMessage: this.generateUserMessage(classification, recovery)
    };
  }

  /**
   * Classify error type and determine handling strategy
   * @param {Error} error - The error to classify
   * @returns {Object} Classification result
   */
  classifyError(error) {
    // API/Network errors
    if (error.message?.includes('API') || error.code === 'ECONNREFUSED' || 
        error.code === 'ENOTFOUND' || error.status >= 400) {
      return {
        type: 'api_error',
        severity: error.status === 429 ? 'warning' : 'error',
        recoverable: true,
        retryable: error.status !== 401 && error.status !== 403
      };
    }

    // File system errors
    if (error.code === 'ENOENT' || error.code === 'EACCES' || 
        error.code === 'EMFILE' || error.code === 'ENOSPC') {
      return {
        type: 'filesystem_error',
        severity: error.code === 'ENOSPC' ? 'fatal' : 'error',
        recoverable: error.code !== 'ENOSPC',
        retryable: ['ENOENT', 'EACCES'].includes(error.code)
      };
    }

    // Memory system errors
    if (error.message?.includes('memory') || error.message?.includes('MemGPT')) {
      return {
        type: 'memory_system_error',
        severity: 'error',
        recoverable: true,
        retryable: !error.message.includes('corruption')
      };
    }

    // JSON parsing errors
    if (error instanceof SyntaxError && error.message?.includes('JSON')) {
      return {
        type: 'json_parse_error',
        severity: 'error',
        recoverable: true,
        retryable: false
      };
    }

    // Validation errors
    if (error.message?.includes('validation') || error.name === 'ValidationError') {
      return {
        type: 'validation_error',
        severity: 'warning',
        recoverable: true,
        retryable: false
      };
    }

    // Configuration errors
    if (error.message?.includes('API key') || error.message?.includes('config')) {
      return {
        type: 'configuration_error',
        severity: 'fatal',
        recoverable: false,
        retryable: false
      };
    }

    // Unknown/unexpected errors
    return {
      type: 'unknown_error',
      severity: 'error',
      recoverable: true,
      retryable: true
    };
  }

  /**
   * Execute recovery strategy based on error classification
   * @param {Object} classification - Error classification
   * @param {Object} errorInfo - Error information
   * @returns {Object} Recovery result
   */
  async executeRecoveryStrategy(classification, errorInfo) {
    switch (classification.type) {
      case 'api_error':
        return await this.handleApiError(classification, errorInfo);
      
      case 'filesystem_error':
        return await this.handleFilesystemError(classification, errorInfo);
      
      case 'memory_system_error':
        return await this.handleMemorySystemError(classification, errorInfo);
      
      case 'json_parse_error':
        return await this.handleJsonParseError(classification, errorInfo);
      
      case 'validation_error':
        return { success: true, action: 'continue', message: 'Validation error handled' };
      
      case 'configuration_error':
        return { success: false, action: 'terminate', message: 'Configuration error requires user intervention' };
      
      default:
        return await this.handleUnknownError(classification, errorInfo);
    }
  }

  /**
   * Handle API errors with retry logic
   * @param {Object} classification - Error classification  
   * @param {Object} errorInfo - Error information
   * @returns {Object} Recovery result
   */
  async handleApiError(classification, errorInfo) {
    if (classification.retryable && errorInfo.retryAttempt < this.options.maxRetries) {
      const delay = this.calculateRetryDelay(errorInfo.retryAttempt);
      await this.sleep(delay);
      
      return {
        success: true,
        action: 'retry',
        message: `API error, retrying in ${delay}ms (attempt ${errorInfo.retryAttempt + 1}/${this.options.maxRetries})`
      };
    }

    if (errorInfo.error.status === 429) {
      return {
        success: true,
        action: 'fallback',
        message: 'API rate limit exceeded, using fallback response'
      };
    }

    return {
      success: false,
      action: 'graceful_degrade',
      message: 'API temporarily unavailable, some features may be limited'
    };
  }

  /**
   * Handle filesystem errors
   * @param {Object} classification - Error classification
   * @param {Object} errorInfo - Error information
   * @returns {Object} Recovery result
   */
  async handleFilesystemError(classification, errorInfo) {
    if (errorInfo.error.code === 'ENOENT') {
      return {
        success: true,
        action: 'create_missing',
        message: 'Creating missing files/directories'
      };
    }

    if (errorInfo.error.code === 'ENOSPC') {
      return {
        success: false,
        action: 'terminate',
        message: 'Disk space full, cannot continue'
      };
    }

    return {
      success: true,
      action: 'skip_operation',
      message: 'File operation skipped due to filesystem error'
    };
  }

  /**
   * Handle memory system errors
   * @param {Object} classification - Error classification
   * @param {Object} errorInfo - Error information
   * @returns {Object} Recovery result
   */
  async handleMemorySystemError(classification, errorInfo) {
    if (errorInfo.error.message?.includes('corruption')) {
      return {
        success: true,
        action: 'reset_memory',
        message: 'Memory corruption detected, resetting to clean state'
      };
    }

    return {
      success: true,
      action: 'disable_memory',
      message: 'Memory system temporarily disabled'
    };
  }

  /**
   * Handle JSON parse errors
   * @param {Object} classification - Error classification
   * @param {Object} errorInfo - Error information
   * @returns {Object} Recovery result
   */
  async handleJsonParseError(classification, errorInfo) {
    return {
      success: true,
      action: 'use_backup',
      message: 'Using backup data due to JSON parse error'
    };
  }

  /**
   * Handle unknown errors
   * @param {Object} classification - Error classification
   * @param {Object} errorInfo - Error information
   * @returns {Object} Recovery result
   */
  async handleUnknownError(classification, errorInfo) {
    if (this.getErrorCount('unknown_error') > 5) {
      return {
        success: false,
        action: 'terminate',
        message: 'Too many unknown errors, terminating for safety'
      };
    }

    return {
      success: true,
      action: 'continue',
      message: 'Unknown error logged, continuing with caution'
    };
  }

  /**
   * Handle critical errors that may terminate the process
   * @param {string} type - Error type
   * @param {Error} error - The error
   * @param {Object} options - Handling options
   */
  async handleCriticalError(type, error, options = {}) {
    const errorInfo = {
      type,
      timestamp: new Date().toISOString(),
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      options
    };

    await this.logError(type, error, options.logLevel || 'fatal', errorInfo);
    console.error(`\n🚨 CRITICAL ERROR (${type}):`, error.message);

    if (options.exitProcess && this.options.gracefulShutdown) {
      await this.handleGracefulShutdown('critical_error');
    } else if (options.exitProcess) {
      process.exit(1);
    }
  }

  /**
   * Handle graceful shutdown
   * @param {string} signal - Shutdown signal
   */
  async handleGracefulShutdown(signal) {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    console.log(`\n🔄 Graceful shutdown initiated (${signal})...`);

    try {
      // Allow application to cleanup
      if (this.options.onShutdown) {
        await this.options.onShutdown();
      }
      
      console.log('✅ Cleanup completed successfully');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during cleanup:', error.message);
      process.exit(1);
    }
  }

  /**
   * Log error to file and console
   * @param {string} type - Error type
   * @param {Error} error - The error
   * @param {string} level - Log level
   * @param {Object} details - Additional details
   */
  async logError(type, error, level = 'error', details = {}) {
    if (!this.options.enableLogging) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      type,
      message: error.message || error,
      stack: error.stack,
      ...details
    };

    const logLine = JSON.stringify(logEntry) + '\n';

    try {
      await fs.appendFile(this.options.logFile, logLine);
    } catch (logError) {
      console.error('Failed to write error log:', logError.message);
    }

    // Also log to console based on level
    if (level === 'fatal' || level === 'error') {
      console.error(`[${level.toUpperCase()}] ${type}: ${error.message || error}`);
    } else if (level === 'warn') {
      console.warn(`[WARN] ${type}: ${error.message || error}`);
    }
  }

  /**
   * Generate user-friendly error message
   * @param {Object} classification - Error classification
   * @param {Object} recovery - Recovery result
   * @returns {string} User message
   */
  generateUserMessage(classification, recovery) {
    const baseMessages = {
      api_error: 'There was a problem connecting to the AI service.',
      filesystem_error: 'There was a file system issue.',
      memory_system_error: 'There was a memory system issue.',
      json_parse_error: 'There was a data format issue.',
      validation_error: 'Invalid input provided.',
      configuration_error: 'Configuration error detected.',
      unknown_error: 'An unexpected error occurred.'
    };

    const baseMessage = baseMessages[classification.type] || baseMessages.unknown_error;
    
    if (recovery.success) {
      return `${baseMessage} ${recovery.message}`;
    } else {
      return `${baseMessage} Please check the logs for more details.`;
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attemptNumber - Current attempt number
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attemptNumber) {
    return Math.min(this.options.retryDelay * Math.pow(2, attemptNumber), 10000);
  }

  /**
   * Update error count tracking
   * @param {string} errorType - Type of error
   */
  updateErrorCounts(errorType) {
    const current = this.errorCounts.get(errorType) || 0;
    this.errorCounts.set(errorType, current + 1);
  }

  /**
   * Get error count for specific type
   * @param {string} errorType - Type of error
   * @returns {number} Error count
   */
  getErrorCount(errorType) {
    return this.errorCounts.get(errorType) || 0;
  }

  /**
   * Generate unique error ID
   * @returns {string} Error ID
   */
  generateErrorId() {
    return `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Sleep utility for retry delays
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Sleep promise
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getErrorStatistics() {
    const stats = {};
    for (const [type, count] of this.errorCounts.entries()) {
      stats[type] = count;
    }
    return {
      totalErrors: Array.from(this.errorCounts.values()).reduce((a, b) => a + b, 0),
      errorTypes: stats,
      isShuttingDown: this.isShuttingDown
    };
  }

  /**
   * Reset error counts
   */
  resetErrorCounts() {
    this.errorCounts.clear();
  }

  /**
   * Set shutdown handler
   * @param {Function} handler - Shutdown handler function
   */
  setShutdownHandler(handler) {
    this.options.onShutdown = handler;
  }
}

export default ErrorBoundary;