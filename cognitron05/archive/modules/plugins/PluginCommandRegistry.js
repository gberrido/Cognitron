#!/usr/bin/env node

/**
 * PluginCommandRegistry - Command registration and execution through plugins
 * Extends the existing command registry to support plugin-based commands
 * 
 * Features:
 * - Dynamic command registration from plugins
 * - Command validation and security
 * - Plugin command lifecycle management
 * - Integration with existing command system
 */

import { getLogger } from '../utils/StructuredLogger.js';
import { InputValidator } from '../utils/InputValidator.js';

export class PluginCommandRegistry {
  constructor(baseCommandRegistry, pluginManager) {
    this.baseRegistry = baseCommandRegistry;
    this.pluginManager = pluginManager;
    this.logger = getLogger();
    
    // Plugin command registry
    this.pluginCommands = new Map(); // commandName -> PluginCommandDescriptor
    
    // Command execution tracking
    this.executionStats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      commandUsage: new Map()
    };
    
    this.initialized = false;
  }

  /**
   * Initialize the plugin command registry
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing plugin command registry', {
        subsystem: 'plugins',
        operation: 'initialize'
      });

      // Listen for plugin events to register/unregister commands
      this.setupPluginEventListeners();
      
      // Register existing plugin commands
      await this.registerExistingPluginCommands();
      
      this.initialized = true;
      
      this.logger.info('Plugin command registry initialized', {
        subsystem: 'plugins',
        pluginCommands: this.pluginCommands.size,
        operation: 'initialize'
      });

    } catch (error) {
      this.logger.error('Failed to initialize plugin command registry', {
        subsystem: 'plugins',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Register a command from a plugin
   * @param {string} pluginId - Plugin identifier
   * @param {Object} command - Command definition
   */
  async registerPluginCommand(pluginId, command) {
    try {
      this.logger.debug('Registering plugin command', {
        subsystem: 'plugins',
        pluginId,
        commandName: command.name,
        operation: 'registerPluginCommand'
      });

      // Validate command definition
      const validation = this.validateCommandDefinition(command);
      if (!validation.valid) {
        throw new Error(`Command validation failed: ${validation.errors.join(', ')}`);
      }

      // Check for command conflicts
      if (this.pluginCommands.has(command.name)) {
        const existing = this.pluginCommands.get(command.name);
        if (existing.pluginId !== pluginId) {
          throw new Error(`Command '${command.name}' already registered by plugin '${existing.pluginId}'`);
        }
      }

      // Check if base command system already has this command
      if (this.baseRegistry.hasCommand && this.baseRegistry.hasCommand(command.name)) {
        this.logger.warn('Plugin command conflicts with base command', {
          subsystem: 'plugins',
          commandName: command.name,
          pluginId
        });
      }

      // Create command descriptor
      const commandDescriptor = new PluginCommandDescriptor(pluginId, command);
      
      // Register the command
      this.pluginCommands.set(command.name, commandDescriptor);

      this.logger.info('Plugin command registered successfully', {
        subsystem: 'plugins',
        pluginId,
        commandName: command.name,
        operation: 'registerPluginCommand'
      });

    } catch (error) {
      this.logger.error('Failed to register plugin command', {
        subsystem: 'plugins',
        pluginId,
        commandName: command.name,
        operation: 'registerPluginCommand'
      }, error);
      throw error;
    }
  }

  /**
   * Unregister a command from a plugin
   * @param {string} pluginId - Plugin identifier
   * @param {string} commandName - Command name
   */
  async unregisterPluginCommand(pluginId, commandName) {
    try {
      const commandDescriptor = this.pluginCommands.get(commandName);
      if (!commandDescriptor || commandDescriptor.pluginId !== pluginId) {
        return false;
      }

      this.pluginCommands.delete(commandName);

      this.logger.info('Plugin command unregistered', {
        subsystem: 'plugins',
        pluginId,
        commandName,
        operation: 'unregisterPluginCommand'
      });

      return true;

    } catch (error) {
      this.logger.error('Failed to unregister plugin command', {
        subsystem: 'plugins',
        pluginId,
        commandName,
        operation: 'unregisterPluginCommand'
      }, error);
      throw error;
    }
  }

  /**
   * Execute a command (plugin or base)
   * @param {string} commandName - Command name
   * @param {Array} args - Command arguments
   * @param {Object} context - Execution context
   */
  async execute(commandName, args, context) {
    const executionStart = Date.now();
    
    try {
      this.logger.debug('Executing command', {
        subsystem: 'plugins',
        commandName,
        argsCount: args.length,
        operation: 'execute'
      });

      // Check if it's a plugin command first
      const pluginCommand = this.pluginCommands.get(commandName);
      if (pluginCommand) {
        const result = await this.executePluginCommand(pluginCommand, args, context);
        
        const executionTime = Date.now() - executionStart;
        this.updateExecutionStats(commandName, executionTime, true);
        
        return result;
      }

      // Fall back to base registry
      if (this.baseRegistry.execute) {
        const result = await this.baseRegistry.execute(commandName, args, context);
        
        const executionTime = Date.now() - executionStart;
        this.updateExecutionStats(commandName, executionTime, true);
        
        return result;
      }

      // Command not found
      this.logger.warn('Command not found', {
        subsystem: 'plugins',
        commandName,
        operation: 'execute'
      });

      return false;

    } catch (error) {
      const executionTime = Date.now() - executionStart;
      this.updateExecutionStats(commandName, executionTime, false);

      this.logger.error('Command execution failed', {
        subsystem: 'plugins',
        commandName,
        executionTime,
        operation: 'execute'
      }, error);

      throw error;
    }
  }

  /**
   * Execute a plugin command
   * @param {PluginCommandDescriptor} commandDescriptor - Command descriptor
   * @param {Array} args - Command arguments
   * @param {Object} context - Execution context
   */
  async executePluginCommand(commandDescriptor, args, context) {
    try {
      // Validate arguments
      const validation = await this.validateCommandArguments(commandDescriptor, args);
      if (!validation.valid) {
        context.responseProcessor?.displayError(
          new Error(`Command validation failed: ${validation.errors.join(', ')}`)
        );
        return true; // Command was handled (even if validation failed)
      }

      // Check permissions
      if (commandDescriptor.permissions.length > 0) {
        const hasPermissions = await this.checkCommandPermissions(commandDescriptor, context);
        if (!hasPermissions) {
          context.responseProcessor?.displayError(
            new Error('Insufficient permissions to execute this command')
          );
          return true;
        }
      }

      // Create plugin execution context
      const pluginContext = {
        ...context,
        commandName: commandDescriptor.name,
        pluginId: commandDescriptor.pluginId,
        args,
        logger: this.logger.child({ 
          subsystem: 'plugins', 
          plugin: commandDescriptor.pluginId,
          command: commandDescriptor.name 
        })
      };

      // Execute the command
      const result = await commandDescriptor.handler(args, pluginContext);

      this.logger.info('Plugin command executed successfully', {
        subsystem: 'plugins',
        pluginId: commandDescriptor.pluginId,
        commandName: commandDescriptor.name,
        operation: 'executePluginCommand'
      });

      return result !== false; // Return true unless explicitly false

    } catch (error) {
      this.logger.error('Plugin command execution failed', {
        subsystem: 'plugins',
        pluginId: commandDescriptor.pluginId,
        commandName: commandDescriptor.name,
        operation: 'executePluginCommand'
      }, error);

      // Display error to user
      if (context.responseProcessor?.displayError) {
        context.responseProcessor.displayError(error);
      }

      return true; // Command was handled (even if it failed)
    }
  }

  /**
   * Get available commands (plugin and base)
   */
  getAvailableCommands() {
    const commands = [];
    
    // Add plugin commands
    for (const [commandName, descriptor] of this.pluginCommands.entries()) {
      commands.push({
        name: commandName,
        description: descriptor.description,
        usage: descriptor.usage,
        pluginId: descriptor.pluginId,
        type: 'plugin'
      });
    }
    
    // Add base commands if available
    if (this.baseRegistry.getAvailableCommands) {
      const baseCommands = this.baseRegistry.getAvailableCommands();
      for (const baseCommand of baseCommands) {
        commands.push({
          ...baseCommand,
          type: 'base'
        });
      }
    }
    
    return commands;
  }

  /**
   * Get command help (plugin or base)
   * @param {string} commandName - Command name
   */
  getCommandHelp(commandName) {
    // Check plugin commands first
    const pluginCommand = this.pluginCommands.get(commandName);
    if (pluginCommand) {
      return {
        name: commandName,
        description: pluginCommand.description,
        usage: pluginCommand.usage,
        pluginId: pluginCommand.pluginId,
        type: 'plugin'
      };
    }
    
    // Fall back to base registry
    if (this.baseRegistry.getCommandHelp) {
      const baseHelp = this.baseRegistry.getCommandHelp(commandName);
      if (baseHelp) {
        return {
          ...baseHelp,
          type: 'base'
        };
      }
    }
    
    return null;
  }

  /**
   * Check if a command exists
   * @param {string} commandName - Command name
   */
  hasCommand(commandName) {
    if (this.pluginCommands.has(commandName)) {
      return true;
    }
    
    if (this.baseRegistry.hasCommand) {
      return this.baseRegistry.hasCommand(commandName);
    }
    
    return false;
  }

  /**
   * Validate command syntax
   * @param {string} commandString - Command string
   */
  validateCommand(commandString) {
    // Basic validation
    if (!commandString || !commandString.startsWith('/')) {
      return {
        valid: false,
        errors: ['Command must start with /']
      };
    }
    
    const parts = commandString.slice(1).split(' ');
    const commandName = parts[0];
    
    if (!this.hasCommand(commandName)) {
      return {
        valid: false,
        errors: [`Unknown command: ${commandName}`]
      };
    }
    
    return {
      valid: true,
      errors: []
    };
  }

  /**
   * Setup plugin event listeners
   */
  setupPluginEventListeners() {
    // This would integrate with the plugin manager's event system
    // For now, we'll manually register commands when plugins are enabled
  }

  /**
   * Register existing plugin commands
   */
  async registerExistingPluginCommands() {
    const registry = this.pluginManager.registry;
    
    for (const [pluginId, pluginDescriptor] of registry.plugins.entries()) {
      if (registry.enabledPlugins.has(pluginId) && pluginDescriptor.plugin.commands) {
        for (const command of pluginDescriptor.plugin.commands) {
          await this.registerPluginCommand(pluginId, command);
        }
      }
    }
  }

  /**
   * Validate command definition
   * @param {Object} command - Command definition
   */
  validateCommandDefinition(command) {
    const errors = [];
    
    if (!command.name || typeof command.name !== 'string') {
      errors.push('Command must have a valid name');
    }
    
    if (!command.handler || typeof command.handler !== 'function') {
      errors.push('Command must have a handler function');
    }
    
    if (command.name && !/^[a-z][a-z0-9_-]*$/i.test(command.name)) {
      errors.push('Command name must be alphanumeric with underscores/hyphens');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate command arguments
   * @param {PluginCommandDescriptor} commandDescriptor - Command descriptor
   * @param {Array} args - Command arguments
   */
  async validateCommandArguments(commandDescriptor, args) {
    const errors = [];
    
    // Check minimum arguments
    if (commandDescriptor.minArgs !== undefined && args.length < commandDescriptor.minArgs) {
      errors.push(`Command requires at least ${commandDescriptor.minArgs} arguments`);
    }
    
    // Check maximum arguments
    if (commandDescriptor.maxArgs !== undefined && args.length > commandDescriptor.maxArgs) {
      errors.push(`Command accepts at most ${commandDescriptor.maxArgs} arguments`);
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check command permissions
   * @param {PluginCommandDescriptor} commandDescriptor - Command descriptor
   * @param {Object} context - Execution context
   */
  async checkCommandPermissions(commandDescriptor, context) {
    // Basic permission check - would be expanded with real permission system
    if (!commandDescriptor.permissions || commandDescriptor.permissions.length === 0) {
      return true;
    }
    
    // For now, allow all commands - TODO: Implement proper permission system
    return true;
  }

  /**
   * Update execution statistics
   */
  updateExecutionStats(commandName, executionTime, success) {
    this.executionStats.totalExecutions++;
    
    if (success) {
      this.executionStats.successfulExecutions++;
    } else {
      this.executionStats.failedExecutions++;
    }
    
    const currentUsage = this.executionStats.commandUsage.get(commandName) || 0;
    this.executionStats.commandUsage.set(commandName, currentUsage + 1);
  }

  /**
   * Get execution statistics
   */
  getExecutionStats() {
    return {
      ...this.executionStats,
      successRate: this.executionStats.totalExecutions > 0 ?
        Math.round((this.executionStats.successfulExecutions / this.executionStats.totalExecutions) * 100) : 0
    };
  }

  /**
   * Cleanup the command registry
   */
  async cleanup() {
    try {
      this.logger.info('Cleaning up plugin command registry', {
        subsystem: 'plugins',
        operation: 'cleanup'
      });

      this.pluginCommands.clear();
      this.executionStats.commandUsage.clear();

    } catch (error) {
      this.logger.error('Error during plugin command registry cleanup', {
        subsystem: 'plugins',
        operation: 'cleanup'
      }, error);
    }
  }
}

/**
 * Plugin command descriptor
 */
class PluginCommandDescriptor {
  constructor(pluginId, command) {
    this.pluginId = pluginId;
    this.name = command.name;
    this.description = command.description || '';
    this.usage = command.usage || `/${command.name}`;
    this.handler = command.handler;
    this.permissions = command.permissions || [];
    this.minArgs = command.minArgs;
    this.maxArgs = command.maxArgs;
    this.metadata = {
      registeredAt: new Date().toISOString()
    };
  }
}

export default PluginCommandRegistry;