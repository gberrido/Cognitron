#!/usr/bin/env node

/**
 * PluginManager - Main plugin management interface for Cognitron05
 * Provides high-level plugin management functionality built on PluginRegistry
 * 
 * Features:
 * - Tool and command management through plugins
 * - Plugin discovery and installation
 * - Security and permission management
 * - Plugin marketplace integration ready
 */

import { PluginRegistry } from './PluginRegistry.js';
import { IToolManager, IToolExecutionResult } from '../interfaces/IToolManager.js';
import { getLogger } from '../utils/StructuredLogger.js';
import { InputValidator } from '../utils/InputValidator.js';

export class PluginManager extends IToolManager {
  constructor(config = {}) {
    super();
    
    this.config = {
      pluginDir: config.pluginDir || './plugins',
      enableSandboxing: config.enableSandboxing !== false,
      enableAutoLoad: config.enableAutoLoad !== false,
      enableSecurity: config.enableSecurity !== false,
      ...config
    };
    
    this.logger = getLogger();
    
    // Core plugin registry
    this.registry = new PluginRegistry(this.config);
    
    // Tool execution context
    this.executionContext = null;
    
    // Statistics tracking
    this.executionStats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      executionTime: 0,
      toolUsage: new Map(), // toolName -> usage count
      pluginUsage: new Map() // pluginId -> usage count
    };
    
    this.initialized = false;
  }

  /**
   * Initialize the plugin manager
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing plugin manager', {
        subsystem: 'plugins',
        pluginDir: this.config.pluginDir,
        sandboxing: this.config.enableSandboxing,
        operation: 'initialize'
      });

      // Initialize plugin registry
      await this.registry.initialize();
      
      // Set up execution context
      this.executionContext = new PluginExecutionContext(this.config);
      
      this.initialized = true;
      
      const stats = this.registry.getStats();
      this.logger.info('Plugin manager initialized', {
        subsystem: 'plugins',
        totalPlugins: stats.totalPlugins,
        enabledPlugins: stats.enabledPlugins,
        toolsAvailable: stats.toolsRegistered,
        operation: 'initialize'
      });

    } catch (error) {
      this.logger.error('Failed to initialize plugin manager', {
        subsystem: 'plugins',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Register a tool through the plugin system
   * @param {string} name - Tool name
   * @param {Object} toolDefinition - Tool definition
   * @param {Function} handler - Tool execution handler
   */
  async registerTool(name, toolDefinition, handler) {
    try {
      this.logger.debug('Registering tool through plugin system', {
        subsystem: 'plugins',
        toolName: name,
        operation: 'registerTool'
      });

      // Create a dynamic plugin for the tool
      const plugin = {
        name: `dynamic-tool-${name}`,
        version: '1.0.0',
        description: `Dynamically registered tool: ${name}`,
        tools: [{
          name,
          description: toolDefinition.description,
          parameters: toolDefinition.parameters,
          handler,
          security: toolDefinition.security || {}
        }],
        autoEnable: true
      };

      const pluginId = `tool-${name}`;
      await this.registry.registerPlugin(pluginId, plugin);
      await this.registry.setPluginEnabled(pluginId, true);

      this.logger.info('Tool registered as plugin', {
        subsystem: 'plugins',
        toolName: name,
        pluginId,
        operation: 'registerTool'
      });

    } catch (error) {
      this.logger.error('Failed to register tool', {
        subsystem: 'plugins',
        toolName: name,
        operation: 'registerTool'
      }, error);
      throw error;
    }
  }

  /**
   * Unregister a tool
   * @param {string} name - Tool name
   */
  async unregisterTool(name) {
    try {
      const pluginId = `tool-${name}`;
      const success = await this.registry.unregisterPlugin(pluginId);
      
      if (success) {
        this.logger.info('Tool unregistered', {
          subsystem: 'plugins',
          toolName: name,
          pluginId,
          operation: 'unregisterTool'
        });
      }
      
      return success;

    } catch (error) {
      this.logger.error('Failed to unregister tool', {
        subsystem: 'plugins',
        toolName: name,
        operation: 'unregisterTool'
      }, error);
      throw error;
    }
  }

  /**
   * Get available tools from all enabled plugins
   */
  getAvailableTools() {
    const tools = [];
    
    for (const [toolName, pluginTool] of this.registry.tools.entries()) {
      // Only include tools from enabled plugins
      if (this.registry.enabledPlugins.has(pluginTool.pluginId)) {
        tools.push({
          type: 'function',
          function: {
            name: toolName,
            description: pluginTool.description,
            parameters: pluginTool.parameters
          },
          pluginId: pluginTool.pluginId,
          security: pluginTool.security
        });
      }
    }
    
    this.logger.debug('Retrieved available tools', {
      subsystem: 'plugins',
      toolCount: tools.length,
      operation: 'getAvailableTools'
    });
    
    return tools;
  }

  /**
   * Execute a tool call
   * @param {string} toolName - Tool name
   * @param {Object} parameters - Tool parameters
   * @param {Object} context - Execution context
   */
  async executeTool(toolName, parameters, context = {}) {
    const executionStart = Date.now();
    
    try {
      this.logger.debug('Executing plugin tool', {
        subsystem: 'plugins',
        toolName,
        operation: 'executeTool'
      });

      // Get plugin tool
      const pluginTool = this.registry.tools.get(toolName);
      if (!pluginTool) {
        throw new Error(`Tool '${toolName}' not found`);
      }

      // Check if plugin is enabled
      if (!this.registry.enabledPlugins.has(pluginTool.pluginId)) {
        throw new Error(`Plugin '${pluginTool.pluginId}' for tool '${toolName}' is not enabled`);
      }

      // Validate parameters
      const validation = await this.validateParameters(toolName, parameters);
      if (!validation.valid) {
        throw new Error(`Parameter validation failed: ${validation.errors.join(', ')}`);
      }

      // Security check
      if (this.config.enableSecurity) {
        await this.checkToolSecurity(pluginTool, parameters, context);
      }

      // Create execution context
      const execContext = {
        ...this.executionContext,
        ...context,
        toolName,
        pluginId: pluginTool.pluginId,
        sessionId: context.sessionId || 'unknown',
        timestamp: new Date().toISOString()
      };

      // Execute the tool
      const result = await pluginTool.handler(parameters, execContext);

      const executionTime = Date.now() - executionStart;
      
      // Update statistics
      this.updateExecutionStats(toolName, pluginTool.pluginId, executionTime, true);

      this.logger.info('Plugin tool executed successfully', {
        subsystem: 'plugins',
        toolName,
        pluginId: pluginTool.pluginId,
        executionTime,
        operation: 'executeTool'
      });

      return new IToolExecutionResult(true, result, null, {
        executionTime,
        pluginId: pluginTool.pluginId,
        toolName
      });

    } catch (error) {
      const executionTime = Date.now() - executionStart;
      
      // Update statistics for failed execution
      this.updateExecutionStats(toolName, 'unknown', executionTime, false);

      this.logger.error('Plugin tool execution failed', {
        subsystem: 'plugins',
        toolName,
        executionTime,
        operation: 'executeTool'
      }, error);

      return new IToolExecutionResult(false, null, error, {
        executionTime,
        toolName
      });
    }
  }

  /**
   * Validate tool parameters
   * @param {string} toolName - Tool name
   * @param {Object} parameters - Parameters to validate
   */
  async validateParameters(toolName, parameters) {
    const pluginTool = this.registry.tools.get(toolName);
    if (!pluginTool) {
      return { valid: false, errors: ['Tool not found'] };
    }

    // Basic parameter validation using existing InputValidator
    const errors = [];
    
    if (pluginTool.parameters && pluginTool.parameters.required) {
      for (const requiredParam of pluginTool.parameters.required) {
        if (!(requiredParam in parameters)) {
          errors.push(`Required parameter '${requiredParam}' is missing`);
        }
      }
    }

    // Type validation for parameters
    if (pluginTool.parameters && pluginTool.parameters.properties) {
      for (const [paramName, paramConfig] of Object.entries(pluginTool.parameters.properties)) {
        if (paramName in parameters) {
          const value = parameters[paramName];
          const expectedType = paramConfig.type;
          
          if (expectedType === 'string' && typeof value !== 'string') {
            errors.push(`Parameter '${paramName}' must be a string`);
          } else if (expectedType === 'number' && typeof value !== 'number') {
            errors.push(`Parameter '${paramName}' must be a number`);
          } else if (expectedType === 'boolean' && typeof value !== 'boolean') {
            errors.push(`Parameter '${paramName}' must be a boolean`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get tool definition by name
   * @param {string} toolName - Tool name
   */
  getToolDefinition(toolName) {
    const pluginTool = this.registry.tools.get(toolName);
    if (!pluginTool) {
      return null;
    }

    return {
      type: 'function',
      function: {
        name: toolName,
        description: pluginTool.description,
        parameters: pluginTool.parameters
      },
      pluginId: pluginTool.pluginId,
      security: pluginTool.security
    };
  }

  /**
   * Check if a tool is available
   * @param {string} toolName - Tool name
   */
  isToolAvailable(toolName) {
    const pluginTool = this.registry.tools.get(toolName);
    return pluginTool && this.registry.enabledPlugins.has(pluginTool.pluginId);
  }

  /**
   * Get tool execution statistics
   */
  getToolStats() {
    const registryStats = this.registry.getStats();
    
    return {
      ...this.executionStats,
      totalTools: registryStats.toolsRegistered,
      totalPlugins: registryStats.totalPlugins,
      enabledPlugins: registryStats.enabledPlugins,
      successRate: this.executionStats.totalExecutions > 0 ? 
        Math.round((this.executionStats.successfulExecutions / this.executionStats.totalExecutions) * 100) : 0,
      averageExecutionTime: this.executionStats.totalExecutions > 0 ?
        Math.round(this.executionStats.executionTime / this.executionStats.totalExecutions) : 0
    };
  }

  /**
   * Health check for plugin manager
   */
  async healthCheck() {
    try {
      const registryStats = this.registry.getStats();
      
      // Check if any plugins are loaded
      const hasEnabledPlugins = registryStats.enabledPlugins > 0;
      
      // Check plugin health
      const pluginHealthChecks = [];
      for (const pluginId of this.registry.enabledPlugins) {
        const health = await this.registry.checkPluginHealth(pluginId);
        pluginHealthChecks.push({ pluginId, ...health });
      }
      
      const unhealthyPlugins = pluginHealthChecks.filter(check => !check.healthy);
      const healthy = unhealthyPlugins.length === 0;
      
      return {
        healthy,
        reason: healthy ? 'Plugin manager healthy' : `${unhealthyPlugins.length} plugins unhealthy`,
        details: {
          totalPlugins: registryStats.totalPlugins,
          enabledPlugins: registryStats.enabledPlugins,
          toolsAvailable: registryStats.toolsRegistered,
          hasEnabledPlugins,
          pluginHealthChecks: unhealthyPlugins
        }
      };

    } catch (error) {
      this.logger.error('Plugin manager health check failed', {
        subsystem: 'plugins',
        operation: 'healthCheck'
      }, error);

      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`
      };
    }
  }

  /**
   * Cleanup plugin manager resources
   */
  async cleanup() {
    try {
      this.logger.info('Cleaning up plugin manager', {
        subsystem: 'plugins',
        operation: 'cleanup'
      });

      await this.registry.cleanup();

      // Clear statistics
      this.executionStats.toolUsage.clear();
      this.executionStats.pluginUsage.clear();

    } catch (error) {
      this.logger.error('Error during plugin manager cleanup', {
        subsystem: 'plugins',
        operation: 'cleanup'
      }, error);
    }
  }

  // Plugin-specific methods

  /**
   * Install a plugin from file
   * @param {string} pluginPath - Path to plugin file
   * @param {Object} options - Installation options
   */
  async installPlugin(pluginPath, options = {}) {
    try {
      this.logger.info('Installing plugin from file', {
        subsystem: 'plugins',
        pluginPath,
        operation: 'installPlugin'
      });

      // Load plugin securely using SecurePluginLoader
      if (!this.secureLoader) {
        const { SecurePluginLoader } = await import('../security/SecurePluginLoader.js');
        this.secureLoader = new SecurePluginLoader({
          allowedPluginDirs: [this.config.pluginDir, './plugins'],
          requireSignatures: this.config.enableSecurity,
          enableSandboxing: this.config.enableSandboxing,
          allowFileSystem: false,
          allowNetwork: false,
          maxPluginSize: 2 * 1024 * 1024 // 2MB
        });
      }
      
      const loadResult = await this.secureLoader.secureLoadPlugin(pluginPath);
      if (!loadResult.success) {
        throw new Error(`Failed to load plugin securely: ${loadResult.error}`);
      }
      
      const pluginModule = loadResult.plugin;
      
      const pluginId = options.pluginId || pluginModule.id || path.basename(pluginPath, '.js');
      
      // Register plugin
      await this.registry.registerPlugin(pluginId, pluginModule);
      
      // Enable if requested
      if (options.enable !== false) {
        await this.registry.setPluginEnabled(pluginId, true);
      }
      
      this.logger.info('Plugin installed successfully', {
        subsystem: 'plugins',
        pluginId,
        pluginPath,
        operation: 'installPlugin'
      });
      
      return pluginId;

    } catch (error) {
      this.logger.error('Failed to install plugin', {
        subsystem: 'plugins',
        pluginPath,
        operation: 'installPlugin'
      }, error);
      throw error;
    }
  }

  /**
   * Get plugin manager and registry information
   */
  getPluginInfo() {
    return {
      registry: this.registry.getRegisteredPlugins(),
      stats: this.getToolStats(),
      availableTools: this.getAvailableTools().map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        pluginId: tool.pluginId
      }))
    };
  }

  /**
   * Update execution statistics
   */
  updateExecutionStats(toolName, pluginId, executionTime, success) {
    this.executionStats.totalExecutions++;
    this.executionStats.executionTime += executionTime;
    
    if (success) {
      this.executionStats.successfulExecutions++;
    } else {
      this.executionStats.failedExecutions++;
    }
    
    // Update tool usage
    const currentToolUsage = this.executionStats.toolUsage.get(toolName) || 0;
    this.executionStats.toolUsage.set(toolName, currentToolUsage + 1);
    
    // Update plugin usage
    if (pluginId !== 'unknown') {
      const currentPluginUsage = this.executionStats.pluginUsage.get(pluginId) || 0;
      this.executionStats.pluginUsage.set(pluginId, currentPluginUsage + 1);
    }
  }

  /**
   * Check tool security
   */
  async checkToolSecurity(pluginTool, parameters, context) {
    // Basic security checks
    if (pluginTool.security.requiresAuth && !context.authenticated) {
      throw new Error('Tool requires authentication');
    }
    
    if (pluginTool.security.permissions && context.permissions) {
      const hasRequiredPermissions = pluginTool.security.permissions.every(
        permission => context.permissions.includes(permission)
      );
      
      if (!hasRequiredPermissions) {
        throw new Error('Insufficient permissions for tool execution');
      }
    }
    
    // Rate limiting check would go here
    // Sandbox validation would go here
  }
}

/**
 * Plugin execution context
 */
class PluginExecutionContext {
  constructor(config) {
    this.config = config;
    this.logger = getLogger();
  }

  getUserId() {
    return 'default-user'; // TODO: Implement user management
  }

  getSessionId() {
    return 'default-session'; // TODO: Get from session context
  }

  getPermissions() {
    return ['read', 'write']; // TODO: Implement permission system
  }

  getEnvironment() {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      pluginDir: this.config.pluginDir
    };
  }

  log(level, message, data = {}) {
    this.logger[level.toLowerCase()](message, {
      subsystem: 'plugins',
      context: 'execution',
      ...data
    });
  }
}

export default PluginManager;