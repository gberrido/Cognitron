#!/usr/bin/env node

/**
 * Base Command Handler for Cognitron05
 * Provides common functionality for all command handlers
 */

import { InputValidator } from '../utils/InputValidator.js';

export class BaseCommandHandler {
  constructor(config = {}) {
    this.name = config.name || 'unknown';
    this.description = config.description || 'No description available';
    this.usage = config.usage || `/${this.name}`;
    this.category = config.category || 'General';
    this.aliases = config.aliases || [];
    this.validation = config.validation || null;
  }

  /**
   * Execute the command - must be implemented by subclasses
   * @param {Array} args - Command arguments
   * @param {Object} context - Execution context with access to all systems
   * @returns {boolean} True if command was handled successfully
   */
  async execute(args, context) {
    throw new Error(`Command handler '${this.name}' must implement execute method`);
  }

  /**
   * Validate command arguments using the validation config
   * @param {Array} args - Arguments to validate
   * @returns {Object} Validation result
   */
  validateArgs(args) {
    if (!this.validation) {
      return { valid: true, value: args };
    }

    return InputValidator.validateCommandArgs(args, this.validation);
  }

  /**
   * Display error with consistent formatting
   * @param {Object} context - Execution context
   * @param {string} message - Error message
   * @param {string} code - Error code
   */
  displayError(context, message, code = 'COMMAND_ERROR') {
    const error = new Error(message);
    error.code = code;
    context.responseProcessor.displayError(error);
  }

  /**
   * Display success message with consistent formatting
   * @param {Object} context - Execution context
   * @param {string} message - Success message
   */
  displaySuccess(context, message) {
    context.responseProcessor.displaySuccess(message);
  }

  /**
   * Display info message with consistent formatting
   * @param {Object} context - Execution context
   * @param {string} message - Info message
   */
  displayInfo(context, message) {
    context.responseProcessor.displayInfo(message);
  }

  /**
   * Display warning message with consistent formatting
   * @param {Object} context - Execution context
   * @param {string} message - Warning message
   */
  displayWarning(context, message) {
    context.responseProcessor.displayWarning(message);
  }

  /**
   * Get command metadata
   * @returns {Object} Command metadata
   */
  getMetadata() {
    return {
      name: this.name,
      description: this.description,
      usage: this.usage,
      category: this.category,
      aliases: this.aliases,
      validation: this.validation
    };
  }
}

export default BaseCommandHandler;