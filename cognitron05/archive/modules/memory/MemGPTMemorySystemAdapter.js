#!/usr/bin/env node

/**
 * MemGPTMemorySystemAdapter - Adapter for existing MemGPTMemorySystem to implement IMemorySystem
 * Wraps the current file-based memory system to conform to the new modular architecture
 * 
 * This adapter allows the existing MemGPTMemorySystem to work with the new interface-based
 * architecture while maintaining backward compatibility.
 */

import { IMemorySystem } from '../interfaces/IMemorySystem.js';
import { MemGPTMemorySystem } from './MemGPTMemorySystem.js';
import { getLogger } from '../utils/StructuredLogger.js';

export class MemGPTMemorySystemAdapter extends IMemorySystem {
  constructor(config = {}) {
    super();
    
    this.config = config;
    this.logger = getLogger();
    
    // Encrypted storage integration
    this.encryptedStorage = config.encryptedStorage || null;
    
    // Create the wrapped memory system with encrypted storage
    this.memorySystem = new MemGPTMemorySystem({
      ...config,
      encryptedStorage: this.encryptedStorage
    });
    
    // Track initialization state
    this.initialized = false;
  }

  /**
   * Initialize the memory system
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) {
      return;
    }

    try {
      this.logger.debug('Initializing MemGPT memory system adapter', {
        subsystem: 'memory',
        component: 'adapter'
      });

      await this.memorySystem.initialize();
      this.initialized = true;

      this.logger.info('MemGPT memory system adapter initialized', {
        subsystem: 'memory',
        component: 'adapter',
        sessionId: this.memorySystem.currentSessionId
      });

    } catch (error) {
      this.logger.error('Failed to initialize MemGPT memory system adapter', {
        subsystem: 'memory',
        component: 'adapter'
      }, error);
      throw error;
    }
  }

  /**
   * Update working context with key-value pair
   * @param {string} key - Context key
   * @param {*} value - Context value
   * @returns {Promise<void>}
   */
  async updateWorkingContext(key, value) {
    this.ensureInitialized();
    
    this.logger.debug('Updating working context', {
      subsystem: 'memory',
      component: 'adapter',
      key,
      operation: 'updateWorkingContext'
    });

    this.memorySystem.updateWorkingContext(key, value);
  }

  /**
   * Get working context value by key
   * @param {string} key - Context key
   * @returns {Promise<*>} Context value
   */
  async getWorkingContext(key) {
    this.ensureInitialized();
    
    const value = this.memorySystem.workingContext.get(key);
    
    this.logger.debug('Retrieved working context value', {
      subsystem: 'memory',
      component: 'adapter',
      key,
      hasValue: value !== undefined,
      operation: 'getWorkingContext'
    });

    return value;
  }

  /**
   * Get all working context as object
   * @returns {Promise<Object>} Working context object
   */
  async getAllWorkingContext() {
    this.ensureInitialized();
    
    const contextObj = {};
    for (const [key, value] of this.memorySystem.workingContext.entries()) {
      contextObj[key] = value;
    }
    
    return contextObj;
  }

  /**
   * Add message to FIFO conversation queue
   * @param {string} role - Message role (user, assistant, system)
   * @param {string} content - Message content
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<void>}
   */
  async addToFifoQueue(role, content, metadata = {}) {
    this.ensureInitialized();
    
    this.logger.debug('Adding message to FIFO queue', {
      subsystem: 'memory',
      component: 'adapter',
      role,
      contentLength: content?.length || 0,
      operation: 'addToFifoQueue'
    });

    this.memorySystem.addToFifoQueue(role, content, metadata);
  }

  /**
   * Search recall storage (conversation history)
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async searchRecallStorage(query, options = {}) {
    this.ensureInitialized();
    
    this.logger.debug('Searching recall storage', {
      subsystem: 'memory',
      component: 'adapter',
      query,
      maxResults: options.maxResults,
      operation: 'searchRecallStorage'
    });

    const results = await this.memorySystem.searchRecallStorage(query, options);
    
    this.logger.debug('Recall storage search completed', {
      subsystem: 'memory',
      component: 'adapter',
      query,
      resultCount: results.length,
      operation: 'searchRecallStorage'
    });

    return results;
  }

  /**
   * Store data in archival memory
   * @param {string} key - Storage key
   * @param {*} data - Data to store
   * @param {Object} metadata - Storage metadata
   * @returns {Promise<void>}
   */
  async storeInArchival(key, data, metadata = {}) {
    this.ensureInitialized();
    
    this.logger.debug('Storing data in archival memory', {
      subsystem: 'memory',
      component: 'adapter',
      key,
      dataType: typeof data,
      operation: 'storeInArchival'
    });

    this.memorySystem.storeInArchival(key, data, metadata);
  }

  /**
   * Search archival memory
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async searchArchival(query, options = {}) {
    this.ensureInitialized();
    
    this.logger.debug('Searching archival memory', {
      subsystem: 'memory',
      component: 'adapter',
      query,
      operation: 'searchArchival'
    });

    const results = this.memorySystem.searchArchival(query);
    
    this.logger.debug('Archival memory search completed', {
      subsystem: 'memory',
      component: 'adapter',
      query,
      resultCount: results.length,
      operation: 'searchArchival'
    });

    return results;
  }

  /**
   * Check memory pressure (context window usage)
   * @returns {Promise<Object>} Memory pressure information
   */
  async checkMemoryPressure() {
    this.ensureInitialized();
    
    const pressure = this.memorySystem.checkMemoryPressure();
    
    this.logger.debug('Checked memory pressure', {
      subsystem: 'memory',
      component: 'adapter',
      usage: pressure.usage,
      warning: pressure.warning,
      operation: 'checkMemoryPressure'
    });

    return pressure;
  }

  /**
   * Get memory system status
   * @returns {Promise<Object>} Status information
   */
  async getStatus() {
    this.ensureInitialized();
    
    const status = this.memorySystem.getStatus();
    
    this.logger.debug('Retrieved memory system status', {
      subsystem: 'memory',
      component: 'adapter',
      sessionId: status.sessionId,
      workingContextSize: status.workingContextSize,
      operation: 'getStatus'
    });

    return status;
  }

  /**
   * Estimate context usage in tokens
   * @returns {Promise<number>} Token count
   */
  async estimateContextUsage() {
    this.ensureInitialized();
    
    const usage = this.memorySystem.estimateContextUsage();
    
    this.logger.debug('Estimated context usage', {
      subsystem: 'memory',
      component: 'adapter',
      tokenCount: usage,
      operation: 'estimateContextUsage'
    });

    return usage;
  }

  /**
   * Build context for AI model
   * @returns {Promise<Array>} Context messages array
   */
  async buildContext() {
    this.ensureInitialized();
    
    this.logger.debug('Building context for AI model', {
      subsystem: 'memory',
      component: 'adapter',
      operation: 'buildContext'
    });

    const context = this.memorySystem.buildContext();
    
    this.logger.debug('Context built for AI model', {
      subsystem: 'memory',
      component: 'adapter',
      messageCount: context.length,
      operation: 'buildContext'
    });

    return context;
  }

  /**
   * Get working context summary
   * @returns {Promise<string>} Context summary
   */
  async getWorkingContextSummary() {
    this.ensureInitialized();
    return this.memorySystem.getWorkingContextSummary();
  }

  /**
   * Get current session ID
   * @returns {Promise<string>} Session ID
   */
  async getCurrentSessionId() {
    this.ensureInitialized();
    return this.memorySystem.currentSessionId;
  }

  /**
   * Switch to a different tokenizer model
   * @param {string} modelName - Model name
   * @returns {Promise<void>}
   */
  async switchTokenizerModel(modelName) {
    this.ensureInitialized();
    
    this.logger.info('Switching tokenizer model', {
      subsystem: 'memory',
      component: 'adapter',
      modelName,
      operation: 'switchTokenizerModel'
    });

    this.memorySystem.switchTokenizerModel(modelName);
  }

  /**
   * Cleanup and persist memory state
   * @returns {Promise<void>}
   */
  async cleanup() {
    if (!this.initialized) {
      return;
    }

    try {
      this.logger.info('Cleaning up MemGPT memory system adapter', {
        subsystem: 'memory',
        component: 'adapter',
        operation: 'cleanup'
      });

      await this.memorySystem.cleanup();

      this.logger.debug('MemGPT memory system adapter cleanup completed', {
        subsystem: 'memory',
        component: 'adapter',
        operation: 'cleanup'
      });

    } catch (error) {
      this.logger.error('Error during MemGPT memory system adapter cleanup', {
        subsystem: 'memory',
        component: 'adapter',
        operation: 'cleanup'
      }, error);
      throw error;
    }
  }

  /**
   * Health check for memory system
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    try {
      // Check if initialized
      if (!this.initialized) {
        return {
          healthy: false,
          reason: 'Memory system not initialized',
          details: { initialized: false }
        };
      }

      // Check core components
      const status = this.memorySystem.getStatus();
      const pressure = this.memorySystem.checkMemoryPressure();
      
      // Check if data directory is accessible
      const dataAccessible = await this.checkDataAccessibility();
      
      // Determine health status
      const healthy = dataAccessible && pressure.usage < 0.95; // Allow up to 95% usage
      
      const result = {
        healthy,
        reason: healthy ? 'Memory system healthy' : 'Memory system issues detected',
        details: {
          initialized: this.initialized,
          sessionId: status.sessionId,
          memoryUsage: pressure.usage,
          dataAccessible,
          workingContextSize: status.workingContextSize,
          recallStorageSize: status.recallStorageSize,
          archivalStorageSize: status.archivalStorageSize
        }
      };

      this.logger.debug('Memory system health check completed', {
        subsystem: 'memory',
        component: 'adapter',
        healthy,
        memoryUsage: pressure.usage,
        operation: 'healthCheck'
      });

      return result;

    } catch (error) {
      this.logger.error('Memory system health check failed', {
        subsystem: 'memory',
        component: 'adapter',
        operation: 'healthCheck'
      }, error);

      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`,
        details: { error: error.message }
      };
    }
  }

  /**
   * Check if memory data directory is accessible
   * @returns {Promise<boolean>} Accessibility status
   */
  async checkDataAccessibility() {
    try {
      // Try to access the data directory and key files using secure operations
      const path = await import('path');
      const { createSecureOpsForDirectory } = await import('../security/SecureFileOpsMigration.js');
      
      const dataDir = this.memorySystem.dataDir;
      
      // Create secure file operations for the data directory
      const secureOps = createSecureOpsForDirectory(dataDir, {
        maxFileSize: 100 * 1024 * 1024, // 100MB max for memory files
        allowSymlinks: false,
        validateFileTypes: true,
        allowedMimeTypes: ['application/json', 'text/plain']
      });
      
      // Check if directory exists and is accessible (check parent directory)
      try {
        await secureOps.access('.', 0); // Check directory itself
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        // Directory doesn't exist, which is acceptable for initialization
        return true;
      }
      
      // Check key files
      const keyFiles = [
        'working-context.json',
        'recall-storage.jsonl',
        'archival-storage.json',
        'session-state.json'
      ];
      
      for (const filename of keyFiles) {
        try {
          await secureOps.access(filename);
        } catch (error) {
          // File may not exist yet, which is okay
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
      
      return true;
      
    } catch (error) {
      this.logger.warn('Memory data accessibility check failed', {
        subsystem: 'memory',
        component: 'adapter',
        dataDir: this.memorySystem.dataDir
      }, error);
      
      return false;
    }
  }

  /**
   * Ensure memory system is initialized
   * @throws {Error} If not initialized
   */
  ensureInitialized() {
    if (!this.initialized) {
      throw new Error('MemGPT memory system adapter not initialized. Call initialize() first.');
    }
  }

  /**
   * Get the underlying memory system for backward compatibility
   * @returns {MemGPTMemorySystem} Underlying memory system
   */
  getUnderlyingSystem() {
    return this.memorySystem;
  }

  /**
   * Get adapter statistics
   * @returns {Object} Adapter statistics
   */
  getAdapterStats() {
    return {
      initialized: this.initialized,
      adapterType: 'MemGPTMemorySystemAdapter',
      underlyingType: 'MemGPTMemorySystem',
      config: this.config,
      memorySystemStats: this.initialized ? this.memorySystem.getStatus() : null
    };
  }
}

export default MemGPTMemorySystemAdapter;