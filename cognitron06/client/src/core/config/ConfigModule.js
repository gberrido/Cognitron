#!/usr/bin/env node

/**
 * Configuration Module for Cognitron SDK
 * Handles configuration management and secure storage
 */

import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { EventEmitter } from 'events';

export class ConfigModule extends EventEmitter {
  constructor(config = {}) {
    super();
    this.serviceName = 'cognitron06-sdk';
    this.configDir = path.join(os.homedir(), '.cognitron06');
    this.configFile = path.join(this.configDir, 'config.json');
    this.secureFile = path.join(this.configDir, 'secure.json');
    
    this.defaults = {
      serverUrl: 'http://localhost:8000',
      enableStreaming: true,
      preferWebSocket: false,
      preferSSE: false,
      timeout: 30000,
      showTokenUsage: false,
      debugMode: false,
      autoLogin: true,
      saveCredentials: true,
      ...config
    };
    
    this.config = { ...this.defaults };
    this.loaded = false;
  }

  /**
   * Load configuration from file
   * @returns {Promise<Object>} Loaded configuration
   */
  async load() {
    if (this.loaded) return this.config;

    try {
      // Ensure config directory exists
      await fs.mkdir(this.configDir, { recursive: true });
      
      // Load config file if it exists
      try {
        const configData = await fs.readFile(this.configFile, 'utf8');
        const savedConfig = JSON.parse(configData);
        this.config = { ...this.defaults, ...savedConfig };
        this.emit('config_loaded', this.config);
      } catch (error) {
        // Config file doesn't exist or is invalid, use defaults and save
        this.config = { ...this.defaults };
        await this.save();
        this.emit('config_created', this.config);
      }
      
      this.loaded = true;
      return this.config;
    } catch (error) {
      this.emit('error', error);
      console.warn(`Warning: Could not load configuration: ${error.message}`);
      this.config = { ...this.defaults };
      this.loaded = true;
      return this.config;
    }
  }

  /**
   * Save configuration to file
   * @returns {Promise<boolean>} Success status
   */
  async save() {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      await fs.writeFile(this.configFile, JSON.stringify(this.config, null, 2));
      this.emit('config_saved', this.config);
      return true;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to save configuration: ${error.message}`);
    }
  }

  /**
   * Get a configuration value
   * @param {string} key - Configuration key
   * @returns {*} Configuration value
   */
  get(key) {
    return this.config[key];
  }

  /**
   * Set a configuration value
   * @param {string} key - Configuration key
   * @param {*} value - Configuration value
   * @returns {*} The set value
   */
  set(key, value) {
    const oldValue = this.config[key];
    this.config[key] = value;
    this.emit('config_changed', { key, oldValue, newValue: value });
    return value;
  }

  /**
   * Update multiple configuration values
   * @param {Object} updates - Object with key-value pairs to update
   * @returns {Object} Updated configuration
   */
  update(updates) {
    const changes = {};
    Object.entries(updates).forEach(([key, value]) => {
      changes[key] = { oldValue: this.config[key], newValue: value };
      this.config[key] = value;
    });
    this.emit('config_bulk_changed', changes);
    return this.config;
  }

  /**
   * Get all configuration values
   * @returns {Object} Complete configuration object
   */
  getAll() {
    return { ...this.config };
  }

  /**
   * Reset configuration to defaults
   * @returns {Object} Reset configuration
   */
  reset() {
    const oldConfig = { ...this.config };
    this.config = { ...this.defaults };
    this.emit('config_reset', { oldConfig, newConfig: this.config });
    return this.config;
  }

  /**
   * Get a secure value (encrypted storage)
   * @param {string} key - Secure storage key
   * @returns {Promise<string|null>} Decrypted value or null if not found
   */
  async getSecure(key) {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      const secureData = await fs.readFile(this.secureFile, 'utf8');
      const secure = JSON.parse(secureData);
      const decryptedValue = this._decrypt(secure[key]);
      this.emit('secure_retrieved', { key });
      return decryptedValue;
    } catch (error) {
      // File doesn't exist or can't be read
      if (error.code !== 'ENOENT') {
        this.emit('error', error);
      }
      return null;
    }
  }

  /**
   * Set a secure value (encrypted storage)
   * @param {string} key - Secure storage key
   * @param {string} value - Value to encrypt and store
   * @returns {Promise<boolean>} Success status
   */
  async setSecure(key, value) {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      
      let secure = {};
      try {
        const secureData = await fs.readFile(this.secureFile, 'utf8');
        secure = JSON.parse(secureData);
      } catch (error) {
        // File doesn't exist, start with empty object
      }
      
      secure[key] = this._encrypt(value);
      await fs.writeFile(this.secureFile, JSON.stringify(secure, null, 2), { mode: 0o600 });
      this.emit('secure_stored', { key });
      return true;
    } catch (error) {
      this.emit('error', error);
      console.warn(`Could not save to secure storage: ${error.message}`);
      throw error;
    }
  }

  /**
   * Delete a secure value
   * @param {string} key - Secure storage key
   * @returns {Promise<boolean>} Success status
   */
  async deleteSecure(key) {
    try {
      const secureData = await fs.readFile(this.secureFile, 'utf8');
      const secure = JSON.parse(secureData);
      
      if (!(key in secure)) {
        return true; // Already deleted
      }
      
      delete secure[key];
      await fs.writeFile(this.secureFile, JSON.stringify(secure, null, 2), { mode: 0o600 });
      this.emit('secure_deleted', { key });
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true; // File doesn't exist, consider it deleted
      }
      this.emit('error', error);
      console.warn(`Could not delete from secure storage: ${error.message}`);
      return false;
    }
  }

  /**
   * List all secure storage keys
   * @returns {Promise<Array<string>>} Array of secure keys
   */
  async listSecureKeys() {
    try {
      const secureData = await fs.readFile(this.secureFile, 'utf8');
      const secure = JSON.parse(secureData);
      return Object.keys(secure);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return []; // File doesn't exist
      }
      this.emit('error', error);
      throw new Error(`Could not list secure keys: ${error.message}`);
    }
  }

  /**
   * Clear all secure storage
   * @returns {Promise<boolean>} Success status
   */
  async clearSecureStorage() {
    try {
      await fs.writeFile(this.secureFile, JSON.stringify({}, null, 2), { mode: 0o600 });
      this.emit('secure_cleared');
      return true;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Could not clear secure storage: ${error.message}`);
    }
  }

  /**
   * Export configuration (excluding secure data)
   * @returns {Object} Exportable configuration
   */
  export() {
    return {
      config: { ...this.config },
      metadata: {
        exported_at: new Date().toISOString(),
        service: this.serviceName,
        version: '1.0.0'
      }
    };
  }

  /**
   * Import configuration
   * @param {Object} data - Configuration data to import
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Import result
   */
  async importConfig(data, options = {}) {
    try {
      const { merge = true, backup = true } = options;
      
      // Create backup if requested
      if (backup) {
        const backupData = this.export();
        const backupFile = path.join(this.configDir, `config.backup.${Date.now()}.json`);
        await fs.writeFile(backupFile, JSON.stringify(backupData, null, 2));
      }
      
      // Import configuration
      if (merge) {
        this.config = { ...this.config, ...data.config };
      } else {
        this.config = { ...this.defaults, ...data.config };
      }
      
      await this.save();
      this.emit('config_imported', { data, options });
      
      return {
        success: true,
        imported_keys: Object.keys(data.config || {}),
        merged: merge
      };
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to import configuration: ${error.message}`);
    }
  }

  /**
   * Validate configuration
   * @returns {Object} Validation result
   */
  validate() {
    const errors = [];
    const warnings = [];
    
    // Validate server URL
    if (!this.config.serverUrl) {
      errors.push('serverUrl is required');
    } else {
      try {
        new URL(this.config.serverUrl);
      } catch (error) {
        errors.push('serverUrl must be a valid URL');
      }
    }
    
    // Validate timeout
    if (this.config.timeout && (typeof this.config.timeout !== 'number' || this.config.timeout <= 0)) {
      warnings.push('timeout should be a positive number');
    }
    
    // Validate boolean options
    const booleanOptions = ['enableStreaming', 'preferWebSocket', 'preferSSE', 'showTokenUsage', 'debugMode', 'autoLogin', 'saveCredentials'];
    booleanOptions.forEach(option => {
      if (this.config[option] !== undefined && typeof this.config[option] !== 'boolean') {
        warnings.push(`${option} should be a boolean value`);
      }
    });
    
    const result = {
      valid: errors.length === 0,
      errors,
      warnings
    };
    
    this.emit('config_validated', result);
    return result;
  }

  // Private methods for encryption/decryption

  /**
   * Generate encryption key from machine-specific information
   * @private
   */
  _getKey() {
    const machineInfo = os.hostname() + os.userInfo().username + this.serviceName;
    return crypto.createHash('sha256').update(machineInfo).digest();
  }

  /**
   * Encrypt a value
   * @private
   */
  _encrypt(text) {
    if (!text) return null;
    try {
      const key = this._getKey().slice(0, 32); // Use first 32 bytes for AES-256
      const iv = crypto.randomBytes(16);
      const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt a value
   * @private
   */
  _decrypt(encryptedText) {
    if (!encryptedText) return null;
    try {
      const key = this._getKey().slice(0, 32); // Use first 32 bytes for AES-256
      const parts = encryptedText.split(':');
      if (parts.length !== 2) throw new Error('Invalid encrypted data format');
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  // Getters for common configuration values

  get serverUrl() {
    return this.config.serverUrl;
  }

  get debugMode() {
    return this.config.debugMode;
  }

  get timeout() {
    return this.config.timeout;
  }

  get enableStreaming() {
    return this.config.enableStreaming;
  }

  get isLoaded() {
    return this.loaded;
  }
}