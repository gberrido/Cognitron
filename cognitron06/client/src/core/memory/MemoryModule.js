#!/usr/bin/env node

/**
 * Memory Module for Cognitron SDK
 * Handles MemGPT-inspired memory management and search
 */

import axios from 'axios';
import { EventEmitter } from 'events';

export class MemoryModule extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.baseUrl = config.serverUrl || 'http://localhost:8000';
    this.apiUrl = `${this.baseUrl}/api/v1/memory`;
    this.token = null;
    this.client = null;
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    this.baseUrl = this.config.serverUrl;
    this.apiUrl = `${this.baseUrl}/api/v1/memory`;
    
    // Setup axios instance
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
        const message = error.response?.data?.detail || 
                       error.response?.data?.error || 
                       error.message || 
                       'Memory request failed';
        
        if (error.response?.status === 401) {
          this.emit('auth_error', new Error('Authentication expired'));
        }
        
        throw new Error(message);
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
   * Get memory system status
   * @returns {Promise<Object>} Memory status information
   */
  async getStatus() {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.get('/status');
      this.emit('status_retrieved', response.data);
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get memory status: ${error.message}`);
    }
  }

  /**
   * Get memory pressure information
   * @returns {Promise<Object>} Memory pressure data
   */
  async getMemoryPressure() {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.get('/pressure');
      this.emit('pressure_retrieved', response.data);
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get memory pressure: ${error.message}`);
    }
  }

  /**
   * Get working context (core memories)
   * @returns {Promise<Array>} Working context entries
   */
  async getWorkingContext() {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.get('/working-context');
      this.emit('working_context_retrieved', response.data);
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get working context: ${error.message}`);
    }
  }

  /**
   * Update working context with a key-value pair
   * @param {string} key - Context key
   * @param {string} value - Context value
   * @returns {Promise<Object>} Update result
   */
  async updateWorkingContext(key, value) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.post('/working-context', {
        key,
        value
      });
      this.emit('working_context_updated', { key, value, result: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to update working context: ${error.message}`);
    }
  }

  /**
   * Delete a working context entry
   * @param {string} key - Context key to delete
   * @returns {Promise<Object>} Delete result
   */
  async deleteWorkingContext(key) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.delete(`/working-context/${key}`);
      this.emit('working_context_deleted', { key, result: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to delete working context: ${error.message}`);
    }
  }

  /**
   * Search memory for conversations and information
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Search results
   */
  async searchMemory(query, options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const searchParams = {
        query,
        max_results: options.maxResults || 10,
        session_filter: options.sessionFilter || null,
        date_filter: options.dateFilter || null,
        content_type: options.contentType || 'all',
        minimum_relevance: options.minimumRelevance || 0.0,
        ...options
      };

      const response = await this.client.post('/search', searchParams);
      this.emit('search_completed', { query, options, results: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to search memory: ${error.message}`);
    }
  }

  /**
   * Insert data into archival storage
   * @param {string} key - Storage key
   * @param {string} data - Data to store
   * @param {Object} metadata - Optional metadata
   * @returns {Promise<Object>} Insert result
   */
  async insertArchival(key, data, metadata = null) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.post('/archival', {
        key,
        data,
        metadata
      });
      this.emit('archival_inserted', { key, data, metadata, result: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to insert archival data: ${error.message}`);
    }
  }

  /**
   * Search archival memory
   * @param {string} query - Search query
   * @param {number} maxResults - Maximum results to return
   * @returns {Promise<Object>} Search results
   */
  async searchArchival(query, maxResults = 10) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.post('/archival/search', {
        query,
        max_results: maxResults
      });
      this.emit('archival_search_completed', { query, maxResults, results: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to search archival memory: ${error.message}`);
    }
  }

  /**
   * Get list of conversation sessions
   * @param {Object} options - Session query options
   * @returns {Promise<Object>} Sessions data
   */
  async getSessions(options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const params = new URLSearchParams();
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.offset) params.append('offset', options.offset.toString());
      if (options.sortBy) params.append('sort_by', options.sortBy);
      if (options.sortOrder) params.append('sort_order', options.sortOrder);

      const url = params.toString() ? `/sessions?${params}` : '/sessions';
      const response = await this.client.get(url);
      this.emit('sessions_retrieved', response.data);
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get sessions: ${error.message}`);
    }
  }

  /**
   * Get detailed information about a specific session
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Session details
   */
  async getSessionDetails(sessionId) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.get(`/sessions/${sessionId}`);
      this.emit('session_details_retrieved', { sessionId, details: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get session details: ${error.message}`);
    }
  }

  /**
   * Delete a conversation session
   * @param {string} sessionId - Session ID to delete
   * @returns {Promise<Object>} Delete result
   */
  async deleteSession(sessionId) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const response = await this.client.delete(`/sessions/${sessionId}`);
      this.emit('session_deleted', { sessionId, result: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to delete session: ${error.message}`);
    }
  }

  /**
   * Export memory data
   * @param {Object} options - Export options
   * @returns {Promise<Object>} Export data
   */
  async exportMemory(options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const exportParams = {
        format: options.format || 'json',
        include_working_context: options.includeWorkingContext !== false,
        include_archival: options.includeArchival !== false,
        include_conversations: options.includeConversations !== false,
        session_filter: options.sessionFilter || null,
        date_range: options.dateRange || null,
        ...options
      };

      const response = await this.client.post('/export', exportParams);
      this.emit('memory_exported', { options, result: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to export memory: ${error.message}`);
    }
  }

  /**
   * Import memory data
   * @param {Object} data - Memory data to import
   * @param {Object} options - Import options
   * @returns {Promise<Object>} Import result
   */
  async importMemory(data, options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const importParams = {
        data,
        merge_strategy: options.mergeStrategy || 'append',
        overwrite_existing: options.overwriteExisting || false,
        validate_data: options.validateData !== false,
        ...options
      };

      const response = await this.client.post('/import', importParams);
      this.emit('memory_imported', { options, result: response.data });
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to import memory: ${error.message}`);
    }
  }

  /**
   * Clear all memory data (dangerous operation)
   * @param {string} confirmationCode - Required confirmation code
   * @returns {Promise<Object>} Clear result
   */
  async clearAllMemory(confirmationCode) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    if (!confirmationCode) {
      throw new Error('Confirmation code required for memory clear operation');
    }

    try {
      const response = await this.client.post('/clear', {
        confirmation_code: confirmationCode
      });
      this.emit('memory_cleared', response.data);
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to clear memory: ${error.message}`);
    }
  }

  /**
   * Get memory analytics and statistics
   * @param {Object} options - Analytics options
   * @returns {Promise<Object>} Analytics data
   */
  async getAnalytics(options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const params = new URLSearchParams();
      if (options.timeRange) params.append('time_range', options.timeRange);
      if (options.granularity) params.append('granularity', options.granularity);
      if (options.includeUsage) params.append('include_usage', options.includeUsage);

      const url = params.toString() ? `/analytics?${params}` : '/analytics';
      const response = await this.client.get(url);
      this.emit('analytics_retrieved', response.data);
      return response.data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get memory analytics: ${error.message}`);
    }
  }
}