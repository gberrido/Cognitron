#!/usr/bin/env node

/**
 * Response Generator for Cognitron05
 * Handles API calls to Groq and response processing with comprehensive error recovery
 */

import { ApiErrorRecovery } from './ApiErrorRecovery.js';

export class ResponseGenerator {
  constructor(groqClient, config) {
    this.groq = groqClient;
    this.config = config;
    
    // Initialize API error recovery system
    this.apiErrorRecovery = new ApiErrorRecovery({
      maxRetries: config.apiMaxRetries || 3,
      baseDelay: config.apiBaseDelay || 1000,
      maxDelay: config.apiMaxDelay || 30000,
      enableFallbacks: config.enableApiFallbacks !== false,
      enableCircuitBreaker: config.enableCircuitBreaker !== false,
      timeout: config.apiTimeout || 30000
    });
  }

  /**
   * Generate primary response from Groq API with comprehensive error recovery
   * @param {Array} messages - Conversation context
   * @param {Array} tools - Available tools
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} API response with metadata
   */
  async generatePrimaryResponse(messages, tools = [], options = {}) {
    const apiOptions = this.buildApiOptions(messages, tools, options);
    
    // Validate messages before API call
    this.validateMessages(messages);
    
    const context = {
      operation: 'primary_response',
      model: apiOptions.model,
      messageCount: messages.length,
      hasTools: tools.length > 0,
      temperature: apiOptions.temperature
    };

    // Use API error recovery system
    const apiCall = () => this.groq.chat.completions.create(apiOptions);
    
    const completion = await this.apiErrorRecovery.executeWithRecovery(apiCall, context, {
      timeout: this.config.apiTimeout || 30000
    });
    
    // Handle fallback responses
    if (completion.isFallback) {
      return {
        content: completion.content,
        toolCalls: [],
        usage: completion.usage,
        hasToolCalls: false,
        model: completion.model,
        temperature: apiOptions.temperature,
        isFallback: true,
        fallbackReason: completion.fallbackReason
      };
    }
    
    // Normal API response
    const response = completion.choices[0].message;

    return {
      content: response.content,
      toolCalls: response.tool_calls || [],
      usage: completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      hasToolCalls: !!(response.tool_calls && response.tool_calls.length > 0),
      model: apiOptions.model,
      temperature: apiOptions.temperature,
      isFallback: false
    };
  }

  /**
   * Generate follow-up response after tool execution with error recovery
   * @param {Array} messages - Updated conversation context
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Follow-up response with metadata
   */
  async generateFollowUpResponse(messages, options = {}) {
    const apiOptions = this.buildApiOptions(messages, [], options);
    
    const context = {
      operation: 'follow_up_response',
      model: apiOptions.model,
      messageCount: messages.length,
      hasTools: false,
      temperature: apiOptions.temperature
    };

    try {
      // Use API error recovery system with more permissive fallback
      const apiCall = () => this.groq.chat.completions.create(apiOptions);
      
      const completion = await this.apiErrorRecovery.executeWithRecovery(apiCall, context, {
        enableFallbacks: true, // Always enable fallbacks for follow-ups
        timeout: this.config.apiTimeout || 20000 // Shorter timeout for follow-ups
      });
      
      // Handle fallback responses
      if (completion.isFallback) {
        return {
          content: completion.content,
          usage: completion.usage,
          isFollowUp: true,
          isFallback: true,
          fallbackReason: completion.fallbackReason,
          model: completion.model,
          temperature: apiOptions.temperature
        };
      }
      
      // Normal API response
      const response = completion.choices[0].message;

      return {
        content: response.content || 'I apologize, but I encountered an issue processing that request.',
        usage: completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        isFollowUp: true,
        isFallback: false,
        model: apiOptions.model,
        temperature: apiOptions.temperature
      };

    } catch (error) {
      // Final fallback for follow-up responses (should rarely be reached)
      console.error('[FOLLOW-UP ERROR] Final fallback triggered:', error.message);
      
      return {
        content: 'I apologize, but I encountered an issue generating a follow-up response. The previous operation may have completed successfully.',
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        isFollowUp: true,
        isFallback: true,
        fallbackReason: 'final_fallback',
        error: {
          type: error.name,
          message: error.message
        }
      };
    }
  }

  /**
   * Build API options from parameters
   * @param {Array} messages - Conversation messages
   * @param {Array} tools - Available tools
   * @param {Object} options - Additional options
   * @returns {Object} Groq API options
   */
  buildApiOptions(messages, tools = [], options = {}) {
    const apiOptions = {
      model: options.model || this.config.model,
      messages,
      temperature: options.temperature || this.config.temperature,
      max_tokens: options.maxTokens || this.config.maxTokens,
      stream: options.stream || false
    };

    // Add tools if available
    if (tools && tools.length > 0) {
      apiOptions.tools = tools;
      apiOptions.tool_choice = options.tool_choice || 'auto';
    }

    return apiOptions;
  }

  /**
   * Combine usage statistics from multiple API calls
   * @param {Object} primaryUsage - Usage from primary response
   * @param {Object} followUpUsage - Usage from follow-up response
   * @returns {Object} Combined usage statistics
   */
  combineUsage(primaryUsage, followUpUsage) {
    if (!followUpUsage) return primaryUsage;

    return {
      prompt_tokens: (primaryUsage?.prompt_tokens || 0) + (followUpUsage?.prompt_tokens || 0),
      completion_tokens: (primaryUsage?.completion_tokens || 0) + (followUpUsage?.completion_tokens || 0),
      total_tokens: (primaryUsage?.total_tokens || 0) + (followUpUsage?.total_tokens || 0)
    };
  }

  /**
   * Handle API errors with context-specific logging
   * @param {Error} error - The error that occurred
   * @param {string} context - Context where error occurred
   */
  handleApiError(error, context) {
    const errorDetails = {
      context,
      message: error.message,
      status: error.status || 'unknown',
      type: error.type || 'api_error',
      timestamp: new Date().toISOString()
    };

    console.error(`[API Error - ${context}]:`, errorDetails);

    // Log specific error types for monitoring
    if (error.status === 429) {
      console.error('[RATE LIMIT] Groq API rate limit exceeded');
    } else if (error.status === 401) {
      console.error('[AUTH ERROR] Invalid API key or authentication failed');
    } else if (error.status >= 500) {
      console.error('[SERVER ERROR] Groq API server error - may be temporary');
    }
  }

  /**
   * Validate messages before API call
   * @param {Array} messages - Messages to validate
   * @returns {boolean} True if messages are valid
   * @throws {Error} If messages are invalid
   */
  validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages array is required and cannot be empty');
    }

    // Check for required system message
    if (!messages[0] || messages[0].role !== 'system') {
      throw new Error('First message must be a system message');
    }

    // Validate message structure
    for (const [index, message] of messages.entries()) {
      if (!message.role || !message.content) {
        throw new Error(`Invalid message at index ${index}: role and content are required`);
      }

      if (!['system', 'user', 'assistant'].includes(message.role)) {
        throw new Error(`Invalid message role at index ${index}: ${message.role}`);
      }
    }

    return true;
  }

  /**
   * Update configuration
   * @param {Object} newConfig - New configuration options
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    
    // Reinitialize API error recovery if API settings changed
    if (newConfig.apiMaxRetries !== undefined || 
        newConfig.apiBaseDelay !== undefined || 
        newConfig.enableApiFallbacks !== undefined ||
        newConfig.enableCircuitBreaker !== undefined ||
        newConfig.apiTimeout !== undefined) {
      
      this.apiErrorRecovery = new ApiErrorRecovery({
        maxRetries: this.config.apiMaxRetries || 3,
        baseDelay: this.config.apiBaseDelay || 1000,
        maxDelay: this.config.apiMaxDelay || 30000,
        enableFallbacks: this.config.enableApiFallbacks !== false,
        enableCircuitBreaker: this.config.enableCircuitBreaker !== false,
        timeout: this.config.apiTimeout || 30000
      });
    }
  }

  /**
   * Get comprehensive API error statistics
   * @returns {Object} API error statistics
   */
  getApiErrorStatistics() {
    return this.apiErrorRecovery.getErrorStatistics();
  }

  /**
   * Reset API error statistics (useful for testing)
   */
  resetApiErrorStatistics() {
    this.apiErrorRecovery.resetStatistics();
  }

  /**
   * Check if API is currently healthy
   * @returns {Object} API health status
   */
  getApiHealthStatus() {
    const stats = this.getApiErrorStatistics();
    const isHealthy = !stats.circuitBreakerStatus.isOpen && stats.errorRate < 50;
    
    return {
      isHealthy,
      errorRate: stats.errorRate,
      fallbackRate: stats.fallbackRate,
      circuitBreakerOpen: stats.circuitBreakerStatus.isOpen,
      rateLimited: stats.rateLimitStatus.isLimited,
      lastError: stats.lastError,
      recommendation: isHealthy ? 
        'API is operating normally' : 
        this.getHealthRecommendation(stats)
    };
  }

  /**
   * Get health recommendations based on API statistics
   * @param {Object} stats - API statistics
   * @returns {string} Health recommendation
   */
  getHealthRecommendation(stats) {
    if (stats.circuitBreakerStatus.isOpen) {
      return 'Circuit breaker is open due to repeated failures. API calls are temporarily blocked.';
    }
    
    if (stats.rateLimitStatus.isLimited) {
      const resetTime = new Date(stats.rateLimitStatus.resetTime);
      return `Rate limited. Will reset at ${resetTime.toLocaleTimeString()}.`;
    }
    
    if (stats.errorRate > 75) {
      return 'High error rate detected. Consider checking API status or network connectivity.';
    }
    
    if (stats.fallbackRate > 50) {
      return 'High fallback usage. API may be experiencing issues.';
    }
    
    return 'API performance is degraded but operational.';
  }
}

export default ResponseGenerator;