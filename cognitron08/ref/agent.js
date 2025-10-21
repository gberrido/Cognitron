import chalk from 'chalk';
import { RecallStore } from './memory/recall.js';
import { ArchivalStore } from './memory/archival.js';
import { SessionStore } from './memory/session.js';
import { MockProvider } from './providers/mock.js';
import { GroqProvider } from './providers/groq.js';
import { TogetherProvider } from './providers/together.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { getToolRegistry, getToolDefinitions, parseTextToolCalls } from './tools.js';
import { summarizeSegment } from './summarize.js';
import { runTurn } from '../core/runTurn.js';
import { countTokens, countMessageTokens } from './utils/tokenizer.js';

export class RefAgent {
  constructor(opts = {}) {
    this.dataDir = opts.dataDir || './cognitron08-data';
    this.providerName = (opts.provider || 'mock').toLowerCase();

    // Set default model based on provider
    const defaultModels = {
      'anthropic': 'claude-sonnet-4-20250514',
      'groq': 'openai/gpt-oss-120b',
      'together': 'openai/gpt-oss-120b',
      'mock': 'mock-model'
    };
    this.model = opts.model || defaultModels[this.providerName] || 'openai/gpt-oss-120b';

    this.supportsTools = true;
    this.temperature = opts.temperature ?? 0.7;
    this.maxTokens = opts.maxTokens ?? 2000;
    this.maxContext = 8192;
    this.memoryPressureThreshold = 0.7;
    this.evictionThreshold = 1.0;
    this.evictionPercentage = 0.5;
    this.maxConversationSize = opts.maxConversationSize ?? 1000; // Prevent memory leak
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

    this.provider = null;
  }

  async initProviders() {
    await this.session.ensure();
    await this.recall.ensure();
    await this.archival.ensure();
    if (this.providerName === 'mock') { this.provider = new MockProvider(); console.log(chalk.green('✅ Using mock provider (offline)')); return; }
    const groqKey = process.env.GROQ_API_KEY;
    const togetherKey = process.env.TOGETHER_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (this.providerName === 'anthropic') {
      if (anthropicKey) {
        const anthropic = new AnthropicProvider(anthropicKey, this.model, this.temperature, this.maxTokens);
        if (anthropic.ok) this.provider = anthropic;
      }
      if (!this.provider && groqKey) {
        const groq = new GroqProvider(groqKey, this.model, this.temperature, this.maxTokens);
        if (groq.ok) { this.providerName = 'groq'; this.provider = groq; console.log(chalk.cyan('🔄 Switched to Groq (Anthropic unavailable)')); }
      }
      if (!this.provider && togetherKey) {
        const tog = new TogetherProvider(togetherKey, this.model, this.temperature, this.maxTokens);
        if (tog.ok) { this.providerName = 'together'; this.provider = tog; console.log(chalk.cyan('🔄 Switched to Together (Anthropic unavailable)')); }
      }
    } else if (this.providerName === 'groq') {
      if (groqKey) {
        const groq = new GroqProvider(groqKey, this.model, this.temperature, this.maxTokens);
        if (groq.ok) this.provider = groq;
      }
      if (!this.provider && anthropicKey) {
        const anthropic = new AnthropicProvider(anthropicKey, this.model, this.temperature, this.maxTokens);
        if (anthropic.ok) { this.providerName = 'anthropic'; this.provider = anthropic; console.log(chalk.cyan('🔄 Switched to Anthropic (Groq unavailable)')); }
      }
      if (!this.provider && togetherKey) {
        const tog = new TogetherProvider(togetherKey, this.model, this.temperature, this.maxTokens);
        if (tog.ok) { this.providerName = 'together'; this.provider = tog; console.log(chalk.cyan('🔄 Switched to Together (Groq unavailable)')); }
      }
    } else if (this.providerName === 'together') {
      if (togetherKey) {
        const tog = new TogetherProvider(togetherKey, this.model, this.temperature, this.maxTokens);
        if (tog.ok) this.provider = tog;
      }
      if (!this.provider && anthropicKey) {
        const anthropic = new AnthropicProvider(anthropicKey, this.model, this.temperature, this.maxTokens);
        if (anthropic.ok) { this.providerName = 'anthropic'; this.provider = anthropic; console.log(chalk.cyan('🔄 Switched to Anthropic (Together unavailable)')); }
      }
      if (!this.provider && groqKey) {
        const groq = new GroqProvider(groqKey, this.model, this.temperature, this.maxTokens);
        if (groq.ok) { this.providerName = 'groq'; this.provider = groq; console.log(chalk.cyan('🔄 Switched to Groq (Together unavailable)')); }
      }
    }
    if (!this.provider) throw new Error('No providers available! Set ANTHROPIC_API_KEY, GROQ_API_KEY, or TOGETHER_API_KEY');
    console.log(chalk.green(`✅ Using provider: ${this.providerName}`));
  }

  async switchProvider(newProvider) {
    const providerName = newProvider.toLowerCase();
    if (providerName === this.providerName) {
      console.log(chalk.yellow(`⚠️  Already using ${providerName}`));
      return;
    }

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    const togetherKey = process.env.TOGETHER_API_KEY;

    let newProviderInstance = null;

    // Update default model when switching providers
    const defaultModels = {
      'anthropic': 'claude-sonnet-4-20250514',
      'groq': 'openai/gpt-oss-120b',
      'together': 'openai/gpt-oss-120b',
      'mock': 'mock-model'
    };

    switch (providerName) {
      case 'anthropic':
        if (!anthropicKey) {
          console.log(chalk.red('❌ ANTHROPIC_API_KEY not set'));
          return;
        }
        newProviderInstance = new AnthropicProvider(anthropicKey, defaultModels.anthropic, this.temperature, this.maxTokens);
        break;
      case 'groq':
        if (!groqKey) {
          console.log(chalk.red('❌ GROQ_API_KEY not set'));
          return;
        }
        newProviderInstance = new GroqProvider(groqKey, defaultModels.groq, this.temperature, this.maxTokens);
        break;
      case 'together':
        if (!togetherKey) {
          console.log(chalk.red('❌ TOGETHER_API_KEY not set'));
          return;
        }
        newProviderInstance = new TogetherProvider(togetherKey, defaultModels.together, this.temperature, this.maxTokens);
        break;
      case 'mock':
        newProviderInstance = new MockProvider();
        break;
      default:
        console.log(chalk.red(`❌ Unknown provider: ${providerName}`));
        console.log(chalk.gray('Available providers: anthropic, groq, together, mock'));
        return;
    }

    if (newProviderInstance && newProviderInstance.ok) {
      this.provider = newProviderInstance;
      this.providerName = providerName;
      this.model = defaultModels[providerName] || this.model;
      console.log(chalk.green(`✅ Switched to provider: ${providerName}`));
      console.log(chalk.gray(`   Model: ${this.model}`));
    } else {
      console.log(chalk.red(`❌ Failed to initialize ${providerName} provider`));
    }
  }

  async loadPersona(text, name = null) { this.personaText = (text || '').trim(); this.personaName = name || null; }
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
  addMessage(role, content) { this.messageId += 1; this.conversation.push({ id: this.messageId, role, content, timestamp: new Date().toISOString() }); }

  buildSystemMessage() {
    const persona = this.personaText ? `Persona Instructions (follow these as high priority):\n${this.personaText}\n\n` : '';
    let core = '';
    if (this.coreMemory.size > 0) {
      core = '\n\nCore Memory (Facts about the user and key information):\n';
      for (const [k, v] of this.coreMemory) core += `- ${k}: ${v.value}\n`;
    } else {
      core = '\n\nCore Memory (Facts about the user and key information):\n- User has not shared personal details yet\n';
    }
    const textToolProtocol = !this.supportsTools ? `\nText Tool Protocol (since function tools are unavailable):\n- To call a tool, output: CALL <tool_name> <JSON_ARGS>\n- When ready to respond, output: PAUSE: <message>\n` : '';
    return `You are an AI assistant with persistent memory capabilities using the MemGPT framework.\n\n${persona}${core}\n## Available MemGPT Tools:\n- core_memory_append\n- core_memory_replace\n- conversation_search\n- archival_memory_insert\n- archival_memory_search\n- get_memory_status\n- pause_heartbeats\n${textToolProtocol}`;
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
  // Use improved tokenizer from utils/tokenizer.js
  countTokens(text) { return countTokens(text); }
  countMessageTokens(msgs) { return countMessageTokens(msgs); }
  getTokenUsage() {
    const systemTokens = this.countTokens(this.buildSystemMessage());
    const summaryTokens = this.countTokens(this.summary || '');
    const conversationTokens = this.countMessageTokens(this.conversation);
    const total = systemTokens + summaryTokens + conversationTokens;
    return { total, system: systemTokens, summary: summaryTokens, conversation: conversationTokens, percentage: total / this.maxContext, remaining: this.maxContext - total };
  }
  checkPressure() {
    const u = this.getTokenUsage();
    if (u.percentage >= this.evictionThreshold) return { action: 'evict' };
    if (u.percentage >= this.memoryPressureThreshold) return { action: 'warn' };
    return { action: 'continue' };
  }
  async compactNow() {
    const total = this.conversation.length;
    const toEvict = Math.floor(total * this.evictionPercentage);
    if (toEvict <= 0) { return; }
    const evicted = this.conversation.splice(0, toEvict);
    this.summary = await summarizeSegment(this, evicted);
    await this.saveState();
  }

  /**
   * Enforce maximum conversation size to prevent memory leaks
   * Archives oldest messages if conversation exceeds maxConversationSize
   */
  async enforceConversationLimit() {
    if (this.conversation.length <= this.maxConversationSize) {
      return; // Within limit
    }

    // Calculate how many messages to archive
    const excessCount = this.conversation.length - this.maxConversationSize;
    const toArchive = this.conversation.splice(0, excessCount);

    // Save archived messages to recall storage
    await this.recall.appendMessages(toArchive);

    // Update summary to include archived messages
    const archivedSummary = await summarizeSegment(this, toArchive);
    this.summary = this.summary
      ? `${this.summary}\n\n${archivedSummary}`
      : archivedSummary;

    console.warn(chalk.yellow(`⚠️  Archived ${excessCount} old messages (conversation size limit: ${this.maxConversationSize})`));
  }
  async sendPressureWarning() {
    const u = this.getTokenUsage();
    const msg = `Warning: memory pressure at ${(u.percentage*100).toFixed(1)}%`;
    this.addMessage('system', msg);
  }
  async persistWorking() { await this.session.saveWorking(this.coreMemory); }

  async processUserTurn(input) {
    this.addMessage('user', input);
    const pr = this.checkPressure();
    if (pr.action === 'evict') { await this.compactNow(); }
    else if (pr.action === 'warn') { await this.sendPressureWarning(); }

    const tools = getToolRegistry(this);
    const toolDefs = getToolDefinitions();
    let finalMsg = null;
    let canStream = false;
    let ops = [];

    if (this.supportsTools) {
      const beforeLen = this.buildMessages().length;
      const hooks = this.debugTools ? { onToolCall: ({id,name,args}) => console.log(`🔧 tool_call ${id}: ${name}(${JSON.stringify(args)})`), onToolResult: ({id,name,result}) => { console.log(`   → result ${id}: ${JSON.stringify(result)}`); ops.push({ name, ok: !!result?.success, message: result?.message }); } }  : { onToolResult: ({name,result}) => { ops.push({ name, ok: !!result?.success, message: result?.message }); } };
      const res = await runTurn({ messages: this.buildMessages(), provider: this.provider, toolDefinitions: toolDefs, tools, maxHeartbeats: 5, hooks });
      finalMsg = res.finalMessage;
      const afterLen = res.messages.length;
      const newTool = res.messages.slice(Math.max(0, afterLen - (afterLen - beforeLen))).some(m => m.role === 'tool');
      canStream = !newTool; // if no tools used and assistant responded directly
      // Sync back conversation from res.messages, excluding the leading system messages
      const sysCount = (this.summary ? 2 : 1);
      const appended = res.messages.slice(sysCount + this.conversation.length);
      for (const m of appended) {
        this.messageId += 1;
        this.conversation.push({ id: this.messageId, role: m.role, content: m.content, tool_call_id: m.tool_call_id, timestamp: new Date().toISOString() });
      }
    } else {
      // Text protocol path (for parity)
      const response = await this.provider.complete({ messages: this.buildMessages(), tools: [] });
      const choice = response.choices?.[0];
      const content = choice?.message?.content || '';
      if (content) this.addMessage('assistant', content);
      const calls = parseTextToolCalls(content);
      for (const c of calls) {
        const r = await tools[c.toolName]?.(c.args || {}) ?? { success: false, message: `Unknown tool: ${c.toolName}` };
        this.messageId += 1; this.conversation.push({ id: this.messageId, role: 'tool', content: JSON.stringify(r), timestamp: new Date().toISOString() });
        if (c.toolName === 'pause_heartbeats' && r.success) { finalMsg = r.message; }
      }
      if (!finalMsg) {
        const pauseMatch = content.match(/^\s*PAUSE:\s*(.*)$/im);
        if (pauseMatch) { finalMsg = (pauseMatch[1] || '').trim() || 'Okay.'; }
      }
      if (!finalMsg && calls.length === 0) { finalMsg = content || 'I understand.'; canStream = true; }
    }

    if (!finalMsg) finalMsg = `I've processed your request and updated my memory.`;

    // Enforce conversation size limit to prevent memory leaks
    await this.enforceConversationLimit();

    return { message: finalMsg, canStream, tools: (ops||[]) };
  }
  async streamFinalResponse() {
    const toolDefs = [];
    const s = await this.provider.stream({ messages: this.buildMessages(), tools: toolDefs });
    let acc = '';
    const consume = async (iter) => {
      for await (const part of iter) {
        const delta = part?.choices?.[0]?.delta;
        if (!delta) continue;
        if (this.showThinking && delta.reasoning?.content) process.stdout.write(delta.reasoning.content);
        if (delta.content) { process.stdout.write(delta.content); acc += delta.content; }
      }
      process.stdout.write('\n');
    };
    await consume(s);
    return acc;
  }
}


export default null
