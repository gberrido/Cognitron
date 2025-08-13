#!/usr/bin/env node

/**
 * IMemorySystem - Interface definition for memory system implementations
 * Defines the contract that all memory systems must implement
 * 
 * Provides abstraction for different memory system implementations:
 * - File-based memory (current MemGPTMemorySystem)
 * - Database-backed memory
 * - Distributed memory systems
 * - In-memory testing implementations
 */

/**
 * Base interface for memory system implementations
 */
export class IMemorySystem {
  /**
   * Initialize the memory system
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('IMemorySystem.initialize() must be implemented by subclass');
  }

  /**
   * Update working context with key-value pair
   * @param {string} key - Context key
   * @param {*} value - Context value
   * @returns {Promise<void>}
   */
  async updateWorkingContext(key, value) {
    throw new Error('IMemorySystem.updateWorkingContext() must be implemented by subclass');
  }

  /**
   * Get working context value by key
   * @param {string} key - Context key
   * @returns {Promise<*>} Context value
   */
  async getWorkingContext(key) {
    throw new Error('IMemorySystem.getWorkingContext() must be implemented by subclass');
  }

  /**
   * Add message to FIFO conversation queue
   * @param {string} role - Message role (user, assistant, system)
   * @param {string} content - Message content
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<void>}
   */
  async addToFifoQueue(role, content, metadata = {}) {
    throw new Error('IMemorySystem.addToFifoQueue() must be implemented by subclass');
  }

  /**
   * Search recall storage (conversation history)
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async searchRecallStorage(query, options = {}) {
    throw new Error('IMemorySystem.searchRecallStorage() must be implemented by subclass');
  }

  /**
   * Store data in archival memory
   * @param {string} key - Storage key
   * @param {*} data - Data to store
   * @param {Object} metadata - Storage metadata
   * @returns {Promise<void>}
   */
  async storeInArchival(key, data, metadata = {}) {
    throw new Error('IMemorySystem.storeInArchival() must be implemented by subclass');
  }

  /**
   * Search archival memory
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async searchArchival(query, options = {}) {
    throw new Error('IMemorySystem.searchArchival() must be implemented by subclass');
  }

  /**
   * Check memory pressure (context window usage)
   * @returns {Promise<Object>} Memory pressure information
   */
  async checkMemoryPressure() {
    throw new Error('IMemorySystem.checkMemoryPressure() must be implemented by subclass');
  }

  /**
   * Get memory system status
   * @returns {Promise<Object>} Status information
   */
  async getStatus() {
    throw new Error('IMemorySystem.getStatus() must be implemented by subclass');
  }

  /**
   * Estimate context usage in tokens
   * @returns {Promise<number>} Token count
   */
  async estimateContextUsage() {
    throw new Error('IMemorySystem.estimateContextUsage() must be implemented by subclass');
  }

  /**
   * Build context for AI model
   * @returns {Promise<Array>} Context messages array
   */
  async buildContext() {
    throw new Error('IMemorySystem.buildContext() must be implemented by subclass');
  }

  /**
   * Cleanup and persist memory state
   * @returns {Promise<void>}
   */
  async cleanup() {
    throw new Error('IMemorySystem.cleanup() must be implemented by subclass');
  }

  /**
   * Health check for memory system
   * @returns {Promise<Object>} Health status
   */
  async healthCheck() {
    throw new Error('IMemorySystem.healthCheck() must be implemented by subclass');
  }
}

/**
 * Memory system factory interface
 */
export class IMemorySystemFactory {
  /**
   * Create a memory system instance
   * @param {Object} config - Configuration options
   * @returns {Promise<IMemorySystem>} Memory system instance
   */
  async createMemorySystem(config) {
    throw new Error('IMemorySystemFactory.createMemorySystem() must be implemented by subclass');
  }

  /**
   * Get supported memory system types
   * @returns {Array<string>} Supported types
   */
  getSupportedTypes() {
    throw new Error('IMemorySystemFactory.getSupportedTypes() must be implemented by subclass');
  }
}

/**
 * Memory persistence interface
 */
export class IMemoryPersistence {
  /**
   * Save working context to persistent storage
   * @param {Map} workingContext - Working context map
   * @returns {Promise<void>}
   */
  async saveWorkingContext(workingContext) {
    throw new Error('IMemoryPersistence.saveWorkingContext() must be implemented by subclass');
  }

  /**
   * Load working context from persistent storage
   * @returns {Promise<Map>} Working context map
   */
  async loadWorkingContext() {
    throw new Error('IMemoryPersistence.loadWorkingContext() must be implemented by subclass');
  }

  /**
   * Append message to recall storage
   * @param {Object} message - Message to append
   * @returns {Promise<void>}
   */
  async appendToRecallStorage(message) {
    throw new Error('IMemoryPersistence.appendToRecallStorage() must be implemented by subclass');
  }

  /**
   * Load recall storage
   * @returns {Promise<Array>} Recall storage array
   */
  async loadRecallStorage() {
    throw new Error('IMemoryPersistence.loadRecallStorage() must be implemented by subclass');
  }

  /**
   * Save archival storage
   * @param {Map} archivalStorage - Archival storage map
   * @returns {Promise<void>}
   */
  async saveArchivalStorage(archivalStorage) {
    throw new Error('IMemoryPersistence.saveArchivalStorage() must be implemented by subclass');
  }

  /**
   * Load archival storage
   * @returns {Promise<Map>} Archival storage map
   */
  async loadArchivalStorage() {
    throw new Error('IMemoryPersistence.loadArchivalStorage() must be implemented by subclass');
  }

  /**
   * Save session state
   * @param {Object} sessionState - Session state object
   * @returns {Promise<void>}
   */
  async saveSessionState(sessionState) {
    throw new Error('IMemoryPersistence.saveSessionState() must be implemented by subclass');
  }

  /**
   * Load session state
   * @returns {Promise<Object>} Session state object
   */
  async loadSessionState() {
    throw new Error('IMemoryPersistence.loadSessionState() must be implemented by subclass');
  }

  /**
   * Check if persistent storage exists and is accessible
   * @returns {Promise<boolean>} Storage accessibility
   */
  async isStorageAccessible() {
    throw new Error('IMemoryPersistence.isStorageAccessible() must be implemented by subclass');
  }
}

/**
 * Memory search interface
 */
export class IMemorySearch {
  /**
   * Index content for search
   * @param {string} id - Content identifier
   * @param {string} content - Content to index
   * @param {Object} metadata - Content metadata
   * @returns {Promise<void>}
   */
  async indexContent(id, content, metadata = {}) {
    throw new Error('IMemorySearch.indexContent() must be implemented by subclass');
  }

  /**
   * Search indexed content
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results
   */
  async search(query, options = {}) {
    throw new Error('IMemorySearch.search() must be implemented by subclass');
  }

  /**
   * Remove content from search index
   * @param {string} id - Content identifier
   * @returns {Promise<void>}
   */
  async removeFromIndex(id) {
    throw new Error('IMemorySearch.removeFromIndex() must be implemented by subclass');
  }

  /**
   * Clear search index
   * @returns {Promise<void>}
   */
  async clearIndex() {
    throw new Error('IMemorySearch.clearIndex() must be implemented by subclass');
  }

  /**
   * Get search index statistics
   * @returns {Promise<Object>} Index statistics
   */
  async getIndexStats() {
    throw new Error('IMemorySearch.getIndexStats() must be implemented by subclass');
  }
}

export default {
  IMemorySystem,
  IMemorySystemFactory,
  IMemoryPersistence,
  IMemorySearch
};