#!/usr/bin/env node

/**
 * IAgent - Interface definition for AI agent implementations
 * Defines the contract that all AI agents must implement
 * 
 * Provides abstraction for different agent implementations:
 * - Chat agents (current ChatAgent)
 * - Task-specific agents
 * - Multi-model agents
 * - Agent chains and workflows
 */

/**
 * Base interface for AI agent implementations
 */
export class IAgent {
  /**
   * Initialize the agent
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('IAgent.initialize() must be implemented by subclass');
  }

  /**
   * Generate response to user input
   * @param {string} message - User message
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Response object
   */
  async generateResponse(message, context = {}) {
    throw new Error('IAgent.generateResponse() must be implemented by subclass');
  }

  /**
   * Update agent configuration
   * @param {Object} config - New configuration
   * @returns {Promise<void>}
   */
  async updateConfig(config) {
    throw new Error('IAgent.updateConfig() must be implemented by subclass');
  }

  /**
   * Get agent status and configuration
   * @returns {Object} Agent status
   */
  getStatus() {
    throw new Error('IAgent.getStatus() must be implemented by subclass');
  }

  /**
   * Get agent capabilities
   * @returns {Object} Agent capabilities
   */
  getCapabilities() {
    throw new Error('IAgent.getCapabilities() must be implemented by subclass');
  }

  /**
   * Health check for agent
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    throw new Error('IAgent.healthCheck() must be implemented by subclass');
  }

  /**
   * Cleanup agent resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    throw new Error('IAgent.cleanup() must be implemented by subclass');
  }
}

/**
 * Chat agent interface for conversational AI
 */
export class IChatAgent extends IAgent {
  /**
   * Start a new conversation
   * @param {Object} options - Conversation options
   * @returns {Promise<string>} Conversation ID
   */
  async startConversation(options = {}) {
    throw new Error('IChatAgent.startConversation() must be implemented by subclass');
  }

  /**
   * End a conversation
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<void>}
   */
  async endConversation(conversationId) {
    throw new Error('IChatAgent.endConversation() must be implemented by subclass');
  }

  /**
   * Get conversation history
   * @param {string} conversationId - Conversation ID
   * @param {Object} options - Query options
   * @returns {Promise<Array>} Conversation messages
   */
  async getConversationHistory(conversationId, options = {}) {
    throw new Error('IChatAgent.getConversationHistory() must be implemented by subclass');
  }

  /**
   * Set conversation context
   * @param {string} conversationId - Conversation ID
   * @param {Object} context - Context data
   * @returns {Promise<void>}
   */
  async setConversationContext(conversationId, context) {
    throw new Error('IChatAgent.setConversationContext() must be implemented by subclass');
  }

  /**
   * Get conversation statistics
   * @param {string} conversationId - Conversation ID
   * @returns {Promise<Object>} Conversation statistics
   */
  async getConversationStats(conversationId) {
    throw new Error('IChatAgent.getConversationStats() must be implemented by subclass');
  }
}

/**
 * Context builder interface for managing conversation context
 */
export class IContextBuilder {
  /**
   * Build context for AI model
   * @param {string} currentMessage - Current user message
   * @param {Object} options - Context building options
   * @returns {Promise<Array>} Context messages array
   */
  async buildContext(currentMessage, options = {}) {
    throw new Error('IContextBuilder.buildContext() must be implemented by subclass');
  }

  /**
   * Build system message
   * @param {Object} context - Context data
   * @returns {Promise<Object>} System message
   */
  async buildSystemMessage(context) {
    throw new Error('IContextBuilder.buildSystemMessage() must be implemented by subclass');
  }

  /**
   * Optimize context for token limits
   * @param {Array} messages - Message array
   * @param {number} maxTokens - Maximum token limit
   * @returns {Promise<Array>} Optimized messages
   */
  async optimizeContext(messages, maxTokens) {
    throw new Error('IContextBuilder.optimizeContext() must be implemented by subclass');
  }

  /**
   * Add context metadata
   * @param {Array} messages - Message array
   * @param {Object} metadata - Metadata to add
   * @returns {Promise<Array>} Enhanced messages
   */
  async addContextMetadata(messages, metadata) {
    throw new Error('IContextBuilder.addContextMetadata() must be implemented by subclass');
  }
}

/**
 * Response generator interface for AI model interaction
 */
export class IResponseGenerator {
  /**
   * Generate response using AI model
   * @param {Array} messages - Context messages
   * @param {Object} config - Generation config
   * @returns {Promise<Object>} Generated response
   */
  async generate(messages, config) {
    throw new Error('IResponseGenerator.generate() must be implemented by subclass');
  }

  /**
   * Generate streaming response
   * @param {Array} messages - Context messages
   * @param {Object} config - Generation config
   * @param {Function} onChunk - Chunk callback
   * @returns {Promise<Object>} Generated response
   */
  async generateStream(messages, config, onChunk) {
    throw new Error('IResponseGenerator.generateStream() must be implemented by subclass');
  }

  /**
   * Validate response from AI model
   * @param {Object} response - AI response
   * @returns {Promise<Object>} Validation result
   */
  async validateResponse(response) {
    throw new Error('IResponseGenerator.validateResponse() must be implemented by subclass');
  }

  /**
   * Post-process AI response
   * @param {Object} response - Raw AI response
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Processed response
   */
  async postProcessResponse(response, context) {
    throw new Error('IResponseGenerator.postProcessResponse() must be implemented by subclass');
  }

  /**
   * Get generation statistics
   * @returns {Object} Generation statistics
   */
  getGenerationStats() {
    throw new Error('IResponseGenerator.getGenerationStats() must be implemented by subclass');
  }
}

/**
 * Tool call processor interface for handling function calls
 */
export class IToolCallProcessor {
  /**
   * Process tool calls from AI response
   * @param {Array} toolCalls - Tool calls array
   * @param {Object} context - Execution context
   * @returns {Promise<Array>} Tool call results
   */
  async processToolCalls(toolCalls, context) {
    throw new Error('IToolCallProcessor.processToolCalls() must be implemented by subclass');
  }

  /**
   * Execute single tool call
   * @param {Object} toolCall - Tool call object
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Tool call result
   */
  async executeToolCall(toolCall, context) {
    throw new Error('IToolCallProcessor.executeToolCall() must be implemented by subclass');
  }

  /**
   * Validate tool call parameters
   * @param {Object} toolCall - Tool call object
   * @returns {Promise<Object>} Validation result
   */
  async validateToolCall(toolCall) {
    throw new Error('IToolCallProcessor.validateToolCall() must be implemented by subclass');
  }

  /**
   * Format tool call results for AI model
   * @param {Array} results - Tool call results
   * @returns {Promise<Array>} Formatted messages
   */
  async formatToolResults(results) {
    throw new Error('IToolCallProcessor.formatToolResults() must be implemented by subclass');
  }

  /**
   * Get tool call execution statistics
   * @returns {Object} Execution statistics
   */
  getToolCallStats() {
    throw new Error('IToolCallProcessor.getToolCallStats() must be implemented by subclass');
  }
}

/**
 * Agent orchestrator interface for coordinating agent components
 */
export class IAgentOrchestrator {
  /**
   * Orchestrate response generation workflow
   * @param {string} message - User message
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Response object
   */
  async orchestrateResponse(message, context) {
    throw new Error('IAgentOrchestrator.orchestrateResponse() must be implemented by subclass');
  }

  /**
   * Handle conversation workflow
   * @param {string} conversationId - Conversation ID
   * @param {string} message - User message
   * @param {Object} context - Request context
   * @returns {Promise<Object>} Response object
   */
  async handleConversation(conversationId, message, context) {
    throw new Error('IAgentOrchestrator.handleConversation() must be implemented by subclass');
  }

  /**
   * Coordinate tool execution workflow
   * @param {Array} toolCalls - Tool calls to execute
   * @param {Object} context - Execution context
   * @returns {Promise<Array>} Tool execution results
   */
  async coordinateToolExecution(toolCalls, context) {
    throw new Error('IAgentOrchestrator.coordinateToolExecution() must be implemented by subclass');
  }

  /**
   * Handle error recovery workflow
   * @param {Error} error - Error to recover from
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Recovery result
   */
  async handleErrorRecovery(error, context) {
    throw new Error('IAgentOrchestrator.handleErrorRecovery() must be implemented by subclass');
  }

  /**
   * Get orchestration statistics
   * @returns {Object} Orchestration statistics
   */
  getOrchestrationStats() {
    throw new Error('IAgentOrchestrator.getOrchestrationStats() must be implemented by subclass');
  }
}

/**
 * Agent response interface
 */
export class IAgentResponse {
  constructor(content, metadata = {}) {
    this.content = content;
    this.metadata = {
      timestamp: new Date().toISOString(),
      responseTime: 0,
      tokenUsage: null,
      toolCalls: [],
      ...metadata
    };
  }

  /**
   * Get response content
   * @returns {string} Response content
   */
  getContent() {
    return this.content;
  }

  /**
   * Get response metadata
   * @returns {Object} Response metadata
   */
  getMetadata() {
    return this.metadata;
  }

  /**
   * Check if response includes tool calls
   * @returns {boolean} Has tool calls
   */
  hasToolCalls() {
    return this.metadata.toolCalls && this.metadata.toolCalls.length > 0;
  }

  /**
   * Get tool calls from response
   * @returns {Array} Tool calls array
   */
  getToolCalls() {
    return this.metadata.toolCalls || [];
  }

  /**
   * Get token usage information
   * @returns {Object|null} Token usage or null
   */
  getTokenUsage() {
    return this.metadata.tokenUsage;
  }

  /**
   * Convert to plain object
   * @returns {Object} Plain object representation
   */
  toObject() {
    return {
      content: this.content,
      metadata: this.metadata
    };
  }
}

export default {
  IAgent,
  IChatAgent,
  IContextBuilder,
  IResponseGenerator,
  IToolCallProcessor,
  IAgentOrchestrator,
  IAgentResponse
};