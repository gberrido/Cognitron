#!/usr/bin/env node

/**
 * Structured Logger - Zero-dependency logging framework for Cognitron05
 * Replaces console.log/console.error with proper structured logging
 * 
 * Features:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR, FATAL)
 * - Environment-based configuration
 * - Contextual logging with session IDs and operation tracing
 * - JSON and human-readable formatting
 * - File output support
 * - Performance optimized with minimal overhead
 * - Memory system integration
 */

import path from 'path';
import { createSecureOpsForDirectory } from '../security/SecureFileOpsMigration.js';
import { LOGGING_CONSTANTS } from '../config/SystemConstants.js';

export class StructuredLogger {
  constructor(config = {}) {
    this.config = {
      // Log levels
      level: config.level || process.env.LOG_LEVEL || 'INFO',
      
      // Output configuration
      console: config.console !== false,
      file: config.file || process.env.LOG_FILE || null,
      json: config.json || process.env.LOG_FORMAT === 'json' || false,
      
      // Context settings
      includeTimestamp: config.includeTimestamp !== false,
      includeLevel: config.includeLevel !== false,
      includeLocation: config.includeLocation === true,
      includeSessionId: config.includeSessionId !== false,
      
      // Performance settings
      bufferSize: config.bufferSize || LOGGING_CONSTANTS.BUFFER_SIZE,
      flushInterval: config.flushInterval || LOGGING_CONSTANTS.FLUSH_INTERVAL,
      
      // Advanced settings
      maxFileSize: config.maxFileSize || LOGGING_CONSTANTS.MAX_FILE_SIZE,
      maxFiles: config.maxFiles || LOGGING_CONSTANTS.MAX_FILES,
      enableColors: config.enableColors !== false && !process.env.NO_COLOR,
      
      // Application context
      component: config.component || 'cognitron05',
      version: config.version || '1.0.0',
      environment: config.environment || process.env.NODE_ENV || 'development',
      
      ...config
    };

    // Log levels with numeric values
    this.levels = {
      DEBUG: { value: 0, name: 'DEBUG', color: '\x1b[36m' }, // Cyan
      INFO:  { value: 1, name: 'INFO',  color: '\x1b[32m' }, // Green
      WARN:  { value: 2, name: 'WARN',  color: '\x1b[33m' }, // Yellow
      ERROR: { value: 3, name: 'ERROR', color: '\x1b[31m' }, // Red
      FATAL: { value: 4, name: 'FATAL', color: '\x1b[35m' }  // Magenta
    };

    // Current log level threshold
    this.currentLevel = this.levels[this.config.level.toUpperCase()] || this.levels.INFO;

    // Context tracking
    this.globalContext = {};
    this.sessionId = null;
    this.operationStack = [];

    // Performance tracking
    this.stats = {
      totalLogs: 0,
      logsByLevel: Object.keys(this.levels).reduce((acc, level) => ({ ...acc, [level]: 0 }), {}),
      errors: 0,
      startTime: Date.now()
    };

    // File output stream
    this.fileStream = null;
    this.logBuffer = [];

    // Colors for console output
    this.colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      underscore: '\x1b[4m',
      blink: '\x1b[5m',
      reverse: '\x1b[7m',
      hidden: '\x1b[8m'
    };

    // Initialize secure file operations if file output is configured
    if (this.config.file) {
      const logDir = path.dirname(this.config.file);
      this.secureOps = createSecureOpsForDirectory(logDir, {
        maxFileSize: this.config.maxFileSize,
        allowSymlinks: false,
        validateFileTypes: true,
        allowedMimeTypes: ['text/plain', 'application/json']
      });
    }

    this.initialize();
  }

  /**
   * Initialize logger with file streams and periodic flushing
   */
  async initialize() {
    try {
      // Setup file output if configured
      if (this.config.file) {
        await this.setupFileOutput();
      }

      // Setup periodic buffer flushing
      if (this.config.flushInterval > 0) {
        this.flushTimer = setInterval(() => {
          this.flushBuffer();
        }, this.config.flushInterval);
      }

      // Setup graceful shutdown
      process.on('beforeExit', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());

    } catch (error) {
      console.error('StructuredLogger initialization failed:', error.message);
    }
  }

  /**
   * Setup file output with rotation support
   */
  async setupFileOutput() {
    try {
      const logDir = path.dirname(this.config.file);
      
      // Create log directory using secure operations
      if (this.secureOps) {
        await this.secureOps.mkdir('.', { recursive: true });
      } else {
        // Fallback for when secure ops aren't initialized
        const fs = await import('fs/promises');
        await fs.mkdir(logDir, { recursive: true });
      }

      // Check if current file needs rotation
      await this.rotateLogFileIfNeeded();

      this.fileStream = createWriteStream(this.config.file, { flags: 'a' });
      
      this.fileStream.on('error', (error) => {
        console.error('Log file stream error:', error.message);
        this.stats.errors++;
      });

    } catch (error) {
      console.error('Failed to setup file output:', error.message);
      this.config.file = null; // Disable file logging
    }
  }

  /**
   * Rotate log file if it exceeds maximum size
   */
  async rotateLogFileIfNeeded() {
    try {
      const stats = await fs.stat(this.config.file).catch(() => null);
      
      if (stats && stats.size > this.config.maxFileSize) {
        // Create rotated filename with timestamp
        const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
        const rotatedFile = this.config.file.replace(/\.log$/, `-${timestamp}.log`);
        
        await fs.rename(this.config.file, rotatedFile);
        
        // Clean up old log files
        await this.cleanupOldLogFiles();
      }
    } catch (error) {
      console.error('Log rotation failed:', error.message);
    }
  }

  /**
   * Clean up old log files based on retention policy
   */
  async cleanupOldLogFiles() {
    try {
      const logDir = path.dirname(this.config.file);
      const logBasename = path.basename(this.config.file, '.log');
      const files = await fs.readdir(logDir);
      
      const logFiles = files
        .filter(file => file.startsWith(logBasename) && file.endsWith('.log'))
        .map(file => ({ name: file, path: path.join(logDir, file) }))
        .sort((a, b) => b.name.localeCompare(a.name)); // Sort newest first
      
      // Remove files beyond retention limit
      if (logFiles.length > this.config.maxFiles) {
        const filesToDelete = logFiles.slice(this.config.maxFiles);
        for (const file of filesToDelete) {
          await fs.unlink(file.path);
        }
      }
    } catch (error) {
      console.error('Log cleanup failed:', error.message);
    }
  }

  /**
   * Set global context that appears in all log entries
   */
  setGlobalContext(context) {
    this.globalContext = { ...this.globalContext, ...context };
  }

  /**
   * Set session ID for contextual logging
   */
  setSessionId(sessionId) {
    this.sessionId = sessionId;
  }

  /**
   * Start operation tracking (creates hierarchical context)
   */
  startOperation(operationName, context = {}) {
    const operation = {
      name: operationName,
      startTime: Date.now(),
      context,
      id: this.generateOperationId()
    };
    
    this.operationStack.push(operation);
    return operation.id;
  }

  /**
   * End operation tracking
   */
  endOperation(operationId, result = {}) {
    const operationIndex = this.operationStack.findIndex(op => op.id === operationId);
    
    if (operationIndex !== -1) {
      const operation = this.operationStack[operationIndex];
      const duration = Date.now() - operation.startTime;
      
      this.debug('Operation completed', {
        operation: operation.name,
        duration: `${duration}ms`,
        operationId,
        result
      });
      
      this.operationStack.splice(operationIndex, 1);
      return duration;
    }
    
    return 0;
  }

  /**
   * Generate unique operation ID
   */
  generateOperationId() {
    return `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if level should be logged
   */
  shouldLog(level) {
    const logLevel = this.levels[level.toUpperCase()];
    return logLevel && logLevel.value >= this.currentLevel.value;
  }

  /**
   * Core logging method
   */
  log(level, message, context = {}, error = null) {
    if (!this.shouldLog(level)) {
      return;
    }

    const logLevel = this.levels[level.toUpperCase()];
    const timestamp = new Date().toISOString();
    
    // Build log entry
    const logEntry = {
      timestamp: this.config.includeTimestamp ? timestamp : undefined,
      level: this.config.includeLevel ? logLevel.name : undefined,
      message,
      component: this.config.component,
      version: this.config.version,
      environment: this.config.environment,
      sessionId: this.config.includeSessionId && this.sessionId ? this.sessionId : undefined,
      context: {
        ...this.globalContext,
        ...context
      },
      operation: this.operationStack.length > 0 ? {
        current: this.operationStack[this.operationStack.length - 1].name,
        stack: this.operationStack.map(op => op.name),
        depth: this.operationStack.length
      } : undefined,
      error: error ? this.serializeError(error) : undefined,
      pid: process.pid,
      hostname: this.getHostname(),
      location: this.config.includeLocation ? this.getCallerLocation() : undefined
    };

    // Remove undefined fields for cleaner output
    Object.keys(logEntry).forEach(key => {
      if (logEntry[key] === undefined) {
        delete logEntry[key];
      }
    });

    // Update statistics
    this.stats.totalLogs++;
    this.stats.logsByLevel[logLevel.name]++;

    // Output log entry
    this.outputLog(logEntry, logLevel);
  }

  /**
   * Output log entry to configured destinations
   */
  outputLog(logEntry, logLevel) {
    // Console output
    if (this.config.console) {
      if (this.config.json) {
        console.log(JSON.stringify(logEntry));
      } else {
        this.outputHumanReadable(logEntry, logLevel);
      }
    }

    // File output
    if (this.fileStream) {
      const logLine = JSON.stringify(logEntry) + '\n';
      
      if (this.config.bufferSize > 0) {
        this.logBuffer.push(logLine);
        if (this.logBuffer.length >= this.config.bufferSize) {
          this.flushBuffer();
        }
      } else {
        this.fileStream.write(logLine);
      }
    }
  }

  /**
   * Output human-readable format to console
   */
  outputHumanReadable(logEntry, logLevel) {
    const timestamp = logEntry.timestamp ? `[${logEntry.timestamp}] ` : '';
    const level = this.config.enableColors 
      ? `${logLevel.color}${logLevel.name}${this.colors.reset}` 
      : logLevel.name;
    const session = logEntry.sessionId ? ` {${logEntry.sessionId}}` : '';
    const operation = logEntry.operation ? ` <${logEntry.operation.current}>` : '';
    
    let output = `${timestamp}${level}${session}${operation}: ${logEntry.message}`;
    
    // Add context if present
    if (logEntry.context && Object.keys(logEntry.context).length > 0) {
      if (this.config.enableColors) {
        output += ` ${this.colors.dim}${JSON.stringify(logEntry.context)}${this.colors.reset}`;
      } else {
        output += ` ${JSON.stringify(logEntry.context)}`;
      }
    }
    
    // Add error details if present
    if (logEntry.error) {
      output += `\n  Error: ${logEntry.error.message}`;
      if (logEntry.error.stack) {
        output += `\n  Stack: ${logEntry.error.stack}`;
      }
    }
    
    console.log(output);
  }

  /**
   * Serialize error object for logging
   */
  serializeError(error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
      ...(error.cause && { cause: this.serializeError(error.cause) })
    };
  }

  /**
   * Get hostname for log context
   */
  getHostname() {
    try {
      return require('os').hostname();
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get caller location for debugging
   */
  getCallerLocation() {
    try {
      const stack = new Error().stack;
      const lines = stack.split('\n');
      // Skip current function, log method, and level methods
      const callerLine = lines[4] || '';
      const match = callerLine.match(/at\s+(.+):(\d+):(\d+)/);
      if (match) {
        return {
          file: path.basename(match[1]),
          line: parseInt(match[2]),
          column: parseInt(match[3])
        };
      }
    } catch {
      // Ignore errors in location detection
    }
    return null;
  }

  /**
   * Flush buffered logs to file
   */
  flushBuffer() {
    if (this.fileStream && this.logBuffer.length > 0) {
      const bufferedLogs = this.logBuffer.join('');
      this.fileStream.write(bufferedLogs);
      this.logBuffer = [];
    }
  }

  /**
   * Shutdown logger gracefully
   */
  shutdown() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    
    this.flushBuffer();
    
    if (this.fileStream) {
      this.fileStream.end();
    }
  }

  // =============================================================================
  // LOG LEVEL METHODS
  // =============================================================================

  /**
   * Debug level logging
   */
  debug(message, context = {}, error = null) {
    this.log('DEBUG', message, context, error);
  }

  /**
   * Info level logging
   */
  info(message, context = {}, error = null) {
    this.log('INFO', message, context, error);
  }

  /**
   * Warning level logging
   */
  warn(message, context = {}, error = null) {
    this.log('WARN', message, context, error);
  }

  /**
   * Error level logging
   */
  error(message, context = {}, error = null) {
    this.log('ERROR', message, context, error);
    this.stats.errors++;
  }

  /**
   * Fatal level logging
   */
  fatal(message, context = {}, error = null) {
    this.log('FATAL', message, context, error);
    this.stats.errors++;
  }

  // =============================================================================
  // COMPATIBILITY AND CONVENIENCE METHODS
  // =============================================================================

  /**
   * Memory system specific logging
   */
  memory(level, operation, message, context = {}) {
    this.log(level, message, {
      ...context,
      subsystem: 'memory',
      operation
    });
  }

  /**
   * Tool system specific logging
   */
  tool(level, toolName, message, context = {}) {
    this.log(level, message, {
      ...context,
      subsystem: 'tools',
      tool: toolName
    });
  }

  /**
   * Agent system specific logging
   */
  agent(level, action, message, context = {}) {
    this.log(level, message, {
      ...context,
      subsystem: 'agent',
      action
    });
  }

  /**
   * API interaction logging
   */
  api(level, endpoint, message, context = {}) {
    this.log(level, message, {
      ...context,
      subsystem: 'api',
      endpoint
    });
  }

  /**
   * Security event logging
   */
  security(level, event, message, context = {}) {
    this.log(level, message, {
      ...context,
      subsystem: 'security',
      event,
      critical: true
    });
  }

  /**
   * Performance metrics logging
   */
  performance(operation, duration, context = {}) {
    this.info(`Performance: ${operation}`, {
      ...context,
      subsystem: 'performance',
      operation,
      duration: `${duration}ms`,
      metrics: true
    });
  }

  // =============================================================================
  // STATISTICS AND MONITORING
  // =============================================================================

  /**
   * Get logger statistics
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    
    return {
      ...this.stats,
      uptime: `${Math.round(uptime / 1000)}s`,
      logsPerSecond: Math.round((this.stats.totalLogs / uptime) * 1000),
      errorRate: this.stats.totalLogs > 0 ? 
        ((this.stats.errors / this.stats.totalLogs) * 100).toFixed(2) + '%' : '0%',
      config: {
        level: this.config.level,
        console: this.config.console,
        file: !!this.config.file,
        json: this.config.json
      }
    };
  }

  /**
   * Create child logger with additional context
   */
  child(context = {}) {
    const childLogger = new StructuredLogger({
      ...this.config,
      // Don't reinitialize file streams
      skipInitialization: true
    });
    
    // Share resources with parent
    childLogger.fileStream = this.fileStream;
    childLogger.sessionId = this.sessionId;
    childLogger.setGlobalContext({
      ...this.globalContext,
      ...context
    });
    
    return childLogger;
  }

  /**
   * Set log level dynamically
   */
  setLevel(level) {
    const logLevel = this.levels[level.toUpperCase()];
    if (logLevel) {
      this.currentLevel = logLevel;
      this.config.level = level.toUpperCase();
      this.info('Log level changed', { newLevel: level });
    } else {
      this.error('Invalid log level', { requestedLevel: level, availableLevels: Object.keys(this.levels) });
    }
  }

  /**
   * Test logger with sample messages
   */
  test() {
    this.debug('Debug message for development troubleshooting');
    this.info('System startup completed successfully');
    this.warn('Configuration value using default', { setting: 'timeout', default: 30000 });
    this.error('Failed to connect to external service', { service: 'api.example.com' });
    this.fatal('Critical system failure detected', { component: 'memory-system' }, new Error('Out of memory'));
    
    this.info('Logger test completed', { stats: this.getStats() });
  }
}

/**
 * Global logger instance for application-wide use
 */
let globalLogger = null;

/**
 * Initialize global logger
 */
export function initializeLogger(config = {}) {
  globalLogger = new StructuredLogger(config);
  return globalLogger;
}

/**
 * Get global logger instance
 */
export function getLogger() {
  if (!globalLogger) {
    globalLogger = new StructuredLogger();
  }
  return globalLogger;
}

/**
 * Convenience methods for global logger
 */
export const debug = (message, context, error) => getLogger().debug(message, context, error);
export const info = (message, context, error) => getLogger().info(message, context, error);
export const warn = (message, context, error) => getLogger().warn(message, context, error);
export const error = (message, context, error) => getLogger().error(message, context, error);
export const fatal = (message, context, error) => getLogger().fatal(message, context, error);

export default StructuredLogger;