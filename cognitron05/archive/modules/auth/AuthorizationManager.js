#!/usr/bin/env node

/**
 * Authorization Manager - Role-based access control and permissions system
 * 
 * Features:
 * - Role-based access control (RBAC)
 * - Fine-grained permissions
 * - Resource-level access control
 * - Dynamic permission evaluation
 * - Permission inheritance
 * - Audit trail for authorization decisions
 * - Security policy enforcement
 * - Context-aware authorization
 */

import { getLogger } from '../utils/StructuredLogger.js';
import { createSecureOpsForDirectory } from '../security/SecureFileOpsMigration.js';
import path from 'path';

export class AuthorizationManager {
  constructor(config = {}) {
    this.config = {
      // Default roles and permissions
      defaultRoles: config.defaultRoles || [
        'superadmin',
        'admin', 
        'moderator',
        'user',
        'guest'
      ],
      
      // Permission inheritance
      enableInheritance: config.enableInheritance !== false,
      
      // Caching
      enableCache: config.enableCache !== false,
      cacheTimeout: config.cacheTimeout || 5 * 60 * 1000, // 5 minutes
      
      // Auditing
      auditDecisions: config.auditDecisions !== false,
      maxAuditEntries: config.maxAuditEntries || 10000,
      
      // Storage
      rolesFile: config.rolesFile || 'roles.json',
      permissionsFile: config.permissionsFile || 'permissions.json',
      policiesFile: config.policiesFile || 'policies.json',
      dataDir: config.dataDir || path.join(process.cwd(), 'cognitron05-data', 'auth'),
      
      ...config
    };
    
    this.logger = getLogger();
    
    // Initialize secure file operations
    this.secureOps = createSecureOpsForDirectory(this.config.dataDir, {
      maxFileSize: 10 * 1024 * 1024, // 10MB max for auth files
      allowSymlinks: false,
      validateFileTypes: true,
      allowedMimeTypes: ['application/json']
    });
    
    // Authorization data
    this.roles = new Map();
    this.permissions = new Map();
    this.policies = new Map();
    
    // Permission cache
    this.permissionCache = new Map(); // key: `${userId}:${resource}:${action}`, value: { result, timestamp }
    
    // Audit trail
    this.auditTrail = [];
    
    // Statistics
    this.stats = {
      totalRoles: 0,
      totalPermissions: 0,
      totalPolicies: 0,
      authorizationChecks: 0,
      accessGranted: 0,
      accessDenied: 0,
      cacheHits: 0,
      cacheMisses: 0,
      policyViolations: 0,
      lastReset: Date.now()
    };
    
    // Initialize default system
    this.initializeDefaultSystem();
  }

  /**
   * Initialize authorization system
   */
  async initialize() {
    try {
      this.logger.info('Initializing authorization system', {
        subsystem: 'auth',
        component: 'authorization-manager'
      });

      // Create auth directory
      await this.secureOps.mkdir('.', { recursive: true });
      
      // Load authorization data
      await this.loadRoles();
      await this.loadPermissions();
      await this.loadPolicies();
      
      // Setup periodic cache cleanup
      this.startCacheCleanup();
      
      // Setup graceful shutdown
      process.on('beforeExit', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
      
      this.logger.info('Authorization system initialized', {
        subsystem: 'auth',
        component: 'authorization-manager',
        totalRoles: this.roles.size,
        totalPermissions: this.permissions.size,
        totalPolicies: this.policies.size
      });
      
      return true;
      
    } catch (error) {
      this.logger.error('Failed to initialize authorization system', {
        subsystem: 'auth',
        component: 'authorization-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Initialize default roles, permissions, and policies
   */
  initializeDefaultSystem() {
    // Default permissions
    const defaultPermissions = [
      // System permissions
      'system:read', 'system:write', 'system:admin', 'system:config',
      
      // User management
      'users:read', 'users:write', 'users:create', 'users:delete', 'users:manage',
      
      // Memory system
      'memory:read', 'memory:write', 'memory:search', 'memory:export', 'memory:import',
      
      // Chat operations
      'chat:send', 'chat:read', 'chat:history', 'chat:export',
      
      // Tools and plugins
      'tools:use', 'tools:install', 'tools:configure', 'tools:manage',
      'plugins:load', 'plugins:install', 'plugins:configure', 'plugins:manage',
      
      // Monitoring and logs
      'monitoring:read', 'monitoring:configure', 'logs:read', 'logs:export',
      
      // Configuration
      'config:read', 'config:write', 'config:export', 'config:import'
    ];
    
    // Initialize permissions
    for (const permission of defaultPermissions) {
      this.permissions.set(permission, {
        name: permission,
        description: `Permission to ${permission.replace(':', ' ')}`,
        resource: permission.split(':')[0],
        action: permission.split(':')[1],
        createdAt: new Date().toISOString()
      });
    }
    
    // Default role definitions
    const defaultRoleDefinitions = {
      superadmin: {
        name: 'Super Administrator',
        level: 100,
        permissions: ['*'], // All permissions
        inherits: [],
        description: 'Full system access with all permissions'
      },
      
      admin: {
        name: 'Administrator',
        level: 80,
        permissions: [
          'system:read', 'system:write', 'system:config',
          'users:read', 'users:write', 'users:create', 'users:manage',
          'memory:read', 'memory:write', 'memory:search', 'memory:export', 'memory:import',
          'chat:send', 'chat:read', 'chat:history', 'chat:export',
          'tools:use', 'tools:configure', 'tools:manage',
          'plugins:load', 'plugins:configure', 'plugins:manage',
          'monitoring:read', 'monitoring:configure',
          'logs:read', 'logs:export',
          'config:read', 'config:write', 'config:export', 'config:import'
        ],
        inherits: [],
        description: 'Administrative access to most system functions'
      },
      
      moderator: {
        name: 'Moderator',
        level: 60,
        permissions: [
          'system:read',
          'users:read',
          'memory:read', 'memory:search', 'memory:export',
          'chat:send', 'chat:read', 'chat:history', 'chat:export',
          'tools:use',
          'plugins:load',
          'monitoring:read',
          'logs:read',
          'config:read'
        ],
        inherits: ['user'],
        description: 'Moderate access with read permissions and basic operations'
      },
      
      user: {
        name: 'User',
        level: 40,
        permissions: [
          'memory:read', 'memory:search',
          'chat:send', 'chat:read', 'chat:history',
          'tools:use',
          'config:read'
        ],
        inherits: ['guest'],
        description: 'Standard user access for chat and basic features'
      },
      
      guest: {
        name: 'Guest',
        level: 20,
        permissions: [
          'chat:send', 'chat:read'
        ],
        inherits: [],
        description: 'Limited guest access for basic chat functionality'
      }
    };
    
    // Initialize roles
    for (const [roleId, roleDef] of Object.entries(defaultRoleDefinitions)) {
      this.roles.set(roleId, {
        ...roleDef,
        id: roleId,
        createdAt: new Date().toISOString(),
        isSystem: true
      });
    }
    
    // Default security policies
    const defaultPolicies = {
      'resource-access': {
        name: 'Resource Access Policy',
        description: 'Controls access to system resources',
        rules: [
          {
            condition: 'user.role === "guest"',
            action: 'deny',
            resources: ['system:*', 'users:*', 'config:*'],
            message: 'Guests are not allowed to access system resources'
          },
          {
            condition: 'user.securityLevel < 60',
            action: 'deny', 
            resources: ['tools:manage', 'plugins:manage'],
            message: 'Insufficient security clearance for management operations'
          }
        ],
        enabled: true
      },
      
      'rate-limiting': {
        name: 'Rate Limiting Policy',
        description: 'Controls request rate limits by role',
        rules: [
          {
            condition: 'user.role === "guest"',
            action: 'limit',
            resources: ['chat:send'],
            limit: { requests: 10, window: 60000 }, // 10 requests per minute
            message: 'Guest users are rate limited'
          },
          {
            condition: 'user.role === "user"',
            action: 'limit',
            resources: ['memory:search', 'tools:use'],
            limit: { requests: 100, window: 60000 }, // 100 requests per minute
            message: 'Standard users are rate limited'
          }
        ],
        enabled: true
      },
      
      'time-based': {
        name: 'Time-based Access Policy',
        description: 'Controls access based on time and usage patterns',
        rules: [
          {
            condition: 'hour >= 2 && hour <= 6',
            action: 'restrict',
            resources: ['system:write', 'config:write'],
            message: 'System modifications restricted during maintenance window'
          }
        ],
        enabled: false // Disabled by default
      }
    };
    
    // Initialize policies
    for (const [policyId, policyDef] of Object.entries(defaultPolicies)) {
      this.policies.set(policyId, {
        ...policyDef,
        id: policyId,
        createdAt: new Date().toISOString(),
        isSystem: true
      });
    }
    
    // Update statistics
    this.stats.totalRoles = this.roles.size;
    this.stats.totalPermissions = this.permissions.size;
    this.stats.totalPolicies = this.policies.size;
  }

  /**
   * Check if user has permission to perform action on resource
   */
  async hasPermission(user, resource, action, context = {}) {
    this.stats.authorizationChecks++;
    
    try {
      const permission = `${resource}:${action}`;
      const cacheKey = `${user.userId}:${permission}`;
      
      // Check cache first
      if (this.config.enableCache) {
        const cached = this.permissionCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < this.config.cacheTimeout) {
          this.stats.cacheHits++;
          this.updateAccessStats(cached.result);
          
          if (this.config.auditDecisions) {
            this.auditDecision(user, resource, action, cached.result, 'cached', context);
          }
          
          return cached.result;
        }
        this.stats.cacheMisses++;
      }
      
      // Check policies first
      const policyResult = await this.evaluatePolicies(user, resource, action, context);
      if (policyResult.action === 'deny') {
        const result = {
          granted: false,
          reason: policyResult.message,
          source: 'policy',
          policy: policyResult.policy
        };
        
        this.cacheResult(cacheKey, result);
        this.updateAccessStats(false);
        
        if (this.config.auditDecisions) {
          this.auditDecision(user, resource, action, false, policyResult.message, context);
        }
        
        return result;
      }
      
      // Check role-based permissions
      const hasRolePermission = await this.checkRolePermission(user.role, permission);
      const result = {
        granted: hasRolePermission,
        reason: hasRolePermission ? 'Access granted by role permissions' : 'Access denied: insufficient permissions',
        source: 'role',
        role: user.role,
        permission
      };
      
      // Apply policy modifications (e.g., rate limiting)
      if (hasRolePermission && policyResult.action === 'limit') {
        const rateLimitResult = this.applyRateLimit(user, resource, action, policyResult.limit);
        if (!rateLimitResult.allowed) {
          result.granted = false;
          result.reason = rateLimitResult.reason;
          result.source = 'rate-limit';
        }
      }
      
      this.cacheResult(cacheKey, result);
      this.updateAccessStats(result.granted);
      
      if (this.config.auditDecisions) {
        this.auditDecision(user, resource, action, result.granted, result.reason, context);
      }
      
      return result;
      
    } catch (error) {
      this.logger.error('Permission check failed', {
        subsystem: 'auth',
        component: 'authorization-manager',
        userId: user.userId,
        resource,
        action
      }, error);
      
      // Default to deny on error
      const result = {
        granted: false,
        reason: `Permission check error: ${error.message}`,
        source: 'error'
      };
      
      this.updateAccessStats(false);
      return result;
    }
  }

  /**
   * Check if role has specific permission
   */
  async checkRolePermission(roleName, permission) {
    const role = this.roles.get(roleName);
    if (!role) {
      return false;
    }
    
    // Check for wildcard permission (superadmin)
    if (role.permissions.includes('*')) {
      return true;
    }
    
    // Check direct permission
    if (role.permissions.includes(permission)) {
      return true;
    }
    
    // Check wildcard permissions for resource
    const [resource, action] = permission.split(':');
    if (role.permissions.includes(`${resource}:*`)) {
      return true;
    }
    
    // Check inherited permissions
    if (this.config.enableInheritance && role.inherits && role.inherits.length > 0) {
      for (const inheritedRole of role.inherits) {
        const hasInherited = await this.checkRolePermission(inheritedRole, permission);
        if (hasInherited) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Evaluate security policies
   */
  async evaluatePolicies(user, resource, action, context = {}) {
    for (const [policyId, policy] of this.policies) {
      if (!policy.enabled) continue;
      
      for (const rule of policy.rules) {
        const matches = this.evaluateCondition(rule.condition, {
          user,
          resource,
          action,
          context,
          hour: new Date().getHours()
        });
        
        if (matches) {
          if (rule.resources.includes(`${resource}:${action}`) || 
              rule.resources.includes(`${resource}:*`) ||
              rule.resources.includes('*')) {
            
            this.logger.debug('Policy rule matched', {
              subsystem: 'auth',
              component: 'authorization-manager',
              policyId,
              ruleCondition: rule.condition,
              action: rule.action,
              userId: user.userId
            });
            
            return {
              action: rule.action,
              message: rule.message,
              policy: policyId,
              limit: rule.limit
            };
          }
        }
      }
    }
    
    return { action: 'allow' };
  }

  /**
   * Evaluate condition expression
   */
  evaluateCondition(condition, variables) {
    try {
      // Simple expression evaluator
      // In production, use a more sophisticated and secure expression evaluator
      let expression = condition;
      
      // Replace variables
      for (const [key, value] of Object.entries(variables)) {
        if (typeof value === 'object' && value !== null) {
          for (const [subKey, subValue] of Object.entries(value)) {
            expression = expression.replace(
              new RegExp(`\\b${key}\\.${subKey}\\b`, 'g'),
              typeof subValue === 'string' ? `"${subValue}"` : String(subValue)
            );
          }
        } else {
          expression = expression.replace(
            new RegExp(`\\b${key}\\b`, 'g'),
            typeof value === 'string' ? `"${value}"` : String(value)
          );
        }
      }
      
      // Basic safety checks
      if (expression.includes('require') || 
          expression.includes('import') || 
          expression.includes('eval') ||
          expression.includes('Function')) {
        throw new Error('Unsafe expression detected');
      }
      
      // Use Function constructor for evaluation (in production, use a proper expression evaluator)
      return new Function('return ' + expression)();
      
    } catch (error) {
      this.logger.warn('Policy condition evaluation failed', {
        subsystem: 'auth',
        component: 'authorization-manager',
        condition,
        error: error.message
      });
      
      return false;
    }
  }

  /**
   * Apply rate limiting
   */
  applyRateLimit(user, resource, action, limit) {
    const key = `${user.userId}:${resource}:${action}`;
    const now = Date.now();
    
    if (!this.rateLimits) {
      this.rateLimits = new Map();
    }
    
    let rateLimitData = this.rateLimits.get(key);
    if (!rateLimitData) {
      rateLimitData = { requests: [], windowStart: now };
      this.rateLimits.set(key, rateLimitData);
    }
    
    // Clean old requests outside the window
    rateLimitData.requests = rateLimitData.requests.filter(
      timestamp => timestamp > now - limit.window
    );
    
    // Check if limit is exceeded
    if (rateLimitData.requests.length >= limit.requests) {
      return {
        allowed: false,
        reason: `Rate limit exceeded: ${limit.requests} requests per ${limit.window}ms`
      };
    }
    
    // Add current request
    rateLimitData.requests.push(now);
    
    return { allowed: true };
  }

  /**
   * Create new role
   */
  async createRole(roleData) {
    try {
      const { id, name, permissions = [], inherits = [], level = 50, description = '' } = roleData;
      
      if (this.roles.has(id)) {
        throw new Error(`Role ${id} already exists`);
      }
      
      const role = {
        id,
        name,
        permissions: Array.isArray(permissions) ? permissions : [],
        inherits: Array.isArray(inherits) ? inherits : [],
        level,
        description,
        createdAt: new Date().toISOString(),
        isSystem: false
      };
      
      this.roles.set(id, role);
      this.stats.totalRoles++;
      
      await this.saveRoles();
      
      this.logger.info('Role created successfully', {
        subsystem: 'auth',
        component: 'authorization-manager',
        roleId: id,
        roleName: name,
        permissionCount: permissions.length
      });
      
      return { success: true, role };
      
    } catch (error) {
      this.logger.error('Role creation failed', {
        subsystem: 'auth',
        component: 'authorization-manager',
        roleData
      }, error);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Update existing role
   */
  async updateRole(roleId, updates) {
    try {
      const role = this.roles.get(roleId);
      if (!role) {
        throw new Error(`Role ${roleId} not found`);
      }
      
      // Don't allow modification of system roles
      if (role.isSystem) {
        throw new Error('System roles cannot be modified');
      }
      
      // Apply updates
      const updatedRole = {
        ...role,
        ...updates,
        id: roleId, // Prevent ID changes
        updatedAt: new Date().toISOString()
      };
      
      this.roles.set(roleId, updatedRole);
      await this.saveRoles();
      
      // Clear permission cache for affected users
      this.clearCacheForRole(roleId);
      
      this.logger.info('Role updated successfully', {
        subsystem: 'auth',
        component: 'authorization-manager',
        roleId,
        updates: Object.keys(updates)
      });
      
      return { success: true, role: updatedRole };
      
    } catch (error) {
      this.logger.error('Role update failed', {
        subsystem: 'auth',
        component: 'authorization-manager',
        roleId,
        updates
      }, error);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Delete role
   */
  async deleteRole(roleId) {
    try {
      const role = this.roles.get(roleId);
      if (!role) {
        throw new Error(`Role ${roleId} not found`);
      }
      
      if (role.isSystem) {
        throw new Error('System roles cannot be deleted');
      }
      
      this.roles.delete(roleId);
      this.stats.totalRoles--;
      
      await this.saveRoles();
      
      // Clear permission cache
      this.clearCacheForRole(roleId);
      
      this.logger.info('Role deleted successfully', {
        subsystem: 'auth',
        component: 'authorization-manager',
        roleId
      });
      
      return { success: true };
      
    } catch (error) {
      this.logger.error('Role deletion failed', {
        subsystem: 'auth',
        component: 'authorization-manager',
        roleId
      }, error);
      
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all roles
   */
  getRoles() {
    return Array.from(this.roles.values());
  }

  /**
   * Get role by ID
   */
  getRole(roleId) {
    return this.roles.get(roleId);
  }

  /**
   * Get all permissions
   */
  getPermissions() {
    return Array.from(this.permissions.values());
  }

  /**
   * Get permissions for role (including inherited)
   */
  async getRolePermissions(roleId, includeInherited = true) {
    const role = this.roles.get(roleId);
    if (!role) {
      return [];
    }
    
    let permissions = [...role.permissions];
    
    if (includeInherited && this.config.enableInheritance) {
      for (const inheritedRoleId of role.inherits) {
        const inheritedPermissions = await this.getRolePermissions(inheritedRoleId, true);
        permissions = permissions.concat(inheritedPermissions);
      }
    }
    
    // Remove duplicates
    return [...new Set(permissions)];
  }

  /**
   * Cache permission result
   */
  cacheResult(key, result) {
    if (this.config.enableCache) {
      this.permissionCache.set(key, {
        result,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Clear cache for specific role
   */
  clearCacheForRole(roleId) {
    for (const [key] of this.permissionCache) {
      // Cache keys include userId, not roleId, so we need to clear all
      // In production, maintain a user-role mapping for selective clearing
      this.permissionCache.delete(key);
    }
  }

  /**
   * Update access statistics
   */
  updateAccessStats(granted) {
    if (granted) {
      this.stats.accessGranted++;
    } else {
      this.stats.accessDenied++;
    }
  }

  /**
   * Audit authorization decision
   */
  auditDecision(user, resource, action, granted, reason, context) {
    const auditEntry = {
      timestamp: Date.now(),
      userId: user.userId,
      username: user.username,
      role: user.role,
      resource,
      action,
      granted,
      reason,
      context: {
        ip: context.ip,
        userAgent: context.userAgent,
        sessionId: context.sessionId,
        additional: context.additional
      }
    };
    
    this.auditTrail.push(auditEntry);
    
    // Keep only recent entries
    if (this.auditTrail.length > this.config.maxAuditEntries) {
      this.auditTrail.shift();
    }
    
    // Log significant events
    if (!granted) {
      this.logger.warn('Access denied', {
        subsystem: 'auth',
        component: 'authorization-manager',
        userId: user.userId,
        resource,
        action,
        reason
      });
    }
  }

  /**
   * Start cache cleanup process
   */
  startCacheCleanup() {
    if (this.config.enableCache) {
      setInterval(() => {
        this.cleanupCache();
      }, this.config.cacheTimeout); // Clean up expired entries
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    let expired = 0;
    
    for (const [key, cached] of this.permissionCache) {
      if (now - cached.timestamp > this.config.cacheTimeout) {
        this.permissionCache.delete(key);
        expired++;
      }
    }
    
    if (expired > 0) {
      this.logger.debug('Cleaned up expired permission cache entries', {
        subsystem: 'auth',
        component: 'authorization-manager',
        expired
      });
    }
  }

  /**
   * Load roles from storage
   */
  async loadRoles() {
    try {
      const rolesData = await this.secureOps.readFile(this.config.rolesFile, 'utf8');
      const roles = JSON.parse(rolesData);
      
      for (const [roleId, roleData] of Object.entries(roles)) {
        this.roles.set(roleId, roleData);
      }
      
      this.stats.totalRoles = this.roles.size;
      
      this.logger.debug('Roles loaded successfully', {
        subsystem: 'auth',
        component: 'authorization-manager',
        roleCount: this.roles.size
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.saveRoles();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save roles to storage
   */
  async saveRoles() {
    try {
      const rolesObject = {};
      for (const [roleId, roleData] of this.roles) {
        rolesObject[roleId] = roleData;
      }
      
      await this.secureOps.writeFile(
        this.config.rolesFile,
        JSON.stringify(rolesObject, null, 2),
        'utf8'
      );
      
    } catch (error) {
      this.logger.error('Failed to save roles', {
        subsystem: 'auth',
        component: 'authorization-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Load permissions from storage
   */
  async loadPermissions() {
    try {
      const permissionsData = await this.secureOps.readFile(this.config.permissionsFile, 'utf8');
      const permissions = JSON.parse(permissionsData);
      
      for (const [permissionId, permissionData] of Object.entries(permissions)) {
        this.permissions.set(permissionId, permissionData);
      }
      
      this.stats.totalPermissions = this.permissions.size;
      
      this.logger.debug('Permissions loaded successfully', {
        subsystem: 'auth',
        component: 'authorization-manager',
        permissionCount: this.permissions.size
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.savePermissions();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save permissions to storage
   */
  async savePermissions() {
    try {
      const permissionsObject = {};
      for (const [permissionId, permissionData] of this.permissions) {
        permissionsObject[permissionId] = permissionData;
      }
      
      await this.secureOps.writeFile(
        this.config.permissionsFile,
        JSON.stringify(permissionsObject, null, 2),
        'utf8'
      );
      
    } catch (error) {
      this.logger.error('Failed to save permissions', {
        subsystem: 'auth',
        component: 'authorization-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Load policies from storage
   */
  async loadPolicies() {
    try {
      const policiesData = await this.secureOps.readFile(this.config.policiesFile, 'utf8');
      const policies = JSON.parse(policiesData);
      
      for (const [policyId, policyData] of Object.entries(policies)) {
        this.policies.set(policyId, policyData);
      }
      
      this.stats.totalPolicies = this.policies.size;
      
      this.logger.debug('Policies loaded successfully', {
        subsystem: 'auth',
        component: 'authorization-manager',
        policyCount: this.policies.size
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.savePolicies();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save policies to storage
   */
  async savePolicies() {
    try {
      const policiesObject = {};
      for (const [policyId, policyData] of this.policies) {
        policiesObject[policyId] = policyData;
      }
      
      await this.secureOps.writeFile(
        this.config.policiesFile,
        JSON.stringify(policiesObject, null, 2),
        'utf8'
      );
      
    } catch (error) {
      this.logger.error('Failed to save policies', {
        subsystem: 'auth',
        component: 'authorization-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Get authorization statistics
   */
  getStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    
    return {
      uptime,
      totalRoles: this.stats.totalRoles,
      totalPermissions: this.stats.totalPermissions,
      totalPolicies: this.stats.totalPolicies,
      authorizationChecks: this.stats.authorizationChecks,
      accessGranted: this.stats.accessGranted,
      accessDenied: this.stats.accessDenied,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      policyViolations: this.stats.policyViolations,
      
      // Current state
      cachedPermissions: this.permissionCache.size,
      auditEntries: this.auditTrail.length,
      
      // Rates
      authorizationRate: this.stats.authorizationChecks > 0 ? 
        (this.stats.accessGranted / this.stats.authorizationChecks) * 100 : 0,
      cacheHitRate: (this.stats.cacheHits + this.stats.cacheMisses) > 0 ?
        (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100 : 0,
      
      // Recent audit entries
      recentDenials: this.auditTrail
        .filter(entry => !entry.granted)
        .slice(-10)
    };
  }

  /**
   * Health check for authorization system
   */
  async healthCheck() {
    try {
      const stats = this.getStats();
      const isHealthy = stats.authorizationChecks < 10000 && stats.accessDenied < 1000;
      
      return {
        healthy: isHealthy,
        reason: isHealthy ? 'Authorization system healthy' : 'High denial rate detected',
        details: {
          totalRoles: stats.totalRoles,
          authorizationChecks: stats.authorizationChecks,
          accessDenied: stats.accessDenied,
          authorizationRate: stats.authorizationRate
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
   * Shutdown authorization system
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down authorization system', {
        subsystem: 'auth',
        component: 'authorization-manager'
      });
      
      // Save current state
      await this.saveRoles();
      await this.savePermissions();
      await this.savePolicies();
      
      // Clear caches
      this.permissionCache.clear();
      if (this.rateLimits) {
        this.rateLimits.clear();
      }
      
    } catch (error) {
      this.logger.error('Authorization system shutdown failed', {
        subsystem: 'auth',
        component: 'authorization-manager'
      }, error);
    }
  }
}

export default AuthorizationManager;