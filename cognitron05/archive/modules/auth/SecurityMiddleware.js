#!/usr/bin/env node

/**
 * Security Middleware - Unified authentication and authorization middleware
 * 
 * Features:
 * - Request authentication validation
 * - Authorization checks for operations
 * - Security context management
 * - Request sanitization and validation
 * - Security headers and CORS handling
 * - Rate limiting and DDoS protection
 * - Security event logging
 * - Session management integration
 */

import { AuthenticationManager } from './AuthenticationManager.js';
import { AuthorizationManager } from './AuthorizationManager.js';
import { getLogger } from '../utils/StructuredLogger.js';

export class SecurityMiddleware {
  constructor(config = {}) {
    this.config = {
      // Authentication settings
      requireAuth: config.requireAuth !== false,
      allowAnonymous: config.allowAnonymous || false,
      anonymousRole: config.anonymousRole || 'guest',
      
      // Session settings
      sessionHeader: config.sessionHeader || 'Authorization',
      sessionPrefix: config.sessionPrefix || 'Bearer ',
      
      // Security headers
      enableSecurityHeaders: config.enableSecurityHeaders !== false,
      corsEnabled: config.corsEnabled || false,
      allowedOrigins: config.allowedOrigins || ['http://localhost:3000'],
      
      // Rate limiting
      globalRateLimit: config.globalRateLimit || {
        requests: 1000,
        window: 60 * 1000 // 1 minute
      },
      
      // Input validation
      maxRequestSize: config.maxRequestSize || 10 * 1024 * 1024, // 10MB
      sanitizeInput: config.sanitizeInput !== false,
      
      // Paths that don't require authentication
      publicPaths: config.publicPaths || [
        '/health',
        '/auth/login',
        '/auth/register',
        '/auth/refresh'
      ],
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Initialize managers
    this.authManager = new AuthenticationManager(config.auth || {});
    this.authzManager = new AuthorizationManager(config.authorization || {});
    
    // Rate limiting storage
    this.rateLimitData = new Map(); // ip -> { requests: [], windowStart }
    
    // Security statistics
    this.stats = {
      totalRequests: 0,
      authenticatedRequests: 0,
      anonymousRequests: 0,
      blockedRequests: 0,
      authenticationFailures: 0,
      authorizationFailures: 0,
      securityViolations: 0,
      rateLimitViolations: 0,
      lastReset: Date.now()
    };
    
    // Security context cache
    this.contextCache = new Map(); // token -> { user, permissions, timestamp }
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Initialize security middleware
   */
  async initialize() {
    try {
      this.logger.info('Initializing security middleware', {
        subsystem: 'auth',
        component: 'security-middleware'
      });
      
      // Initialize authentication and authorization managers
      await this.authManager.initialize();
      await this.authzManager.initialize();
      
      // Start periodic cleanup
      this.startPeriodicCleanup();
      
      this.logger.info('Security middleware initialized successfully', {
        subsystem: 'auth',
        component: 'security-middleware',
        requireAuth: this.config.requireAuth,
        allowAnonymous: this.config.allowAnonymous
      });
      
      return true;
      
    } catch (error) {
      this.logger.error('Failed to initialize security middleware', {
        subsystem: 'auth',
        component: 'security-middleware'
      }, error);
      
      throw error;
    }
  }

  /**
   * Main middleware function for request processing
   */
  async processRequest(request, context = {}) {
    this.stats.totalRequests++;
    
    const securityResult = {
      success: false,
      user: null,
      securityContext: null,
      error: null,
      warnings: []
    };
    
    try {
      const requestContext = {
        path: request.path,
        method: request.method,
        ip: request.ip || context.ip,
        userAgent: request.userAgent || context.userAgent,
        sessionId: context.sessionId,
        timestamp: Date.now(),
        ...context
      };
      
      // Step 1: Apply security headers
      const headers = this.getSecurityHeaders();
      
      // Step 2: Rate limiting check
      const rateLimitResult = this.checkRateLimit(requestContext.ip);
      if (!rateLimitResult.allowed) {
        securityResult.error = rateLimitResult.reason;
        this.stats.rateLimitViolations++;
        this.stats.blockedRequests++;
        
        this.logSecurityEvent('rate-limit-exceeded', {
          ip: requestContext.ip,
          path: request.path,
          reason: rateLimitResult.reason
        });
        
        return securityResult;
      }
      
      // Step 3: Input validation and sanitization
      if (request.body) {
        const validationResult = this.validateAndSanitizeInput(request.body);
        if (!validationResult.valid) {
          securityResult.error = `Input validation failed: ${validationResult.errors.join(', ')}`;
          this.stats.securityViolations++;
          this.stats.blockedRequests++;
          
          this.logSecurityEvent('input-validation-failed', {
            ip: requestContext.ip,
            path: request.path,
            errors: validationResult.errors
          });
          
          return securityResult;
        }
        
        if (validationResult.warnings.length > 0) {
          securityResult.warnings = securityResult.warnings.concat(validationResult.warnings);
        }
      }
      
      // Step 4: Check if path requires authentication
      const isPublicPath = this.isPublicPath(request.path);
      
      if (isPublicPath || !this.config.requireAuth) {
        // Public path or auth not required
        if (this.config.allowAnonymous) {
          const anonymousUser = this.createAnonymousUser(requestContext);
          securityResult.user = anonymousUser;
          securityResult.securityContext = await this.buildSecurityContext(anonymousUser, requestContext);
          this.stats.anonymousRequests++;
        }
        
        securityResult.success = true;
        return securityResult;
      }
      
      // Step 5: Extract and validate authentication token
      const token = this.extractAuthToken(request);
      if (!token) {
        securityResult.error = 'Authentication required';
        this.stats.authenticationFailures++;
        
        this.logSecurityEvent('missing-auth-token', {
          ip: requestContext.ip,
          path: request.path
        });
        
        return securityResult;
      }
      
      // Step 6: Validate session and get user
      const sessionValidation = await this.validateSession(token, requestContext);
      if (!sessionValidation.valid) {
        securityResult.error = sessionValidation.error;
        this.stats.authenticationFailures++;
        
        this.logSecurityEvent('session-validation-failed', {
          ip: requestContext.ip,
          path: request.path,
          error: sessionValidation.error
        });
        
        return securityResult;
      }
      
      securityResult.user = sessionValidation.user;
      this.stats.authenticatedRequests++;
      
      // Step 7: Build security context
      securityResult.securityContext = await this.buildSecurityContext(
        sessionValidation.user, 
        requestContext
      );
      
      securityResult.success = true;
      
      this.logger.debug('Request processed successfully', {
        subsystem: 'auth',
        component: 'security-middleware',
        userId: securityResult.user.userId,
        path: request.path,
        ip: requestContext.ip
      });
      
      return securityResult;
      
    } catch (error) {
      securityResult.error = `Security processing failed: ${error.message}`;
      this.stats.securityViolations++;
      
      this.logger.error('Security middleware processing failed', {
        subsystem: 'auth',
        component: 'security-middleware',
        path: request.path,
        ip: context.ip
      }, error);
      
      return securityResult;
    }
  }

  /**
   * Check if user has permission for operation
   */
  async checkPermission(user, resource, action, context = {}) {
    try {
      const permissionResult = await this.authzManager.hasPermission(user, resource, action, context);
      
      if (!permissionResult.granted) {
        this.stats.authorizationFailures++;
        
        this.logSecurityEvent('authorization-failed', {
          userId: user.userId,
          username: user.username,
          resource,
          action,
          reason: permissionResult.reason,
          ip: context.ip
        });
      }
      
      return permissionResult;
      
    } catch (error) {
      this.logger.error('Permission check failed', {
        subsystem: 'auth',
        component: 'security-middleware',
        userId: user.userId,
        resource,
        action
      }, error);
      
      return {
        granted: false,
        reason: `Permission check error: ${error.message}`,
        source: 'error'
      };
    }
  }

  /**
   * Create middleware function for specific resource and action
   */
  requirePermission(resource, action) {
    return async (request, context = {}) => {
      const processResult = await this.processRequest(request, context);
      if (!processResult.success) {
        return processResult;
      }
      
      if (!processResult.user) {
        return {
          success: false,
          error: 'Authentication required for this operation',
          user: null,
          securityContext: null
        };
      }
      
      const permissionResult = await this.checkPermission(
        processResult.user,
        resource,
        action,
        context
      );
      
      if (!permissionResult.granted) {
        return {
          success: false,
          error: permissionResult.reason,
          user: processResult.user,
          securityContext: processResult.securityContext
        };
      }
      
      return processResult;
    };
  }

  /**
   * Extract authentication token from request
   */
  extractAuthToken(request) {
    const authHeader = request.headers?.[this.config.sessionHeader.toLowerCase()] ||
                      request.headers?.['authorization'];
    
    if (!authHeader) {
      return null;
    }
    
    if (authHeader.startsWith(this.config.sessionPrefix)) {
      return authHeader.substring(this.config.sessionPrefix.length);
    }
    
    return authHeader;
  }

  /**
   * Validate session token and return user information
   */
  async validateSession(token, context = {}) {
    // Check cache first
    const cached = this.contextCache.get(token);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
      return {
        valid: true,
        user: cached.user,
        sessionData: cached.sessionData
      };
    }
    
    // Validate with authentication manager
    const validation = await this.authManager.validateSession(token);
    if (!validation.valid) {
      return {
        valid: false,
        error: validation.error
      };
    }
    
    const user = {
      userId: validation.userId,
      username: validation.username,
      role: validation.role,
      securityLevel: validation.securityLevel
    };
    
    // Cache the result
    this.contextCache.set(token, {
      user,
      sessionData: validation.sessionData,
      timestamp: Date.now()
    });
    
    return {
      valid: true,
      user,
      sessionData: validation.sessionData
    };
  }

  /**
   * Build security context for request
   */
  async buildSecurityContext(user, requestContext) {
    const permissions = await this.authzManager.getRolePermissions(user.role, true);
    
    return {
      user: {
        userId: user.userId,
        username: user.username,
        role: user.role,
        securityLevel: user.securityLevel
      },
      permissions,
      session: {
        ip: requestContext.ip,
        userAgent: requestContext.userAgent,
        timestamp: requestContext.timestamp
      },
      request: {
        path: requestContext.path,
        method: requestContext.method
      }
    };
  }

  /**
   * Create anonymous user for public access
   */
  createAnonymousUser(context) {
    return {
      userId: 'anonymous',
      username: 'anonymous',
      role: this.config.anonymousRole,
      securityLevel: 20,
      isAnonymous: true,
      ip: context.ip,
      userAgent: context.userAgent
    };
  }

  /**
   * Check if path is public (doesn't require authentication)
   */
  isPublicPath(path) {
    return this.config.publicPaths.some(publicPath => {
      if (publicPath.endsWith('*')) {
        return path.startsWith(publicPath.slice(0, -1));
      }
      return path === publicPath;
    });
  }

  /**
   * Check rate limiting
   */
  checkRateLimit(ip) {
    if (!ip) {
      return { allowed: true };
    }
    
    const now = Date.now();
    const limit = this.config.globalRateLimit;
    
    let rateLimitData = this.rateLimitData.get(ip);
    if (!rateLimitData) {
      rateLimitData = { requests: [], windowStart: now };
      this.rateLimitData.set(ip, rateLimitData);
    }
    
    // Clean old requests outside the window
    rateLimitData.requests = rateLimitData.requests.filter(
      timestamp => timestamp > now - limit.window
    );
    
    // Check if limit is exceeded
    if (rateLimitData.requests.length >= limit.requests) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${limit.requests} requests per ${Math.ceil(limit.window / 1000)} seconds`
      };
    }
    
    // Add current request
    rateLimitData.requests.push(now);
    
    return { allowed: true };
  }

  /**
   * Validate and sanitize input
   */
  validateAndSanitizeInput(input) {
    const errors = [];
    const warnings = [];
    
    try {
      // Check input size
      const inputSize = JSON.stringify(input).length;
      if (inputSize > this.config.maxRequestSize) {
        errors.push(`Request size too large: ${inputSize} > ${this.config.maxRequestSize}`);
      }
      
      // Check for dangerous patterns
      const inputString = JSON.stringify(input);
      
      // Check for script injection
      if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(inputString)) {
        errors.push('Script injection detected');
      }
      
      // Check for SQL injection patterns
      if (/(\bUNION\b|\bSELECT\b|\bINSERT\b|\bDELETE\b|\bUPDATE\b|\bDROP\b)[\s\S]*(\bFROM\b|\bINTO\b|\bWHERE\b)/gi.test(inputString)) {
        warnings.push('Potential SQL injection pattern detected');
      }
      
      // Check for command injection
      if (/(\b(?:rm|curl|wget|cat|ls|ps|kill|chmod|chown|sudo)\b|[;&|`$])/gi.test(inputString)) {
        warnings.push('Potential command injection pattern detected');
      }
      
      // Check for prototype pollution
      if (/(proto|constructor|prototype)[\s]*[:=]/gi.test(inputString)) {
        errors.push('Prototype pollution attempt detected');
      }
      
      // Sanitize input if configured
      if (this.config.sanitizeInput && typeof input === 'object') {
        this.sanitizeObject(input);
      }
      
      return {
        valid: errors.length === 0,
        errors,
        warnings
      };
      
    } catch (error) {
      return {
        valid: false,
        errors: [`Input validation error: ${error.message}`],
        warnings: []
      };
    }
  }

  /**
   * Recursively sanitize object
   */
  sanitizeObject(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }
    
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        // Remove dangerous keys
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          delete obj[key];
          continue;
        }
        
        // Recursively sanitize
        if (typeof obj[key] === 'object') {
          this.sanitizeObject(obj[key]);
        } else if (typeof obj[key] === 'string') {
          // Basic string sanitization
          obj[key] = obj[key]
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '');
        }
      }
    }
    
    return obj;
  }

  /**
   * Get security headers
   */
  getSecurityHeaders() {
    const headers = {};
    
    if (this.config.enableSecurityHeaders) {
      headers['X-Content-Type-Options'] = 'nosniff';
      headers['X-Frame-Options'] = 'DENY';
      headers['X-XSS-Protection'] = '1; mode=block';
      headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
      headers['Referrer-Policy'] = 'strict-origin-when-cross-origin';
      headers['Content-Security-Policy'] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';";
    }
    
    if (this.config.corsEnabled) {
      headers['Access-Control-Allow-Origin'] = this.config.allowedOrigins.join(', ');
      headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Requested-With';
      headers['Access-Control-Max-Age'] = '86400';
    }
    
    return headers;
  }

  /**
   * Log security events
   */
  logSecurityEvent(eventType, details) {
    this.logger.warn('Security event detected', {
      subsystem: 'auth',
      component: 'security-middleware',
      eventType,
      details,
      timestamp: Date.now()
    });
  }

  /**
   * Start periodic cleanup
   */
  startPeriodicCleanup() {
    setInterval(() => {
      this.cleanupExpiredData();
    }, 60 * 1000); // Run every minute
  }

  /**
   * Clean up expired data
   */
  cleanupExpiredData() {
    const now = Date.now();
    
    // Clean up context cache
    let expiredContexts = 0;
    for (const [token, cached] of this.contextCache) {
      if (now - cached.timestamp > this.cacheTimeout) {
        this.contextCache.delete(token);
        expiredContexts++;
      }
    }
    
    // Clean up rate limit data (older than 1 hour)
    const rateLimitCutoff = now - (60 * 60 * 1000);
    let expiredRateLimits = 0;
    for (const [ip, data] of this.rateLimitData) {
      data.requests = data.requests.filter(timestamp => timestamp > rateLimitCutoff);
      if (data.requests.length === 0) {
        this.rateLimitData.delete(ip);
        expiredRateLimits++;
      }
    }
    
    if (expiredContexts > 0 || expiredRateLimits > 0) {
      this.logger.debug('Cleaned up expired security data', {
        subsystem: 'auth',
        component: 'security-middleware',
        expiredContexts,
        expiredRateLimits
      });
    }
  }

  /**
   * Get security statistics
   */
  getStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    
    return {
      uptime,
      totalRequests: this.stats.totalRequests,
      authenticatedRequests: this.stats.authenticatedRequests,
      anonymousRequests: this.stats.anonymousRequests,
      blockedRequests: this.stats.blockedRequests,
      authenticationFailures: this.stats.authenticationFailures,
      authorizationFailures: this.stats.authorizationFailures,
      securityViolations: this.stats.securityViolations,
      rateLimitViolations: this.stats.rateLimitViolations,
      
      // Current state
      cachedContexts: this.contextCache.size,
      trackedIPs: this.rateLimitData.size,
      
      // Rates
      authenticationRate: this.stats.totalRequests > 0 ?
        (this.stats.authenticatedRequests / this.stats.totalRequests) * 100 : 0,
      blockRate: this.stats.totalRequests > 0 ?
        (this.stats.blockedRequests / this.stats.totalRequests) * 100 : 0,
        
      // Manager stats
      authStats: this.authManager.getStats(),
      authzStats: this.authzManager.getStats()
    };
  }

  /**
   * Health check for security middleware
   */
  async healthCheck() {
    try {
      const stats = this.getStats();
      const authHealth = await this.authManager.healthCheck();
      const authzHealth = await this.authzManager.healthCheck();
      
      const isHealthy = authHealth.healthy && 
                       authzHealth.healthy && 
                       stats.blockRate < 50 && 
                       stats.securityViolations < 100;
      
      return {
        healthy: isHealthy,
        reason: isHealthy ? 'Security middleware healthy' : 'Security issues detected',
        details: {
          totalRequests: stats.totalRequests,
          blockRate: stats.blockRate,
          securityViolations: stats.securityViolations,
          authHealth: authHealth.healthy,
          authzHealth: authzHealth.healthy
        }
      };
      
    } catch (error) {
      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  /**
   * Shutdown security middleware
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down security middleware', {
        subsystem: 'auth',
        component: 'security-middleware'
      });
      
      // Shutdown managers
      await this.authManager.shutdown();
      await this.authzManager.shutdown();
      
      // Clear caches
      this.contextCache.clear();
      this.rateLimitData.clear();
      
    } catch (error) {
      this.logger.error('Security middleware shutdown failed', {
        subsystem: 'auth',
        component: 'security-middleware'
      }, error);
    }
  }
}

export default SecurityMiddleware;