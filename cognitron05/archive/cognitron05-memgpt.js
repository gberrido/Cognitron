#!/usr/bin/env node

/**
 * Cognitron05 MemGPT - True MemGPT-style autonomous agent with tool calling
 * Features autonomous memory management where AI decides when to use memory tools
 */

import { Command } from 'commander';
import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { marked } from 'marked';
import { Groq } from 'groq-sdk';

class MemGPTCognitron {
  constructor() {
    this.config = {
      dataDir: './cognitron-memgpt-data'
    };
    
    // Direct Groq initialization (no modular providers)
    this.groq = null;
    this.model = 'openai/gpt-oss-120b';
    this.temperature = 0.7;
    this.maxTokens = 2000;
    
    this.memory = {
      // Core MemGPT memory components
      workingContext: new Map(),              // Editable core memory
      conversationContext: [],                // Dynamic FIFO queue with eviction
      recursiveSummary: '',                   // Compressed history summary
      archivalStorage: new Map(),             // Long-term structured storage
      
      // Session management  
      sessionId: null,
      messageIdCounter: 0,
      
      // Context window management (Real MemGPT)
      maxContextWindow: 8192,                 // Model's context limit
      memoryPressureThreshold: 0.70,         // 70% warning threshold
      evictionThreshold: 1.00,                // 100% forced eviction
      evictionPercentage: 0.50,               // Remove 50% on eviction
      
      // Token tracking
      currentTokenCount: 0,
      systemMessageTokens: 0,
      workingContextTokens: 0,
      conversationTokens: 0
    };
    
    this.tools = this.createMemGPTTools();
    this.isRunning = false;
  }

  async initializeGroq() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error(
        'GROQ_API_KEY environment variable is required.\n' +
        'Set it with: export GROQ_API_KEY="your-api-key-here"'
      );
    }
    
    this.groq = new Groq({ apiKey: apiKey.trim() });
    console.log(chalk.green('✅ Initialized Groq provider'));
    return true;
  }

  // Token counting (approximation - 4 chars ≈ 1 token for GPT models)
  countTokens(text) {
    if (!text) return 0;
    // More accurate approximation: account for spaces, punctuation
    const avgCharsPerToken = 4;
    return Math.ceil(text.length / avgCharsPerToken);
  }

  // Count tokens in message array
  countMessageTokens(messages) {
    return messages.reduce((total, msg) => {
      return total + this.countTokens(msg.content || '') + 4; // +4 for role/formatting overhead
    }, 0);
  }

  // Get current total token usage
  getCurrentTokenUsage() {
    const systemTokens = this.countTokens(this.buildMemGPTSystemMessage());
    const conversationTokens = this.countMessageTokens(this.memory.conversationContext);
    
    this.memory.systemMessageTokens = systemTokens;
    this.memory.conversationTokens = conversationTokens;
    this.memory.currentTokenCount = systemTokens + conversationTokens;
    
    return {
      total: this.memory.currentTokenCount,
      system: systemTokens,
      conversation: conversationTokens,
      percentage: this.memory.currentTokenCount / this.memory.maxContextWindow,
      remaining: this.memory.maxContextWindow - this.memory.currentTokenCount
    };
  }

  // Memory pressure monitoring (Real MemGPT behavior)
  checkMemoryPressure() {
    const usage = this.getCurrentTokenUsage();
    const percentage = usage.percentage;
    
    console.log(chalk.gray(`🧠 Context: ${usage.total}/${this.memory.maxContextWindow} tokens (${Math.round(percentage * 100)}%)`));
    
    if (percentage >= this.memory.evictionThreshold) {
      console.log(chalk.red('🚨 Context window full! Forcing eviction...'));
      return this.forceEvictionAndSummarize();
    } else if (percentage >= this.memory.memoryPressureThreshold) {
      console.log(chalk.yellow('⚠️ Memory pressure warning! Consider using memory tools.'));
      return this.sendMemoryPressureWarning();
    }
    
    return { action: 'continue' };
  }

  // Send memory pressure warning (Real MemGPT system message)
  sendMemoryPressureWarning() {
    const usage = this.getCurrentTokenUsage();
    const warningMessage = `⚠️ Memory pressure warning: Context window ${Math.round(usage.percentage * 100)}% full (${usage.total}/${this.memory.maxContextWindow} tokens). Consider using memory tools to preserve important information before automatic eviction occurs.`;
    
    this.addConversationMessage('system', warningMessage);
    return { action: 'memory_pressure_warning', usage };
  }

  // Force eviction and summarization (Real MemGPT mechanism)
  async forceEvictionAndSummarize() {
    const usage = this.getCurrentTokenUsage();
    console.log(chalk.red(`🔄 Evicting ${Math.round(this.memory.evictionPercentage * 100)}% of conversation context...`));
    
    const totalMessages = this.memory.conversationContext.length;
    const messagesToEvict = Math.floor(totalMessages * this.memory.evictionPercentage);
    
    if (messagesToEvict === 0) {
      console.log(chalk.yellow('⚠️ No messages to evict, clearing oldest message'));
      if (totalMessages > 0) {
        this.memory.conversationContext.shift(); // Remove oldest
      }
      return { action: 'minimal_eviction', evicted: 1 };
    }
    
    // Extract messages to evict (oldest first)
    const evictedMessages = this.memory.conversationContext.splice(0, messagesToEvict);
    
    // Generate new recursive summary
    const newSummary = await this.generateRecursiveSummary(evictedMessages);
    this.memory.recursiveSummary = newSummary;
    
    console.log(chalk.green(`✅ Evicted ${messagesToEvict} messages and updated summary`));
    
    return { 
      action: 'eviction_and_summary', 
      evicted: messagesToEvict, 
      remaining: this.memory.conversationContext.length,
      newSummary: newSummary.substring(0, 100) + '...'
    };
  }

  // Generate recursive summary (Real MemGPT intelligent summarization)
  async generateRecursiveSummary(evictedMessages) {
    try {
      const messagesText = evictedMessages
        .map(msg => `${msg.role}: ${msg.content}`)
        .join('\n');

      const summarizationPrompt = `You are a memory management system. Create a concise summary that preserves key information.

${this.memory.recursiveSummary ? `Previous Summary:\n${this.memory.recursiveSummary}\n\n` : ''}New Messages to Summarize:
${messagesText}

Instructions:
- Combine the previous summary (if exists) with new messages
- Preserve important facts, decisions, and context
- Keep user preferences and key details
- Be concise but comprehensive
- Focus on information that might be referenced later

Summary:`;

      const response = await this.llmProvider.createChatCompletion({
        messages: [
          { role: 'user', content: summarizationPrompt }
        ],
        model: this.llmConfig.model,
        temperature: 0.3, // Lower temperature for consistent summaries
        max_tokens: 400   // Limit summary size
      });

      // Validate summarization response
      if (!response.choices || response.choices.length === 0 || 
          !response.choices[0].message || !response.choices[0].message.content) {
        throw new Error('Invalid summarization response structure');
      }

      return response.choices[0].message.content.trim();
      
    } catch (error) {
      console.warn('⚠️ Summarization failed, using fallback summary');
      // Fallback: simple text summary
      const messageCount = evictedMessages.length;
      const timespan = evictedMessages.length > 0 
        ? `${evictedMessages[0].timestamp} to ${evictedMessages[evictedMessages.length - 1].timestamp}`
        : 'recent';
      
      return `${this.memory.recursiveSummary ? this.memory.recursiveSummary + ' ' : ''}Conversation summary: ${messageCount} messages from ${timespan} discussing various topics.`;
    }
  }

  createMemGPTTools() {
    return {
      core_memory_append: {
        type: 'function',
        function: {
          name: 'core_memory_append',
          description: 'Append to core memory. Use this to remember key facts about the user, preferences, or important information that should persist across conversations.',
          parameters: {
            type: 'object',
            properties: {
              key: { 
                type: 'string', 
                description: 'A concise key for this memory (e.g., "user_name", "favorite_food")' 
              },
              value: { 
                type: 'string', 
                description: 'The information to store' 
              }
            },
            required: ['key', 'value']
          }
        }
      },
      
      core_memory_replace: {
        type: 'function',
        function: {
          name: 'core_memory_replace',
          description: 'Replace existing core memory. Use when information has changed.',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'The key to update' },
              new_value: { type: 'string', description: 'The new value' }
            },
            required: ['key', 'new_value']
          }
        }
      },

      conversation_search: {
        type: 'function',
        function: {
          name: 'conversation_search',
          description: 'Search conversation history to recall previous discussions.',
          parameters: {
            type: 'object',
            properties: {
              query: { 
                type: 'string', 
                description: 'Keywords to search for in past conversations' 
              },
              max_results: { 
                type: 'number', 
                description: 'Max results to return', 
                default: 5 
              }
            },
            required: ['query']
          }
        }
      },

      archival_memory_insert: {
        type: 'function',
        function: {
          name: 'archival_memory_insert',
          description: 'Store complex information in long-term archival storage.',
          parameters: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'Storage key' },
              content: { type: 'string', description: 'Content to store' }
            },
            required: ['key', 'content']
          }
        }
      },

      archival_memory_search: {
        type: 'function',
        function: {
          name: 'archival_memory_search',
          description: 'Search archival storage for stored information.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' }
            },
            required: ['query']
          }
        }
      },

      get_memory_status: {
        type: 'function',
        function: {
          name: 'get_memory_status',
          description: 'Get current memory usage and statistics.',
          parameters: { type: 'object', properties: {} }
        }
      },

      pause_heartbeats: {
        type: 'function',
        function: {
          name: 'pause_heartbeats',
          description: 'Pause to allow user interaction. Use when you need user response.',
          parameters: {
            type: 'object',
            properties: {
              message: { type: 'string', description: 'Message to show user' }
            },
            required: ['message']
          }
        }
      }
    };
  }

  async executeMemGPTTool(toolName, args) {
    switch (toolName) {
      case 'core_memory_append':
        this.memory.workingContext.set(args.key, {
          value: args.value,
          timestamp: new Date().toISOString()
        });
        return {
          success: true,
          message: `Added to core memory: ${args.key} = ${args.value}`
        };

      case 'core_memory_replace':
        const oldValue = this.memory.workingContext.get(args.key);
        this.memory.workingContext.set(args.key, {
          value: args.new_value,
          timestamp: new Date().toISOString()
        });
        return {
          success: true,
          message: `Updated core memory: ${args.key} = ${args.new_value}`,
          previous: oldValue?.value || 'None'
        };

      case 'conversation_search':
        const searchResults = await this.searchConversations(args.query, args.max_results || 5);
        return {
          success: true,
          message: `Found ${searchResults.length} results for "${args.query}"`,
          results: searchResults
        };

      case 'archival_memory_insert':
        this.memory.archivalStorage.set(args.key, {
          content: args.content,
          timestamp: new Date().toISOString()
        });
        return {
          success: true,
          message: `Stored in archival memory: ${args.key}`
        };

      case 'archival_memory_search':
        const archivalResults = this.searchArchival(args.query);
        return {
          success: true,
          message: `Found ${archivalResults.length} archival results`,
          results: archivalResults
        };

      case 'get_memory_status':
        return {
          success: true,
          message: 'Memory status retrieved',
          status: {
            session: this.memory.sessionId,
            core_memory_entries: this.memory.workingContext.size,
            recent_messages: this.memory.recentMessages.length,
            message_counter: this.memory.messageIdCounter,
            archival_entries: this.memory.archivalStorage.size
          }
        };

      case 'pause_heartbeats':
        return {
          success: true,
          message: args.message || 'Pausing for user interaction',
          pause: true
        };

      default:
        return {
          success: false,
          message: `Unknown tool: ${toolName}`
        };
    }
  }

  async searchConversations(query, maxResults = 5) {
    const queryLower = query.toLowerCase();
    
    try {
      // Search in JSONL recall storage for better coverage
      const recallFile = path.join(this.config.dataDir, 'recall-storage.jsonl');
      const recallData = await fs.readFile(recallFile, 'utf8');
      
      if (!recallData.trim()) {
        return [];
      }
      
      const allMessages = this.parseJSONL(recallData);
      const results = allMessages
        .filter(msg => msg.content && msg.content.toLowerCase().includes(queryLower))
        .slice(-maxResults)
        .map(msg => ({
          timestamp: msg.timestamp,
          role: msg.role,
          content: (msg.content || '').substring(0, 150) + ((msg.content || '').length > 150 ? '...' : ''),
          id: msg.id
        }));
      return results;
    } catch (error) {
      // Fallback to conversation context
      const results = this.memory.conversationContext
        .filter(msg => msg.content && msg.content.toLowerCase().includes(queryLower))
        .slice(-maxResults)
        .map(msg => ({
          timestamp: msg.timestamp,
          role: msg.role,
          content: (msg.content || '').substring(0, 150) + ((msg.content || '').length > 150 ? '...' : ''),
          id: msg.id
        }));
      return results;
    }
  }

  searchArchival(query) {
    const queryLower = query.toLowerCase();
    const results = [];
    for (const [key, data] of this.memory.archivalStorage) {
      if (key.toLowerCase().includes(queryLower) || 
          (data.content && data.content.toLowerCase().includes(queryLower))) {
        results.push({
          key,
          content: (data.content || '').substring(0, 200) + ((data.content || '').length > 200 ? '...' : ''),
          timestamp: data.timestamp
        });
      }
    }
    return results;
  }

  async ensureDataDirectory() {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
    } catch (error) {
      // Directory exists
    }
  }

  generateSessionId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
    const random = Math.random().toString(36).substring(2, 8);
    return `session-${timestamp}-${random}`;
  }

  async loadMemory() {
    await this.ensureDataDirectory();
    
    try {
      // Load working context, metadata, and recursive summary
      const contextFile = path.join(this.config.dataDir, 'working-context.json');
      const contextData = JSON.parse(await fs.readFile(contextFile, 'utf8'));
      
      this.memory.workingContext = new Map(Object.entries(contextData.workingContext || {}));
      this.memory.archivalStorage = new Map(Object.entries(contextData.archivalStorage || {}));
      this.memory.sessionId = contextData.sessionId || this.generateSessionId();
      this.memory.messageIdCounter = contextData.messageIdCounter || 0;
      this.memory.recursiveSummary = contextData.recursiveSummary || '';
      
      // Load memory management settings if saved
      if (contextData.maxContextWindow) {
        this.memory.maxContextWindow = contextData.maxContextWindow;
      }
      
    } catch (error) {
      this.memory.sessionId = this.generateSessionId();
      this.memory.messageIdCounter = 0;
      this.memory.recursiveSummary = '';
    }

    try {
      // Load recent conversation context from JSONL 
      // Real MemGPT: Load based on token limit, not fixed message count
      const recallFile = path.join(this.config.dataDir, 'recall-storage.jsonl');
      const recallData = await fs.readFile(recallFile, 'utf8');
      
      if (recallData.trim()) {
        const allMessages = this.parseJSONL(recallData);
        // Load recent messages up to safe token limit (leave room for system message)
        this.loadRecentMessagesUpToLimit(allMessages);
      }
    } catch (error) {
      this.memory.conversationContext = [];
    }
  }

  // Load recent messages up to token limit (Real MemGPT behavior)
  loadRecentMessagesUpToLimit(allMessages) {
    const maxLoadTokens = Math.floor(this.memory.maxContextWindow * 0.5); // Use 50% for safety
    const systemTokens = this.countTokens(this.buildMemGPTSystemMessage());
    const availableTokens = maxLoadTokens - systemTokens;
    
    let tokenCount = 0;
    const loadedMessages = [];
    
    // Load from most recent backwards until we hit token limit
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const message = allMessages[i];
      const messageTokens = this.countTokens(message.content) + 4; // +4 for formatting
      
      if (tokenCount + messageTokens > availableTokens) {
        break;
      }
      
      tokenCount += messageTokens;
      loadedMessages.unshift(message); // Add to beginning
    }
    
    this.memory.conversationContext = loadedMessages;
    console.log(chalk.gray(`📚 Loaded ${loadedMessages.length} messages (${tokenCount} tokens)`));
  }

  async saveMemory() {
    await this.ensureDataDirectory();
    
    // Save working context, metadata, and recursive summary
    const contextFile = path.join(this.config.dataDir, 'working-context.json');
    const contextData = {
      sessionId: this.memory.sessionId,
      workingContext: Object.fromEntries(this.memory.workingContext),
      archivalStorage: Object.fromEntries(this.memory.archivalStorage),
      messageIdCounter: this.memory.messageIdCounter,
      recursiveSummary: this.memory.recursiveSummary,
      maxContextWindow: this.memory.maxContextWindow,
      memoryPressureThreshold: this.memory.memoryPressureThreshold,
      evictionThreshold: this.memory.evictionThreshold,
      evictionPercentage: this.memory.evictionPercentage,
      lastSaved: new Date().toISOString()
    };
    
    await fs.writeFile(contextFile, JSON.stringify(contextData, null, 2));
  }

  // Simple JSONL parser (each line is a JSON object)
  parseJSONL(jsonlData) {
    return jsonlData
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          console.warn('Invalid JSONL line:', line.substring(0, 100));
          return null;
        }
      })
      .filter(obj => obj !== null);
  }

  // Append message to JSONL file
  async appendToRecallStorage(message) {
    await this.ensureDataDirectory();
    
    const recallFile = path.join(this.config.dataDir, 'recall-storage.jsonl');
    const jsonLine = JSON.stringify(message) + '\n';
    
    try {
      await fs.appendFile(recallFile, jsonLine);
    } catch (error) {
      console.warn('Failed to append to recall storage:', error.message);
    }
  }

  buildMemGPTSystemMessage() {
    const coreMemory = Array.from(this.memory.workingContext.entries())
      .map(([k, v]) => `${k}: ${v.value}`)
      .join('\n') || 'Empty';

    return `You are MemGPT (Memory-Enabled GPT), an AI assistant with autonomous memory management.

## Memory System:
**Core Memory (persistent across sessions):**
${coreMemory}

**Current Session**: ${this.memory.sessionId}

## Your Function Calling Powers:
You have access to the following memory management functions:
- core_memory_append: Store key facts about user (name, preferences, etc.)
- core_memory_replace: Update existing core memories
- conversation_search: Search past conversations
- archival_memory_insert: Store complex data for long-term retrieval
- archival_memory_search: Retrieve complex stored data
- get_memory_status: Check memory usage
- pause_heartbeats: Signal you're ready for user response (REQUIRED to end interaction)

## CRITICAL: MemGPT Control Flow Instructions:

1. **ALWAYS use tools autonomously** - don't ask permission
2. **Function chaining**: You can chain multiple function calls in sequence
3. **Heartbeat mechanism**: 
   - Continue processing with more function calls as needed
   - When ready to respond to user, call pause_heartbeats with your response message
   - This signals the end of your processing cycle

4. **You MUST end every interaction by calling pause_heartbeats** with a user-facing message
5. **Think step by step**: Use functions to gather info, then respond to user
6. **Be proactive about memory**: Store important facts immediately
7. **Search when referenced**: If user mentions "earlier" or "before", search conversations

## Example Flow:
User: "My name is Alice, I love pizza"
→ core_memory_append(key="user_name", value="Alice")  
→ core_memory_append(key="food_preference", value="loves pizza")
→ pause_heartbeats(message="Nice to meet you Alice! I've noted that you love pizza. How can I help you today?")

Remember: EVERY interaction must end with pause_heartbeats containing your response to the user!`;
  }

  buildMessages() {
    const systemMessage = {
      role: 'system',
      content: this.buildMemGPTSystemMessage()
    };

    // Build context with recursive summary + conversation context
    const messages = [systemMessage];
    
    // Add recursive summary as context if it exists
    if (this.memory.recursiveSummary.trim()) {
      messages.push({
        role: 'system', 
        content: `Previous conversation summary: ${this.memory.recursiveSummary}`
      });
    }

    // Add current conversation context (dynamic FIFO queue)
    // This is the core MemGPT approach - use full context until memory pressure
    const conversationMessages = this.memory.conversationContext.map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    
    messages.push(...conversationMessages);

    if (process.env.DEBUG) {
      const totalTokens = messages.reduce((sum, msg) => sum + this.countTokens(msg.content), 0);
      console.log(chalk.gray(`🔍 Debug - Built ${messages.length} messages total (${conversationMessages.length} conversation messages, ~${totalTokens} tokens)`));
    }

    return messages;
  }

  // Add message to conversation context (Real MemGPT dynamic queue)
  addConversationMessage(role, content) {
    const message = {
      id: this.memory.messageIdCounter++,
      timestamp: new Date().toISOString(),
      sessionId: this.memory.sessionId,
      role,
      content
    };
    
    // Add to conversation context (dynamic sizing)
    this.memory.conversationContext.push(message);
    
    // Append to JSONL recall storage for persistence
    this.appendToRecallStorage(message);
    
    // Check memory pressure after adding message
    this.checkMemoryPressure();
    
    return message;
  }

  // Wrapper for user messages (includes memory pressure check)
  addMessage(role, content) {
    return this.addConversationMessage(role, content);
  }

  async generateResponse(userInput) {
    this.addMessage('user', userInput);

    try {
      // MemGPT Heartbeat Loop - AI continues until it calls pause_heartbeats
      let allToolResults = [];
      let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let userFacingMessage = null;
      let maxHeartbeats = 5; // Prevent infinite loops
      let heartbeatCount = 0;

      while (!userFacingMessage && heartbeatCount < maxHeartbeats) {
        heartbeatCount++;
        const messages = this.buildMessages();
        const toolDefinitions = Object.values(this.tools);

        // Debug logging (can be removed later)
        if (process.env.DEBUG) {
          console.log(chalk.gray(`🔍 Debug - Making API call with ${messages.length} messages, ${toolDefinitions.length} tools`));
          console.log(chalk.gray(`🔍 Debug - Provider: Groq, Model: ${this.model}`));
        }

        const response = await this.groq.chat.completions.create({
          messages,
          model: this.model,
          temperature: this.temperature,
          max_tokens: this.maxTokens,
          tools: toolDefinitions,
          tool_choice: 'auto'
        });

        // Debug response structure
        if (process.env.DEBUG) {
          console.log(chalk.gray('🔍 Debug - API Response structure:'), {
            hasChoices: !!response.choices,
            choicesLength: response.choices?.length,
            hasFirstChoice: !!response.choices?.[0],
            hasMessage: !!response.choices?.[0]?.message,
            hasContent: !!response.choices?.[0]?.message?.content,
            hasToolCalls: !!response.choices?.[0]?.message?.tool_calls
          });
        }

        // Add usage stats and monitor rate limits
        if (response.usage) {
          totalUsage.prompt_tokens += response.usage.prompt_tokens;
          totalUsage.completion_tokens += response.usage.completion_tokens;
          totalUsage.total_tokens += response.usage.total_tokens;
          
          // Monitor token usage but let MemGPT handle memory pressure naturally
          if (process.env.DEBUG && response.usage.total_tokens > 1000) {
            console.log(chalk.gray(`🔍 Debug - High token usage: ${response.usage.total_tokens} tokens`));
          }
        }

        // Validate API response structure
        if (!response.choices || response.choices.length === 0) {
          console.error('Invalid API response: no choices returned');
          throw new Error('Invalid API response structure');
        }

        const choice = response.choices[0];
        if (!choice.message) {
          console.error('Invalid API response: no message in choice');
          throw new Error('Invalid API response structure');
        }

        let assistantContent = choice.message.content || '';
        const toolCalls = choice.message.tool_calls || [];

        // Add assistant message to conversation
        if (assistantContent || toolCalls.length > 0) {
          this.addMessage('assistant', assistantContent || 'Processing with tools...');
        }

        if (process.env.DEBUG) {
          console.log(chalk.gray(`🔍 Debug - Processing response:`));
          console.log(chalk.gray(`  Assistant content: "${assistantContent}"`));
          console.log(chalk.gray(`  Tool calls: ${toolCalls.length}`));
          if (toolCalls.length > 0) {
            toolCalls.forEach((call, i) => {
              console.log(chalk.gray(`    ${i+1}. ${call.function.name}(${call.function.arguments})`));
            });
          }
        }

        if (toolCalls.length === 0) {
          // No tool calls - treat this as the final response
          userFacingMessage = assistantContent || 'I understand.';
          if (process.env.DEBUG) {
            console.log(chalk.gray(`🔍 Debug - No tool calls, using assistant content as final response`));
          }
          break;
        }

        // Process tool calls for this heartbeat
        const heartbeatToolResults = [];
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          const result = await this.executeMemGPTTool(toolName, args);
          
          heartbeatToolResults.push({ toolName, args, result });
          
          // Check for pause_heartbeats - this signals user-facing response
          if (process.env.DEBUG) {
            console.log(chalk.gray(`🔍 Debug - Executed ${toolName}: success=${result.success}, message="${result.message}"`));
          }
          
          if (toolName === 'pause_heartbeats' && result.success) {
            userFacingMessage = result.message;
            if (process.env.DEBUG) {
              console.log(chalk.gray(`🔍 Debug - Found pause_heartbeats! Setting user message: "${userFacingMessage}"`));
            }
            break;
          }
        }

        allToolResults.push(...heartbeatToolResults);
        
        // Add tool results as system message for next iteration
        if (heartbeatToolResults.length > 0 && !userFacingMessage) {
          const toolSummary = heartbeatToolResults
            .map(tr => `${tr.toolName}(${JSON.stringify(tr.args)}) -> ${tr.result.message}`)
            .join('\n');
          this.addMessage('system', `Tool results:\n${toolSummary}`);
        }
      }

      // If we hit max heartbeats without pause_heartbeats, provide default response
      if (!userFacingMessage) {
        userFacingMessage = "I've processed your request and updated my memory.";
      }

      return {
        content: userFacingMessage,
        toolCalls: allToolResults,
        usage: totalUsage,
        heartbeats: heartbeatCount
      };

    } catch (error) {
      console.error(chalk.red('API Error:'), error.message);
      
      // Log more details for debugging
      if (error.response) {
        console.error(chalk.red('Response status:'), error.response.status);
        console.error(chalk.red('Response data:'), JSON.stringify(error.response.data));
      }
      
      // Different error messages based on error type
      let errorMessage = "I'm having trouble connecting to my language service. Please try again.";
      
      if (error.message.includes('500')) {
        errorMessage = '🔧 Groq is experiencing server issues. Please try again in a moment.';
      } else if (error.message.includes('403') && error.message.includes('Free tier')) {
        errorMessage = '💳 Rate limit exceeded on Groq free tier. Please wait and try again.';
      } else if (error.message.includes('Invalid API response')) {
        errorMessage = "Received an unexpected response format. Please try again.";
      } else if (error.message.includes('rate limit')) {
        errorMessage = "Rate limit exceeded. Please wait a moment before trying again.";
      }
      
      return {
        content: errorMessage,
        toolCalls: [],
        usage: null,
        error: error.message
      };
    }
  }

  async handleCommand(input) {
    const command = input.toLowerCase();
    
    switch (command) {
      case '/exit':
      case '/quit':
        console.log(chalk.gray('\n💾 Saving memory...'));
        await this.saveMemory();
        console.log(chalk.green('✅ Memory saved!'));
        console.log(chalk.gray('👋 Goodbye!'));
        return 'exit';
        
      case '/help':
        console.log(chalk.cyan('\n📚 MemGPT Commands:'));
        console.log('  /help     - Show this help');
        console.log('  /memory   - Show current memory state');
        console.log('  /compact  - Force memory compaction to reduce API payload');
        console.log('  /clear    - Clear conversation');
        console.log('  /reset    - Reset all memory');
        console.log('  /exit     - Save and exit');
        console.log(chalk.yellow('\n🧠 MemGPT Features:'));
        console.log('  • AI autonomously manages memory with tools');
        console.log('  • Remembers facts across sessions');
        console.log('  • Searches past conversations');
        console.log('  • Stores complex information');
        return 'continue';
        
      case '/memory':
        console.log(chalk.cyan('\n🧠 MemGPT Memory Status:'));
        const usage = this.getCurrentTokenUsage();
        console.log(chalk.gray(`Session: ${this.memory.sessionId}`));
        console.log(chalk.gray(`Context: ${usage.total}/${this.memory.maxContextWindow} tokens (${Math.round(usage.percentage * 100)}%)`));
        console.log(chalk.gray(`Conversation messages: ${this.memory.conversationContext.length}`));
        console.log(chalk.gray(`Message ID counter: ${this.memory.messageIdCounter}`));
        console.log(chalk.gray(`Archival entries: ${this.memory.archivalStorage.size}`));
        
        if (this.memory.recursiveSummary) {
          console.log(chalk.yellow(`📝 Recursive summary: ${this.memory.recursiveSummary.substring(0, 100)}...`));
        }
        
        if (this.memory.workingContext.size > 0) {
          console.log(chalk.yellow('\nCore Memory:'));
          for (const [key, data] of this.memory.workingContext) {
            console.log(`  ${key}: ${data.value}`);
          }
        } else {
          console.log(chalk.gray('Core memory is empty'));
        }
        return 'continue';
        
      case '/compact':
        console.log(chalk.cyan('\n🔄 Manual memory compaction...'));
        const beforeCount = this.memory.conversationContext.length;
        
        if (beforeCount > 20) {
          // Force summarization of older messages (standard MemGPT approach)
          await this.forceEvictionAndSummarize();
          
          const afterCount = this.memory.conversationContext.length;
          console.log(chalk.green(`✅ Compacted ${beforeCount} messages down to ${afterCount}`));
          
          // Save the compacted state
          await this.saveMemory();
          console.log(chalk.green('✅ Saved compacted memory state'));
          
          console.log(chalk.cyan('💡 Older messages summarized and moved to recursive summary.'));
        } else {
          console.log(chalk.gray('Memory is already manageable (< 20 messages)'));
        }
        return 'continue';
        
      // Removed provider switching - this is Groq-only version
        
      default:
        return await this.generateResponse(input);
    }
  }

  // Removed provider switching - this is Groq-only version

  async startChat() {
    console.log(chalk.bold.cyan('🧠 Cognitron05 MemGPT - Autonomous Memory Agent'));
    console.log(chalk.gray('════════════════════════════════════════════════════'));
    
    // Initialize Groq
    await this.initializeGroq();
    
    await this.loadMemory();
    
    const usage = this.getCurrentTokenUsage();
    
    if (this.memory.conversationContext.length > 0) {
      console.log(chalk.green(`✅ Resumed session with ${this.memory.conversationContext.length} conversation messages`));
      console.log(chalk.gray(`📊 Context usage: ${usage.total}/${this.memory.maxContextWindow} tokens (${Math.round(usage.percentage * 100)}%)`));
      console.log(chalk.gray(`📊 Total messages stored: ${this.memory.messageIdCounter}`));
      console.log(chalk.yellow(`🧠 Core memories: ${this.memory.workingContext.size}`));
      
      if (this.memory.recursiveSummary) {
        console.log(chalk.cyan(`📝 Has conversation summary from previous sessions`));
      }
    } else {
      console.log(chalk.cyan('🆕 Starting new MemGPT session'));
      console.log(chalk.gray(`📊 Context limit: ${this.memory.maxContextWindow} tokens`));
      console.log(chalk.gray(`⚠️ Memory pressure warning at ${Math.round(this.memory.memoryPressureThreshold * 100)}%`));
    }
    
    console.log(chalk.gray('\nI can autonomously manage my memory using MemGPT tools.'));
    console.log(chalk.gray('Tell me about yourself and I\'ll remember for next time!\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> ')
    });

    this.isRunning = true;
    rl.prompt();

    rl.on('line', async (input) => {
      const trimmedInput = input.trim();
      
      if (!trimmedInput) {
        rl.prompt();
        return;
      }

      if (trimmedInput.startsWith('/')) {
        const result = await this.handleCommand(trimmedInput);
        if (result === 'exit') {
          rl.close();
          return;
        } else if (typeof result === 'string' || result === 'continue') {
          rl.prompt();
          return;
        }
        // If result is a response object, continue to display it
      } else {
        console.log(chalk.gray('🤖 Thinking and managing memory...'));
        var result = await this.generateResponse(trimmedInput);
      }

      // Display tool calls (MemGPT memory operations)
      if (result.toolCalls && result.toolCalls.length > 0) {
        console.log(chalk.yellow('\n🧠 MemGPT Memory Operations:'));
        for (const { toolName, result: toolResult } of result.toolCalls) {
          if (toolResult.success) {
            console.log(chalk.green(`   ✅ ${toolName}`));
            console.log(chalk.gray(`      → ${toolResult.message}`));
          } else {
            console.log(chalk.red(`   ❌ ${toolName}: ${toolResult.message}`));
          }
        }
        console.log('');
      }
      
      // Display AI response
      if (result.content) {
        console.log(marked(result.content));
      }
      
      // Show token usage and heartbeat info
      if (result.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = result.usage;
        const heartbeatInfo = result.heartbeats ? ` | ${result.heartbeats} heartbeats` : '';
        console.log(chalk.gray(`\n📊 Tokens: ${total_tokens} (${prompt_tokens} + ${completion_tokens})${heartbeatInfo}`));
      }
      
      console.log('');
      rl.prompt();
    });

    rl.on('close', () => {
      if (this.isRunning) {
        console.log(chalk.gray('\n👋 Goodbye!'));
      }
      process.exit(0);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.gray('\n\n💾 Saving memory...'));
      await this.saveMemory();
      console.log(chalk.green('✅ Memory saved!'));
      process.exit(0);
    });
  }
}

// CLI Setup
const program = new Command();

program
  .name('cognitron05-memgpt')
  .description('MemGPT-style AI Assistant with Autonomous Memory Management')
  .version('1.0.0');

program
  .action(async () => {
    const cognitron = new MemGPTCognitron();
    await cognitron.startChat();
  });

program.parse();

// Export for testing and modular usage
export { MemGPTCognitron };