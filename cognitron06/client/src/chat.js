#!/usr/bin/env node

/**
 * Chat client for Cognitron06
 */

import axios from 'axios';
import WebSocket from 'ws';

export class ChatClient {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
    this.apiUrl = `${baseUrl}/api/v1/chat`;
    this.wsUrl = baseUrl.replace('http', 'ws') + '/api/v1/ws';
    this.token = null;
    this.ws = null;
    
    // Setup axios instance
    this.client = axios.create({
      baseURL: this.apiUrl,
      timeout: 30000,
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
          throw new Error(error.response.data.detail || error.response.data.error || 'Chat request failed');
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

  async sendMessage(message, options = {}) {
    try {
      const response = await this.client.post('/message', {
        message,
        stream: false,
        ...options
      });
      
      return response.data;
    } catch (error) {
      throw new Error(`Failed to send message: ${error.message}`);
    }
  }

  async streamChat(message, callbacks = {}) {
    const { onChunk, onToolCall, onError, onComplete } = callbacks;
    
    try {
      // Use regular API call directly - no WebSocket complexity
      const response = await this.sendMessage(message);
      
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
      
      return response;
      
    } catch (error) {
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }
  }

  async streamViaWebSocket(message, callbacks) {
    const { onChunk, onToolCall, onError, onComplete } = callbacks;
    
    return new Promise((resolve, reject) => {
      try {
        // Reuse existing WebSocket connection or create new one
        if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
          const wsUrl = `${this.wsUrl}/chat?token=${encodeURIComponent(this.token)}`;
          this.ws = new WebSocket(wsUrl);
          
          this.ws.on('open', () => {
            // Send the message after connection opens
            this.sendMessageToWebSocket(message, callbacks, resolve, reject);
          });
          
          this.ws.on('error', (error) => {
            const wsError = new Error(`WebSocket error: ${error.message}`);
            if (onError) {
              onError(wsError);
            }
            reject(wsError);
          });
          
          this.ws.on('close', (code, reason) => {
            if (code !== 1000 && code !== 1005) {
              const error = new Error(`WebSocket closed unexpectedly: ${reason || code}`);
              if (onError) {
                onError(error);
              }
            }
          });
          
        } else if (this.ws.readyState === WebSocket.OPEN) {
          // Connection is already open, send message immediately
          this.sendMessageToWebSocket(message, callbacks, resolve, reject);
        } else {
          // Connection is connecting, wait for it to open
          this.ws.once('open', () => {
            this.sendMessageToWebSocket(message, callbacks, resolve, reject);
          });
        }
        
      } catch (error) {
        reject(new Error(`Failed to establish WebSocket connection: ${error.message}`));
      }
    });
  }

  sendMessageToWebSocket(message, callbacks, resolve, reject) {
    const { onChunk, onToolCall, onError, onComplete } = callbacks;
    
    let fullResponse = '';
    let messageId = Date.now().toString(); // Unique ID for this message
    
    // Set up message handler for this specific message
    const messageHandler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        
        switch (response.type) {
          case 'system':
            // System message, ignore for now
            break;
            
          case 'stream_start':
            // Stream started
            break;
            
          case 'stream_chunk':
            fullResponse += response.content;
            if (onChunk) {
              onChunk(response.content);
            }
            break;
            
          case 'stream_end':
            if (onComplete) {
              onComplete(fullResponse);
            }
            // Remove this specific message handler but keep WebSocket open
            this.ws.removeListener('message', messageHandler);
            resolve(fullResponse);
            break;
            
          case 'tool_call':
            if (onToolCall) {
              onToolCall(response);
            }
            break;
            
          case 'error':
          case 'stream_error':
            const error = new Error(response.message || 'Streaming error');
            if (onError) {
              onError(error);
            }
            // Remove this specific message handler
            this.ws.removeListener('message', messageHandler);
            reject(error);
            break;
            
          case 'typing':
            // Typing indicator, could be used for UI
            break;
            
          default:
            console.warn('Unknown WebSocket message type:', response.type);
        }
      } catch (parseError) {
        const error = new Error(`Failed to parse WebSocket message: ${parseError.message}`);
        if (onError) {
          onError(error);
        }
        // Remove this specific message handler
        this.ws.removeListener('message', messageHandler);
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

  async streamViaSSE(message, callbacks) {
    // Fallback SSE implementation (if needed)
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
        
        if (done) {
          break;
        }
        
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              
              if (data.content && !data.is_complete) {
                fullResponse += data.content;
                if (onChunk) {
                  onChunk(data.content);
                }
              } else if (data.is_complete) {
                if (onComplete) {
                  onComplete(fullResponse);
                }
                return fullResponse;
              }
            } catch (parseError) {
              console.warn('Failed to parse SSE data:', parseError.message);
            }
          }
        }
      }
      
      return fullResponse;
      
    } catch (error) {
      if (onError) {
        onError(error);
      }
      throw error;
    }
  }

  async getChatHistory(limit = 50, sessionId = null) {
    try {
      const params = new URLSearchParams();
      params.append('limit', limit.toString());
      if (sessionId) {
        params.append('session_id', sessionId);
      }
      
      const response = await this.client.get(`/history?${params}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to get chat history: ${error.message}`);
    }
  }

  async clearChatHistory(sessionId = null) {
    try {
      const params = sessionId ? `?session_id=${sessionId}` : '';
      const response = await this.client.delete(`/history${params}`);
      return response.data;
    } catch (error) {
      throw new Error(`Failed to clear chat history: ${error.message}`);
    }
  }

  closeWebSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}