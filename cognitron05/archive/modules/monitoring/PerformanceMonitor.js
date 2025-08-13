#!/usr/bin/env node

/**
 * Performance Monitor - Advanced performance tracking and analytics for Cognitron05
 * Monitors API response times, memory usage, operation latency, and system performance
 * 
 * Features:
 * - Real-time API response time tracking with percentile calculations
 * - Memory usage monitoring with growth rate analysis
 * - Operation latency measurement with categorization
 * - Performance baseline establishment and deviation detection
 * - Automatic performance profiling and optimization recommendations
 * - Historical performance data with trend analysis
 * - Performance regression detection and alerting
 * - Resource utilization tracking and capacity planning
 */

import { EventEmitter } from 'events';
import { getLogger } from '../utils/StructuredLogger.js';

export class PerformanceMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Monitoring intervals
      metricsCollectionInterval: config.metricsCollectionInterval || 10000,  // 10 seconds
      performanceAnalysisInterval: config.performanceAnalysisInterval || 60000,  // 1 minute
      baselineUpdateInterval: config.baselineUpdateInterval || 300000,  // 5 minutes
      
      // Performance thresholds
      apiResponseTimeWarning: config.apiResponseTimeWarning || 2000,    // 2 seconds
      apiResponseTimeCritical: config.apiResponseTimeCritical || 5000,  // 5 seconds
      memoryGrowthRateWarning: config.memoryGrowthRateWarning || 10,    // 10MB/minute
      memoryGrowthRateCritical: config.memoryGrowthRateCritical || 25,  // 25MB/minute
      operationLatencyWarning: config.operationLatencyWarning || 1000,  // 1 second
      operationLatencyCritical: config.operationLatencyCritical || 3000, // 3 seconds
      
      // Baseline configuration
      baselineWindow: config.baselineWindow || 100,  // Number of samples for baseline
      baselineDeviationThreshold: config.baselineDeviationThreshold || 2.0,  // Standard deviations
      
      // Data retention
      maxMetricsHistory: config.maxMetricsHistory || 1000,
      maxOperationHistory: config.maxOperationHistory || 500,
      
      // Performance categories
      slowOperationThreshold: config.slowOperationThreshold || 500,  // 500ms
      verySlowOperationThreshold: config.verySlowOperationThreshold || 2000,  // 2s
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Performance metrics storage
    this.apiMetrics = {
      responseTimes: [],
      errors: new Map(),
      requestCounts: new Map(),
      statusCodes: new Map(),
      endpoints: new Map()
    };
    
    this.memoryMetrics = {
      samples: [],
      growthRate: 0,
      projectedUsage: 0,
      peakUsage: 0
    };
    
    this.operationMetrics = {
      latencies: new Map(), // operation -> [latency samples]
      frequencies: new Map(), // operation -> count
      errors: new Map(), // operation -> error count
      categories: new Map() // operation -> category (fast, slow, very_slow)
    };
    
    // Performance baselines
    this.baselines = {
      apiResponseTime: { mean: 0, stdDev: 0, samples: [] },
      memoryUsage: { mean: 0, stdDev: 0, samples: [] },
      operationLatencies: new Map() // operation -> { mean, stdDev, samples }
    };
    
    // Performance analysis
    this.performanceAnalysis = {
      trends: new Map(),
      regressions: [],
      optimizations: [],
      capacity: {}
    };
    
    // Active operation tracking
    this.activeOperations = new Map(); // operationId -> { name, startTime, metadata }
    this.operationIdCounter = 0;
    
    // Monitoring intervals
    this.metricsTimer = null;
    this.analysisTimer = null;
    this.baselineTimer = null;
    
    this.initialized = false;
  }

  /**
   * Initialize performance monitoring
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing performance monitor', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        config: {
          metricsInterval: this.config.metricsCollectionInterval,
          apiWarningThreshold: this.config.apiResponseTimeWarning,
          memoryWarningThreshold: this.config.memoryGrowthRateWarning,
          baselineWindow: this.config.baselineWindow
        },
        operation: 'initialize'
      });

      // Establish initial baselines
      await this.establishBaselines();
      
      // Start monitoring intervals
      this.startPerformanceMonitoring();
      
      this.initialized = true;
      
      this.logger.info('Performance monitor initialized', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        operation: 'initialize'
      });
      
      this.emit('initialized');

    } catch (error) {
      this.logger.error('Failed to initialize performance monitor', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Start an operation measurement
   * @param {string} operationName - Name of the operation
   * @param {Object} metadata - Additional metadata
   * @returns {string} Operation ID for ending the measurement
   */
  startOperation(operationName, metadata = {}) {
    const operationId = `op-${++this.operationIdCounter}-${Date.now()}`;
    
    this.activeOperations.set(operationId, {
      name: operationName,
      startTime: Date.now(),
      metadata
    });
    
    this.logger.debug('Started operation measurement', {
      subsystem: 'monitoring',
      component: 'performance-monitor',
      operationId,
      operationName,
      operation: 'startOperation'
    });
    
    return operationId;
  }

  /**
   * End an operation measurement
   * @param {string} operationId - Operation ID from startOperation
   * @param {Object} result - Operation result metadata
   */
  endOperation(operationId, result = {}) {
    const operation = this.activeOperations.get(operationId);
    if (!operation) {
      this.logger.warn('Attempted to end unknown operation', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        operationId,
        operation: 'endOperation'
      });
      return;
    }
    
    const latency = Date.now() - operation.startTime;
    const operationName = operation.name;
    
    // Store latency measurement
    if (!this.operationMetrics.latencies.has(operationName)) {
      this.operationMetrics.latencies.set(operationName, []);
    }
    
    this.operationMetrics.latencies.get(operationName).push({
      latency,
      timestamp: Date.now(),
      metadata: { ...operation.metadata, ...result }
    });
    
    // Update frequency counter
    this.operationMetrics.frequencies.set(
      operationName,
      (this.operationMetrics.frequencies.get(operationName) || 0) + 1
    );
    
    // Categorize operation speed
    let category = 'fast';
    if (latency >= this.config.verySlowOperationThreshold) {
      category = 'very_slow';
    } else if (latency >= this.config.slowOperationThreshold) {
      category = 'slow';
    }
    this.operationMetrics.categories.set(operationName, category);
    
    // Maintain history size
    const latencies = this.operationMetrics.latencies.get(operationName);
    if (latencies.length > this.config.maxOperationHistory) {
      latencies.shift();
    }
    
    // Clean up
    this.activeOperations.delete(operationId);
    
    // Check for performance issues
    this.checkOperationPerformance(operationName, latency);
    
    this.logger.debug('Ended operation measurement', {
      subsystem: 'monitoring',
      component: 'performance-monitor',
      operationId,
      operationName,
      latency,
      category,
      operation: 'endOperation'
    });
    
    this.emit('operationComplete', {
      operationId,
      operationName,
      latency,
      category,
      metadata: { ...operation.metadata, ...result }
    });
  }

  /**
   * Record API response time
   * @param {string} endpoint - API endpoint
   * @param {number} responseTime - Response time in milliseconds
   * @param {number} statusCode - HTTP status code
   * @param {Object} metadata - Additional metadata
   */
  recordApiResponse(endpoint, responseTime, statusCode, metadata = {}) {
    // Store response time
    this.apiMetrics.responseTimes.push({
      endpoint,
      responseTime,
      statusCode,
      timestamp: Date.now(),
      metadata
    });
    
    // Update endpoint-specific metrics
    if (!this.apiMetrics.endpoints.has(endpoint)) {
      this.apiMetrics.endpoints.set(endpoint, {
        responseTimes: [],
        requestCount: 0,
        errorCount: 0,
        averageResponseTime: 0
      });
    }
    
    const endpointMetrics = this.apiMetrics.endpoints.get(endpoint);
    endpointMetrics.responseTimes.push(responseTime);
    endpointMetrics.requestCount++;
    
    if (statusCode >= 400) {
      endpointMetrics.errorCount++;
    }
    
    // Calculate rolling average
    const recentTimes = endpointMetrics.responseTimes.slice(-20);
    endpointMetrics.averageResponseTime = 
      recentTimes.reduce((sum, time) => sum + time, 0) / recentTimes.length;
    
    // Update status code tracking
    this.apiMetrics.statusCodes.set(
      statusCode,
      (this.apiMetrics.statusCodes.get(statusCode) || 0) + 1
    );
    
    // Maintain history size
    if (this.apiMetrics.responseTimes.length > this.config.maxMetricsHistory) {
      this.apiMetrics.responseTimes.shift();
    }
    
    if (endpointMetrics.responseTimes.length > 100) {
      endpointMetrics.responseTimes.shift();
    }
    
    // Check for performance issues
    this.checkApiPerformance(endpoint, responseTime, statusCode);
    
    this.emit('apiResponse', {
      endpoint,
      responseTime,
      statusCode,
      metadata
    });
  }

  /**
   * Record memory usage sample
   * @param {Object} memoryUsage - Memory usage data
   */
  recordMemoryUsage(memoryUsage) {
    const sample = {
      timestamp: Date.now(),
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      rss: memoryUsage.rss,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers
    };
    
    this.memoryMetrics.samples.push(sample);
    
    // Update peak usage
    if (sample.heapUsed > this.memoryMetrics.peakUsage) {
      this.memoryMetrics.peakUsage = sample.heapUsed;
    }
    
    // Maintain history size
    if (this.memoryMetrics.samples.length > this.config.maxMetricsHistory) {
      this.memoryMetrics.samples.shift();
    }
    
    // Calculate growth rate
    this.calculateMemoryGrowthRate();
    
    // Check for performance issues
    this.checkMemoryPerformance(sample);
    
    this.emit('memoryUsage', sample);
  }

  /**
   * Calculate memory growth rate
   */
  calculateMemoryGrowthRate() {
    const samples = this.memoryMetrics.samples;
    if (samples.length < 10) {
      return;
    }
    
    const recent = samples.slice(-10);
    const timeSpan = recent[recent.length - 1].timestamp - recent[0].timestamp;
    const memoryChange = recent[recent.length - 1].heapUsed - recent[0].heapUsed;
    
    // Growth rate in MB per minute
    this.memoryMetrics.growthRate = (memoryChange / timeSpan) * 60000;
    
    // Project future usage (next 10 minutes)
    this.memoryMetrics.projectedUsage = 
      recent[recent.length - 1].heapUsed + (this.memoryMetrics.growthRate * 10);
  }

  /**
   * Check API performance for issues
   */
  checkApiPerformance(endpoint, responseTime, statusCode) {
    let alertLevel = null;
    const issues = [];
    
    // Check response time thresholds
    if (responseTime >= this.config.apiResponseTimeCritical) {
      alertLevel = 'critical';
      issues.push(`Critical response time: ${responseTime}ms`);
    } else if (responseTime >= this.config.apiResponseTimeWarning) {
      alertLevel = 'warning';
      issues.push(`Slow response time: ${responseTime}ms`);
    }
    
    // Check status code
    if (statusCode >= 500) {
      alertLevel = alertLevel || 'critical';
      issues.push(`Server error: ${statusCode}`);
    } else if (statusCode >= 400) {
      alertLevel = alertLevel || 'warning';
      issues.push(`Client error: ${statusCode}`);
    }
    
    // Check against baseline
    const baseline = this.baselines.apiResponseTime;
    if (baseline.mean > 0 && responseTime > baseline.mean + (baseline.stdDev * this.config.baselineDeviationThreshold)) {
      alertLevel = alertLevel || 'warning';
      issues.push(`Performance regression detected`);
    }
    
    if (alertLevel && issues.length > 0) {
      this.emit('performanceAlert', {
        type: 'api',
        level: alertLevel,
        endpoint,
        responseTime,
        statusCode,
        issues,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Check operation performance for issues
   */
  checkOperationPerformance(operationName, latency) {
    let alertLevel = null;
    const issues = [];
    
    // Check latency thresholds
    if (latency >= this.config.operationLatencyCritical) {
      alertLevel = 'critical';
      issues.push(`Critical operation latency: ${latency}ms`);
    } else if (latency >= this.config.operationLatencyWarning) {
      alertLevel = 'warning';
      issues.push(`Slow operation: ${latency}ms`);
    }
    
    // Check against baseline
    const baseline = this.baselines.operationLatencies.get(operationName);
    if (baseline && baseline.mean > 0 && 
        latency > baseline.mean + (baseline.stdDev * this.config.baselineDeviationThreshold)) {
      alertLevel = alertLevel || 'warning';
      issues.push(`Operation performance regression`);
    }
    
    if (alertLevel && issues.length > 0) {
      this.emit('performanceAlert', {
        type: 'operation',
        level: alertLevel,
        operationName,
        latency,
        issues,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Check memory performance for issues
   */
  checkMemoryPerformance(sample) {
    let alertLevel = null;
    const issues = [];
    
    // Check growth rate
    if (this.memoryMetrics.growthRate >= this.config.memoryGrowthRateCritical) {
      alertLevel = 'critical';
      issues.push(`Critical memory growth rate: ${this.memoryMetrics.growthRate.toFixed(2)}MB/min`);
    } else if (this.memoryMetrics.growthRate >= this.config.memoryGrowthRateWarning) {
      alertLevel = 'warning';
      issues.push(`High memory growth rate: ${this.memoryMetrics.growthRate.toFixed(2)}MB/min`);
    }
    
    // Check projected usage
    if (this.memoryMetrics.projectedUsage > 1000) { // 1GB
      alertLevel = alertLevel || 'warning';
      issues.push(`High projected memory usage: ${this.memoryMetrics.projectedUsage.toFixed(0)}MB`);
    }
    
    if (alertLevel && issues.length > 0) {
      this.emit('performanceAlert', {
        type: 'memory',
        level: alertLevel,
        currentUsage: sample.heapUsed,
        growthRate: this.memoryMetrics.growthRate,
        projectedUsage: this.memoryMetrics.projectedUsage,
        issues,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Establish performance baselines
   */
  async establishBaselines() {
    this.logger.info('Establishing performance baselines', {
      subsystem: 'monitoring',
      component: 'performance-monitor',
      operation: 'establishBaselines'
    });
    
    // Initialize empty baselines - these will be populated as data comes in
    this.baselines.apiResponseTime = { mean: 0, stdDev: 0, samples: [] };
    this.baselines.memoryUsage = { mean: 0, stdDev: 0, samples: [] };
    
    // Take initial memory sample
    const memUsage = process.memoryUsage();
    this.recordMemoryUsage({
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024),
      arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024)
    });
  }

  /**
   * Update performance baselines
   */
  updateBaselines() {
    this.logger.debug('Updating performance baselines', {
      subsystem: 'monitoring',
      component: 'performance-monitor',
      operation: 'updateBaselines'
    });
    
    // Update API response time baseline
    if (this.apiMetrics.responseTimes.length >= this.config.baselineWindow) {
      const recentTimes = this.apiMetrics.responseTimes
        .slice(-this.config.baselineWindow)
        .map(r => r.responseTime);
        
      this.baselines.apiResponseTime = this.calculateStatistics(recentTimes);
    }
    
    // Update memory usage baseline
    if (this.memoryMetrics.samples.length >= this.config.baselineWindow) {
      const recentMemory = this.memoryMetrics.samples
        .slice(-this.config.baselineWindow)
        .map(s => s.heapUsed);
        
      this.baselines.memoryUsage = this.calculateStatistics(recentMemory);
    }
    
    // Update operation latency baselines
    for (const [operationName, latencies] of this.operationMetrics.latencies) {
      if (latencies.length >= Math.min(20, this.config.baselineWindow)) {
        const recentLatencies = latencies
          .slice(-Math.min(20, this.config.baselineWindow))
          .map(l => l.latency);
          
        this.baselines.operationLatencies.set(
          operationName,
          this.calculateStatistics(recentLatencies)
        );
      }
    }
  }

  /**
   * Calculate statistics for a dataset
   */
  calculateStatistics(data) {
    if (data.length === 0) {
      return { mean: 0, stdDev: 0, samples: [] };
    }
    
    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const variance = data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      mean: Math.round(mean * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      samples: data.length
    };
  }

  /**
   * Start performance monitoring intervals
   */
  startPerformanceMonitoring() {
    // Metrics collection
    this.metricsTimer = setInterval(() => {
      this.collectSystemMetrics();
    }, this.config.metricsCollectionInterval);
    
    // Performance analysis
    this.analysisTimer = setInterval(() => {
      this.performPerformanceAnalysis();
    }, this.config.performanceAnalysisInterval);
    
    // Baseline updates
    this.baselineTimer = setInterval(() => {
      this.updateBaselines();
    }, this.config.baselineUpdateInterval);
  }

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    try {
      // Collect memory metrics
      const memUsage = process.memoryUsage();
      this.recordMemoryUsage({
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024)
      });
      
      // Emit metrics collection event
      this.emit('metricsCollected', {
        timestamp: Date.now(),
        memoryMetrics: this.memoryMetrics.samples.length,
        apiMetrics: this.apiMetrics.responseTimes.length,
        operationMetrics: this.operationMetrics.latencies.size
      });
      
    } catch (error) {
      this.logger.error('Failed to collect system metrics', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        operation: 'collectSystemMetrics'
      }, error);
    }
  }

  /**
   * Perform comprehensive performance analysis
   */
  performPerformanceAnalysis() {
    try {
      const analysis = {
        timestamp: Date.now(),
        trends: this.calculatePerformanceTrends(),
        regressions: this.detectPerformanceRegressions(),
        optimizations: this.generateOptimizationRecommendations(),
        capacity: this.performCapacityAnalysis()
      };
      
      this.performanceAnalysis = analysis;
      
      this.logger.info('Performance analysis completed', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        trends: Object.keys(analysis.trends).length,
        regressions: analysis.regressions.length,
        optimizations: analysis.optimizations.length,
        operation: 'performPerformanceAnalysis'
      });
      
      this.emit('performanceAnalysis', analysis);
      
    } catch (error) {
      this.logger.error('Performance analysis failed', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        operation: 'performPerformanceAnalysis'
      }, error);
    }
  }

  /**
   * Calculate performance trends
   */
  calculatePerformanceTrends() {
    const trends = {};
    
    // API response time trend
    if (this.apiMetrics.responseTimes.length >= 20) {
      const recent = this.apiMetrics.responseTimes.slice(-20);
      const older = this.apiMetrics.responseTimes.slice(-40, -20);
      
      if (older.length > 0) {
        const recentAvg = recent.reduce((sum, r) => sum + r.responseTime, 0) / recent.length;
        const olderAvg = older.reduce((sum, r) => sum + r.responseTime, 0) / older.length;
        
        trends.apiResponseTime = {
          current: recentAvg,
          previous: olderAvg,
          change: recentAvg - olderAvg,
          changePercent: ((recentAvg - olderAvg) / olderAvg) * 100,
          direction: recentAvg > olderAvg ? 'increasing' : 'decreasing'
        };
      }
    }
    
    // Memory usage trend
    if (this.memoryMetrics.samples.length >= 20) {
      trends.memoryUsage = {
        current: this.memoryMetrics.samples[this.memoryMetrics.samples.length - 1].heapUsed,
        growthRate: this.memoryMetrics.growthRate,
        projectedUsage: this.memoryMetrics.projectedUsage,
        peakUsage: this.memoryMetrics.peakUsage
      };
    }
    
    // Operation latency trends
    for (const [operationName, latencies] of this.operationMetrics.latencies) {
      if (latencies.length >= 10) {
        const recent = latencies.slice(-10);
        const recentAvg = recent.reduce((sum, l) => sum + l.latency, 0) / recent.length;
        
        trends[`operation_${operationName}`] = {
          averageLatency: recentAvg,
          frequency: this.operationMetrics.frequencies.get(operationName) || 0,
          category: this.operationMetrics.categories.get(operationName) || 'unknown'
        };
      }
    }
    
    return trends;
  }

  /**
   * Detect performance regressions
   */
  detectPerformanceRegressions() {
    const regressions = [];
    
    // Check API response time regressions
    const apiBaseline = this.baselines.apiResponseTime;
    if (apiBaseline.mean > 0 && this.apiMetrics.responseTimes.length >= 10) {
      const recentResponses = this.apiMetrics.responseTimes.slice(-10);
      const recentAvg = recentResponses.reduce((sum, r) => sum + r.responseTime, 0) / recentResponses.length;
      
      if (recentAvg > apiBaseline.mean + (apiBaseline.stdDev * this.config.baselineDeviationThreshold)) {
        regressions.push({
          type: 'api_response_time',
          severity: recentAvg > apiBaseline.mean + (apiBaseline.stdDev * 3) ? 'critical' : 'warning',
          current: recentAvg,
          baseline: apiBaseline.mean,
          deviation: ((recentAvg - apiBaseline.mean) / apiBaseline.mean) * 100,
          message: `API response time regression: ${recentAvg.toFixed(0)}ms vs baseline ${apiBaseline.mean.toFixed(0)}ms`
        });
      }
    }
    
    // Check operation latency regressions
    for (const [operationName, baseline] of this.baselines.operationLatencies) {
      const latencies = this.operationMetrics.latencies.get(operationName);
      if (latencies && latencies.length >= 5) {
        const recentLatencies = latencies.slice(-5);
        const recentAvg = recentLatencies.reduce((sum, l) => sum + l.latency, 0) / recentLatencies.length;
        
        if (recentAvg > baseline.mean + (baseline.stdDev * this.config.baselineDeviationThreshold)) {
          regressions.push({
            type: 'operation_latency',
            operation: operationName,
            severity: recentAvg > baseline.mean + (baseline.stdDev * 3) ? 'critical' : 'warning',
            current: recentAvg,
            baseline: baseline.mean,
            deviation: ((recentAvg - baseline.mean) / baseline.mean) * 100,
            message: `Operation '${operationName}' latency regression: ${recentAvg.toFixed(0)}ms vs baseline ${baseline.mean.toFixed(0)}ms`
          });
        }
      }
    }
    
    return regressions;
  }

  /**
   * Generate optimization recommendations
   */
  generateOptimizationRecommendations() {
    const recommendations = [];
    
    // Memory optimization recommendations
    if (this.memoryMetrics.growthRate > this.config.memoryGrowthRateWarning) {
      recommendations.push({
        type: 'memory',
        priority: this.memoryMetrics.growthRate > this.config.memoryGrowthRateCritical ? 'high' : 'medium',
        title: 'High memory growth rate detected',
        description: `Memory is growing at ${this.memoryMetrics.growthRate.toFixed(2)}MB/min`,
        suggestions: [
          'Review memory usage patterns',
          'Check for memory leaks',
          'Consider garbage collection tuning',
          'Optimize data structures'
        ]
      });
    }
    
    // API performance recommendations
    const apiBaseline = this.baselines.apiResponseTime;
    if (apiBaseline.mean > this.config.apiResponseTimeWarning) {
      recommendations.push({
        type: 'api',
        priority: apiBaseline.mean > this.config.apiResponseTimeCritical ? 'high' : 'medium',
        title: 'Slow API response times',
        description: `Average API response time is ${apiBaseline.mean.toFixed(0)}ms`,
        suggestions: [
          'Enable connection pooling',
          'Implement request caching',
          'Optimize API payload size',
          'Consider API endpoint optimization'
        ]
      });
    }
    
    // Operation latency recommendations
    for (const [operationName, latencies] of this.operationMetrics.latencies) {
      if (latencies.length >= 5) {
        const recent = latencies.slice(-5);
        const avgLatency = recent.reduce((sum, l) => sum + l.latency, 0) / recent.length;
        
        if (avgLatency > this.config.operationLatencyWarning) {
          recommendations.push({
            type: 'operation',
            priority: avgLatency > this.config.operationLatencyCritical ? 'high' : 'medium',
            title: `Slow operation: ${operationName}`,
            description: `Average latency is ${avgLatency.toFixed(0)}ms`,
            suggestions: [
              'Profile operation performance',
              'Optimize algorithm complexity',
              'Consider caching results',
              'Review database queries'
            ]
          });
        }
      }
    }
    
    return recommendations;
  }

  /**
   * Perform capacity analysis
   */
  performCapacityAnalysis() {
    const analysis = {
      memory: {},
      api: {},
      operations: {}
    };
    
    // Memory capacity analysis
    if (this.memoryMetrics.samples.length > 0) {
      const currentUsage = this.memoryMetrics.samples[this.memoryMetrics.samples.length - 1].heapUsed;
      const growthRate = this.memoryMetrics.growthRate;
      
      analysis.memory = {
        currentUsage,
        growthRate,
        projectedUsage: this.memoryMetrics.projectedUsage,
        timeToCapacity: growthRate > 0 ? (1000 - currentUsage) / (growthRate / 60) : null, // minutes to 1GB
        recommendation: currentUsage > 500 ? 'Monitor closely' : 'Healthy'
      };
    }
    
    // API capacity analysis
    if (this.apiMetrics.responseTimes.length > 0) {
      const recentTimes = this.apiMetrics.responseTimes.slice(-20);
      const averageResponseTime = recentTimes.reduce((sum, r) => sum + r.responseTime, 0) / recentTimes.length;
      
      analysis.api = {
        averageResponseTime,
        requestsPerMinute: recentTimes.length,
        capacityUtilization: Math.min((averageResponseTime / this.config.apiResponseTimeWarning) * 100, 100),
        recommendation: averageResponseTime > this.config.apiResponseTimeWarning ? 'Scale up' : 'Healthy'
      };
    }
    
    // Operations capacity analysis
    for (const [operationName, latencies] of this.operationMetrics.latencies) {
      if (latencies.length >= 5) {
        const recent = latencies.slice(-5);
        const avgLatency = recent.reduce((sum, l) => sum + l.latency, 0) / recent.length;
        const frequency = this.operationMetrics.frequencies.get(operationName) || 0;
        
        analysis.operations[operationName] = {
          averageLatency: avgLatency,
          frequency,
          category: this.operationMetrics.categories.get(operationName),
          recommendation: avgLatency > this.config.operationLatencyWarning ? 'Optimize' : 'Healthy'
        };
      }
    }
    
    return analysis;
  }

  /**
   * Get performance statistics
   */
  getPerformanceStats() {
    return {
      initialization: {
        initialized: this.initialized,
        startTime: this.config.startTime || Date.now()
      },
      
      metrics: {
        api: {
          totalResponses: this.apiMetrics.responseTimes.length,
          endpoints: this.apiMetrics.endpoints.size,
          averageResponseTime: this.apiMetrics.responseTimes.length > 0 ?
            this.apiMetrics.responseTimes.reduce((sum, r) => sum + r.responseTime, 0) / this.apiMetrics.responseTimes.length : 0,
          statusCodes: Object.fromEntries(this.apiMetrics.statusCodes)
        },
        
        memory: {
          samples: this.memoryMetrics.samples.length,
          currentUsage: this.memoryMetrics.samples.length > 0 ? 
            this.memoryMetrics.samples[this.memoryMetrics.samples.length - 1].heapUsed : 0,
          growthRate: this.memoryMetrics.growthRate,
          peakUsage: this.memoryMetrics.peakUsage,
          projectedUsage: this.memoryMetrics.projectedUsage
        },
        
        operations: {
          tracked: this.operationMetrics.latencies.size,
          active: this.activeOperations.size,
          totalOperations: Array.from(this.operationMetrics.frequencies.values())
            .reduce((sum, count) => sum + count, 0)
        }
      },
      
      baselines: {
        apiResponseTime: this.baselines.apiResponseTime,
        memoryUsage: this.baselines.memoryUsage,
        operationBaselines: Object.fromEntries(this.baselines.operationLatencies)
      },
      
      analysis: this.performanceAnalysis,
      
      configuration: {
        metricsInterval: this.config.metricsCollectionInterval,
        analysisInterval: this.config.performanceAnalysisInterval,
        apiWarningThreshold: this.config.apiResponseTimeWarning,
        memoryWarningThreshold: this.config.memoryGrowthRateWarning,
        operationWarningThreshold: this.config.operationLatencyWarning
      }
    };
  }

  /**
   * Get performance percentiles for API responses
   */
  getApiPercentiles() {
    if (this.apiMetrics.responseTimes.length === 0) {
      return null;
    }
    
    const times = this.apiMetrics.responseTimes
      .map(r => r.responseTime)
      .sort((a, b) => a - b);
    
    return {
      p50: this.calculatePercentile(times, 50),
      p75: this.calculatePercentile(times, 75),
      p90: this.calculatePercentile(times, 90),
      p95: this.calculatePercentile(times, 95),
      p99: this.calculatePercentile(times, 99),
      min: times[0],
      max: times[times.length - 1]
    };
  }

  /**
   * Calculate percentile value
   */
  calculatePercentile(sortedArray, percentile) {
    const index = (percentile / 100) * (sortedArray.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    
    if (lower === upper) {
      return sortedArray[lower];
    }
    
    return sortedArray[lower] + (sortedArray[upper] - sortedArray[lower]) * (index - lower);
  }

  /**
   * Clean up and shut down performance monitoring
   */
  async cleanup() {
    try {
      this.logger.info('Shutting down performance monitor', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        operation: 'cleanup'
      });

      // Clear intervals
      if (this.metricsTimer) clearInterval(this.metricsTimer);
      if (this.analysisTimer) clearInterval(this.analysisTimer);
      if (this.baselineTimer) clearInterval(this.baselineTimer);
      
      // Perform final analysis
      if (this.initialized) {
        this.performPerformanceAnalysis();
      }
      
      // Generate final performance report
      const finalReport = this.getPerformanceStats();
      this.logger.info('Final performance report', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        finalReport,
        operation: 'cleanup'
      });
      
      this.emit('shutdown', finalReport);

    } catch (error) {
      this.logger.error('Error during performance monitor cleanup', {
        subsystem: 'monitoring',
        component: 'performance-monitor',
        operation: 'cleanup'
      }, error);
    }
  }
}

export default PerformanceMonitor;