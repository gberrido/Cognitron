#!/usr/bin/env node

/**
 * Memory Usage Monitor - Advanced memory tracking and optimization for long-running sessions
 * 
 * Features:
 * - Real-time memory usage tracking with Node.js process.memoryUsage()
 * - Memory pressure detection with configurable thresholds
 * - Automatic garbage collection triggers with performance optimization
 * - Memory leak detection through delta analysis and pattern recognition
 * - Memory profiling for components (heap, RSS, external, array buffers)
 * - Comprehensive memory health reporting and alerting
 * - Performance impact analysis for memory operations
 * - Memory optimization recommendations based on usage patterns
 */

import { EventEmitter } from 'events';
import { getLogger } from '../utils/StructuredLogger.js';

export class MemoryMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Monitoring intervals
      samplingInterval: config.samplingInterval || 30000, // 30 seconds
      profileInterval: config.profileInterval || 300000,   // 5 minutes
      reportInterval: config.reportInterval || 900000,     // 15 minutes
      
      // Memory thresholds (in MB)
      heapWarningThreshold: config.heapWarningThreshold || 100,
      heapCriticalThreshold: config.heapCriticalThreshold || 200,
      rssWarningThreshold: config.rssWarningThreshold || 300,
      rssCriticalThreshold: config.rssCriticalThreshold || 500,
      
      // GC optimization settings
      enableAutoGC: config.enableAutoGC !== false,
      gcThresholdMultiplier: config.gcThresholdMultiplier || 1.5,
      maxGCFrequency: config.maxGCFrequency || 60000,      // Max once per minute
      
      // Leak detection settings
      enableLeakDetection: config.enableLeakDetection !== false,
      leakDetectionSamples: config.leakDetectionSamples || 10,
      leakThresholdMB: config.leakThresholdMB || 50,
      
      // Performance tracking
      trackPerformanceImpact: config.trackPerformanceImpact !== false,
      maxHistorySize: config.maxHistorySize || 1000,
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Memory tracking state
    this.memoryHistory = [];
    this.componentMetrics = new Map(); // component -> memory stats
    this.gcHistory = [];
    this.performanceMetrics = {
      gcCount: 0,
      totalGCTime: 0,
      averageGCTime: 0,
      memoryLeaksDetected: 0,
      peakHeapUsage: 0,
      peakRSSUsage: 0
    };
    
    // Leak detection state
    this.leakDetectionBuffer = [];
    this.suspiciousPatterns = [];
    
    // Monitoring intervals
    this.samplingTimer = null;
    this.profileTimer = null;
    this.reportTimer = null;
    
    // Component registration
    this.registeredComponents = new Map();
    
    this.initialized = false;
  }

  /**
   * Initialize memory monitoring
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing memory monitor', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        config: {
          samplingInterval: this.config.samplingInterval,
          heapWarning: this.config.heapWarningThreshold,
          heapCritical: this.config.heapCriticalThreshold,
          autoGC: this.config.enableAutoGC,
          leakDetection: this.config.enableLeakDetection
        },
        operation: 'initialize'
      });

      // Take initial memory snapshot
      this.takeMemorySnapshot();
      
      // Start monitoring intervals
      this.startMonitoring();
      
      // Set up process event listeners
      this.setupProcessListeners();
      
      this.initialized = true;
      
      this.logger.info('Memory monitor initialized', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        operation: 'initialize'
      });
      
      this.emit('initialized');

    } catch (error) {
      this.logger.error('Failed to initialize memory monitor', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Register a component for memory tracking
   * @param {string} name - Component name
   * @param {Object} component - Component instance with optional getMemoryUsage() method
   */
  registerComponent(name, component) {
    this.registeredComponents.set(name, component);
    this.componentMetrics.set(name, {
      registered: Date.now(),
      measurements: [],
      averageMemory: 0,
      peakMemory: 0,
      growthRate: 0
    });
    
    this.logger.debug('Component registered for memory monitoring', {
      subsystem: 'monitoring',
      component: 'memory-monitor',
      componentName: name,
      hasMemoryMethod: typeof component.getMemoryUsage === 'function',
      operation: 'registerComponent'
    });
  }

  /**
   * Take a memory snapshot
   */
  takeMemorySnapshot() {
    const memUsage = process.memoryUsage();
    const timestamp = Date.now();
    
    // Convert bytes to MB for easier reading
    const snapshot = {
      timestamp,
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024 * 100) / 100,
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024 * 100) / 100,
      rss: Math.round(memUsage.rss / 1024 / 1024 * 100) / 100,
      external: Math.round(memUsage.external / 1024 / 1024 * 100) / 100,
      arrayBuffers: Math.round(memUsage.arrayBuffers / 1024 / 1024 * 100) / 100
    };
    
    // Add to history
    this.memoryHistory.push(snapshot);
    
    // Maintain history size limit
    if (this.memoryHistory.length > this.config.maxHistorySize) {
      this.memoryHistory.shift();
    }
    
    // Update peak usage tracking
    if (snapshot.heapUsed > this.performanceMetrics.peakHeapUsage) {
      this.performanceMetrics.peakHeapUsage = snapshot.heapUsed;
    }
    if (snapshot.rss > this.performanceMetrics.peakRSSUsage) {
      this.performanceMetrics.peakRSSUsage = snapshot.rss;
    }
    
    // Component-specific measurements
    this.measureComponentMemory(timestamp);
    
    // Check thresholds and trigger alerts
    this.checkMemoryThresholds(snapshot);
    
    // Leak detection
    if (this.config.enableLeakDetection) {
      this.detectMemoryLeaks(snapshot);
    }
    
    // Auto GC if enabled and thresholds met
    if (this.config.enableAutoGC) {
      this.checkAutoGC(snapshot);
    }
    
    return snapshot;
  }

  /**
   * Measure memory usage for registered components
   * @param {number} timestamp - Current timestamp
   */
  measureComponentMemory(timestamp) {
    for (const [name, component] of this.registeredComponents) {
      try {
        let memoryUsage = 0;
        
        // Try component's custom memory method
        if (typeof component.getMemoryUsage === 'function') {
          memoryUsage = component.getMemoryUsage();
        } else if (component.constructor.name === 'Map' || component.constructor.name === 'Set') {
          // Estimate memory for collections
          memoryUsage = this.estimateCollectionMemory(component);
        } else if (Array.isArray(component)) {
          // Estimate memory for arrays
          memoryUsage = this.estimateArrayMemory(component);
        } else if (typeof component === 'object' && component !== null) {
          // Estimate memory for objects
          memoryUsage = this.estimateObjectMemory(component);
        }
        
        const metrics = this.componentMetrics.get(name);
        metrics.measurements.push({
          timestamp,
          memory: memoryUsage
        });
        
        // Maintain measurement history
        if (metrics.measurements.length > 100) {
          metrics.measurements.shift();
        }
        
        // Update statistics
        this.updateComponentStatistics(name, metrics);
        
      } catch (error) {
        this.logger.warn('Failed to measure component memory', {
          subsystem: 'monitoring',
          component: 'memory-monitor',
          componentName: name,
          operation: 'measureComponentMemory'
        }, error);
      }
    }
  }

  /**
   * Update component statistics
   * @param {string} name - Component name
   * @param {Object} metrics - Component metrics
   */
  updateComponentStatistics(name, metrics) {
    if (metrics.measurements.length === 0) return;
    
    // Calculate average memory usage
    const totalMemory = metrics.measurements.reduce((sum, m) => sum + m.memory, 0);
    metrics.averageMemory = totalMemory / metrics.measurements.length;
    
    // Find peak memory usage
    metrics.peakMemory = Math.max(...metrics.measurements.map(m => m.memory));
    
    // Calculate growth rate (MB per hour)
    if (metrics.measurements.length >= 10) {
      const recent = metrics.measurements.slice(-10);
      const oldest = recent[0];
      const newest = recent[recent.length - 1];
      const timeDiffHours = (newest.timestamp - oldest.timestamp) / 1000 / 60 / 60;
      
      if (timeDiffHours > 0) {
        metrics.growthRate = (newest.memory - oldest.memory) / timeDiffHours;
      }
    }
  }

  /**
   * Check memory thresholds and trigger alerts
   * @param {Object} snapshot - Memory snapshot
   */
  checkMemoryThresholds(snapshot) {
    // Heap memory checks
    if (snapshot.heapUsed >= this.config.heapCriticalThreshold) {
      this.logger.error('Critical heap memory usage detected', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        heapUsed: snapshot.heapUsed,
        threshold: this.config.heapCriticalThreshold,
        operation: 'checkMemoryThresholds'
      });
      
      this.emit('memoryAlert', {
        type: 'critical',
        metric: 'heap',
        current: snapshot.heapUsed,
        threshold: this.config.heapCriticalThreshold,
        snapshot
      });
      
    } else if (snapshot.heapUsed >= this.config.heapWarningThreshold) {
      this.logger.warn('High heap memory usage detected', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        heapUsed: snapshot.heapUsed,
        threshold: this.config.heapWarningThreshold,
        operation: 'checkMemoryThresholds'
      });
      
      this.emit('memoryAlert', {
        type: 'warning',
        metric: 'heap',
        current: snapshot.heapUsed,
        threshold: this.config.heapWarningThreshold,
        snapshot
      });
    }
    
    // RSS memory checks
    if (snapshot.rss >= this.config.rssCriticalThreshold) {
      this.logger.error('Critical RSS memory usage detected', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        rss: snapshot.rss,
        threshold: this.config.rssCriticalThreshold,
        operation: 'checkMemoryThresholds'
      });
      
      this.emit('memoryAlert', {
        type: 'critical',
        metric: 'rss',
        current: snapshot.rss,
        threshold: this.config.rssCriticalThreshold,
        snapshot
      });
      
    } else if (snapshot.rss >= this.config.rssWarningThreshold) {
      this.logger.warn('High RSS memory usage detected', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        rss: snapshot.rss,
        threshold: this.config.rssWarningThreshold,
        operation: 'checkMemoryThresholds'
      });
      
      this.emit('memoryAlert', {
        type: 'warning',
        metric: 'rss',
        current: snapshot.rss,
        threshold: this.config.rssWarningThreshold,
        snapshot
      });
    }
  }

  /**
   * Detect potential memory leaks
   * @param {Object} snapshot - Current memory snapshot
   */
  detectMemoryLeaks(snapshot) {
    this.leakDetectionBuffer.push(snapshot);
    
    // Keep only required samples
    if (this.leakDetectionBuffer.length > this.config.leakDetectionSamples) {
      this.leakDetectionBuffer.shift();
    }
    
    // Need enough samples for analysis
    if (this.leakDetectionBuffer.length < this.config.leakDetectionSamples) {
      return;
    }
    
    // Analyze heap growth pattern
    const heapGrowth = this.analyzeGrowthPattern(this.leakDetectionBuffer, 'heapUsed');
    const rssGrowth = this.analyzeGrowthPattern(this.leakDetectionBuffer, 'rss');
    
    // Detect sustained growth (potential leak)
    if (heapGrowth.isSustained && heapGrowth.totalGrowth > this.config.leakThresholdMB) {
      this.logger.warn('Potential memory leak detected in heap', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        growthRate: heapGrowth.rate,
        totalGrowth: heapGrowth.totalGrowth,
        samples: this.config.leakDetectionSamples,
        operation: 'detectMemoryLeaks'
      });
      
      this.performanceMetrics.memoryLeaksDetected++;
      this.suspiciousPatterns.push({
        type: 'heap_leak',
        detected: Date.now(),
        growthRate: heapGrowth.rate,
        totalGrowth: heapGrowth.totalGrowth
      });
      
      this.emit('memoryLeak', {
        type: 'heap',
        growthRate: heapGrowth.rate,
        totalGrowth: heapGrowth.totalGrowth,
        samples: this.leakDetectionBuffer.slice()
      });
    }
    
    if (rssGrowth.isSustained && rssGrowth.totalGrowth > this.config.leakThresholdMB * 2) {
      this.logger.warn('Potential memory leak detected in RSS', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        growthRate: rssGrowth.rate,
        totalGrowth: rssGrowth.totalGrowth,
        samples: this.config.leakDetectionSamples,
        operation: 'detectMemoryLeaks'
      });
      
      this.performanceMetrics.memoryLeaksDetected++;
      this.suspiciousPatterns.push({
        type: 'rss_leak',
        detected: Date.now(),
        growthRate: rssGrowth.rate,
        totalGrowth: rssGrowth.totalGrowth
      });
      
      this.emit('memoryLeak', {
        type: 'rss',
        growthRate: rssGrowth.rate,
        totalGrowth: rssGrowth.totalGrowth,
        samples: this.leakDetectionBuffer.slice()
      });
    }
  }

  /**
   * Analyze memory growth pattern
   * @param {Array} samples - Memory samples
   * @param {string} metric - Metric to analyze (heapUsed, rss, etc.)
   * @returns {Object} Growth analysis
   */
  analyzeGrowthPattern(samples, metric) {
    if (samples.length < 3) {
      return { isSustained: false, rate: 0, totalGrowth: 0 };
    }
    
    const values = samples.map(s => s[metric]);
    const timeSpan = samples[samples.length - 1].timestamp - samples[0].timestamp;
    const totalGrowth = values[values.length - 1] - values[0];
    const rate = totalGrowth / (timeSpan / 1000 / 60 / 60); // MB per hour
    
    // Check if growth is sustained (majority of samples show growth)
    let growthCount = 0;
    for (let i = 1; i < values.length; i++) {
      if (values[i] > values[i - 1]) {
        growthCount++;
      }
    }
    
    const growthRatio = growthCount / (values.length - 1);
    const isSustained = growthRatio > 0.7 && totalGrowth > 0; // 70% of samples show growth
    
    return {
      isSustained,
      rate: Math.round(rate * 100) / 100,
      totalGrowth: Math.round(totalGrowth * 100) / 100,
      growthRatio: Math.round(growthRatio * 100) / 100
    };
  }

  /**
   * Check if automatic garbage collection should be triggered
   * @param {Object} snapshot - Current memory snapshot
   */
  checkAutoGC(snapshot) {
    const now = Date.now();
    
    // Check if enough time has passed since last GC
    if (this.gcHistory.length > 0) {
      const lastGC = this.gcHistory[this.gcHistory.length - 1];
      if (now - lastGC.timestamp < this.config.maxGCFrequency) {
        return;
      }
    }
    
    // Check if heap usage exceeds threshold
    const gcThreshold = this.config.heapWarningThreshold * this.config.gcThresholdMultiplier;
    
    if (snapshot.heapUsed >= gcThreshold) {
      this.logger.info('Triggering automatic garbage collection', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        heapUsed: snapshot.heapUsed,
        threshold: gcThreshold,
        operation: 'checkAutoGC'
      });
      
      this.forceGarbageCollection();
    }
  }

  /**
   * Force garbage collection and measure performance
   */
  forceGarbageCollection() {
    const startTime = Date.now();
    const beforeMemory = process.memoryUsage();
    
    try {
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      } else {
        this.logger.warn('Garbage collection not available (requires --expose-gc flag)', {
          subsystem: 'monitoring',
          component: 'memory-monitor',
          operation: 'forceGarbageCollection'
        });
        return;
      }
      
      const afterMemory = process.memoryUsage();
      const gcTime = Date.now() - startTime;
      
      // Calculate memory freed
      const heapFreed = (beforeMemory.heapUsed - afterMemory.heapUsed) / 1024 / 1024;
      const rssFreed = (beforeMemory.rss - afterMemory.rss) / 1024 / 1024;
      
      // Record GC statistics
      const gcRecord = {
        timestamp: Date.now(),
        duration: gcTime,
        heapBefore: Math.round(beforeMemory.heapUsed / 1024 / 1024 * 100) / 100,
        heapAfter: Math.round(afterMemory.heapUsed / 1024 / 1024 * 100) / 100,
        heapFreed: Math.round(heapFreed * 100) / 100,
        rssFreed: Math.round(rssFreed * 100) / 100
      };
      
      this.gcHistory.push(gcRecord);
      
      // Maintain GC history size
      if (this.gcHistory.length > 50) {
        this.gcHistory.shift();
      }
      
      // Update performance metrics
      this.performanceMetrics.gcCount++;
      this.performanceMetrics.totalGCTime += gcTime;
      this.performanceMetrics.averageGCTime = this.performanceMetrics.totalGCTime / this.performanceMetrics.gcCount;
      
      this.logger.info('Garbage collection completed', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        duration: gcTime,
        heapFreed: gcRecord.heapFreed,
        rssFreed: gcRecord.rssFreed,
        heapAfter: gcRecord.heapAfter,
        operation: 'forceGarbageCollection'
      });
      
      this.emit('garbageCollected', gcRecord);
      
    } catch (error) {
      this.logger.error('Garbage collection failed', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        operation: 'forceGarbageCollection'
      }, error);
    }
  }

  /**
   * Start monitoring intervals
   */
  startMonitoring() {
    // Regular memory sampling
    this.samplingTimer = setInterval(() => {
      this.takeMemorySnapshot();
    }, this.config.samplingInterval);
    
    // Periodic component profiling
    this.profileTimer = setInterval(() => {
      this.profileComponents();
    }, this.config.profileInterval);
    
    // Periodic reporting
    this.reportTimer = setInterval(() => {
      this.generateMemoryReport();
    }, this.config.reportInterval);
  }

  /**
   * Profile registered components
   */
  profileComponents() {
    this.logger.debug('Profiling component memory usage', {
      subsystem: 'monitoring',
      component: 'memory-monitor',
      componentCount: this.registeredComponents.size,
      operation: 'profileComponents'
    });
    
    const componentProfile = {};
    
    for (const [name, metrics] of this.componentMetrics) {
      componentProfile[name] = {
        averageMemory: Math.round(metrics.averageMemory * 100) / 100,
        peakMemory: Math.round(metrics.peakMemory * 100) / 100,
        growthRate: Math.round(metrics.growthRate * 100) / 100,
        measurementCount: metrics.measurements.length,
        registeredFor: Math.round((Date.now() - metrics.registered) / 1000 / 60) // minutes
      };
    }
    
    this.emit('componentProfile', componentProfile);
  }

  /**
   * Generate comprehensive memory report
   */
  generateMemoryReport() {
    const report = this.getMemoryReport();
    
    this.logger.info('Memory usage report', {
      subsystem: 'monitoring',
      component: 'memory-monitor',
      report,
      operation: 'generateMemoryReport'
    });
    
    this.emit('memoryReport', report);
  }

  /**
   * Get comprehensive memory report
   * @returns {Object} Memory report
   */
  getMemoryReport() {
    const currentMemory = this.memoryHistory.length > 0 ? 
      this.memoryHistory[this.memoryHistory.length - 1] : 
      process.memoryUsage();
    
    const uptime = process.uptime();
    
    // Calculate memory trends
    const trends = this.calculateMemoryTrends();
    
    // Generate recommendations
    const recommendations = this.generateOptimizationRecommendations();
    
    return {
      timestamp: new Date().toISOString(),
      uptime: Math.round(uptime),
      
      current: {
        heapUsed: currentMemory.heapUsed || Math.round(currentMemory.heapUsed / 1024 / 1024 * 100) / 100,
        heapTotal: currentMemory.heapTotal || Math.round(currentMemory.heapTotal / 1024 / 1024 * 100) / 100,
        rss: currentMemory.rss || Math.round(currentMemory.rss / 1024 / 1024 * 100) / 100,
        external: currentMemory.external || Math.round(currentMemory.external / 1024 / 1024 * 100) / 100,
        arrayBuffers: currentMemory.arrayBuffers || Math.round(currentMemory.arrayBuffers / 1024 / 1024 * 100) / 100
      },
      
      peaks: {
        heapUsed: this.performanceMetrics.peakHeapUsage,
        rss: this.performanceMetrics.peakRSSUsage
      },
      
      trends,
      
      garbageCollection: {
        count: this.performanceMetrics.gcCount,
        totalTime: this.performanceMetrics.totalGCTime,
        averageTime: Math.round(this.performanceMetrics.averageGCTime * 100) / 100,
        lastGC: this.gcHistory.length > 0 ? this.gcHistory[this.gcHistory.length - 1] : null
      },
      
      leakDetection: {
        enabled: this.config.enableLeakDetection,
        leaksDetected: this.performanceMetrics.memoryLeaksDetected,
        suspiciousPatterns: this.suspiciousPatterns.length,
        recentPatterns: this.suspiciousPatterns.slice(-3)
      },
      
      componentCount: this.registeredComponents.size,
      historySize: this.memoryHistory.length,
      
      health: this.assessMemoryHealth(),
      recommendations
    };
  }

  /**
   * Calculate memory usage trends
   * @returns {Object} Memory trends
   */
  calculateMemoryTrends() {
    if (this.memoryHistory.length < 10) {
      return { insufficient_data: true };
    }
    
    const recent = this.memoryHistory.slice(-10);
    const hourAgo = this.memoryHistory.find(h => 
      Date.now() - h.timestamp <= 3600000 // 1 hour
    ) || recent[0];
    
    return {
      heap: {
        current: recent[recent.length - 1].heapUsed,
        hourAgo: hourAgo.heapUsed,
        change: Math.round((recent[recent.length - 1].heapUsed - hourAgo.heapUsed) * 100) / 100,
        changePercent: Math.round(((recent[recent.length - 1].heapUsed - hourAgo.heapUsed) / hourAgo.heapUsed) * 10000) / 100
      },
      
      rss: {
        current: recent[recent.length - 1].rss,
        hourAgo: hourAgo.rss,
        change: Math.round((recent[recent.length - 1].rss - hourAgo.rss) * 100) / 100,
        changePercent: Math.round(((recent[recent.length - 1].rss - hourAgo.rss) / hourAgo.rss) * 10000) / 100
      }
    };
  }

  /**
   * Generate optimization recommendations
   * @returns {Array} List of recommendations
   */
  generateOptimizationRecommendations() {
    const recommendations = [];
    const currentMemory = this.memoryHistory[this.memoryHistory.length - 1] || {};
    
    // High heap usage
    if (currentMemory.heapUsed > this.config.heapWarningThreshold) {
      recommendations.push({
        type: 'heap_optimization',
        priority: 'high',
        message: 'Consider reducing in-memory data structures or implementing pagination',
        action: 'Review large objects, arrays, and caches for optimization opportunities'
      });
    }
    
    // High RSS usage
    if (currentMemory.rss > this.config.rssWarningThreshold) {
      recommendations.push({
        type: 'rss_optimization',
        priority: 'medium',
        message: 'RSS memory usage is high, consider process optimization',
        action: 'Monitor external libraries and native dependencies'
      });
    }
    
    // Frequent garbage collection
    if (this.performanceMetrics.gcCount > 10 && this.performanceMetrics.averageGCTime > 10) {
      recommendations.push({
        type: 'gc_optimization',
        priority: 'medium',
        message: 'Frequent or slow garbage collection detected',
        action: 'Optimize object creation patterns and reduce allocation pressure'
      });
    }
    
    // Memory leak patterns
    if (this.performanceMetrics.memoryLeaksDetected > 0) {
      recommendations.push({
        type: 'leak_investigation',
        priority: 'high',
        message: 'Potential memory leaks detected',
        action: 'Investigate event listener cleanup, closure references, and global variables'
      });
    }
    
    // Component growth patterns
    for (const [name, metrics] of this.componentMetrics) {
      if (metrics.growthRate > 10) { // Growing more than 10MB/hour
        recommendations.push({
          type: 'component_growth',
          priority: 'medium',
          message: `Component '${name}' showing high memory growth`,
          action: `Review ${name} for unbounded collections or cache growth`
        });
      }
    }
    
    return recommendations;
  }

  /**
   * Assess overall memory health
   * @returns {string} Health status
   */
  assessMemoryHealth() {
    const currentMemory = this.memoryHistory[this.memoryHistory.length - 1] || {};
    
    if (currentMemory.heapUsed >= this.config.heapCriticalThreshold ||
        currentMemory.rss >= this.config.rssCriticalThreshold ||
        this.performanceMetrics.memoryLeaksDetected > 2) {
      return 'critical';
    }
    
    if (currentMemory.heapUsed >= this.config.heapWarningThreshold ||
        currentMemory.rss >= this.config.rssWarningThreshold ||
        this.performanceMetrics.memoryLeaksDetected > 0) {
      return 'warning';
    }
    
    return 'healthy';
  }

  /**
   * Estimate memory usage for collections
   * @param {Map|Set} collection - Collection to analyze
   * @returns {number} Estimated memory in MB
   */
  estimateCollectionMemory(collection) {
    if (collection instanceof Map) {
      // Estimate: ~48 bytes per entry + key/value overhead
      return (collection.size * 64) / 1024 / 1024;
    } else if (collection instanceof Set) {
      // Estimate: ~32 bytes per entry + value overhead
      return (collection.size * 48) / 1024 / 1024;
    }
    return 0;
  }

  /**
   * Estimate memory usage for arrays
   * @param {Array} array - Array to analyze
   * @returns {number} Estimated memory in MB
   */
  estimateArrayMemory(array) {
    // Estimate: ~16 bytes per element + content overhead
    return (array.length * 32) / 1024 / 1024;
  }

  /**
   * Estimate memory usage for objects
   * @param {Object} obj - Object to analyze
   * @returns {number} Estimated memory in MB
   */
  estimateObjectMemory(obj) {
    try {
      // Rough estimate using JSON stringification
      const jsonSize = JSON.stringify(obj).length;
      return (jsonSize * 2) / 1024 / 1024; // Rough estimate with overhead
    } catch (error) {
      // Fallback for circular references
      return (Object.keys(obj).length * 16) / 1024 / 1024;
    }
  }

  /**
   * Setup process event listeners
   */
  setupProcessListeners() {
    // Warning on high memory usage
    process.on('warning', (warning) => {
      if (warning.name === 'MaxListenersExceededWarning' || 
          warning.name === 'DeprecationWarning') {
        this.logger.warn('Node.js process warning detected', {
          subsystem: 'monitoring',
          component: 'memory-monitor',
          warningName: warning.name,
          warningMessage: warning.message,
          operation: 'setupProcessListeners'
        });
      }
    });
    
    // Monitor uncaught exceptions for potential leaks
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception - potential memory leak source', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        operation: 'setupProcessListeners'
      }, error);
      
      // Take emergency snapshot
      this.takeMemorySnapshot();
    });
  }

  /**
   * Get current memory statistics
   * @returns {Object} Memory statistics
   */
  getStats() {
    return {
      monitoring: {
        initialized: this.initialized,
        uptime: this.initialized ? Math.round((Date.now() - this.performanceMetrics.startTime) / 1000) : 0,
        samplingInterval: this.config.samplingInterval,
        historySize: this.memoryHistory.length,
        componentCount: this.registeredComponents.size
      },
      
      performance: this.performanceMetrics,
      
      current: this.memoryHistory.length > 0 ? 
        this.memoryHistory[this.memoryHistory.length - 1] : null,
        
      health: this.assessMemoryHealth(),
      
      configuration: {
        heapWarningThreshold: this.config.heapWarningThreshold,
        heapCriticalThreshold: this.config.heapCriticalThreshold,
        rssWarningThreshold: this.config.rssWarningThreshold,
        rssCriticalThreshold: this.config.rssCriticalThreshold,
        enableAutoGC: this.config.enableAutoGC,
        enableLeakDetection: this.config.enableLeakDetection
      }
    };
  }

  /**
   * Clean up and shut down monitoring
   */
  async cleanup() {
    try {
      this.logger.info('Shutting down memory monitor', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        operation: 'cleanup'
      });

      // Clear intervals
      if (this.samplingTimer) clearInterval(this.samplingTimer);
      if (this.profileTimer) clearInterval(this.profileTimer);
      if (this.reportTimer) clearInterval(this.reportTimer);
      
      // Take final snapshot
      if (this.initialized) {
        this.takeMemorySnapshot();
      }
      
      // Generate final report
      const finalReport = this.getMemoryReport();
      this.logger.info('Final memory usage report', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        finalReport,
        operation: 'cleanup'
      });
      
      this.emit('shutdown', finalReport);

    } catch (error) {
      this.logger.error('Error during memory monitor cleanup', {
        subsystem: 'monitoring',
        component: 'memory-monitor',
        operation: 'cleanup'
      }, error);
    }
  }
}

// Global memory monitor instance
export let globalMemoryMonitor = null;

/**
 * Initialize global memory monitor
 * @param {Object} config - Monitor configuration
 * @returns {MemoryMonitor} Monitor instance
 */
export function initializeGlobalMemoryMonitor(config = {}) {
  if (!globalMemoryMonitor) {
    globalMemoryMonitor = new MemoryMonitor(config);
  }
  return globalMemoryMonitor;
}

/**
 * Get global memory monitor instance
 * @returns {MemoryMonitor|null} Monitor instance or null if not initialized
 */
export function getGlobalMemoryMonitor() {
  return globalMemoryMonitor;
}

export default MemoryMonitor;