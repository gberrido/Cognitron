#!/usr/bin/env node

/**
 * Models Module for Cognitron SDK
 * Handles AI model management, switching, and information
 */

import axios from 'axios';
import { EventEmitter } from 'events';

export class ModelsModule extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.baseUrl = config.serverUrl || 'http://localhost:8000';
    this.apiUrl = `${this.baseUrl}/api/v1/models`;
    this.token = null;
    this.client = null;
    this.currentModel = null;
    this.availableModels = null;
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    this.baseUrl = this.config.serverUrl;
    this.apiUrl = `${this.baseUrl}/api/v1/models`;
    
    // Setup axios instance
    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: this.config.timeout || 30000,
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
    
    // Response interceptor for error handling and data extraction
    this.client.interceptors.response.use(
      (response) => response.data, // Auto-extract data
      (error) => {
        const message = error.response?.data?.detail || 
                       error.response?.data?.error || 
                       error.message || 
                       'Models request failed';
        
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
   * Get list of all available models
   * @param {boolean} refresh - Force refresh of cached models
   * @returns {Promise<Object>} Available models with current and default info
   */
  async getAvailableModels(refresh = false) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    // Return cached models if available and not refreshing
    if (this.availableModels && !refresh) {
      return this.availableModels;
    }

    try {
      const data = await this.client.get('/available');
      this.availableModels = data;
      this.emit('models_retrieved', data);
      return data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get available models: ${error.message}`);
    }
  }

  /**
   * Get current model information
   * @param {boolean} refresh - Force refresh of cached current model
   * @returns {Promise<Object>} Current model info
   */
  async getCurrentModel(refresh = false) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    // Return cached current model if available and not refreshing
    if (this.currentModel && !refresh) {
      return this.currentModel;
    }

    try {
      const data = await this.client.get('/current');
      this.currentModel = data;
      this.emit('current_model_retrieved', data);
      return data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get current model: ${error.message}`);
    }
  }

  /**
   * Switch to a different model
   * @param {string} modelName - Name of the model to switch to
   * @returns {Promise<Object>} Switch result with new model info
   */
  async switchModel(modelName) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    if (!modelName || typeof modelName !== 'string') {
      throw new Error('Model name is required and must be a string');
    }

    try {
      const data = await this.client.post('/switch', { model: modelName });
      
      // Update cached current model
      this.currentModel = data.model_info || null;
      
      this.emit('model_switched', {
        previous_model: this.currentModel?.model || null,
        new_model: modelName,
        result: data
      });
      
      return data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to switch model: ${error.message}`);
    }
  }

  /**
   * Get detailed information about a specific model
   * @param {string} modelName - Name of the model
   * @returns {Promise<Object>} Detailed model information
   */
  async getModelInfo(modelName) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    if (!modelName || typeof modelName !== 'string') {
      throw new Error('Model name is required and must be a string');
    }

    try {
      const data = await this.client.get(`/info/${encodeURIComponent(modelName)}`);
      this.emit('model_info_retrieved', { modelName, info: data });
      return data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get model info: ${error.message}`);
    }
  }

  /**
   * Get detailed capabilities for a model
   * @param {string} modelName - Name of the model
   * @returns {Promise<Object>} Model capabilities
   */
  async getModelCapabilities(modelName) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    if (!modelName || typeof modelName !== 'string') {
      throw new Error('Model name is required and must be a string');
    }

    try {
      const data = await this.client.get(`/capabilities/${encodeURIComponent(modelName)}`);
      this.emit('model_capabilities_retrieved', { modelName, capabilities: data });
      return data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get model capabilities: ${error.message}`);
    }
  }

  /**
   * Reset to the default model
   * @returns {Promise<Object>} Reset result
   */
  async resetToDefault() {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const data = await this.client.post('/reset');
      
      // Clear cached current model to force refresh
      this.currentModel = null;
      
      this.emit('model_reset', data);
      return data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to reset to default model: ${error.message}`);
    }
  }

  /**
   * Get model performance metrics
   * @param {string} modelName - Optional specific model name
   * @returns {Promise<Object>} Performance metrics
   */
  async getModelMetrics(modelName = null) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const url = modelName ? `/metrics/${encodeURIComponent(modelName)}` : '/metrics';
      const data = await this.client.get(url);
      this.emit('model_metrics_retrieved', { modelName, metrics: data });
      return data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to get model metrics: ${error.message}`);
    }
  }

  /**
   * Test model performance with a sample prompt
   * @param {string} modelName - Name of model to test
   * @param {string} prompt - Test prompt
   * @param {Object} options - Test options
   * @returns {Promise<Object>} Test results
   */
  async testModel(modelName, prompt, options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    if (!modelName || !prompt) {
      throw new Error('Model name and prompt are required');
    }

    try {
      const testParams = {
        model: modelName,
        prompt,
        measure_latency: options.measureLatency !== false,
        measure_tokens: options.measureTokens !== false,
        include_response: options.includeResponse !== false,
        ...options
      };

      const data = await this.client.post('/test', testParams);
      this.emit('model_tested', { modelName, prompt, options, results: data });
      return data;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to test model: ${error.message}`);
    }
  }

  // Utility methods for formatting and display

  /**
   * Format model information for display
   * @param {Object} modelInfo - Model information object
   * @returns {string} Formatted string representation
   */
  formatModelInfo(modelInfo) {
    if (!modelInfo) return 'No model information available';

    const lines = [
      `Model: ${modelInfo.model || 'Unknown'}`,
      `Display Name: ${modelInfo.display_name || 'N/A'}`,
      `Description: ${modelInfo.description || 'No description available'}`,
    ];

    if (modelInfo.optimal_use_cases && Array.isArray(modelInfo.optimal_use_cases)) {
      lines.push(`Optimal Use Cases: ${modelInfo.optimal_use_cases.join(', ')}`);
    }

    if (modelInfo.capabilities) {
      lines.push('Capabilities:');
      Object.entries(modelInfo.capabilities).forEach(([key, value]) => {
        lines.push(`  ${key}: ${value}`);
      });
    }

    if (modelInfo.limits) {
      lines.push('Limits:');
      Object.entries(modelInfo.limits).forEach(([key, value]) => {
        lines.push(`  ${key}: ${value}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Format available models for display
   * @param {Object} modelsData - Available models data
   * @returns {string} Formatted string representation
   */
  formatAvailableModels(modelsData) {
    if (!modelsData) return 'No models data available';

    const lines = [
      `Current Model: ${modelsData.current_model || 'Unknown'}`,
      `Default Model: ${modelsData.default_model || 'Unknown'}`,
      '',
      'Available Models:'
    ];

    if (modelsData.available_models && Array.isArray(modelsData.available_models)) {
      modelsData.available_models.forEach((model) => {
        const current = model.model === modelsData.current_model ? ' (current)' : '';
        const defaultMarker = model.model === modelsData.default_model ? ' (default)' : '';
        
        lines.push(`  ${model.display_name || model.model}${current}${defaultMarker}`);
        lines.push(`    Model: ${model.model}`);
        
        if (model.optimal_use_cases && Array.isArray(model.optimal_use_cases)) {
          lines.push(`    Use Cases: ${model.optimal_use_cases.join(', ')}`);
        }
        
        lines.push('');
      });
    } else if (modelsData.models) {
      // Alternative format support
      Object.entries(modelsData.models).forEach(([modelName, modelInfo]) => {
        const current = modelName === modelsData.current_model ? ' (current)' : '';
        const defaultMarker = modelName === modelsData.default_model ? ' (default)' : '';
        
        lines.push(`  ${modelInfo.display_name || modelName}${current}${defaultMarker}`);
        lines.push(`    Model: ${modelName}`);
        
        if (modelInfo.optimal_use_cases && Array.isArray(modelInfo.optimal_use_cases)) {
          lines.push(`    Use Cases: ${modelInfo.optimal_use_cases.join(', ')}`);
        }
        
        lines.push('');
      });
    }

    return lines.join('\n');
  }

  /**
   * Get cached current model (no API call)
   * @returns {Object|null} Cached current model info
   */
  getCachedCurrentModel() {
    return this.currentModel;
  }

  /**
   * Get cached available models (no API call)
   * @returns {Object|null} Cached available models info
   */
  getCachedAvailableModels() {
    return this.availableModels;
  }

  /**
   * Clear cached model data
   */
  clearCache() {
    this.currentModel = null;
    this.availableModels = null;
    this.emit('cache_cleared');
  }
}