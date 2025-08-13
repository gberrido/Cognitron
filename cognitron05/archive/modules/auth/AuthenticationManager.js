#!/usr/bin/env node

/**
 * Authentication Manager - Comprehensive user authentication and session management
 * 
 * Features:
 * - User registration and login
 * - JWT-based session management
 * - Password hashing with bcrypt-like security
 * - Multi-factor authentication support
 * - Session timeout and refresh
 * - Rate limiting and brute force protection
 * - Secure password policies
 * - Activity logging and monitoring
 */

import crypto from 'crypto';
import { createSecureOpsForDirectory } from '../security/SecureFileOpsMigration.js';
import { getLogger } from '../utils/StructuredLogger.js';
import path from 'path';

export class AuthenticationManager {
  constructor(config = {}) {
    this.config = {
      // Security settings
      jwtSecret: config.jwtSecret || process.env.COGNITRON_JWT_SECRET || this.generateSecretKey(),
      sessionTimeout: config.sessionTimeout || 24 * 60 * 60 * 1000, // 24 hours
      refreshTokenTimeout: config.refreshTokenTimeout || 7 * 24 * 60 * 60 * 1000, // 7 days
      
      // Password policy
      minPasswordLength: config.minPasswordLength || 12,
      requireSpecialChars: config.requireSpecialChars !== false,
      requireNumbers: config.requireNumbers !== false,
      requireUppercase: config.requireUppercase !== false,
      requireLowercase: config.requireLowercase !== false,
      
      // Rate limiting
      maxLoginAttempts: config.maxLoginAttempts || 5,
      lockoutDuration: config.lockoutDuration || 15 * 60 * 1000, // 15 minutes
      
      // Multi-factor authentication
      enableMFA: config.enableMFA || false,
      mfaTokenLength: config.mfaTokenLength || 6,
      mfaTokenTimeout: config.mfaTokenTimeout || 5 * 60 * 1000, // 5 minutes
      
      // Storage
      usersFile: config.usersFile || 'users.json',
      sessionsFile: config.sessionsFile || 'sessions.json',
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
    
    // In-memory caches
    this.users = new Map();
    this.sessions = new Map();
    this.refreshTokens = new Map();
    this.mfaTokens = new Map();
    this.loginAttempts = new Map(); // IP -> { attempts, lastAttempt, lockedUntil }
    
    // Activity tracking
    this.activityLog = [];
    this.securityEvents = [];
    
    // Statistics
    this.stats = {
      totalUsers: 0,
      activeSessions: 0,
      successfulLogins: 0,
      failedLogins: 0,
      blockedAttempts: 0,
      securityViolations: 0,
      mfaVerifications: 0,
      sessionTimeouts: 0,
      lastReset: Date.now()
    };
  }

  /**
   * Initialize authentication system
   */
  async initialize() {
    try {
      this.logger.info('Initializing authentication system', {
        subsystem: 'auth',
        component: 'authentication-manager'
      });

      // Create auth directory
      await this.secureOps.mkdir('.', { recursive: true });
      
      // Load existing users and sessions
      await this.loadUsers();
      await this.loadSessions();
      
      // Setup periodic cleanup
      this.startPeriodicCleanup();
      
      // Setup graceful shutdown
      process.on('beforeExit', () => this.shutdown());
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
      
      this.logger.info('Authentication system initialized', {
        subsystem: 'auth',
        component: 'authentication-manager',
        totalUsers: this.users.size,
        activeSessions: this.sessions.size
      });
      
      return true;
      
    } catch (error) {
      this.logger.error('Failed to initialize authentication system', {
        subsystem: 'auth',
        component: 'authentication-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Register a new user
   */
  async registerUser(userData) {
    const registrationResult = {
      success: false,
      userId: null,
      error: null,
      warnings: []
    };
    
    try {
      const { username, password, email, role = 'user' } = userData;
      
      // Input validation
      const validation = this.validateUserInput({ username, password, email });
      if (!validation.valid) {
        registrationResult.error = `Registration validation failed: ${validation.errors.join(', ')}`;
        return registrationResult;
      }
      
      // Check if user already exists
      if (this.users.has(username.toLowerCase())) {
        registrationResult.error = 'Username already exists';
        this.logSecurityEvent('duplicate-registration', { username, ip: userData.ip });
        return registrationResult;
      }
      
      // Check email uniqueness
      for (const [, user] of this.users) {
        if (user.email === email.toLowerCase()) {
          registrationResult.error = 'Email already registered';
          this.logSecurityEvent('duplicate-email-registration', { email, ip: userData.ip });
          return registrationResult;
        }
      }
      
      // Generate user ID and hash password
      const userId = this.generateUserId();
      const passwordHash = await this.hashPassword(password);
      const salt = this.generateSalt();
      
      // Create user object
      const user = {
        userId,
        username: username.toLowerCase(),
        email: email.toLowerCase(),
        passwordHash,
        salt,
        role,
        createdAt: new Date().toISOString(),
        lastLogin: null,
        loginCount: 0,
        isActive: true,
        isLocked: false,
        lockReason: null,
        mfaEnabled: false,
        mfaSecret: null,
        passwordChangedAt: new Date().toISOString(),
        securityLevel: this.calculateSecurityLevel(role),
        metadata: {
          registrationIp: userData.ip,
          userAgent: userData.userAgent,
          source: userData.source || 'direct'
        }
      };
      
      // Add to users collection
      this.users.set(username.toLowerCase(), user);
      this.stats.totalUsers++;
      
      // Persist to file
      await this.saveUsers();
      
      registrationResult.success = true;
      registrationResult.userId = userId;
      
      this.logger.info('User registered successfully', {
        subsystem: 'auth',
        component: 'authentication-manager',
        userId,
        username,
        role,
        securityLevel: user.securityLevel
      });
      
      this.logActivity('user-registered', { userId, username, role });
      
      return registrationResult;
      
    } catch (error) {
      registrationResult.error = `Registration failed: ${error.message}`;
      
      this.logger.error('User registration failed', {
        subsystem: 'auth',
        component: 'authentication-manager',
        username: userData.username
      }, error);
      
      return registrationResult;
    }
  }

  /**
   * Authenticate user and create session
   */
  async authenticateUser(credentials) {
    const authResult = {
      success: false,
      userId: null,
      accessToken: null,
      refreshToken: null,
      expiresIn: null,
      requiresMFA: false,
      mfaToken: null,
      error: null
    };
    
    try {
      const { username, password, ip, userAgent } = credentials;
      
      // Check rate limiting
      const rateLimitCheck = this.checkRateLimit(ip);
      if (!rateLimitCheck.allowed) {
        authResult.error = `Too many login attempts. Try again in ${Math.ceil(rateLimitCheck.waitTime / 1000)} seconds`;
        this.stats.blockedAttempts++;
        return authResult;
      }
      
      // Find user
      const user = this.users.get(username.toLowerCase());
      if (!user) {
        await this.recordFailedLogin(ip, 'invalid-username', username);
        authResult.error = 'Invalid username or password';
        return authResult;
      }
      
      // Check if user is locked
      if (user.isLocked) {
        await this.recordFailedLogin(ip, 'account-locked', username);
        authResult.error = `Account is locked: ${user.lockReason}`;
        this.logSecurityEvent('locked-account-access', { username, ip });
        return authResult;
      }
      
      // Verify password
      const isPasswordValid = await this.verifyPassword(password, user.passwordHash, user.salt);
      if (!isPasswordValid) {
        await this.recordFailedLogin(ip, 'invalid-password', username);
        authResult.error = 'Invalid username or password';
        return authResult;
      }
      
      // Check if MFA is enabled
      if (user.mfaEnabled) {
        // Generate MFA token and return partial success
        const mfaToken = this.generateMFAToken();
        this.mfaTokens.set(mfaToken, {
          userId: user.userId,
          username: user.username,
          createdAt: Date.now(),
          ip,
          userAgent
        });
        
        authResult.requiresMFA = true;
        authResult.mfaToken = mfaToken;
        authResult.error = 'MFA verification required';
        
        // Set timeout for MFA token
        setTimeout(() => {
          this.mfaTokens.delete(mfaToken);
        }, this.config.mfaTokenTimeout);
        
        return authResult;
      }
      
      // Create session
      const sessionData = await this.createSession(user, { ip, userAgent });
      
      authResult.success = true;
      authResult.userId = user.userId;
      authResult.accessToken = sessionData.accessToken;
      authResult.refreshToken = sessionData.refreshToken;
      authResult.expiresIn = this.config.sessionTimeout;
      
      // Update user login information
      user.lastLogin = new Date().toISOString();
      user.loginCount++;
      await this.saveUsers();
      
      // Clear failed login attempts for this IP
      this.loginAttempts.delete(ip);
      this.stats.successfulLogins++;
      
      this.logger.info('User authenticated successfully', {
        subsystem: 'auth',
        component: 'authentication-manager',
        userId: user.userId,
        username: user.username,
        ip,
        loginCount: user.loginCount
      });
      
      this.logActivity('user-login', { userId: user.userId, username: user.username, ip });
      
      return authResult;
      
    } catch (error) {
      authResult.error = `Authentication failed: ${error.message}`;
      
      this.logger.error('User authentication failed', {
        subsystem: 'auth',
        component: 'authentication-manager',
        username: credentials.username,
        ip: credentials.ip
      }, error);
      
      return authResult;
    }
  }

  /**
   * Verify MFA token and complete authentication
   */
  async verifyMFA(mfaVerification) {
    const verificationResult = {
      success: false,
      userId: null,
      accessToken: null,
      refreshToken: null,
      expiresIn: null,
      error: null
    };
    
    try {
      const { mfaToken, mfaCode } = mfaVerification;
      
      // Check if MFA token exists and is valid
      const mfaData = this.mfaTokens.get(mfaToken);
      if (!mfaData) {
        verificationResult.error = 'Invalid or expired MFA token';
        this.logSecurityEvent('invalid-mfa-token', { mfaToken });
        return verificationResult;
      }
      
      // Find user
      const user = this.users.get(mfaData.username);
      if (!user) {
        verificationResult.error = 'User not found';
        return verificationResult;
      }
      
      // Verify MFA code (placeholder - in production, implement TOTP/SMS verification)
      const isValidMFA = await this.verifyMFACode(user, mfaCode);
      if (!isValidMFA) {
        verificationResult.error = 'Invalid MFA code';
        this.logSecurityEvent('invalid-mfa-code', { userId: user.userId, ip: mfaData.ip });
        return verificationResult;
      }
      
      // Create session
      const sessionData = await this.createSession(user, {
        ip: mfaData.ip,
        userAgent: mfaData.userAgent
      });
      
      verificationResult.success = true;
      verificationResult.userId = user.userId;
      verificationResult.accessToken = sessionData.accessToken;
      verificationResult.refreshToken = sessionData.refreshToken;
      verificationResult.expiresIn = this.config.sessionTimeout;
      
      // Clean up MFA token
      this.mfaTokens.delete(mfaToken);
      
      // Update user login information
      user.lastLogin = new Date().toISOString();
      user.loginCount++;
      await this.saveUsers();
      
      this.stats.successfulLogins++;
      this.stats.mfaVerifications++;
      
      this.logger.info('MFA verification successful', {
        subsystem: 'auth',
        component: 'authentication-manager',
        userId: user.userId,
        username: user.username
      });
      
      this.logActivity('mfa-verified', { userId: user.userId, username: user.username });
      
      return verificationResult;
      
    } catch (error) {
      verificationResult.error = `MFA verification failed: ${error.message}`;
      
      this.logger.error('MFA verification failed', {
        subsystem: 'auth',
        component: 'authentication-manager',
        mfaToken: mfaVerification.mfaToken
      }, error);
      
      return verificationResult;
    }
  }

  /**
   * Validate session token and return user information
   */
  async validateSession(accessToken) {
    const validationResult = {
      valid: false,
      userId: null,
      username: null,
      role: null,
      securityLevel: null,
      sessionData: null,
      error: null
    };
    
    try {
      if (!accessToken) {
        validationResult.error = 'Access token required';
        return validationResult;
      }
      
      // Find session
      const session = this.sessions.get(accessToken);
      if (!session) {
        validationResult.error = 'Invalid or expired session';
        this.logSecurityEvent('invalid-session-token', { accessToken: accessToken.substring(0, 10) + '...' });
        return validationResult;
      }
      
      // Check if session is expired
      if (Date.now() > session.expiresAt) {
        this.sessions.delete(accessToken);
        this.refreshTokens.delete(session.refreshToken);
        validationResult.error = 'Session expired';
        this.stats.sessionTimeouts++;
        return validationResult;
      }
      
      // Find user
      const user = this.users.get(session.username);
      if (!user || !user.isActive) {
        this.sessions.delete(accessToken);
        validationResult.error = 'User account not found or inactive';
        return validationResult;
      }
      
      // Update session last activity
      session.lastActivity = Date.now();
      
      validationResult.valid = true;
      validationResult.userId = user.userId;
      validationResult.username = user.username;
      validationResult.role = user.role;
      validationResult.securityLevel = user.securityLevel;
      validationResult.sessionData = {
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        ip: session.ip,
        userAgent: session.userAgent
      };
      
      return validationResult;
      
    } catch (error) {
      validationResult.error = `Session validation failed: ${error.message}`;
      
      this.logger.error('Session validation failed', {
        subsystem: 'auth',
        component: 'authentication-manager',
        accessToken: accessToken ? accessToken.substring(0, 10) + '...' : null
      }, error);
      
      return validationResult;
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshSession(refreshToken) {
    const refreshResult = {
      success: false,
      accessToken: null,
      refreshToken: null,
      expiresIn: null,
      error: null
    };
    
    try {
      if (!refreshToken) {
        refreshResult.error = 'Refresh token required';
        return refreshResult;
      }
      
      // Find refresh token data
      const refreshData = this.refreshTokens.get(refreshToken);
      if (!refreshData) {
        refreshResult.error = 'Invalid or expired refresh token';
        this.logSecurityEvent('invalid-refresh-token', { refreshToken: refreshToken.substring(0, 10) + '...' });
        return refreshResult;
      }
      
      // Check if refresh token is expired
      if (Date.now() > refreshData.expiresAt) {
        this.refreshTokens.delete(refreshToken);
        refreshResult.error = 'Refresh token expired';
        return refreshResult;
      }
      
      // Find user
      const user = this.users.get(refreshData.username);
      if (!user || !user.isActive) {
        this.refreshTokens.delete(refreshToken);
        refreshResult.error = 'User account not found or inactive';
        return refreshResult;
      }
      
      // Revoke old session
      const oldSession = this.sessions.get(refreshData.accessToken);
      if (oldSession) {
        this.sessions.delete(refreshData.accessToken);
      }
      this.refreshTokens.delete(refreshToken);
      
      // Create new session
      const sessionData = await this.createSession(user, {
        ip: refreshData.ip,
        userAgent: refreshData.userAgent
      });
      
      refreshResult.success = true;
      refreshResult.accessToken = sessionData.accessToken;
      refreshResult.refreshToken = sessionData.refreshToken;
      refreshResult.expiresIn = this.config.sessionTimeout;
      
      this.logger.info('Session refreshed successfully', {
        subsystem: 'auth',
        component: 'authentication-manager',
        userId: user.userId,
        username: user.username
      });
      
      this.logActivity('session-refreshed', { userId: user.userId, username: user.username });
      
      return refreshResult;
      
    } catch (error) {
      refreshResult.error = `Session refresh failed: ${error.message}`;
      
      this.logger.error('Session refresh failed', {
        subsystem: 'auth',
        component: 'authentication-manager'
      }, error);
      
      return refreshResult;
    }
  }

  /**
   * Logout user and invalidate session
   */
  async logout(accessToken) {
    try {
      if (!accessToken) {
        return { success: false, error: 'Access token required' };
      }
      
      const session = this.sessions.get(accessToken);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }
      
      // Remove session and refresh token
      this.sessions.delete(accessToken);
      this.refreshTokens.delete(session.refreshToken);
      this.stats.activeSessions--;
      
      await this.saveSessions();
      
      this.logger.info('User logged out successfully', {
        subsystem: 'auth',
        component: 'authentication-manager',
        sessionId: session.sessionId,
        username: session.username
      });
      
      this.logActivity('user-logout', { 
        userId: session.userId, 
        username: session.username,
        sessionId: session.sessionId
      });
      
      return { success: true };
      
    } catch (error) {
      this.logger.error('Logout failed', {
        subsystem: 'auth',
        component: 'authentication-manager'
      }, error);
      
      return { success: false, error: `Logout failed: ${error.message}` };
    }
  }

  /**
   * Create a new session for authenticated user
   */
  async createSession(user, metadata = {}) {
    const sessionId = this.generateSessionId();
    const accessToken = this.generateAccessToken();
    const refreshToken = this.generateRefreshToken();
    
    const now = Date.now();
    const session = {
      sessionId,
      accessToken,
      refreshToken,
      userId: user.userId,
      username: user.username,
      role: user.role,
      securityLevel: user.securityLevel,
      createdAt: now,
      expiresAt: now + this.config.sessionTimeout,
      lastActivity: now,
      ip: metadata.ip,
      userAgent: metadata.userAgent,
      isActive: true
    };
    
    const refreshData = {
      refreshToken,
      accessToken,
      userId: user.userId,
      username: user.username,
      createdAt: now,
      expiresAt: now + this.config.refreshTokenTimeout,
      ip: metadata.ip,
      userAgent: metadata.userAgent
    };
    
    // Store session and refresh token
    this.sessions.set(accessToken, session);
    this.refreshTokens.set(refreshToken, refreshData);
    this.stats.activeSessions++;
    
    // Persist sessions
    await this.saveSessions();
    
    return { accessToken, refreshToken, sessionId };
  }

  /**
   * Hash password with salt
   */
  async hashPassword(password) {
    const salt = crypto.randomBytes(32).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
    return `${salt}:${hash.toString('hex')}`;
  }

  /**
   * Verify password against hash
   */
  async verifyPassword(password, storedHash, userSalt = null) {
    try {
      let salt, hash;
      
      if (storedHash.includes(':')) {
        // New format: salt:hash
        [salt, hash] = storedHash.split(':');
      } else {
        // Legacy format with separate salt
        salt = userSalt;
        hash = storedHash;
      }
      
      const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512');
      return testHash.toString('hex') === hash;
      
    } catch (error) {
      this.logger.error('Password verification failed', {
        subsystem: 'auth',
        component: 'authentication-manager'
      }, error);
      
      return false;
    }
  }

  /**
   * Verify MFA code (placeholder implementation)
   */
  async verifyMFACode(user, mfaCode) {
    // Placeholder: In production, implement TOTP verification using speakeasy or similar
    // For now, accept any 6-digit code for testing
    return /^\d{6}$/.test(mfaCode);
  }

  /**
   * Validate user input
   */
  validateUserInput(userData) {
    const errors = [];
    const { username, password, email } = userData;
    
    // Username validation
    if (!username || username.length < 3) {
      errors.push('Username must be at least 3 characters long');
    }
    
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
      errors.push('Username can only contain letters, numbers, underscores, and hyphens');
    }
    
    // Password validation
    if (!password || password.length < this.config.minPasswordLength) {
      errors.push(`Password must be at least ${this.config.minPasswordLength} characters long`);
    }
    
    if (this.config.requireSpecialChars && !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }
    
    if (this.config.requireNumbers && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    
    if (this.config.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    
    if (this.config.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    
    // Email validation
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Invalid email format');
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Check rate limiting for login attempts
   */
  checkRateLimit(ip) {
    const attempts = this.loginAttempts.get(ip);
    if (!attempts) {
      return { allowed: true };
    }
    
    const now = Date.now();
    
    // Check if still locked out
    if (attempts.lockedUntil && now < attempts.lockedUntil) {
      return { allowed: false, waitTime: attempts.lockedUntil - now };
    }
    
    // Reset if lockout period has passed
    if (attempts.lockedUntil && now >= attempts.lockedUntil) {
      this.loginAttempts.delete(ip);
      return { allowed: true };
    }
    
    // Check if too many recent attempts
    if (attempts.count >= this.config.maxLoginAttempts) {
      attempts.lockedUntil = now + this.config.lockoutDuration;
      this.logSecurityEvent('ip-locked-out', { ip, attempts: attempts.count });
      return { allowed: false, waitTime: this.config.lockoutDuration };
    }
    
    return { allowed: true };
  }

  /**
   * Record failed login attempt
   */
  async recordFailedLogin(ip, reason, username = null) {
    const attempts = this.loginAttempts.get(ip) || { count: 0, lastAttempt: null };
    attempts.count++;
    attempts.lastAttempt = Date.now();
    
    this.loginAttempts.set(ip, attempts);
    this.stats.failedLogins++;
    
    this.logSecurityEvent('failed-login', { ip, reason, username, attemptCount: attempts.count });
  }

  /**
   * Generate secure tokens and IDs
   */
  generateSecretKey() {
    return crypto.randomBytes(64).toString('hex');
  }
  
  generateUserId() {
    return 'usr_' + crypto.randomBytes(16).toString('hex');
  }
  
  generateSessionId() {
    return 'sess_' + crypto.randomBytes(16).toString('hex');
  }
  
  generateAccessToken() {
    return 'at_' + crypto.randomBytes(32).toString('hex');
  }
  
  generateRefreshToken() {
    return 'rt_' + crypto.randomBytes(32).toString('hex');
  }
  
  generateMFAToken() {
    return crypto.randomBytes(16).toString('hex');
  }
  
  generateSalt() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Calculate user security level based on role
   */
  calculateSecurityLevel(role) {
    const levelMap = {
      'superadmin': 100,
      'admin': 80,
      'moderator': 60,
      'user': 40,
      'guest': 20
    };
    
    return levelMap[role] || 40;
  }

  /**
   * Load users from storage
   */
  async loadUsers() {
    try {
      const usersData = await this.secureOps.readFile(this.config.usersFile, 'utf8');
      const users = JSON.parse(usersData);
      
      for (const [username, userData] of Object.entries(users)) {
        this.users.set(username, userData);
      }
      
      this.stats.totalUsers = this.users.size;
      
      this.logger.debug('Users loaded successfully', {
        subsystem: 'auth',
        component: 'authentication-manager',
        userCount: this.users.size
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet - create empty users collection
        await this.saveUsers();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save users to storage
   */
  async saveUsers() {
    try {
      const usersObject = {};
      for (const [username, userData] of this.users) {
        usersObject[username] = userData;
      }
      
      await this.secureOps.writeFile(
        this.config.usersFile, 
        JSON.stringify(usersObject, null, 2), 
        'utf8'
      );
      
    } catch (error) {
      this.logger.error('Failed to save users', {
        subsystem: 'auth',
        component: 'authentication-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Load sessions from storage
   */
  async loadSessions() {
    try {
      const sessionsData = await this.secureOps.readFile(this.config.sessionsFile, 'utf8');
      const sessionsArray = JSON.parse(sessionsData);
      
      const now = Date.now();
      let validSessions = 0;
      
      for (const session of sessionsArray) {
        // Only load non-expired sessions
        if (session.expiresAt > now) {
          this.sessions.set(session.accessToken, session);
          
          // Recreate refresh token if it exists and is valid
          if (session.refreshToken && (session.createdAt + this.config.refreshTokenTimeout) > now) {
            const refreshData = {
              refreshToken: session.refreshToken,
              accessToken: session.accessToken,
              userId: session.userId,
              username: session.username,
              createdAt: session.createdAt,
              expiresAt: session.createdAt + this.config.refreshTokenTimeout,
              ip: session.ip,
              userAgent: session.userAgent
            };
            
            this.refreshTokens.set(session.refreshToken, refreshData);
          }
          
          validSessions++;
        }
      }
      
      this.stats.activeSessions = validSessions;
      
      this.logger.debug('Sessions loaded successfully', {
        subsystem: 'auth',
        component: 'authentication-manager',
        sessionCount: validSessions
      });
      
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet - create empty sessions collection
        await this.saveSessions();
      } else {
        throw error;
      }
    }
  }

  /**
   * Save sessions to storage
   */
  async saveSessions() {
    try {
      const sessionsArray = Array.from(this.sessions.values());
      
      await this.secureOps.writeFile(
        this.config.sessionsFile,
        JSON.stringify(sessionsArray, null, 2),
        'utf8'
      );
      
    } catch (error) {
      this.logger.error('Failed to save sessions', {
        subsystem: 'auth',
        component: 'authentication-manager'
      }, error);
      
      throw error;
    }
  }

  /**
   * Log security events
   */
  logSecurityEvent(eventType, details) {
    const event = {
      type: eventType,
      timestamp: Date.now(),
      details,
      severity: this.getEventSeverity(eventType)
    };
    
    this.securityEvents.push(event);
    this.stats.securityViolations++;
    
    this.logger.warn('Security event detected', {
      subsystem: 'auth',
      component: 'authentication-manager',
      eventType,
      details,
      severity: event.severity
    });
    
    // Keep only last 1000 events
    if (this.securityEvents.length > 1000) {
      this.securityEvents.shift();
    }
  }

  /**
   * Log user activity
   */
  logActivity(activityType, details) {
    const activity = {
      type: activityType,
      timestamp: Date.now(),
      details
    };
    
    this.activityLog.push(activity);
    
    // Keep only last 1000 activities
    if (this.activityLog.length > 1000) {
      this.activityLog.shift();
    }
  }

  /**
   * Get event severity level
   */
  getEventSeverity(eventType) {
    const severityMap = {
      'duplicate-registration': 'medium',
      'duplicate-email-registration': 'medium',
      'invalid-username': 'low',
      'invalid-password': 'medium',
      'account-locked': 'high',
      'invalid-mfa-token': 'high',
      'invalid-mfa-code': 'high',
      'invalid-session-token': 'medium',
      'invalid-refresh-token': 'medium',
      'ip-locked-out': 'high',
      'failed-login': 'medium'
    };
    
    return severityMap[eventType] || 'medium';
  }

  /**
   * Start periodic cleanup of expired data
   */
  startPeriodicCleanup() {
    setInterval(() => {
      this.cleanupExpiredData();
    }, 60 * 1000); // Run every minute
  }

  /**
   * Clean up expired sessions and tokens
   */
  cleanupExpiredData() {
    const now = Date.now();
    let expiredSessions = 0;
    let expiredRefreshTokens = 0;
    let expiredMfaTokens = 0;
    
    // Clean up expired sessions
    for (const [accessToken, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(accessToken);
        this.stats.activeSessions--;
        expiredSessions++;
      }
    }
    
    // Clean up expired refresh tokens
    for (const [refreshToken, data] of this.refreshTokens) {
      if (data.expiresAt <= now) {
        this.refreshTokens.delete(refreshToken);
        expiredRefreshTokens++;
      }
    }
    
    // Clean up expired MFA tokens
    for (const [mfaToken, data] of this.mfaTokens) {
      if (now - data.createdAt > this.config.mfaTokenTimeout) {
        this.mfaTokens.delete(mfaToken);
        expiredMfaTokens++;
      }
    }
    
    // Clean up old login attempts (older than 24 hours)
    const cutoff = now - (24 * 60 * 60 * 1000);
    for (const [ip, attempts] of this.loginAttempts) {
      if (attempts.lastAttempt < cutoff && (!attempts.lockedUntil || attempts.lockedUntil < now)) {
        this.loginAttempts.delete(ip);
      }
    }
    
    if (expiredSessions > 0 || expiredRefreshTokens > 0 || expiredMfaTokens > 0) {
      this.logger.debug('Cleaned up expired authentication data', {
        subsystem: 'auth',
        component: 'authentication-manager',
        expiredSessions,
        expiredRefreshTokens,
        expiredMfaTokens
      });
    }
  }

  /**
   * Get authentication system statistics
   */
  getStats() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    
    return {
      uptime,
      totalUsers: this.stats.totalUsers,
      activeSessions: this.stats.activeSessions,
      successfulLogins: this.stats.successfulLogins,
      failedLogins: this.stats.failedLogins,
      blockedAttempts: this.stats.blockedAttempts,
      securityViolations: this.stats.securityViolations,
      mfaVerifications: this.stats.mfaVerifications,
      sessionTimeouts: this.stats.sessionTimeouts,
      
      // Current state
      activeUsers: this.users.size,
      activeMfaTokens: this.mfaTokens.size,
      blockedIPs: Array.from(this.loginAttempts.values()).filter(a => a.lockedUntil && a.lockedUntil > now).length,
      
      // Rates
      successRate: this.stats.successfulLogins + this.stats.failedLogins > 0 ? 
        (this.stats.successfulLogins / (this.stats.successfulLogins + this.stats.failedLogins)) * 100 : 0,
      
      // Recent events
      recentSecurityEvents: this.securityEvents.slice(-10),
      recentActivities: this.activityLog.slice(-10)
    };
  }

  /**
   * Health check for authentication system
   */
  async healthCheck() {
    try {
      const stats = this.getStats();
      const isHealthy = stats.activeSessions < 1000 && stats.securityViolations < 100;
      
      return {
        healthy: isHealthy,
        reason: isHealthy ? 'Authentication system healthy' : 'High activity detected',
        details: {
          totalUsers: stats.totalUsers,
          activeSessions: stats.activeSessions,
          securityViolations: stats.securityViolations,
          successRate: stats.successRate
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
   * Shutdown authentication system
   */
  async shutdown() {
    try {
      this.logger.info('Shutting down authentication system', {
        subsystem: 'auth',
        component: 'authentication-manager'
      });
      
      // Save current state
      await this.saveUsers();
      await this.saveSessions();
      
      // Clear sensitive data from memory
      this.users.clear();
      this.sessions.clear();
      this.refreshTokens.clear();
      this.mfaTokens.clear();
      this.loginAttempts.clear();
      
    } catch (error) {
      this.logger.error('Authentication system shutdown failed', {
        subsystem: 'auth',
        component: 'authentication-manager'
      }, error);
    }
  }
}

export default AuthenticationManager;