#!/usr/bin/env node

/**
 * Authentication Module for Cognitron SDK
 * Handles authentication, token management, and user sessions
 */

import axios from 'axios';

export class AuthModule {
  constructor(config = {}) {
    this.config = config;
    this.baseUrl = config.serverUrl || 'http://localhost:8000';
    this.apiUrl = `${this.baseUrl}/api/v1/auth`;
    this.token = null;
    this.userInfo = null;
    this.client = null;
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    this.baseUrl = this.config.serverUrl;
    this.apiUrl = `${this.baseUrl}/api/v1/auth`;
    
    // Setup axios client
    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: this.config.timeout || 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Add request interceptor for auth token
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });
    
    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const data = error.response?.data;
        const message = data?.detail || data?.error || error.message || 'Authentication request failed';
        if (error.response?.status === 401) {
          this.token = null;
          this.userInfo = null;
        }
        const wrapped = new Error(message, { cause: error });
        if (data) wrapped.data = data;
        throw wrapped;
      }
    );
  }

  setToken(token) {
    this.token = token;
  }

  getToken() {
    return this.token;
  }

  /**
   * Authenticate with username/password or validate existing token
   * @param {Object} credentials - Login credentials or options
   * @param {boolean} force - Force new login even if token exists
   * @returns {Promise<Object>} Authentication result
   */
  async authenticate(credentials = {}, force = false) {
    try {
      // Try to use existing token if available and not forcing login
      if (!force && this.token) {
        try {
          const userInfo = await this.validateToken(this.token);
          return {
            success: true,
            token: this.token,
            user: userInfo,
            type: 'existing_token'
          };
        } catch (error) {
          // Token invalid, continue with login
          this.token = null;
          this.userInfo = null;
        }
      }

      // Check for saved token in config manager if available
      if (!force && this.config.configManager) {
        try {
          const savedToken = await this.config.configManager.getSecure('accessToken');
          if (savedToken) {
            const userInfo = await this.validateToken(savedToken);
            this.token = savedToken;
            this.userInfo = userInfo;
            return {
              success: true,
              token: savedToken,
              user: userInfo,
              type: 'saved_token'
            };
          }
        } catch (error) {
          // Saved token invalid, continue with login
        }
      }

      // Perform login with credentials
      const { username, password } = credentials;
      if (!username || !password) {
        throw new Error('Username and password are required for login');
      }

      const response = await this.client.post('/login', {
        username,
        password
      });
      
      this.token = response.data.access_token;
      this.userInfo = response.data.user || { username };
      
      // Save token if config manager available
      if (this.config.configManager) {
        try {
          await this.config.configManager.setSecure('accessToken', this.token);
        } catch (error) {
          // Non-fatal error, just log it
          if (this.config.debug) {
            console.warn('Could not save token:', error.message);
          }
        }
      }
      
      return {
        success: true,
        token: this.token,
        user: this.userInfo,
        type: 'new_login'
      };
      
    } catch (error) {
      this.token = null;
      this.userInfo = null;
      const wrapped = new Error(`Authentication failed: ${error.message}`, { cause: error });
      if (error.data) wrapped.data = error.data;
      throw wrapped;
    }
  }

  /**
   * Login with username and password
   * @param {string} username - Username
   * @param {string} password - Password
   * @returns {Promise<Object>} Login response
   */
  async login(username, password) {
    try {
      const response = await this.client.post('/login', {
        username,
        password
      });
      
      this.token = response.data.access_token;
      this.userInfo = response.data.user || { username };
      
      // Save token if config manager available
      if (this.config.configManager) {
        try {
          await this.config.configManager.setSecure('accessToken', this.token);
        } catch (error) {
          if (this.config.debug) {
            console.warn('Could not save token:', error.message);
          }
        }
      }
      
      return {
        access_token: this.token,
        user: this.userInfo,
        ...response.data
      };
    } catch (error) {
      this.token = null;
      this.userInfo = null;
      const wrapped = new Error(`Login failed: ${error.message}`, { cause: error });
      if (error.data) wrapped.data = error.data;
      throw wrapped;
    }
  }

  /**
   * Logout from the server
   * @returns {Promise<boolean>} Success status
   */
  async logout() {
    try {
      if (this.token) {
        // Attempt server logout
        try {
          await this.client.post('/logout');
        } catch (error) {
          // Non-fatal - clear local state anyway
          if (this.config.debug) {
            console.warn('Server logout failed:', error.message);
          }
        }
      }
      
      // Always clear local state
      this.token = null;
      this.userInfo = null;
      
      // Remove saved token
      if (this.config.configManager) {
        try {
          await this.config.configManager.deleteSecure('accessToken');
        } catch (error) {
          if (this.config.debug) {
            console.warn('Could not remove saved token:', error.message);
          }
        }
      }
      
      return true;
    } catch (error) {
      // Always clear local state, even on error
      this.token = null;
      this.userInfo = null;
      
      // Don't throw error - logout should always succeed locally
      if (this.config.debug) {
        console.warn('Logout completed with warnings:', error.message);
      }
      return true;
    }
  }

  /**
   * Get current user information
   * @returns {Promise<Object>} User information
   */
  async getUserInfo() {
    if (!this.token) {
      throw new Error('Not authenticated');
    }
    
    try {
      const response = await this.client.get('/me');
      this.userInfo = response.data;
      return this.userInfo;
    } catch (error) {
      if (error.message.includes('401') || error.message.includes('Unauthorized')) {
        this.token = null;
        this.userInfo = null;
      }
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  /**
   * Validate a token and get user info
   * @param {string} token - Token to validate
   * @returns {Promise<Object>} User information if valid
   */
  async validateToken(token) {
    try {
      const originalToken = this.token;
      this.token = token;
      
      const userInfo = await this.getUserInfo();
      return userInfo;
    } catch (error) {
      // Restore original token on failure
      this.token = originalToken;
      const wrapped = new Error(`Token validation failed: ${error.message}`, { cause: error });
      if (error.data) wrapped.data = error.data;
      throw wrapped;
    }
  }

  /**
   * Refresh the current token
   * @returns {Promise<Object>} New token information
   */
  async refreshToken() {
    if (!this.token) {
      throw new Error('No token to refresh');
    }
    
    try {
      const response = await this.client.post('/refresh');
      this.token = response.data.access_token;
      
      // Save new token
      if (this.config.configManager) {
        try {
          await this.config.configManager.setSecure('accessToken', this.token);
        } catch (error) {
          if (this.config.debug) {
            console.warn('Could not save refreshed token:', error.message);
          }
        }
      }
      
      return response.data;
    } catch (error) {
      this.token = null;
      this.userInfo = null;
      const wrapped = new Error(`Token refresh failed: ${error.message}`, { cause: error });
      if (error.data) wrapped.data = error.data;
      throw wrapped;
    }
  }

  /**
   * Check if currently authenticated
   * @returns {boolean} Authentication status
   */
  isAuthenticated() {
    return !!this.token;
  }

  /**
   * Get current user info (cached)
   * @returns {Object|null} User information or null
   */
  getCurrentUser() {
    return this.userInfo;
  }
}
