#!/usr/bin/env node

/**
 * IToolManager - Interface definition for tool management systems
 * Defines the contract that all tool managers must implement
 * 
 * Provides abstraction for different tool management implementations:
 * - Function calling tools (current MemGPTToolManager)
 * - External API integrations
 * - Plugin-based tools
 * - Sandboxed tool execution
 */

/**
 * Base interface for tool manager implementations
 */
export class IToolManager {
  /**
   * Initialize the tool manager
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('IToolManager.initialize() must be implemented by subclass');
  }

  /**
   * Register a tool for use
   * @param {string} name - Tool name
   * @param {Object} toolDefinition - Tool definition (OpenAI function calling format)
   * @param {Function} handler - Tool execution handler
   * @returns {Promise<void>}
   */
  async registerTool(name, toolDefinition, handler) {
    throw new Error('IToolManager.registerTool() must be implemented by subclass');
  }

  /**
   * Unregister a tool
   * @param {string} name - Tool name
   * @returns {Promise<boolean>} Success status
   */
  async unregisterTool(name) {
    throw new Error('IToolManager.unregisterTool() must be implemented by subclass');
  }

  /**
   * Get available tools in OpenAI function calling format
   * @returns {Array<Object>} Available tools array
   */
  getAvailableTools() {
    throw new Error('IToolManager.getAvailableTools() must be implemented by subclass');
  }

  /**
   * Execute a tool call
   * @param {string} toolName - Tool name
   * @param {Object} parameters - Tool parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Tool execution result
   */
  async executeTool(toolName, parameters, context = {}) {
    throw new Error('IToolManager.executeTool() must be implemented by subclass');
  }

  /**
   * Validate tool parameters
   * @param {string} toolName - Tool name
   * @param {Object} parameters - Parameters to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateParameters(toolName, parameters) {
    throw new Error('IToolManager.validateParameters() must be implemented by subclass');
  }

  /**
   * Get tool definition by name
   * @param {string} toolName - Tool name
   * @returns {Object|null} Tool definition or null if not found
   */
  getToolDefinition(toolName) {
    throw new Error('IToolManager.getToolDefinition() must be implemented by subclass');
  }

  /**
   * Check if a tool is available
   * @param {string} toolName - Tool name
   * @returns {boolean} Availability status
   */
  isToolAvailable(toolName) {
    throw new Error('IToolManager.isToolAvailable() must be implemented by subclass');
  }

  /**
   * Get tool execution statistics
   * @returns {Object} Tool usage statistics
   */
  getToolStats() {
    throw new Error('IToolManager.getToolStats() must be implemented by subclass');
  }

  /**
   * Health check for tool manager
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    throw new Error('IToolManager.healthCheck() must be implemented by subclass');
  }

  /**
   * Cleanup tool manager resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    throw new Error('IToolManager.cleanup() must be implemented by subclass');
  }
}

/**
 * Tool execution context interface
 */
export class IToolExecutionContext {
  /**
   * Get user identifier
   * @returns {string} User ID
   */
  getUserId() {
    throw new Error('IToolExecutionContext.getUserId() must be implemented by subclass');
  }

  /**
   * Get session identifier
   * @returns {string} Session ID
   */
  getSessionId() {
    throw new Error('IToolExecutionContext.getSessionId() must be implemented by subclass');
  }

  /**
   * Get execution permissions
   * @returns {Object} Permission set
   */
  getPermissions() {
    throw new Error('IToolExecutionContext.getPermissions() must be implemented by subclass');
  }

  /**
   * Get execution environment
   * @returns {Object} Environment information
   */
  getEnvironment() {
    throw new Error('IToolExecutionContext.getEnvironment() must be implemented by subclass');
  }

  /**
   * Log tool execution event
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   * @returns {void}
   */
  log(level, message, data = {}) {
    throw new Error('IToolExecutionContext.log() must be implemented by subclass');
  }
}

/**
 * Tool security interface for access control
 */
export class IToolSecurity {
  /**
   * Check if user can execute tool
   * @param {string} userId - User identifier
   * @param {string} toolName - Tool name
   * @param {Object} parameters - Tool parameters
   * @returns {Promise<Object>} Authorization result
   */
  async authorize(userId, toolName, parameters) {
    throw new Error('IToolSecurity.authorize() must be implemented by subclass');
  }

  /**
   * Sanitize tool parameters
   * @param {string} toolName - Tool name
   * @param {Object} parameters - Parameters to sanitize
   * @returns {Promise<Object>} Sanitized parameters
   */
  async sanitizeParameters(toolName, parameters) {
    throw new Error('IToolSecurity.sanitizeParameters() must be implemented by subclass');
  }

  /**
   * Validate tool output before returning to user
   * @param {string} toolName - Tool name
   * @param {Object} output - Tool output
   * @returns {Promise<Object>} Validated output
   */
  async validateOutput(toolName, output) {
    throw new Error('IToolSecurity.validateOutput() must be implemented by subclass');
  }

  /**
   * Check if tool execution should be rate limited
   * @param {string} userId - User identifier
   * @param {string} toolName - Tool name
   * @returns {Promise<Object>} Rate limit status
   */
  async checkRateLimit(userId, toolName) {
    throw new Error('IToolSecurity.checkRateLimit() must be implemented by subclass');
  }
}

/**
 * Tool registry interface for plugin management
 */
export class IToolRegistry {
  /**
   * Register a tool plugin
   * @param {string} pluginId - Plugin identifier
   * @param {Object} plugin - Plugin definition
   * @returns {Promise<void>}
   */
  async registerPlugin(pluginId, plugin) {
    throw new Error('IToolRegistry.registerPlugin() must be implemented by subclass');
  }

  /**
   * Unregister a tool plugin
   * @param {string} pluginId - Plugin identifier
   * @returns {Promise<boolean>} Success status
   */
  async unregisterPlugin(pluginId) {
    throw new Error('IToolRegistry.unregisterPlugin() must be implemented by subclass');
  }

  /**
   * List registered plugins
   * @returns {Array<Object>} Plugin list
   */
  getRegisteredPlugins() {
    throw new Error('IToolRegistry.getRegisteredPlugins() must be implemented by subclass');
  }

  /**
   * Get tools provided by a plugin
   * @param {string} pluginId - Plugin identifier
   * @returns {Array<Object>} Tool definitions
   */
  getPluginTools(pluginId) {
    throw new Error('IToolRegistry.getPluginTools() must be implemented by subclass');
  }

  /**
   * Enable/disable a plugin
   * @param {string} pluginId - Plugin identifier
   * @param {boolean} enabled - Enable status
   * @returns {Promise<void>}
   */
  async setPluginEnabled(pluginId, enabled) {
    throw new Error('IToolRegistry.setPluginEnabled() must be implemented by subclass');
  }

  /**
   * Check plugin health
   * @param {string} pluginId - Plugin identifier
   * @returns {Promise<Object>} Health status
   */
  async checkPluginHealth(pluginId) {
    throw new Error('IToolRegistry.checkPluginHealth() must be implemented by subclass');
  }
}

/**
 * Tool execution result interface
 */
export class IToolExecutionResult {
  constructor(success, data, error = null, metadata = {}) {
    this.success = success;
    this.data = data;
    this.error = error;
    this.metadata = {
      timestamp: new Date().toISOString(),
      executionTime: 0,
      ...metadata
    };
  }

  /**
   * Check if execution was successful
   * @returns {boolean} Success status
   */
  isSuccess() {
    return this.success === true;
  }

  /**
   * Get execution result data
   * @returns {*} Result data
   */
  getData() {
    return this.data;
  }

  /**
   * Get execution error
   * @returns {Error|null} Error object or null
   */
  getError() {
    return this.error;
  }

  /**
   * Get execution metadata
   * @returns {Object} Metadata object
   */
  getMetadata() {
    return this.metadata;
  }

  /**
   * Convert to plain object
   * @returns {Object} Plain object representation
   */
  toObject() {
    return {
      success: this.success,
      data: this.data,
      error: this.error ? {
        message: this.error.message,
        name: this.error.name,
        stack: this.error.stack
      } : null,
      metadata: this.metadata
    };
  }
}

export default {
  IToolManager,
  IToolExecutionContext,
  IToolSecurity,
  IToolRegistry,
  IToolExecutionResult
};