#!/usr/bin/env node

/**
 * MemGPT Tool Manager - Memory management function calls for Cognitron05
 * Implements MemGPT-style memory manipulation tools
 */

export class MemGPTToolManager {
  constructor(memorySystem = null) {
    this.memorySystem = memorySystem;
    this.tools = new Map();
    this.config = {
      maxToolCallsPerResponse: 5,
      showAgentDecisions: true
    };
    
    // Register MemGPT memory management tools
    this.registerMemoryTools();
  }

  /**
   * Register all MemGPT-inspired memory management tools
   */
  registerMemoryTools() {
    if (!this.memorySystem) return;

    // Working Context Management
    this.registerTool('core_memory_append', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'core_memory_append',
          description: 'Append to the working context (core memory). Use this to remember key facts about the user, preferences, or important information that should persist across conversations.',
          parameters: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'A concise key/label for this memory (e.g., "user_name", "favorite_food", "birthday")'
              },
              value: {
                type: 'string',
                description: 'The information to store in core memory'
              }
            },
            required: ['key', 'value']
          }
        }
      }),
      execute: async (args) => {
        const { key, value } = args;
        this.memorySystem.updateWorkingContext(key, value);
        return {
          success: true,
          message: `Added to core memory: ${key} = ${value}`,
          details: `Working context updated`
        };
      }
    });

    this.registerTool('core_memory_replace', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'core_memory_replace',
          description: 'Replace or update existing working context (core memory). Use when information has changed or needs to be corrected.',
          parameters: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'The key to update in core memory'
              },
              new_value: {
                type: 'string',
                description: 'The new value to replace the old one'
              }
            },
            required: ['key', 'new_value']
          }
        }
      }),
      execute: async (args) => {
        const { key, new_value } = args;
        const oldValue = this.memorySystem.getWorkingContext(key);
        this.memorySystem.updateWorkingContext(key, new_value);
        return {
          success: true,
          message: `Updated core memory: ${key} = ${new_value}`,
          details: oldValue ? `Previous value: ${oldValue.value}` : 'New key created'
        };
      }
    });

    // Conversation History Search
    this.registerTool('conversation_search', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'conversation_search',
          description: 'Search through conversation history to recall previous discussions. Use when the user references something from earlier conversations.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query - keywords or phrases to find in past conversations'
              },
              max_results: {
                type: 'number',
                minimum: 1,
                maximum: 20,
                description: 'Maximum number of results to return (default: 5)'
              }
            },
            required: ['query']
          }
        }
      }),
      execute: async (args) => {
        const { query, max_results = 5 } = args;
        const results = this.memorySystem.searchRecallStorage(query, { maxResults: max_results });
        
        return {
          success: true,
          message: `Found ${results.length} conversation results for: "${query}"`,
          results: results.map(r => ({
            timestamp: r.timestamp,
            role: r.role,
            content: r.content.substring(0, 200) + (r.content.length > 200 ? '...' : ''),
            relevance: r.relevanceScore
          })),
          query,
          count: results.length
        };
      }
    });

    // Archival Storage Management
    this.registerTool('archival_memory_insert', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'archival_memory_insert',
          description: 'Store structured data in archival memory for long-term retrieval. Use for complex information that doesn\'t fit in core memory.',
          parameters: {
            type: 'object',
            properties: {
              key: {
                type: 'string',
                description: 'Unique key for this archival entry'
              },
              data: {
                type: 'string',
                description: 'The data to store in archival memory'
              }
            },
            required: ['key', 'data']
          }
        }
      }),
      execute: async (args) => {
        const { key, data } = args;
        this.memorySystem.storeInArchival(key, data);
        return {
          success: true,
          message: `Stored in archival memory: ${key}`,
          details: `Data length: ${data.length} characters`
        };
      }
    });

    this.registerTool('archival_memory_search', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'archival_memory_search',
          description: 'Search archival memory for stored information.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query for archival memory'
              }
            },
            required: ['query']
          }
        }
      }),
      execute: async (args) => {
        const { query } = args;
        const results = this.memorySystem.searchArchival(query);
        
        return {
          success: true,
          message: `Found ${results.length} archival results for: "${query}"`,
          results: results.map(r => ({
            key: r.key,
            data: typeof r.data === 'string' ? r.data.substring(0, 200) : JSON.stringify(r.data).substring(0, 200),
            stored: r.metadata.stored
          })),
          query,
          count: results.length
        };
      }
    });

    // Memory Pressure Management  
    this.registerTool('pause_heartbeats', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'pause_heartbeats',
          description: 'Pause to allow user interaction. Use when you want to give the user a chance to respond before continuing.',
          parameters: {
            type: 'object',
            properties: {
              reason: {
                type: 'string',
                description: 'Reason for pausing'
              }
            },
            required: []
          }
        }
      }),
      execute: async (args) => {
        const { reason = 'Pausing for user interaction' } = args;
        return {
          success: true,
          message: reason,
          pauseExecution: true
        };
      }
    });

    // System Information
    this.registerTool('get_memory_status', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'get_memory_status',
          description: 'Get current memory system status and usage information.',
          parameters: {
            type: 'object',
            properties: {},
            required: []
          }
        }
      }),
      execute: async (args) => {
        const status = this.memorySystem.getStatus();
        const pressure = this.memorySystem.checkMemoryPressure();
        
        return {
          success: true,
          message: `Memory Status - Context: ${pressure.usage}% used`,
          details: `Working context: ${status.workingContextSize} entries, Queue: ${status.fifoQueueLength} messages, Archival: ${status.archivalStorageSize} entries`,
          status,
          memoryPressure: pressure
        };
      }
    });
  }

  /**
   * Register a tool
   */
  registerTool(name, tool) {
    this.tools.set(name, tool);
  }

  /**
   * Get all tool definitions for the AI agent
   */
  getToolDefinitions() {
    const definitions = [];
    
    for (const [name, tool] of this.tools) {
      if (tool.getToolDefinition) {
        definitions.push(tool.getToolDefinition());
      }
    }
    
    return definitions;
  }

  /**
   * Execute a tool call
   */
  async executeTool(toolCall, options = {}) {
    const { name, arguments: args } = toolCall.function;
    
    if (!this.tools.has(name)) {
      return {
        success: false,
        message: `Unknown tool: ${name}`,
        toolName: name
      };
    }

    try {
      const tool = this.tools.get(name);
      
      // Parse arguments if they're a string
      let parsedArgs = args;
      if (typeof args === 'string') {
        parsedArgs = JSON.parse(args);
      }

      const result = await tool.execute(parsedArgs, options);
      
      return {
        ...result,
        toolName: name,
        args: parsedArgs
      };
    } catch (error) {
      return {
        success: false,
        message: `Tool execution error: ${error.message}`,
        toolName: name,
        error: error.message
      };
    }
  }

  /**
   * Execute multiple tool calls in sequence
   */
  async executeToolCalls(toolCalls, options = {}) {
    const results = [];
    let pauseExecution = false;
    
    const maxCalls = Math.min(toolCalls.length, this.config.maxToolCallsPerResponse);
    
    for (const toolCall of toolCalls.slice(0, maxCalls)) {
      const result = await this.executeTool(toolCall, options);
      results.push(result);
      
      // Check if execution should be paused
      if (result.pauseExecution) {
        pauseExecution = true;
        break;
      }
    }
    
    return {
      results,
      pauseExecution,
      totalCalls: results.length
    };
  }

  /**
   * Format tool results for display
   */
  formatToolResults(results) {
    if (!this.config.showAgentDecisions) {
      return null;
    }

    let output = '\n🧠 MemGPT Memory Operations:\n';
    
    results.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const args = JSON.stringify(result.args || {}, null, 0);
      
      output += `   ${icon} ${result.toolName}(${args})\n`;
      output += `      → ${result.message}\n`;
      
      if (result.details) {
        output += `      📝 ${result.details}\n`;
      }
      
      // Special formatting for search results
      if (result.toolName === 'conversation_search' && result.results) {
        output += '      📋 Search Results:\n';
        result.results.slice(0, 3).forEach((item, idx) => {
          const timestamp = new Date(item.timestamp).toLocaleString();
          output += `        ${idx + 1}. [${timestamp}] ${item.role}: ${item.content}\n`;
        });
        if (result.results.length > 3) {
          output += `        ... and ${result.results.length - 3} more results\n`;
        }
      }
      
      if (result.toolName === 'archival_memory_search' && result.results) {
        output += '      🗃️ Archival Results:\n';
        result.results.forEach((item, idx) => {
          output += `        ${idx + 1}. ${item.key}: ${item.data}${item.data.length >= 200 ? '...' : ''}\n`;
        });
      }
    });
    
    return output;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
  }
}

export default MemGPTToolManager;