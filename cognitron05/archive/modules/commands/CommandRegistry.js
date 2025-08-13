#!/usr/bin/env node

/**
 * Command Registry for Cognitron05
 * Centralized command registration and dispatch system
 * Supports modular command handlers with validation and error handling
 */

import { InputValidator } from '../utils/InputValidator.js';

export class CommandRegistry {
  constructor() {
    this.commands = new Map();
    this.aliases = new Map();
  }

  /**
   * Register a command handler
   * @param {string} name - Command name
   * @param {Object} handler - Command handler object
   */
  register(name, handler) {
    // Validate handler has required methods
    if (!handler.execute || typeof handler.execute !== 'function') {
      throw new Error(`Command handler for '${name}' must have an execute method`);
    }

    this.commands.set(name, {
      ...handler,
      name
    });

    // Register aliases if provided
    if (handler.aliases && Array.isArray(handler.aliases)) {
      handler.aliases.forEach(alias => {
        this.aliases.set(alias, name);
      });
    }
  }

  /**
   * Get command handler by name or alias
   * @param {string} name - Command name or alias
   * @returns {Object|null} Command handler or null if not found
   */
  get(name) {
    // Check direct command name first
    if (this.commands.has(name)) {
      return this.commands.get(name);
    }

    // Check aliases
    const aliasTarget = this.aliases.get(name);
    if (aliasTarget && this.commands.has(aliasTarget)) {
      return this.commands.get(aliasTarget);
    }

    return null;
  }

  /**
   * Check if command exists
   * @param {string} name - Command name or alias
   * @returns {boolean} True if command exists
   */
  has(name) {
    return this.commands.has(name) || this.aliases.has(name);
  }

  /**
   * Execute a command with validation and error handling
   * @param {string} name - Command name
   * @param {Array} args - Command arguments
   * @param {Object} context - Execution context
   * @returns {boolean} True if command was handled
   */
  async execute(name, args, context) {
    const handler = this.get(name);
    
    if (!handler) {
      return false; // Command not found
    }

    try {
      // Validate arguments if handler specifies validation
      if (handler.validation) {
        const validation = InputValidator.validateCommandArgs(args, handler.validation);
        if (!validation.valid) {
          context.responseProcessor.displayError(
            InputValidator.createValidationError(
              `${handler.name} command error: ${validation.error}. ${handler.usage || ''}`,
              validation.code
            )
          );
          return true; // Command was handled (with error)
        }
      }

      // Execute command with proper context
      const result = await handler.execute(args, context);
      return result !== false; // Return true unless explicitly returning false
      
    } catch (error) {
      // Handle command execution errors
      context.responseProcessor.displayError(error);
      console.error(`[ERROR] Command '${name}' execution failed:`, error.message);
      return true; // Command was handled (with error)
    }
  }

  /**
   * Get list of all registered commands
   * @returns {Array} Array of command objects with metadata
   */
  list() {
    return Array.from(this.commands.values()).map(handler => ({
      name: handler.name,
      description: handler.description || 'No description available',
      usage: handler.usage || `/${handler.name}`,
      category: handler.category || 'General',
      aliases: handler.aliases || []
    }));
  }

  /**
   * Get commands by category
   * @param {string} category - Category name
   * @returns {Array} Array of commands in the category
   */
  getByCategory(category) {
    return this.list().filter(cmd => cmd.category === category);
  }

  /**
   * Generate help text for all commands or specific category
   * @param {string} category - Optional category filter
   * @returns {string} Formatted help text
   */
  generateHelp(category = null) {
    const commands = category ? this.getByCategory(category) : this.list();
    
    if (commands.length === 0) {
      return category ? `No commands found in category: ${category}` : 'No commands registered';
    }

    // Group by category
    const grouped = commands.reduce((acc, cmd) => {
      const cat = cmd.category;
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(cmd);
      return acc;
    }, {});

    let help = '';
    
    for (const [cat, cmds] of Object.entries(grouped)) {
      help += `\n${cat} Commands:\n`;
      cmds.forEach(cmd => {
        const aliases = cmd.aliases.length > 0 ? ` (aliases: ${cmd.aliases.join(', ')})` : '';
        help += `  ${cmd.usage.padEnd(20)} - ${cmd.description}${aliases}\n`;
      });
    }

    return help.trim();
  }
}

export default CommandRegistry;