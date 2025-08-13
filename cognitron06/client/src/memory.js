#!/usr/bin/env node

/**
 * Memory client for Cognitron06
 */

import axios from 'axios';

export class MemoryClient {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
    this.apiUrl = `${baseUrl}/api/v1/memory`;
    this.token = null;
    
    // Setup axios instance
    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: 10000,
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
        if (error.response) {
          throw new Error(error.response.data.detail || error.response.data.error || 'Memory request failed');
        } else if (error.request) {
          throw new Error('Cannot connect to server. Please check your connection.');
        } else {
          throw new Error(error.message);
        }
      }
    );
  }

  setToken(token) {
    this.token = token;
  }

  async getStatus() {
    try {
      const response = await this.client.get('/status');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get memory status: ${error.message}`);
    }
  }

  async getMemoryPressure() {
    try {
      const response = await this.client.get('/pressure');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get memory pressure: ${error.message}`);
    }
  }

  async getWorkingContext() {
    try {
      const response = await this.client.get('/working-context');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get working context: ${error.message}`);
    }
  }

  async updateWorkingContext(key, value) {
    try {
      const response = await this.client.post('/working-context', {
        key,
        value
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to update working context: ${error.message}`);
    }
  }

  async deleteWorkingContext(key) {
    try {
      const response = await this.client.delete(`/working-context/${key}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to delete working context: ${error.message}`);
    }
  }

  async searchMemory(query, options = {}) {
    try {
      const response = await this.client.post('/search', {
        query,
        max_results: options.maxResults || 10,
        session_filter: options.sessionFilter || null
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to search memory: ${error.message}`);
    }
  }

  async insertArchival(key, data, metadata = null) {
    try {
      const response = await this.client.post('/archival', {
        key,
        data,
        metadata
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to insert archival data: ${error.message}`);
    }
  }

  async searchArchival(query, maxResults = 10) {
    try {
      const response = await this.client.post('/archival/search', {
        query,
        max_results: maxResults
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to search archival memory: ${error.message}`);
    }
  }

  async getSessions() {
    try {
      const response = await this.client.get('/sessions');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get sessions: ${error.message}`);
    }
  }
}