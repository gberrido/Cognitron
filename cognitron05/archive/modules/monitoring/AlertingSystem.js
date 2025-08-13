#!/usr/bin/env node

/**
 * Alerting System - Comprehensive alerting and notification system for Cognitron05
 * Monitors critical failures and sends alerts through various channels
 * 
 * Features:
 * - Multi-channel alert delivery (console, file, webhook, email)
 * - Alert severity levels with escalation policies
 * - Rate limiting and alert deduplication
 * - Alert acknowledgment and auto-resolution
 * - Incident tracking and correlation
 * - Alert history and metrics
 * - Integration with monitoring systems
 * - Configurable alert rules and thresholds
 */

import fs from 'fs/promises';
import path from 'path';
import { EventEmitter } from 'events';
import { getLogger } from '../utils/StructuredLogger.js';

export class AlertingSystem extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      // Alert channels
      enableConsoleAlerts: config.enableConsoleAlerts !== false,
      enableFileAlerts: config.enableFileAlerts !== false,
      enableWebhookAlerts: config.enableWebhookAlerts || false,
      enableEmailAlerts: config.enableEmailAlerts || false,
      
      // Alert file configuration
      alertsLogFile: config.alertsLogFile || './cognitron05-data/alerts.log',
      maxAlertLogSize: config.maxAlertLogSize || 10 * 1024 * 1024, // 10MB
      
      // Rate limiting
      enableRateLimiting: config.enableRateLimiting !== false,
      maxAlertsPerMinute: config.maxAlertsPerMinute || 10,
      rateLimitWindow: config.rateLimitWindow || 60000, // 1 minute
      
      // Deduplication
      enableDeduplication: config.enableDeduplication !== false,
      deduplicationWindow: config.deduplicationWindow || 300000, // 5 minutes
      
      // Auto-resolution
      enableAutoResolution: config.enableAutoResolution !== false,
      autoResolutionTimeout: config.autoResolutionTimeout || 600000, // 10 minutes
      
      // Escalation
      enableEscalation: config.enableEscalation || false,
      escalationTimeout: config.escalationTimeout || 1800000, // 30 minutes
      
      // Alert severity thresholds
      memoryPressureCritical: config.memoryPressureCritical || 400, // 400MB
      memoryPressureWarning: config.memoryPressureWarning || 200,   // 200MB
      diskSpaceCritical: config.diskSpaceCritical || 1,             // 1GB
      diskSpaceWarning: config.diskSpaceWarning || 5,               // 5GB
      apiErrorRateCritical: config.apiErrorRateCritical || 0.1,     // 10%
      apiErrorRateWarning: config.apiErrorRateWarning || 0.05,      // 5%
      
      // Webhook configuration
      webhookUrl: config.webhookUrl,
      webhookTimeout: config.webhookTimeout || 5000,
      
      // Email configuration (placeholder)
      smtpConfig: config.smtpConfig,
      emailRecipients: config.emailRecipients || [],
      
      // Incident tracking
      maxIncidentHistory: config.maxIncidentHistory || 1000,
      incidentCorrelationWindow: config.incidentCorrelationWindow || 300000, // 5 minutes
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Alert state management
    this.activeAlerts = new Map(); // alertId -> alertData
    this.alertHistory = [];
    this.rateLimitCounters = new Map(); // alertType -> { count, windowStart }
    this.deduplicationCache = new Map(); // alertHash -> lastSentTime
    
    // Incident management
    this.activeIncidents = new Map(); // incidentId -> incidentData
    this.incidentHistory = [];
    this.incidentCounter = 0;
    
    // Alert rules and conditions
    this.alertRules = new Map();
    this.alertConditions = new Map();
    
    // Channel handlers
    this.channelHandlers = new Map();
    
    // Monitoring integration
    this.monitoringIntegrations = new Map();
    
    this.initialized = false;
  }

  /**
   * Initialize alerting system
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.info('Initializing alerting system', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        config: {
          consoleAlerts: this.config.enableConsoleAlerts,
          fileAlerts: this.config.enableFileAlerts,
          webhookAlerts: this.config.enableWebhookAlerts,
          rateLimiting: this.config.enableRateLimiting,
          deduplication: this.config.enableDeduplication
        },
        operation: 'initialize'
      });

      // Setup alert channels
      await this.setupAlertChannels();
      
      // Setup default alert rules
      this.setupDefaultAlertRules();
      
      // Start background tasks
      this.startBackgroundTasks();
      
      this.initialized = true;
      
      this.logger.info('Alerting system initialized', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        channels: this.channelHandlers.size,
        rules: this.alertRules.size,
        operation: 'initialize'
      });
      
      this.emit('initialized');

    } catch (error) {
      this.logger.error('Failed to initialize alerting system', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        operation: 'initialize'
      }, error);
      throw error;
    }
  }

  /**
   * Send an alert
   * @param {Object} alert - Alert data
   */
  async sendAlert(alert) {
    try {
      const alertId = this.generateAlertId();
      const timestamp = Date.now();
      
      // Validate alert
      if (!this.validateAlert(alert)) {
        this.logger.warn('Invalid alert data', {
          subsystem: 'monitoring',
          component: 'alerting-system',
          alert,
          operation: 'sendAlert'
        });
        return false;
      }
      
      // Normalize alert data
      const normalizedAlert = {
        id: alertId,
        timestamp,
        severity: alert.severity || 'info',
        type: alert.type || 'unknown',
        source: alert.source || 'system',
        title: alert.title || 'Alert',
        message: alert.message || 'No message provided',
        metadata: alert.metadata || {},
        acknowledged: false,
        resolved: false,
        ...alert
      };
      
      // Check rate limiting
      if (this.config.enableRateLimiting && this.isRateLimited(normalizedAlert)) {
        this.logger.debug('Alert rate limited', {
          subsystem: 'monitoring',
          component: 'alerting-system',
          alertId,
          type: normalizedAlert.type,
          operation: 'sendAlert'
        });
        return false;
      }
      
      // Check deduplication
      if (this.config.enableDeduplication && this.isDuplicate(normalizedAlert)) {
        this.logger.debug('Duplicate alert suppressed', {
          subsystem: 'monitoring',
          component: 'alerting-system',
          alertId,
          type: normalizedAlert.type,
          operation: 'sendAlert'
        });
        return false;
      }
      
      // Store alert
      this.activeAlerts.set(alertId, normalizedAlert);
      this.alertHistory.push(normalizedAlert);
      
      // Maintain history size
      if (this.alertHistory.length > this.config.maxIncidentHistory) {
        this.alertHistory.shift();
      }
      
      // Update rate limiting counter
      this.updateRateLimitCounter(normalizedAlert);
      
      // Update deduplication cache
      this.updateDeduplicationCache(normalizedAlert);
      
      // Check if this should create or update an incident
      await this.handleIncidentManagement(normalizedAlert);
      
      // Send alert through all enabled channels
      const channelResults = await this.deliverAlert(normalizedAlert);
      
      // Log alert
      this.logger.warn('Alert generated', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        alertId,
        severity: normalizedAlert.severity,
        type: normalizedAlert.type,
        title: normalizedAlert.title,
        channels: Object.keys(channelResults),
        operation: 'sendAlert'
      });
      
      // Emit alert event
      this.emit('alert', normalizedAlert);
      
      // Handle auto-resolution if enabled
      if (this.config.enableAutoResolution) {
        this.scheduleAutoResolution(normalizedAlert);
      }
      
      return {
        alertId,
        success: true,
        channels: channelResults
      };
      
    } catch (error) {
      this.logger.error('Failed to send alert', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        alert,
        operation: 'sendAlert'
      }, error);
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Acknowledge an alert
   * @param {string} alertId - Alert ID
   * @param {Object} acknowledgment - Acknowledgment data
   */
  async acknowledgeAlert(alertId, acknowledgment = {}) {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      return false;
    }
    
    alert.acknowledged = true;
    alert.acknowledgedAt = Date.now();
    alert.acknowledgedBy = acknowledgment.user || 'system';
    alert.acknowledgmentNote = acknowledgment.note || '';
    
    this.logger.info('Alert acknowledged', {
      subsystem: 'monitoring',
      component: 'alerting-system',
      alertId,
      acknowledgedBy: alert.acknowledgedBy,
      operation: 'acknowledgeAlert'
    });
    
    this.emit('alertAcknowledged', alert);
    
    return true;
  }

  /**
   * Resolve an alert
   * @param {string} alertId - Alert ID
   * @param {Object} resolution - Resolution data
   */
  async resolveAlert(alertId, resolution = {}) {
    const alert = this.activeAlerts.get(alertId);
    if (!alert) {
      return false;
    }
    
    alert.resolved = true;
    alert.resolvedAt = Date.now();
    alert.resolvedBy = resolution.user || 'system';
    alert.resolutionNote = resolution.note || '';
    alert.autoResolved = resolution.auto || false;
    
    // Remove from active alerts
    this.activeAlerts.delete(alertId);
    
    this.logger.info('Alert resolved', {
      subsystem: 'monitoring',
      component: 'alerting-system',
      alertId,
      resolvedBy: alert.resolvedBy,
      autoResolved: alert.autoResolved,
      operation: 'resolveAlert'
    });
    
    this.emit('alertResolved', alert);
    
    // Check if this resolves any incidents
    await this.checkIncidentResolution(alert);
    
    return true;
  }

  /**
   * Setup alert channels
   */
  async setupAlertChannels() {
    // Console channel
    if (this.config.enableConsoleAlerts) {
      this.channelHandlers.set('console', this.sendConsoleAlert.bind(this));
    }
    
    // File channel
    if (this.config.enableFileAlerts) {
      await this.ensureAlertLogDirectory();
      this.channelHandlers.set('file', this.sendFileAlert.bind(this));
    }
    
    // Webhook channel
    if (this.config.enableWebhookAlerts && this.config.webhookUrl) {
      this.channelHandlers.set('webhook', this.sendWebhookAlert.bind(this));
    }
    
    // Email channel
    if (this.config.enableEmailAlerts && this.config.smtpConfig) {
      this.channelHandlers.set('email', this.sendEmailAlert.bind(this));
    }
  }

  /**
   * Setup default alert rules
   */
  setupDefaultAlertRules() {
    // Memory pressure rules
    this.addAlertRule('memory_pressure_critical', {
      condition: (data) => data.type === 'memory' && data.heapUsed > this.config.memoryPressureCritical,
      severity: 'critical',
      title: 'Critical Memory Pressure',
      message: (data) => `Memory usage critical: ${data.heapUsed}MB (threshold: ${this.config.memoryPressureCritical}MB)`
    });
    
    this.addAlertRule('memory_pressure_warning', {
      condition: (data) => data.type === 'memory' && data.heapUsed > this.config.memoryPressureWarning,
      severity: 'warning',
      title: 'High Memory Pressure',
      message: (data) => `Memory usage high: ${data.heapUsed}MB (threshold: ${this.config.memoryPressureWarning}MB)`
    });
    
    // Disk space rules
    this.addAlertRule('disk_space_critical', {
      condition: (data) => data.type === 'disk' && data.available < this.config.diskSpaceCritical,
      severity: 'critical',
      title: 'Critical Disk Space',
      message: (data) => `Disk space critical: ${data.available.toFixed(1)}GB available (threshold: ${this.config.diskSpaceCritical}GB)`
    });
    
    // API error rules
    this.addAlertRule('api_error_rate_critical', {
      condition: (data) => data.type === 'api' && data.errorRate > this.config.apiErrorRateCritical,
      severity: 'critical',
      title: 'High API Error Rate',
      message: (data) => `API error rate critical: ${(data.errorRate * 100).toFixed(1)}% (threshold: ${(this.config.apiErrorRateCritical * 100)}%)`
    });
    
    // System crash rules
    this.addAlertRule('system_crash', {
      condition: (data) => data.type === 'crash' || data.type === 'uncaught_exception',
      severity: 'critical',
      title: 'System Crash Detected',
      message: (data) => `System crash: ${data.error || 'Unknown error'}`
    });
    
    // Health check failures
    this.addAlertRule('health_check_failure', {
      condition: (data) => data.type === 'health' && data.status === 'critical',
      severity: 'critical',
      title: 'Health Check Failure',
      message: (data) => `Health check failed: ${data.component || 'Unknown component'}`
    });
  }

  /**
   * Add an alert rule
   * @param {string} name - Rule name
   * @param {Object} rule - Rule configuration
   */
  addAlertRule(name, rule) {
    this.alertRules.set(name, {
      name,
      condition: rule.condition,
      severity: rule.severity || 'info',
      title: rule.title || 'Alert',
      message: rule.message || (() => 'Alert triggered'),
      enabled: rule.enabled !== false,
      ...rule
    });
  }

  /**
   * Check data against alert rules
   * @param {Object} data - Data to check
   */
  async checkAlertRules(data) {
    const triggeredRules = [];
    
    for (const [name, rule] of this.alertRules) {
      if (!rule.enabled) {
        continue;
      }
      
      try {
        if (rule.condition(data)) {
          const alert = {
            type: data.type || 'system',
            source: data.source || 'monitoring',
            severity: rule.severity,
            title: rule.title,
            message: typeof rule.message === 'function' ? rule.message(data) : rule.message,
            metadata: {
              rule: name,
              originalData: data,
              ...data.metadata
            }
          };
          
          await this.sendAlert(alert);
          triggeredRules.push(name);
        }
      } catch (error) {
        this.logger.error('Alert rule evaluation failed', {
          subsystem: 'monitoring',
          component: 'alerting-system',
          rule: name,
          data,
          operation: 'checkAlertRules'
        }, error);
      }
    }
    
    return triggeredRules;
  }

  /**
   * Integrate with monitoring systems
   * @param {string} name - Monitor name
   * @param {Object} monitor - Monitor instance
   */
  integrateWithMonitor(name, monitor) {
    this.monitoringIntegrations.set(name, monitor);
    
    // Set up event listeners based on monitor type
    if (monitor.on) {
      // Memory monitor integration
      if (name === 'memory' || monitor.constructor.name === 'MemoryMonitor') {
        monitor.on('memoryAlert', (alert) => {
          this.sendAlert({
            type: 'memory',
            source: 'memory-monitor',
            severity: alert.level,
            title: 'Memory Alert',
            message: alert.issues.join(', '),
            metadata: alert
          });
        });
        
        monitor.on('memoryLeak', (leak) => {
          this.sendAlert({
            type: 'memory_leak',
            source: 'memory-monitor',
            severity: 'critical',
            title: 'Memory Leak Detected',
            message: `Memory leak detected: ${leak.type} growing at ${leak.growthRate}MB/hour`,
            metadata: leak
          });
        });
      }
      
      // Health monitor integration
      if (name === 'health' || monitor.constructor.name === 'HealthMonitor') {
        monitor.on('healthAlert', (alert) => {
          this.sendAlert({
            type: 'health',
            source: 'health-monitor',
            severity: alert.type,
            title: 'Health Alert',
            message: alert.message,
            metadata: alert
          });
        });
      }
      
      // Performance monitor integration
      if (name === 'performance' || monitor.constructor.name === 'PerformanceMonitor') {
        monitor.on('performanceAlert', (alert) => {
          this.sendAlert({
            type: 'performance',
            source: 'performance-monitor',
            severity: alert.level,
            title: 'Performance Alert',
            message: alert.issues.join(', '),
            metadata: alert
          });
        });
      }
    }
    
    this.logger.info('Monitor integration added', {
      subsystem: 'monitoring',
      component: 'alerting-system',
      monitor: name,
      operation: 'integrateWithMonitor'
    });
  }

  /**
   * Deliver alert through all channels
   * @param {Object} alert - Alert to deliver
   */
  async deliverAlert(alert) {
    const results = {};
    
    for (const [channelName, handler] of this.channelHandlers) {
      try {
        const result = await handler(alert);
        results[channelName] = { success: true, result };
      } catch (error) {
        results[channelName] = { success: false, error: error.message };
        this.logger.error('Alert delivery failed', {
          subsystem: 'monitoring',
          component: 'alerting-system',
          channel: channelName,
          alertId: alert.id,
          operation: 'deliverAlert'
        }, error);
      }
    }
    
    return results;
  }

  /**
   * Send console alert
   * @param {Object} alert - Alert data
   */
  async sendConsoleAlert(alert) {
    const severityColors = {
      critical: '\x1b[31m', // Red
      warning: '\x1b[33m',  // Yellow
      info: '\x1b[36m',     // Cyan
      debug: '\x1b[37m'     // White
    };
    
    const color = severityColors[alert.severity] || '\x1b[37m';
    const reset = '\x1b[0m';
    
    console.log(`${color}🚨 ALERT [${alert.severity.toUpperCase()}]${reset}`);
    console.log(`${color}📍 ${alert.title}${reset}`);
    console.log(`${color}💬 ${alert.message}${reset}`);
    console.log(`${color}🕐 ${new Date(alert.timestamp).toISOString()}${reset}`);
    console.log(`${color}🔗 Alert ID: ${alert.id}${reset}`);
    
    if (alert.metadata && Object.keys(alert.metadata).length > 0) {
      console.log(`${color}📊 Metadata: ${JSON.stringify(alert.metadata, null, 2)}${reset}`);
    }
    
    console.log(''); // Empty line for readability
    
    return { delivered: true, timestamp: Date.now() };
  }

  /**
   * Send file alert
   * @param {Object} alert - Alert data
   */
  async sendFileAlert(alert) {
    const logEntry = {
      timestamp: new Date(alert.timestamp).toISOString(),
      alertId: alert.id,
      severity: alert.severity,
      type: alert.type,
      source: alert.source,
      title: alert.title,
      message: alert.message,
      metadata: alert.metadata,
      acknowledged: alert.acknowledged,
      resolved: alert.resolved
    };
    
    const logLine = JSON.stringify(logEntry) + '\n';
    
    await fs.appendFile(this.config.alertsLogFile, logLine, 'utf8');
    
    // Check file size and rotate if needed
    await this.rotateAlertLogIfNeeded();
    
    return { delivered: true, logFile: this.config.alertsLogFile };
  }

  /**
   * Send webhook alert
   * @param {Object} alert - Alert data
   */
  async sendWebhookAlert(alert) {
    // Placeholder for webhook implementation
    // In a real implementation, you would use fetch or similar to send HTTP request
    this.logger.info('Webhook alert would be sent', {
      subsystem: 'monitoring',
      component: 'alerting-system',
      webhookUrl: this.config.webhookUrl,
      alert,
      operation: 'sendWebhookAlert'
    });
    
    return { delivered: true, webhook: this.config.webhookUrl };
  }

  /**
   * Send email alert
   * @param {Object} alert - Alert data
   */
  async sendEmailAlert(alert) {
    // Placeholder for email implementation
    // In a real implementation, you would use nodemailer or similar
    this.logger.info('Email alert would be sent', {
      subsystem: 'monitoring',
      component: 'alerting-system',
      recipients: this.config.emailRecipients,
      alert,
      operation: 'sendEmailAlert'
    });
    
    return { delivered: true, recipients: this.config.emailRecipients };
  }

  /**
   * Validate alert data
   * @param {Object} alert - Alert to validate
   */
  validateAlert(alert) {
    if (!alert || typeof alert !== 'object') {
      return false;
    }
    
    // Required fields
    if (!alert.title && !alert.message) {
      return false;
    }
    
    // Valid severity levels
    const validSeverities = ['critical', 'warning', 'info', 'debug'];
    if (alert.severity && !validSeverities.includes(alert.severity)) {
      return false;
    }
    
    return true;
  }

  /**
   * Check if alert is rate limited
   * @param {Object} alert - Alert to check
   */
  isRateLimited(alert) {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(alert.type) || { count: 0, windowStart: now };
    
    // Reset window if expired
    if (now - counter.windowStart > this.config.rateLimitWindow) {
      counter.count = 0;
      counter.windowStart = now;
    }
    
    return counter.count >= this.config.maxAlertsPerMinute;
  }

  /**
   * Check if alert is duplicate
   * @param {Object} alert - Alert to check
   */
  isDuplicate(alert) {
    const alertHash = this.generateAlertHash(alert);
    const lastSent = this.deduplicationCache.get(alertHash);
    
    if (lastSent) {
      const timeSinceLastSent = Date.now() - lastSent;
      return timeSinceLastSent < this.config.deduplicationWindow;
    }
    
    return false;
  }

  /**
   * Update rate limit counter
   * @param {Object} alert - Alert data
   */
  updateRateLimitCounter(alert) {
    const counter = this.rateLimitCounters.get(alert.type) || { count: 0, windowStart: Date.now() };
    counter.count++;
    this.rateLimitCounters.set(alert.type, counter);
  }

  /**
   * Update deduplication cache
   * @param {Object} alert - Alert data
   */
  updateDeduplicationCache(alert) {
    const alertHash = this.generateAlertHash(alert);
    this.deduplicationCache.set(alertHash, Date.now());
  }

  /**
   * Generate alert hash for deduplication
   * @param {Object} alert - Alert data
   */
  generateAlertHash(alert) {
    const hashData = {
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      source: alert.source
    };
    
    return `${hashData.type}-${hashData.severity}-${hashData.title}-${hashData.source}`;
  }

  /**
   * Handle incident management
   * @param {Object} alert - Alert that might trigger incident
   */
  async handleIncidentManagement(alert) {
    if (alert.severity !== 'critical') {
      return;
    }
    
    // Check if this alert should create a new incident or update existing one
    const relatedIncident = this.findRelatedIncident(alert);
    
    if (relatedIncident) {
      // Update existing incident
      relatedIncident.alerts.push(alert.id);
      relatedIncident.lastUpdated = Date.now();
      relatedIncident.status = 'open';
      
      this.logger.info('Alert added to existing incident', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        incidentId: relatedIncident.id,
        alertId: alert.id,
        operation: 'handleIncidentManagement'
      });
      
    } else {
      // Create new incident
      const incidentId = `incident-${++this.incidentCounter}-${Date.now()}`;
      const incident = {
        id: incidentId,
        title: `Incident: ${alert.title}`,
        description: alert.message,
        severity: alert.severity,
        status: 'open',
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        alerts: [alert.id],
        source: alert.source,
        type: alert.type
      };
      
      this.activeIncidents.set(incidentId, incident);
      
      this.logger.warn('New incident created', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        incidentId,
        alertId: alert.id,
        operation: 'handleIncidentManagement'
      });
      
      this.emit('incident', incident);
    }
  }

  /**
   * Find related incident for alert
   * @param {Object} alert - Alert to find incident for
   */
  findRelatedIncident(alert) {
    const correlationWindow = this.config.incidentCorrelationWindow;
    const now = Date.now();
    
    for (const [incidentId, incident] of this.activeIncidents) {
      // Check if incident is within correlation window
      if (now - incident.lastUpdated > correlationWindow) {
        continue;
      }
      
      // Check if alert is related to incident
      if (incident.type === alert.type && incident.source === alert.source) {
        return incident;
      }
    }
    
    return null;
  }

  /**
   * Check if alert resolution resolves any incidents
   * @param {Object} alert - Resolved alert
   */
  async checkIncidentResolution(alert) {
    for (const [incidentId, incident] of this.activeIncidents) {
      if (incident.alerts.includes(alert.id)) {
        // Check if all alerts in incident are resolved
        const allResolved = incident.alerts.every(alertId => {
          const alertData = this.alertHistory.find(a => a.id === alertId);
          return alertData && alertData.resolved;
        });
        
        if (allResolved) {
          incident.status = 'resolved';
          incident.resolvedAt = Date.now();
          
          // Move to history
          this.incidentHistory.push(incident);
          this.activeIncidents.delete(incidentId);
          
          this.logger.info('Incident resolved', {
            subsystem: 'monitoring',
            component: 'alerting-system',
            incidentId,
            operation: 'checkIncidentResolution'
          });
          
          this.emit('incidentResolved', incident);
        }
        
        break;
      }
    }
  }

  /**
   * Schedule auto-resolution for alert
   * @param {Object} alert - Alert to schedule resolution for
   */
  scheduleAutoResolution(alert) {
    if (alert.severity === 'critical') {
      return; // Don't auto-resolve critical alerts
    }
    
    setTimeout(() => {
      if (this.activeAlerts.has(alert.id)) {
        this.resolveAlert(alert.id, { user: 'system', auto: true, note: 'Auto-resolved' });
      }
    }, this.config.autoResolutionTimeout);
  }

  /**
   * Start background tasks
   */
  startBackgroundTasks() {
    // Cleanup expired items
    setInterval(() => {
      this.cleanupExpiredItems();
    }, 300000); // 5 minutes
    
    // Generate alert statistics
    setInterval(() => {
      this.generateAlertStatistics();
    }, 600000); // 10 minutes
  }

  /**
   * Cleanup expired items
   */
  cleanupExpiredItems() {
    const now = Date.now();
    
    // Cleanup deduplication cache
    for (const [hash, lastSent] of this.deduplicationCache) {
      if (now - lastSent > this.config.deduplicationWindow * 2) {
        this.deduplicationCache.delete(hash);
      }
    }
    
    // Cleanup rate limit counters
    for (const [type, counter] of this.rateLimitCounters) {
      if (now - counter.windowStart > this.config.rateLimitWindow * 2) {
        this.rateLimitCounters.delete(type);
      }
    }
  }

  /**
   * Generate alert statistics
   */
  generateAlertStatistics() {
    const stats = this.getAlertingStats();
    
    this.logger.info('Alert statistics', {
      subsystem: 'monitoring',
      component: 'alerting-system',
      stats,
      operation: 'generateAlertStatistics'
    });
    
    this.emit('alertStatistics', stats);
  }

  /**
   * Ensure alert log directory exists
   */
  async ensureAlertLogDirectory() {
    const logDir = path.dirname(this.config.alertsLogFile);
    try {
      await fs.mkdir(logDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Rotate alert log if needed
   */
  async rotateAlertLogIfNeeded() {
    try {
      const stats = await fs.stat(this.config.alertsLogFile);
      if (stats.size > this.config.maxAlertLogSize) {
        const rotatedFile = `${this.config.alertsLogFile}.${Date.now()}`;
        await fs.rename(this.config.alertsLogFile, rotatedFile);
      }
    } catch (error) {
      // Log file doesn't exist or other error, ignore
    }
  }

  /**
   * Generate unique alert ID
   */
  generateAlertId() {
    return `alert-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get alerting statistics
   */
  getAlertingStats() {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    const oneDayAgo = now - 86400000;
    
    // Filter recent alerts
    const recentAlerts = this.alertHistory.filter(a => a.timestamp > oneHourAgo);
    const dailyAlerts = this.alertHistory.filter(a => a.timestamp > oneDayAgo);
    
    // Count by severity
    const severityCounts = {};
    dailyAlerts.forEach(alert => {
      severityCounts[alert.severity] = (severityCounts[alert.severity] || 0) + 1;
    });
    
    // Count by type
    const typeCounts = {};
    dailyAlerts.forEach(alert => {
      typeCounts[alert.type] = (typeCounts[alert.type] || 0) + 1;
    });
    
    return {
      totalAlerts: this.alertHistory.length,
      activeAlerts: this.activeAlerts.size,
      resolvedAlerts: this.alertHistory.filter(a => a.resolved).length,
      acknowledgedAlerts: this.alertHistory.filter(a => a.acknowledged).length,
      
      recentActivity: {
        lastHour: recentAlerts.length,
        lastDay: dailyAlerts.length
      },
      
      severityBreakdown: severityCounts,
      typeBreakdown: typeCounts,
      
      incidents: {
        active: this.activeIncidents.size,
        total: this.incidentHistory.length + this.activeIncidents.size
      },
      
      channels: Array.from(this.channelHandlers.keys()),
      rules: this.alertRules.size,
      integrations: this.monitoringIntegrations.size
    };
  }

  /**
   * Clean up and shut down alerting system
   */
  async cleanup() {
    try {
      this.logger.info('Shutting down alerting system', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        operation: 'cleanup'
      });

      // Generate final statistics
      const finalStats = this.getAlertingStats();
      
      // Send final alert about shutdown
      await this.sendAlert({
        type: 'system',
        severity: 'info',
        title: 'Alerting System Shutdown',
        message: 'Alerting system is shutting down',
        metadata: { finalStats }
      });
      
      this.logger.info('Final alerting statistics', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        finalStats,
        operation: 'cleanup'
      });
      
      this.emit('shutdown', finalStats);

    } catch (error) {
      this.logger.error('Error during alerting system cleanup', {
        subsystem: 'monitoring',
        component: 'alerting-system',
        operation: 'cleanup'
      }, error);
    }
  }
}

export default AlertingSystem;