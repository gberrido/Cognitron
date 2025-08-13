/**
 * Model Management Client for Cognitron06
 * Handles model selection and switching functionality
 */

import axios from 'axios';

export class ModelsClient {
  constructor(baseURL, token = null) {
    this.baseURL = baseURL.replace(/\/$/, ''); // Remove trailing slash
    this.token = token;
    this.apiClient = axios.create({
      baseURL: `${this.baseURL}/api/v1/models`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add interceptor to include auth token
    this.apiClient.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }
      return config;
    });

    // Response interceptor for error handling
    this.apiClient.interceptors.response.use(
      (response) => response.data,
      (error) => {
        const message = error.response?.data?.detail || error.message || 'Unknown error';
        throw new Error(message);
      }
    );
  }

  setToken(token) {
    this.token = token;
  }

  /**
   * Get list of all available models
   * @returns {Promise<Object>} Available models with current and default info
   */
  async getAvailableModels() {
    try {
      return await this.apiClient.get('/available');
    } catch (error) {
      throw new Error(`Failed to get available models: ${error.message}`);
    }
  }

  /**
   * Get current model information
   * @returns {Promise<Object>} Current model info
   */
  async getCurrentModel() {
    try {
      return await this.apiClient.get('/current');
    } catch (error) {
      throw new Error(`Failed to get current model: ${error.message}`);
    }
  }

  /**
   * Switch to a different model
   * @param {string} modelName - Name of the model to switch to
   * @returns {Promise<Object>} Switch result
   */
  async switchModel(modelName) {
    try {
      return await this.apiClient.post('/switch', { model: modelName });
    } catch (error) {
      throw new Error(`Failed to switch model: ${error.message}`);
    }
  }

  /**
   * Get information about a specific model
   * @param {string} modelName - Name of the model
   * @returns {Promise<Object>} Model information
   */
  async getModelInfo(modelName) {
    try {
      return await this.apiClient.get(`/info/${encodeURIComponent(modelName)}`);
    } catch (error) {
      throw new Error(`Failed to get model info: ${error.message}`);
    }
  }

  /**
   * Get detailed capabilities for a model
   * @param {string} modelName - Name of the model
   * @returns {Promise<Object>} Model capabilities
   */
  async getModelCapabilities(modelName) {
    try {
      return await this.apiClient.get(`/capabilities/${encodeURIComponent(modelName)}`);
    } catch (error) {
      throw new Error(`Failed to get model capabilities: ${error.message}`);
    }
  }

  /**
   * Reset to the default model
   * @returns {Promise<Object>} Reset result
   */
  async resetToDefault() {
    try {
      return await this.apiClient.post('/reset');
    } catch (error) {
      throw new Error(`Failed to reset to default model: ${error.message}`);
    }
  }

  /**
   * Format model information for display
   * @param {Object} modelInfo - Model information object
   * @returns {string} Formatted string
   */
  formatModelInfo(modelInfo) {
    const lines = [
      `Model: ${modelInfo.model}`,
      `Display Name: ${modelInfo.display_name}`,
      `Description: ${modelInfo.description}`,
      `Optimal Use Cases: ${modelInfo.optimal_use_cases.join(', ')}`,
    ];

    if (modelInfo.capabilities) {
      lines.push('Capabilities:');
      Object.entries(modelInfo.capabilities).forEach(([key, value]) => {
        lines.push(`  ${key}: ${value}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * Format available models for display
   * @param {Object} modelsData - Available models data
   * @returns {string} Formatted string
   */
  formatAvailableModels(modelsData) {
    const lines = [
      `Current Model: ${modelsData.current_model}`,
      `Default Model: ${modelsData.default_model}`,
      '',
      'Available Models:'
    ];

    Object.entries(modelsData.models).forEach(([modelName, modelInfo]) => {
      const current = modelName === modelsData.current_model ? ' (current)' : '';
      const defaultMarker = modelName === modelsData.default_model ? ' (default)' : '';
      
      lines.push(`  ${modelInfo.display_name}${current}${defaultMarker}`);
      lines.push(`    Model: ${modelName}`);
      lines.push(`    Use Cases: ${modelInfo.optimal_use_cases.join(', ')}`);
      lines.push('');
    });

    return lines.join('\n');
  }
}