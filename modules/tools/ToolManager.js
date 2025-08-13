#!/usr/bin/env node

/**
 * Tool Manager - Orchestrates all available tools for the AI agent
 * Provides a clean interface for tool registration and execution
 */

import WebSearchTool from './WebSearchTool.js';

export class ToolManager {
  constructor(memorySystem = null) {
    this.memorySystem = memorySystem;
    this.tools = new Map();
    this.config = {
      maxToolCallsPerResponse: 5,
      showAgentDecisions: true
    };
    
    // Register built-in tools
    this.registerBuiltInTools();
  }

  /**
   * Register all built-in tools
   */
  registerBuiltInTools() {
    // Web search tool
    const webSearchTool = new WebSearchTool();
    this.registerTool('search_web', webSearchTool);
    
    // Memory tools (if memory system available)
    if (this.memorySystem) {
      this.registerMemoryTools();
    }
    
    // Agent optimization tools
    this.registerAgentTools();
  }

  /**
   * Register memory-related tools
   */
  registerMemoryTools() {
    this.registerTool('search_conversation_history', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'search_conversation_history',
          description: 'Search through past conversations for relevant information. Use this when user asks about previous discussions or when context from past conversations would be helpful.',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query - keywords or phrases to find in past conversations'
              },
              date_filter: {
                type: 'string',
                enum: ['today', 'yesterday', 'week', 'month', 'all'],
                description: 'Limit search to specific time period'
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
        const results = await this.memorySystem.searchConversationHistory(args.query, {
          date_filter: args.date_filter,
          max_results: args.max_results || 5
        });
        
        return {
          success: true,
          results,
          query: args.query,
          count: results.length
        };
      }
    });
  }

  /**
   * Register agent optimization tools
   */
  registerAgentTools() {
    // Reasoning level adjustment
    this.registerTool('adjust_reasoning_level', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'adjust_reasoning_level',
          description: 'Adjust the reasoning effort level based on question complexity. Call this BEFORE providing your main response if current level is not optimal.',
          parameters: {
            type: 'object',
            properties: {
              level: {
                type: 'string',
                enum: ['low', 'medium', 'high'],
                description: 'low: simple questions, greetings, facts; medium: moderate analysis; high: complex math, logic, multi-step reasoning'
              },
              reason: {
                type: 'string',
                description: 'Brief explanation of why this reasoning level is appropriate for this question'
              }
            },
            required: ['level', 'reason']
          }
        }
      }),
      execute: (args, options) => {
        const { level, reason } = args;
        const reasoningLevels = ['low', 'medium', 'high'];
        const oldLevel = options.reasoningLevel || 'low';
        
        if (!reasoningLevels.includes(level)) {
          return { success: false, message: `Invalid reasoning level: ${level}` };
        }
        
        if (level === oldLevel) {
          return { success: true, message: `Reasoning level already optimal: ${level.toUpperCase()}` };
        }
        
        options.reasoningLevel = level;
        options.agentAdjusted = true;
        
        return {
          success: true,
          message: `Reasoning: ${oldLevel.toUpperCase()} → ${level.toUpperCase()}`,
          details: reason,
          settingsChanged: true
        };
      }
    });

    // Context management
    this.registerTool('manage_context', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'manage_context',
          description: 'Manage conversation context and memory when approaching limits or optimization is needed.',
          parameters: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['clear_oldest', 'summarize', 'adjust_limit'],
                description: 'clear_oldest: remove old messages; summarize: compress context; adjust_limit: change context percentage'
              },
              count: {
                type: 'number',
                description: 'Number of message pairs to clear (for clear_oldest action)'
              },
              percentage: {
                type: 'number',
                minimum: 10,
                maximum: 90,
                description: 'New context limit percentage (for adjust_limit action)'
              },
              reason: {
                type: 'string',
                description: 'Explanation for why this context management is needed'
              }
            },
            required: ['action', 'reason']
          }
        }
      }),
      execute: (args, options, conversationHistory) => {
        const { action, count, percentage, reason } = args;
        let result = '';
        
        switch (action) {
          case 'clear_oldest':
            const messagesToRemove = Math.min(count || 2, conversationHistory.length);
            const pairsToRemove = Math.floor(messagesToRemove / 2) * 2; // Remove in pairs
            conversationHistory.splice(0, pairsToRemove);
            result = `Cleared ${pairsToRemove} old messages`;
            break;
            
          case 'adjust_limit':
            if (percentage >= 10 && percentage <= 90) {
              const oldLimit = options.historyLimitPercent || 50;
              options.historyLimitPercent = percentage;
              result = `Context limit: ${oldLimit}% → ${percentage}%`;
            } else {
              return { success: false, message: `Invalid percentage: ${percentage}% (must be 10-90%)` };
            }
            break;
            
          case 'summarize':
            // Placeholder for future summarization feature
            result = 'Context summarization not yet implemented';
            break;
            
          default:
            return { success: false, message: `Unknown context action: ${action}` };
        }
        
        return {
          success: true,
          message: result,
          details: reason,
          settingsChanged: true
        };
      }
    });

    // Temperature adjustment
    this.registerTool('adjust_temperature', {
      getToolDefinition: () => ({
        type: 'function',
        function: {
          name: 'adjust_temperature',
          description: 'Adjust response creativity/randomness based on task type.',
          parameters: {
            type: 'object',
            properties: {
              temperature: {
                type: 'number',
                minimum: 0.1,
                maximum: 2.0,
                description: 'Lower values (0.1-0.5) for factual/precise tasks, higher (0.8-1.5) for creative tasks'
              },
              reason: {
                type: 'string',
                description: 'Explanation for why this temperature adjustment is needed'
              }
            },
            required: ['temperature', 'reason']
          }
        }
      }),
      execute: (args, options) => {
        const { temperature, reason } = args;
        
        if (temperature < 0.1 || temperature > 2.0) {
          return { success: false, message: `Invalid temperature: ${temperature} (must be 0.1-2.0)` };
        }
        
        const oldTemp = options.temperature || 0.7;
        options.temperature = temperature;
        
        return {
          success: true,
          message: `Temperature: ${oldTemp} → ${temperature}`,
          details: reason,
          settingsChanged: true
        };
      }
    });
  }

  /**
   * Register a new tool
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
  async executeTool(toolCall, options = {}, conversationHistory = []) {
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

      const result = await tool.execute(parsedArgs, options, conversationHistory);
      
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
  async executeToolCalls(toolCalls, options = {}, conversationHistory = []) {
    const results = [];
    let settingsChanged = false;
    
    const maxCalls = Math.min(toolCalls.length, this.config.maxToolCallsPerResponse);
    
    for (const toolCall of toolCalls.slice(0, maxCalls)) {
      const result = await this.executeTool(toolCall, options, conversationHistory);
      results.push(result);
      
      // Check if any tool changed settings
      if (result.settingsChanged) {
        settingsChanged = true;
      }
    }
    
    return {
      results,
      settingsChanged,
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

    let output = '\n🔧 Agent Tool Calls:\n';
    
    results.forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const args = JSON.stringify(result.args || {}, null, 0);
      
      output += `   ${icon} ${result.toolName}(${args})\n`;
      output += `      → ${result.message}\n`;
      
      if (result.details) {
        output += `      📝 ${result.details}\n`;
      }
      
      // Special formatting for specific tool types
      if (result.toolName === 'search_web' && result.results) {
        output += '      🌐 Web Results:\n';
        result.results.forEach((item, idx) => {
          const preview = item.snippet.substring(0, 80);
          output += `        ${idx + 1}. [${item.source}] ${item.title}\n`;
          output += `           ${preview}${item.snippet.length > 80 ? '...' : ''}\n`;
          if (item.url) {
            output += `           URL: ${item.url}\n`;
          }
        });
      }
      
      if (result.toolName === 'search_conversation_history' && result.results) {
        output += '      📋 Search Results:\n';
        result.results.forEach((msg, idx) => {
          const preview = msg.content.substring(0, 80);
          const timestamp = new Date(msg.timestamp).toLocaleString();
          output += `        ${idx + 1}. [${timestamp}] ${preview}${msg.content.length > 80 ? '...' : ''}\n`;
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

export default ToolManager;