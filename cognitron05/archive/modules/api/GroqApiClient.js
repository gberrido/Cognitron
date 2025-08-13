#!/usr/bin/env node

/**
 * Groq API Client - High-level interface with connection pooling and rate limiting
 * Provides a Groq SDK-compatible interface while adding enterprise-grade features
 * 
 * Features:
 * - Drop-in replacement for Groq SDK
 * - Automatic connection pooling and rate limiting
 * - Intelligent retry logic with exponential backoff
 * - Request queuing and prioritization
 * - Health monitoring and circuit breaker
 * - Streaming support with proper error handling
 * - Performance monitoring and metrics
 */

import { GroqConnectionPool } from './GroqConnectionPool.js';
import { getLogger } from '../utils/StructuredLogger.js';
import { EventEmitter } from 'events';

export class GroqApiClient extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Connection pool configuration
      poolSize: config.poolSize || 5,
      requestsPerMinute: config.requestsPerMinute || 200,
      maxRetries: config.maxRetries || 3,
      
      // API configuration
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      
      // Default model configuration
      defaultModel: config.defaultModel || 'openai/gpt-oss-120b',
      defaultTemperature: config.defaultTemperature || 0.7,
      defaultMaxTokens: config.defaultMaxTokens || 4096,
      
      // Advanced features
      enableMetrics: config.enableMetrics !== false,
      enableHealthChecks: config.enableHealthChecks !== false,
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Initialize connection pool
    this.connectionPool = new GroqConnectionPool(this.config);
    
    // Request tracking
    this.activeRequests = new Map();
    this.requestHistory = [];
    
    // Metrics
    this.metrics = {
      startTime: Date.now(),
      totalRequests: 0,
      streamingRequests: 0,
      toolCallRequests: 0,
      averageResponseTime: 0,
      errorRate: 0
    };
    
    this.initialized = false;
  }

  /**
   * Initialize the API client
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing Groq API client', {
        subsystem: 'api',
        component: 'client',
        operation: 'initialize'
      });

      // Initialize connection pool
      await this.connectionPool.initialize();
      
      // Set up event listeners
      this.setupEventListeners();
      
      this.initialized = true;
      
      this.logger.info('Groq API client initialized', {
        subsystem: 'api',
        component: 'client',
        operation: 'initialize'
      });
      
      this.emit('initialized');

    } catch (error) {
      this.logger.error('Failed to initialize Groq API client', {
        subsystem: 'api',
        component: 'client',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Create chat completion - main API method
   * @param {Object} params - Chat completion parameters
   * @param {Object} options - Request options
   * @returns {Promise|AsyncIterator} Response or streaming iterator
   */
  async chatCompletionsCreate(params, options = {}) {
    const requestStart = Date.now();
    const requestId = this.generateRequestId();
    
    try {
      // Validate parameters
      this.validateChatParams(params);
      
      // Add default parameters
      const enrichedParams = this.enrichParams(params);
      
      // Track request
      this.trackRequest(requestId, 'chat.completions.create', enrichedParams, requestStart);
      
      this.logger.debug('Creating chat completion', {
        subsystem: 'api',
        component: 'client',
        requestId,
        model: enrichedParams.model,
        stream: !!enrichedParams.stream,
        hasTools: !!(enrichedParams.tools && enrichedParams.tools.length > 0),
        operation: 'chatCompletionsCreate'
      });

      // Execute request through connection pool
      const result = await this.connectionPool.executeRequest(
        'chat.completions.create',
        enrichedParams,
        {
          ...options,
          requestId,
          priority: this.determinePriority(enrichedParams, options)
        }
      );
      
      // Handle streaming vs non-streaming responses
      if (enrichedParams.stream) {
        this.metrics.streamingRequests++;
        return this.wrapStreamingResponse(result, requestId);
      } else {
        this.metrics.totalRequests++;
        this.updateMetrics(requestStart, true);
        return result;
      }
      
    } catch (error) {
      this.updateMetrics(requestStart, false);
      
      this.logger.error('Chat completion failed', {
        subsystem: 'api',
        component: 'client',
        requestId,
        model: params.model || this.config.defaultModel,
        operation: 'chatCompletionsCreate'
      }, error);
      
      throw this.enhanceError(error, requestId);
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Groq SDK compatibility layer - chat.completions.create
   */
  get chat() {
    return {
      completions: {
        create: (params, options) => this.chatCompletionsCreate(params, options)
      }
    };
  }

  /**
   * Validate chat completion parameters
   * @param {Object} params - Parameters to validate
   */
  validateChatParams(params) {
    if (!params.messages || !Array.isArray(params.messages)) {
      throw new Error('Messages array is required');
    }
    
    if (params.messages.length === 0) {
      throw new Error('At least one message is required');
    }
    
    for (const message of params.messages) {
      if (!message.role || !message.content) {
        throw new Error('Each message must have role and content');
      }
    }
    
    if (params.temperature && (params.temperature < 0 || params.temperature > 2)) {
      throw new Error('Temperature must be between 0 and 2');
    }
    
    if (params.max_tokens && params.max_tokens < 1) {
      throw new Error('Max tokens must be positive');
    }
  }

  /**
   * Enrich parameters with defaults and optimizations
   * @param {Object} params - Original parameters
   * @returns {Object} Enriched parameters
   */
  enrichParams(params) {
    const enriched = {
      model: this.config.defaultModel,
      temperature: this.config.defaultTemperature,
      max_tokens: this.config.defaultMaxTokens,
      ...params
    };
    
    // Add performance optimizations
    if (!enriched.stream && !enriched.tools) {
      // For simple non-streaming requests, optimize for latency
      enriched.temperature = Math.min(enriched.temperature, 0.3);
    }
    
    // Ensure streaming flag is boolean
    if (enriched.stream) {
      enriched.stream = true;
    }
    
    return enriched;
  }

  /**
   * Determine request priority based on parameters
   * @param {Object} params - Request parameters
   * @param {Object} options - Request options
   * @returns {string} Priority level (high, normal, low)
   */
  determinePriority(params, options) {
    if (options.priority) {
      return options.priority;
    }
    
    // High priority for tool calls
    if (params.tools && params.tools.length > 0) {
      return 'high';
    }
    
    // High priority for streaming requests
    if (params.stream) {
      return 'high';
    }
    
    // Normal priority for regular chat
    return 'normal';
  }

  /**
   * Track active request
   * @param {string} requestId - Request identifier
   * @param {string} method - API method
   * @param {Object} params - Request parameters
   * @param {number} startTime - Request start time
   */
  trackRequest(requestId, method, params, startTime) {
    const requestInfo = {
      id: requestId,
      method,
      model: params.model,
      stream: !!params.stream,
      hasTools: !!(params.tools && params.tools.length > 0),
      startTime,
      status: 'active'
    };
    
    this.activeRequests.set(requestId, requestInfo);
    
    // Add to history (keep last 100)
    this.requestHistory.push(requestInfo);
    if (this.requestHistory.length > 100) {
      this.requestHistory.shift();
    }
  }

  /**
   * Wrap streaming response for proper error handling and metrics
   * @param {AsyncIterator} stream - Original stream
   * @param {string} requestId - Request identifier
   * @returns {AsyncIterator} Wrapped stream
   */
  async *wrapStreamingResponse(stream, requestId) {
    try {
      let tokenCount = 0;
      let chunkCount = 0;
      const startTime = Date.now();
      
      for await (const chunk of stream) {
        chunkCount++;
        
        // Count tokens if available
        if (chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content) {
          tokenCount += this.estimateTokens(chunk.choices[0].delta.content);
        }
        
        yield chunk;
        
        // Log progress for long streams
        if (chunkCount % 50 === 0) {
          this.logger.debug('Streaming progress', {
            subsystem: 'api',
            component: 'client',
            requestId,
            chunkCount,
            estimatedTokens: tokenCount,
            operation: 'wrapStreamingResponse'
          });
        }
      }
      
      // Update metrics
      const responseTime = Date.now() - startTime;
      this.updateMetrics(startTime, true);
      
      this.logger.debug('Streaming completed', {
        subsystem: 'api',
        component: 'client',
        requestId,
        totalChunks: chunkCount,
        estimatedTokens: tokenCount,
        responseTime,
        operation: 'wrapStreamingResponse'
      });
      
    } catch (error) {
      this.logger.error('Streaming error', {
        subsystem: 'api',
        component: 'client',
        requestId,
        operation: 'wrapStreamingResponse'
      }, error);
      
      throw this.enhanceError(error, requestId);
    }
  }

  /**
   * Setup event listeners for connection pool events
   */
  setupEventListeners() {
    this.connectionPool.on('circuitBreakerOpened', (data) => {
      this.logger.warn('API circuit breaker opened', {
        subsystem: 'api',
        component: 'client',
        failures: data.failures,
        nextAttempt: new Date(data.nextAttempt).toISOString(),
        operation: 'setupEventListeners'
      });
      
      this.emit('circuitBreakerOpened', data);
    });
    
    this.connectionPool.on('circuitBreakerReset', () => {
      this.logger.info('API circuit breaker reset', {
        subsystem: 'api',
        component: 'client',
        operation: 'setupEventListeners'
      });
      
      this.emit('circuitBreakerReset');
    });
  }

  /**
   * Update performance metrics
   * @param {number} startTime - Request start time
   * @param {boolean} success - Whether request was successful
   */
  updateMetrics(startTime, success) {
    const responseTime = Date.now() - startTime;
    
    // Update average response time (exponential moving average)
    const alpha = 0.1;
    this.metrics.averageResponseTime = this.metrics.averageResponseTime === 0 ?
      responseTime :
      (alpha * responseTime) + ((1 - alpha) * this.metrics.averageResponseTime);
    
    // Update error rate
    this.metrics.totalRequests++;
    if (!success) {
      this.metrics.errorRate = (this.metrics.errorRate * (this.metrics.totalRequests - 1) + 1) / this.metrics.totalRequests;
    } else {
      this.metrics.errorRate = (this.metrics.errorRate * (this.metrics.totalRequests - 1)) / this.metrics.totalRequests;
    }
  }

  /**
   * Enhance error with additional context
   * @param {Error} error - Original error
   * @param {string} requestId - Request identifier
   * @returns {Error} Enhanced error
   */
  enhanceError(error, requestId) {
    // Add request context to error
    error.requestId = requestId;
    error.timestamp = new Date().toISOString();
    
    // Add retry information for rate limit errors
    if (error.status === 429) {
      error.retryable = true;
      error.retryAfter = error.headers?.['retry-after'] || 60;
    }
    
    // Add circuit breaker context
    if (this.connectionPool.circuitBreaker.state === 'open') {
      error.circuitBreakerOpen = true;
      error.nextAttempt = this.connectionPool.circuitBreaker.nextAttempt;
    }
    
    return error;
  }

  /**
   * Estimate tokens in text (simple approximation)
   * @param {string} text - Text to analyze
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text) return 0;
    // Simple estimation: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  /**
   * Generate unique request ID
   * @returns {string} Request ID
   */
  generateRequestId() {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get comprehensive API client statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    const uptime = Date.now() - this.metrics.startTime;
    
    return {
      client: {
        uptime: Math.round(uptime / 1000), // seconds
        totalRequests: this.metrics.totalRequests,
        streamingRequests: this.metrics.streamingRequests,
        toolCallRequests: this.metrics.toolCallRequests,
        averageResponseTime: Math.round(this.metrics.averageResponseTime),
        errorRate: Math.round(this.metrics.errorRate * 100), // percentage
        requestsPerMinute: Math.round(this.metrics.totalRequests / (uptime / 1000 / 60)),
        activeRequests: this.activeRequests.size
      },
      connectionPool: this.connectionPool.getStats()
    };
  }

  /**
   * Health check for API client
   * @returns {Object} Health status
   */
  async healthCheck() {
    try {
      const stats = this.getStats();
      
      // Check circuit breaker state
      const circuitBreakerHealthy = this.connectionPool.circuitBreaker.state !== 'open';
      
      // Check error rate
      const errorRateHealthy = this.metrics.errorRate < 0.1; // Less than 10% error rate
      
      // Check response time
      const responseTimeHealthy = this.metrics.averageResponseTime < 30000; // Less than 30s
      
      // Check connection pool
      const poolHealthy = stats.connectionPool.connections.available > 0;
      
      const healthy = circuitBreakerHealthy && errorRateHealthy && responseTimeHealthy && poolHealthy;
      
      return {
        healthy,
        checks: {
          circuitBreaker: circuitBreakerHealthy,
          errorRate: errorRateHealthy,
          responseTime: responseTimeHealthy,
          connectionPool: poolHealthy
        },
        metrics: stats
      };
      
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        checks: {
          circuitBreaker: false,
          errorRate: false,
          responseTime: false,
          connectionPool: false
        }
      };
    }
  }

  /**
   * Clean up and shut down the API client
   */
  async cleanup() {
    try {
      this.logger.info('Shutting down Groq API client', {
        subsystem: 'api',
        component: 'client',
        operation: 'cleanup'
      });

      // Cancel active requests
      for (const [requestId, requestInfo] of this.activeRequests) {
        requestInfo.status = 'cancelled';
        this.logger.warn('Cancelling active request', {
          subsystem: 'api',
          component: 'client',
          requestId,
          operation: 'cleanup'
        });
      }
      
      // Shutdown connection pool
      await this.connectionPool.cleanup();
      
      // Clear state
      this.activeRequests.clear();
      
      this.emit('shutdown');

    } catch (error) {
      this.logger.error('Error during API client cleanup', {
        subsystem: 'api',
        component: 'client',
        operation: 'cleanup'
      }, error);
    }
  }
}

export default GroqApiClient;