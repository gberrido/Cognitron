#!/usr/bin/env node

/**
 * Conversation Context Builder for Cognitron05
 * Handles building conversation context from MemGPT memory architecture
 */

export class ConversationContextBuilder {
  constructor(memorySystem, systemMessage) {
    this.memorySystem = memorySystem;
    this.systemMessage = systemMessage;
  }

  /**
   * Build conversation context with MemGPT memory integration
   * @returns {Array} Array of messages for API call
   */
  buildContext() {
    const messages = [this.systemMessage];

    if (!this.memorySystem) {
      return messages;
    }

    // Add MemGPT FIFO queue context (includes recursive summary if present)
    const fifoContext = this.memorySystem.getFifoQueueContext();
    messages.push(...fifoContext);

    // Add memory pressure warning if needed
    const memoryPressure = this.memorySystem.checkMemoryPressure();
    if (memoryPressure.warning) {
      messages.push({
        role: 'system',
        content: `[MEMORY PRESSURE WARNING]: ${memoryPressure.message} (${memoryPressure.usage}% used)`
      });
    }

    return messages;
  }

  /**
   * Build follow-up context after tool execution
   * @param {Array} toolResults - Results from executed tools
   * @returns {Array} Array of messages for follow-up API call
   */
  buildFollowUpContext(toolResults = []) {
    const messages = this.buildContext();

    // Add tool results summary for memory operations
    if (toolResults.length > 0) {
      const memoryOperations = this.filterMemoryOperations(toolResults);
      
      if (memoryOperations.length > 0) {
        const operationSummary = memoryOperations
          .map(op => `${op.toolName}: ${op.message}`)
          .join('\n');
        
        messages.push({
          role: 'system',
          content: `[Memory Operations Completed]:\n${operationSummary}\n\nNow provide your response to the user.`
        });
      }
    }

    return messages;
  }

  /**
   * Filter tool results for memory-related operations
   * @param {Array} toolResults - All tool results
   * @returns {Array} Memory operation results only
   */
  filterMemoryOperations(toolResults) {
    const memoryToolNames = [
      'core_memory_append',
      'core_memory_replace', 
      'conversation_search',
      'archival_memory_insert',
      'archival_memory_search',
      'get_memory_status'
    ];

    return toolResults.filter(result => 
      memoryToolNames.includes(result.toolName)
    );
  }

  /**
   * Update system message reference
   * @param {Object} systemMessage - New system message
   */
  updateSystemMessage(systemMessage) {
    this.systemMessage = systemMessage;
  }
}

export default ConversationContextBuilder;