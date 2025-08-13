#!/usr/bin/env node

/**
 * Authentication Integration - Integrates auth system with existing Cognitron05
 * 
 * Features:
 * - Seamless integration with existing CLI and agent systems
 * - User context injection into chat sessions
 * - Memory system access control
 * - Command-level authorization
 * - Session-aware logging
 * - Backward compatibility with existing functionality
 */

import { SecurityMiddleware } from './SecurityMiddleware.js';
import { getLogger } from '../utils/StructuredLogger.js';

export class AuthIntegration {
  constructor(config = {}) {
    this.config = {
      // Integration settings
      enableAuth: config.enableAuth !== false,
      defaultMode: config.defaultMode || 'development', // 'development' or 'production'
      
      // CLI integration
      enableCLIAuth: config.enableCLIAuth || false,
      autoCreateUser: config.autoCreateUser !== false,
      defaultUsername: config.defaultUsername || process.env.USER || 'cognitron_user',
      
      // Session management
      persistSessions: config.persistSessions !== false,
      sessionTimeout: config.sessionTimeout || 24 * 60 * 60 * 1000, // 24 hours
      
      // Memory integration
      userContextInMemory: config.userContextInMemory !== false,
      separateUserMemories: config.separateUserMemories || false,
      
      // Command authorization mapping
      commandPermissions: config.commandPermissions || {
        // Chat commands
        '/exit': 'chat:read',
        '/clear': 'chat:read',
        '/stats': 'memory:read',
        '/memory': 'memory:read',
        '/search': 'memory:search',
        '/history': 'memory:read',
        '/export': 'memory:export',
        '/import': 'memory:import',
        
        // System commands
        '/reasoning': 'config:read',
        '/temperature': 'config:write',
        '/limit': 'config:write',
        '/agent': 'system:read',
        
        // Admin commands
        '/config': 'config:read',
        '/logs': 'logs:read',
        '/monitor': 'monitoring:read'
      },
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Initialize security middleware
    this.security = new SecurityMiddleware(config);
    
    // Current session context
    this.currentSession = null;
    this.currentUser = null;
    
    // Session cache for CLI mode
    this.sessionCache = new Map();
    
    // Statistics
    this.stats = {
      sessionsCreated: 0,
      commandsAuthorized: 0,
      commandsDenied: 0,
      memoryAccess: 0,
      userContextsCreated: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Initialize authentication integration
   */
  async initialize() {
    try {
      this.logger.info('Initializing authentication integration', {
        subsystem: 'auth',
        component: 'auth-integration',
        enableAuth: this.config.enableAuth,
        defaultMode: this.config.defaultMode
      });
      
      if (this.config.enableAuth) {
        await this.security.initialize();
        
        // Auto-create default user in development mode
        if (this.config.defaultMode === 'development' && this.config.autoCreateUser) {
          await this.ensureDefaultUser();
        }
      }
      
      this.logger.info('Authentication integration initialized', {
        subsystem: 'auth',
        component: 'auth-integration',
        hasCurrentUser: !!this.currentUser
      });
      
      return true;
      
    } catch (error) {
      this.logger.error('Failed to initialize authentication integration', {
        subsystem: 'auth',
        component: 'auth-integration'
      }, error);
      
      throw error;
    }
  }

  /**
   * Start authenticated session for CLI mode
   */
  async startSession(credentials = null) {
    try {
      if (!this.config.enableAuth) {
        // Create anonymous session for non-auth mode
        this.currentSession = this.createAnonymousSession();
        this.currentUser = this.currentSession.user;
        return { success: true, session: this.currentSession };
      }
      
      let authResult;
      
      if (credentials) {
        // Authenticate with provided credentials
        authResult = await this.security.authManager.authenticateUser({
          ...credentials,
          ip: '127.0.0.1', // CLI local access
          userAgent: 'Cognitron CLI'
        });
      } else {
        // Try to use cached session or create default user session
        const cachedSession = this.getCachedSession();
        if (cachedSession) {
          this.currentSession = cachedSession;
          this.currentUser = cachedSession.user;
          return { success: true, session: cachedSession };
        }
        
        // Auto-login with default user in development mode
        if (this.config.defaultMode === 'development') {
          authResult = await this.authenticateDefaultUser();
        } else {
          return { 
            success: false, 
            error: 'Authentication required. Use login command or provide credentials.',
            requiresAuth: true 
          };
        }
      }
      
      if (!authResult.success) {
        return {
          success: false,
          error: authResult.error,
          requiresMFA: authResult.requiresMFA,
          mfaToken: authResult.mfaToken
        };
      }
      
      // Create session context
      this.currentSession = {
        sessionId: this.generateSessionId(),
        userId: authResult.userId,
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        expiresAt: Date.now() + this.config.sessionTimeout,
        user: await this.getUserDetails(authResult.userId),
        startedAt: Date.now(),
        isAuthenticated: true
      };
      
      this.currentUser = this.currentSession.user;
      
      // Cache session
      this.cacheSession(this.currentSession);
      this.stats.sessionsCreated++;
      
      this.logger.info('Authentication session started', {
        subsystem: 'auth',
        component: 'auth-integration',
        userId: this.currentUser.userId,
        username: this.currentUser.username,
        role: this.currentUser.role
      });
      
      return { success: true, session: this.currentSession };
      
    } catch (error) {
      this.logger.error('Failed to start authentication session', {
        subsystem: 'auth',
        component: 'auth-integration'
      }, error);
      
      return { success: false, error: `Session start failed: ${error.message}` };
    }
  }

  /**
   * Check authorization for command execution
   */
  async authorizeCommand(command, args = [], context = {}) {
    try {
      if (!this.config.enableAuth) {
        return { authorized: true, reason: 'Authentication disabled' };
      }
      
      if (!this.currentUser) {
        return { authorized: false, reason: 'No active user session' };
      }
      
      // Get required permission for command
      const permission = this.getCommandPermission(command);
      if (!permission) {
        // Command doesn't require specific permission
        return { authorized: true, reason: 'No permission required' };
      }
      
      const [resource, action] = permission.split(':');
      
      // Check permission
      const permissionResult = await this.security.checkPermission(
        this.currentUser,
        resource,
        action,
        {
          command,
          args,
          sessionId: this.currentSession?.sessionId,
          ...context
        }
      );
      
      if (permissionResult.granted) {
        this.stats.commandsAuthorized++;
      } else {
        this.stats.commandsDenied++;
      }
      
      this.logger.debug('Command authorization check', {
        subsystem: 'auth',
        component: 'auth-integration',
        command,
        permission,
        granted: permissionResult.granted,
        userId: this.currentUser.userId
      });
      
      return {
        authorized: permissionResult.granted,
        reason: permissionResult.reason,
        permission,
        source: permissionResult.source
      };
      
    } catch (error) {
      this.logger.error('Command authorization failed', {
        subsystem: 'auth',
        component: 'auth-integration',
        command,
        userId: this.currentUser?.userId
      }, error);
      
      return { authorized: false, reason: `Authorization error: ${error.message}` };
    }
  }

  /**
   * Get user context for memory system integration
   */
  getUserContextForMemory() {
    if (!this.config.userContextInMemory || !this.currentUser) {
      return null;
    }
    
    const userContext = {
      userId: this.currentUser.userId,
      username: this.currentUser.username,
      role: this.currentUser.role,
      securityLevel: this.currentUser.securityLevel,
      sessionId: this.currentSession?.sessionId,
      sessionStarted: this.currentSession?.startedAt,
      preferences: this.currentUser.preferences || {},
      permissions: this.currentSession?.permissions || []
    };
    
    this.stats.memoryAccess++;
    
    return userContext;
  }

  /**
   * Get memory storage path for user (if separate memories enabled)
   */
  getUserMemoryPath() {
    if (!this.config.separateUserMemories || !this.currentUser) {
      return null;
    }
    
    return `user-${this.currentUser.userId}`;
  }

  /**
   * Wrap memory operations with authorization checks
   */
  async authorizeMemoryOperation(operation, data = null, context = {}) {
    try {
      if (!this.config.enableAuth) {
        return { authorized: true };
      }
      
      if (!this.currentUser) {
        return { authorized: false, reason: 'Authentication required for memory operations' };
      }
      
      // Map memory operations to permissions
      const operationPermissions = {
        'read': 'memory:read',
        'write': 'memory:write', 
        'search': 'memory:search',
        'export': 'memory:export',
        'import': 'memory:import',
        'clear': 'memory:write',
        'backup': 'memory:export',
        'restore': 'memory:import'
      };
      
      const permission = operationPermissions[operation];
      if (!permission) {
        return { authorized: true, reason: 'No permission required for operation' };
      }
      
      const [resource, action] = permission.split(':');
      
      const permissionResult = await this.security.checkPermission(
        this.currentUser,
        resource, 
        action,
        {
          operation,
          dataSize: data ? JSON.stringify(data).length : 0,
          sessionId: this.currentSession?.sessionId,
          ...context
        }
      );
      
      return {
        authorized: permissionResult.granted,
        reason: permissionResult.reason,
        permission,
        userContext: this.getUserContextForMemory()
      };
      
    } catch (error) {
      this.logger.error('Memory operation authorization failed', {
        subsystem: 'auth',
        component: 'auth-integration',
        operation,
        userId: this.currentUser?.userId
      }, error);
      
      return { authorized: false, reason: `Authorization error: ${error.message}` };
    }
  }

  /**
   * Register new user (development helper)
   */
  async registerUser(userData) {
    if (!this.config.enableAuth) {
      return { success: false, error: 'Authentication not enabled' };
    }
    
    try {
      const result = await this.security.authManager.registerUser({
        ...userData,
        ip: '127.0.0.1',
        userAgent: 'Cognitron CLI',
        source: 'cli-registration'
      });
      
      if (result.success) {
        this.stats.userContextsCreated++;
        
        this.logger.info('User registered successfully', {
          subsystem: 'auth',
          component: 'auth-integration',
          userId: result.userId,
          username: userData.username
        });
      }
      
      return result;
      
    } catch (error) {
      this.logger.error('User registration failed', {
        subsystem: 'auth',
        component: 'auth-integration',
        username: userData.username
      }, error);
      
      return { success: false, error: `Registration failed: ${error.message}` };
    }
  }

  /**
   * Logout current user
   */
  async logout() {
    try {
      if (this.currentSession && this.currentSession.accessToken) {
        await this.security.authManager.logout(this.currentSession.accessToken);
      }
      
      // Clear session cache
      if (this.currentSession) {
        this.sessionCache.delete(this.currentSession.sessionId);
      }
      
      this.currentSession = null;
      this.currentUser = null;
      
      this.logger.info('User logged out successfully', {
        subsystem: 'auth',
        component: 'auth-integration'
      });
      
      return { success: true };
      
    } catch (error) {
      this.logger.error('Logout failed', {
        subsystem: 'auth',
        component: 'auth-integration'
      }, error);
      
      return { success: false, error: `Logout failed: ${error.message}` };
    }
  }

  /**
   * Get current user information
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Get current session information
   */
  getCurrentSession() {
    return this.currentSession;
  }

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return !!this.currentUser && (
      !this.currentSession || 
      !this.currentSession.expiresAt ||
      Date.now() < this.currentSession.expiresAt
    );
  }

  /**
   * Refresh session if needed
   */
  async refreshSessionIfNeeded() {
    if (!this.config.enableAuth || !this.currentSession) {
      return { success: true };
    }
    
    try {
      // Check if session is close to expiring (within 1 hour)
      const oneHour = 60 * 60 * 1000;
      if (this.currentSession.expiresAt && 
          (this.currentSession.expiresAt - Date.now()) < oneHour) {
        
        const refreshResult = await this.security.authManager.refreshSession(
          this.currentSession.refreshToken
        );
        
        if (refreshResult.success) {
          // Update session tokens
          this.currentSession.accessToken = refreshResult.accessToken;
          this.currentSession.refreshToken = refreshResult.refreshToken;
          this.currentSession.expiresAt = Date.now() + this.config.sessionTimeout;
          
          // Update cache
          this.cacheSession(this.currentSession);
          
          this.logger.debug('Session refreshed successfully', {
            subsystem: 'auth',
            component: 'auth-integration',
            userId: this.currentUser.userId
          });
        } else {
          this.logger.warn('Session refresh failed', {
            subsystem: 'auth',
            component: 'auth-integration',
            error: refreshResult.error
          });
        }
        
        return refreshResult;
      }
      
      return { success: true };
      
    } catch (error) {
      this.logger.error('Session refresh check failed', {
        subsystem: 'auth',
        component: 'auth-integration'
      }, error);
      
      return { success: false, error: `Session refresh failed: ${error.message}` };
    }
  }

  /**
   * Private: Ensure default user exists
   */
  async ensureDefaultUser() {
    try {
      const defaultUser = {
        username: this.config.defaultUsername,
        password: 'cognitron_default_pass',
        email: `${this.config.defaultUsername}@local.dev`,
        role: 'user'
      };
      
      // Try to register default user (will fail if already exists)
      await this.security.authManager.registerUser({
        ...defaultUser,
        ip: '127.0.0.1',
        userAgent: 'Cognitron CLI Setup',
        source: 'auto-setup'
      });
      
      this.logger.info('Default user created for development mode', {
        subsystem: 'auth',
        component: 'auth-integration',
        username: defaultUser.username
      });
      
    } catch (error) {
      // User probably already exists, which is fine
      this.logger.debug('Default user setup skipped', {
        subsystem: 'auth',
        component: 'auth-integration',
        reason: error.message
      });
    }
  }

  /**
   * Private: Authenticate default user
   */
  async authenticateDefaultUser() {
    return await this.security.authManager.authenticateUser({
      username: this.config.defaultUsername,
      password: 'cognitron_default_pass',
      ip: '127.0.0.1',
      userAgent: 'Cognitron CLI'
    });
  }

  /**
   * Private: Create anonymous session
   */
  createAnonymousSession() {
    return {
      sessionId: this.generateSessionId(),
      userId: 'anonymous',
      user: {
        userId: 'anonymous',
        username: 'anonymous',
        role: 'user',
        securityLevel: 40,
        isAnonymous: true
      },
      startedAt: Date.now(),
      isAuthenticated: false
    };
  }

  /**
   * Private: Get cached session
   */
  getCachedSession() {
    if (!this.config.persistSessions) {
      return null;
    }
    
    // Find valid cached session
    for (const [sessionId, session] of this.sessionCache) {
      if (!session.expiresAt || Date.now() < session.expiresAt) {
        return session;
      } else {
        // Remove expired session
        this.sessionCache.delete(sessionId);
      }
    }
    
    return null;
  }

  /**
   * Private: Cache session
   */
  cacheSession(session) {
    if (this.config.persistSessions && session.sessionId) {
      this.sessionCache.set(session.sessionId, session);
    }
  }

  /**
   * Private: Get user details
   */
  async getUserDetails(userId) {
    // This would normally fetch from user database
    // For now, return basic user info from validation
    const validation = await this.security.authManager.validateSession(
      this.currentSession?.accessToken
    );
    
    if (validation.valid) {
      return {
        userId: validation.userId,
        username: validation.username,
        role: validation.role,
        securityLevel: validation.securityLevel
      };
    }
    
    return null;
  }

  /**
   * Private: Get command permission mapping
   */
  getCommandPermission(command) {
    return this.config.commandPermissions[command] || null;
  }

  /**
   * Private: Generate session ID
   */
  generateSessionId() {
    return 'sess_cli_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Get integration statistics
   */
  getStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    
    return {
      uptime,
      enableAuth: this.config.enableAuth,
      currentUser: this.currentUser ? {
        userId: this.currentUser.userId,
        username: this.currentUser.username,
        role: this.currentUser.role
      } : null,
      sessionsCreated: this.stats.sessionsCreated,
      commandsAuthorized: this.stats.commandsAuthorized,
      commandsDenied: this.stats.commandsDenied,
      memoryAccess: this.stats.memoryAccess,
      userContextsCreated: this.stats.userContextsCreated,
      cachedSessions: this.sessionCache.size,
      
      // Security stats
      securityStats: this.config.enableAuth ? this.security.getStats() : null
    };
  }

  /**
   * Health check for authentication integration
   */
  async healthCheck() {
    try {
      const stats = this.getStats();
      let securityHealth = { healthy: true };
      
      if (this.config.enableAuth) {
        securityHealth = await this.security.healthCheck();
      }
      
      const isHealthy = securityHealth.healthy && 
                       (stats.commandsDenied < 10 || stats.commandsAuthorized > stats.commandsDenied);
      
      return {
        healthy: isHealthy,
        reason: isHealthy ? 'Authentication integration healthy' : 'Authentication issues detected',
        details: {
          enableAuth: this.config.enableAuth,
          hasCurrentUser: !!this.currentUser,
          commandsAuthorized: stats.commandsAuthorized,
          commandsDenied: stats.commandsDenied,
          securityHealth: securityHealth.healthy
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
   * Shutdown authentication integration
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down authentication integration', {
        subsystem: 'auth',
        component: 'auth-integration'
      });
      
      // Logout current user
      await this.logout();
      
      // Shutdown security middleware
      if (this.config.enableAuth) {
        await this.security.shutdown();
      }
      
      // Clear caches
      this.sessionCache.clear();
      
    } catch (error) {
      this.logger.error('Authentication integration shutdown failed', {
        subsystem: 'auth',
        component: 'auth-integration'
      }, error);
    }
  }
}

export default AuthIntegration;