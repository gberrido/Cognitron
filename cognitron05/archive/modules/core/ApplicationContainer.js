#!/usr/bin/env node

/**
 * ApplicationContainer - Central dependency injection container for Cognitron05
 * Manages component lifecycle and dependencies following modular architecture patterns
 * 
 * Based on cognitron04 patterns for clean separation of concerns:
 * - Memory layer
 * - Tools layer  
 * - Agent layer
 * - UI layer
 */

import { initializeApplicationLogging } from '../config/LoggingConfig.js';
import { getLogger } from '../utils/StructuredLogger.js';

export class ApplicationContainer {
  constructor(config = {}) {
    this.config = {
      environment: process.env.NODE_ENV || 'development',
      logLevel: process.env.LOG_LEVEL || 'INFO',
      enableMetrics: config.enableMetrics !== false,
      ...config
    };
    
    // Component registry
    this.components = new Map();
    this.singletons = new Map();
    this.factories = new Map();
    
    // Lifecycle tracking
    this.initialized = false;
    this.initializing = false;
    this.shutdownCallbacks = new Set();
    
    // Logger initialization
    this.logger = null;
    
    this.initializeContainer();
  }

  /**
   * Initialize the container with logging
   */
  initializeContainer() {
    try {
      this.logger = initializeApplicationLogging({
        level: this.config.logLevel,
        component: 'application-container',
        environment: this.config.environment
      });
      
      this.logger.info('Application container initializing', {
        subsystem: 'core',
        environment: this.config.environment,
        enableMetrics: this.config.enableMetrics
      });
      
      // Register default component factories
      this.registerDefaultFactories();
      
    } catch (error) {
      console.error('Failed to initialize application container:', error.message);
      throw error;
    }
  }

  /**
   * Register default component factories
   */
  registerDefaultFactories() {
    // Memory Layer Components
    this.registerFactory('memory.system', () => this.createMemorySystem());
    this.registerFactory('memory.persistence', () => this.createMemoryPersistence());
    
    // Tools Layer Components  
    this.registerFactory('tools.manager', () => this.createToolManager());
    this.registerFactory('tools.registry', () => this.createToolRegistry());
    
    // Agent Layer Components
    this.registerFactory('agent.chat', () => this.createChatAgent());
    this.registerFactory('agent.context', () => this.createContextBuilder());
    this.registerFactory('agent.response', () => this.createResponseGenerator());
    
    // UI Layer Components
    this.registerFactory('ui.processor', () => this.createResponseProcessor());
    this.registerFactory('ui.interface', () => this.createUserInterface());
    
    // Core Infrastructure
    this.registerFactory('config.manager', () => this.createConfigurationManager());
    this.registerFactory('error.boundary', () => this.createErrorBoundary());
    this.registerFactory('command.registry', () => this.createCommandRegistry());
    this.registerFactory('monitoring.memory', () => this.createMemoryMonitor());
    this.registerFactory('monitoring.health', () => this.createHealthMonitor());
    this.registerFactory('monitoring.performance', () => this.createPerformanceMonitor());
    this.registerFactory('monitoring.alerts', () => this.createAlertingSystem());
    
    // Authentication & Authorization Layer
    this.registerFactory('auth.integration', () => this.createAuthIntegration());
    this.registerFactory('auth.manager', () => this.createAuthenticationManager());
    this.registerFactory('auth.authorization', () => this.createAuthorizationManager());
    this.registerFactory('auth.security', () => this.createSecurityMiddleware());
    
    // Encryption Layer
    this.registerFactory('encryption.manager', () => this.createEncryptionManager());
    this.registerFactory('encryption.storage', () => this.createEncryptedStorageAdapter());
    
    this.logger.debug('Default component factories registered', {
      subsystem: 'core',
      factoryCount: this.factories.size
    });
  }

  /**
   * Register a component factory
   * @param {string} key - Component key
   * @param {Function} factory - Factory function
   * @param {Object} options - Registration options
   */
  registerFactory(key, factory, options = {}) {
    if (typeof factory !== 'function') {
      throw new Error(`Factory for '${key}' must be a function`);
    }
    
    this.factories.set(key, {
      factory,
      singleton: options.singleton !== false,
      dependencies: options.dependencies || [],
      initialized: false
    });
    
    this.logger.debug('Component factory registered', {
      subsystem: 'core',
      component: key,
      singleton: options.singleton !== false,
      dependencies: options.dependencies || []
    });
  }

  /**
   * Register a singleton component instance
   * @param {string} key - Component key
   * @param {*} instance - Component instance
   */
  registerSingleton(key, instance) {
    this.singletons.set(key, instance);
    
    // Register shutdown callback if component has cleanup method
    if (instance && typeof instance.cleanup === 'function') {
      this.onShutdown(async () => {
        try {
          await instance.cleanup();
        } catch (error) {
          this.logger.error('Error during component cleanup', {
            subsystem: 'core',
            component: key
          }, error);
        }
      });
    }
    
    this.logger.debug('Singleton component registered', {
      subsystem: 'core',
      component: key,
      hasCleanup: typeof instance.cleanup === 'function'
    });
  }

  /**
   * Get or create a component
   * @param {string} key - Component key
   * @returns {*} Component instance
   */
  async get(key) {
    // Check singletons first
    if (this.singletons.has(key)) {
      return this.singletons.get(key);
    }
    
    // Check factories
    const factoryConfig = this.factories.get(key);
    if (!factoryConfig) {
      throw new Error(`Component '${key}' not registered`);
    }
    
    // For singletons, create once and cache
    if (factoryConfig.singleton) {
      if (!this.singletons.has(key)) {
        const instance = await this.createComponent(key, factoryConfig);
        this.registerSingleton(key, instance);
      }
      return this.singletons.get(key);
    }
    
    // For non-singletons, create new instance
    return await this.createComponent(key, factoryConfig);
  }

  /**
   * Create a component instance
   * @param {string} key - Component key
   * @param {Object} factoryConfig - Factory configuration
   * @returns {*} Component instance
   */
  async createComponent(key, factoryConfig) {
    try {
      this.logger.debug('Creating component', {
        subsystem: 'core',
        component: key,
        dependencies: factoryConfig.dependencies
      });
      
      // Resolve dependencies
      const dependencies = factoryConfig.dependencies.map(dep => this.get(dep));
      
      // Create instance - handle async factories
      let instance = factoryConfig.factory(...dependencies);
      
      // If factory returns a promise, await it
      if (instance && typeof instance.then === 'function') {
        instance = await instance;
      }
      
      this.logger.debug('Component created successfully', {
        subsystem: 'core',
        component: key,
        hasInstance: !!instance
      });
      
      return instance;
      
    } catch (error) {
      this.logger.error('Failed to create component', {
        subsystem: 'core',
        component: key,
        dependencies: factoryConfig.dependencies
      }, error);
      throw error;
    }
  }

  /**
   * Initialize the application with all core components
   */
  async initialize() {
    if (this.initialized || this.initializing) {
      return;
    }
    
    this.initializing = true;
    
    try {
      this.logger.info('Initializing application components', {
        subsystem: 'core',
        operation: 'application_startup'
      });
      
      // Initialize core components in dependency order
      const coreComponents = [
        'config.manager',
        'error.boundary',
        'encryption.manager',
        'encryption.storage',
        'monitoring.memory',
        'monitoring.health',
        'monitoring.performance',
        'monitoring.alerts', 
        'memory.system',
        'tools.manager',
        'agent.chat',
        'ui.processor',
        'command.registry'
      ];
      
      for (const componentKey of coreComponents) {
        const component = await this.get(componentKey);
        
        // Initialize component if it has an initialize method
        if (component && typeof component.initialize === 'function') {
          await component.initialize();
        }
      }
      
      this.initialized = true;
      this.initializing = false;
      
      this.logger.info('Application components initialized successfully', {
        subsystem: 'core',
        componentCount: this.singletons.size,
        operation: 'application_startup'
      });
      
    } catch (error) {
      this.initializing = false;
      this.logger.error('Failed to initialize application components', {
        subsystem: 'core',
        operation: 'application_startup'
      }, error);
      throw error;
    }
  }

  /**
   * Register shutdown callback
   * @param {Function} callback - Shutdown callback
   */
  onShutdown(callback) {
    this.shutdownCallbacks.add(callback);
  }

  /**
   * Shutdown the application container
   */
  async shutdown() {
    if (!this.initialized) {
      return;
    }
    
    this.logger.info('Shutting down application container', {
      subsystem: 'core',
      operation: 'application_shutdown',
      shutdownCallbacks: this.shutdownCallbacks.size
    });
    
    // Execute shutdown callbacks in reverse order
    const callbacks = Array.from(this.shutdownCallbacks).reverse();
    
    for (const callback of callbacks) {
      try {
        await callback();
      } catch (error) {
        this.logger.error('Error in shutdown callback', {
          subsystem: 'core',
          operation: 'application_shutdown'
        }, error);
      }
    }
    
    // Clear component registry
    this.singletons.clear();
    this.shutdownCallbacks.clear();
    this.initialized = false;
    
    // Shutdown logger last
    if (this.logger && typeof this.logger.shutdown === 'function') {
      this.logger.shutdown();
    }
  }

  // Factory methods for creating components
  // These will be implemented to create actual component instances
  
  async createMemorySystem() {
    const { MemGPTMemorySystemAdapter } = await import('../memory/MemGPTMemorySystemAdapter.js');
    const encryptedStorage = await this.get('encryption.storage');
    
    return new MemGPTMemorySystemAdapter({
      enabled: true,
      dataDir: './cognitron05-data',
      encryptedStorage: encryptedStorage
    });
  }

  async createMemoryPersistence() {
    // Future: Create dedicated persistence layer
    return null;
  }

  async createToolManager() {
    const { PluginManager } = await import('../plugins/PluginManager.js');
    return new PluginManager({
      pluginDir: './plugins',
      enableSandboxing: false, // Disable for now, can be enabled later
      enableAutoLoad: true,
      enableSecurity: false // Basic security for now
    });
  }

  async createToolRegistry() {
    // Get the plugin manager which contains the registry
    const pluginManager = await this.get('tools.manager');
    return pluginManager.registry;
  }

  async createChatAgent() {
    const { ChatAgent } = await import('../agent/ChatAgent.js');
    const configManager = await this.get('config.manager');
    const memorySystem = await this.get('memory.system');
    const toolManager = await this.get('tools.manager');
    const memoryMonitor = await this.get('monitoring.memory');
    const healthMonitor = await this.get('monitoring.health');
    const alertingSystem = await this.get('monitoring.alerts');
    
    // Get default chat agent configuration
    const config = {
      apiKey: process.env.GROQ_API_KEY || 'test-api-key', // Allow test key for testing
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      maxTokens: 4096,
      reasoningLevel: 'medium'
    };
    
    const chatAgent = new ChatAgent(config, memorySystem, toolManager);
    
    // Register components with memory monitor
    memoryMonitor.registerComponent('memory.system', memorySystem);
    memoryMonitor.registerComponent('tools.manager', toolManager);
    memoryMonitor.registerComponent('chat.agent', chatAgent);
    
    // Register components with health monitor
    healthMonitor.registerComponent('memory.system', memorySystem, {
      dependencies: [],
      critical: true
    });
    healthMonitor.registerComponent('tools.manager', toolManager, {
      dependencies: ['memory.system'],
      critical: true
    });
    healthMonitor.registerComponent('chat.agent', chatAgent, {
      dependencies: ['memory.system', 'tools.manager'],
      critical: false
    });
    
    // Get performance monitor and integrate with alerting system
    const performanceMonitor = await this.get('monitoring.performance');
    
    // Integrate alerting system with all monitors
    alertingSystem.integrateWithMonitor('memory', memoryMonitor);
    alertingSystem.integrateWithMonitor('health', healthMonitor);
    alertingSystem.integrateWithMonitor('performance', performanceMonitor);
    
    return chatAgent;
  }

  async createContextBuilder() {
    const { ConversationContextBuilder } = await import('../agent/ConversationContextBuilder.js');
    const memorySystem = await this.get('memory.system');
    return new ConversationContextBuilder(memorySystem);
  }

  async createResponseGenerator() {
    const { ResponseGenerator } = await import('../agent/ResponseGenerator.js');
    return new ResponseGenerator();
  }

  async createResponseProcessor() {
    const { ResponseProcessor } = await import('../agent/ResponseProcessor.js');
    return new ResponseProcessor({
      showMemoryOperations: true,
      showMemoryStatus: true,
      colors: true
    });
  }

  async createUserInterface() {
    // Future: Create dedicated UI interface
    return null;
  }

  async createConfigurationManager() {
    const { ConfigurationManager } = await import('../config/ConfigurationManager.js');
    const encryptedStorage = await this.get('encryption.storage');
    
    return new ConfigurationManager({
      encryptedStorage: encryptedStorage
    });
  }

  async createErrorBoundary() {
    const { ErrorBoundary } = await import('../utils/ErrorBoundary.js');
    return new ErrorBoundary({
      enableLogging: true,
      logFile: 'cognitron05-errors.log',
      maxRetries: 3,
      retryDelay: 1000,
      gracefulShutdown: true
    });
  }

  async createCommandRegistry() {
    const { createCommandRegistry } = await import('../commands/index.js');
    return createCommandRegistry();
  }

  async createMemoryMonitor() {
    const { MemoryMonitor } = await import('../monitoring/MemoryMonitor.js');
    return new MemoryMonitor({
      samplingInterval: 60000,       // 1 minute
      profileInterval: 300000,       // 5 minutes  
      reportInterval: 900000,        // 15 minutes
      heapWarningThreshold: 150,     // 150MB
      heapCriticalThreshold: 300,    // 300MB
      rssWarningThreshold: 400,      // 400MB
      rssCriticalThreshold: 800,     // 800MB
      enableAutoGC: true,
      enableLeakDetection: true,
      leakDetectionSamples: 10,
      leakThresholdMB: 50
    });
  }

  async createHealthMonitor() {
    const { HealthMonitor } = await import('../monitoring/HealthMonitor.js');
    return new HealthMonitor({
      healthCheckInterval: 60000,      // 1 minute
      detailedCheckInterval: 300000,   // 5 minutes
      statusUpdateInterval: 10000,     // 10 seconds
      diskSpaceWarningThreshold: 5,    // 5GB
      diskSpaceCriticalThreshold: 1,   // 1GB
      maxMemoryUsage: 512,             // 512MB
      apiTimeoutThreshold: 10000,      // 10 seconds
      dataDirectory: './cognitron05-data'
    });
  }

  async createPerformanceMonitor() {
    const { PerformanceMonitor } = await import('../monitoring/PerformanceMonitor.js');
    return new PerformanceMonitor({
      metricsCollectionInterval: 30000,    // 30 seconds
      performanceAnalysisInterval: 120000, // 2 minutes
      baselineUpdateInterval: 300000,      // 5 minutes
      apiResponseTimeWarning: 2000,        // 2 seconds
      apiResponseTimeCritical: 5000,       // 5 seconds
      memoryGrowthRateWarning: 10,         // 10MB/minute
      memoryGrowthRateCritical: 25,        // 25MB/minute
      operationLatencyWarning: 1000,       // 1 second
      operationLatencyCritical: 3000,      // 3 seconds
      baselineWindow: 100,                 // 100 samples
      baselineDeviationThreshold: 2.0      // 2 standard deviations
    });
  }

  async createAlertingSystem() {
    const { AlertingSystem } = await import('../monitoring/AlertingSystem.js');
    return new AlertingSystem({
      enableConsoleAlerts: true,
      enableFileAlerts: true,
      enableWebhookAlerts: false,
      enableEmailAlerts: false,
      alertsLogFile: './cognitron05-data/alerts.log',
      maxAlertLogSize: 10 * 1024 * 1024, // 10MB
      maxAlertsPerMinute: 10,
      enableRateLimiting: true,
      enableDeduplication: true,
      deduplicationWindow: 300000, // 5 minutes
      enableAutoResolution: true,
      autoResolutionTimeout: 600000, // 10 minutes
      memoryPressureCritical: 400, // 400MB
      memoryPressureWarning: 200,  // 200MB
      diskSpaceCritical: 1,        // 1GB
      diskSpaceWarning: 5,         // 5GB
      apiErrorRateCritical: 0.1,   // 10%
      apiErrorRateWarning: 0.05    // 5%
    });
  }

  /**
   * Create authentication integration component
   */
  async createAuthIntegration() {
    const { AuthIntegration } = await import('../auth/AuthIntegration.js');
    return new AuthIntegration({
      enableAuth: this.config.enableAuth !== false,
      defaultMode: this.config.environment,
      enableCLIAuth: true,
      autoCreateUser: this.config.environment === 'development',
      defaultUsername: this.config.defaultUsername || process.env.USER || 'cognitron_user',
      persistSessions: true,
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
      userContextInMemory: true,
      separateUserMemories: this.config.separateUserMemories || false
    });
  }

  /**
   * Create authentication manager component
   */
  async createAuthenticationManager() {
    const { AuthenticationManager } = await import('../auth/AuthenticationManager.js');
    const encryptedStorage = await this.get('encryption.storage');
    
    return new AuthenticationManager({
      jwtSecret: process.env.COGNITRON_JWT_SECRET,
      sessionTimeout: 24 * 60 * 60 * 1000, // 24 hours
      refreshTokenTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days
      minPasswordLength: 12,
      requireSpecialChars: true,
      requireNumbers: true,
      requireUppercase: true,
      requireLowercase: true,
      maxLoginAttempts: 5,
      lockoutDuration: 15 * 60 * 1000, // 15 minutes
      enableMFA: false, // Disabled by default for CLI
      dataDir: './cognitron05-data/auth',
      encryptedStorage: encryptedStorage
    });
  }

  /**
   * Create authorization manager component
   */
  async createAuthorizationManager() {
    const { AuthorizationManager } = await import('../auth/AuthorizationManager.js');
    const encryptedStorage = await this.get('encryption.storage');
    
    return new AuthorizationManager({
      enableInheritance: true,
      enableCache: true,
      cacheTimeout: 5 * 60 * 1000, // 5 minutes
      auditDecisions: true,
      maxAuditEntries: 10000,
      dataDir: './cognitron05-data/auth',
      encryptedStorage: encryptedStorage
    });
  }

  /**
   * Create security middleware component
   */
  async createSecurityMiddleware() {
    const { SecurityMiddleware } = await import('../auth/SecurityMiddleware.js');
    return new SecurityMiddleware({
      requireAuth: this.config.enableAuth !== false,
      allowAnonymous: true,
      anonymousRole: 'guest',
      enableSecurityHeaders: true,
      corsEnabled: false,
      globalRateLimit: {
        requests: 1000,
        window: 60 * 1000 // 1 minute
      },
      maxRequestSize: 10 * 1024 * 1024, // 10MB
      sanitizeInput: true,
      publicPaths: [
        '/health',
        '/auth/login',
        '/auth/register',
        '/auth/refresh'
      ]
    });
  }
  
  /**
   * Create encryption manager component
   */
  async createEncryptionManager() {
    const { EncryptionManager } = await import('../encryption/EncryptionManager.js');
    return new EncryptionManager({
      algorithm: 'aes-256-gcm',
      keyDerivation: 'pbkdf2',
      keyIterations: 100000,
      masterKeyFromEnv: true,
      enableCompression: true,
      enableKeyRotation: true,
      keyRotationInterval: 30 * 24 * 60 * 60 * 1000, // 30 days
      auditEncryption: true,
      complianceMode: true,
      dataDir: './cognitron05-data/encryption'
    });
  }
  
  /**
   * Create encrypted storage adapter component
   */
  async createEncryptedStorageAdapter() {
    const { EncryptedStorageAdapter } = await import('../encryption/EncryptedStorageAdapter.js');
    const encryptionManager = await this.get('encryption.manager');
    
    return new EncryptedStorageAdapter({
      enableEncryption: process.env.COGNITRON_ENCRYPTION_ENABLED !== 'false',
      encryptionMode: 'transparent',
      dataDir: './cognitron05-data',
      encryptedDir: './cognitron05-data/encrypted',
      backupDir: './cognitron05-data/backups',
      enableMigration: true,
      migrationBatchSize: 10,
      keepUnencryptedBackups: true,
      enableCache: true,
      cacheSize: 100,
      cacheTTL: 5 * 60 * 1000, // 5 minutes
      encryptedPatterns: [
        '*.json',
        '*.jsonl',
        'users.json',
        'sessions.json',
        '*-memory.json',
        '*-context.json',
        '*.log'
      ],
      excludePatterns: [
        '*.tmp',
        '*.cache',
        '*.lock',
        'package*.json',
        'node_modules/**'
      ],
      dataTypeConfigs: {
        'conversation-memory': {
          encrypt: true,
          compress: true,
          backup: true,
          retention: '1 year'
        },
        'user-data': {
          encrypt: true,
          compress: false,
          backup: true,
          retention: 'forever'
        },
        'session-data': {
          encrypt: true,
          compress: false,
          backup: false,
          retention: '30 days'
        },
        'configuration': {
          encrypt: true,
          compress: false,
          backup: true,
          retention: 'forever'
        },
        'logs': {
          encrypt: true,
          compress: true,
          backup: true,
          retention: '90 days'
        }
      },
      encryption: encryptionManager
    });
  }

  /**
   * Get container statistics
   */
  getStats() {
    return {
      initialized: this.initialized,
      componentCount: this.singletons.size,
      factoryCount: this.factories.size,
      shutdownCallbacks: this.shutdownCallbacks.size,
      environment: this.config.environment,
      components: Array.from(this.singletons.keys()),
      factories: Array.from(this.factories.keys())
    };
  }
}

export default ApplicationContainer;