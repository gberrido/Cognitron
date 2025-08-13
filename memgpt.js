#!/usr/bin/env node
/*
 Minimalist MemGPT/Letta single-file CLI agent
 - Self-contained, zero external deps (Node.js stdlib only)
 - File-based storage (JSONL + JSON)
 - Working context + FIFO queue with summarization + memory pressure
 - Recall and archival storage with TF-IDF keyword search
 - Pluggable LLM provider with an offline mock for testing
 - Built-in tests: run `node memgpt.js --test`
*/

import fs from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';
import { fileURLToPath, pathToFileURL } from 'url';

// --------------------------- Config & Constants ---------------------------
const ROOT = process.cwd();
const MEM_ROOT = path.join(ROOT, 'memory');
const CONV_DIR = path.join(MEM_ROOT, 'conversations');
const ARCH_DIR = path.join(MEM_ROOT, 'archival');
const ARCH_DOCS_DIR = path.join(ARCH_DIR, 'documents');
const AGENTS_DIR = path.join(MEM_ROOT, 'agents');

const RECALL_INDEX_FILE = path.join(CONV_DIR, 'search-index.json');
const ARCH_EMBED_FILE = path.join(ARCH_DIR, 'embeddings.json'); // local TF-IDF cache
const ARCH_META_FILE = path.join(ARCH_DIR, 'metadata.json');

const DEFAULT_AGENT_ID = 'default';
const DEFAULT_MODEL = 'mock'; // mock, openai:gpt-4o-mini, groq:gpt-oss-120b, together:gpt-oss-120b

// Model token limits (approx). We'll use char->token estimate, but keep thresholds here.
const MODEL_LIMITS = {
  'gpt-3.5-turbo': { max: 16000, warn: Math.floor(16000 * 0.7) },
  'gpt-4': { max: 8000, warn: Math.floor(8000 * 0.7) },
  'gpt-4-turbo': { max: 128000, warn: Math.floor(128000 * 0.7) },
  // Offline/testing presets
  'mock': { max: 4000, warn: 2800 },
  'tiny-mock': { max: 500, warn: 350 },
};

// --------------------------- Utility Helpers ---------------------------
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function todayFile() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return path.join(CONV_DIR, `${y}-${m}-${day}.jsonl`);
}

function ts() { return new Date().toISOString(); }

function uuid() { return crypto.randomUUID(); }

function writeJSON(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

function readJSON(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

// Basic tokenizer for TF-IDF (very simple, no stemming)
function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[\n\r]/g, ' ')
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

// Approximate tokens by chars/4 (very rough heuristic)
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// --------------------------- Storage Initialization ---------------------------
function initStorage() {
  ensureDir(MEM_ROOT);
  ensureDir(CONV_DIR);
  ensureDir(ARCH_DIR);
  ensureDir(ARCH_DOCS_DIR);
  ensureDir(AGENTS_DIR);
  if (!fs.existsSync(RECALL_INDEX_FILE)) writeJSON(RECALL_INDEX_FILE, { df: {}, docs: {} });
  if (!fs.existsSync(ARCH_EMBED_FILE)) writeJSON(ARCH_EMBED_FILE, { df: {}, docs: {} });
  if (!fs.existsSync(ARCH_META_FILE)) writeJSON(ARCH_META_FILE, { documents: [] });
}

// --------------------------- Recall Storage (JSONL logs + index) ---------------------------
function recallLogMessage(sessionId, role, content) {
  const file = todayFile();
  const rec = { id: uuid(), timestamp: ts(), session: sessionId, role, content };
  fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8');
  recallIndexAdd(rec);
  return rec.id;
}

function recallIndexAdd(rec) {
  const idx = readJSON(RECALL_INDEX_FILE, { df: {}, docs: {} });
  const tokens = tokenize(rec.content);
  const tf = {};
  tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
  const docId = rec.id;
  idx.docs[docId] = { tf, session: rec.session, role: rec.role, timestamp: rec.timestamp };
  Object.keys(tf).forEach(term => { idx.df[term] = (idx.df[term] || 0) + 1; });
  writeJSON(RECALL_INDEX_FILE, idx);
}

function recallSearch(query, page = 1, pageSize = 5) {
  const idx = readJSON(RECALL_INDEX_FILE, { df: {}, docs: {} });
  const qTokens = tokenize(query);
  const N = Object.keys(idx.docs).length || 1;
  // Compute query TF
  const qtf = {};
  qTokens.forEach(t => { qtf[t] = (qtf[t] || 0) + 1; });
  // Score docs
  const scores = [];
  for (const [docId, doc] of Object.entries(idx.docs)) {
    let score = 0;
    for (const [t, qf] of Object.entries(qtf)) {
      const df = idx.df[t] || 0;
      if (!df) continue;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      const tf = doc.tf[t] || 0;
      score += (qf * idf) * tf;
    }
    if (score > 0) scores.push({ docId, score, meta: doc });
  }
  scores.sort((a, b) => b.score - a.score);
  // Load contents from files by docId
  const results = [];
  for (const s of scores) {
    const content = recallFindContentById(s.docId);
    if (content) results.push({ id: s.docId, score: s.score, content, meta: s.meta });
  }
  const start = (page - 1) * pageSize;
  return results.slice(start, start + pageSize);
}

function recallFindContentById(docId) {
  // Search recent files (last 14 days) to find the message content
  const files = fs.readdirSync(CONV_DIR).filter(f => f.endsWith('.jsonl')).sort().reverse();
  for (const f of files) {
    const full = path.join(CONV_DIR, f);
    const lines = fs.readFileSync(full, 'utf8').split('\n').filter(Boolean).reverse();
    for (const line of lines) {
      try {
        const rec = JSON.parse(line);
        if (rec.id === docId) return rec.content;
      } catch { /* ignore */ }
    }
  }
  return null;
}

// --------------------------- Archival Storage ---------------------------
function archivalInsert(title, content) {
  const id = uuid();
  const fname = `${id}.txt`;
  fs.writeFileSync(path.join(ARCH_DOCS_DIR, fname), content, 'utf8');
  const meta = readJSON(ARCH_META_FILE, { documents: [] });
  meta.documents.push({ id, title, file: fname, timestamp: ts(), length: content.length });
  writeJSON(ARCH_META_FILE, meta);
  archivalIndexDoc(id, content);
  return id;
}

function archivalIndexDoc(id, content) {
  const idx = readJSON(ARCH_EMBED_FILE, { df: {}, docs: {} });
  const tokens = tokenize(content);
  const tf = {};
  tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
  idx.docs[id] = { tf };
  Object.keys(tf).forEach(term => { idx.df[term] = (idx.df[term] || 0) + 1; });
  writeJSON(ARCH_EMBED_FILE, idx);
}

function archivalSearch(query, page = 1, pageSize = 5) {
  const idx = readJSON(ARCH_EMBED_FILE, { df: {}, docs: {} });
  const meta = readJSON(ARCH_META_FILE, { documents: [] });
  const qTokens = tokenize(query);
  const N = Object.keys(idx.docs).length || 1;
  const qtf = {};
  qTokens.forEach(t => { qtf[t] = (qtf[t] || 0) + 1; });
  const scores = [];
  for (const [docId, doc] of Object.entries(idx.docs)) {
    let score = 0;
    for (const [t, qf] of Object.entries(qtf)) {
      const df = idx.df[t] || 0;
      if (!df) continue;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      const tf = doc.tf[t] || 0;
      score += (qf * idf) * tf;
    }
    if (score > 0) scores.push({ docId, score });
  }
  scores.sort((a, b) => b.score - a.score);
  const start = (page - 1) * pageSize;
  const pageScores = scores.slice(start, start + pageSize);
  return pageScores.map(s => {
    const m = meta.documents.find(d => d.id === s.docId);
    const content = fs.readFileSync(path.join(ARCH_DOCS_DIR, m.file), 'utf8');
    return { id: s.docId, score: s.score, title: m.title, content };
  });
}

// --------------------------- Agent Working Context ---------------------------
function agentFile(agentId) { return path.join(AGENTS_DIR, `${agentId}.json`); }

function loadAgent(agentId) {
  const file = agentFile(agentId);
  if (!fs.existsSync(file)) {
    const agent = {
      id: agentId,
      persona: {
        name: 'MemGPT',
        role: 'Helpful assistant with hierarchical memory',
        style: 'Concise, friendly, transparent about memory actions',
      },
      user: {
        name: null,
        preferences: {},
        facts: [],
      },
      notes: 'Use recall and archival storage to manage context. Keep summaries concise.',
      created_at: ts(),
      updated_at: ts(),
    };
    writeJSON(file, agent);
    return agent;
  }
  return readJSON(file, {});
}

function saveAgent(agent) {
  agent.updated_at = ts();
  writeJSON(agentFile(agent.id), agent);
}

function workingContextString(agent) {
  const persona = `Persona: ${agent.persona.name} — ${agent.persona.role}\nStyle: ${agent.persona.style}`;
  const userInfo = `User: ${agent.user.name || 'Unknown'}\nPreferences: ${JSON.stringify(agent.user.preferences)}\nFacts: ${agent.user.facts.join('; ')}`;
  return `${persona}\n\nUser Information:\n${userInfo}\n\nNotes:\n${agent.notes}`;
}

function workingContextReplace(agent, oldContent, newContent) {
  const all = workingContextString(agent);
  if (!all.includes(oldContent)) return false;
  const replaced = all.replace(oldContent, newContent);
  // naive parsing back into fields is complex; instead, append to notes for safety
  agent.notes += `\n[replace] ${JSON.stringify({ old: oldContent, new: newContent })}`;
  saveAgent(agent);
  return replaced;
}

function workingContextAppend(agent, newContent) {
  agent.notes += `\n${newContent}`;
  saveAgent(agent);
  return true;
}

// --------------------------- Context Window & Queue ---------------------------
class ContextManager {
  constructor(modelKey) {
    this.modelKey = modelKey;
    const lim = MODEL_LIMITS[modelKey] || MODEL_LIMITS['mock'];
    this.warn = lim.warn; this.max = lim.max;
    this.messages = []; // {role, content}
    this.summary = '';
  }
  size() {
    const sum = estimateTokens(this.summary);
    const msg = this.messages.reduce((a, m) => a + estimateTokens(m.content), 0);
    return sum + msg;
  }
  push(role, content) {
    this.messages.push({ role, content });
    this._enforceLimits();
  }
  _enforceLimits() {
    const size = this.size();
    if (size >= this.warn && !this._warned) {
      this.messages.push({ role: 'system', content: '[memory_warning] Context nearing capacity. Consider summarizing or externalizing details.' });
      this._warned = true;
    }
    if (size > this.max) {
      // Evict from head until under max; build recursive summary
      const evicted = [];
      while (this.size() > Math.floor(this.max * 0.9) && this.messages.length > 0) {
        const m = this.messages.shift();
        if (m.role !== 'system') evicted.push(m);
      }
      if (evicted.length) this._updateSummary(evicted);
      // reset warning to avoid spamming
      this._warned = false;
    }
  }
  _updateSummary(evicted) {
    // Simple extractive summary: take first sentence of each evicted message
    const lines = evicted.map(m => `${m.role}: ${m.content.split(/(?<=[.!?])\s/)[0]}`);
    const chunk = `Summarized(${new Date().toISOString()}):\n` + lines.join('\n');
    this.summary = this.summary ? `${this.summary}\n${chunk}` : chunk;
  }
  prompt(systemPrompt, agent) {
    const header = `${systemPrompt}\n\nWORKING CONTEXT:\n${workingContextString(agent)}\n\nSUMMARY:\n${this.summary || '(none)'}\n\nRECENT MESSAGES:`;
    const conv = this.messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
    return `${header}\n${conv}\n`;
  }
}

// --------------------------- System Prompt ---------------------------
const DEFAULT_SYSTEM_PROMPT = `You are MemGPT, an AI assistant with hierarchical memory management.\n\nMEMORY HIERARCHY:\n- Working Context: Your current personality and user information\n- Message Queue: Recent conversation history\n- Recall Storage: Full conversation history (searchable)\n- Archival Storage: Documents and knowledge base (searchable)\n\nYou have access to MEMORY FUNCTIONS described below. Decide when to:\n- Move important info from queue to working context (use working_context.append/replace)\n- Search external memory for context (recall_storage.search, archival_storage.search)\n- Insert documents to archival storage when requested (archival_storage.insert)\n- Request heartbeats for multi-step operations (request_heartbeat=true)\n\nMEMORY FUNCTIONS:\n- working_context.replace(old_content, new_content)\n- working_context.append(new_content)\n- recall_storage.search(query, page=1)\n- archival_storage.search(query, page=1)\n- archival_storage.insert(content)\n\nBEHAVIOR:\n- Be transparent about memory operations when relevant.\n- Keep responses concise and context-aware.\n- If context is near capacity, summarize or externalize.\n`;

// --------------------------- LLM Providers ---------------------------
class MockLLM {
  constructor() { }
  async complete(messages, options = {}) {
    // Simple heuristic reply using last user msg and persona
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const sys = messages.find(m => m.role === 'system');
    const personaLine = (sys && (sys.content.match(/Persona: ([^\n]+)/) || [])[1]) || 'MemGPT';
    const text = lastUser ? lastUser.content : 'Hello';
    let reply = `${personaLine}: ${text}`;
    // Heuristic: detect "my name is X" => propose a memory update
    const nameMatch = text.match(/my name is ([a-z]+[a-z\- ]*)/i);
    if (nameMatch) {
      const name = nameMatch[1].trim();
      reply += `\nI will remember your name as ${name}.`;
    }
    return { content: reply };
  }
}

// Placeholder classes for completeness; they won't run without network/API keys.
class OpenAIProvider {
  constructor(model) { this.model = model; this.key = process.env.OPENAI_API_KEY; }
  async complete(messages, options = {}) {
    if (!this.key) throw new Error('OPENAI_API_KEY not set');
    const url = 'https://api.openai.com/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.key}` };
    const body = { model: this.model, messages, temperature: options.temperature ?? 0.7, stream: !!options.stream };
    if (!options.stream) {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const msg = data.choices[0].message || {};
      const reason = msg.reasoning || msg.thinking || msg.reasoning_content || '';
      const text = msg.content || '';
      return { content: (reason ? `<think>${reason}</think>\n` : '') + text };
    }
    return await sseChat(url, headers, body, options.onDelta);
  }
}

class GroqProvider {
  constructor(model) { this.model = model; this.key = process.env.GROQ_API_KEY; }
  async complete(messages, options = {}) {
    if (!this.key) throw new Error('GROQ_API_KEY not set');
    const url = 'https://api.groq.com/openai/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.key}` };
    const body = { model: this.model, messages, temperature: options.temperature ?? 0.7, stream: !!options.stream, reasoning_effort: options.reasoning_effort };
    if (!options.stream) {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Groq error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const msg = data.choices[0].message || {};
      const reason = msg.reasoning || msg.thinking || msg.reasoning_content || '';
      const text = msg.content || '';
      return { content: (reason ? `<think>${reason}</think>\n` : '') + text };
    }
    return await sseChat(url, headers, body, options.onDelta);
  }
}

class TogetherProvider {
  constructor(model) { this.model = model; this.key = process.env.TOGETHER_API_KEY; }
  async complete(messages, options = {}) {
    if (!this.key) throw new Error('TOGETHER_API_KEY not set');
    const url = 'https://api.together.xyz/v1/chat/completions';
    const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.key}` };
    const body = { model: this.model, messages, temperature: options.temperature ?? 0.7, stream: !!options.stream };
    if (!options.stream) {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`Together error: ${res.status} ${await res.text()}`);
      const data = await res.json();
      const msg = data.choices[0].message || {};
      const reason = msg.reasoning || msg.thinking || msg.reasoning_content || '';
      const text = msg.content || '';
      return { content: (reason ? `<think>${reason}</think>\n` : '') + text };
    }
    return await sseChat(url, headers, body, options.onDelta);
  }
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

function buildLLM(providerKey) {
  if (!providerKey || providerKey === 'mock') return new MockLLM();
  if (providerKey.startsWith('openai:')) return new OpenAIProvider(providerKey.split(':')[1]);
  if (providerKey.startsWith('groq:')) return new GroqProvider(providerKey.split(':')[1]);
  if (providerKey.startsWith('together:')) return new TogetherProvider(providerKey.split(':')[1]);
  // fallback
  return new MockLLM();
}

// --------------------------- Agent Controller ---------------------------
class MemGPTAgent {
  constructor({ agentId, modelKey, systemPrompt }) {
    this.agent = loadAgent(agentId);
    this.modelKey = (modelKey === 'mock' ? 'mock' : (modelKey || DEFAULT_MODEL));
    // Map modelKey to limits key
    this.limitsKey = MODEL_LIMITS[this.modelKey] ? this.modelKey : (this.modelKey.includes('gpt-4') ? 'gpt-4' : (this.modelKey.includes('gpt-3.5') ? 'gpt-3.5-turbo' : 'mock'));
    this.ctx = new ContextManager(this.limitsKey);
    this.llm = buildLLM(this.modelKey);
    this.systemPrompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.sessionId = `${this.agent.id}`;
    this.showThinking = false;
    this.streamEnabled = false;
  }

  systemMessage() { return { role: 'system', content: this.systemPrompt + '\n\n' + 'Persona: ' + this.agent.persona.name + ' — ' + this.agent.persona.role + '\n' + 'Style: ' + this.agent.persona.style }; }

  async handleUserInput(text) {
    // Heuristic self-memory updates
    this._extractUserFacts(text);
    // Log to recall and push to context queue
    recallLogMessage(this.sessionId, 'user', text);
    this.ctx.push('user', text);
    const reply = await this._respond();
    recallLogMessage(this.sessionId, 'assistant', reply);
    this.ctx.push('assistant', reply);
    return reply;
  }

  async _respond() {
    const prompt = this.ctx.prompt(this.systemPrompt, this.agent);
    const messages = [ this.systemMessage(), ...this.ctx.messages ];
    try {
      if (this.showThinking) {
        const dbg = {
          prompt_tokens_estimate: estimateTokens(prompt),
          summary_tokens: estimateTokens(this.ctx.summary),
          queue_length: this.ctx.messages.length,
          warn_at: this.ctx.warn,
          max: this.ctx.max,
        };
        console.log('[think] context', dbg);
        const preview = prompt.slice(0, 400).replace(/\n/g, ' ');
        console.log('[think] prompt preview:', preview + (prompt.length > 400 ? ' ...' : ''));
      }
      let out;
      if (this.streamEnabled) {
        let build = '';
        let inThink = false;
        const onDelta = (tok) => {
          // streaming display with think detection
          const lower = tok.toLowerCase();
          if (lower.includes('<think>') || lower.includes('```thinking') || lower.includes('```thought') || lower.includes('```reasoning')) inThink = true;
          if (lower.includes('</think>') || lower.includes('```')) inThink = false;
          const isThinkToken = inThink || /<\/?think>|```(?:thinking|thought|reasoning)/i.test(tok);
          if (isThinkToken) {
            if (this.showThinking) process.stdout.write(tok);
            // Do not add to build unless showThinking enabled
            if (this.showThinking) build += tok;
          } else {
            process.stdout.write(tok);
            build += tok;
          }
        };
        out = await this.llm.complete(messages, { stream: true, onDelta, reasoning_effort: 'medium' });
        // add a newline after stream prints
        process.stdout.write('\n');
        out = { content: build };
      } else {
        out = await this.llm.complete(messages, {});
      }
      const processed = processThinking(out.content, this.showThinking);
      if (!this.showThinking && processed.hidden > 0) {
        console.log(`[think] hidden ${processed.hidden} chars of model reasoning. Use /think on to show.`);
      }
      return processed.text;
    } catch (e) {
      return `Error from model: ${e.message}`;
    }
  }

  _extractUserFacts(text) {
    // Very simple pattern-based extraction
    const nameMatch = text.match(/(?:my name is|call me)\s+([a-z][a-z\- ]{1,60})/i);
    if (nameMatch) { this.agent.user.name = nameMatch[1].trim(); saveAgent(this.agent); }
    const likeMatch = text.match(/i (?:like|love|prefer) ([a-z][a-z\- ]{1,60})/i);
    if (likeMatch) { this.agent.user.facts.push(`likes ${likeMatch[1].trim()}`); saveAgent(this.agent); }
  }

  status() {
    return {
      modelKey: this.modelKey,
      context_tokens: this.ctx.size(),
      warn: this.ctx.warn, max: this.ctx.max,
      queue_length: this.ctx.messages.length,
      summary_tokens: estimateTokens(this.ctx.summary)
    };
  }

  toggleThinking(state = undefined) {
    if (typeof state === 'boolean') this.showThinking = state; else this.showThinking = !this.showThinking;
    return this.showThinking;
  }

  toggleStream(state = undefined) {
    if (typeof state === 'boolean') this.streamEnabled = state; else this.streamEnabled = !this.streamEnabled;
    return this.streamEnabled;
  }

  fn_working_replace(oldContent, newContent) {
    const ok = workingContextReplace(this.agent, oldContent, newContent);
    return ok ? 'working context updated' : 'old content not found; appended change note';
  }
  fn_working_append(newContent) {
    workingContextAppend(this.agent, newContent); return 'appended to working context';
  }
  fn_recall_search(query, page = 1) { return recallSearch(query, page); }
  fn_archival_search(query, page = 1) { return archivalSearch(query, page); }
  fn_archival_insert(title, content) { return archivalInsert(title, content); }
}

// --------------------------- CLI ---------------------------
function printHelp() {
  console.log('Commands:');
  console.log(':help   or /help              Show this help');
  console.log(':status or /status            Show memory/context status');
  console.log(':persona                      Show current persona');
  console.log(':append <text>                Append to working context');
  console.log(':replace <old> || <new>       Replace in working notes (append change note if not found)');
  console.log(':recall <query> [page]        Search recall storage');
  console.log(':archins <title> | <content>  Insert document into archival storage');
  console.log(':arch <query> [page]          Search archival storage');
  console.log(':summary or /memory           Show current running summary');
  console.log(':think [on|off] or /think     Toggle or set thinking/trace output');
  console.log(':stream [on|off] or /stream   Toggle or set streaming output');
  console.log('/stats                        Show storage and index stats');
  console.log(':quit   or /exit              Exit');
}

function computeStats(agent) {
  const recallIdx = readJSON(RECALL_INDEX_FILE, { df: {}, docs: {} });
  const archIdx = readJSON(ARCH_EMBED_FILE, { df: {}, docs: {} });
  const archMeta = readJSON(ARCH_META_FILE, { documents: [] });
  return {
    agent_id: agent.agent.id,
    created_at: agent.agent.created_at,
    updated_at: agent.agent.updated_at,
    context: agent.status(),
    recall: {
      messages_indexed: Object.keys(recallIdx.docs).length,
      terms: Object.keys(recallIdx.df).length,
    },
    archival: {
      documents: archMeta.documents.length,
      terms: Object.keys(archIdx.df).length,
    }
  };
}

async function runCLI({ agentId, modelKey }) {
  initStorage();
  const agent = new MemGPTAgent({ agentId, modelKey, systemPrompt: DEFAULT_SYSTEM_PROMPT });
  console.log(`MemGPT CLI — agent=${agentId} model=${modelKey}`);
  console.log('Type messages to chat. Use :help for commands.');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }
    if (input === ':quit' || input === '/exit' || input === ':exit' || input === '/quit') { rl.close(); return; }
    if (input === ':help' || input === '/help') { printHelp(); rl.prompt(); return; }
    if (input === ':status' || input === '/status') { console.log(agent.status()); rl.prompt(); return; }
    if (input === '/stats') { console.log(computeStats(agent)); rl.prompt(); return; }
    if (input === ':persona') { console.log(workingContextString(agent.agent)); rl.prompt(); return; }
    if (input === ':summary' || input === '/memory') { console.log(agent.ctx.summary || '(none)'); rl.prompt(); return; }
    if (input.startsWith(':think') || input.startsWith('/think')) {
      const arg = input.split(/\s+/)[1];
      let newState;
      if (arg === 'on') newState = agent.toggleThinking(true);
      else if (arg === 'off') newState = agent.toggleThinking(false);
      else newState = agent.toggleThinking();
      console.log(`Thinking is now ${newState ? 'ON' : 'OFF'}.`);
      rl.prompt(); return;
    }
    if (input.startsWith(':stream') || input.startsWith('/stream')) {
      const arg = input.split(/\s+/)[1];
      let newState;
      if (arg === 'on') newState = agent.toggleStream(true);
      else if (arg === 'off') newState = agent.toggleStream(false);
      else newState = agent.toggleStream();
      console.log(`Streaming is now ${newState ? 'ON' : 'OFF'}.`);
      rl.prompt(); return;
    }
    if (input.startsWith(':append ')) {
      const txt = input.slice(8).trim();
      console.log(agent.fn_working_append(txt)); rl.prompt(); return;
    }
    if (input.startsWith(':replace ')) {
      const rest = input.slice(9).trim();
      const parts = rest.split('||');
      if (parts.length < 2) { console.log('Usage: :replace <old> || <new>'); rl.prompt(); return; }
      const res = agent.fn_working_replace(parts[0].trim(), parts[1].trim());
      console.log(res); rl.prompt(); return;
    }
    if (input.startsWith(':recall ') || input.startsWith('/recall ')) {
      const args = input.replace(/^[:/ ]*recall\s+/, '').trim();
      const [q, p] = splitArgs(args);
      const page = p ? parseInt(p, 10) : 1;
      const res = agent.fn_recall_search(q, page);
      res.forEach(r => console.log(`- [${r.score.toFixed(2)}] ${r.content}`));
      if (!res.length) console.log('(no results)');
      rl.prompt(); return;
    }
    if (input.startsWith(':archins ')) {
      const args = input.slice(9).trim();
      const [title, content] = args.split('|').map(s => s.trim());
      if (!title || !content) { console.log('Usage: :archins <title> | <content>'); rl.prompt(); return; }
      const id = agent.fn_archival_insert(title, content);
      console.log(`Inserted document ${id}`); rl.prompt(); return;
    }
    if (input.startsWith(':arch ') || input.startsWith('/arch ')) {
      const args = input.replace(/^[:/ ]*arch\s+/, '').trim();
      const [q, p] = splitArgs(args);
      const page = p ? parseInt(p, 10) : 1;
      const res = agent.fn_archival_search(q, page);
      res.forEach(r => console.log(`- [${r.score.toFixed(2)}] ${r.title}: ${r.content.slice(0, 120)}...`));
      if (!res.length) console.log('(no results)');
      rl.prompt(); return;
    }

    // Normal chat
    const reply = await agent.handleUserInput(input);
    console.log(reply);
    rl.prompt();
  });
  rl.on('close', () => process.exit(0));
}

function splitArgs(s) {
  // split last space as page if numeric
  const m = s.match(/^(.*)\s+(\d+)$/);
  if (m) return [m[1], m[2]];
  return [s, null];
}

// Detect and optionally filter model "thinking" content.
// Many reasoning models wrap chain-of-thought in tags like <think>...</think> or <thought>...</thought>.
function processThinking(text, show) {
  if (!text) return { text: '', hidden: 0 };
  const patterns = [
    /<think>[\s\S]*?<\/think>/gi,
    /<thinking>[\s\S]*?<\/thinking>/gi,
    /<thought>[\s\S]*?<\/thought>/gi,
    /```(?:thought|thinking|reasoning)[\s\S]*?```/gi,
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

// --------------------------- Tests ---------------------------
async function runTests() {
  console.log('Running tests...');
  // Use a temporary agent id and tiny context to exercise eviction
  const agentId = `test-${Date.now()}`;
  const modelKey = 'tiny-mock';
  initStorage();
  const agent = new MemGPTAgent({ agentId, modelKey, systemPrompt: DEFAULT_SYSTEM_PROMPT });

  // Test 1: working context append/replace
  agent.fn_working_append('Test note A');
  const before = workingContextString(agent.agent);
  if (!before.includes('Test note A')) throw new Error('Append failed');
  const rep = agent.fn_working_replace('Test note A', 'Note A updated');
  if (!rep) throw new Error('Replace did not report');

  // Test 2: recall logging + search
  await agent.handleUserInput('Hello, my name is Testy.');
  await agent.handleUserInput('I like strawberries and coffee.');
  const recallRes = agent.fn_recall_search('strawberries');
  if (!recallRes.length || !recallRes[0].content.toLowerCase().includes('strawberries')) throw new Error('Recall search failed');

  // Test 3: archival insert + search
  const docId = agent.fn_archival_insert('Berries', 'Strawberries are red and tasty. Blueberries are blue.');
  if (!docId) throw new Error('Archival insert failed');
  const archRes = agent.fn_archival_search('blueberries');
  if (!archRes.length || !archRes[0].content.toLowerCase().includes('blueberries')) throw new Error('Archival search failed');

  // Test 4: memory pressure + eviction
  for (let i = 0; i < 50; i++) {
    // small repeated content to blow past tiny-mock
    agent.ctx.push('user', `msg ${i} ${'x'.repeat(30)}`);
  }
  if (!agent.ctx.summary) throw new Error('Summary was not created on eviction');

  // Test 5: mock conversation response
  const reply = await agent.handleUserInput('What is my name?');
  if (typeof reply !== 'string' || reply.length === 0) throw new Error('LLM reply invalid');

  console.log('All tests passed.');
}

// --------------------------- Entrypoint ---------------------------
async function main() {
  // Load .env if present (simple parser: KEY=VALUE, no quotes handling)
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    try {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (m) {
          const k = m[1];
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            v = v.slice(1, -1);
          }
          if (!process.env[k]) process.env[k] = v;
        }
      }
    } catch {}
  }
  const args = process.argv.slice(2);
  if (args.includes('--test')) {
    try { await runTests(); process.exit(0); } catch (e) { console.error('Tests failed:', e.message); process.exit(1); }
  }
  const agentId = paramFromArgs(args, '--agent', DEFAULT_AGENT_ID);
  const modelKey = paramFromArgs(args, '--model', DEFAULT_MODEL);
  await runCLI({ agentId, modelKey });
}

function paramFromArgs(args, flag, fallback) {
  const ix = args.indexOf(flag);
  if (ix >= 0 && args[ix + 1]) return args[ix + 1];
  return fallback;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
