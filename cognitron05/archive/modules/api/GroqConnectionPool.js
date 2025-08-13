#!/usr/bin/env node

/**
 * Groq Connection Pool - High-performance connection pooling and rate limiting
 * Manages Groq API connections efficiently with rate limiting, retry logic, and monitoring
 * 
 * Features:
 * - Connection pooling for HTTP/2 multiplexing
 * - Advanced rate limiting with token bucket algorithm
 * - Intelligent retry logic with exponential backoff
 * - Request queuing and prioritization
 * - Health monitoring and circuit breaker pattern
 * - Connection lifecycle management
 * - Performance metrics and monitoring
 * - Configurable timeouts and limits
 */

import { Groq } from 'groq-sdk';
import { getLogger } from '../utils/StructuredLogger.js';
import { EventEmitter } from 'events';

export class GroqConnectionPool extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Connection Pool Configuration
      poolSize: config.poolSize || 5,
      maxConnectionsPerHost: config.maxConnectionsPerHost || 10,
      connectionTimeout: config.connectionTimeout || 30000, // 30s
      idleTimeout: config.idleTimeout || 60000, // 1 minute
      maxRetries: config.maxRetries || 3,
      
      // Rate Limiting Configuration
      requestsPerMinute: config.requestsPerMinute || 200, // Groq's typical limit
      requestsPerSecond: config.requestsPerSecond || 20,
      burstCapacity: config.burstCapacity || 50,
      rateLimitWindow: config.rateLimitWindow || 60000, // 1 minute
      
      // Token Bucket Configuration
      tokenBucketCapacity: config.tokenBucketCapacity || 50,
      tokenRefillRate: config.tokenRefillRate || 20, // tokens per second
      
      // Circuit Breaker Configuration
      circuitBreakerThreshold: config.circuitBreakerThreshold || 5, // failures
      circuitBreakerTimeout: config.circuitBreakerTimeout || 30000, // 30s
      circuitBreakerResetTimeout: config.circuitBreakerResetTimeout || 60000, // 1 minute
      
      // Queue Configuration
      maxQueueSize: config.maxQueueSize || 1000,
      queueTimeout: config.queueTimeout || 30000, // 30s
      enablePrioritization: config.enablePrioritization !== false,
      
      // API Configuration
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      enableHealthChecks: config.enableHealthChecks !== false,
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Connection pool
    this.connections = new Map(); // connectionId -> { client, lastUsed, isHealthy, requestCount }
    this.activeConnections = new Set();
    this.availableConnections = new Set();
    
    // Rate limiting state
    this.tokenBucket = {
      tokens: this.config.tokenBucketCapacity,
      lastRefill: Date.now()
    };
    this.rateLimitState = {
      requestCount: 0,
      windowStart: Date.now(),
      recentRequests: []
    };
    
    // Circuit breaker state
    this.circuitBreaker = {
      state: 'closed', // closed, open, half-open
      failureCount: 0,
      lastFailure: null,
      nextAttempt: null
    };
    
    // Request queue
    this.requestQueue = [];
    this.queuedRequests = new Map(); // requestId -> { request, resolve, reject, priority, timestamp }
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitedRequests: 0,
      queuedRequests: 0,
      circuitBreakerTrips: 0,
      averageResponseTime: 0,
      connectionPoolHits: 0,
      connectionPoolMisses: 0,
      lastReset: Date.now()
    };
    
    // Monitoring
    this.healthCheckInterval = null;
    this.cleanupInterval = null;
    this.metricsInterval = null;
    
    this.initialized = false;
  }

  /**
   * Initialize the connection pool
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing Groq connection pool', {
        subsystem: 'api',
        component: 'connection-pool',
        poolSize: this.config.poolSize,
        rateLimit: `${this.config.requestsPerMinute}/min`,
        operation: 'initialize'
      });

      // Validate configuration
      this.validateConfiguration();
      
      // Initialize connection pool
      await this.initializeConnectionPool();
      
      // Start background tasks
      this.startBackgroundTasks();
      
      this.initialized = true;
      
      this.logger.info('Groq connection pool initialized', {
        subsystem: 'api',
        component: 'connection-pool',
        activeConnections: this.activeConnections.size,
        operation: 'initialize'
      });
      
      this.emit('initialized', { poolSize: this.activeConnections.size });

    } catch (error) {
      this.logger.error('Failed to initialize Groq connection pool', {
        subsystem: 'api',
        component: 'connection-pool',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Execute a Groq API request with connection pooling and rate limiting
   * @param {string} method - API method (e.g., 'chat.completions.create')
   * @param {Object} params - Request parameters
   * @param {Object} options - Request options
   * @returns {Promise} API response
   */
  async executeRequest(method, params, options = {}) {
    const requestId = this.generateRequestId();
    const requestStart = Date.now();
    
    try {
      this.logger.debug('Executing Groq API request', {
        subsystem: 'api',
        component: 'connection-pool',
        requestId,
        method,
        hasStream: !!params.stream,
        operation: 'executeRequest'
      });

      // Update statistics
      this.stats.totalRequests++;
      
      // Check circuit breaker
      if (this.circuitBreaker.state === 'open') {
        if (Date.now() < this.circuitBreaker.nextAttempt) {
          throw new Error('Circuit breaker is open - API temporarily unavailable');
        } else {
          this.circuitBreaker.state = 'half-open';
          this.logger.info('Circuit breaker entering half-open state', {
            subsystem: 'api',
            component: 'connection-pool',
            operation: 'executeRequest'
          });
        }
      }
      
      // Apply rate limiting
      await this.applyRateLimit(options.priority || 'normal');
      
      // Get connection from pool
      const connection = await this.getConnection();
      
      try {
        // Execute the request
        const result = await this.executeWithConnection(connection, method, params, options);
        
        // Update success statistics
        this.stats.successfulRequests++;
        this.updateResponseTime(Date.now() - requestStart);
        
        // Reset circuit breaker on success
        if (this.circuitBreaker.state === 'half-open') {
          this.resetCircuitBreaker();
        }
        
        this.logger.debug('Groq API request completed successfully', {
          subsystem: 'api',
          component: 'connection-pool',
          requestId,
          responseTime: Date.now() - requestStart,
          operation: 'executeRequest'
        });
        
        return result;
        
      } finally {
        // Return connection to pool
        this.returnConnection(connection);
      }
      
    } catch (error) {
      // Update failure statistics
      this.stats.failedRequests++;
      
      // Handle circuit breaker
      this.handleRequestFailure(error);
      
      this.logger.error('Groq API request failed', {
        subsystem: 'api',
        component: 'connection-pool',
        requestId,
        method,
        responseTime: Date.now() - requestStart,
        operation: 'executeRequest'
      }, error);
      
      throw error;
    }
  }

  /**
   * Execute request with retry logic
   * @param {Object} connection - Connection to use
   * @param {string} method - API method
   * @param {Object} params - Request parameters
   * @param {Object} options - Request options
   * @returns {Promise} API response
   */
  async executeWithConnection(connection, method, params, options) {
    let lastError;
    let attempt = 0;
    
    while (attempt < this.config.maxRetries) {
      try {
        // Update connection usage
        connection.requestCount++;
        connection.lastUsed = Date.now();
        
        // Execute the actual API call
        const result = await this.performApiCall(connection.client, method, params, options);
        
        return result;
        
      } catch (error) {
        lastError = error;
        attempt++;
        
        // Check if we should retry
        if (!this.shouldRetry(error, attempt)) {
          throw error;
        }
        
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        this.logger.warn('Retrying Groq API request', {
          subsystem: 'api',
          component: 'connection-pool',
          attempt,
          delay,
          error: error.message,
          operation: 'executeWithConnection'
        });
      }
    }
    
    throw lastError;
  }

  /**
   * Perform the actual API call
   * @param {Groq} client - Groq client instance
   * @param {string} method - API method
   * @param {Object} params - Request parameters
   * @param {Object} options - Request options
   * @returns {Promise} API response
   */
  async performApiCall(client, method, params, options) {
    // Parse method path (e.g., 'chat.completions.create')
    const methodParts = method.split('.');
    let apiObject = client;
    
    // Navigate to the parent object (e.g., client.chat.completions)
    for (let i = 0; i < methodParts.length - 1; i++) {
      apiObject = apiObject[methodParts[i]];
      if (!apiObject) {
        throw new Error(`Invalid API path: ${methodParts.slice(0, i + 1).join('.')}`);
      }
    }
    
    // Get the final method (e.g., 'create')
    const methodName = methodParts[methodParts.length - 1];
    const apiMethod = apiObject[methodName];
    
    if (!apiMethod || typeof apiMethod !== 'function') {
      throw new Error(`Invalid API method: ${method}`);
    }
    
    // Execute with timeout - properly bind to parent object
    const timeout = options.timeout || this.config.connectionTimeout;
    const apiCall = apiMethod.call(apiObject, params);
    
    return await Promise.race([
      apiCall,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error(`Request timeout: ${timeout}ms`)), timeout)
      )
    ]);
  }

  /**
   * Apply rate limiting using token bucket algorithm
   * @param {string} priority - Request priority (high, normal, low)
   */
  async applyRateLimit(priority = 'normal') {
    const now = Date.now();
    
    // Refill token bucket
    this.refillTokenBucket(now);
    
    // Check if we have tokens available
    if (this.tokenBucket.tokens <= 0) {
      // Calculate wait time
      const tokensNeeded = 1;
      const waitTime = Math.ceil(tokensNeeded * 1000 / this.config.tokenRefillRate);
      
      this.stats.rateLimitedRequests++;
      
      this.logger.debug('Rate limiting applied', {
        subsystem: 'api',
        component: 'connection-pool',
        waitTime,
        tokensAvailable: this.tokenBucket.tokens,
        operation: 'applyRateLimit'
      });
      
      // For high priority requests, queue them
      if (priority === 'high' && this.requestQueue.length < this.config.maxQueueSize) {
        await this.queueRequest(priority);
      } else {
        // Wait for tokens to be available
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      // Recursive call to check again
      return await this.applyRateLimit(priority);
    }
    
    // Consume token
    this.tokenBucket.tokens--;
    
    // Update rate limit tracking
    this.rateLimitState.requestCount++;
    this.rateLimitState.recentRequests.push(now);
    
    // Clean old requests
    const windowStart = now - this.config.rateLimitWindow;
    this.rateLimitState.recentRequests = this.rateLimitState.recentRequests.filter(
      timestamp => timestamp > windowStart
    );
  }

  /**
   * Refill the token bucket
   * @param {number} now - Current timestamp
   */
  refillTokenBucket(now) {
    const timePassed = now - this.tokenBucket.lastRefill;
    const tokensToAdd = Math.floor(timePassed * this.config.tokenRefillRate / 1000);
    
    if (tokensToAdd > 0) {
      this.tokenBucket.tokens = Math.min(
        this.tokenBucket.tokens + tokensToAdd,
        this.config.tokenBucketCapacity
      );
      this.tokenBucket.lastRefill = now;
    }
  }

  /**
   * Queue a request when rate limited
   * @param {string} priority - Request priority
   */
  async queueRequest(priority) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Request queue timeout'));
      }, this.config.queueTimeout);
      
      this.requestQueue.push({
        priority,
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timestamp: Date.now()
      });
      
      this.stats.queuedRequests++;
      
      // Sort queue by priority if enabled
      if (this.config.enablePrioritization) {
        this.requestQueue.sort((a, b) => {
          const priorities = { high: 3, normal: 2, low: 1 };
          return priorities[b.priority] - priorities[a.priority];
        });
      }
    });
  }

  /**
   * Get a connection from the pool
   * @returns {Object} Connection object
   */
  async getConnection() {
    // Try to get an available connection
    for (const connectionId of this.availableConnections) {
      const connection = this.connections.get(connectionId);
      if (connection && connection.isHealthy) {
        this.availableConnections.delete(connectionId);
        this.activeConnections.add(connectionId);
        this.stats.connectionPoolHits++;
        return connection;
      }
    }
    
    // Create new connection if pool not at capacity
    if (this.connections.size < this.config.poolSize) {
      const connection = await this.createConnection();
      this.stats.connectionPoolMisses++;
      return connection;
    }
    
    // Wait for connection to become available
    return await this.waitForConnection();
  }

  /**
   * Create a new connection
   * @returns {Object} New connection object
   */
  async createConnection() {
    const connectionId = this.generateConnectionId();
    
    try {
      const client = new Groq({
        apiKey: this.config.apiKey,
        baseURL: this.config.baseURL
      });
      
      const connection = {
        id: connectionId,
        client,
        created: Date.now(),
        lastUsed: Date.now(),
        requestCount: 0,
        isHealthy: true
      };
      
      this.connections.set(connectionId, connection);
      this.activeConnections.add(connectionId);
      
      this.logger.debug('Created new Groq connection', {
        subsystem: 'api',
        component: 'connection-pool',
        connectionId,
        totalConnections: this.connections.size,
        operation: 'createConnection'
      });
      
      return connection;
      
    } catch (error) {
      this.logger.error('Failed to create Groq connection', {
        subsystem: 'api',
        component: 'connection-pool',
        connectionId,
        operation: 'createConnection'
      }, error);
      throw error;
    }
  }

  /**
   * Return connection to the pool
   * @param {Object} connection - Connection to return
   */
  returnConnection(connection) {
    if (!connection || !connection.id) {
      return;
    }
    
    this.activeConnections.delete(connection.id);
    
    if (connection.isHealthy) {
      this.availableConnections.add(connection.id);
    } else {
      // Remove unhealthy connection
      this.connections.delete(connection.id);
    }
    
    // Process queued requests
    this.processQueue();
  }

  /**
   * Process queued requests
   */
  processQueue() {
    while (this.requestQueue.length > 0 && this.tokenBucket.tokens > 0) {
      const queuedRequest = this.requestQueue.shift();
      this.tokenBucket.tokens--;
      queuedRequest.resolve();
    }
  }

  /**
   * Wait for a connection to become available
   * @returns {Promise<Object>} Available connection
   */
  async waitForConnection() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection pool timeout'));
      }, this.config.connectionTimeout);
      
      const checkInterval = setInterval(() => {
        if (this.availableConnections.size > 0) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          resolve(this.getConnection());
        }
      }, 100);
    });
  }

  /**
   * Handle request failure for circuit breaker
   * @param {Error} error - Request error
   */
  handleRequestFailure(error) {
    this.circuitBreaker.failureCount++;
    this.circuitBreaker.lastFailure = Date.now();
    
    // Check if we should open the circuit breaker
    if (this.circuitBreaker.failureCount >= this.config.circuitBreakerThreshold) {
      this.circuitBreaker.state = 'open';
      this.circuitBreaker.nextAttempt = Date.now() + this.config.circuitBreakerTimeout;
      this.stats.circuitBreakerTrips++;
      
      this.logger.warn('Circuit breaker opened', {
        subsystem: 'api',
        component: 'connection-pool',
        failures: this.circuitBreaker.failureCount,
        nextAttempt: new Date(this.circuitBreaker.nextAttempt).toISOString(),
        operation: 'handleRequestFailure'
      });
      
      this.emit('circuitBreakerOpened', {
        failures: this.circuitBreaker.failureCount,
        nextAttempt: this.circuitBreaker.nextAttempt
      });
    }
  }

  /**
   * Reset circuit breaker after successful request
   */
  resetCircuitBreaker() {
    this.circuitBreaker.state = 'closed';
    this.circuitBreaker.failureCount = 0;
    this.circuitBreaker.lastFailure = null;
    this.circuitBreaker.nextAttempt = null;
    
    this.logger.info('Circuit breaker reset', {
      subsystem: 'api',
      component: 'connection-pool',
      operation: 'resetCircuitBreaker'
    });
    
    this.emit('circuitBreakerReset');
  }

  /**
   * Check if request should be retried
   * @param {Error} error - Request error
   * @param {number} attempt - Current attempt number
   * @returns {boolean} Whether to retry
   */
  shouldRetry(error, attempt) {
    if (attempt >= this.config.maxRetries) {
      return false;
    }
    
    // Retry on rate limits, timeouts, and 5xx errors
    if (error.status === 429 || // Rate limited
        error.status >= 500 ||   // Server errors
        error.code === 'TIMEOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND') {
      return true;
    }
    
    return false;
  }

  /**
   * Initialize connection pool
   */
  async initializeConnectionPool() {
    const initialConnections = Math.min(2, this.config.poolSize);
    
    for (let i = 0; i < initialConnections; i++) {
      try {
        const connection = await this.createConnection();
        this.returnConnection(connection);
      } catch (error) {
        this.logger.warn('Failed to create initial connection', {
          subsystem: 'api',
          component: 'connection-pool',
          connectionIndex: i,
          operation: 'initializeConnectionPool'
        }, error);
      }
    }
  }

  /**
   * Start background tasks
   */
  startBackgroundTasks() {
    // Health check interval
    if (this.config.enableHealthChecks) {
      this.healthCheckInterval = setInterval(() => {
        this.performHealthChecks();
      }, 30000); // 30 seconds
    }
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 60000); // 1 minute
    
    // Metrics interval
    this.metricsInterval = setInterval(() => {
      this.logMetrics();
    }, 300000); // 5 minutes
  }

  /**
   * Perform health checks on connections
   */
  async performHealthChecks() {
    for (const [connectionId, connection] of this.connections) {
      try {
        // Simple health check - could be enhanced with actual API call
        const isHealthy = Date.now() - connection.lastUsed < this.config.idleTimeout * 2;
        connection.isHealthy = isHealthy;
        
        if (!isHealthy) {
          this.logger.debug('Connection marked as unhealthy', {
            subsystem: 'api',
            component: 'connection-pool',
            connectionId,
            lastUsed: connection.lastUsed,
            operation: 'performHealthChecks'
          });
        }
      } catch (error) {
        connection.isHealthy = false;
        this.logger.warn('Connection health check failed', {
          subsystem: 'api',
          component: 'connection-pool',
          connectionId,
          operation: 'performHealthChecks'
        }, error);
      }
    }
  }

  /**
   * Clean up idle connections
   */
  cleanupIdleConnections() {
    const now = Date.now();
    const connectionsToRemove = [];
    
    for (const [connectionId, connection] of this.connections) {
      if (now - connection.lastUsed > this.config.idleTimeout) {
        connectionsToRemove.push(connectionId);
      }
    }
    
    for (const connectionId of connectionsToRemove) {
      this.connections.delete(connectionId);
      this.availableConnections.delete(connectionId);
      this.activeConnections.delete(connectionId);
      
      this.logger.debug('Cleaned up idle connection', {
        subsystem: 'api',
        component: 'connection-pool',
        connectionId,
        operation: 'cleanupIdleConnections'
      });
    }
  }

  /**
   * Log performance metrics
   */
  logMetrics() {
    const now = Date.now();
    const uptimeMinutes = (now - this.stats.lastReset) / 1000 / 60;
    
    this.logger.info('Groq connection pool metrics', {
      subsystem: 'api',
      component: 'connection-pool',
      metrics: {
        totalRequests: this.stats.totalRequests,
        successRate: this.stats.totalRequests > 0 ? 
          Math.round((this.stats.successfulRequests / this.stats.totalRequests) * 100) : 0,
        averageResponseTime: Math.round(this.stats.averageResponseTime),
        requestsPerMinute: Math.round(this.stats.totalRequests / uptimeMinutes),
        poolHitRate: this.stats.connectionPoolHits > 0 ?
          Math.round((this.stats.connectionPoolHits / (this.stats.connectionPoolHits + this.stats.connectionPoolMisses)) * 100) : 0,
        activeConnections: this.activeConnections.size,
        availableConnections: this.availableConnections.size,
        queuedRequests: this.requestQueue.length,
        circuitBreakerState: this.circuitBreaker.state,
        tokensAvailable: this.tokenBucket.tokens
      },
      operation: 'logMetrics'
    });
  }

  /**
   * Update response time statistics
   * @param {number} responseTime - Response time in milliseconds
   */
  updateResponseTime(responseTime) {
    const alpha = 0.1; // Exponential moving average factor
    this.stats.averageResponseTime = this.stats.averageResponseTime === 0 ?
      responseTime :
      (alpha * responseTime) + ((1 - alpha) * this.stats.averageResponseTime);
  }

  /**
   * Validate configuration
   */
  validateConfiguration() {
    if (!this.config.apiKey) {
      throw new Error('API key is required for Groq connection pool');
    }
    
    if (this.config.poolSize < 1) {
      throw new Error('Pool size must be at least 1');
    }
    
    if (this.config.requestsPerMinute < 1) {
      throw new Error('Requests per minute must be at least 1');
    }
  }

  /**
   * Generate unique request ID
   * @returns {string} Request ID
   */
  generateRequestId() {
    return `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique connection ID
   * @returns {string} Connection ID
   */
  generateConnectionId() {
    return `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get connection pool statistics
   * @returns {Object} Statistics object
   */
  getStats() {
    return {
      ...this.stats,
      connections: {
        total: this.connections.size,
        active: this.activeConnections.size,
        available: this.availableConnections.size
      },
      rateLimiting: {
        tokensAvailable: this.tokenBucket.tokens,
        requestsInWindow: this.rateLimitState.recentRequests.length,
        queueLength: this.requestQueue.length
      },
      circuitBreaker: {
        state: this.circuitBreaker.state,
        failures: this.circuitBreaker.failureCount,
        lastFailure: this.circuitBreaker.lastFailure
      }
    };
  }

  /**
   * Clean up and shut down the connection pool
   */
  async cleanup() {
    try {
      this.logger.info('Shutting down Groq connection pool', {
        subsystem: 'api',
        component: 'connection-pool',
        operation: 'cleanup'
      });

      // Clear intervals
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      if (this.cleanupInterval) clearInterval(this.cleanupInterval);
      if (this.metricsInterval) clearInterval(this.metricsInterval);
      
      // Clear connections
      this.connections.clear();
      this.activeConnections.clear();
      this.availableConnections.clear();
      
      // Clear queue
      this.requestQueue.length = 0;
      this.queuedRequests.clear();
      
      this.emit('shutdown');

    } catch (error) {
      this.logger.error('Error during connection pool cleanup', {
        subsystem: 'api',
        component: 'connection-pool',
        operation: 'cleanup'
      }, error);
    }
  }
}

export default GroqConnectionPool;