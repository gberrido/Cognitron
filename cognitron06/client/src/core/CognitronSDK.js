#!/usr/bin/env node

/**
 * Cognitron SDK - Main entry point for programmatic access
 * Provides a unified interface to Cognitron AI Assistant capabilities
 */

import { AuthModule } from './auth/AuthModule.js';
import { ChatModule } from './chat/ChatModule.js';
import { MemoryModule } from './memory/MemoryModule.js';
import { ModelsModule } from './models/ModelsModule.js';
import { ConfigModule } from './config/ConfigModule.js';

export class CognitronSDK {
  constructor(options = {}) {
    // Configuration with defaults
    this.config = {
      serverUrl: options.serverUrl || 'http://localhost:8000',
      timeout: options.timeout || 30000,
      enableStreaming: options.enableStreaming !== false,
      autoLogin: options.autoLogin !== false,
      credentials: options.credentials || { username: 'demo', password: 'demo123' },
      debug: options.debug || false,
      ...options
    };

    // Initialize configuration manager
    this.configManager = new ConfigModule(this.config);
    
    // Initialize core modules
    this.auth = new AuthModule(this.config);
    this.chat = new ChatModule(this.config);
    this.memory = new MemoryModule(this.config);
    this.models = new ModelsModule(this.config);
    
    // Internal state
    this._initialized = false;
    this._authenticated = false;
  }

  /**
   * Initialize the SDK - call this before using other methods
   * @param {Object} options - Initialization options
   * @returns {Promise<boolean>} Success status
   */
  async initialize(options = {}) {
    if (this._initialized) return true;
    
    try {
      // Load configuration
      await this.configManager.load();
      
      // Update config if server URL provided
      if (options.serverUrl) {
        this.config.serverUrl = options.serverUrl;
      }
      
      // Initialize modules with config
      await this.auth.initialize(this.config);
      await this.chat.initialize(this.config);
      await this.memory.initialize(this.config);
      await this.models.initialize(this.config);
      
      this._initialized = true;
      
      if (this.config.debug) {
        console.log('🔧 Cognitron SDK initialized', this.config);
      }
      
      return true;
    } catch (error) {
      if (this.config.debug) {
        console.error('❌ SDK initialization failed:', error);
      }
      throw new Error(`Failed to initialize Cognitron SDK: ${error.message}`);
    }
  }

  /**
   * Authenticate with the server
   * @param {Object} credentials - Login credentials
   * @param {boolean} force - Force new login even if token exists
   * @returns {Promise<Object>} User information
   */
  async authenticate(credentials = null, force = false) {
    this._ensureInitialized();
    
    try {
      const creds = credentials || this.config.credentials;
      const result = await this.auth.authenticate(creds, force);
      
      if (result.success) {
        // Set tokens for all modules
        const token = result.token;
        this.chat.setToken(token);
        this.memory.setToken(token);
        this.models.setToken(token);
        
        this._authenticated = true;
        
        if (this.config.debug) {
          console.log('✅ Authentication successful:', result.user);
        }
      }
      
      return result;
    } catch (error) {
      this._authenticated = false;
      if (this.config.debug) {
        console.error('❌ Authentication failed:', error);
      }
      throw error;
    }
  }

  /**
   * Send a chat message
   * @param {string} message - The message to send
   * @param {Object} options - Chat options
   * @returns {Promise<Object>} Response from AI
   */
  async sendMessage(message, options = {}) {
    this._ensureAuthenticated();
    
    try {
      const response = await this.chat.sendMessage(message, {
        stream: options.stream || false,
        model: options.model,
        ...options
      });
      
      return response;
    } catch (error) {
      if (this.config.debug) {
        console.error('❌ Chat message failed:', error);
      }
      throw error;
    }
  }

  /**
   * Stream a chat conversation
   * @param {string} message - The message to send
   * @param {Object} callbacks - Streaming callbacks
   * @returns {Promise<string>} Complete response
   */
  async streamChat(message, callbacks = {}) {
    this._ensureAuthenticated();
    
    try {
      return await this.chat.streamChat(message, callbacks);
    } catch (error) {
      if (this.config.debug) {
        console.error('❌ Chat streaming failed:', error);
      }
      throw error;
    }
  }

  /**
   * Get memory status
   * @returns {Promise<Object>} Memory system status
   */
  async getMemoryStatus() {
    this._ensureAuthenticated();
    return await this.memory.getStatus();
  }

  /**
   * Search conversation history
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Search results
   */
  async searchMemory(query, options = {}) {
    this._ensureAuthenticated();
    return await this.memory.searchMemory(query, options);
  }

  /**
   * Get available models
   * @returns {Promise<Object>} Available models
   */
  async getAvailableModels() {
    this._ensureAuthenticated();
    return await this.models.getAvailableModels();
  }

  /**
   * Switch to a different model
   * @param {string} modelName - Name of model to switch to
   * @returns {Promise<Object>} Switch result
   */
  async switchModel(modelName) {
    this._ensureAuthenticated();
    return await this.models.switchModel(modelName);
  }

  /**
   * Get current model information
   * @returns {Promise<Object>} Current model info
   */
  async getCurrentModel() {
    this._ensureAuthenticated();
    return await this.models.getCurrentModel();
  }

  /**
   * Get current user information
   * @returns {Promise<Object>} Current user info
   */
  async getCurrentUser() {
    this._ensureAuthenticated();
    return await this.auth.getUserInfo();
  }

  /**
   * Get system status
   * @returns {Promise<Object>} System status information
   */
  async getSystemStatus() {
    try {
      const status = {
        sdk: {
          initialized: this._initialized,
          authenticated: this._authenticated,
          config: this.config
        }
      };

      if (this._authenticated) {
        try {
          status.memory = await this.memory.getStatus();
        } catch (error) {
          status.memory = { error: error.message };
        }

        try {
          status.models = await this.models.getCurrentModel();
        } catch (error) {
          status.models = { error: error.message };
        }

        try {
          status.user = await this.auth.getUserInfo();
        } catch (error) {
          status.user = { error: error.message };
        }
      }

      return status;
    } catch (error) {
      throw new Error(`Failed to get system status: ${error.message}`);
    }
  }

  /**
   * Logout and clear authentication
   * @returns {Promise<boolean>} Success status
   */
  async logout() {
    try {
      // Always attempt logout, even if not marked as authenticated
      await this.auth.logout();
      
      // Clear tokens from all modules
      this.chat.setToken(null);
      this.memory.setToken(null);
      this.models.setToken(null);
      
      // Update SDK state
      this._authenticated = false;
      
      if (this.config.debug) {
        console.log('✅ Logout successful');
      }
      
      return true;
    } catch (error) {
      // Even if logout fails, clear local state
      this.chat.setToken(null);
      this.memory.setToken(null);
      this.models.setToken(null);
      this._authenticated = false;
      
      if (this.config.debug) {
        console.warn('⚠️ Logout completed with warnings:', error.message);
      }
      
      // Don't throw - logout should always succeed locally
      return true;
    }
  }

  /**
   * Close SDK and cleanup resources
   */
  async close() {
    try {
      if (this._authenticated) {
        await this.logout();
      }
      
      // Close WebSocket connections if any
      if (this.chat && this.chat.closeWebSocket) {
        this.chat.closeWebSocket();
      }
      
      this._initialized = false;
      
      if (this.config.debug) {
        console.log('🔒 Cognitron SDK closed');
      }
    } catch (error) {
      if (this.config.debug) {
        console.error('❌ SDK close failed:', error);
      }
    }
  }

  // Helper methods
  _ensureInitialized() {
    if (!this._initialized) {
      throw new Error('SDK not initialized. Call initialize() first.');
    }
  }

  _ensureAuthenticated() {
    this._ensureInitialized();
    if (!this._authenticated) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }
  }

  // Getters for status
  get isInitialized() {
    return this._initialized;
  }

  get isAuthenticated() {
    return this._authenticated;
  }

  get version() {
    return '1.0.0';
  }
}

// Export for convenience
export default CognitronSDK;