#!/usr/bin/env node

/**
 * Tool Call Processor for Cognitron05
 * Handles execution and processing of tool calls with memory integration
 */

export class ToolCallProcessor {
  constructor(toolManager, memorySystem) {
    this.toolManager = toolManager;
    this.memorySystem = memorySystem;
  }

  /**
   * Process tool calls and execute them with proper error handling
   * @param {Array} toolCalls - Tool calls from API response
   * @param {Object} config - Configuration options
   * @returns {Promise<Object>} Tool execution results
   */
  async processToolCalls(toolCalls, config = {}) {
    if (!this.toolManager || !toolCalls || toolCalls.length === 0) {
      return {
        results: [],
        hasMemoryOperations: false,
        executed: false
      };
    }

    try {
      // Execute all tool calls
      const toolResults = await this.toolManager.executeToolCalls(toolCalls, config);

      // Classify tool results
      const classification = this.classifyToolResults(toolResults.results);

      return {
        results: toolResults.results,
        hasMemoryOperations: classification.hasMemoryOperations,
        memoryOperations: classification.memoryOperations,
        otherOperations: classification.otherOperations,
        executed: true,
        toolOutput: this.toolManager.formatToolResults(toolResults.results)
      };

    } catch (error) {
      console.error('Error executing tool calls:', error.message);
      throw new Error(`Tool execution failed: ${error.message}`);
    }
  }

  /**
   * Classify tool results into memory operations and others
   * @param {Array} toolResults - Results from tool execution
   * @returns {Object} Classification of tool results
   */
  classifyToolResults(toolResults) {
    const memoryToolNames = new Set([
      'core_memory_append',
      'core_memory_replace',
      'conversation_search',
      'archival_memory_insert',
      'archival_memory_search',
      'get_memory_status',
      'pause_heartbeats'
    ]);

    const memoryOperations = [];
    const otherOperations = [];

    toolResults.forEach(result => {
      if (memoryToolNames.has(result.toolName)) {
        memoryOperations.push(result);
      } else {
        otherOperations.push(result);
      }
    });

    return {
      hasMemoryOperations: memoryOperations.length > 0,
      memoryOperations,
      otherOperations
    };
  }

  /**
   * Add message to memory system with tool call metadata
   * @param {string} role - Message role (assistant, user, system)
   * @param {string} content - Message content
   * @param {Array} toolCalls - Optional tool calls metadata
   * @returns {number|null} Message ID or null if failed
   */
  addMessageToMemory(role, content, toolCalls = null) {
    if (!this.memorySystem) {
      return null;
    }

    const metadata = {};
    if (toolCalls && toolCalls.length > 0) {
      metadata.tool_calls = toolCalls;
    }

    return this.memorySystem.addToFifoQueue(role, content, metadata);
  }

  /**
   * Check if tool calls require follow-up response generation
   * @param {Array} toolResults - Results from tool execution
   * @returns {boolean} True if follow-up response needed
   */
  requiresFollowUp(toolResults) {
    if (!toolResults || toolResults.length === 0) {
      return false;
    }

    // Memory operations typically require follow-up responses
    const classification = this.classifyToolResults(toolResults);
    return classification.hasMemoryOperations;
  }

  /**
   * Create tool execution summary for logging/debugging
   * @param {Array} toolCalls - Original tool calls
   * @param {Object} processResult - Result from processToolCalls
   * @returns {Object} Execution summary
   */
  createExecutionSummary(toolCalls, processResult) {
    return {
      toolCallCount: toolCalls ? toolCalls.length : 0,
      executed: processResult.executed,
      resultsCount: processResult.results.length,
      memoryOperationsCount: processResult.memoryOperations ? processResult.memoryOperations.length : 0,
      otherOperationsCount: processResult.otherOperations ? processResult.otherOperations.length : 0,
      hasErrors: processResult.results.some(r => r.error),
      requiresFollowUp: this.requiresFollowUp(processResult.results)
    };
  }
}

export default ToolCallProcessor;