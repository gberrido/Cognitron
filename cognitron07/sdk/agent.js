import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import { RecallStore } from './memory/recall.js';
import { ArchivalStore } from './memory/archival.js';
import { SessionStore } from './memory/session.js';
import { setupProvider } from './providerManager.js';
import { getToolRegistry, parseTextToolCalls, getToolDefinitions } from './tools.js';
import { summarizeSegment } from './summarize.js';
import { createTokenizer } from './index/tokenizer.js';
import { MockProvider } from './providers/mock.js';

export class MemGPTAgent {
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || './cognitron-memgpt-data';
    this.model = 'claude-haiku-4.5-20251015';
    this.supportsTools = true; // claude-haiku-4.5 supports tool_calls
    this.temperature = opts.temperature ?? 0.7;
    this.maxTokens = opts.maxTokens ?? 2000;
    this.maxContext = 8192;
    // Section budgets (tokens). If not provided, computed relative to maxContext.
    this.budgets = Object.assign({
      system: null,   // if null, derived ~20%
      summary: null,  // if null, derived ~10%
      messages: null, // if null, remainder
    }, opts.budgets || {});
    this.memoryPressureThreshold = 0.7;
    this.evictionThreshold = 1.0;
    this.evictionPercentage = 0.5;
    this.streamEnabled = false;
    this.showThinking = false;
    this.autosum = false;
    this.debugTools = false;

    this.session = new SessionStore(this.dataDir);
    this.recall = new RecallStore(this.dataDir);
    this.archival = new ArchivalStore(this.dataDir);

    this.coreMemory = new Map();
    this.conversation = [];
    this.summary = '';
    this.messageId = 0;
    this.lastSavedId = 0;
    this.personaText = '';
    this.personaName = null;

    this.providerName = (opts.provider || 'anthropic').toLowerCase();
    this.provider = null;

    // Tokenizer (optional, falls back to chars/4)
    this._tokenizer = createTokenizer();
  }

  async initProviders() {
    await this.session.ensure();
    await this.recall.ensure();
    await this.archival.ensure();
    await setupProvider(this);
  }

  async switchProvider(name) {
    this.providerName = name.toLowerCase();
    await this.initProviders();
  }

  async loadPersona(text, name = null) {
    this.personaText = (text || '').trim();
    this.personaName = name || null;
  }

  async loadState() {
    this.coreMemory = await this.session.loadWorking();
    const recent = await this.session.loadRecentConversation(50);
    this.conversation = recent;
    this.messageId = Math.max(0, ...recent.map(m => m.id || 0));
    const sess = await this.session.loadSession();
    this.summary = sess.recursiveSummary || '';
    this.lastSavedId = this.messageId;
  }

  async saveState() {
    await this.session.saveWorking(this.coreMemory);
    const newMessages = this.conversation.filter(m => m.id > (this.lastSavedId ?? 0));
    await this.recall.appendMessages(newMessages);
    this.lastSavedId = Math.max(this.lastSavedId, ...newMessages.map(m => m.id || 0));
    await this.session.saveSession({ recursiveSummary: this.summary, lastUpdated: new Date().toISOString() });
  }

  async resetAll() {
    await this.session.resetNonArchival();
    await this.archival.reset();
    this.coreMemory = new Map();
    this.conversation = [];
    this.summary = '';
    this.messageId = 0;
    this.lastSavedId = 0;
  }

  clearConversation() { this.conversation = []; this.summary = ''; }

  addMessage(role, content) {
    this.messageId += 1;
    this.conversation.push({ id: this.messageId, role, content, timestamp: new Date().toISOString() });
  }

  buildSystemMessage() {
    const persona = this.personaText ? `Persona Instructions (follow these as high priority):\n${this.personaText}\n\n` : '';
    let core = '';
    if (this.coreMemory.size > 0) {
      core = '\n\nCore Memory (Facts about the user and key information):\n';
      for (const [k, v] of this.coreMemory) core += `- ${k}: ${v.value}\n`;
    } else {
      core = '\n\nCore Memory (Facts about the user and key information):\n- User has not shared personal details yet\n';
    }

    const textToolProtocol = !this.supportsTools ? `\nText Tool Protocol (since function tools are unavailable):\n- To call a tool, output a line: CALL <tool_name> <JSON_ARGS>\n- You may chain multiple CALL lines in one response\n- When ready to respond to the user, output: PAUSE: <your response message>\nExample:\nCALL core_memory_append {"key":"user_name","value":"Alice"}\nCALL archival_memory_insert {"title":"proj","content":"notes..."}\nPAUSE: Noted your details. How can I help next?\n` : '';

    return `You are an AI assistant with persistent memory capabilities using the MemGPT framework.\n\n${persona}${core}\n## Available MemGPT Tools:\n- core_memory_append: Store key facts about the user in persistent memory\n- core_memory_replace: Update existing core memory when information changes\n- conversation_search: Search past conversation history\n- archival_memory_insert: Store complex information long-term\n- archival_memory_search: Retrieve stored archival information\n- get_memory_status: Check current memory usage and statistics\n- pause_heartbeats: Signal you're ready for user response (REQUIRED to end interaction)\n\n## CRITICAL: MemGPT Control Flow Instructions:\n1. ALWAYS use tools autonomously — don't ask permission\n2. Function chaining: You can chain multiple function calls in sequence\n3. Heartbeat mechanism:\n   - Continue processing with more function calls as needed\n   - When ready to respond to user, call pause_heartbeats with your response message\n4. You MUST end every interaction by calling pause_heartbeats with a user-facing message\n5. Be proactive about memory: Store important facts immediately\n${textToolProtocol}\n## Example Flow:\nUser: \"My name is Alice, I love pizza\"\n→ core_memory_append(key=\"user_name\", value=\"Alice\")\n→ core_memory_append(key=\"food_preference\", value=\"loves pizza\")\n→ pause_heartbeats(message=\"Nice to meet you Alice! I've noted that you love pizza. How can I help you today?\")`;
  }

  buildMessages() {
    const msgs = [{ role: 'system', content: this.buildSystemMessage() }];
    if (this.summary.trim()) msgs.push({ role: 'system', content: `Previous conversation summary: ${this.summary}` });
    const clean = this.conversation.map(m => {
      if (!this.supportsTools && m.role === 'tool') return { role: 'system', content: `Tool result: ${m.content}` };
      const base = { role: m.role, content: m.content };
      if (this.supportsTools && m.role === 'tool' && m.tool_call_id) base.tool_call_id = m.tool_call_id;
      return base;
    }).filter(m => ['system','user','assistant'].includes(m.role) || this.supportsTools);
    msgs.push(...clean);
    return msgs;
  }

  countTokens(text) { return this._tokenizer.countTokens(text); }
  countMessageTokens(msgs) { return this._tokenizer.countMessages(msgs); }
  _resolveBudgets() {
    // Derive budgets if not specified
    const sys = this.budgets.system ?? Math.floor(this.maxContext * 0.2);
    const sum = this.budgets.summary ?? Math.floor(this.maxContext * 0.1);
    const msg = this.budgets.messages ?? Math.max(0, this.maxContext - sys - sum);
    return { system: sys, summary: sum, messages: msg };
  }
  getTokenUsage() {
    const systemTokens = this.countTokens(this.buildSystemMessage());
    const summaryTokens = this.countTokens(this.summary || '');
    const conversationTokens = this.countMessageTokens(this.conversation);
    const total = systemTokens + summaryTokens + conversationTokens;
    return {
      total,
      system: systemTokens,
      summary: summaryTokens,
      conversation: conversationTokens,
      percentage: total / this.maxContext,
      remaining: this.maxContext - total,
      budgets: this._resolveBudgets(),
    };
  }

  async enforceBudgets() {
    const budgets = this._resolveBudgets();
    // Clip conversation to fit messages budget, summarizing evicted messages.
    let convoTokens = this.countMessageTokens(this.conversation);
    if (convoTokens <= budgets.messages) return; // good
    // Evict from the oldest forward until we fit under budget.
    const evicted = [];
    while (this.conversation.length && convoTokens > budgets.messages) {
      const m = this.conversation.shift();
      evicted.push(m);
      convoTokens = this.countMessageTokens(this.conversation);
    }
    if (evicted.length) {
      this.summary = await summarizeSegment(this, evicted);
      await this.saveState();
      console.log(chalk.green(`✅ Budget compaction: summarized ${evicted.length} messages to maintain budget`));
    }
  }

  checkPressure() {
    const usage = this.getTokenUsage();
    console.log(chalk.gray(`🧠 Context: ${usage.total}/${this.maxContext} tokens (${Math.round(usage.percentage * 100)}%)`));
    if (usage.percentage >= this.evictionThreshold) return { action: 'evict' };
    if (usage.percentage >= this.memoryPressureThreshold) return { action: 'warn' };
    return { action: 'continue' };
  }

  async compactNow() {
    const total = this.conversation.length;
    const toEvict = Math.floor(total * this.evictionPercentage);
    if (toEvict <= 0) { console.log(chalk.gray('Memory minimal; no compaction')); return; }
    const evicted = this.conversation.splice(0, toEvict);
    this.summary = await summarizeSegment(this, evicted);
    console.log(chalk.green(`✅ Compacted ${toEvict} messages`));
    await this.saveState();
  }

  async sendPressureWarning() {
    const usage = this.getTokenUsage();
    const msg = `Warning: memory pressure at ${(usage.percentage*100).toFixed(1)}%`;
    this.addMessage('system', msg);
  }

  async complete(messages, tools) { return this.provider.complete({ messages, tools }); }
  async stream(messages, tools) { return this.provider.stream({ messages, tools }); }

  async processUserTurn(input) {
    this.addMessage('user', input);
    // Enforce budgets first; then check global pressure.
    await this.enforceBudgets();
    const pr = this.checkPressure();
    if (pr.action === 'evict') { await this.compactNow(); }
    else if (pr.action === 'warn') { await this.sendPressureWarning(); }

    const tools = getToolRegistry(this);
    const toolDefs = getToolDefinitions();
    let allToolResults = [];
    let userMsg = null;
    let canStream = false;
    const maxHeartbeats = 5; let hb = 0;

    while (!userMsg && hb < maxHeartbeats) {
      hb += 1;
      const response = await this.complete(this.buildMessages(), this.supportsTools ? toolDefs : []);
      const choice = response.choices?.[0];
      const content = choice?.message?.content || '';
      const toolCalls = this.supportsTools ? (choice?.message?.tool_calls || []) : [];
      if (content || toolCalls.length) this.addMessage('assistant', content || 'Processing with tools...');

      // Tool API path: execute each tool call and feed results as tool-role messages
      if (this.supportsTools && toolCalls.length > 0) {
        const heartbeatToolResults = [];
        for (const tc of toolCalls) {
          const toolName = tc.function?.name;
          let args = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (e) { args = {}; }
          const fn = tools[toolName];
          if (this.debugTools) {
            console.log(`🔧 tool_call ${tc.id}: ${toolName}(${safeJson(args)})`);
          }
          const result = fn ? await fn(args) : { success: false, message: `Unknown tool: ${toolName}` };
          heartbeatToolResults.push({ toolName, args, result, callId: tc.id });
          // inject tool message
          this.messageId += 1;
          this.conversation.push({ id: this.messageId, role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id, timestamp: new Date().toISOString() });
          if (this.debugTools) {
            console.log(`   → result ${tc.id}: ${safeJson(result)}`);
          }
          if (toolName === 'pause_heartbeats' && result.success) { userMsg = result.message; }
        }
        if (!userMsg) continue; // go to next heartbeat with tool results in context
        break;
      }

      const heartbeatToolResults = [];
      if (!this.supportsTools) {
        const calls = parseTextToolCalls(content);
        for (const c of calls) {
          if (this.debugTools) {
            console.log(`🔧 tool_call (text): ${c.toolName}(${safeJson(c.args)})`);
          }
          const r = await tools[c.toolName]?.(c.args || {}) ?? { success: false, message: `Unknown tool: ${c.toolName}` };
          if (this.debugTools) {
            console.log(`   → result (text): ${safeJson(r)}`);
          }
          heartbeatToolResults.push({ toolName: c.toolName, args: c.args, result: r, callId: null });
          if (c.toolName === 'pause_heartbeats' && r.success) { userMsg = r.message; break; }
        }
        if (!userMsg) {
          const pauseMatch = content.match(/^\s*PAUSE:\s*(.*)$/im);
          if (pauseMatch) { userMsg = (pauseMatch[1] || '').trim() || 'Okay.'; }
        }
        if (!userMsg && heartbeatToolResults.length > 0) {
          const summary = heartbeatToolResults.map(tr => `${tr.toolName}(${JSON.stringify(tr.args)}) -> ${tr.result.message}`).join('\n');
          this.addMessage('system', `Tool results:\n${summary}`);
          continue;
        }
        if (heartbeatToolResults.length === 0) { userMsg = content || 'I understand.'; canStream = true; }
        break;
      }
      // If no tools and assistant spoke, treat as final
      if (content && toolCalls.length === 0) { userMsg = content; canStream = true; break; }
    }
    if (!userMsg) userMsg = `I've processed your request and updated my memory.`;
    return { message: userMsg, tools: allToolResults.map(tr => ({ name: tr.toolName, ok: !!tr.result?.success, message: tr.result?.message })), canStream };
  }

  async streamFinalResponse() {
    const toolDefs = []; // no tools in streamed final echo
    const stream = await this.stream(this.buildMessages(), toolDefs);
    let acc = '';
    const consume = async (s) => {
      for await (const part of s) {
        const delta = part?.choices?.[0]?.delta;
        if (!delta) continue;
        if (this.showThinking && delta.reasoning?.content) process.stdout.write(delta.reasoning.content);
        if (delta.content) { process.stdout.write(delta.content); acc += delta.content; }
      }
      process.stdout.write('\n');
    };
    await consume(stream);
    return acc;
  }

  printStatus() {
    console.log(chalk.cyan('\n🔧 Provider Status:'));
    console.log(chalk.green(`Current: ${this.providerName}`));
    console.log(chalk.gray(`Model: ${this.model}`));
    console.log(chalk.gray(`Stream: ${this.streamEnabled ? 'on' : 'off'} | Think: ${this.showThinking ? 'on' : 'off'} | Autosum: ${this.autosum ? 'on' : 'off'} | DebugTools: ${this.debugTools ? 'on' : 'off'}`));
    const groq = !!process.env.GROQ_API_KEY; const tog = !!process.env.TOGETHER_API_KEY;
    console.log(chalk.blue(`Providers: groq[${groq?'ok':'no-key'}] together[${tog?'ok':'no-key'}] mock[ok]`));
  }

  printMemoryStatus() {
    console.log(chalk.cyan('\n🧠 MemGPT Memory Status:'));
    const u = this.getTokenUsage();
    console.log(chalk.gray(`Context: ${u.total}/${this.maxContext} tokens (${Math.round(u.percentage*100)}%)`));
    console.log(chalk.gray(`Conversation messages: ${this.conversation.length}`));
    console.log(chalk.gray(`Core memories: ${this.coreMemory.size}`));
    if (this.summary) console.log(chalk.yellow(`📝 Summary: ${this.summary.substring(0,100)}...`));
  }

  parseSearchArgs(s) {
    let page = 1, size = 5, query = '';
    const t = (s||'').trim(); if (!t) return { query, page, size };
    const m = t.match(/^\s*(["'])([\s\S]*?)\1\s*(.*)$/);
    if (m) { query = m[2]; const rest = m[3].trim().split(/\s+/).filter(Boolean); if (rest[0]&&!isNaN(+rest[0])) page=+rest[0]; if (rest[1]&&!isNaN(+rest[1])) size=+rest[1]; return { query, page, size }; }
    const parts = t.split(/\s+/); if (parts.length>=2 && !isNaN(+parts[parts.length-1])) { size=+parts.pop(); }
    if (parts.length>=2 && !isNaN(+parts[parts.length-1])) { page=+parts.pop(); }
    query = parts.join(' '); return { query, page, size };
  }

  async persistWorking() { await this.session.saveWorking(this.coreMemory); }

  async runMockTests() {
    if (this.providerName !== 'mock') { this.providerName = 'mock'; this.provider = new MockProvider(); }
    await this.loadState();
    const r1 = await this.processUserTurn('My name is Alice'); console.log('Test1 response:', r1.message);
    const r2 = await this.processUserTurn('Can you search convo for my name?'); console.log('Test2 response:', r2.message);
    const r3 = await this.processUserTurn('Please store doc: remember this doc'); console.log('Test3 response:', r3.message);
    const r4 = await this.processUserTurn('arch search remember'); console.log('Test4 response:', r4.message);
    await this.saveState();
    console.log(chalk.green('✅ Tests completed.'));
  }
}

// safe JSON stringify for debug logging
function safeJson(v) { try { return JSON.stringify(v); } catch { return String(v); } }
