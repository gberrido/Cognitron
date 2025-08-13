#!/usr/bin/env node

/**
 * ApplicationBootstrap - Main application bootstrap and lifecycle management
 * Implements clean startup, shutdown, and component coordination
 * 
 * Provides a clean separation between:
 * - Application configuration and setup
 * - Component initialization and wiring
 * - Runtime coordination
 * - Graceful shutdown handling
 */

import { ApplicationContainer } from './ApplicationContainer.js';
import { getLogger } from '../utils/StructuredLogger.js';
import { APPLICATION_CONSTANTS } from '../config/SystemConstants.js';

export class ApplicationBootstrap {
  constructor(options = {}) {
    this.options = {
      environment: process.env.NODE_ENV || 'development',
      logLevel: process.env.LOG_LEVEL || 'INFO',
      dataDir: options.dataDir || './cognitron05-data',
      enableMetrics: options.enableMetrics !== false,
      gracefulShutdownTimeout: options.gracefulShutdownTimeout || 30000,
      ...options
    };
    
    // Core components
    this.container = null;
    this.logger = null;
    this.shutdownInProgress = false;
    this.startupTime = null;
    
    // Runtime state
    this.isRunning = false;
    this.components = {};
  }

  /**
   * Bootstrap the application
   * @returns {Object} Initialized application context
   */
  async bootstrap() {
    try {
      this.startupTime = Date.now();
      
      // Create and initialize container
      this.container = new ApplicationContainer({
        environment: this.options.environment,
        logLevel: this.options.logLevel,
        enableMetrics: this.options.enableMetrics
      });
      
      this.logger = getLogger();
      
      this.logger.info('Application bootstrap starting', {
        subsystem: 'bootstrap',
        environment: this.options.environment,
        dataDir: this.options.dataDir,
        operation: 'bootstrap_start'
      });
      
      // Initialize core application container
      await this.container.initialize();
      
      // Get main application components
      this.components = {
        memorySystem: await this.container.get('memory.system'),
        toolManager: await this.container.get('tools.manager'),
        chatAgent: await this.container.get('agent.chat'),
        responseProcessor: await this.container.get('ui.processor'),
        commandRegistry: await this.container.get('command.registry'),
        configManager: await this.container.get('config.manager'),
        errorBoundary: await this.container.get('error.boundary'),
        memoryMonitor: await this.container.get('monitoring.memory'),
        healthMonitor: await this.container.get('monitoring.health'),
        performanceMonitor: await this.container.get('monitoring.performance'),
        alertingSystem: await this.container.get('monitoring.alerts')
      };
      
      // Initialize components that need async setup
      await this.initializeAsyncComponents();
      
      // Setup graceful shutdown handlers
      this.setupShutdownHandlers();
      
      const bootTime = Date.now() - this.startupTime;
      
      this.logger.info('Application bootstrap completed', {
        subsystem: 'bootstrap',
        bootTime,
        componentCount: Object.keys(this.components).length,
        operation: 'bootstrap_complete'
      });
      
      this.isRunning = true;
      
      return this.createApplicationContext();
      
    } catch (error) {
      this.logger?.error('Application bootstrap failed', {
        subsystem: 'bootstrap',
        operation: 'bootstrap_error'
      }, error);
      
      console.error('❌ Failed to bootstrap application:', error.message);
      throw error;
    }
  }

  /**
   * Initialize components that require async setup
   */
  async initializeAsyncComponents() {
    const asyncComponents = [
      { name: 'memorySystem', component: this.components.memorySystem },
      { name: 'chatAgent', component: this.components.chatAgent }
    ];
    
    for (const { name, component } of asyncComponents) {
      if (component && typeof component.initialize === 'function') {
        this.logger.debug('Initializing async component', {
          subsystem: 'bootstrap',
          component: name
        });
        
        await component.initialize();
        
        this.logger.debug('Async component initialized', {
          subsystem: 'bootstrap',
          component: name
        });
      }
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupShutdownHandlers() {
    const shutdownSignals = ['SIGINT', 'SIGTERM', 'SIGUSR2'];
    
    shutdownSignals.forEach(signal => {
      process.on(signal, () => {
        this.logger.info('Shutdown signal received', {
          subsystem: 'bootstrap',
          signal,
          operation: 'shutdown_signal'
        });
        
        this.shutdown().catch(error => {
          console.error('Error during shutdown:', error.message);
          process.exit(1);
        });
      });
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.fatal('Uncaught exception - initiating emergency shutdown', {
        subsystem: 'bootstrap',
        operation: 'emergency_shutdown'
      }, error);
      
      // Emergency shutdown
      this.emergencyShutdown();
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled promise rejection', {
        subsystem: 'bootstrap',
        promise: promise.toString(),
        operation: 'unhandled_rejection'
      }, reason instanceof Error ? reason : new Error(String(reason)));
    });
  }

  /**
   * Create application context for consumers
   * @returns {Object} Application context
   */
  createApplicationContext() {
    return {
      // Core components
      memorySystem: this.components.memorySystem,
      toolManager: this.components.toolManager, 
      chatAgent: this.components.chatAgent,
      responseProcessor: this.components.responseProcessor,
      commandRegistry: this.components.commandRegistry,
      configManager: this.components.configManager,
      errorBoundary: this.components.errorBoundary,
      
      // Monitoring and diagnostic tools
      memoryMonitor: this.components.memoryMonitor,
      healthMonitor: this.components.healthMonitor,
      performanceMonitor: this.components.performanceMonitor,
      alertingSystem: this.components.alertingSystem,
      
      // Container access for advanced usage
      container: this.container,
      
      // Lifecycle methods
      shutdown: this.shutdown.bind(this),
      isRunning: () => this.isRunning,
      
      // Metrics and monitoring
      getStats: this.getStats.bind(this),
      getUptime: () => this.startupTime ? Date.now() - this.startupTime : 0,
      
      // Component helpers
      get: async (componentKey) => await this.container.get(componentKey),
      register: (key, component) => this.container.registerSingleton(key, component)
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.shutdownInProgress) {
      return;
    }
    
    this.shutdownInProgress = true;
    this.isRunning = false;
    
    this.logger.info('Application shutdown initiated', {
      subsystem: 'bootstrap',
      uptime: this.getUptime(),
      operation: 'shutdown_start'
    });
    
    const shutdownStart = Date.now();
    
    try {
      // Create shutdown timeout
      const shutdownPromise = this.performShutdown();
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Shutdown timeout')), this.options.gracefulShutdownTimeout);
      });
      
      // Race between shutdown completion and timeout
      await Promise.race([shutdownPromise, timeoutPromise]);
      
      const shutdownTime = Date.now() - shutdownStart;
      
      this.logger.info('Application shutdown completed', {
        subsystem: 'bootstrap',
        shutdownTime,
        operation: 'shutdown_complete'
      });
      
    } catch (error) {
      this.logger.error('Error during graceful shutdown', {
        subsystem: 'bootstrap',
        operation: 'shutdown_error'
      }, error);
      
      console.error('❌ Error during shutdown, forcing exit');
      this.emergencyShutdown();
    }
  }

  /**
   * Perform actual shutdown operations
   */
  async performShutdown() {
    // Shutdown application components in reverse dependency order
    const shutdownOrder = [
      'responseProcessor',
      'chatAgent', 
      'toolManager',
      'memorySystem',
      'configManager',
      'errorBoundary',
      'memoryMonitor',
      'healthMonitor',
      'performanceMonitor',
      'alertingSystem'
    ];
    
    for (const componentName of shutdownOrder) {
      const component = this.components[componentName];
      
      if (component && typeof component.cleanup === 'function') {
        try {
          this.logger.debug('Shutting down component', {
            subsystem: 'bootstrap',
            component: componentName
          });
          
          await component.cleanup();
          
          this.logger.debug('Component shutdown completed', {
            subsystem: 'bootstrap',
            component: componentName
          });
          
        } catch (error) {
          this.logger.error('Error shutting down component', {
            subsystem: 'bootstrap',
            component: componentName
          }, error);
        }
      }
    }
    
    // Shutdown container
    if (this.container) {
      await this.container.shutdown();
    }
  }

  /**
   * Emergency shutdown for critical errors
   */
  emergencyShutdown() {
    console.error('Emergency shutdown initiated');
    
    // Try to flush logs
    try {
      if (this.logger && typeof this.logger.flushBuffer === 'function') {
        this.logger.flushBuffer();
      }
    } catch (e) {
      // Ignore logging errors during emergency shutdown
    }
    
    // Force exit after brief delay
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }

  /**
   * Get application statistics
   */
  getStats() {
    return {
      isRunning: this.isRunning,
      uptime: this.getUptime(),
      startupTime: this.startupTime,
      environment: this.options.environment,
      dataDir: this.options.dataDir,
      componentCount: Object.keys(this.components).length,
      containerStats: this.container ? this.container.getStats() : null,
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      version: APPLICATION_CONSTANTS.VERSION || '1.0.0'
    };
  }

  /**
   * Get application uptime in milliseconds
   */
  getUptime() {
    return this.startupTime ? Date.now() - this.startupTime : 0;
  }

  /**
   * Check if application is healthy
   */
  async healthCheck() {
    if (!this.isRunning) {
      return { healthy: false, reason: 'Application not running' };
    }
    
    try {
      // Check core components
      const componentChecks = await Promise.all([
        this.checkComponent('memorySystem'),
        this.checkComponent('chatAgent'),
        this.checkComponent('toolManager')
      ]);
      
      const failedChecks = componentChecks.filter(check => !check.healthy);
      
      if (failedChecks.length > 0) {
        return {
          healthy: false,
          reason: 'Component health checks failed',
          failedComponents: failedChecks.map(check => check.component)
        };
      }
      
      return {
        healthy: true,
        uptime: this.getUptime(),
        componentCount: Object.keys(this.components).length
      };
      
    } catch (error) {
      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`
      };
    }
  }

  /**
   * Check individual component health
   */
  async checkComponent(componentName) {
    const component = this.components[componentName];
    
    if (!component) {
      return { healthy: false, component: componentName, reason: 'Component not found' };
    }
    
    // Check if component has health check method
    if (typeof component.healthCheck === 'function') {
      try {
        const result = await component.healthCheck();
        return { healthy: result.healthy !== false, component: componentName, ...result };
      } catch (error) {
        return { healthy: false, component: componentName, reason: error.message };
      }
    }
    
    // Basic presence check
    return { healthy: true, component: componentName };
  }
}

export default ApplicationBootstrap;