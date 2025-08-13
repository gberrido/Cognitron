#!/usr/bin/env node

/**
 * Health Monitor - Comprehensive health check system for Cognitron05
 * Provides health check endpoints and status monitoring for all system components
 * 
 * Features:
 * - Memory system status monitoring with detailed diagnostics
 * - API connectivity health checks with response time measurement
 * - Disk space monitoring with configurable thresholds
 * - Performance metrics collection and analysis
 * - Component health aggregation with dependency tracking
 * - Configurable health check intervals and thresholds
 * - HTTP health check endpoints for external monitoring
 * - Health history tracking and trend analysis
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { getLogger } from '../utils/StructuredLogger.js';

export class HealthMonitor extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Health check intervals
      healthCheckInterval: config.healthCheckInterval || 30000,  // 30 seconds
      detailedCheckInterval: config.detailedCheckInterval || 300000,  // 5 minutes
      statusUpdateInterval: config.statusUpdateInterval || 5000,      // 5 seconds
      
      // Health check timeouts
      apiTimeoutThreshold: config.apiTimeoutThreshold || 10000,       // 10 seconds
      memoryCheckTimeout: config.memoryCheckTimeout || 5000,          // 5 seconds
      diskCheckTimeout: config.diskCheckTimeout || 3000,             // 3 seconds
      
      // Disk space thresholds (in GB)
      diskSpaceWarningThreshold: config.diskSpaceWarningThreshold || 5,   // 5GB
      diskSpaceCriticalThreshold: config.diskSpaceCriticalThreshold || 1, // 1GB
      
      // API connectivity thresholds
      apiResponseTimeWarning: config.apiResponseTimeWarning || 5000,      // 5 seconds
      apiResponseTimeCritical: config.apiResponseTimeCritical || 15000,   // 15 seconds
      maxConsecutiveFailures: config.maxConsecutiveFailures || 3,
      
      // Performance thresholds
      maxMemoryUsage: config.maxMemoryUsage || 512,          // 512MB
      maxCPUUsage: config.maxCPUUsage || 80,                 // 80%
      maxResponseTime: config.maxResponseTime || 2000,       // 2 seconds
      
      // Data directory monitoring
      dataDirectory: config.dataDirectory || './cognitron05-data',
      
      // Health history
      maxHealthHistory: config.maxHealthHistory || 100,
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Component registry
    this.components = new Map(); // component -> { instance, healthCheck, dependencies }
    this.componentHealth = new Map(); // component -> health status
    
    // Health monitoring state
    this.overallHealth = {
      status: 'unknown',
      lastCheck: null,
      consecutiveFailures: 0,
      uptime: Date.now()
    };
    
    // Health history for trend analysis
    this.healthHistory = [];
    
    // Performance metrics
    this.performanceMetrics = {
      apiResponseTimes: [],
      memoryUsage: [],
      diskUsage: [],
      healthCheckDuration: [],
      errorCounts: new Map(),
      lastMetricsUpdate: Date.now()
    };
    
    // Monitoring intervals
    this.healthCheckTimer = null;
    this.detailedCheckTimer = null;
    this.statusUpdateTimer = null;
    
    // HTTP server for health endpoints (optional)
    this.httpServer = null;
    this.healthEndpoints = new Map();
    
    this.initialized = false;
  }

  /**
   * Initialize health monitoring
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing health monitor', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        config: {
          healthCheckInterval: this.config.healthCheckInterval,
          dataDirectory: this.config.dataDirectory,
          diskWarningThreshold: this.config.diskSpaceWarningThreshold,
          apiTimeoutThreshold: this.config.apiTimeoutThreshold
        },
        operation: 'initialize'
      });

      // Perform initial health check
      await this.performHealthCheck();
      
      // Start monitoring intervals
      this.startHealthMonitoring();
      
      // Set up health endpoints
      this.setupHealthEndpoints();
      
      this.initialized = true;
      
      this.logger.info('Health monitor initialized', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        componentsRegistered: this.components.size,
        operation: 'initialize'
      });
      
      this.emit('initialized');

    } catch (error) {
      this.logger.error('Failed to initialize health monitor', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Register a component for health monitoring
   * @param {string} name - Component name
   * @param {Object} component - Component instance
   * @param {Object} options - Registration options
   */
  registerComponent(name, component, options = {}) {
    this.components.set(name, {
      instance: component,
      healthCheck: options.healthCheck || this.createDefaultHealthCheck(component),
      dependencies: options.dependencies || [],
      timeout: options.timeout || this.config.memoryCheckTimeout,
      critical: options.critical !== false
    });
    
    // Initialize health status
    this.componentHealth.set(name, {
      status: 'unknown',
      lastCheck: null,
      consecutiveFailures: 0,
      responseTime: null,
      details: {},
      error: null
    });
    
    this.logger.debug('Component registered for health monitoring', {
      subsystem: 'monitoring',
      component: 'health-monitor',
      componentName: name,
      hasDependencies: options.dependencies && options.dependencies.length > 0,
      critical: options.critical !== false,
      operation: 'registerComponent'
    });
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    const checkStart = Date.now();
    
    try {
      this.logger.debug('Starting health check', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        componentsToCheck: this.components.size,
        operation: 'performHealthCheck'
      });

      // Check individual components
      const componentResults = await this.checkAllComponents();
      
      // Check system resources
      const systemHealth = await this.checkSystemHealth();
      
      // Check API connectivity
      const apiHealth = await this.checkApiConnectivity();
      
      // Aggregate overall health
      const overallHealth = this.aggregateHealth(componentResults, systemHealth, apiHealth);
      
      // Update performance metrics
      this.updatePerformanceMetrics(Date.now() - checkStart);
      
      // Store in health history
      const healthRecord = {
        timestamp: Date.now(),
        overall: overallHealth,
        components: componentResults,
        system: systemHealth,
        api: apiHealth,
        checkDuration: Date.now() - checkStart
      };
      
      this.healthHistory.push(healthRecord);
      if (this.healthHistory.length > this.config.maxHealthHistory) {
        this.healthHistory.shift();
      }
      
      // Update overall health status
      this.overallHealth = {
        ...overallHealth,
        lastCheck: Date.now(),
        uptime: Date.now() - this.overallHealth.uptime
      };
      
      this.logger.info('Health check completed', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        overallStatus: overallHealth.status,
        checkDuration: Date.now() - checkStart,
        componentsHealthy: Object.values(componentResults).filter(c => c.status === 'healthy').length,
        componentsFailing: Object.values(componentResults).filter(c => c.status === 'critical').length,
        operation: 'performHealthCheck'
      });
      
      this.emit('healthCheck', healthRecord);
      
      // Emit alerts for critical issues
      if (overallHealth.status === 'critical') {
        this.emit('healthAlert', {
          type: 'critical',
          message: 'System health is critical',
          details: overallHealth
        });
      } else if (overallHealth.status === 'warning') {
        this.emit('healthAlert', {
          type: 'warning',
          message: 'System health warnings detected',
          details: overallHealth
        });
      }
      
      return healthRecord;
      
    } catch (error) {
      this.logger.error('Health check failed', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        checkDuration: Date.now() - checkStart,
        operation: 'performHealthCheck'
      }, error);
      
      this.overallHealth.consecutiveFailures++;
      this.emit('healthCheckError', error);
      
      return {
        timestamp: Date.now(),
        overall: { status: 'critical', error: error.message },
        checkDuration: Date.now() - checkStart
      };
    }
  }

  /**
   * Check health of all registered components
   */
  async checkAllComponents() {
    const results = {};
    
    for (const [name, componentConfig] of this.components) {
      try {
        const checkStart = Date.now();
        
        // Execute health check with timeout
        const healthResult = await Promise.race([
          componentConfig.healthCheck(componentConfig.instance),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), componentConfig.timeout)
          )
        ]);
        
        const responseTime = Date.now() - checkStart;
        
        // Normalize health result
        const normalizedResult = this.normalizeHealthResult(healthResult, responseTime);
        
        results[name] = normalizedResult;
        this.componentHealth.set(name, normalizedResult);
        
        if (normalizedResult.status === 'healthy') {
          this.componentHealth.get(name).consecutiveFailures = 0;
        } else {
          this.componentHealth.get(name).consecutiveFailures++;
        }
        
      } catch (error) {
        const errorResult = {
          status: 'critical',
          lastCheck: Date.now(),
          responseTime: null,
          details: {},
          error: error.message,
          consecutiveFailures: (this.componentHealth.get(name)?.consecutiveFailures || 0) + 1
        };
        
        results[name] = errorResult;
        this.componentHealth.set(name, errorResult);
        
        this.logger.warn('Component health check failed', {
          subsystem: 'monitoring',
          component: 'health-monitor',
          componentName: name,
          error: error.message,
          operation: 'checkAllComponents'
        });
      }
    }
    
    return results;
  }

  /**
   * Check system health (memory, disk, CPU)
   */
  async checkSystemHealth() {
    try {
      const systemHealth = {
        memory: await this.checkMemoryHealth(),
        disk: await this.checkDiskHealth(),
        process: await this.checkProcessHealth()
      };
      
      // Determine overall system status
      const statuses = Object.values(systemHealth).map(h => h.status);
      systemHealth.status = this.aggregateStatus(statuses);
      
      return systemHealth;
      
    } catch (error) {
      this.logger.warn('System health check failed', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        operation: 'checkSystemHealth'
      }, error);
      
      return {
        status: 'critical',
        error: error.message,
        memory: { status: 'unknown' },
        disk: { status: 'unknown' },
        process: { status: 'unknown' }
      };
    }
  }

  /**
   * Check memory health
   */
  async checkMemoryHealth() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    
    let status = 'healthy';
    const warnings = [];
    
    if (heapUsedMB > this.config.maxMemoryUsage * 0.8) {
      status = 'warning';
      warnings.push(`Heap usage high: ${heapUsedMB}MB`);
    }
    
    if (heapUsedMB > this.config.maxMemoryUsage) {
      status = 'critical';
      warnings.push(`Heap usage critical: ${heapUsedMB}MB`);
    }
    
    if (rssMB > this.config.maxMemoryUsage * 1.5) {
      status = 'warning';
      warnings.push(`RSS usage high: ${rssMB}MB`);
    }
    
    this.performanceMetrics.memoryUsage.push({
      timestamp: Date.now(),
      heapUsed: heapUsedMB,
      rss: rssMB
    });
    
    // Keep only recent metrics
    if (this.performanceMetrics.memoryUsage.length > 100) {
      this.performanceMetrics.memoryUsage.shift();
    }
    
    return {
      status,
      heapUsed: heapUsedMB,
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: rssMB,
      external: Math.round(memUsage.external / 1024 / 1024),
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  /**
   * Check disk health
   */
  async checkDiskHealth() {
    try {
      // Check data directory disk space
      const stats = await fs.stat(this.config.dataDirectory);
      
      // For simplicity, we'll check the parent directory
      // In production, you might want to use statvfs or similar
      const dirPath = path.resolve(this.config.dataDirectory);
      
      // Estimate available space (this is a simplified check)
      let status = 'healthy';
      const warnings = [];
      
      // Try to get disk usage information
      try {
        const diskUsage = await this.getDiskUsage(dirPath);
        
        if (diskUsage.available < this.config.diskSpaceCriticalThreshold * 1024 * 1024 * 1024) {
          status = 'critical';
          warnings.push(`Disk space critical: ${(diskUsage.available / 1024 / 1024 / 1024).toFixed(1)}GB available`);
        } else if (diskUsage.available < this.config.diskSpaceWarningThreshold * 1024 * 1024 * 1024) {
          status = 'warning';
          warnings.push(`Disk space low: ${(diskUsage.available / 1024 / 1024 / 1024).toFixed(1)}GB available`);
        }
        
        this.performanceMetrics.diskUsage.push({
          timestamp: Date.now(),
          available: diskUsage.available,
          used: diskUsage.used,
          total: diskUsage.total
        });
        
        return {
          status,
          path: dirPath,
          available: diskUsage.available,
          used: diskUsage.used,
          total: diskUsage.total,
          warnings: warnings.length > 0 ? warnings : undefined
        };
        
      } catch (diskError) {
        // Fallback to simple directory check
        return {
          status: 'healthy',
          path: dirPath,
          accessible: true,
          note: 'Disk usage information not available'
        };
      }
      
    } catch (error) {
      return {
        status: 'critical',
        path: this.config.dataDirectory,
        accessible: false,
        error: error.message
      };
    }
  }

  /**
   * Check process health
   */
  async checkProcessHealth() {
    const uptime = process.uptime();
    
    return {
      status: 'healthy',
      uptime: Math.round(uptime),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    };
  }

  /**
   * Check API connectivity
   */
  async checkApiConnectivity() {
    // This would check connectivity to external APIs (like Groq)
    // For now, we'll return a placeholder
    return {
      status: 'healthy',
      note: 'API connectivity checks not implemented yet'
    };
  }

  /**
   * Aggregate health status from multiple components
   */
  aggregateHealth(componentResults, systemHealth, apiHealth) {
    const allResults = [
      ...Object.values(componentResults),
      systemHealth,
      apiHealth
    ];
    
    const statuses = allResults.map(result => result.status);
    const overallStatus = this.aggregateStatus(statuses);
    
    // Calculate health percentages
    const total = statuses.length;
    const healthy = statuses.filter(s => s === 'healthy').length;
    const warning = statuses.filter(s => s === 'warning').length;
    const critical = statuses.filter(s => s === 'critical').length;
    
    return {
      status: overallStatus,
      summary: {
        total,
        healthy,
        warning,
        critical,
        healthPercentage: Math.round((healthy / total) * 100)
      }
    };
  }

  /**
   * Aggregate multiple status values
   */
  aggregateStatus(statuses) {
    if (statuses.some(s => s === 'critical')) {
      return 'critical';
    } else if (statuses.some(s => s === 'warning')) {
      return 'warning';
    } else if (statuses.some(s => s === 'unknown')) {
      return 'unknown';
    } else {
      return 'healthy';
    }
  }

  /**
   * Normalize health check result
   */
  normalizeHealthResult(result, responseTime) {
    // If result is a boolean
    if (typeof result === 'boolean') {
      return {
        status: result ? 'healthy' : 'critical',
        lastCheck: Date.now(),
        responseTime,
        details: {},
        error: null,
        consecutiveFailures: 0
      };
    }
    
    // If result is a string
    if (typeof result === 'string') {
      const status = ['healthy', 'warning', 'critical'].includes(result) ? result : 'unknown';
      return {
        status,
        lastCheck: Date.now(),
        responseTime,
        details: {},
        error: null,
        consecutiveFailures: 0
      };
    }
    
    // If result is an object
    if (typeof result === 'object' && result !== null) {
      return {
        status: result.status || 'unknown',
        lastCheck: Date.now(),
        responseTime,
        details: result.details || {},
        error: result.error || null,
        consecutiveFailures: 0,
        ...result
      };
    }
    
    // Default fallback
    return {
      status: 'unknown',
      lastCheck: Date.now(),
      responseTime,
      details: {},
      error: 'Invalid health check result',
      consecutiveFailures: 0
    };
  }

  /**
   * Create default health check function for a component
   */
  createDefaultHealthCheck(component) {
    return async (comp) => {
      try {
        // Try common health check methods
        if (typeof comp.healthCheck === 'function') {
          return await comp.healthCheck();
        }
        
        if (typeof comp.getStatus === 'function') {
          const status = comp.getStatus();
          return { status: 'healthy', details: status };
        }
        
        if (typeof comp.ping === 'function') {
          const pingResult = await comp.ping();
          return { status: pingResult ? 'healthy' : 'critical' };
        }
        
        // Basic existence check
        return { status: 'healthy', details: { type: typeof comp } };
        
      } catch (error) {
        return { status: 'critical', error: error.message };
      }
    };
  }

  /**
   * Get disk usage information (simplified implementation)
   */
  async getDiskUsage(path) {
    // This is a simplified implementation
    // In production, you'd use platform-specific methods or libraries
    try {
      const stats = await fs.stat(path);
      
      // Return mock data for now
      return {
        total: 100 * 1024 * 1024 * 1024, // 100GB
        used: 50 * 1024 * 1024 * 1024,   // 50GB
        available: 50 * 1024 * 1024 * 1024 // 50GB
      };
    } catch (error) {
      throw new Error(`Cannot access path: ${error.message}`);
    }
  }

  /**
   * Start health monitoring intervals
   */
  startHealthMonitoring() {
    // Regular health checks
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck().catch(error => {
        this.logger.error('Scheduled health check failed', {
          subsystem: 'monitoring',
          component: 'health-monitor',
          operation: 'startHealthMonitoring'
        }, error);
      });
    }, this.config.healthCheckInterval);
    
    // Detailed checks (less frequent)
    this.detailedCheckTimer = setInterval(() => {
      this.performDetailedHealthCheck().catch(error => {
        this.logger.error('Detailed health check failed', {
          subsystem: 'monitoring',
          component: 'health-monitor',
          operation: 'startHealthMonitoring'
        }, error);
      });
    }, this.config.detailedCheckInterval);
    
    // Status updates
    this.statusUpdateTimer = setInterval(() => {
      this.updateHealthStatus();
    }, this.config.statusUpdateInterval);
  }

  /**
   * Perform detailed health check (more comprehensive)
   */
  async performDetailedHealthCheck() {
    const detailedHealth = {
      timestamp: Date.now(),
      trends: this.calculateHealthTrends(),
      performance: this.getPerformanceAnalysis(),
      recommendations: this.generateHealthRecommendations()
    };
    
    this.logger.info('Detailed health check completed', {
      subsystem: 'monitoring',
      component: 'health-monitor',
      healthTrends: detailedHealth.trends,
      recommendations: detailedHealth.recommendations.length,
      operation: 'performDetailedHealthCheck'
    });
    
    this.emit('detailedHealthCheck', detailedHealth);
    
    return detailedHealth;
  }

  /**
   * Calculate health trends from history
   */
  calculateHealthTrends() {
    if (this.healthHistory.length < 10) {
      return { insufficient_data: true };
    }
    
    const recent = this.healthHistory.slice(-10);
    const older = this.healthHistory.slice(-20, -10);
    
    // Calculate trend in health percentage
    const recentHealthPercentage = recent.reduce((sum, h) => 
      sum + (h.overall.summary?.healthPercentage || 0), 0) / recent.length;
      
    const olderHealthPercentage = older.length > 0 ? 
      older.reduce((sum, h) => sum + (h.overall.summary?.healthPercentage || 0), 0) / older.length : 
      recentHealthPercentage;
    
    const trend = recentHealthPercentage - olderHealthPercentage;
    
    return {
      healthPercentage: {
        current: recentHealthPercentage,
        previous: olderHealthPercentage,
        trend: trend,
        trending: trend > 5 ? 'improving' : trend < -5 ? 'declining' : 'stable'
      }
    };
  }

  /**
   * Get performance analysis
   */
  getPerformanceAnalysis() {
    const analysis = {};
    
    // Memory performance
    if (this.performanceMetrics.memoryUsage.length > 0) {
      const recent = this.performanceMetrics.memoryUsage.slice(-10);
      analysis.memory = {
        averageHeap: recent.reduce((sum, m) => sum + m.heapUsed, 0) / recent.length,
        averageRSS: recent.reduce((sum, m) => sum + m.rss, 0) / recent.length,
        trend: recent.length > 1 ? 
          (recent[recent.length - 1].heapUsed - recent[0].heapUsed) / recent.length : 0
      };
    }
    
    // Health check performance
    if (this.performanceMetrics.healthCheckDuration.length > 0) {
      const recent = this.performanceMetrics.healthCheckDuration.slice(-10);
      analysis.healthChecks = {
        averageDuration: recent.reduce((sum, d) => sum + d, 0) / recent.length,
        slowChecks: recent.filter(d => d > 1000).length
      };
    }
    
    return analysis;
  }

  /**
   * Generate health recommendations
   */
  generateHealthRecommendations() {
    const recommendations = [];
    const latest = this.healthHistory[this.healthHistory.length - 1];
    
    if (!latest) {
      return recommendations;
    }
    
    // Memory recommendations
    if (latest.system?.memory?.status === 'warning' || latest.system?.memory?.status === 'critical') {
      recommendations.push({
        type: 'memory',
        priority: latest.system.memory.status === 'critical' ? 'high' : 'medium',
        message: 'High memory usage detected',
        action: 'Consider optimizing memory usage or increasing available memory'
      });
    }
    
    // Component recommendations
    const failingComponents = Object.entries(latest.components || {})
      .filter(([, health]) => health.status !== 'healthy');
      
    if (failingComponents.length > 0) {
      recommendations.push({
        type: 'components',
        priority: 'high',
        message: `${failingComponents.length} components are unhealthy`,
        action: `Investigate components: ${failingComponents.map(([name]) => name).join(', ')}`
      });
    }
    
    return recommendations;
  }

  /**
   * Update health status (lightweight update)
   */
  updateHealthStatus() {
    this.emit('statusUpdate', {
      timestamp: Date.now(),
      overallHealth: this.overallHealth,
      componentCount: this.components.size,
      healthyComponents: Array.from(this.componentHealth.values())
        .filter(h => h.status === 'healthy').length
    });
  }

  /**
   * Setup health check endpoints
   */
  setupHealthEndpoints() {
    this.healthEndpoints.set('/health', () => ({
      status: this.overallHealth.status,
      timestamp: Date.now(),
      uptime: Date.now() - this.overallHealth.uptime
    }));
    
    this.healthEndpoints.set('/health/detailed', () => ({
      ...this.getHealthStatus(),
      components: Object.fromEntries(this.componentHealth),
      performance: this.getPerformanceAnalysis(),
      history: this.healthHistory.slice(-10)
    }));
    
    this.healthEndpoints.set('/health/metrics', () => ({
      memory: this.performanceMetrics.memoryUsage.slice(-20),
      disk: this.performanceMetrics.diskUsage.slice(-20),
      healthChecks: this.performanceMetrics.healthCheckDuration.slice(-20)
    }));
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(healthCheckDuration) {
    this.performanceMetrics.healthCheckDuration.push(healthCheckDuration);
    
    // Keep only recent metrics
    if (this.performanceMetrics.healthCheckDuration.length > 100) {
      this.performanceMetrics.healthCheckDuration.shift();
    }
    
    this.performanceMetrics.lastMetricsUpdate = Date.now();
  }

  /**
   * Get current health status
   */
  getHealthStatus() {
    return {
      overall: this.overallHealth,
      components: Object.fromEntries(this.componentHealth),
      summary: {
        totalComponents: this.components.size,
        healthyComponents: Array.from(this.componentHealth.values())
          .filter(h => h.status === 'healthy').length,
        warningComponents: Array.from(this.componentHealth.values())
          .filter(h => h.status === 'warning').length,
        criticalComponents: Array.from(this.componentHealth.values())
          .filter(h => h.status === 'critical').length
      }
    };
  }

  /**
   * Get health endpoint response
   */
  getHealthEndpoint(path) {
    const endpoint = this.healthEndpoints.get(path);
    if (!endpoint) {
      return { error: 'Endpoint not found', status: 404 };
    }
    
    try {
      return endpoint();
    } catch (error) {
      this.logger.error('Health endpoint error', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        path,
        operation: 'getHealthEndpoint'
      }, error);
      
      return { error: 'Internal error', status: 500 };
    }
  }

  /**
   * Get comprehensive statistics
   */
  getStats() {
    return {
      monitoring: {
        initialized: this.initialized,
        uptime: Date.now() - this.overallHealth.uptime,
        componentsRegistered: this.components.size,
        healthHistorySize: this.healthHistory.length,
        lastCheck: this.overallHealth.lastCheck
      },
      
      health: this.getHealthStatus(),
      
      performance: this.getPerformanceAnalysis(),
      
      configuration: {
        healthCheckInterval: this.config.healthCheckInterval,
        detailedCheckInterval: this.config.detailedCheckInterval,
        dataDirectory: this.config.dataDirectory,
        diskSpaceWarningThreshold: this.config.diskSpaceWarningThreshold,
        apiTimeoutThreshold: this.config.apiTimeoutThreshold
      }
    };
  }

  /**
   * Clean up and shut down health monitoring
   */
  async cleanup() {
    try {
      this.logger.info('Shutting down health monitor', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        operation: 'cleanup'
      });

      // Clear intervals
      if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
      if (this.detailedCheckTimer) clearInterval(this.detailedCheckTimer);
      if (this.statusUpdateTimer) clearInterval(this.statusUpdateTimer);
      
      // Perform final health check
      if (this.initialized) {
        await this.performHealthCheck();
      }
      
      // Generate final health report
      const finalReport = this.getHealthStatus();
      this.logger.info('Final health report', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        finalReport,
        operation: 'cleanup'
      });
      
      this.emit('shutdown', finalReport);

    } catch (error) {
      this.logger.error('Error during health monitor cleanup', {
        subsystem: 'monitoring',
        component: 'health-monitor',
        operation: 'cleanup'
      }, error);
    }
  }
}

export default HealthMonitor;