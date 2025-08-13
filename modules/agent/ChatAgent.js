#!/usr/bin/env node

/**
 * Chat Agent Core - Main conversation engine for Cognitron
 * Handles OpenAI API interactions with dependency injection
 */

import { Groq } from 'groq-sdk';

export class ChatAgent {
  constructor(config = {}, memorySystem = null, toolManager = null) {
    this.config = {
      apiKey: config.apiKey || process.env.GROQ_API_KEY || 'YOUR_GROQ_API_KEY_HERE',
      model: config.model || 'openai/gpt-oss-120b',
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens || 2048,
      reasoningLevel: config.reasoningLevel || 'low',
      ...config
    };
    
    this.memorySystem = memorySystem;
    this.toolManager = toolManager;
    
    // Initialize Groq client
    this.groq = new Groq({ 
      apiKey: this.config.apiKey 
    });
    
    // Conversation state
    this.conversationHistory = [];
    this.systemMessage = this.buildSystemMessage();
  }

  /**
   * Build the system message based on current configuration
   */
  buildSystemMessage() {
    const reasoningInstructions = {
      low: 'Provide direct, concise responses. Use simple explanations.',
      medium: 'Think through problems systematically. Provide clear reasoning.',
      high: 'Use detailed analysis and step-by-step reasoning. Consider multiple perspectives.'
    };

    return {
      role: 'system',
      content: `You are Cognitron, an advanced AI assistant powered by ${this.config.model} via Groq API.

REASONING LEVEL: ${this.config.reasoningLevel.toUpperCase()} - ${reasoningInstructions[this.config.reasoningLevel]}

You have access to tools for:
- Web search for current information
- Conversation history search for context
- Agent optimization (reasoning, temperature, context management)

Always be helpful, accurate, and adapt your reasoning level to the complexity of the question. Use tools when they would provide better or more current information than your training data.

When asked about your model or identity, respond that you are Cognitron powered by ${this.config.model} through the Groq API.

If you need to adjust your reasoning level, temperature, or other settings for better performance, use the appropriate tools BEFORE providing your main response.`
    };
  }

  /**
   * Update system message when configuration changes
   */
  updateSystemMessage() {
    this.systemMessage = this.buildSystemMessage();
  }

  /**
   * Add message to conversation history
   */
  addMessage(role, content, metadata = {}) {
    const message = { role, content, ...metadata };
    this.conversationHistory.push(message);
    
    // Log to memory system if available and content is valid
    if (this.memorySystem && content && typeof content === 'string' && content.trim()) {
      this.memorySystem.logConversationMessage(role, content, metadata);
    }
    
    return message;
  }

  /**
   * Get conversation context for API call
   */
  getConversationContext() {
    const messages = [this.systemMessage, ...this.conversationHistory];
    
    // TODO: Implement context management (token counting, truncation)
    return messages;
  }

  /**
   * Generate response using OpenAI API
   */
  async generateResponse(userMessage, options = {}) {
    try {
      // Add user message to history
      this.addMessage('user', userMessage);

      // Prepare API call
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

      // Handle tool calls if present
      if (response.tool_calls && this.toolManager) {
        const toolResults = await this.toolManager.executeToolCalls(
          response.tool_calls,
          { ...this.config, ...options },
          this.conversationHistory
        );

        // Add tool call message to history
        this.addMessage('assistant', response.content || '', {
          tool_calls: response.tool_calls
        });

        // Add tool results to history
        for (const result of toolResults.results) {
          const toolContent = result.success 
            ? `Tool result: ${result.message || 'Success'}`
            : `Tool error: ${result.message || 'Failed'}`;
          
          this.addMessage('tool', toolContent, {
            tool_call_id: response.tool_calls[toolResults.results.indexOf(result)]?.id,
            name: result.toolName
          });
        }

        // Always make a follow-up call after tool execution to get the actual response
        if (toolResults.settingsChanged) {
          this.updateSystemMessage();
        }
        
        // Generate follow-up response with tool results as context
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

      // Add assistant response to history
      this.addMessage('assistant', response.content);

      return {
        content: response.content,
        usage: completion.usage
      };

    } catch (error) {
      console.error('Error generating response:', error.message);
      throw error;
    }
  }

  /**
   * Generate follow-up response after tool execution
   */
  async generateFollowUpResponse(options = {}, toolResults = []) {
    try {
      // Get conversation context without the tool result messages for cleaner follow-up
      const baseMessages = [this.systemMessage, ...this.conversationHistory.filter(msg => msg.role !== 'tool')];
      
      // Add tool results summary as context if available
      if (toolResults.length > 0) {
        const webSearchResults = toolResults.filter(result => result.toolName === 'search_web');
        
        if (webSearchResults.length > 0) {
          const webResult = webSearchResults[0];
          if (webResult.success && webResult.results && webResult.results[0]?.type !== 'no_results') {
            // We have real web search results
            const toolSummary = webResult.results.map(item => `${item.title}: ${item.snippet}`).join('\n');
            baseMessages.push({
              role: 'user', 
              content: `Based on the following web search results, please provide a helpful response:\n\n${toolSummary}`
            });
          } else {
            // No real results found, acknowledge the search attempt
            baseMessages.push({
              role: 'user',
              content: `I searched the web for "${webResult.query}" but didn't find current information. Please provide what you can from your knowledge base and suggest how the user might find more current information.`
            });
          }
        }
      }
      
      const messages = baseMessages;
      
      const apiOptions = {
        model: options.model || this.config.model,
        messages,
        temperature: options.temperature || this.config.temperature,
        max_tokens: options.maxTokens || this.config.maxTokens,
        stream: options.stream || false
      };

      const completion = await this.groq.chat.completions.create(apiOptions);
      const response = completion.choices[0].message;

      // Add follow-up response to history
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
    this.updateSystemMessage();
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }

  /**
   * Get agent status
   */
  getStatus() {
    return {
      model: this.config.model,
      temperature: this.config.temperature,
      reasoningLevel: this.config.reasoningLevel,
      historyLength: this.conversationHistory.length,
      hasMemorySystem: !!this.memorySystem,
      hasToolManager: !!this.toolManager,
      availableTools: this.toolManager ? this.toolManager.tools.size : 0
    };
  }
}

export default ChatAgent;