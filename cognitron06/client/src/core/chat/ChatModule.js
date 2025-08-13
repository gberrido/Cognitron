#!/usr/bin/env node

/**
 * Chat Module for Cognitron SDK
 * Handles chat communication with multiple transport methods
 */

import axios from 'axios';
import WebSocket from 'ws';
import { EventEmitter } from 'events';

export class ChatModule extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.baseUrl = config.serverUrl || 'http://localhost:8000';
    this.apiUrl = `${this.baseUrl}/api/v1/chat`;
    this.wsUrl = this.baseUrl.replace('http', 'ws') + '/api/v1/ws';
    this.token = null;
    this.client = null;
    this.ws = null;
  }

  async initialize(config) {
    this.config = { ...this.config, ...config };
    this.baseUrl = this.config.serverUrl;
    this.apiUrl = `${this.baseUrl}/api/v1/chat`;
    this.wsUrl = this.baseUrl.replace('http', 'ws') + '/api/v1/ws';
    
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
    
    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        const data = error.response?.data;
        const message = data?.detail || data?.error || error.message || 'Chat request failed';
        if (error.response?.status === 401) {
          this.emit('auth_error', new Error('Authentication expired', { cause: error }));
        }
        const wrapped = new Error(message, { cause: error });
        if (data) wrapped.data = data;
        throw wrapped;
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
   * Send a message to the AI assistant
   * @param {string} message - The message to send
   * @param {Object} options - Chat options
   * @returns {Promise<Object>} Response from AI
   */
  async sendMessage(message, options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated. Please authenticate first.');
    }

    try {
      const requestData = {
        message,
        stream: options.stream || false,
        model: options.model,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        ...options
      };

      const response = await this.client.post('/message', requestData);
      
      // Emit events for SDK users
      this.emit('message_sent', { message, options });
      this.emit('response_received', response.data);
      
      return response.data;
    } catch (error) {
      this.emit('error', error);
      const wrapped = new Error(`Failed to send message: ${error.message}`, { cause: error });
      if (error.data) wrapped.data = error.data;
      throw wrapped;
    }
  }

  /**
   * Stream a chat conversation with callbacks
   * @param {string} message - The message to send
   * @param {Object} callbacks - Streaming callbacks
   * @returns {Promise<string>} Complete response
   */
  async streamChat(message, callbacks = {}) {
    const { onChunk, onToolCall, onError, onComplete, onStart } = callbacks;
    
    try {
      // Emit start event
      if (onStart) onStart();
      this.emit('stream_start', { message });
      
      // Use WebSocket streaming if enabled and available
      if (this.config.enableStreaming && this.config.preferWebSocket) {
        return await this.streamViaWebSocket(message, callbacks);
      }
      
      // Use SSE streaming if available
      if (this.config.enableStreaming && this.config.preferSSE) {
        return await this.streamViaSSE(message, callbacks);
      }
      
      // Fallback to regular API call with simulated streaming
      const response = await this.sendMessage(message);
      
      // Display thinking/reasoning if available (for thinking models)
      if (response.thinking && callbacks.onThinking) {
        callbacks.onThinking(response.thinking);
      }
      
      // Display response content immediately
      if (response.content && onChunk) {
        onChunk(response.content);
      }
      
      // Display tool calls if any
      if (response.tool_calls && response.tool_calls.length > 0 && onToolCall) {
        response.tool_calls.forEach(toolCall => onToolCall(toolCall));
      }
      
      // Call completion callback
      if (onComplete) {
        onComplete(response);
      }
      
      this.emit('stream_complete', response);
      return response;
      
    } catch (error) {
      this.emit('stream_error', error);
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }
  }

  /**
   * Stream via WebSocket
   * @private
   */
  async streamViaWebSocket(message, callbacks) {
    const { onChunk, onToolCall, onError, onComplete } = callbacks;
    
    return new Promise((resolve, reject) => {
      try {
        // Reuse existing WebSocket connection or create new one
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          const wsUrl = `${this.wsUrl}/chat?token=${encodeURIComponent(this.token)}`;
          this.ws = new WebSocket(wsUrl);
          
          this.ws.on('open', () => {
            this.sendMessageToWebSocket(message, callbacks, resolve, reject);
          });
          
          this.ws.on('error', (error) => {
            const wsError = new Error(`WebSocket error: ${error.message}`);
            this.emit('websocket_error', wsError);
            if (onError) onError(wsError);
            reject(wsError);
          });
          
          this.ws.on('close', (code, reason) => {
            if (code !== 1000 && code !== 1005) {
              const error = new Error(`WebSocket closed unexpectedly: ${reason || code}`);
              this.emit('websocket_close', { code, reason });
              if (onError) onError(error);
            }
          });
          
        } else if (this.ws.readyState === WebSocket.OPEN) {
          this.sendMessageToWebSocket(message, callbacks, resolve, reject);
        } else {
          this.ws.once('open', () => {
            this.sendMessageToWebSocket(message, callbacks, resolve, reject);
          });
        }
        
      } catch (error) {
        reject(new Error(`Failed to establish WebSocket connection: ${error.message}`));
      }
    });
  }

  /**
   * Send message via WebSocket
   * @private
   */
  sendMessageToWebSocket(message, callbacks, resolve, reject) {
    const { onChunk, onToolCall, onError, onComplete } = callbacks;
    
    let fullResponse = '';
    let messageId = Date.now().toString();
    
    const messageHandler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        
        switch (response.type) {
          case 'stream_start':
            this.emit('websocket_stream_start', response);
            break;
            
          case 'stream_chunk':
            fullResponse += response.content;
            if (onChunk) onChunk(response.content);
            this.emit('websocket_chunk', response);
            break;
            
          case 'thinking':
          case 'reasoning':
            if (callbacks.onThinking) callbacks.onThinking(response.content);
            this.emit('websocket_thinking', response);
            break;
            
          case 'stream_end':
            if (onComplete) onComplete(fullResponse);
            this.ws.removeListener('message', messageHandler);
            this.emit('websocket_stream_end', fullResponse);
            resolve(fullResponse);
            break;
            
          case 'tool_call':
            if (onToolCall) onToolCall(response);
            this.emit('websocket_tool_call', response);
            break;
            
          case 'error':
          case 'stream_error':
            const error = new Error(response.message || 'Streaming error');
            if (onError) onError(error);
            this.ws.removeListener('message', messageHandler);
            this.emit('websocket_error', error);
            reject(error);
            break;
            
          case 'system':
          case 'typing':
            // Informational messages, emit events but don't handle
            this.emit('websocket_system', response);
            break;
            
          default:
            if (this.config.debug) {
              console.warn('Unknown WebSocket message type:', response.type);
            }
        }
      } catch (parseError) {
        const error = new Error(`Failed to parse WebSocket message: ${parseError.message}`);
        if (onError) onError(error);
        this.ws.removeListener('message', messageHandler);
        this.emit('websocket_parse_error', error);
        reject(error);
      }
    };
    
    // Add message handler for this specific message
    this.ws.on('message', messageHandler);
    
    // Send the chat message
    this.ws.send(JSON.stringify({
      type: 'chat',
      message: message,
      message_id: messageId,
      stream: true
    }));
  }

  /**
   * Stream via Server-Sent Events
   * @private
   */
  async streamViaSSE(message, callbacks) {
    const { onChunk, onError, onComplete } = callbacks;
    
    try {
      const response = await fetch(`${this.apiUrl}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify({
          message: message,
          stream: true
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.content && !data.is_complete) {
                fullResponse += data.content;
                if (onChunk) onChunk(data.content);
                this.emit('sse_chunk', data);
              } else if (data.is_complete) {
                if (onComplete) onComplete(fullResponse);
                this.emit('sse_complete', fullResponse);
                return fullResponse;
              }
            } catch (parseError) {
              if (this.config.debug) {
                console.warn('Failed to parse SSE data:', parseError.message);
              }
            }
          }
        }
      }
      
      return fullResponse;
      
    } catch (error) {
      this.emit('sse_error', error);
      if (onError) onError(error);
      throw error;
    }
  }

  /**
   * Get chat history
   * @param {Object} options - History options
   * @returns {Promise<Object>} Chat history
   */
  async getChatHistory(options = {}) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const params = new URLSearchParams();
      if (options.limit) params.append('limit', options.limit.toString());
      if (options.sessionId) params.append('session_id', options.sessionId);
      if (options.before) params.append('before', options.before);
      if (options.after) params.append('after', options.after);
      
      const response = await this.client.get(`/history?${params}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get chat history: ${error.message}`);
    }
  }

  /**
   * Clear chat history
   * @param {string} sessionId - Optional session ID to clear
   * @returns {Promise<Object>} Clear result
   */
  async clearChatHistory(sessionId = null) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    try {
      const params = sessionId ? `?session_id=${sessionId}` : '';
      const response = await this.client.delete(`/history${params}`);
      this.emit('history_cleared', { sessionId });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to clear chat history: ${error.message}`);
    }
  }

  /**
   * Close WebSocket connection
   */
  closeWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.emit('websocket_closed');
    }
  }

  /**
   * Check if WebSocket is connected
   * @returns {boolean} Connection status
   */
  isWebSocketConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
