#!/usr/bin/env node

/**
 * Authentication client for Cognitron06
 */

import axios from 'axios';

export class AuthClient {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
    this.apiUrl = `${baseUrl}/api/v1/auth`;
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
          throw new Error(error.response.data.detail || error.response.data.error || 'Authentication failed');
        } else if (error.request) {
          throw new Error('Cannot connect to server. Please check your connection and server URL.');
        } else {
          throw new Error(error.message);
        }
      }
    );
  }

  setToken(token) {
    this.token = token;
  }

  async login(username, password) {
    try {
      const response = await this.client.post('/login', {
        username,
        password
      });
      
      this.token = response.data.access_token;
      return response.data;
    } catch (error) {
      throw new Error(`Login failed: ${error.message}`);
    }
  }

  async logout() {
    try {
      if (this.token) {
        await this.client.post('/logout');
        this.token = null;
      }
      return true;
    } catch (error) {
      // Even if logout fails on server, clear local token
      this.token = null;
      throw new Error(`Logout failed: ${error.message}`);
    }
  }

  async getUserInfo() {
    try {
      const response = await this.client.get('/me');
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get user info: ${error.message}`);
    }
  }

  async validateToken(token) {
    try {
      this.setToken(token);
      const userInfo = await this.getUserInfo();
      return userInfo;
    } catch (error) {
      this.token = null;
      throw new Error(`Token validation failed: ${error.message}`);
    }
  }

  async refreshToken() {
    try {
      const response = await this.client.post('/refresh');
      this.token = response.data.access_token;
      return response.data;
    } catch (error) {
      this.token = null;
      throw new Error(`Token refresh failed: ${error.message}`);
    }
  }

  isAuthenticated() {
    return !!this.token;
  }
}