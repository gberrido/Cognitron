#!/usr/bin/env node

/**
 * MemGPT Chat Agent - Core conversation engine for Cognitron05
 * Integrates with MemGPT memory system and memory management tools
 */

import { ConversationOrchestrator } from './ConversationOrchestrator.js';
import { SystemMessageBuilder } from './SystemMessageBuilder.js';
import { CHAT_AGENT_CONSTANTS } from '../config/SystemConstants.js';
import { GroqApiClient } from '../api/GroqApiClient.js';

export class ChatAgent {
  constructor(config = {}, memorySystem = null, toolManager = null) {
    this.config = {
      apiKey: config.apiKey || this.getRequiredApiKey(),
      model: config.model || CHAT_AGENT_CONSTANTS.DEFAULT_MODEL,
      temperature: config.temperature || CHAT_AGENT_CONSTANTS.DEFAULT_TEMPERATURE,
      maxTokens: config.maxTokens || CHAT_AGENT_CONSTANTS.DEFAULT_MAX_TOKENS,
      reasoningLevel: config.reasoningLevel || CHAT_AGENT_CONSTANTS.REASONING_LEVELS.LOW,
      ...config
    };
    
    this.memorySystem = memorySystem;
    this.toolManager = toolManager;
    
    // Initialize Groq API client with connection pooling
    this.groq = new GroqApiClient({ 
      apiKey: this.config.apiKey,
      defaultModel: this.config.model,
      defaultTemperature: this.config.temperature,
      defaultMaxTokens: this.config.maxTokens,
      // Connection pool settings
      poolSize: this.config.poolSize || 3,
      requestsPerMinute: this.config.requestsPerMinute || 200,
      maxRetries: this.config.maxRetries || 3
    });
    
    // Initialize the API client and connection pool
    this.initializeApiClient();
    
    // Initialize system message builder
    this.systemMessageBuilder = new SystemMessageBuilder(this.config, this.memorySystem);
    this.systemMessage = this.systemMessageBuilder.buildSystemMessage();

    // Initialize conversation orchestrator with modular components
    this.orchestrator = new ConversationOrchestrator(
      this.groq,
      this.config,
      this.memorySystem,
      this.toolManager,
      this.systemMessage
    );
  }

  /**
   * Get API key from environment variables with proper error handling
   * @returns {string} The API key
   * @throws {Error} If API key is not found in environment variables
   */
  getRequiredApiKey() {
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(
        'GROQ_API_KEY environment variable is required but not found.\n' +
        'Please set your Groq API key:\n' +
        '  export GROQ_API_KEY="your-api-key-here"\n' +
        'Or create a .env file with:\n' +
        '  GROQ_API_KEY=your-api-key-here'
      );
    }
    
    return apiKey.trim();
  }

  /**
   * DEPRECATED: Build the system message based on current configuration
   * This method has been replaced by SystemMessageBuilder
   * @deprecated Use SystemMessageBuilder.buildSystemMessage() instead
   */
  buildSystemMessage() {
    console.warn('buildSystemMessage() is deprecated. Use SystemMessageBuilder instead.');
    return this.systemMessageBuilder.buildSystemMessage();
  }

  /**
   * Update system message when configuration changes
   */
  updateSystemMessage() {
    this.systemMessage = this.systemMessageBuilder.buildSystemMessage();
    if (this.orchestrator) {
      this.orchestrator.updateSystemMessageReference(this.systemMessage);
    }
  }

  /**
   * Add message to MemGPT FIFO queue
   */
  addMessage(role, content, metadata = {}) {
    if (this.memorySystem && content && typeof content === 'string' && content.trim()) {
      return this.memorySystem.addToFifoQueue(role, content, metadata);
    }
    return null;
  }

  /**
   * Get conversation context using MemGPT memory architecture
   */
  getConversationContext() {
    if (!this.memorySystem) {
      return [this.systemMessage];
    }

    // Get MemGPT context: system message + working context + FIFO queue + recursive summary
    const messages = [this.systemMessage];
    
    // Add FIFO queue context (includes recursive summary if present)
    const fifoContext = this.memorySystem.getFifoQueueContext();
    messages.push(...fifoContext);

    // Check memory pressure and warn if needed
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
   * Generate response using modular orchestrator
   */
  async generateResponse(userMessage, options = {}) {
    return await this.orchestrator.processConversation(userMessage, options);
  }

  /**
   * DEPRECATED: Legacy response generation - kept for reference
   * This method has been replaced by the modular ConversationOrchestrator
   */
  async generateResponseLegacy(userMessage, options = {}) {
    try {
      // Add user message to MemGPT FIFO queue
      this.addMessage('user', userMessage);

      // Update system message with current working context
      this.updateSystemMessage();

      // Prepare API call with MemGPT context
      const messages = this.getConversationContext();
      const tools = this.toolManager ? this.toolManager.getToolDefinitions() : undefined;
      
      const apiOptions = {
        model: options.model || this.config.model,
        messages,
        temperature: options.temperature || this.config.temperature,
        max_tokens: options.maxTokens || this.config.maxTokens,
        stream: options.stream || false
      };

      if (tools && tools.length > 0) {
        apiOptions.tools = tools;
        apiOptions.tool_choice = 'auto';
      }

      // Make API call
      const completion = await this.groq.chat.completions.create(apiOptions);
      const response = completion.choices[0].message;

      // Handle memory management tool calls
      if (response.tool_calls && this.toolManager) {
        const toolResults = await this.toolManager.executeToolCalls(
          response.tool_calls,
          { ...this.config, ...options }
        );

        // Add tool call response to memory
        this.addMessage('assistant', response.content || '', {
          tool_calls: response.tool_calls
        });

        // Generate follow-up response after memory operations
        const followUpResponse = await this.generateFollowUpResponse(options, toolResults.results);
        
        // Format tool results for display
        const toolOutput = this.toolManager.formatToolResults(toolResults.results);
        
        return {
          content: followUpResponse.content,
          toolCalls: response.tool_calls,
          toolResults: toolResults.results,
          toolOutput,
          usage: {
            prompt_tokens: (completion.usage?.prompt_tokens || 0) + (followUpResponse.usage?.prompt_tokens || 0),
            completion_tokens: (completion.usage?.completion_tokens || 0) + (followUpResponse.usage?.completion_tokens || 0),
            total_tokens: (completion.usage?.total_tokens || 0) + (followUpResponse.usage?.total_tokens || 0)
          },
          isFollowUp: true
        };
      }

      // Add assistant response to MemGPT FIFO queue
      this.addMessage('assistant', response.content);

      return {
        content: response.content,
        usage: completion.usage
      };

    } catch (error) {
      console.error('Error generating response:', error.message);
      throw error;
    }
  } // End of generateResponseLegacy - DEPRECATED

  /**
   * DEPRECATED: Generate follow-up response after memory management operations
   * This method is now handled by ConversationOrchestrator
   */
  async generateFollowUpResponse(options = {}, toolResults = []) {
    try {
      // Get fresh context after memory operations
      const messages = this.getConversationContext();
      
      // Add tool results summary for memory operations
      if (toolResults.length > 0) {
        const memoryOperations = toolResults.filter(result => 
          ['core_memory_append', 'core_memory_replace', 'conversation_search', 
           'archival_memory_insert', 'archival_memory_search'].includes(result.toolName)
        );
        
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
      
      const apiOptions = {
        model: options.model || this.config.model,
        messages,
        temperature: options.temperature || this.config.temperature,
        max_tokens: options.maxTokens || this.config.maxTokens,
        stream: options.stream || false
      };

      const completion = await this.groq.chat.completions.create(apiOptions);
      const response = completion.choices[0].message;

      // Add follow-up response to MemGPT memory
      this.addMessage('assistant', response.content);

      return {
        content: response.content || 'I apologize, but I encountered an issue processing that request.',
        usage: completion.usage,
        isFollowUp: true
      };

    } catch (error) {
      console.error('Error generating follow-up response:', error.message);
      throw error;
    }
  }

  /**
   * Update agent configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Update system message builder with new config
    this.systemMessageBuilder.updateConfig(this.config);
    
    if (this.orchestrator) {
      this.orchestrator.updateConfig(this.config);
    }
    this.updateSystemMessage();
  }

  /**
   * Get agent status including MemGPT memory status
   */
  getStatus() {
    const memoryStatus = this.memorySystem ? this.memorySystem.getStatus() : null;
    
    return {
      model: this.config.model,
      temperature: this.config.temperature,
      reasoningLevel: this.config.reasoningLevel,
      hasMemorySystem: !!this.memorySystem,
      hasToolManager: !!this.toolManager,
      availableTools: this.toolManager ? (this.toolManager.tools ? this.toolManager.tools.size : this.toolManager.registry ? this.toolManager.registry.tools.size : 0) : 0,
      memoryStatus
    };
  }

  /**
   * Initialize API client and connection pool
   */
  async initializeApiClient() {
    try {
      await this.groq.initialize();
    } catch (error) {
      console.warn('Warning: API client initialization failed, will initialize lazily:', error.message);
      // Connection pool will initialize on first request
    }
  }

  /**
   * Save memory state (called on shutdown)
   */
  async saveMemoryState() {
    if (this.memorySystem) {
      await this.memorySystem.cleanup();
    }
    
    // Cleanup API client
    if (this.groq) {
      await this.groq.cleanup();
    }
  }
}

export default ChatAgent;