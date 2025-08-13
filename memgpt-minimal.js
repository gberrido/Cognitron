#!/usr/bin/env node

/**
 * Minimalist MemGPT Implementation
 * A self-contained CLI conversation agent with hierarchical memory management
 * Based on the research paper "MemGPT: Towards LLMs as Operating Systems"
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import readline from 'readline';

// LLM Provider imports
import { Groq } from 'groq-sdk';
import Together from 'together-ai';

// Configuration
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MEMORY_DIR = path.join(__dirname, 'memory');

// Memory limits per model (tokens)
const MODEL_LIMITS = {
  'openai/gpt-oss-120b': { total: 32000, warning: 22400, flush: 32000 },
  'gpt-4': { total: 8192, warning: 5734, flush: 8192 },
  'gpt-3.5-turbo': { total: 16385, warning: 11470, flush: 16385 }
};

// Default configuration
const CONFIG = {
  model: 'openai/gpt-oss-120b',
  provider: 'groq', // only 'groq' supported in this version
  temperature: 0.7,
  maxTokens: 4096,
  memoryDir: MEMORY_DIR,
  agentId: 'default-agent'
};

class MemGPT {
  constructor(config = {}) {
    this.config = { ...CONFIG, ...config };
    this.memory = null;
    this.llm = null;
    this.messageQueue = [];
    this.workingContext = {
      persona: "I am MemGPT, an AI assistant with persistent memory and self-directed memory management.",
      user: "User information will be learned and stored here during our conversation."
    };
    this.systemPrompt = this.buildSystemPrompt();
    this.conversationActive = true;
    this.showThinking = false;
    this.streamEnabled = false;
  }

  async initialize() {
    // Initialize LLM provider
    this.initializeLLM();
    
    // Initialize memory system
    this.memory = new MemoryManager(this.config.memoryDir, this.config.agentId);
    await this.memory.initialize();

    // Load existing agent state
    await this.loadAgentState();
    
    console.log('🧠 MemGPT initialized with hierarchical memory management');
    console.log(`📦 Model: ${this.config.model} via ${this.config.provider}`);
    console.log(`💾 Memory: ${this.config.memoryDir}`);
    console.log('Type /help for commands, /exit to quit\n');
  }

  initializeLLM() {
    if (this.config.provider === 'groq') {
      if (!process.env.GROQ_API_KEY) {
        throw new Error('GROQ_API_KEY environment variable is required');
      }
      this.llm = new Groq({ apiKey: process.env.GROQ_API_KEY });
    } else if (this.config.provider === 'together') {
      if (!process.env.TOGETHER_API_KEY) {
        throw new Error('TOGETHER_API_KEY environment variable is required');
      }
      this.llm = new Together({ apiKey: process.env.TOGETHER_API_KEY });
    } else {
      throw new Error(`Unsupported provider: ${this.config.provider}. Supported: 'groq', 'together'.`);
    }
  }

  buildSystemPrompt() {
    return `You are MemGPT, an AI assistant with hierarchical memory management inspired by operating systems.

MEMORY HIERARCHY:
- Working Context: Your current personality and user information (editable via functions)
- Message Queue: Recent conversation history (automatically managed)
- Recall Storage: Full conversation history (searchable via functions)
- Archival Storage: Documents and knowledge base (searchable via functions)

AVAILABLE FUNCTIONS:
1. working_context_replace(old_content, new_content) - Update working context
2. working_context_append(new_content) - Add to working context
3. recall_storage_search(query, page=1) - Search conversation history
4. archival_storage_search(query, page=1) - Search knowledge base
5. archival_storage_insert(content) - Add document to knowledge base

MEMORY MANAGEMENT RULES:
- Monitor for memory pressure warnings - when you see them, save important info to working context
- Use recall_storage_search to find relevant past conversations
- Use archival_storage for persistent knowledge and documents
- Request heartbeat (set request_heartbeat=true) for multi-step operations
- Be proactive about memory management - don't wait for warnings

CURRENT WORKING CONTEXT:
Persona: {{PERSONA}}
User: {{USER}}

Remember: You have persistent memory across sessions. Use your functions to maintain context and provide personalized, consistent responses.`;
  }

  async loadAgentState() {
    try {
      const agentPath = path.join(this.config.memoryDir, 'agents', `${this.config.agentId}.json`);
      const data = await fs.readFile(agentPath, 'utf-8');
      const state = JSON.parse(data);
      this.workingContext = state.workingContext || this.workingContext;
    } catch (error) {
      // Agent doesn't exist yet, will be created on first save
    }
  }

  async saveAgentState() {
    try {
      const agentsDir = path.join(this.config.memoryDir, 'agents');
      await fs.mkdir(agentsDir, { recursive: true });
      
      const agentPath = path.join(agentsDir, `${this.config.agentId}.json`);
      const state = {
        agentId: this.config.agentId,
        workingContext: this.workingContext,
        lastUpdated: new Date().toISOString()
      };
      await fs.writeFile(agentPath, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Error saving agent state:', error.message);
    }
  }

  formatSystemPrompt() {
    return this.systemPrompt
      .replace('{{PERSONA}}', this.workingContext.persona)
      .replace('{{USER}}', this.workingContext.user);
  }

  buildMessages() {
    const messages = [
      { role: 'system', content: this.formatSystemPrompt() }
    ];

    // Add message queue
    messages.push(...this.messageQueue);

    return messages;
  }

  async estimateTokens(messages) {
    // Rough token estimation (1 token ≈ 4 characters)
    const content = messages.map(m => m.content).join(' ');
    return Math.ceil(content.length / 4);
  }

  async checkMemoryPressure(messages) {
    const tokens = await this.estimateTokens(messages);
    const limits = MODEL_LIMITS[this.config.model] || MODEL_LIMITS['openai/gpt-oss-120b'];
    
    if (tokens >= limits.flush) {
      await this.flushMessageQueue();
      return 'FLUSH';
    } else if (tokens >= limits.warning) {
      return 'WARNING';
    }
    return 'OK';
  }

  async flushMessageQueue() {
    if (this.messageQueue.length === 0) return;

    // Save messages to recall storage
    for (const message of this.messageQueue) {
      await this.memory.addMessage(message);
    }

    // Create summary of evicted messages
    const summary = `[SUMMARY: Conversation included ${this.messageQueue.length} messages about: ${this.extractTopics(this.messageQueue)}]`;
    
    // Keep only the summary
    this.messageQueue = [{ role: 'system', content: summary }];
    
    console.log('🗑️  Memory flushed - older messages moved to recall storage');
  }

  extractTopics(messages) {
    // Simple topic extraction - in a real implementation this could be more sophisticated
    const content = messages.map(m => m.content).join(' ').toLowerCase();
    const commonWords = ['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up', 'about', 'into', 'over', 'after'];
    const words = content.split(/\s+/).filter(word => 
      word.length > 3 && !commonWords.includes(word)
    );
    const wordFreq = {};
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
    return Object.entries(wordFreq)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word)
      .join(', ');
  }

  async callLLM(messages, functions = null) {
    try {
      const params = {
        messages,
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens
      };

      if (functions) {
        params.tools = functions.map(func => ({
          type: 'function',
          function: func
        }));
        params.tool_choice = 'auto';
      }

      if (this.config.provider === 'groq') {
        if (functions) {
          // Groq doesn't support tools yet, simulate function calling via text
          return await this.simulateFunctionCalling(messages);
        }
        const response = await this.llm.chat.completions.create(params);
        if (!response?.choices?.[0]?.message) {
          throw new Error('Invalid response format from Groq API');
        }
        return response.choices[0].message;
      } else if (this.config.provider === 'together') {
        // Together AI is OpenAI-compatible; supports tools. Fall back to simulation if tools cause errors.
        try {
          const response = await this.llm.chat.completions.create(params);
          if (!response?.choices?.[0]?.message) {
            throw new Error('Invalid response format from Together API');
          }
          return response.choices[0].message;
        } catch (e) {
          if (functions) {
            // Fallback: simulate function calling via text protocol
            return await this.simulateFunctionCalling(messages);
          }
          throw e;
        }
      } else {
        throw new Error(`Unsupported provider: ${this.config.provider}`);
      }
    } catch (error) {
      console.error('LLM API Error:', error.message);
      return {
        role: 'assistant',
        content: `I apologize, but I encountered an error: ${error.message}. Please try again.`
      };
    }
  }

  async callLLMStream(messages, functions = null) {
    const body = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: true
    };
    if (functions) {
      body.tools = functions.map(func => ({ type: 'function', function: func }));
      body.tool_choice = 'auto';
    }
    let url, headers;
    if (this.config.provider === 'groq') {
      url = 'https://api.groq.com/openai/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` };
    } else if (this.config.provider === 'together') {
      url = 'https://api.together.xyz/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}` };
    } else {
      throw new Error(`Unsupported provider for streaming: ${this.config.provider}`);
    }

    let build = '';
    let inThink = false;
    const onDelta = (tok) => {
      const lower = tok.toLowerCase();
      if (lower.includes('<think>') || lower.includes('```thinking') || lower.includes('```thought') || lower.includes('```reasoning')) inThink = true;
      if (lower.includes('</think>') || (lower.includes('```') && inThink)) inThink = false;
      const isThinkToken = inThink || /<\/?think>|```(?:thinking|thought|reasoning)/i.test(tok);
      if (isThinkToken) {
        if (this.showThinking) process.stdout.write(tok);
        if (this.showThinking) build += tok;
      } else {
        process.stdout.write(tok);
        build += tok;
      }
    };
    try {
      await sseChat(url, headers, body, onDelta);
      process.stdout.write('\n');
      return { role: 'assistant', content: build };
    } catch (e) {
      return { role: 'assistant', content: `Error from streaming: ${e.message}` };
    }
  }

  async simulateFunctionCalling(messages) {
    try {
      // Simplified function calling - just add instructions to system prompt
      const enhancedMessages = [...messages];
      const originalSystem = enhancedMessages[0].content;
      
      enhancedMessages[0].content = originalSystem + `

FUNCTION CALLING INSTRUCTIONS:
When you need to use a function, respond with BOTH:
1. Your regular response to the user
2. A function call in this EXACT format on a new line:

FUNCTION_CALL: {"function": "function_name", "args": {"param": "value"}}

Available functions:
- working_context_replace: Update working context
- working_context_append: Add to working context  
- recall_storage_search: Search conversation history

Example:
Hello! I'll remember that information.

FUNCTION_CALL: {"function": "working_context_append", "args": {"new_content": "User likes pizza"}}
`;

      const response = await this.llm.chat.completions.create({
        messages: enhancedMessages,
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens
      });

      if (!response?.choices?.[0]?.message) {
        throw new Error('Invalid response format');
      }

      return response.choices[0].message;
    } catch (error) {
      console.error('Function calling simulation error:', error.message);
      return {
        role: 'assistant',
        content: `I apologize, but I encountered an error: ${error.message}. Please try again.`
      };
    }
  }

  async executeFunctions(content) {
    const functionCalls = [];
    let responseText = content || '';

    // Ensure content is a string
    if (typeof content !== 'string') {
      console.error('executeFunctions received non-string content:', content);
      return { responseText: '', functionCalls: [] };
    }

    // Look for FUNCTION_CALL: pattern
    const lines = content.split('\n');
    const cleanedLines = [];
    
    for (const line of lines) {
      if (line.startsWith('FUNCTION_CALL:')) {
        try {
          const jsonStr = line.replace('FUNCTION_CALL:', '').trim();
          const funcCall = JSON.parse(jsonStr);
          
          if (funcCall.function && funcCall.args) {
            const result = await this.executeFunction(funcCall.function, funcCall.args);
            functionCalls.push({ call: funcCall, result });
            console.log(`🔧 Executing: ${funcCall.function}(${JSON.stringify(funcCall.args)})`);
          }
        } catch (error) {
          console.error('Function parsing error:', error.message);
          console.error('Failed to parse:', line);
          // Keep the line in response if it can't be parsed
          cleanedLines.push(line);
        }
      } else {
        cleanedLines.push(line);
      }
    }

    responseText = cleanedLines.join('\n').trim();
    return { responseText, functionCalls };
  }

  async executeFunction(functionName, args) {
    try {
      switch (functionName) {
        case 'working_context_replace':
          return await this.workingContextReplace(args.old_content, args.new_content);
        
        case 'working_context_append':
          return await this.workingContextAppend(args.new_content);
        
        case 'recall_storage_search':
          return await this.memory.searchMessages(args.query, args.page || 1);
        
        case 'archival_storage_search':
          return await this.memory.searchDocuments(args.query, args.page || 1);
        
        case 'archival_storage_insert':
          return await this.memory.insertDocument(args.content);
        
        default:
          return { error: `Unknown function: ${functionName}` };
      }
    } catch (error) {
      return { error: error.message };
    }
  }

  async workingContextReplace(oldContent, newContent) {
    const oldPersona = this.workingContext.persona;
    const oldUser = this.workingContext.user;

    // Replace in persona
    if (this.workingContext.persona.includes(oldContent)) {
      this.workingContext.persona = this.workingContext.persona.replace(oldContent, newContent);
    }
    
    // Replace in user info
    if (this.workingContext.user.includes(oldContent)) {
      this.workingContext.user = this.workingContext.user.replace(oldContent, newContent);
    }

    await this.saveAgentState();
    return { success: true, message: `Replaced "${oldContent}" with "${newContent}" in working context` };
  }

  async workingContextAppend(newContent) {
    // Determine whether to append to persona or user info based on content
    if (newContent.toLowerCase().includes('user') || newContent.toLowerCase().includes('their') || 
        newContent.toLowerCase().includes('they') || newContent.toLowerCase().includes('preference')) {
      this.workingContext.user += ' ' + newContent;
    } else {
      this.workingContext.persona += ' ' + newContent;
    }

    await this.saveAgentState();
    return { success: true, message: `Appended "${newContent}" to working context` };
  }

  async processMessage(userInput) {
    // Handle commands
    if (userInput.startsWith('/')) {
      return await this.handleCommand(userInput);
    }

    // Add user message to queue
    this.messageQueue.push({ role: 'user', content: userInput });
    await this.memory.addMessage({ role: 'user', content: userInput });

    // Check memory pressure
    const messages = this.buildMessages();
    const memoryStatus = await this.checkMemoryPressure(messages);

    if (memoryStatus === 'WARNING') {
      this.messageQueue.push({
        role: 'system',
        content: 'System Alert: Memory Pressure - Context window approaching capacity. Consider moving important information to working context or searching recall storage.'
      });
    }

    // Define available functions
    const availableFunctions = [
      {
        name: 'working_context_replace',
        description: 'Replace content in working context',
        parameters: {
          type: 'object',
          properties: {
            old_content: { type: 'string', description: 'Content to replace' },
            new_content: { type: 'string', description: 'New content' }
          },
          required: ['old_content', 'new_content']
        }
      },
      {
        name: 'working_context_append',
        description: 'Append content to working context',
        parameters: {
          type: 'object',
          properties: {
            new_content: { type: 'string', description: 'Content to add' }
          },
          required: ['new_content']
        }
      },
      {
        name: 'recall_storage_search',
        description: 'Search conversation history',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            page: { type: 'number', description: 'Page number', default: 1 }
          },
          required: ['query']
        }
      }
    ];

    // Get LLM response
    let assistantMessage;
    let functionCalls = [];
    let requestHeartbeat = false;

    do {
      if (this.streamEnabled) {
        assistantMessage = await this.callLLMStream(this.buildMessages(), availableFunctions);
      } else {
        assistantMessage = await this.callLLM(this.buildMessages(), availableFunctions);
      }
      
      // Ensure we have a valid response - check for content or reasoning
      if (!assistantMessage) {
        console.error('No LLM response received');
        return 'Sorry, I encountered an error processing your message.';
      }
      
      // Handle case where content is empty but reasoning exists
      if (!assistantMessage.content && assistantMessage.reasoning) {
        console.log('🤔 LLM provided reasoning but no content, extracting function calls...');
        console.log('Reasoning:', assistantMessage.reasoning);
        
        // Try to extract function call from reasoning
        const { responseText: reasoningText, functionCalls: reasoningCalls } = await this.executeFunctions(assistantMessage.reasoning);
        if (reasoningCalls.length > 0) {
          functionCalls.push(...reasoningCalls);
          assistantMessage.content = "Let me process that information for you.";
        } else {
          assistantMessage.content = "I understand your request and I'm thinking about how to respond.";
        }
      } else if (!assistantMessage.content) {
        console.error('Invalid LLM response:', assistantMessage);
        return 'Sorry, I encountered an error processing your message.';
      }
      
      // Process function calls from tools (provider-supported) or text protocol
      let calls = [];
      if (assistantMessage.tool_calls && Array.isArray(assistantMessage.tool_calls) && assistantMessage.tool_calls.length > 0) {
        for (const tc of assistantMessage.tool_calls) {
          try {
            const fname = tc.function?.name;
            const fargs = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
            const result = await this.executeFunction(fname, fargs);
            calls.push({ call: { function: fname, args: fargs }, result });
          } catch (e) {
            calls.push({ call: { function: 'unknown', args: {} }, result: { error: e.message } });
          }
        }
        // If no content provided, provide a generic acknowledgement
        if (!assistantMessage.content) {
          assistantMessage.content = 'Processing with memory functions...';
        }
      } else {
        const parsed = await this.executeFunctions(assistantMessage.content);
        assistantMessage.content = parsed.responseText;
        calls = parsed.functionCalls;
      }
      functionCalls.push(...calls);

      // Check if heartbeat requested
      requestHeartbeat = calls.some(call => call.call.args.request_heartbeat);

      // Filter/show thinking tags per toggle
      const processed = processThinking(assistantMessage.content, this.showThinking);
      if (!this.showThinking && processed.hidden > 0) {
        console.log(`[think] hidden ${processed.hidden} chars of model reasoning. Use /think on to show.`);
      }
      assistantMessage.content = processed.text;

      // Display function results
      if (calls.length > 0) {
        console.log('\n🔧 Function calls executed:');
        for (const { call, result } of calls) {
          console.log(`   ${call.function}(${JSON.stringify(call.args)}) -> ${JSON.stringify(result)}`);
        }
      }

    } while (requestHeartbeat);

    // Add assistant response to queue and storage
    if (assistantMessage.content.trim()) {
      this.messageQueue.push({ role: 'assistant', content: assistantMessage.content });
      await this.memory.addMessage({ role: 'assistant', content: assistantMessage.content });
    }

    // In streaming mode we already printed tokens live; skip echo here
    return this.streamEnabled ? '__STREAMED__' : assistantMessage.content;
  }

  async handleCommand(command) {
    const parts = command.split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/help':
        return `Available commands:
/help - Show this help
/exit - Exit the program
/stats - Show memory statistics
/clear - Clear message queue
/search <query> - Search conversation history
/memory - Show current working context
/save - Save agent state
/flush - Flush message queue to recall storage
/think [on|off] - Toggle or set showing model reasoning (thinking)
/stream [on|off] - Toggle or set token streaming`;

      case '/exit':
        this.conversationActive = false;
        await this.saveAgentState();
        return 'Goodbye! Agent state saved.';

      case '/stats':
        const stats = await this.memory.getStats();
        return `Memory Statistics:
Working Context: ${JSON.stringify(this.workingContext, null, 2)}
Message Queue Length: ${this.messageQueue.length}
Total Messages: ${stats.totalMessages}
Total Documents: ${stats.totalDocuments}
Memory Directory: ${this.config.memoryDir}`;

      case '/clear':
        this.messageQueue = [];
        return 'Message queue cleared.';

      case '/search':
        if (!args) return 'Usage: /search <query>';
        const results = await this.memory.searchMessages(args);
        return `Search results for "${args}":\n${JSON.stringify(results, null, 2)}`;

      case '/memory':
        return `Current Working Context:\nPersona: ${this.workingContext.persona}\nUser: ${this.workingContext.user}`;

      case '/save':
        await this.saveAgentState();
        return 'Agent state saved.';

      case '/flush':
        await this.flushMessageQueue();
        return 'Message queue flushed to recall storage.';

      case '/think': {
        const a = args.trim().toLowerCase();
        if (a === 'on') this.showThinking = true; else if (a === 'off') this.showThinking = false; else this.showThinking = !this.showThinking;
        return `Thinking is now ${this.showThinking ? 'ON' : 'OFF'}.`;
      }

      case '/stream': {
        const a = args.trim().toLowerCase();
        if (a === 'on') this.streamEnabled = true; else if (a === 'off') this.streamEnabled = false; else this.streamEnabled = !this.streamEnabled;
        return `Streaming is now ${this.streamEnabled ? 'ON' : 'OFF'}.`;
      }

      default:
        return `Unknown command: ${cmd}. Type /help for available commands.`;
    }
  }

  async startCLI() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    while (this.conversationActive) {
      try {
        const input = await new Promise(resolve => {
          rl.question('You: ', resolve);
        });

        if (input.trim() === '') continue;

        const response = await this.processMessage(input.trim());
        if (response && response.trim() && response !== '__STREAMED__') {
          console.log(`\nMemGPT: ${response}\n`);
        } else if (!this.streamEnabled) {
          console.log('\nMemGPT: (No response generated)\n');
        }
      } catch (error) {
        console.error('Error processing message:', error.message);
        console.log('Please try again or type /help for commands\n');
      }
    }

    rl.close();
  }
}

// Detect and optionally filter model "thinking" content.
function processThinking(text, show) {
  if (!text) return { text: '', hidden: 0 };
  const patterns = [
    /<think>[\s\S]*?<\/think>/gi,
    /<thinking>[\s\S]*?<\/thinking>/gi,
    /<thought>[\s\S]*?<\/thought>/gi,
    /```(?:thinking|thought|reasoning)[\s\S]*?```/gi,
  ];
  let hidden = 0;
  let out = text;
  if (!show) {
    for (const p of patterns) {
      out = out.replace(p, (m) => { hidden += m.length; return '[thinking hidden]'; });
    }
  }
  return { text: out, hidden };
}

// Generic SSE reader for OpenAI-compatible chat completions streaming
async function sseChat(url, headers, body, onDelta) {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`SSE error: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop();
    for (const part of parts) {
      const lines = part.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') break;
        try {
          const j = JSON.parse(data);
          const delta = j.choices?.[0]?.delta || {};
          const token = delta.content || '';
          const think = delta.reasoning || delta.thinking || delta.reasoning_content || '';
          if (think) {
            const wrapped = `<think>${think}</think>`;
            fullText += wrapped;
            if (onDelta) onDelta(wrapped);
          }
          if (token) {
            fullText += token;
            if (onDelta) onDelta(token);
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }
  return { content: fullText };
}

class MemoryManager {
  constructor(memoryDir, agentId) {
    this.memoryDir = memoryDir;
    this.agentId = agentId;
    this.conversationsDir = path.join(memoryDir, 'conversations');
    this.archivalDir = path.join(memoryDir, 'archival');
    this.agentsDir = path.join(memoryDir, 'agents');
  }

  async initialize() {
    // Create directory structure
    await fs.mkdir(this.memoryDir, { recursive: true });
    await fs.mkdir(this.conversationsDir, { recursive: true });
    await fs.mkdir(this.archivalDir, { recursive: true });
    await fs.mkdir(path.join(this.archivalDir, 'documents'), { recursive: true });
    await fs.mkdir(this.agentsDir, { recursive: true });

    // Initialize search index
    await this.loadSearchIndex();
  }

  async loadSearchIndex() {
    const indexPath = path.join(this.conversationsDir, 'search-index.json');
    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      const parsed = JSON.parse(data);
      // Migrate/normalize schema if different (e.g., from memgpt.js df/docs index)
      if (!parsed || typeof parsed !== 'object' || !parsed.terms) {
        this.searchIndex = { terms: {}, sessions: {}, recent: [] };
      } else {
        this.searchIndex = parsed;
      }
    } catch (error) {
      this.searchIndex = {
        terms: {},
        sessions: {},
        recent: []
      };
    }
  }

  async saveSearchIndex() {
    const indexPath = path.join(this.conversationsDir, 'search-index.json');
    await fs.writeFile(indexPath, JSON.stringify(this.searchIndex, null, 2));
  }

  async addMessage(message) {
    const today = new Date().toISOString().split('T')[0];
    const logPath = path.join(this.conversationsDir, `${today}.jsonl`);
    
    const messageData = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
      ...message
    };

    // Append to daily log
    await fs.appendFile(logPath, JSON.stringify(messageData) + '\n');

    // Update search index
    this.updateSearchIndex(messageData);
    await this.saveSearchIndex();
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  updateSearchIndex(message) {
    if (!this.searchIndex || typeof this.searchIndex !== 'object') {
      this.searchIndex = { terms: {}, sessions: {}, recent: [] };
    }
    if (!this.searchIndex.terms) this.searchIndex.terms = {};
    if (!this.searchIndex.recent) this.searchIndex.recent = [];
    // Extract keywords
    const words = message.content.toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2)
      .filter(word => !/^[0-9]+$/.test(word));

    // Update term index
    for (const word of words) {
      if (!this.searchIndex.terms[word]) {
        this.searchIndex.terms[word] = [];
      }
      this.searchIndex.terms[word].push(message.id);
    }

    // Update recent messages
    this.searchIndex.recent.unshift(message.id);
    if (this.searchIndex.recent.length > 100) {
      this.searchIndex.recent = this.searchIndex.recent.slice(0, 100);
    }
  }

  async searchMessages(query, page = 1) {
    const keywords = query.toLowerCase().split(/\s+/);
    const messageIds = new Set();
    
    // Find messages containing keywords
    for (const keyword of keywords) {
      const ids = (this.searchIndex?.terms?.[keyword]) || [];
      for (const id of ids) {
        messageIds.add(id);
      }
    }

    // Load matching messages
    const messages = [];
    const files = await fs.readdir(this.conversationsDir);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl')).sort().reverse();

    for (const file of jsonlFiles) {
      const filePath = path.join(this.conversationsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line);
      
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (messageIds.has(message.id)) {
            messages.push(message);
          }
        } catch (error) {
          // Skip invalid lines
        }
      }
    }

    // Sort by timestamp (newest first)
    messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Paginate results
    const pageSize = 10;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedMessages = messages.slice(start, end);

    return {
      query,
      page,
      totalResults: messages.length,
      results: paginatedMessages.map(msg => ({
        timestamp: msg.timestamp,
        role: msg.role,
        content: msg.content.substring(0, 200) + (msg.content.length > 200 ? '...' : '')
      }))
    };
  }

  async insertDocument(content) {
    const docId = this.generateId();
    const docPath = path.join(this.archivalDir, 'documents', `${docId}.txt`);
    
    await fs.writeFile(docPath, content);

    // Update metadata
    const metadataPath = path.join(this.archivalDir, 'metadata.json');
    let metadata = {};
    try {
      const data = await fs.readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(data);
    } catch (error) {
      // New metadata file
    }

    metadata[docId] = {
      id: docId,
      timestamp: new Date().toISOString(),
      agentId: this.agentId,
      path: docPath,
      size: content.length
    };

    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    return { success: true, documentId: docId };
  }

  async searchDocuments(query, page = 1) {
    const keywords = query.toLowerCase().split(/\s+/);
    const results = [];

    // Load metadata
    const metadataPath = path.join(this.archivalDir, 'metadata.json');
    let metadata = {};
    try {
      const data = await fs.readFile(metadataPath, 'utf-8');
      metadata = JSON.parse(data);
    } catch (error) {
      return { query, page, totalResults: 0, results: [] };
    }

    // Search through documents
    for (const [docId, doc] of Object.entries(metadata)) {
      try {
        const content = await fs.readFile(doc.path, 'utf-8');
        const lowerContent = content.toLowerCase();
        
        let matches = 0;
        for (const keyword of keywords) {
          if (lowerContent.includes(keyword)) {
            matches++;
          }
        }

        if (matches > 0) {
          results.push({
            id: docId,
            timestamp: doc.timestamp,
            relevance: matches / keywords.length,
            content: content.substring(0, 300) + (content.length > 300 ? '...' : '')
          });
        }
      } catch (error) {
        // Skip problematic documents
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevance - a.relevance);

    // Paginate
    const pageSize = 10;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedResults = results.slice(start, end);

    return {
      query,
      page,
      totalResults: results.length,
      results: paginatedResults
    };
  }

  async getStats() {
    // Count messages
    let totalMessages = 0;
    try {
      const files = await fs.readdir(this.conversationsDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      
      for (const file of jsonlFiles) {
        const content = await fs.readFile(path.join(this.conversationsDir, file), 'utf-8');
        const lines = content.trim().split('\n').filter(line => line);
        totalMessages += lines.length;
      }
    } catch (error) {
      // Directory doesn't exist yet
    }

    // Count documents
    let totalDocuments = 0;
    try {
      const metadataPath = path.join(this.archivalDir, 'metadata.json');
      const data = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(data);
      totalDocuments = Object.keys(metadata).length;
    } catch (error) {
      // No documents yet
    }

    return { totalMessages, totalDocuments };
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting Minimalist MemGPT...\n');

  // Check for API keys
  if (!process.env.GROQ_API_KEY && !process.env.TOGETHER_API_KEY) {
    console.error('Error: Please set GROQ_API_KEY or TOGETHER_API_KEY environment variable');
    console.log('export GROQ_API_KEY="your_groq_key_here"');
    console.log('export TOGETHER_API_KEY="your_together_key_here"');
    process.exit(1);
  }

  // Determine provider based on available keys
  const provider = process.env.GROQ_API_KEY ? 'groq' : 'together';

  try {
    const memgpt = new MemGPT({ provider });
    await memgpt.initialize();
    await memgpt.startCLI();
  } catch (error) {
    console.error('Error starting MemGPT:', error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down MemGPT...');
  process.exit(0);
});

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(console.error);
}

export { MemGPT, MemoryManager };
