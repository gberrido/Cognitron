#!/usr/bin/env node

/**
 * PluginRegistry - Core plugin management system for Cognitron05
 * Implements extensible plugin architecture with sandboxing and security
 * 
 * Features:
 * - Dynamic plugin loading and unloading
 * - Plugin lifecycle management
 * - Security sandboxing and validation
 * - Tool and command registration
 * - Plugin dependency management
 */

import { getLogger } from '../utils/StructuredLogger.js';
import { IToolRegistry } from '../interfaces/IToolManager.js';
import path from 'path';
import fs from 'fs/promises';

export class PluginRegistry extends IToolRegistry {
  constructor(config = {}) {
    super();
    
    this.config = {
      pluginDir: config.pluginDir || './plugins',
      enableSandboxing: config.enableSandboxing !== false,
      maxPlugins: config.maxPlugins || 50,
      enableAutoLoad: config.enableAutoLoad !== false,
      trustedPluginPaths: config.trustedPluginPaths || [],
      ...config
    };
    
    this.logger = getLogger();
    
    // Plugin registry
    this.plugins = new Map(); // pluginId -> PluginDescriptor
    this.tools = new Map();   // toolName -> PluginTool
    this.commands = new Map(); // commandName -> PluginCommand
    
    // Plugin state tracking
    this.loadedPlugins = new Set();
    this.enabledPlugins = new Set();
    this.pluginDependencies = new Map();
    
    // Security and sandboxing
    this.pluginSandbox = new PluginSandbox(this.config);
    this.pluginValidator = new PluginValidator(this.config);
    
    // Statistics
    this.stats = {
      totalPlugins: 0,
      enabledPlugins: 0,
      toolsRegistered: 0,
      commandsRegistered: 0,
      loadErrors: 0,
      loadTime: 0
    };
    
    this.initialized = false;
  }

  /**
   * Initialize the plugin registry
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing plugin registry', {
        subsystem: 'plugins',
        pluginDir: this.config.pluginDir,
        sandboxing: this.config.enableSandboxing,
        operation: 'initialize'
      });

      // Create plugin directory if it doesn't exist
      await this.ensurePluginDirectory();
      
      // Initialize plugin sandbox
      await this.pluginSandbox.initialize();
      
      // Auto-load plugins if enabled
      if (this.config.enableAutoLoad) {
        await this.autoLoadPlugins();
      }
      
      this.initialized = true;
      
      this.logger.info('Plugin registry initialized', {
        subsystem: 'plugins',
        totalPlugins: this.plugins.size,
        enabledPlugins: this.enabledPlugins.size,
        operation: 'initialize'
      });

    } catch (error) {
      this.logger.error('Failed to initialize plugin registry', {
        subsystem: 'plugins',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Register a plugin
   * @param {string} pluginId - Plugin identifier
   * @param {Object} plugin - Plugin definition
   */
  async registerPlugin(pluginId, plugin) {
    try {
      this.logger.debug('Registering plugin', {
        subsystem: 'plugins',
        pluginId,
        operation: 'registerPlugin'
      });

      // Validate plugin
      const validationResult = await this.pluginValidator.validatePlugin(plugin);
      if (!validationResult.valid) {
        throw new Error(`Plugin validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Check if plugin already registered
      if (this.plugins.has(pluginId)) {
        throw new Error(`Plugin '${pluginId}' is already registered`);
      }

      // Check plugin limit
      if (this.plugins.size >= this.config.maxPlugins) {
        throw new Error(`Maximum plugin limit (${this.config.maxPlugins}) reached`);
      }

      // Create plugin descriptor
      const pluginDescriptor = new PluginDescriptor(pluginId, plugin, {
        registeredAt: new Date().toISOString(),
        version: plugin.version || '1.0.0',
        enabled: false,
        loaded: false
      });

      // Validate and resolve dependencies
      await this.validatePluginDependencies(pluginDescriptor);

      // Register the plugin
      this.plugins.set(pluginId, pluginDescriptor);
      this.stats.totalPlugins++;

      this.logger.info('Plugin registered successfully', {
        subsystem: 'plugins',
        pluginId,
        version: pluginDescriptor.version,
        tools: pluginDescriptor.plugin.tools?.length || 0,
        commands: pluginDescriptor.plugin.commands?.length || 0,
        operation: 'registerPlugin'
      });

    } catch (error) {
      this.logger.error('Failed to register plugin', {
        subsystem: 'plugins',
        pluginId,
        operation: 'registerPlugin'
      }, error);
      throw error;
    }
  }

  /**
   * Unregister a plugin
   * @param {string} pluginId - Plugin identifier
   */
  async unregisterPlugin(pluginId) {
    try {
      this.logger.debug('Unregistering plugin', {
        subsystem: 'plugins',
        pluginId,
        operation: 'unregisterPlugin'
      });

      const plugin = this.plugins.get(pluginId);
      if (!plugin) {
        return false;
      }

      // Disable plugin first
      if (this.enabledPlugins.has(pluginId)) {
        await this.setPluginEnabled(pluginId, false);
      }

      // Unload plugin if loaded
      if (this.loadedPlugins.has(pluginId)) {
        await this.unloadPlugin(pluginId);
      }

      // Remove from registry
      this.plugins.delete(pluginId);
      this.pluginDependencies.delete(pluginId);
      this.stats.totalPlugins--;

      this.logger.info('Plugin unregistered successfully', {
        subsystem: 'plugins',
        pluginId,
        operation: 'unregisterPlugin'
      });

      return true;

    } catch (error) {
      this.logger.error('Failed to unregister plugin', {
        subsystem: 'plugins',
        pluginId,
        operation: 'unregisterPlugin'
      }, error);
      throw error;
    }
  }

  /**
   * Load a plugin into memory
   * @param {string} pluginId - Plugin identifier
   */
  async loadPlugin(pluginId) {
    try {
      const pluginDescriptor = this.plugins.get(pluginId);
      if (!pluginDescriptor) {
        throw new Error(`Plugin '${pluginId}' not found`);
      }

      if (this.loadedPlugins.has(pluginId)) {
        return; // Already loaded
      }

      this.logger.debug('Loading plugin', {
        subsystem: 'plugins',
        pluginId,
        operation: 'loadPlugin'
      });

      const loadStart = Date.now();

      // Load plugin dependencies first
      const dependencies = this.pluginDependencies.get(pluginId) || [];
      for (const depId of dependencies) {
        if (!this.loadedPlugins.has(depId)) {
          await this.loadPlugin(depId);
        }
      }

      // Initialize plugin in sandbox if required
      if (this.config.enableSandboxing) {
        await this.pluginSandbox.loadPlugin(pluginDescriptor);
      }

      // Call plugin's initialize method if available
      if (pluginDescriptor.plugin.initialize && typeof pluginDescriptor.plugin.initialize === 'function') {
        await pluginDescriptor.plugin.initialize();
      }

      // Mark as loaded
      this.loadedPlugins.add(pluginId);
      pluginDescriptor.metadata.loaded = true;
      pluginDescriptor.metadata.loadedAt = new Date().toISOString();

      const loadTime = Date.now() - loadStart;
      this.stats.loadTime += loadTime;

      this.logger.info('Plugin loaded successfully', {
        subsystem: 'plugins',
        pluginId,
        loadTime,
        operation: 'loadPlugin'
      });

    } catch (error) {
      this.stats.loadErrors++;
      this.logger.error('Failed to load plugin', {
        subsystem: 'plugins',
        pluginId,
        operation: 'loadPlugin'
      }, error);
      throw error;
    }
  }

  /**
   * Unload a plugin from memory
   * @param {string} pluginId - Plugin identifier
   */
  async unloadPlugin(pluginId) {
    try {
      const pluginDescriptor = this.plugins.get(pluginId);
      if (!pluginDescriptor) {
        throw new Error(`Plugin '${pluginId}' not found`);
      }

      if (!this.loadedPlugins.has(pluginId)) {
        return; // Not loaded
      }

      this.logger.debug('Unloading plugin', {
        subsystem: 'plugins',
        pluginId,
        operation: 'unloadPlugin'
      });

      // Call plugin's cleanup method if available
      if (pluginDescriptor.plugin.cleanup && typeof pluginDescriptor.plugin.cleanup === 'function') {
        await pluginDescriptor.plugin.cleanup();
      }

      // Unload from sandbox if required
      if (this.config.enableSandboxing) {
        await this.pluginSandbox.unloadPlugin(pluginDescriptor);
      }

      // Mark as unloaded
      this.loadedPlugins.delete(pluginId);
      pluginDescriptor.metadata.loaded = false;
      pluginDescriptor.metadata.unloadedAt = new Date().toISOString();

      this.logger.info('Plugin unloaded successfully', {
        subsystem: 'plugins',
        pluginId,
        operation: 'unloadPlugin'
      });

    } catch (error) {
      this.logger.error('Failed to unload plugin', {
        subsystem: 'plugins',
        pluginId,
        operation: 'unloadPlugin'
      }, error);
      throw error;
    }
  }

  /**
   * Enable/disable a plugin
   * @param {string} pluginId - Plugin identifier
   * @param {boolean} enabled - Enable status
   */
  async setPluginEnabled(pluginId, enabled) {
    try {
      const pluginDescriptor = this.plugins.get(pluginId);
      if (!pluginDescriptor) {
        throw new Error(`Plugin '${pluginId}' not found`);
      }

      const currentlyEnabled = this.enabledPlugins.has(pluginId);
      if (currentlyEnabled === enabled) {
        return; // No change needed
      }

      this.logger.debug('Setting plugin enabled status', {
        subsystem: 'plugins',
        pluginId,
        enabled,
        operation: 'setPluginEnabled'
      });

      if (enabled) {
        // Load plugin if not already loaded
        if (!this.loadedPlugins.has(pluginId)) {
          await this.loadPlugin(pluginId);
        }

        // Register plugin tools and commands
        await this.registerPluginTools(pluginDescriptor);
        await this.registerPluginCommands(pluginDescriptor);

        this.enabledPlugins.add(pluginId);
        this.stats.enabledPlugins++;

      } else {
        // Unregister plugin tools and commands
        await this.unregisterPluginTools(pluginDescriptor);
        await this.unregisterPluginCommands(pluginDescriptor);

        this.enabledPlugins.delete(pluginId);
        this.stats.enabledPlugins--;
      }

      pluginDescriptor.metadata.enabled = enabled;
      pluginDescriptor.metadata.enabledAt = enabled ? new Date().toISOString() : null;

      this.logger.info('Plugin enabled status updated', {
        subsystem: 'plugins',
        pluginId,
        enabled,
        operation: 'setPluginEnabled'
      });

    } catch (error) {
      this.logger.error('Failed to set plugin enabled status', {
        subsystem: 'plugins',
        pluginId,
        enabled,
        operation: 'setPluginEnabled'
      }, error);
      throw error;
    }
  }

  /**
   * Get registered plugins
   */
  getRegisteredPlugins() {
    return Array.from(this.plugins.values()).map(descriptor => ({
      id: descriptor.id,
      name: descriptor.plugin.name || descriptor.id,
      version: descriptor.version,
      description: descriptor.plugin.description || '',
      enabled: descriptor.metadata.enabled,
      loaded: descriptor.metadata.loaded,
      tools: descriptor.plugin.tools?.length || 0,
      commands: descriptor.plugin.commands?.length || 0,
      registeredAt: descriptor.metadata.registeredAt
    }));
  }

  /**
   * Get tools provided by a plugin
   * @param {string} pluginId - Plugin identifier
   */
  getPluginTools(pluginId) {
    const pluginDescriptor = this.plugins.get(pluginId);
    if (!pluginDescriptor) {
      return [];
    }

    return pluginDescriptor.plugin.tools || [];
  }

  /**
   * Check plugin health
   * @param {string} pluginId - Plugin identifier
   */
  async checkPluginHealth(pluginId) {
    try {
      const pluginDescriptor = this.plugins.get(pluginId);
      if (!pluginDescriptor) {
        return {
          healthy: false,
          reason: 'Plugin not found'
        };
      }

      const isLoaded = this.loadedPlugins.has(pluginId);
      const isEnabled = this.enabledPlugins.has(pluginId);

      // Call plugin's health check method if available
      let pluginHealthResult = { healthy: true };
      if (pluginDescriptor.plugin.healthCheck && typeof pluginDescriptor.plugin.healthCheck === 'function') {
        pluginHealthResult = await pluginDescriptor.plugin.healthCheck();
      }

      const healthy = isLoaded && isEnabled && pluginHealthResult.healthy;

      return {
        healthy,
        reason: healthy ? 'Plugin healthy' : pluginHealthResult.reason || 'Plugin not loaded or enabled',
        details: {
          loaded: isLoaded,
          enabled: isEnabled,
          pluginHealth: pluginHealthResult
        }
      };

    } catch (error) {
      this.logger.error('Plugin health check failed', {
        subsystem: 'plugins',
        pluginId,
        operation: 'checkPluginHealth'
      }, error);

      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`
      };
    }
  }

  /**
   * Auto-load plugins from plugin directory
   */
  async autoLoadPlugins() {
    try {
      this.logger.debug('Auto-loading plugins', {
        subsystem: 'plugins',
        pluginDir: this.config.pluginDir,
        operation: 'autoLoadPlugins'
      });

      const pluginFiles = await this.discoverPluginFiles();
      
      for (const pluginFile of pluginFiles) {
        try {
          const plugin = await this.loadPluginFile(pluginFile);
          const pluginId = plugin.id || path.basename(pluginFile.path, '.js');
          
          await this.registerPlugin(pluginId, plugin);
          
          // Enable plugin if it's marked as autoEnable
          if (plugin.autoEnable) {
            await this.setPluginEnabled(pluginId, true);
          }
          
        } catch (error) {
          this.logger.warn('Failed to auto-load plugin', {
            subsystem: 'plugins',
            pluginFile: pluginFile.path,
            operation: 'autoLoadPlugins'
          }, error);
        }
      }

      this.logger.info('Auto-load plugins completed', {
        subsystem: 'plugins',
        filesDiscovered: pluginFiles.length,
        pluginsLoaded: this.plugins.size,
        operation: 'autoLoadPlugins'
      });

    } catch (error) {
      this.logger.error('Auto-load plugins failed', {
        subsystem: 'plugins',
        operation: 'autoLoadPlugins'
      }, error);
    }
  }

  /**
   * Discover plugin files in plugin directory
   */
  async discoverPluginFiles() {
    const pluginFiles = [];
    
    try {
      const entries = await fs.readdir(this.config.pluginDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.js')) {
          pluginFiles.push({
            path: path.join(this.config.pluginDir, entry.name),
            name: entry.name,
            trusted: this.isPluginPathTrusted(path.join(this.config.pluginDir, entry.name))
          });
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
    
    return pluginFiles;
  }

  /**
   * Load plugin from file
   */
  async loadPluginFile(pluginFile) {
    const pluginModule = await import(pluginFile.path);
    return pluginModule.default || pluginModule;
  }

  /**
   * Check if plugin path is trusted
   */
  isPluginPathTrusted(pluginPath) {
    return this.config.trustedPluginPaths.some(trustedPath => 
      pluginPath.startsWith(path.resolve(trustedPath))
    );
  }

  /**
   * Ensure plugin directory exists
   */
  async ensurePluginDirectory() {
    try {
      await fs.mkdir(this.config.pluginDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Validate plugin dependencies
   */
  async validatePluginDependencies(pluginDescriptor) {
    const dependencies = pluginDescriptor.plugin.dependencies || [];
    const resolvedDependencies = [];
    
    for (const depId of dependencies) {
      if (!this.plugins.has(depId)) {
        throw new Error(`Plugin dependency '${depId}' not found`);
      }
      resolvedDependencies.push(depId);
    }
    
    this.pluginDependencies.set(pluginDescriptor.id, resolvedDependencies);
  }

  /**
   * Register plugin tools
   */
  async registerPluginTools(pluginDescriptor) {
    const tools = pluginDescriptor.plugin.tools || [];
    
    for (const tool of tools) {
      const pluginTool = new PluginTool(pluginDescriptor.id, tool);
      this.tools.set(tool.name, pluginTool);
      this.stats.toolsRegistered++;
      
      this.logger.debug('Plugin tool registered', {
        subsystem: 'plugins',
        pluginId: pluginDescriptor.id,
        toolName: tool.name,
        operation: 'registerPluginTools'
      });
    }
  }

  /**
   * Unregister plugin tools
   */
  async unregisterPluginTools(pluginDescriptor) {
    const tools = pluginDescriptor.plugin.tools || [];
    
    for (const tool of tools) {
      this.tools.delete(tool.name);
      this.stats.toolsRegistered--;
      
      this.logger.debug('Plugin tool unregistered', {
        subsystem: 'plugins',
        pluginId: pluginDescriptor.id,
        toolName: tool.name,
        operation: 'unregisterPluginTools'
      });
    }
  }

  /**
   * Register plugin commands
   */
  async registerPluginCommands(pluginDescriptor) {
    const commands = pluginDescriptor.plugin.commands || [];
    
    for (const command of commands) {
      const pluginCommand = new PluginCommand(pluginDescriptor.id, command);
      this.commands.set(command.name, pluginCommand);
      this.stats.commandsRegistered++;
      
      this.logger.debug('Plugin command registered', {
        subsystem: 'plugins',
        pluginId: pluginDescriptor.id,
        commandName: command.name,
        operation: 'registerPluginCommands'
      });
    }
  }

  /**
   * Unregister plugin commands
   */
  async unregisterPluginCommands(pluginDescriptor) {
    const commands = pluginDescriptor.plugin.commands || [];
    
    for (const command of commands) {
      this.commands.delete(command.name);
      this.stats.commandsRegistered--;
      
      this.logger.debug('Plugin command unregistered', {
        subsystem: 'plugins',
        pluginId: pluginDescriptor.id,
        commandName: command.name,
        operation: 'unregisterPluginCommands'
      });
    }
  }

  /**
   * Get plugin registry statistics
   */
  getStats() {
    return {
      ...this.stats,
      totalPlugins: this.plugins.size,
      enabledPlugins: this.enabledPlugins.size,
      loadedPlugins: this.loadedPlugins.size,
      toolsRegistered: this.tools.size,
      commandsRegistered: this.commands.size
    };
  }

  /**
   * Cleanup plugin registry
   */
  async cleanup() {
    try {
      this.logger.info('Cleaning up plugin registry', {
        subsystem: 'plugins',
        operation: 'cleanup'
      });

      // Disable all plugins
      for (const pluginId of this.enabledPlugins) {
        await this.setPluginEnabled(pluginId, false);
      }

      // Unload all plugins
      for (const pluginId of this.loadedPlugins) {
        await this.unloadPlugin(pluginId);
      }

      // Clear registries
      this.plugins.clear();
      this.tools.clear();
      this.commands.clear();
      this.loadedPlugins.clear();
      this.enabledPlugins.clear();
      this.pluginDependencies.clear();

      // Cleanup sandbox
      await this.pluginSandbox.cleanup();

    } catch (error) {
      this.logger.error('Error during plugin registry cleanup', {
        subsystem: 'plugins',
        operation: 'cleanup'
      }, error);
    }
  }
}

/**
 * Plugin descriptor class
 */
class PluginDescriptor {
  constructor(id, plugin, metadata = {}) {
    this.id = id;
    this.plugin = plugin;
    this.version = plugin.version || '1.0.0';
    this.metadata = {
      registeredAt: new Date().toISOString(),
      enabled: false,
      loaded: false,
      ...metadata
    };
  }
}

/**
 * Plugin tool wrapper
 */
class PluginTool {
  constructor(pluginId, tool) {
    this.pluginId = pluginId;
    this.name = tool.name;
    this.description = tool.description;
    this.parameters = tool.parameters;
    this.handler = tool.handler;
    this.security = tool.security || {};
  }
}

/**
 * Plugin command wrapper
 */
class PluginCommand {
  constructor(pluginId, command) {
    this.pluginId = pluginId;
    this.name = command.name;
    this.description = command.description;
    this.usage = command.usage;
    this.handler = command.handler;
    this.permissions = command.permissions || [];
  }
}

/**
 * Plugin sandbox for security
 */
class PluginSandbox {
  constructor(config) {
    this.config = config;
    this.logger = getLogger();
  }

  async initialize() {
    // Initialize sandbox environment
  }

  async loadPlugin(pluginDescriptor) {
    // Load plugin in sandbox
  }

  async unloadPlugin(pluginDescriptor) {
    // Unload plugin from sandbox
  }

  async cleanup() {
    // Cleanup sandbox
  }
}

/**
 * Plugin validator
 */
class PluginValidator {
  constructor(config) {
    this.config = config;
    this.logger = getLogger();
  }

  async validatePlugin(plugin) {
    const errors = [];

    // Basic structure validation
    if (!plugin.name) {
      errors.push('Plugin must have a name');
    }

    if (!plugin.version) {
      errors.push('Plugin must have a version');
    }

    // Validate tools if present
    if (plugin.tools) {
      if (!Array.isArray(plugin.tools)) {
        errors.push('Plugin tools must be an array');
      } else {
        for (const tool of plugin.tools) {
          if (!tool.name || !tool.handler) {
            errors.push('Plugin tools must have name and handler');
          }
        }
      }
    }

    // Validate commands if present
    if (plugin.commands) {
      if (!Array.isArray(plugin.commands)) {
        errors.push('Plugin commands must be an array');
      } else {
        for (const command of plugin.commands) {
          if (!command.name || !command.handler) {
            errors.push('Plugin commands must have name and handler');
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

export default PluginRegistry;