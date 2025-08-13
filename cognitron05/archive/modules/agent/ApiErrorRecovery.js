#!/usr/bin/env node

/**
 * API Error Recovery System for Cognitron05
 * Provides comprehensive error handling, retry logic, fallback responses, and graceful degradation
 * for all Groq API interactions
 */

import { API_ERROR_CONSTANTS } from '../config/SystemConstants.js';

/**
 * Specialized API error types
 */
export class ApiError extends Error {
  constructor(message, status = null, type = 'api_error', context = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.type = type;
    this.context = context;
    this.timestamp = new Date().toISOString();
    this.retryable = this.determineRetryability();
    this.severity = this.determineSeverity();
    
    Error.captureStackTrace(this, ApiError);
  }

  determineRetryability() {
    const { HTTP_STATUS_CODES } = API_ERROR_CONSTANTS;
    
    // Non-retryable errors
    if (this.status === HTTP_STATUS_CODES.UNAUTHORIZED || this.status === HTTP_STATUS_CODES.FORBIDDEN) return false; // Auth errors
    if (this.status === 400) return false; // Bad request
    if (this.status === 404) return false; // Not found
    
    // Retryable errors
    if (this.status === HTTP_STATUS_CODES.TOO_MANY_REQUESTS) return true; // Rate limit
    if (this.status >= HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR) return true; // Server errors
    if (this.type === 'network_error') return true; // Network issues
    if (this.type === 'timeout_error') return true; // Timeouts
    
    return false; // Default to non-retryable for unknown errors
  }

  determineSeverity() {
    const { HTTP_STATUS_CODES } = API_ERROR_CONSTANTS;
    
    if (this.status === HTTP_STATUS_CODES.UNAUTHORIZED || this.status === HTTP_STATUS_CODES.FORBIDDEN) return 'fatal'; // Auth issues
    if (this.status === HTTP_STATUS_CODES.TOO_MANY_REQUESTS) return 'warning'; // Rate limits
    if (this.status >= HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR) return 'error'; // Server errors
    if (this.type === 'timeout_error') return 'warning'; // Timeouts
    
    return 'error'; // Default severity
  }
}

export class ApiRateLimitError extends ApiError {
  constructor(message, retryAfter = null, context = {}) {
    super(message, API_ERROR_CONSTANTS.HTTP_STATUS_CODES.TOO_MANY_REQUESTS, 'rate_limit', { ...context, retryAfter });
    this.name = 'ApiRateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class ApiTimeoutError extends ApiError {
  constructor(message, timeout = null, context = {}) {
    super(message, null, 'timeout_error', { ...context, timeout });
    this.name = 'ApiTimeoutError';
    this.timeout = timeout;
  }
}

export class ApiNetworkError extends ApiError {
  constructor(message, code = null, context = {}) {
    super(message, null, 'network_error', { ...context, code });
    this.name = 'ApiNetworkError';
    this.code = code;
  }
}

export class ApiAuthenticationError extends ApiError {
  constructor(message, context = {}) {
    super(message, API_ERROR_CONSTANTS.HTTP_STATUS_CODES.UNAUTHORIZED, 'authentication_error', context);
    this.name = 'ApiAuthenticationError';
    this.retryable = false;
  }
}

/**
 * Comprehensive API Error Recovery System
 */
export class ApiErrorRecovery {
  constructor(options = {}) {
    this.options = {
      maxRetries: options.maxRetries || API_ERROR_CONSTANTS.MAX_RETRIES,
      baseDelay: options.baseDelay || API_ERROR_CONSTANTS.BASE_DELAY,
      maxDelay: options.maxDelay || API_ERROR_CONSTANTS.MAX_DELAY,
      backoffMultiplier: options.backoffMultiplier || API_ERROR_CONSTANTS.BACKOFF_MULTIPLIER,
      enableFallbacks: options.enableFallbacks !== false ? API_ERROR_CONSTANTS.ENABLE_FALLBACKS : false,
      enableCircuitBreaker: options.enableCircuitBreaker !== false ? API_ERROR_CONSTANTS.ENABLE_CIRCUIT_BREAKER : false,
      circuitBreakerThreshold: options.circuitBreakerThreshold || API_ERROR_CONSTANTS.CIRCUIT_BREAKER_THRESHOLD,
      circuitBreakerTimeout: options.circuitBreakerTimeout || API_ERROR_CONSTANTS.CIRCUIT_BREAKER_TIMEOUT,
      ...options
    };
    
    // Circuit breaker state
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: 0,
      isOpen: false
    };
    
    // Error statistics
    this.errorStats = {
      totalRequests: 0,
      totalErrors: 0,
      errorsByType: new Map(),
      retryAttempts: 0,
      fallbackUsages: 0,
      lastError: null
    };
    
    // Rate limiting state
    this.rateLimitState = {
      isLimited: false,
      resetTime: 0,
      retryAfter: 0
    };
  }

  /**
   * Main API call with comprehensive error recovery
   * @param {Function} apiCall - Function that makes the API call
   * @param {Object} context - Request context
   * @param {Object} options - Call-specific options
   * @returns {Promise<Object>} API response or fallback response
   */
  async executeWithRecovery(apiCall, context = {}, options = {}) {
    const callOptions = { ...this.options, ...options };
    let lastError = null;
    
    this.errorStats.totalRequests++;
    
    // Check circuit breaker
    if (this.isCircuitBreakerOpen()) {
      console.warn('[CIRCUIT BREAKER] API calls blocked due to repeated failures');
      return await this.generateFallbackResponse(context, 'circuit_breaker');
    }
    
    // Check rate limit state
    if (this.isRateLimited()) {
      const waitTime = this.rateLimitState.resetTime - Date.now();
      if (waitTime > 0) {
        console.warn(`[RATE LIMIT] Waiting ${waitTime}ms before retry`);
        await this.sleep(waitTime);
      }
    }
    
    // Retry loop with exponential backoff
    for (let attempt = 0; attempt <= callOptions.maxRetries; attempt++) {
      try {
        // Add timeout wrapper if specified
        const timeoutPromise = callOptions.timeout ? 
          this.withTimeout(apiCall(), callOptions.timeout) : 
          apiCall();
        
        const response = await timeoutPromise;
        
        // Success - reset circuit breaker and rate limit state
        this.onSuccess();
        return response;
        
      } catch (error) {
        lastError = this.classifyError(error, context);
        this.updateErrorStats(lastError);
        
        console.error(`[API ERROR] Attempt ${attempt + 1}/${callOptions.maxRetries + 1} failed:`, lastError.message);
        
        // Handle non-retryable errors immediately
        if (!lastError.retryable || attempt === callOptions.maxRetries) {
          break;
        }
        
        // Handle rate limiting
        if (lastError instanceof ApiRateLimitError) {
          await this.handleRateLimit(lastError);
          continue; // Don't count rate limits as regular retries
        }
        
        // Calculate delay for next retry
        const delay = this.calculateRetryDelay(attempt, lastError);
        console.log(`[RETRY] Waiting ${delay}ms before retry ${attempt + 2}`);
        await this.sleep(delay);
      }
    }
    
    // All retries exhausted - handle final error
    return await this.handleFinalError(lastError, context, callOptions);
  }

  /**
   * Classify and wrap errors in appropriate types
   * @param {Error} error - Original error
   * @param {Object} context - Request context
   * @returns {ApiError} Classified error
   */
  classifyError(error, context = {}) {
    // Already classified
    if (error instanceof ApiError) {
      return error;
    }
    
    // Groq SDK specific errors
    if (error.status) {
      const { HTTP_STATUS_CODES } = API_ERROR_CONSTANTS;
      
      if (error.status === HTTP_STATUS_CODES.TOO_MANY_REQUESTS) {
        const retryAfter = error.headers?.['retry-after'] || 
                          error.headers?.['x-ratelimit-reset-after'] || 
                          API_ERROR_CONSTANTS.DEFAULT_RATE_LIMIT_DELAY;
        return new ApiRateLimitError(
          error.message || 'Rate limit exceeded',
          retryAfter,
          { ...context, headers: error.headers }
        );
      }
      
      if (error.status === HTTP_STATUS_CODES.UNAUTHORIZED || error.status === HTTP_STATUS_CODES.FORBIDDEN) {
        return new ApiAuthenticationError(
          error.message || 'Authentication failed',
          { ...context, status: error.status }
        );
      }
      
      return new ApiError(
        error.message || 'API error occurred',
        error.status,
        'api_error',
        { ...context, originalError: error }
      );
    }
    
    // Network errors
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || 
        error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      return new ApiNetworkError(
        error.message || 'Network error occurred',
        error.code,
        { ...context, originalError: error }
      );
    }
    
    // Timeout errors
    if (error.name === 'TimeoutError' || error.message?.includes('timeout')) {
      return new ApiTimeoutError(
        error.message || 'Request timed out',
        context.timeout,
        { ...context, originalError: error }
      );
    }
    
    // Default to generic API error
    return new ApiError(
      error.message || 'Unknown API error',
      null,
      'unknown_error',
      { ...context, originalError: error }
    );
  }

  /**
   * Handle final error after all retries exhausted
   * @param {ApiError} error - Final error
   * @param {Object} context - Request context
   * @param {Object} options - Call options
   * @returns {Promise<Object>} Fallback response or throws error
   */
  async handleFinalError(error, context, options) {
    this.onFailure(error);
    
    console.error(`[API FAILURE] All retries exhausted for ${context.operation || 'API call'}`);
    
    // Try fallback response if enabled
    if (options.enableFallbacks && this.canUseFallback(error, context)) {
      console.warn('[FALLBACK] Using fallback response due to API failure');
      return await this.generateFallbackResponse(context, 'api_failure', error);
    }
    
    // No fallback available - throw the error
    throw error;
  }

  /**
   * Handle rate limiting with intelligent backoff
   * @param {ApiRateLimitError} error - Rate limit error
   */
  async handleRateLimit(error) {
    const retryAfter = error.retryAfter ? 
      (parseInt(error.retryAfter) * 1000) : // Convert seconds to milliseconds
      this.options.baseDelay;
    
    this.rateLimitState = {
      isLimited: true,
      resetTime: Date.now() + retryAfter,
      retryAfter: retryAfter
    };
    
    console.warn(`[RATE LIMIT] Backing off for ${retryAfter}ms`);
    await this.sleep(retryAfter);
    
    // Reset rate limit state
    this.rateLimitState.isLimited = false;
  }

  /**
   * Calculate retry delay with exponential backoff and jitter
   * @param {number} attempt - Current attempt number (0-based)
   * @param {ApiError} error - The error that occurred
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attempt, error) {
    // Base delay with exponential backoff
    let delay = this.options.baseDelay * Math.pow(this.options.backoffMultiplier, attempt);
    
    // Add jitter (±25% randomization)
    const jitter = delay * 0.25 * (Math.random() - 0.5);
    delay += jitter;
    
    // Respect max delay
    delay = Math.min(delay, this.options.maxDelay);
    
    // Special handling for specific error types
    if (error instanceof ApiRateLimitError && error.retryAfter) {
      delay = Math.max(delay, error.retryAfter * 1000);
    }
    
    if (error.status >= 500) {
      // Longer delays for server errors
      delay *= 1.5;
    }
    
    return Math.round(delay);
  }

  /**
   * Generate fallback response when API is unavailable
   * @param {Object} context - Request context
   * @param {string} reason - Reason for fallback
   * @param {Error} error - Original error (optional)
   * @returns {Promise<Object>} Fallback response
   */
  async generateFallbackResponse(context, reason, error = null) {
    this.errorStats.fallbackUsages++;
    
    const fallbackResponse = {
      content: this.getFallbackContent(context, reason),
      isFallback: true,
      fallbackReason: reason,
      timestamp: new Date().toISOString(),
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      model: 'fallback',
      error: error ? {
        type: error.name,
        message: error.message,
        status: error.status
      } : null
    };
    
    console.log(`[FALLBACK] Generated fallback response due to: ${reason}`);
    return fallbackResponse;
  }

  /**
   * Get appropriate fallback content based on context
   * @param {Object} context - Request context
   * @param {string} reason - Fallback reason
   * @returns {string} Fallback content
   */
  getFallbackContent(context, reason) {
    const fallbackMessages = {
      rate_limit: "I'm currently experiencing high demand. Please try again in a moment, or let me know if you'd like to continue our conversation.",
      circuit_breaker: "I'm temporarily unable to access my language processing service. I can still help with basic tasks or you can try again shortly.",
      api_failure: "I'm experiencing technical difficulties connecting to my language service. While I work to resolve this, is there anything else I can help you with?",
      timeout: "My response is taking longer than expected. Let me try a different approach to help you.",
      network_error: "I'm having connectivity issues. Please check your internet connection or try again in a few moments.",
      authentication_error: "There's an issue with my service authentication. Please contact support if this problem persists.",
      server_error: "The language service is temporarily unavailable. I'll try to help in other ways while the service recovers."
    };
    
    const baseMessage = fallbackMessages[reason] || fallbackMessages.api_failure;
    
    // Add context-specific information if available
    if (context.operation) {
      return `${baseMessage}\n\n(This happened while ${context.operation})`;
    }
    
    return baseMessage;
  }

  /**
   * Check if fallback response is appropriate
   * @param {ApiError} error - The error
   * @param {Object} context - Request context
   * @returns {boolean} Whether fallback is suitable
   */
  canUseFallback(error, context) {
    // Authentication errors can use fallback with appropriate messaging
    if (error instanceof ApiAuthenticationError) {
      return this.options.enableFallbacks; // Respect the global setting
    }
    
    // Don't use fallback for validation errors (bad request)
    if (error.status === 400) {
      return false;
    }
    
    // Fallback is suitable for most other errors
    return true;
  }

  /**
   * Wrap API call with timeout
   * @param {Promise} promise - API call promise
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise} Promise that resolves or rejects with timeout
   */
  withTimeout(promise, timeout) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => {
          reject(new ApiTimeoutError(`Request timed out after ${timeout}ms`, timeout));
        }, timeout);
      })
    ]);
  }

  /**
   * Circuit breaker methods
   */
  isCircuitBreakerOpen() {
    if (!this.options.enableCircuitBreaker) return false;
    
    if (this.circuitBreaker.isOpen) {
      const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
      if (timeSinceFailure > this.options.circuitBreakerTimeout) {
        // Try to close the circuit breaker
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failures = 0;
        console.log('[CIRCUIT BREAKER] Attempting to close circuit breaker');
      }
    }
    
    return this.circuitBreaker.isOpen;
  }

  onSuccess() {
    // Reset circuit breaker on success
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.isOpen = false;
    
    // Reset rate limit state if it has expired
    if (this.rateLimitState.isLimited && Date.now() > this.rateLimitState.resetTime) {
      this.rateLimitState.isLimited = false;
    }
  }

  onFailure(error) {
    // Update circuit breaker
    if (this.options.enableCircuitBreaker) {
      this.circuitBreaker.failures++;
      this.circuitBreaker.lastFailureTime = Date.now();
      
      if (this.circuitBreaker.failures >= this.options.circuitBreakerThreshold) {
        this.circuitBreaker.isOpen = true;
        console.warn(`[CIRCUIT BREAKER] Circuit breaker opened after ${this.circuitBreaker.failures} failures`);
      }
    }
  }

  /**
   * Utility methods
   */
  isRateLimited() {
    return this.rateLimitState.isLimited && Date.now() < this.rateLimitState.resetTime;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  updateErrorStats(error) {
    this.errorStats.totalErrors++;
    const errorType = error.constructor.name;
    this.errorStats.errorsByType.set(errorType, 
      (this.errorStats.errorsByType.get(errorType) || 0) + 1
    );
    this.errorStats.lastError = {
      timestamp: new Date().toISOString(),
      type: errorType,
      message: error.message,
      status: error.status
    };
  }

  /**
   * Get comprehensive error statistics
   * @returns {Object} Error statistics
   */
  getErrorStatistics() {
    const errorRate = this.errorStats.totalRequests > 0 ? 
      (this.errorStats.totalErrors / this.errorStats.totalRequests * 100).toFixed(2) : 0;
    
    const fallbackRate = this.errorStats.totalRequests > 0 ? 
      (this.errorStats.fallbackUsages / this.errorStats.totalRequests * 100).toFixed(2) : 0;
    
    return {
      ...this.errorStats,
      errorsByType: Object.fromEntries(this.errorStats.errorsByType),
      errorRate: parseFloat(errorRate),
      fallbackRate: parseFloat(fallbackRate),
      circuitBreakerStatus: {
        isOpen: this.circuitBreaker.isOpen,
        failures: this.circuitBreaker.failures,
        lastFailureTime: this.circuitBreaker.lastFailureTime
      },
      rateLimitStatus: {
        isLimited: this.rateLimitState.isLimited,
        resetTime: this.rateLimitState.resetTime
      }
    };
  }

  /**
   * Reset error statistics (useful for testing)
   */
  resetStatistics() {
    this.errorStats = {
      totalRequests: 0,
      totalErrors: 0,
      errorsByType: new Map(),
      retryAttempts: 0,
      fallbackUsages: 0,
      lastError: null
    };
    
    this.circuitBreaker = {
      failures: 0,
      lastFailureTime: 0,
      isOpen: false
    };
    
    this.rateLimitState = {
      isLimited: false,
      resetTime: 0,
      retryAfter: 0
    };
  }
}

export default {
  ApiError,
  ApiRateLimitError,
  ApiTimeoutError,
  ApiNetworkError,
  ApiAuthenticationError,
  ApiErrorRecovery
};