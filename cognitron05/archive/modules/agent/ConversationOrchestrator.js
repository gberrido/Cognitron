#!/usr/bin/env node

/**
 * Conversation Orchestrator for Cognitron05
 * Coordinates the complete conversation flow with memory, tools, and response generation
 */

import { ConversationContextBuilder } from './ConversationContextBuilder.js';
import { ToolCallProcessor } from './ToolCallProcessor.js';
import { ResponseGenerator } from './ResponseGenerator.js';

export class ConversationOrchestrator {
  constructor(groqClient, config, memorySystem, toolManager, systemMessage) {
    this.config = config;
    this.memorySystem = memorySystem;
    this.toolManager = toolManager;
    this.systemMessage = systemMessage;

    // Initialize components
    this.contextBuilder = new ConversationContextBuilder(memorySystem, systemMessage);
    this.toolProcessor = new ToolCallProcessor(toolManager, memorySystem);
    this.responseGenerator = new ResponseGenerator(groqClient, config);
  }

  /**
   * Orchestrate complete conversation flow
   * @param {string} userMessage - User's input message
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Complete response with all metadata
   */
  async processConversation(userMessage, options = {}) {
    try {
      // Step 1: Add user message to memory
      this.addMessageToMemory('user', userMessage);

      // Step 2: Update system message with current context
      this.updateSystemMessage();

      // Step 3: Build conversation context
      const messages = this.contextBuilder.buildContext();
      const tools = this.getToolDefinitions();

      // Step 4: Generate primary response
      const primaryResponse = await this.responseGenerator.generatePrimaryResponse(
        messages, 
        tools, 
        options
      );

      // Step 5: Handle tool calls if present
      if (primaryResponse.hasToolCalls) {
        return await this.handleToolCallFlow(primaryResponse, options);
      }

      // Step 6: Handle simple response (no tools)
      return await this.handleSimpleResponse(primaryResponse);

    } catch (error) {
      console.error('Error in conversation orchestration:', error.message);
      return this.createErrorResponse(error);
    }
  }

  /**
   * Handle conversation flow with tool calls
   * @param {Object} primaryResponse - Response containing tool calls
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Complete response with tool results
   */
  async handleToolCallFlow(primaryResponse, options = {}) {
    // Step 1: Add assistant response with tool calls to memory
    this.addMessageToMemory('assistant', primaryResponse.content || '', primaryResponse.toolCalls);

    // Step 2: Process tool calls
    const toolProcessResult = await this.toolProcessor.processToolCalls(
      primaryResponse.toolCalls,
      { ...this.config, ...options }
    );

    // Step 3: Generate follow-up response if needed
    let followUpResponse = null;
    if (this.toolProcessor.requiresFollowUp(toolProcessResult.results)) {
      const followUpMessages = this.contextBuilder.buildFollowUpContext(toolProcessResult.results);
      followUpResponse = await this.responseGenerator.generateFollowUpResponse(followUpMessages, options);
      
      // Add follow-up response to memory
      this.addMessageToMemory('assistant', followUpResponse.content);
    }

    // Step 4: Combine results
    return this.combineToolCallResponse(primaryResponse, toolProcessResult, followUpResponse);
  }

  /**
   * Handle simple response without tool calls
   * @param {Object} primaryResponse - Simple response from API
   * @returns {Promise<Object>} Processed simple response
   */
  async handleSimpleResponse(primaryResponse) {
    // Add assistant response to memory
    this.addMessageToMemory('assistant', primaryResponse.content);

    return {
      content: primaryResponse.content,
      usage: primaryResponse.usage,
      model: primaryResponse.model,
      temperature: primaryResponse.temperature,
      memoryPressure: this.getMemoryPressure()
    };
  }

  /**
   * Combine tool call response with follow-up response
   * @param {Object} primaryResponse - Initial response with tool calls
   * @param {Object} toolProcessResult - Tool processing results
   * @param {Object} followUpResponse - Follow-up response (may be null)
   * @returns {Object} Combined response
   */
  combineToolCallResponse(primaryResponse, toolProcessResult, followUpResponse) {
    const combinedUsage = this.responseGenerator.combineUsage(
      primaryResponse.usage,
      followUpResponse?.usage
    );

    return {
      content: followUpResponse?.content || primaryResponse.content,
      toolCalls: primaryResponse.toolCalls,
      toolResults: toolProcessResult.results,
      toolOutput: toolProcessResult.toolOutput,
      usage: combinedUsage,
      isFollowUp: !!followUpResponse,
      memoryPressure: this.getMemoryPressure(),
      toolSummary: this.toolProcessor.createExecutionSummary(
        primaryResponse.toolCalls,
        toolProcessResult
      )
    };
  }

  /**
   * Add message to memory system
   * @param {string} role - Message role
   * @param {string} content - Message content
   * @param {Array} toolCalls - Optional tool calls metadata
   * @returns {number|null} Message ID
   */
  addMessageToMemory(role, content, toolCalls = null) {
    if (!this.memorySystem || !content || typeof content !== 'string' || content.trim() === '') {
      return null;
    }

    const metadata = {};
    if (toolCalls && toolCalls.length > 0) {
      metadata.tool_calls = toolCalls;
    }

    return this.memorySystem.addToFifoQueue(role, content.trim(), metadata);
  }

  /**
   * Update system message with current context
   * NOTE: This method is called by the orchestrator but actual system message 
   * building is handled by ChatAgent's SystemMessageBuilder
   */
  updateSystemMessage() {
    // The system message update is handled by ChatAgent.updateSystemMessage()
    // which uses SystemMessageBuilder to rebuild with current context.
    // This method is kept for backward compatibility with the orchestration flow.
  }

  /**
   * Get tool definitions from tool manager
   * @returns {Array} Tool definitions or empty array
   */
  getToolDefinitions() {
    return this.toolManager ? this.toolManager.getToolDefinitions() : [];
  }

  /**
   * Get current memory pressure status
   * @returns {Object|null} Memory pressure information
   */
  getMemoryPressure() {
    return this.memorySystem ? this.memorySystem.checkMemoryPressure() : null;
  }

  /**
   * Create error response for failed conversations
   * @param {Error} error - The error that occurred
   * @returns {Object} Error response
   */
  createErrorResponse(error) {
    return {
      content: 'I apologize, but I encountered an error processing your request. Please try again.',
      error: {
        message: error.message,
        type: error.name || 'ConversationError',
        timestamp: new Date().toISOString()
      },
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    };
  }

  /**
   * Update configuration for all components
   * @param {Object} newConfig - New configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.responseGenerator.updateConfig(this.config);
  }

  /**
   * Update system message for all components
   * @param {Object} systemMessage - New system message
   */
  updateSystemMessageReference(systemMessage) {
    this.systemMessage = systemMessage;
    this.contextBuilder.updateSystemMessage(systemMessage);
  }
}

export default ConversationOrchestrator;