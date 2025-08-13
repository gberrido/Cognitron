#!/usr/bin/env node

/**
 * Logging Configuration for Cognitron05
 * Centralized logging setup with environment-based configuration
 */

import path from 'path';
import { initializeLogger } from '../utils/StructuredLogger.js';

/**
 * Initialize application-wide structured logging
 */
export function initializeApplicationLogging(config = {}) {
  // Environment-based configuration
  const environment = process.env.NODE_ENV || 'development';
  const logLevel = process.env.LOG_LEVEL || 
    (environment === 'development' ? 'DEBUG' : 
     environment === 'production' ? 'INFO' : 'WARN');
  
  const logDir = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
  const enableFileLogging = process.env.LOG_FILE !== 'false';
  const logFormat = process.env.LOG_FORMAT || 'human';
  
  // Application-specific defaults
  const loggingConfig = {
    // Log levels
    level: config.level || logLevel,
    
    // Output configuration
    console: config.console !== false,
    file: enableFileLogging ? (config.file || path.join(logDir, 'cognitron05.log')) : null,
    json: config.json || logFormat === 'json',
    
    // Context settings
    includeTimestamp: config.includeTimestamp !== false,
    includeLevel: config.includeLevel !== false,
    includeLocation: config.includeLocation || environment === 'development',
    includeSessionId: config.includeSessionId !== false,
    
    // Performance settings
    bufferSize: config.bufferSize || (environment === 'production' ? 100 : 10),
    flushInterval: config.flushInterval || 5000,
    
    // File management
    maxFileSize: config.maxFileSize || 10 * 1024 * 1024, // 10MB
    maxFiles: config.maxFiles || 10,
    
    // Colors (disable in production or when NO_COLOR is set)
    enableColors: config.enableColors !== false && 
                  environment !== 'production' && 
                  !process.env.NO_COLOR,
    
    // Application context
    component: config.component || 'cognitron05',
    version: config.version || '1.0.0',
    environment,
    
    ...config
  };
  
  const logger = initializeLogger(loggingConfig);
  
  // Log initialization
  logger.info('Application logging initialized', {
    level: loggingConfig.level,
    environment,
    fileLogging: !!loggingConfig.file,
    jsonFormat: loggingConfig.json,
    subsystem: 'logging',
    startup: true
  });
  
  // Setup process-level error handling
  setupProcessErrorHandling(logger);
  
  return logger;
}

/**
 * Setup process-level error handling with structured logging
 */
function setupProcessErrorHandling(logger) {
  // Uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.fatal('Uncaught exception - process will exit', {
      subsystem: 'process',
      errorType: 'uncaughtException',
      critical: true
    }, error);
    
    // Give logger time to flush before exit
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });
  
  // Unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled promise rejection', {
      subsystem: 'process',
      errorType: 'unhandledRejection',
      promise: promise.toString(),
      critical: true
    }, reason instanceof Error ? reason : new Error(String(reason)));
  });
  
  // Warning events
  process.on('warning', (warning) => {
    logger.warn('Node.js process warning', {
      subsystem: 'process',
      warningName: warning.name,
      warningCode: warning.code
    }, warning);
  });
  
  // Graceful shutdown signals
  const shutdownSignals = ['SIGINT', 'SIGTERM'];
  
  shutdownSignals.forEach((signal) => {
    process.on(signal, () => {
      logger.info('Graceful shutdown initiated', {
        subsystem: 'process',
        signal,
        shutdown: true
      });
      
      // Flush logs before exit
      logger.shutdown();
      process.exit(0);
    });
  });
}

/**
 * Get environment-specific logging configuration
 */
export function getEnvironmentLoggingConfig() {
  const environment = process.env.NODE_ENV || 'development';
  
  const configs = {
    development: {
      level: 'DEBUG',
      console: true,
      json: false,
      enableColors: true,
      includeLocation: true,
      bufferSize: 1, // Immediate flushing for development
      flushInterval: 1000
    },
    
    test: {
      level: 'WARN',
      console: false,
      file: null, // No file logging in tests
      json: true,
      enableColors: false,
      bufferSize: 0,
      flushInterval: 0
    },
    
    production: {
      level: 'INFO',
      console: false,
      json: true,
      enableColors: false,
      includeLocation: false,
      bufferSize: 200,
      flushInterval: 10000,
      maxFileSize: 50 * 1024 * 1024, // 50MB
      maxFiles: 20
    }
  };
  
  return configs[environment] || configs.development;
}

/**
 * Configure logger for specific subsystems
 */
export function getSubsystemLogger(subsystem, additionalConfig = {}) {
  const logger = initializeLogger({
    ...getEnvironmentLoggingConfig(),
    component: `cognitron05-${subsystem}`,
    ...additionalConfig
  });
  
  return logger.child({ subsystem });
}

export default {
  initializeApplicationLogging,
  getEnvironmentLoggingConfig,
  getSubsystemLogger
};