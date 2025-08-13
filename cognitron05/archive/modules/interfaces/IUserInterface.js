#!/usr/bin/env node

/**
 * IUserInterface - Interface definition for user interface implementations
 * Defines the contract that all UI implementations must implement
 * 
 * Provides abstraction for different UI implementations:
 * - Console/CLI interfaces (current ResponseProcessor)
 * - Web-based interfaces
 * - API endpoints
 * - Mobile interfaces
 */

/**
 * Base interface for user interface implementations
 */
export class IUserInterface {
  /**
   * Initialize the user interface
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('IUserInterface.initialize() must be implemented by subclass');
  }

  /**
   * Display a message to the user
   * @param {string} message - Message to display
   * @param {Object} options - Display options
   * @returns {Promise<void>}
   */
  async displayMessage(message, options = {}) {
    throw new Error('IUserInterface.displayMessage() must be implemented by subclass');
  }

  /**
   * Get user input
   * @param {string} prompt - Input prompt
   * @param {Object} options - Input options
   * @returns {Promise<string>} User input
   */
  async getUserInput(prompt, options = {}) {
    throw new Error('IUserInterface.getUserInput() must be implemented by subclass');
  }

  /**
   * Display formatted response from AI agent
   * @param {Object} response - AI response object
   * @param {Object} options - Display options
   * @returns {Promise<void>}
   */
  async displayResponse(response, options = {}) {
    throw new Error('IUserInterface.displayResponse() must be implemented by subclass');
  }

  /**
   * Display error message
   * @param {Error} error - Error object
   * @param {Object} context - Error context
   * @returns {Promise<void>}
   */
  async displayError(error, context = {}) {
    throw new Error('IUserInterface.displayError() must be implemented by subclass');
  }

  /**
   * Display status information
   * @param {Object} status - Status object
   * @returns {Promise<void>}
   */
  async displayStatus(status) {
    throw new Error('IUserInterface.displayStatus() must be implemented by subclass');
  }

  /**
   * Cleanup UI resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    throw new Error('IUserInterface.cleanup() must be implemented by subclass');
  }
}

/**
 * Console interface for command-line interactions
 */
export class IConsoleInterface extends IUserInterface {
  /**
   * Display colored text
   * @param {string} text - Text to display
   * @param {string} color - Color name
   * @returns {void}
   */
  displayColored(text, color) {
    throw new Error('IConsoleInterface.displayColored() must be implemented by subclass');
  }

  /**
   * Display typing indicator
   * @param {number} duration - Duration in milliseconds
   * @returns {Promise<void>}
   */
  async showTyping(duration) {
    throw new Error('IConsoleInterface.showTyping() must be implemented by subclass');
  }

  /**
   * Display progress indicator
   * @param {string} message - Progress message
   * @param {Function} task - Task to execute
   * @returns {Promise<*>} Task result
   */
  async showProgress(message, task) {
    throw new Error('IConsoleInterface.showProgress() must be implemented by subclass');
  }

  /**
   * Display formatted table
   * @param {Array} data - Table data
   * @param {Object} options - Table options
   * @returns {void}
   */
  displayTable(data, options = {}) {
    throw new Error('IConsoleInterface.displayTable() must be implemented by subclass');
  }

  /**
   * Display help information
   * @param {Object} helpData - Help information
   * @returns {void}
   */
  displayHelp(helpData) {
    throw new Error('IConsoleInterface.displayHelp() must be implemented by subclass');
  }

  /**
   * Confirm user action
   * @param {string} message - Confirmation message
   * @param {boolean} defaultValue - Default confirmation value
   * @returns {Promise<boolean>} User confirmation
   */
  async confirmAction(message, defaultValue = false) {
    throw new Error('IConsoleInterface.confirmAction() must be implemented by subclass');
  }

  /**
   * Display welcome message
   * @param {Object} systemInfo - System information
   * @returns {void}
   */
  displayWelcome(systemInfo) {
    throw new Error('IConsoleInterface.displayWelcome() must be implemented by subclass');
  }

  /**
   * Clear console screen
   * @returns {void}
   */
  clearScreen() {
    throw new Error('IConsoleInterface.clearScreen() must be implemented by subclass');
  }
}

/**
 * Response processor interface for handling AI responses
 */
export class IResponseProcessor {
  /**
   * Process and display AI response
   * @param {Object} response - AI response object
   * @param {Object} options - Processing options
   * @returns {Promise<void>}
   */
  async processResponse(response, options = {}) {
    throw new Error('IResponseProcessor.processResponse() must be implemented by subclass');
  }

  /**
   * Format response content for display
   * @param {string} content - Response content
   * @param {string} format - Content format (markdown, plain, etc.)
   * @returns {string} Formatted content
   */
  formatContent(content, format = 'markdown') {
    throw new Error('IResponseProcessor.formatContent() must be implemented by subclass');
  }

  /**
   * Display memory operations
   * @param {Array} operations - Memory operations
   * @returns {Promise<void>}
   */
  async displayMemoryOperations(operations) {
    throw new Error('IResponseProcessor.displayMemoryOperations() must be implemented by subclass');
  }

  /**
   * Display tool call information
   * @param {Array} toolCalls - Tool calls
   * @param {Array} results - Tool call results
   * @returns {Promise<void>}
   */
  async displayToolCalls(toolCalls, results) {
    throw new Error('IResponseProcessor.displayToolCalls() must be implemented by subclass');
  }

  /**
   * Display usage statistics
   * @param {Object} usage - Usage statistics
   * @returns {void}
   */
  displayUsage(usage) {
    throw new Error('IResponseProcessor.displayUsage() must be implemented by subclass');
  }

  /**
   * Display memory status
   * @param {Object} memoryStatus - Memory system status
   * @returns {void}
   */
  displayMemoryStatus(memoryStatus) {
    throw new Error('IResponseProcessor.displayMemoryStatus() must be implemented by subclass');
  }

  /**
   * Display search results
   * @param {Array} results - Search results
   * @param {string} query - Search query
   * @returns {void}
   */
  displaySearchResults(results, query) {
    throw new Error('IResponseProcessor.displaySearchResults() must be implemented by subclass');
  }
}

/**
 * Interactive session interface
 */
export class IInteractiveSession {
  /**
   * Start interactive session
   * @param {Object} options - Session options
   * @returns {Promise<void>}
   */
  async startSession(options = {}) {
    throw new Error('IInteractiveSession.startSession() must be implemented by subclass');
  }

  /**
   * End interactive session
   * @returns {Promise<void>}
   */
  async endSession() {
    throw new Error('IInteractiveSession.endSession() must be implemented by subclass');
  }

  /**
   * Handle user input during session
   * @param {string} input - User input
   * @returns {Promise<boolean>} Continue session flag
   */
  async handleInput(input) {
    throw new Error('IInteractiveSession.handleInput() must be implemented by subclass');
  }

  /**
   * Handle session commands
   * @param {string} command - Command string
   * @returns {Promise<boolean>} Command handled flag
   */
  async handleCommand(command) {
    throw new Error('IInteractiveSession.handleCommand() must be implemented by subclass');
  }

  /**
   * Get session statistics
   * @returns {Object} Session statistics
   */
  getSessionStats() {
    throw new Error('IInteractiveSession.getSessionStats() must be implemented by subclass');
  }

  /**
   * Check if session is active
   * @returns {boolean} Session active status
   */
  isSessionActive() {
    throw new Error('IInteractiveSession.isSessionActive() must be implemented by subclass');
  }
}

/**
 * Command interface for handling user commands
 */
export class ICommandInterface {
  /**
   * Register command handler
   * @param {string} command - Command name
   * @param {Function} handler - Command handler function
   * @param {Object} options - Command options
   * @returns {void}
   */
  registerCommand(command, handler, options = {}) {
    throw new Error('ICommandInterface.registerCommand() must be implemented by subclass');
  }

  /**
   * Unregister command handler
   * @param {string} command - Command name
   * @returns {boolean} Unregister success
   */
  unregisterCommand(command) {
    throw new Error('ICommandInterface.unregisterCommand() must be implemented by subclass');
  }

  /**
   * Execute command
   * @param {string} commandString - Command string
   * @param {Object} context - Command context
   * @returns {Promise<boolean>} Command execution result
   */
  async executeCommand(commandString, context) {
    throw new Error('ICommandInterface.executeCommand() must be implemented by subclass');
  }

  /**
   * Get available commands
   * @returns {Array<Object>} Available commands
   */
  getAvailableCommands() {
    throw new Error('ICommandInterface.getAvailableCommands() must be implemented by subclass');
  }

  /**
   * Get command help
   * @param {string} command - Command name
   * @returns {Object|null} Command help or null
   */
  getCommandHelp(command) {
    throw new Error('ICommandInterface.getCommandHelp() must be implemented by subclass');
  }

  /**
   * Validate command syntax
   * @param {string} commandString - Command string
   * @returns {Object} Validation result
   */
  validateCommand(commandString) {
    throw new Error('ICommandInterface.validateCommand() must be implemented by subclass');
  }
}

/**
 * UI event interface for handling user interface events
 */
export class IUIEventHandler {
  /**
   * Handle UI event
   * @param {string} eventType - Event type
   * @param {Object} eventData - Event data
   * @returns {Promise<void>}
   */
  async handleEvent(eventType, eventData) {
    throw new Error('IUIEventHandler.handleEvent() must be implemented by subclass');
  }

  /**
   * Register event listener
   * @param {string} eventType - Event type
   * @param {Function} listener - Event listener function
   * @returns {void}
   */
  addEventListener(eventType, listener) {
    throw new Error('IUIEventHandler.addEventListener() must be implemented by subclass');
  }

  /**
   * Remove event listener
   * @param {string} eventType - Event type
   * @param {Function} listener - Event listener function
   * @returns {void}
   */
  removeEventListener(eventType, listener) {
    throw new Error('IUIEventHandler.removeEventListener() must be implemented by subclass');
  }

  /**
   * Emit UI event
   * @param {string} eventType - Event type
   * @param {Object} eventData - Event data
   * @returns {Promise<void>}
   */
  async emitEvent(eventType, eventData) {
    throw new Error('IUIEventHandler.emitEvent() must be implemented by subclass');
  }
}

/**
 * UI theme interface for styling
 */
export class IUITheme {
  /**
   * Apply theme to UI elements
   * @param {string} themeName - Theme name
   * @returns {void}
   */
  applyTheme(themeName) {
    throw new Error('IUITheme.applyTheme() must be implemented by subclass');
  }

  /**
   * Get available themes
   * @returns {Array<string>} Available theme names
   */
  getAvailableThemes() {
    throw new Error('IUITheme.getAvailableThemes() must be implemented by subclass');
  }

  /**
   * Get current theme
   * @returns {string} Current theme name
   */
  getCurrentTheme() {
    throw new Error('IUITheme.getCurrentTheme() must be implemented by subclass');
  }

  /**
   * Customize theme colors
   * @param {Object} colorMap - Color customizations
   * @returns {void}
   */
  customizeColors(colorMap) {
    throw new Error('IUITheme.customizeColors() must be implemented by subclass');
  }
}

export default {
  IUserInterface,
  IConsoleInterface,
  IResponseProcessor,
  IInteractiveSession,
  ICommandInterface,
  IUIEventHandler,
  IUITheme
};