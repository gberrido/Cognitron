#!/usr/bin/env node

/**
 * Centralized Configuration Management System for Cognitron05
 * Provides unified configuration loading, validation, environment override support,
 * and runtime configuration updates
 */

import path from 'path';
import { SYSTEM_CONFIG, ConfigValidator, ConfigLoader } from './SystemConstants.js';
import { streamingJSON } from '../utils/StreamingJSONProcessor.js';
import { createSecureOpsForDirectory } from '../security/SecureFileOpsMigration.js';

export class ConfigurationManager {
  constructor(options = {}) {
    this.configPath = options.configPath || path.join(process.cwd(), 'cognitron05-config.json');
    this.envPrefix = options.envPrefix || 'COGNITRON_';
    this.config = null;
    this.watchers = new Map(); // Configuration change watchers
    this.validationRules = new Map(); // Custom validation rules
    
    // Initialize secure file operations for config directory
    this.secureOps = createSecureOpsForDirectory(path.dirname(this.configPath), {
      maxFileSize: 10 * 1024 * 1024, // 10MB max config size
      allowSymlinks: false,
      validateFileTypes: true,
      allowedMimeTypes: ['application/json', 'text/plain']
    });
    this.defaultConfig = null;
    
    // Configuration change callbacks
    this.changeCallbacks = [];
    
    // Initialize default validation rules
    this.setupDefaultValidationRules();
  }

  /**
   * Initialize the configuration system
   */
  async initialize() {
    // Load default configuration
    this.defaultConfig = JSON.parse(JSON.stringify(SYSTEM_CONFIG));
    
    // Load user configuration from file (if exists)
    let userConfig = {};
    try {
      const fileName = path.basename(this.configPath);
      const userConfigData = await this.secureOps.readFile(fileName, 'utf8');
      userConfig = JSON.parse(userConfigData);
      console.log(`Configuration loaded from: ${this.configPath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn(`Warning: Could not load configuration file: ${error.message}`);
      }
      console.log('Using default configuration');
    }
    
    // Load environment overrides
    const envOverrides = this.loadEnvironmentOverrides();
    
    // Merge configurations: defaults -> user config -> environment overrides
    this.config = this.mergeConfigurations([
      this.defaultConfig,
      userConfig,
      envOverrides
    ]);
    
    // Validate the final configuration
    const validation = await this.validateConfiguration(this.config);
    if (!validation.valid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }
    
    console.log('Configuration system initialized successfully');
    return this.config;
  }

  /**
   * Get configuration value by path (e.g., 'MEMORY.MAX_WORKING_CONTEXT_SIZE')
   */
  get(path, defaultValue = undefined) {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }
    
    return this.getNestedValue(this.config, path, defaultValue);
  }

  /**
   * Set configuration value by path
   */
  async set(path, value, options = {}) {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }
    
    // Validate the new value
    if (options.validate !== false) {
      const validation = this.validateConfigValue(path, value);
      if (!validation.valid) {
        throw new Error(`Configuration validation failed for ${path}: ${validation.error}`);
      }
      value = validation.normalized || value;
    }
    
    // Set the value
    this.setNestedValue(this.config, path, value);
    
    // Notify watchers
    this.notifyWatchers(path, value);
    
    // Persist if requested
    if (options.persist !== false) {
      await this.persistConfiguration();
    }
    
    return value;
  }

  /**
   * Watch for configuration changes
   */
  watch(path, callback) {
    if (!this.watchers.has(path)) {
      this.watchers.set(path, []);
    }
    this.watchers.get(path).push(callback);
    
    // Return unwatch function
    return () => {
      const callbacks = this.watchers.get(path);
      if (callbacks) {
        const index = callbacks.indexOf(callback);
        if (index > -1) {
          callbacks.splice(index, 1);
        }
      }
    };
  }

  /**
   * Add configuration change callback
   */
  onChange(callback) {
    this.changeCallbacks.push(callback);
    
    // Return remove function
    return () => {
      const index = this.changeCallbacks.indexOf(callback);
      if (index > -1) {
        this.changeCallbacks.splice(index, 1);
      }
    };
  }

  /**
   * Get entire configuration object (deep copy)
   */
  getAll() {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }
    
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Update multiple configuration values at once
   */
  async updateMany(updates, options = {}) {
    const results = {};
    const errors = [];
    
    for (const [path, value] of Object.entries(updates)) {
      try {
        results[path] = await this.set(path, value, { ...options, persist: false });
      } catch (error) {
        errors.push(`${path}: ${error.message}`);
      }
    }
    
    if (errors.length > 0) {
      throw new Error(`Configuration update failed:\n${errors.join('\n')}`);
    }
    
    // Persist once after all updates
    if (options.persist !== false) {
      await this.persistConfiguration();
    }
    
    return results;
  }

  /**
   * Reset configuration to defaults
   */
  async reset(section = null) {
    if (!this.config) {
      throw new Error('Configuration not initialized. Call initialize() first.');
    }
    
    if (section) {
      // Reset specific section
      if (this.defaultConfig[section]) {
        this.config[section] = JSON.parse(JSON.stringify(this.defaultConfig[section]));
        this.notifyWatchers(section, this.config[section]);
      } else {
        throw new Error(`Unknown configuration section: ${section}`);
      }
    } else {
      // Reset entire configuration
      this.config = JSON.parse(JSON.stringify(this.defaultConfig));
      this.notifyAllWatchers();
    }
    
    await this.persistConfiguration();
    return this.config;
  }

  /**
   * Export configuration to file
   */
  async exportConfiguration(filePath, options = {}) {
    const configToExport = options.includeDefaults ? 
      this.config : 
      this.getDifferencesFromDefault();
    
    const exportData = {
      exported: new Date().toISOString(),
      version: '1.0',
      config: configToExport
    };
    
    // Use secure file operations for export
    const fileName = path.basename(filePath);
    const exportOps = createSecureOpsForDirectory(path.dirname(filePath), {
      maxFileSize: 10 * 1024 * 1024,
      allowSymlinks: false,
      validateFileTypes: true
    });
    await exportOps.writeFile(fileName, JSON.stringify(exportData, null, 2), 'utf8');
    console.log(`Configuration exported to: ${filePath}`);
  }

  /**
   * Import configuration from file
   */
  async importConfiguration(filePath, options = {}) {
    // Use secure file operations for import
    const fileName = path.basename(filePath);
    const importOps = createSecureOpsForDirectory(path.dirname(filePath), {
      maxFileSize: 10 * 1024 * 1024,
      allowSymlinks: false,
      validateFileTypes: true
    });
    const importData = JSON.parse(await importOps.readFile(fileName, 'utf8'));
    const importedConfig = importData.config || importData;
    
    // Validate imported configuration
    const validation = await this.validateConfiguration(importedConfig);
    if (!validation.valid) {
      throw new Error(`Imported configuration validation failed: ${validation.errors.join(', ')}`);
    }
    
    // Merge with current configuration
    this.config = this.mergeConfigurations([
      options.replace ? this.defaultConfig : this.config,
      importedConfig
    ]);
    
    this.notifyAllWatchers();
    
    if (options.persist !== false) {
      await this.persistConfiguration();
    }
    
    console.log(`Configuration imported from: ${filePath}`);
    return this.config;
  }

  /**
   * Get configuration schema for validation
   */
  getConfigurationSchema() {
    return {
      MEMORY: {
        type: 'object',
        properties: {
          MAX_WORKING_CONTEXT_SIZE: { type: 'number', minimum: 100, maximum: 10000 },
          MAX_FIFO_QUEUE_SIZE: { type: 'number', minimum: 1, maximum: 100 },
          MEMORY_PRESSURE_THRESHOLD: { type: 'number', minimum: 0.1, maximum: 0.95 },
          CONTEXT_WINDOW_SIZE: { type: 'number', minimum: 1000, maximum: 100000 },
          AUTO_SAVE_INTERVAL: { type: 'number', minimum: 1000 },
          SESSION_TIMEOUT: { type: 'number', minimum: 60000 }
        }
      },
      API_ERROR: {
        type: 'object',
        properties: {
          MAX_RETRIES: { type: 'number', minimum: 0, maximum: 10 },
          BASE_DELAY: { type: 'number', minimum: 100, maximum: 10000 },
          MAX_DELAY: { type: 'number', minimum: 1000, maximum: 300000 },
          DEFAULT_API_TIMEOUT: { type: 'number', minimum: 1000, maximum: 120000 }
        }
      },
      CHAT_AGENT: {
        type: 'object',
        properties: {
          DEFAULT_TEMPERATURE: { type: 'number', minimum: 0.0, maximum: 2.0 },
          DEFAULT_MAX_TOKENS: { type: 'number', minimum: 1, maximum: 8192 },
          TYPING_DELAY: { type: 'number', minimum: 0, maximum: 5000 }
        }
      }
    };
  }

  /**
   * Validate entire configuration
   */
  async validateConfiguration(config) {
    const errors = [];
    const schema = this.getConfigurationSchema();
    
    // Validate each section
    for (const [section, sectionSchema] of Object.entries(schema)) {
      if (config[section]) {
        const sectionValidation = this.validateSection(config[section], sectionSchema);
        if (!sectionValidation.valid) {
          errors.push(...sectionValidation.errors.map(err => `${section}.${err}`));
        }
      }
    }
    
    // Run custom validation rules
    for (const [path, validator] of this.validationRules) {
      const value = this.getNestedValue(config, path);
      if (value !== undefined) {
        const result = validator(value);
        if (!result.valid) {
          errors.push(`${path}: ${result.error}`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Private method to setup default validation rules
   */
  setupDefaultValidationRules() {
    // Temperature validation
    this.validationRules.set('CHAT_AGENT.DEFAULT_TEMPERATURE', (value) => {
      return ConfigValidator.validateTemperature(value);
    });
    
    // Memory pressure threshold validation
    this.validationRules.set('MEMORY.MEMORY_PRESSURE_THRESHOLD', (value) => {
      return ConfigValidator.validateMemoryPressureThreshold(value);
    });
    
    // Max tokens validation
    this.validationRules.set('CHAT_AGENT.DEFAULT_MAX_TOKENS', (value) => {
      return ConfigValidator.validateMaxTokens(value);
    });
  }

  /**
   * Private method to load environment overrides
   */
  loadEnvironmentOverrides() {
    const overrides = {};
    const prefix = this.envPrefix;
    
    // Map of environment variables to configuration paths
    const envMappings = {
      [`${prefix}MAX_WORKING_CONTEXT_SIZE`]: 'MEMORY.MAX_WORKING_CONTEXT_SIZE',
      [`${prefix}MAX_FIFO_QUEUE_SIZE`]: 'MEMORY.MAX_FIFO_QUEUE_SIZE',
      [`${prefix}MEMORY_PRESSURE_THRESHOLD`]: 'MEMORY.MEMORY_PRESSURE_THRESHOLD',
      [`${prefix}CONTEXT_WINDOW_SIZE`]: 'MEMORY.CONTEXT_WINDOW_SIZE',
      [`${prefix}DEFAULT_TEMPERATURE`]: 'CHAT_AGENT.DEFAULT_TEMPERATURE',
      [`${prefix}DEFAULT_MAX_TOKENS`]: 'CHAT_AGENT.DEFAULT_MAX_TOKENS',
      [`${prefix}DEFAULT_MODEL`]: 'CHAT_AGENT.DEFAULT_MODEL',
      [`${prefix}API_MAX_RETRIES`]: 'API_ERROR.MAX_RETRIES',
      [`${prefix}API_TIMEOUT`]: 'API_ERROR.DEFAULT_API_TIMEOUT',
      [`${prefix}TYPING_DELAY`]: 'CHAT_AGENT.TYPING_DELAY'
    };
    
    for (const [envVar, configPath] of Object.entries(envMappings)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        // Convert string values to appropriate types
        let convertedValue = value;
        if (configPath.includes('TEMPERATURE') || configPath.includes('THRESHOLD')) {
          convertedValue = parseFloat(value);
        } else if (configPath.includes('SIZE') || configPath.includes('TOKENS') || 
                   configPath.includes('RETRIES') || configPath.includes('TIMEOUT') ||
                   configPath.includes('DELAY')) {
          convertedValue = parseInt(value);
        }
        
        this.setNestedValue(overrides, configPath, convertedValue);
      }
    }
    
    return overrides;
  }

  /**
   * Private method to merge configurations
   */
  mergeConfigurations(configs) {
    const result = {};
    
    for (const config of configs) {
      this.deepMerge(result, config);
    }
    
    return result;
  }

  /**
   * Private method for deep merge
   */
  deepMerge(target, source) {
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        target[key] = target[key] || {};
        this.deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  /**
   * Private method to get nested value
   */
  getNestedValue(obj, path, defaultValue = undefined) {
    const keys = path.split('.');
    let current = obj;
    
    for (const key of keys) {
      if (current && typeof current === 'object' && key in current) {
        current = current[key];
      } else {
        return defaultValue;
      }
    }
    
    return current;
  }

  /**
   * Private method to set nested value
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[keys[keys.length - 1]] = value;
  }

  /**
   * Private method to validate a single config value
   */
  validateConfigValue(path, value) {
    const validator = this.validationRules.get(path);
    if (validator) {
      return validator(value);
    }
    
    // Default validation based on path
    if (path.includes('TEMPERATURE')) {
      return ConfigValidator.validateTemperature(value);
    } else if (path.includes('MEMORY_PRESSURE_THRESHOLD')) {
      return ConfigValidator.validateMemoryPressureThreshold(value);
    } else if (path.includes('MAX_TOKENS')) {
      return ConfigValidator.validateMaxTokens(value);
    }
    
    return { valid: true };
  }

  /**
   * Private method to validate a configuration section
   */
  validateSection(section, schema) {
    const errors = [];
    
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        const value = section[key];
        if (value !== undefined) {
          if (propSchema.type === 'number') {
            if (typeof value !== 'number' || isNaN(value)) {
              errors.push(`${key}: must be a number`);
            } else {
              if (propSchema.minimum !== undefined && value < propSchema.minimum) {
                errors.push(`${key}: must be >= ${propSchema.minimum}`);
              }
              if (propSchema.maximum !== undefined && value > propSchema.maximum) {
                errors.push(`${key}: must be <= ${propSchema.maximum}`);
              }
            }
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Private method to notify watchers
   */
  notifyWatchers(path, value) {
    const callbacks = this.watchers.get(path);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(value, path);
        } catch (error) {
          console.error(`Configuration watcher error for ${path}:`, error);
        }
      });
    }
    
    // Notify general change callbacks
    this.changeCallbacks.forEach(callback => {
      try {
        callback(path, value);
      } catch (error) {
        console.error('Configuration change callback error:', error);
      }
    });
  }

  /**
   * Private method to notify all watchers
   */
  notifyAllWatchers() {
    this.watchers.forEach((callbacks, path) => {
      const value = this.getNestedValue(this.config, path);
      callbacks.forEach(callback => {
        try {
          callback(value, path);
        } catch (error) {
          console.error(`Configuration watcher error for ${path}:`, error);
        }
      });
    });
  }

  /**
   * Private method to persist configuration to file
   */
  async persistConfiguration() {
    try {
      const configToPersist = this.getDifferencesFromDefault();
      const fileName = path.basename(this.configPath);
      await this.secureOps.writeFile(fileName, JSON.stringify(configToPersist, null, 2), 'utf8');
    } catch (error) {
      console.warn(`Warning: Could not persist configuration: ${error.message}`);
    }
  }

  /**
   * Private method to get differences from default config
   */
  getDifferencesFromDefault() {
    const differences = {};
    
    const findDifferences = (current, defaults, path = '') => {
      for (const key in current) {
        const currentPath = path ? `${path}.${key}` : key;
        const currentValue = current[key];
        const defaultValue = defaults[key];
        
        if (typeof currentValue === 'object' && currentValue !== null && !Array.isArray(currentValue)) {
          if (typeof defaultValue === 'object' && defaultValue !== null) {
            findDifferences(currentValue, defaultValue, currentPath);
          } else {
            this.setNestedValue(differences, currentPath, currentValue);
          }
        } else if (currentValue !== defaultValue) {
          this.setNestedValue(differences, currentPath, currentValue);
        }
      }
    };
    
    findDifferences(this.config, this.defaultConfig);
    return differences;
  }

  /**
   * Get configuration status and health
   */
  getStatus() {
    if (!this.config) {
      return {
        initialized: false,
        valid: false,
        message: 'Configuration not initialized'
      };
    }
    
    return {
      initialized: true,
      valid: true,
      configPath: this.configPath,
      watcherCount: Array.from(this.watchers.values()).reduce((total, callbacks) => total + callbacks.length, 0),
      changeCallbackCount: this.changeCallbacks.length,
      lastModified: new Date().toISOString(),
      sections: Object.keys(this.config)
    };
  }
}

export default ConfigurationManager;