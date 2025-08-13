#!/usr/bin/env node

/**
 * Cognitron05: Educational Monolith Overview
 *
 * Map of this file (high level):
 * - Imports and MockLLM: lightweight offline model used for --test and demos
 * - class MemGPTCognitron:
 *   - constructor: config, provider flags, memory state, toggles, TF–IDF index paths
 *   - initializeProviders(): Groq/Together/Mock setup + fallback logic
 *   - loadPersona()/loadMemory()/saveMemory(): file-backed persistence and persona
 *   - System + message builders: buildMemGPTSystemMessage(), addConversationMessage(), getCurrentTokenUsage()
 *   - Tooling:
 *     - createMemGPTTools(): OpenAI-style function schema for tools (used in prompts)
 *     - parseTextToolCalls(): parses "CALL <tool> {json}" protocol when tools API isn’t available
 *     - executeMemGPTTool(): performs core_memory/recall/archival actions and returns results
 *   - Search + Archival: tokenize(), ensureIndexes(), recallSearch(), archivalInsert(), archivalSearch()
 *   - Provider calls:
 *     - makeAPICall(): non-streaming completion via Groq/Together/Mock
 *     - makeStreamingAPICall(): streaming with graceful fallback
 *   - Flow control & compaction: generateResponse(), forceEvictionAndSummarize(), parseSearchArgs()
 *   - CLI command handling: handleCommand() parses /status, /recall, /arch, /provider, /stream, /think, /autosum, /compact, /clear, /reset, /exit
 * - Main(): commander CLI wiring + readline loop
 *
 * Simplified call graph (typical user turn):
 *   CLI(main)
 *     → initializeProviders()
 *     → loadPersona(); loadMemory()
 *     → readline: on line
 *         if startsWith('/') → handleCommand()
 *         else → generateResponse(input)
 *                   → buildMemGPTSystemMessage() + current conversation → messages
 *                   → (streamEnabled ? makeStreamingAPICall : makeAPICall)
 *                   → parseTextToolCalls(modelText)
 *                   → for each tool: executeMemGPTTool() → addConversationMessage('tool', result)
 *                   → if pause → addConversationMessage('assistant', userMessage)
 *                   → autosum/compaction if needed → saveMemory()
 *
 * Notes:
 * - This monolithic file is optimized for learnability and traceability, not for large-scale reuse.
 * - Provider model is fixed to openai/gpt-oss-120b; tool API is emulated via text protocol.
 * - For production/modularity, see Cognitron07/08.
 */
/**
 * Cognitron05 MemGPT - Hybrid Provider Version
 * Manual switching between Groq and Together AI with /provider command
 * Self-contained, no modular complexity
 */

import { Command } from 'commander';
import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { Groq } from 'groq-sdk';
import Together from 'together-ai';
// (util.TextDecoder not used; removed)

// Simple offline mock model for --test mode
class MockLLM {
  constructor() {}
  // Simulate OpenAI-like response
  async create(messages, tools = [], opts = {}) {
    const last = messages[messages.length - 1] || {};
    const content = (last.content || '').toLowerCase();
    let out = '';
    // Optional thinking prelude
    if (opts.showThinking) {
      out += '<think>retrieving memories and updating core facts</think>\n';
    }
    if (/(my name is|i am )/.test(content)) {
      const name = (last.content.match(/my name is\s+([A-Za-z]+)/i) || [,'User'])[1];
      out += `CALL core_memory_append {"key":"user_name","value":"${name}"}\n`;
      out += `PAUSE: Nice to meet you ${name}! I\'ve noted your name.`;
    } else if (/search\s+convo|recall\s|what did i say/.test(content)) {
      out += `CALL conversation_search {"query":"${(last.content || '').slice(0,40)}"}\n`;
      out += `PAUSE: I searched your past messages for the query.`;
    } else if (/store doc|archive this|remember this doc/.test(content)) {
      out += `CALL archival_memory_insert {"title":"Test Doc","content":"Sample archival content"}\n`;
      out += `PAUSE: I stored that in the archive.`;
    } else if (/arch(ive)?\s+search/.test(content)) {
      out += `CALL archival_memory_search {"query":"${(last.content || '').slice(0,40)}"}\n`;
      out += `PAUSE: I retrieved related archival items.`;
    } else {
      out += 'PAUSE: Acknowledged.';
    }
    // Streaming simulation
    if (opts.stream) {
      for (const ch of out) {
        process.stdout.write(ch);
      }
      process.stdout.write('\n');
    }
    return {
      choices: [{ message: { content: out } }],
      usage: { prompt_tokens: 0, completion_tokens: out.length/4|0, total_tokens: out.length/4|0 }
    };
  }
}

class MemGPTCognitron {
  constructor(options = {}) {
    const recallEnv = Number(process.env.COGNITRON_RECALL_LINES);
    this.config = {
      dataDir: './cognitron-memgpt-data',
      recallRetentionLines: Number.isFinite(recallEnv) && recallEnv > 0 ? recallEnv : 5000
    };
    
    // Hybrid provider setup - simple and direct
    this.currentProvider = (options.provider || process.env.COGNITRON_PROVIDER || 'groq').toLowerCase(); // Default to groq
    this.groq = null;
    this.together = null;
    // Fixed model: we use only gpt-oss-120b
    this.model = 'openai/gpt-oss-120b';
    this.supportsTools = false; // gpt-oss-120b does not support tool API
    this.temperature = Number(options.temperature || process.env.COGNITRON_TEMP) || 0.7;
    this.maxTokens = Number(options.maxTokens || process.env.COGNITRON_MAX_TOKENS) || 2000;
    this.lastSavedMessageId = 0;
    // Persona support
    this.personaPath = options.persona || process.env.COGNITRON_PERSONA || null;
    this.personaText = '';
    this.personaName = null;
    
    this.memory = {
      // Core MemGPT memory components
      workingContext: new Map(),              // Editable core memory
      conversationContext: [],                // Dynamic FIFO queue with eviction
      recursiveSummary: '',                   // Compressed history summary
      archivalStorage: new Map(),             // Long-term structured storage
      
      // Session management  
      sessionId: null,
      messageIdCounter: 0,
      
      // MemGPT parameters
      maxContextWindow: 8192,
      memoryPressureThreshold: 0.7,
      evictionThreshold: 1.0,
      evictionPercentage: 0.5,
      
      // Token tracking
      systemMessageTokens: 0,
      workingContextTokens: 0,
      conversationTokens: 0
    };
    
    this.tools = this.createMemGPTTools();
    this.isRunning = false;
    // Streaming / thinking / autosum toggles
    this.streamEnabled = false;
    this.showThinking = false;
    this.autosum = false;
    // TF-IDF index paths
    this.paths = {
      recallIndex: path.join(this.config.dataDir, 'recall-index.json'),
      archivalDir: path.join(this.config.dataDir, 'archival'),
      archivalDocs: path.join(this.config.dataDir, 'archival', 'documents'),
      archMeta: path.join(this.config.dataDir, 'archival', 'metadata.json'),
      archEmbed: path.join(this.config.dataDir, 'archival', 'embeddings.json'),
    };
  }

  parseTextToolCalls(text) {
    const calls = [];
    if (!text) return calls;
    const regex = /^\s*CALL\s+([a-zA-Z0-9_]+)\s*(\{[\s\S]*?\})?\s*$/gmi;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const name = match[1];
      const json = match[2];
      let args = {};
      if (json) {
        try { args = JSON.parse(json); } catch {}
      }
      calls.push({ toolName: name, args });
    }
    return calls;
  }

  async initializeProviders() {
    console.log(chalk.blue('🔄 Initializing providers...'));
    
    // Initialize Groq
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey?.trim()) {
      this.groq = new Groq({ apiKey: groqKey.trim() });
      console.log(chalk.green('✅ Groq provider available'));
    } else {
      console.log(chalk.yellow('⚠️ Groq provider unavailable (no GROQ_API_KEY)'));
    }
    
    // Initialize Together AI
    const togetherKey = process.env.TOGETHER_API_KEY;
    if (togetherKey?.trim()) {
      this.together = new Together({ 
        apiKey: togetherKey.trim(),
        timeout: 60000 
      });
      console.log(chalk.green('✅ Together AI provider available'));
    } else {
      console.log(chalk.yellow('⚠️ Together AI provider unavailable (no TOGETHER_API_KEY)'));
    }
    
    // Mock provider (for --test mode and offline)
    if (this.currentProvider === 'mock') {
      this.mock = new MockLLM();
      console.log(chalk.green('✅ Using mock provider (offline)'));
      return true;
    }

    // Check if current provider is available
    if (this.currentProvider === 'groq' && !this.groq) {
      if (this.together) {
        this.currentProvider = 'together';
        console.log(chalk.cyan('🔄 Switched to Together AI (Groq unavailable)'));
      } else {
        throw new Error('No providers available! Set GROQ_API_KEY or TOGETHER_API_KEY');
      }
    }
    
    if (this.currentProvider === 'together' && !this.together) {
      if (this.groq) {
        this.currentProvider = 'groq';
        console.log(chalk.cyan('🔄 Switched to Groq (Together AI unavailable)'));
      } else {
        throw new Error('No providers available! Set GROQ_API_KEY or TOGETHER_API_KEY');
      }
    }
    
    // Model is fixed to gpt-oss-120b
    console.log(chalk.gray(`📦 Using model: ${this.model}`));
    if (!this.supportsTools) {
      console.log(chalk.gray('🔧 Tool API disabled (using text tool protocol)'));
    }
    
    console.log(chalk.green(`✅ Using provider: ${this.currentProvider}`));
    return true;
  }

  // Streaming helper (mock streaming; real providers fallback to non-stream)
  async makeStreamingAPICall(messages, toolDefinitions) {
    if (this.currentProvider === 'mock') {
      // Mock streaming: print tokens gradually
      const resp = await this.mock.create(messages, toolDefinitions, { stream: true, showThinking: this.showThinking });
      return resp;
    }
    const payload = {
      messages,
      model: this.model,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true
    };
    if (this.supportsTools) {
      payload.tools = toolDefinitions;
      payload.tool_choice = 'auto';
    }
    try {
      const consume = async (stream) => {
        let text = '';
        for await (const part of stream) {
          const delta = part?.choices?.[0]?.delta;
          if (!delta) continue;
          if (this.showThinking && delta.reasoning?.content) process.stdout.write(delta.reasoning.content);
          if (delta.content) { process.stdout.write(delta.content); text += delta.content; }
        }
        process.stdout.write('\n');
        return { choices: [{ message: { content: text } }] };
      };
      if (this.currentProvider === 'groq') {
        return await consume(await this.groq.chat.completions.create(payload));
      } else if (this.currentProvider === 'together') {
        return await consume(await this.together.chat.completions.create(payload));
      }
    } catch (e) {
      console.log(chalk.yellow('⚠️ Streaming failed, falling back to non-streaming'));
      return this.makeAPICall(messages, toolDefinitions);
    }
  }

  // ---- TF-IDF indexing helpers ----
  tokenize(text) {
    return (text || '').toLowerCase().replace(/[\n\r]/g, ' ').split(/[^a-z0-9]+/g).filter(Boolean);
  }
  async ensureIndexes() {
    try { await fs.mkdir(this.paths.archivalDir, { recursive: true }); } catch {}
    try { await fs.mkdir(this.paths.archivalDocs, { recursive: true }); } catch {}
    try { await fs.access(this.paths.recallIndex); } catch { await fs.writeFile(this.paths.recallIndex, JSON.stringify({ df: {}, docs: {} }, null, 2)); }
    try { await fs.access(this.paths.archMeta); } catch { await fs.writeFile(this.paths.archMeta, JSON.stringify({ documents: [] }, null, 2)); }
    try { await fs.access(this.paths.archEmbed); } catch { await fs.writeFile(this.paths.archEmbed, JSON.stringify({ df: {}, docs: {} }, null, 2)); }
  }
  // (searchConversations implemented later to leverage TF-IDF with fallback)
  async recallIndexAdd(message) {
    try {
      const idx = JSON.parse((await fs.readFile(this.paths.recallIndex, 'utf8')) || '{}');
      idx.df = idx.df || {}; idx.docs = idx.docs || {};
      const tokens = this.tokenize(message.content);
      const tf = {}; tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
      idx.docs[message.id] = { tf, role: message.role, timestamp: message.timestamp };
      for (const term of Object.keys(tf)) idx.df[term] = (idx.df[term] || 0) + 1;
      await fs.writeFile(this.paths.recallIndex, JSON.stringify(idx, null, 2));
    } catch {}
  }
  async recallSearch(query, page = 1, pageSize = 5) {
    try {
      const idx = JSON.parse((await fs.readFile(this.paths.recallIndex, 'utf8')) || '{}');
      const q = this.tokenize(query);
      const qtf = {}; q.forEach(t => { qtf[t] = (qtf[t] || 0) + 1; });
      const N = Object.keys(idx.docs || {}).length || 1;
      const scores = [];
      for (const [docId, doc] of Object.entries(idx.docs || {})) {
        let score = 0;
        for (const [t, qf] of Object.entries(qtf)) {
          const df = idx.df?.[t] || 0; if (!df) continue;
          const idf = Math.log((N + 1) / (df + 1)) + 1;
          const tf = doc.tf?.[t] || 0;
          score += (qf * idf) * tf;
        }
        if (score > 0) scores.push({ docId, score, meta: doc });
      }
      scores.sort((a, b) => b.score - a.score);
      const pageScores = scores.slice((page-1)*pageSize, (page-1)*pageSize + pageSize);
      // Build id->content map from JSONL
      const recallFile = path.join(this.config.dataDir, 'recall-storage.jsonl');
      let content = '';
      try { content = await fs.readFile(recallFile, 'utf8'); } catch {}
      const lines = content ? content.split('\n').filter(Boolean) : [];
      const map = new Map();
      for (const line of lines) { try { const rec = JSON.parse(line); map.set(rec.id, rec.content); } catch {} }
      return pageScores.map(s => ({ id: s.docId, score: s.score, content: map.get(s.docId) || '', meta: s.meta }));
    } catch { return []; }
  }
  async archivalInsert(title, content) {
    await this.ensureIndexes();
    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const file = path.join(this.paths.archivalDocs, `${id}.txt`);
    await fs.writeFile(file, content, 'utf8');
    const meta = JSON.parse((await fs.readFile(this.paths.archMeta, 'utf8')) || '{}');
    meta.documents = meta.documents || [];
    meta.documents.push({ id, title, file: `${id}.txt`, timestamp: new Date().toISOString(), length: content.length });
    await fs.writeFile(this.paths.archMeta, JSON.stringify(meta, null, 2));
    // index
    const idx = JSON.parse((await fs.readFile(this.paths.archEmbed, 'utf8')) || '{}');
    idx.df = idx.df || {}; idx.docs = idx.docs || {};
    const tf = {}; this.tokenize(content).forEach(t => { tf[t] = (tf[t] || 0) + 1; });
    idx.docs[id] = { tf };
    for (const term of Object.keys(tf)) idx.df[term] = (idx.df[term] || 0) + 1;
    await fs.writeFile(this.paths.archEmbed, JSON.stringify(idx, null, 2));
    return id;
  }
  async archivalSearch(query, page = 1, pageSize = 5) {
    await this.ensureIndexes();
    try {
      const idx = JSON.parse((await fs.readFile(this.paths.archEmbed, 'utf8')) || '{}');
      const meta = JSON.parse((await fs.readFile(this.paths.archMeta, 'utf8')) || '{}');
      const q = this.tokenize(query);
      const qtf = {}; q.forEach(t => { qtf[t] = (qtf[t] || 0) + 1; });
      const N = Object.keys(idx.docs || {}).length || 1;
      const scores = [];
      for (const [docId, doc] of Object.entries(idx.docs || {})) {
        let score = 0;
        for (const [t, qf] of Object.entries(qtf)) {
          const df = idx.df?.[t] || 0; if (!df) continue;
          const idf = Math.log((N + 1) / (df + 1)) + 1;
          const tf = doc.tf?.[t] || 0;
          score += (qf * idf) * tf;
        }
        if (score > 0) scores.push({ docId, score });
      }
      scores.sort((a, b) => b.score - a.score);
      return scores.slice((page-1)*pageSize, (page-1)*pageSize + pageSize).map(s => {
        const m = (meta.documents || []).find(d => d.id === s.docId) || { title: s.docId };
        return { id: s.docId, score: s.score, title: m.title };
      });
    } catch { return []; }
  }
  // For status reporting
  async archivalCount() {
    try {
      const meta = JSON.parse((await fs.readFile(this.paths.archMeta, 'utf8')) || '{}');
      return (meta.documents || []).length;
    } catch { return 0; }
  }

  async loadPersona() {
    if (!this.personaPath) return;
    try {
      const fullPath = path.resolve(this.personaPath);
      const content = await fs.readFile(fullPath, 'utf8');
      this.personaText = content.trim();
      this.personaName = path.basename(fullPath);
      console.log(chalk.magenta(`🎭 Loaded persona: ${this.personaName}`));
    } catch (e) {
      console.log(chalk.yellow(`⚠️ Failed to load persona file: ${this.personaPath} (${e.message})`));
    }
  }

  // Parse '/recall' and '/arch' arguments: query [page] [size]
  parseSearchArgs(argString) {
    let page = 1, size = 5, query = '';
    const trimmed = argString.trim();
    if (!trimmed) return { query: '', page, size };
    // try to detect quoted query
    const m = trimmed.match(/^\s*(["'])([\s\S]*?)\1\s*(.*)$/);
    if (m) {
      query = m[2];
      const rest = m[3].trim().split(/\s+/).filter(Boolean);
      if (rest[0] && !isNaN(Number(rest[0]))) page = Number(rest[0]);
      if (rest[1] && !isNaN(Number(rest[1]))) size = Number(rest[1]);
      return { query, page, size };
    }
    // otherwise, split by space; last tokens may be numbers
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && !isNaN(Number(parts[parts.length-1]))) {
      size = Number(parts.pop());
    }
    if (parts.length >= 2 && !isNaN(Number(parts[parts.length-1]))) {
      page = Number(parts.pop());
    }
    query = parts.join(' ');
    return { query, page, size };
  }

  async switchProvider(providerName) {
    const provider = providerName.toLowerCase();
    
    if (provider === 'groq') {
      if (!this.groq) {
        throw new Error('Groq provider not available. Set GROQ_API_KEY environment variable.');
      }
      this.currentProvider = 'groq';
      console.log(chalk.green('✅ Switched to Groq'));
      console.log(chalk.gray('💰 Pricing: $0.15/M input, $0.75/M output (Free: 30 RPM, 8K TPM)'));
    } else if (provider === 'together') {
      if (!this.together) {
        throw new Error('Together AI provider not available. Set TOGETHER_API_KEY environment variable.');
      }
      this.currentProvider = 'together';
      console.log(chalk.green('✅ Switched to Together AI'));
      console.log(chalk.gray('💰 Pricing: $0.16/M input, $0.60/M output'));
    } else {
      throw new Error(`Unknown provider: ${provider}. Available: groq, together`);
    }
  }

  // No per-provider model selection; model is fixed

  async makeAPICall(messages, toolDefinitions) {
    if (this.currentProvider === 'mock') {
      return this.mock.create(messages, toolDefinitions, { stream: this.streamEnabled, showThinking: this.showThinking });
    }
    const client = this.currentProvider === 'groq' ? this.groq : this.together;
    
    try {
      const payload = {
        messages,
        model: this.model,
        temperature: this.temperature,
        max_tokens: this.maxTokens
      };
      if (this.supportsTools) {
        payload.tools = toolDefinitions;
        payload.tool_choice = 'auto';
      }
      const response = await client.chat.completions.create(payload);
      
      return response;
    } catch (error) {
      // Prefer structured error data when available
      const status = error?.response?.status;
      if (this.currentProvider === 'groq') {
        if (status === 500) {
          throw new Error('🔧 Groq is experiencing server issues. Try /provider together');
        } else if (status === 429 || /rate limit/i.test(error.message || '')) {
          throw new Error('💳 Groq rate limit exceeded. Try /provider together or wait a moment');
        }
      } else {
        if (status === 401) {
          throw new Error('💳 Together AI API key invalid. Check TOGETHER_API_KEY');
        } else if (status === 504 || /timeout/i.test(error.message || '')) {
          throw new Error('🔧 Together AI timeout. Try /provider groq or /compact to reduce context');
        }
      }
      throw error; // Re-throw original error
    }
  }

  // Token counting (approximation - 4 chars ≈ 1 token for GPT models)
  countTokens(text) {
    if (!text) return 0;
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
    const messagesToSummarize = this.memory.conversationContext.splice(0, messagesToEvict);
    
    // Create summarization request
    await this.summarizeAndUpdateRecursive(messagesToSummarize);
    
    console.log(chalk.green(`✅ Evicted ${messagesToEvict} messages and updated summary`));
    return { action: 'eviction_complete', evicted: messagesToEvict };
  }

  // Summarize evicted messages and update recursive summary
  async summarizeAndUpdateRecursive(messagesToSummarize) {
    if (messagesToSummarize.length === 0) return;
    if (!this.autosum) {
      const first = messagesToSummarize.map(m => `${m.role}: ${(m.content||'').split(/(?<=[.!?])\s/)[0]}`);
      const chunk = `Summarized(${new Date().toISOString()}):\n` + first.join('\n');
      this.memory.recursiveSummary = this.memory.recursiveSummary ? `${this.memory.recursiveSummary}\n${chunk}` : chunk;
      return;
    }
    const conversationText = messagesToSummarize.map(msg => `${msg.role}: ${msg.content}`).join('\n');
    const summarizationPrompt = `Summarize this conversation segment concisely, preserving key facts, decisions, and context that might be referenced later:\n\n${conversationText}\n\nPrevious summary: ${this.memory.recursiveSummary || 'None'}\n\nInstructions:\n- Combine the previous summary (if exists) with new messages\n- Preserve important facts, decisions, and context\n- Keep user preferences and key details\n- Be concise but comprehensive\n- Focus on information that might be referenced later\nSummary:`;
    try {
      const response = await this.makeAPICall([{ role: 'user', content: summarizationPrompt }], []);
      if (!response.choices?.[0]?.message?.content) throw new Error('Invalid summarization response');
      this.memory.recursiveSummary = response.choices[0].message.content.trim();
    } catch (error) {
      console.log(chalk.yellow('⚠️ Summarization failed, using fallback summary'));
      const fallbackSummary = `Previous: ${this.memory.recursiveSummary}\nRecent: ${messagesToSummarize.slice(-3).map(m => m.content).join('; ')}`;
      this.memory.recursiveSummary = fallbackSummary.substring(0, 500);
    }
  }

  // Add message to conversation context
  addConversationMessage(role, content) {
    this.memory.messageIdCounter++;
    this.memory.conversationContext.push({
      id: this.memory.messageIdCounter,
      role,
      content,
      timestamp: new Date().toISOString()
    });
  }

  // Shorthand for adding messages
  addMessage(role, content) {
    this.addConversationMessage(role, content);
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
              title: { type: 'string', description: 'Short title for the document' },
              content: { type: 'string', description: 'Content to store' }
            },
            required: ['title', 'content']
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
        await this.saveMemory();
        return {
          success: true,
          message: `Stored in core memory: ${args.key} = ${args.value}`
        };

      case 'core_memory_replace':
        if (this.memory.workingContext.has(args.key)) {
          this.memory.workingContext.set(args.key, {
            value: args.new_value,
            timestamp: new Date().toISOString()
          });
          await this.saveMemory();
          return {
            success: true,
            message: `Updated core memory: ${args.key} = ${args.new_value}`
          };
        } else {
          return {
            success: false,
            message: `Key not found in core memory: ${args.key}`
          };
        }

      case 'conversation_search':
        const searchResults = await this.searchConversations(args.query, args.max_results || 5);
        return {
          success: true,
          message: `Found ${searchResults.length} results for "${args.query}"`,
          data: searchResults
        };

      case 'archival_memory_insert':
        {
          const id = await this.archivalInsert(args.title || 'Untitled', args.content || '');
          await this.saveMemory();
          return { success: true, message: `Stored doc ${id} (${args.title || 'Untitled'})` };
        }

      case 'archival_memory_search':
        {
          const archivalResults = await this.archivalSearch(args.query || '');
          return {
            success: true,
            message: `Found ${archivalResults.length} archival results for "${args.query}"`,
            data: archivalResults
          };
        }

      case 'get_memory_status':
        const usage = this.getCurrentTokenUsage();
        const archCount = await this.archivalCount();
        return {
          success: true,
          message: `Memory: ${usage.total}/${this.memory.maxContextWindow} tokens (${Math.round(usage.percentage * 100)}%), Core facts: ${this.memory.workingContext.size}, Archival: ${archCount}`,
          data: {
            tokenUsage: usage,
            coreMemoryItems: this.memory.workingContext.size,
            conversationMessages: this.memory.conversationContext.length,
            archivalItems: archCount
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
    await this.ensureIndexes();
    const hits = await this.recallSearch(query, 1, maxResults);
    if (hits.length) return hits.map(h => ({ content: h.content.slice(0,150)+(h.content.length>150?'...':''), timestamp: h.meta?.timestamp || 'unknown', role: h.meta?.role || 'unknown' }));
    const queryLower = (query||'').toLowerCase();
    return this.memory.conversationContext
      .filter(msg => msg.content && msg.content.toLowerCase().includes(queryLower))
      .slice(-maxResults)
      .map(msg => ({ content: msg.content.substring(0,150)+(msg.content.length>150?'...':''), timestamp: msg.timestamp, role: msg.role }));
  }

  // (removed legacy searchArchival that relied on in-memory Map)

  // Build MemGPT system message with current memory state
  buildMemGPTSystemMessage() {
    let coreMemoryString = '';
    let personaSection = '';
    if (this.personaText) {
      personaSection = `Persona Instructions (follow these as high priority):\n${this.personaText}\n\n`;
    }
    if (this.memory.workingContext.size > 0) {
      coreMemoryString = '\n\nCore Memory (Facts about the user and key information):\n';
      for (const [key, item] of this.memory.workingContext) {
        coreMemoryString += `- ${key}: ${item.value}\n`;
      }
    } else {
      coreMemoryString = '\n\nCore Memory (Facts about the user and key information):\n- User has not shared personal details yet\n';
    }

    const textToolProtocol = !this.supportsTools ? `
Text Tool Protocol (since function tools are unavailable):
- To call a tool, output a line: CALL <tool_name> <JSON_ARGS>
- You may chain multiple CALL lines in one response
- When ready to respond to the user, output: PAUSE: <your response message>
Example:
CALL core_memory_append {"key":"user_name","value":"Alice"}
CALL archival_memory_insert {"key":"proj","content":"notes..."}
PAUSE: Noted your details. How can I help next?
` : '';

    return `You are an AI assistant with persistent memory capabilities using the MemGPT framework.

${personaSection}

${coreMemoryString}
## Available MemGPT Tools:
- core_memory_append: Store key facts about the user in persistent memory
- core_memory_replace: Update existing core memory when information changes  
- conversation_search: Search past conversation history
- archival_memory_insert: Store complex information long-term
- archival_memory_search: Retrieve stored archival information
- get_memory_status: Check current memory usage and statistics
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

${textToolProtocol}

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

    // Add current conversation context (clean format for API)
    // Remove id, timestamp fields that some providers don't accept
    const cleanMessages = this.memory.conversationContext
      .map(msg => {
        // When tools API is not supported, do not send tool-role messages
        if (!this.supportsTools && msg.role === 'tool') {
          return { role: 'system', content: `Tool result: ${msg.content}` };
        }
        const base = { role: msg.role, content: msg.content };
        if (this.supportsTools && msg.role === 'tool' && msg.tool_call_id) {
          base.tool_call_id = msg.tool_call_id;
        }
        return base;
      })
      // Filter any stray nonstandard roles when tools are disabled
      .filter(m => ['system', 'user', 'assistant'].includes(m.role) || this.supportsTools);
    
    messages.push(...cleanMessages);
    
    // Debug token counting
    // (debug context summary removed for brevity)
    
    return messages;
  }

  async generateResponse(userInput) {
    // Add user input to conversation
    this.addMessage('user', userInput);
    
    // Check memory pressure before processing
    const pressureResult = this.checkMemoryPressure();
    if (pressureResult.action === 'eviction_complete') {
      console.log(chalk.green(`✅ Compacted ${pressureResult.evicted} messages`));
    }
    
    try {
      // MemGPT Heartbeat Loop - AI continues until it calls pause_heartbeats
      let allToolResults = [];
      let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      let userFacingMessage = null;
      let canStreamFinal = false;
      let maxHeartbeats = 5; // Prevent infinite loops
      let heartbeatCount = 0;

      while (!userFacingMessage && heartbeatCount < maxHeartbeats) {
        heartbeatCount++;
        const messages = this.buildMessages();
        const toolDefinitions = Object.values(this.tools);

        const response = await this.makeAPICall(messages, toolDefinitions);

        // (debug response structure removed for brevity)

        // Track usage
        if (response.usage) {
          totalUsage.prompt_tokens += response.usage.prompt_tokens || 0;
          totalUsage.completion_tokens += response.usage.completion_tokens || 0;
          totalUsage.total_tokens += response.usage.total_tokens || 0;

          // (debug high token usage removed)
        }

        // Validate response structure
        if (!response.choices || response.choices.length === 0 || !response.choices[0]) {
          console.error('Invalid API response: no choices');
          throw new Error('Invalid API response structure');
        }

        const choice = response.choices[0];
        if (!choice.message) {
          console.error('Invalid API response: no message in choice');
          throw new Error('Invalid API response structure');
        }

        let assistantContent = choice.message.content || '';
        const toolCalls = this.supportsTools ? (choice.message.tool_calls || []) : [];

        // Add assistant message to conversation
        if (assistantContent || toolCalls.length > 0) {
          this.addMessage('assistant', assistantContent || 'Processing with tools...');
        }

        // (debug processing logs removed)

        if (toolCalls.length === 0 && this.supportsTools) {
          // No tool calls under tool API - treat this as the final response
          userFacingMessage = assistantContent || 'I understand.';
          canStreamFinal = true;
          // (debug note removed)
          break;
        }

        // If tools API is not available, parse text tool protocol
        const heartbeatToolResults = [];
        if (!this.supportsTools) {
          const calls = this.parseTextToolCalls(assistantContent);
          // (debug parsed tool calls removed)
          for (const c of calls) {
            const result = await this.executeMemGPTTool(c.toolName, c.args || {});
            heartbeatToolResults.push({ toolName: c.toolName, args: c.args, result, callId: null });
            if (c.toolName === 'pause_heartbeats' && result.success) {
              userFacingMessage = result.message;
              break;
            }
          }
          // Extract PAUSE message if provided
          if (!userFacingMessage) {
            const pauseMatch = assistantContent.match(/^\s*PAUSE:\s*(.*)$/im);
            if (pauseMatch) {
              userFacingMessage = pauseMatch[1].trim() || 'Okay.';
            }
          }
          allToolResults.push(...heartbeatToolResults);
          
          // If we still don't have a user message and there were tool calls, add a summary and continue
          if (!userFacingMessage && heartbeatToolResults.length > 0) {
            const toolSummary = heartbeatToolResults
              .map(tr => `${tr.toolName}(${JSON.stringify(tr.args)}) -> ${tr.result.message}`)
              .join('\n');
            this.addMessage('system', `Tool results:\n${toolSummary}`);
            continue; // proceed to next heartbeat
          }
          
          // If no tool calls parsed, treat content as final
          if (heartbeatToolResults.length === 0) {
            userFacingMessage = assistantContent || 'I understand.';
            canStreamFinal = true;
          }
          break;
        }

        // Process tool calls via tool API
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          let args;
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch (e) {
            const parseError = { success: false, message: `Invalid tool arguments JSON: ${e.message}` };
            heartbeatToolResults.push({ toolName, args: null, result: parseError, callId: toolCall.id });
            if (process.env.DEBUG) {
              console.log(chalk.gray(`🔍 Debug - Failed to parse args for ${toolName}: ${e.message}`));
            }
            continue;
          }
          const result = await this.executeMemGPTTool(toolName, args);
          
          heartbeatToolResults.push({ toolName, args, result, callId: toolCall.id });
          
          // Check for pause_heartbeats - this signals user-facing response
          // (debug tool execution removed)
          
          if (toolName === 'pause_heartbeats' && result.success) {
            userFacingMessage = result.message;
            // (debug pause found removed)
            break;
          }
        }

        allToolResults.push(...heartbeatToolResults);
        
        // Feed tool results back as tool-role messages if possible
        if (heartbeatToolResults.length > 0 && !userFacingMessage) {
          const anyCallIds = heartbeatToolResults.some(tr => !!tr.callId);
          if (anyCallIds) {
            for (const tr of heartbeatToolResults) {
              const content = JSON.stringify(tr.result);
              // Add tool message carrying the result for the corresponding tool call
              this.memory.messageIdCounter++;
              this.memory.conversationContext.push({
                id: this.memory.messageIdCounter,
                role: 'tool',
                content,
                tool_call_id: tr.callId,
                timestamp: new Date().toISOString()
              });
            }
          } else {
            // Fallback: system summary if no tool_call_id provided by provider
            const toolSummary = heartbeatToolResults
              .map(tr => `${tr.toolName}(${JSON.stringify(tr.args)}) -> ${tr.result.message}`)
              .join('\n');
            this.addMessage('system', `Tool results:\n${toolSummary}`);
          }
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
        heartbeats: heartbeatCount,
        canStream: canStreamFinal
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
      
      if (error.message.includes('🔧') || error.message.includes('💳')) {
        errorMessage = error.message; // Use provider-specific error message
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
        console.log(chalk.cyan('\n📚 Commands:'));
        console.log('  /help     - Show this help');
        console.log('  /provider - Switch provider (groq|together|mock)');
        console.log('  /memory   - Show memory state');
        console.log('  /compact  - Force compaction');
        console.log('  /stream   - Toggle token streaming');
        console.log('  /think    - Toggle reasoning visibility');
        console.log('  /autosum  - Toggle LLM summarization');
        console.log('  /recall <q> [p] [n] - Search past conversation');
        console.log('  /arch <q> [p] [n]   - Search archival documents');
        console.log('  /status   - Show provider + toggles');
        console.log('  /clear    - Clear conversation');
        console.log('  /reset    - Reset all memory');
        console.log('  /exit     - Save and exit');
        return 'continue';

      case '/recall':
        console.log(chalk.yellow('Usage: /recall <query> [page] [size]'));
        return 'continue';
      case '/arch':
        console.log(chalk.yellow('Usage: /arch <query> [page] [size]'));
        return 'continue';
        
      case '/memory':
        console.log(chalk.cyan('\n🧠 MemGPT Memory Status:'));
        const usage = this.getCurrentTokenUsage();
        const archCountNow = await this.archivalCount();
        console.log(chalk.gray(`Session: ${this.memory.sessionId}`));
        console.log(chalk.gray(`Context: ${usage.total}/${this.memory.maxContextWindow} tokens (${Math.round(usage.percentage * 100)}%)`));
        console.log(chalk.gray(`Conversation messages: ${this.memory.conversationContext.length}`));
        console.log(chalk.gray(`Message ID counter: ${this.memory.messageIdCounter}`));
        console.log(chalk.gray(`Archival entries: ${archCountNow}`));
        
        if (this.memory.recursiveSummary) {
          console.log(chalk.yellow(`📝 Recursive summary: ${this.memory.recursiveSummary.substring(0, 100)}...`));
        }
        
        if (this.memory.workingContext.size > 0) {
          console.log(chalk.green('\n💡 Core Memory (Key Facts):'));
          for (const [key, item] of this.memory.workingContext) {
            console.log(chalk.gray(`  ${key}: ${item.value}`));
          }
        }
        return 'continue';

      case '/status':
        console.log(chalk.cyan('\n🔧 Provider Status:'));
        console.log(chalk.green(`Current: ${this.currentProvider}`));
        console.log(chalk.gray(`Model: ${this.model}`));
        console.log(chalk.gray(`Stream: ${this.streamEnabled ? 'on' : 'off'} | Think: ${this.showThinking ? 'on' : 'off'} | Autosum: ${this.autosum ? 'on' : 'off'}`));
        const pGroq = this.groq ? 'ok' : 'no-key';
        const pTog = this.together ? 'ok' : 'no-key';
        const pMock = 'ok';
        console.log(chalk.blue(`Providers: groq[${pGroq}] together[${pTog}] mock[${pMock}]`));
        return 'continue';
        
      case '/compact':
        console.log(chalk.blue('🔄 Manual memory compaction...'));
        if (this.memory.conversationContext.length > 20) {
          const result = await this.forceEvictionAndSummarize();
          console.log(chalk.green(`✅ Compacted ${result.evicted} messages down to ${this.memory.conversationContext.length}`));
          console.log(chalk.green('✅ Saved compacted memory state'));
          console.log(chalk.cyan('💡 Older messages summarized and moved to recursive summary.'));
        } else {
          console.log(chalk.gray('Memory is already manageable (< 20 messages)'));
        }
        return 'continue';
        
      case '/clear':
        this.memory.conversationContext = [];
        this.memory.recursiveSummary = '';
        console.log(chalk.green('✅ Cleared conversation history'));
        await this.saveMemory();
        return 'continue';

      case '/stream':
        this.streamEnabled = !this.streamEnabled;
        console.log(chalk.cyan(`🔄 Streaming is now ${this.streamEnabled ? 'ON' : 'OFF'}`));
        return 'continue';

      case '/think':
        this.showThinking = !this.showThinking;
        console.log(chalk.cyan(`🔄 Thinking visibility is now ${this.showThinking ? 'ON' : 'OFF'}`));
        return 'continue';

      case '/autosum':
        this.autosum = !this.autosum;
        console.log(chalk.cyan(`🔄 Autosum is now ${this.autosum ? 'ON' : 'OFF'}`));
        return 'continue';
        
      case '/reset':
        console.log(chalk.yellow('⚠️ Resetting ALL memory (core, conversations, archival, session)...'));
        try {
          const files = [
            'working-context.json',
            'recall-storage.jsonl',
            'session-state.json'
          ];
          for (const f of files) {
            try { await fs.unlink(path.join(this.config.dataDir, f)); } catch {}
          }
          // Remove archival directory
          try { await fs.rm(this.paths.archivalDir, { recursive: true, force: true }); } catch {}
          // Reset in-memory state
          this.memory.workingContext = new Map();
          this.memory.conversationContext = [];
          this.memory.recursiveSummary = '';
          this.memory.messageIdCounter = 0;
          this.lastSavedMessageId = 0;
          console.log(chalk.green('✅ All memory reset.'));
        } catch (e) {
          console.log(chalk.red(`❌ Failed to reset: ${e.message}`));
        }
        return 'continue';

      default:
        // Check if it's a provider command with arguments
        if (input.startsWith('/provider ')) {
          const providerName = input.split(' ')[1]?.trim();
          if (providerName) {
            try {
              await this.switchProvider(providerName);
              return 'continue';
            } catch (error) {
              console.log(chalk.red(`❌ ${error.message}`));
              return 'continue';
            }
          } else {
            console.log(chalk.red('❌ Please specify a provider: /provider <groq|together>'));
            console.log(chalk.gray('Available: groq, together'));
            return 'continue';
          }
        }
        // /recall <query> [page] [size]
        if (input.startsWith('/recall ')) {
          const argsStr = input.slice('/recall '.length).trim();
          const { query, page, size } = this.parseSearchArgs(argsStr);
          const hits = await this.recallSearch(query, page, size);
          if (hits.length === 0) {
            console.log(chalk.gray('No results.'));
            return 'continue';
          }
          console.log(chalk.cyan(`\n🔎 Recall results (page ${page}, size ${size}):`));
          hits.forEach((h, i) => {
            const meta = h.meta || {};
            const ts = meta.timestamp ? ` @ ${meta.timestamp}` : '';
            console.log(chalk.gray(`${(i+1)}. [${(h.score||0).toFixed(2)}] ${meta.role || 'unknown'}${ts}`));
            console.log((h.content || '').slice(0, 180));
          });
          return 'continue';
        }
        // /arch <query> [page] [size]
        if (input.startsWith('/arch ')) {
          const argsStr = input.slice('/arch '.length).trim();
          const { query, page, size } = this.parseSearchArgs(argsStr);
          const hits = await this.archivalSearch(query, page, size);
          if (hits.length === 0) {
            console.log(chalk.gray('No results.'));
            return 'continue';
          }
          console.log(chalk.cyan(`\n📚 Archival results (page ${page}, size ${size}):`));
          for (let i = 0; i < hits.length; i++) {
            const h = hits[i];
            console.log(chalk.gray(`${(i+1)}. [${(h.score||0).toFixed(2)}] ${h.title || h.id}`));
          }
          return 'continue';
        }
        
        // No /model command; model is fixed
        
        return await this.generateResponse(input);
    }
  }

  async loadMemory() {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
      await this.ensureIndexes();
      
      // Generate session ID if not exists
      if (!this.memory.sessionId) {
        this.memory.sessionId = `session_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      }
      
      // Load working context (core memory)
      const workingContextFile = path.join(this.config.dataDir, 'working-context.json');
      try {
        const workingData = await fs.readFile(workingContextFile, 'utf8');
        const parsed = JSON.parse(workingData);
        this.memory.workingContext = new Map(parsed.entries || []);
      } catch {
        // File doesn't exist yet
      }
      
      // Load recall storage (conversation context)
      const recallFile = path.join(this.config.dataDir, 'recall-storage.jsonl');
      try {
        const recallData = await fs.readFile(recallFile, 'utf8');
        const lines = recallData.split('\n').filter(line => line.trim());
        
        // Load recent messages (last 50) for conversation context
        const recentMessages = lines.slice(-50).map(line => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        }).filter(msg => msg);
        
        this.memory.conversationContext = recentMessages;
        this.memory.messageIdCounter = Math.max(...recentMessages.map(m => m.id || 0), 0);
        
        console.log(chalk.blue(`📚 Loaded ${recentMessages.length} messages (${this.countMessageTokens(recentMessages)} tokens)`));
      } catch {
        // No recall storage yet
        console.log(chalk.cyan('🆕 Starting fresh MemGPT session'));
      }
      
      // Archival storage now uses files under archival/; no in-memory Map load needed
      
      // Load session state
      const sessionFile = path.join(this.config.dataDir, 'session-state.json');
      try {
        const sessionData = await fs.readFile(sessionFile, 'utf8');
        const session = JSON.parse(sessionData);
        this.memory.recursiveSummary = session.recursiveSummary || '';
      } catch {
        // No session state yet
      }
      
      // Initialize lastSavedMessageId to current counter so we only append new messages
      this.lastSavedMessageId = this.memory.messageIdCounter;
     
    } catch (error) {
      console.error(chalk.red('Failed to load memory:'), error.message);
    }
  }

  async saveMemory() {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
      
      // Save working context
      const workingContextFile = path.join(this.config.dataDir, 'working-context.json');
      await fs.writeFile(workingContextFile, JSON.stringify({
        entries: Array.from(this.memory.workingContext.entries()),
        lastUpdated: new Date().toISOString()
      }, null, 2));
      
      // Append to recall storage (JSONL format)
      const recallFile = path.join(this.config.dataDir, 'recall-storage.jsonl');
      const newMessages = this.memory.conversationContext.filter(msg => msg.id > (this.lastSavedMessageId ?? 0));
      if (newMessages.length > 0) {
        const jsonlContent = newMessages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
        await fs.appendFile(recallFile, jsonlContent);
        // Update TF-IDF index for new messages
        for (const m of newMessages) { try { await this.recallIndexAdd(m); } catch {} }
        this.lastSavedMessageId = Math.max(...newMessages.map(m => m.id || 0));
        // Enforce simple retention cap to avoid unbounded growth
        try {
          const content = await fs.readFile(recallFile, 'utf8');
          const lines = content.split('\n').filter(Boolean);
          const limit = this.config.recallRetentionLines || 5000;
          if (lines.length > limit) {
            const trimmed = lines.slice(-limit).join('\n') + '\n';
            await fs.writeFile(recallFile, trimmed, 'utf8');
          }
        } catch {}
      }
      // Archival storage saved when inserting documents; no central JSON now
      
      // Save session state
      const sessionFile = path.join(this.config.dataDir, 'session-state.json');
      await fs.writeFile(sessionFile, JSON.stringify({
        sessionId: this.memory.sessionId,
        messageIdCounter: this.memory.messageIdCounter,
        recursiveSummary: this.memory.recursiveSummary,
        lastUpdated: new Date().toISOString()
      }, null, 2));
      
    } catch (error) {
      console.error(chalk.red('Failed to save memory:'), error.message);
    }
  }

  async startChat() {
    console.log(chalk.bold.cyan('🧠 Cognitron05 MemGPT - Infinite Conversation Memory'));
    console.log(chalk.gray('════════════════════════════════════════════════════'));
    
    // Initialize providers
    await this.initializeProviders();
    // Load persona if provided
    await this.loadPersona();
    
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
    console.log(chalk.gray('Tell me about yourself and I\'ll remember for next time!'));
    const personaInfo = this.personaName ? ` | Persona: ${this.personaName}` : '';
    console.log(chalk.blue(`\nProvider: ${this.currentProvider} | Model: ${this.model}${personaInfo} | Use /provider to change | /help for commands\n`));

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
            console.log(chalk.red(`   ❌ ${toolName}`));
            console.log(chalk.gray(`      → ${toolResult.message}`));
          }
        }
      }

      // Display AI response (stream if possible and enabled)
      if (result.content) {
        if (this.streamEnabled && result.canStream && this.currentProvider !== 'mock') {
          console.log(chalk.cyan('\n💬 AI Response:'));
          await this.makeStreamingAPICall(this.buildMessages(), Object.values(this.tools));
        } else {
          console.log(chalk.cyan('\n💬 AI Response:'));
          console.log(result.content);
        }
      }

      // Display usage info if in debug mode
      if (process.env.DEBUG && result.usage) {
        console.log(chalk.gray(`\n📊 Usage: ${result.usage.total_tokens} tokens (${result.heartbeats} heartbeats)`));
      }

      // Save memory after each interaction
      await this.saveMemory();
      
      rl.prompt();
    });

    rl.on('close', async () => {
      if (this.isRunning) {
        console.log(chalk.gray('\n💾 Saving memory...'));
        await this.saveMemory();
        console.log(chalk.green('✅ Memory saved!'));
        console.log(chalk.gray('👋 Goodbye!'));
      }
      process.exit(0);
    });

    // Handle process termination
    process.on('SIGINT', async () => {
      console.log(chalk.gray('\n💾 Saving memory...'));
      await this.saveMemory();
      console.log(chalk.green('✅ Memory saved!'));
      process.exit(0);
    });
  }

  // Offline compact tests using the mock provider
  async runTests() {
    console.log(chalk.bold.cyan('🧪 Running offline tests (mock provider)'));
    this.currentProvider = 'mock';
    this.mock = new MockLLM();
    await this.ensureIndexes();
    await this.loadPersona();
    await this.loadMemory();
    // Test 1: Name memory
    let r1 = await this.generateResponse('My name is Alice');
    console.log('Test1 response:', r1.content);
    // Test 2: Recall search
    let r2 = await this.generateResponse('Can you search convo for my name?');
    console.log('Test2 response:', r2.content);
    // Test 3: Archival insert
    let r3 = await this.generateResponse('Please store doc: remember this doc');
    console.log('Test3 response:', r3.content);
    // Test 4: Archival search
    let r4 = await this.generateResponse('arch search remember');
    console.log('Test4 response:', r4.content);
    // Save state
    await this.saveMemory();
    console.log(chalk.green('✅ Tests completed.'));
  }
}

// CLI Setup
const program = new Command();

program
  .name('cognitron05')
  .description('MemGPT-style AI Assistant with Hybrid Provider Support')
  .version('1.0.0');

program
  .option('--provider <provider>', 'LLM provider to use (groq|together|mock)')
  .option('--temperature <temperature>', 'Sampling temperature')
  .option('--max-tokens <maxTokens>', 'Max tokens for completion')
  .option('--persona <file>', 'Path to persona text file')
  .option('--test', 'Run offline tests and exit', false)
  .action(async (cmd) => {
    const opts = program.opts();
    const cognitron = new MemGPTCognitron(opts);
    if (opts.test) {
      await cognitron.runTests();
      return;
    }
    await cognitron.startChat();
  });

program.parse();

// Export for testing and modular usage
export { MemGPTCognitron };
