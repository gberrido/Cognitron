# Cognitron08 API Documentation

Complete API reference for the Cognitron08 MemGPT implementation.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Kernel API](#core-kernel-api)
- [Reference Implementation](#reference-implementation)
- [Memory Stores](#memory-stores)
- [Provider Interface](#provider-interface)
- [Tool System](#tool-system)
- [Utilities](#utilities)

---

## Architecture Overview

Cognitron08 follows a 3-layer architecture:

```
┌─────────────────────────────────┐
│  CLI (cli/index.js)             │ ← User Interface
├─────────────────────────────────┤
│  RefAgent (ref/agent.js)        │ ← Orchestration
├─────────────────────────────────┤
│  Memory Stores (ref/memory/)    │ ← Persistence
├─────────────────────────────────┤
│  Kernel (core/runTurn.js)       │ ← Pure Heartbeat Engine
└─────────────────────────────────┘
```

**Key Principles:**
- **Zero-dependency kernel** - Core can be used standalone
- **Atomic file operations** - Crash-safe persistence
- **Provider abstraction** - Support multiple LLMs
- **Comprehensive validation** - Input sanitization & error handling

---

## Core Kernel API

The kernel provides a pure function for running MemGPT heartbeat loops.

### `runTurn(params)`

Main entry point for the heartbeat engine.

**Parameters:**
```typescript
interface RunTurnParams {
  messages: ChatMessage[];          // Conversation history
  provider: Provider;                // LLM provider instance
  toolDefinitions?: ToolDefinition[]; // OpenAI-format tool schemas
  tools?: ToolRegistry;              // Map of tool implementations
  maxHeartbeats?: number;            // Max iterations (default: 5)
  hooks?: KernelHooks;               // Event callbacks
}
```

**Returns:**
```typescript
interface RunTurnResult {
  finalMessage: string;    // Final response to user
  messages: ChatMessage[]; // Updated conversation
}
```

**Example:**
```javascript
import { runTurn } from './core/runTurn.js';

const result = await runTurn({
  messages: [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello!' }
  ],
  provider: myProvider,
  toolDefinitions: toolDefs,
  tools: { pause_heartbeats: async () => ({ success: true }) },
  maxHeartbeats: 5
});

console.log(result.finalMessage);
```

**Hooks:**
```typescript
interface KernelHooks {
  onHeartbeatStart?(ctx: { heartbeat: number; messages: ChatMessage[] }): void;
  onHeartbeatEnd?(ctx: { heartbeat: number; messages: ChatMessage[]; choice: any }): void;
  onToolCall?(ctx: { id: string; name: string; args: any }): void;
  onToolResult?(ctx: { id: string; name: string; result: any }): void;
  onPause?(ctx: { finalMessage: string }): void;
}
```

---

## Reference Implementation

### RefAgent

High-level agent with memory management and provider orchestration.

#### Constructor

```javascript
const agent = new RefAgent(options);
```

**Options:**
```typescript
interface RefAgentOptions {
  provider?: string;              // 'mock' | 'groq' | 'together' (default: 'mock')
  temperature?: number;           // Sampling temperature (default: 0.7)
  maxTokens?: number;            // Max tokens per completion (default: 2000)
  maxConversationSize?: number;  // Max messages before archiving (default: 1000)
  dataDir?: string;              // Data directory (default: './cognitron08-data')
}
```

#### Methods

##### `async initProviders()`

Initialize LLM providers. Call before using the agent.

```javascript
await agent.initProviders();
```

##### `async loadState()`

Load persisted memory state from disk.

```javascript
await agent.loadState();
```

##### `async saveState()`

Save memory state to disk atomically.

```javascript
await agent.saveState();
```

##### `async processUserTurn(input)`

Process user input and generate response.

**Parameters:**
- `input` (string) - User message

**Returns:**
```typescript
interface TurnResult {
  message: string;              // AI response
  canStream: boolean;           // Whether streaming is possible
  tools: Array<{                // Tools used
    name: string;
    ok: boolean;
    message: string;
  }>;
}
```

**Example:**
```javascript
const result = await agent.processUserTurn('What is my name?');
console.log(result.message);
console.log('Tools used:', result.tools);
```

##### `async resetAll()`

Reset all memory (conversation, core memory, archival).

```javascript
await agent.resetAll();
```

##### `getTokenUsage()`

Get current token usage statistics.

**Returns:**
```typescript
interface TokenUsage {
  total: number;         // Total tokens
  system: number;        // System message tokens
  summary: number;       // Summary tokens
  conversation: number;  // Conversation tokens
  percentage: number;    // Usage as fraction of maxContext
  remaining: number;     // Remaining token budget
}
```

##### `async compactNow()`

Force memory compaction (evict old messages, update summary).

```javascript
await agent.compactNow();
```

##### `async enforceConversationLimit()`

Archive old messages if conversation exceeds `maxConversationSize`.
Called automatically after each turn.

---

## Memory Stores

### RecallStore

Manages searchable conversation history with TF-IDF indexing.

#### Constructor

```javascript
const recall = new RecallStore(dataDir);
```

#### Methods

##### `async ensure()`

Create data directory and initialize index file.

##### `async appendMessages(messages)`

Append messages to recall storage atomically.

**Parameters:**
```typescript
messages: Array<{
  id: number | string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp: string;  // ISO 8601 format
}>
```

**Example:**
```javascript
await recall.appendMessages([
  {
    id: 1,
    role: 'user',
    content: 'Hello, world!',
    timestamp: new Date().toISOString()
  }
]);
```

##### `async search(query, page = 1, size = 5)`

Search messages using TF-IDF ranking.

**Returns:**
```typescript
Array<{
  id: number | string;
  score: number;        // Relevance score
  content: string;
  meta: {
    role?: string;
    timestamp?: string;
  };
}>
```

**Example:**
```javascript
const results = await recall.search('machine learning', 1, 10);
results.forEach(r => {
  console.log(`[${r.score.toFixed(2)}] ${r.content}`);
});
```

---

### ArchivalStore

Manages long-term document storage.

#### Constructor

```javascript
const archival = new ArchivalStore(dataDir);
```

#### Methods

##### `async ensure()`

Create archival directory structure.

##### `async insert(title, content)`

Insert a document with sanitization and validation.

**Parameters:**
- `title` (string) - Document title (max 200 chars)
- `content` (string) - Document content (max 50,000 chars)

**Returns:** Document ID (string)

**Validation:**
- Title and content must be non-empty strings
- Filenames are sanitized to prevent path traversal
- Content size is validated

**Example:**
```javascript
const docId = await archival.insert(
  'Machine Learning Basics',
  'Introduction to supervised learning...'
);
console.log('Created document:', docId);
```

##### `async search(query, page = 1, size = 5)`

Search documents using TF-IDF.

**Returns:**
```typescript
Array<{
  id: string;
  score: number;
  title: string;
}>
```

##### `async count()`

Get total number of stored documents.

**Returns:** number

##### `async reset()`

Delete all archival data.

---

### SessionStore

Manages core memory and session state.

#### Constructor

```javascript
const session = new SessionStore(dataDir);
```

#### Methods

##### `async ensure()`

Create data directory.

##### `async saveWorking(map)`

Save working context (core memory) atomically.

**Parameters:**
- `map` (Map) - Map of key-value pairs with timestamps

**Example:**
```javascript
const context = new Map([
  ['user_name', { value: 'Alice', timestamp: new Date().toISOString() }]
]);
await session.saveWorking(context);
```

##### `async loadWorking()`

Load working context from disk.

**Returns:** Map - Empty Map if file doesn't exist

##### `async saveSession(state)`

Save session state atomically.

**Parameters:**
```typescript
state: {
  recursiveSummary?: string;
  lastUpdated?: string;
  [key: string]: any;
}
```

##### `async loadSession()`

Load session state.

**Returns:** Object - Empty object if file doesn't exist

##### `async loadRecentConversation(n = 50)`

Load last N messages from recall storage.

**Parameters:**
- `n` (number) - Number of messages to load

**Returns:** Array of messages

##### `async resetNonArchival()`

Delete all non-archival files (conversation, core memory, session).

---

## Provider Interface

All providers must implement:

```typescript
interface Provider {
  /**
   * Complete a chat request
   */
  complete(payload: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): Promise<ChatCompletionResponse>;

  /**
   * Stream a chat request (optional)
   */
  stream?(payload: {
    messages: ChatMessage[];
    tools?: ToolDefinition[];
  }): AsyncIterable<ChatCompletionChunk>;
}
```

### Included Providers

#### MockProvider

Simple mock for testing.

```javascript
import { MockProvider } from './ref/providers/mock.js';
const provider = new MockProvider();
```

#### GroqProvider

Groq API with retry logic.

```javascript
import { GroqProvider } from './ref/providers/groq.js';
const provider = new GroqProvider(apiKey, model, temperature, maxTokens);
```

**Features:**
- Exponential backoff retry (max 3 attempts)
- Retries on network errors and HTTP 429/500/502/503/504
- Streaming support

#### TogetherProvider

Together AI API with HTTP fallback.

```javascript
import { TogetherProvider } from './ref/providers/together.js';
const provider = new TogetherProvider(apiKey, model, temperature, maxTokens);
```

**Features:**
- SDK + HTTP fallback
- Exponential backoff retry
- Streaming support

---

## Tool System

### Tool Registry

```javascript
import { getToolRegistry, getToolDefinitions } from './ref/tools.js';

const tools = getToolRegistry(agent);
const toolDefs = getToolDefinitions();
```

### Available Tools

#### `core_memory_append(key, value)`

Store a fact in core memory.

**Validation:**
- `key`: non-empty string, max 100 chars
- `value`: non-empty string, max 2000 chars

**Returns:**
```typescript
{ success: boolean; message: string; }
```

#### `core_memory_replace(key, new_value)`

Update an existing core memory entry.

**Validation:**
- Key must exist
- `new_value`: non-empty string, max 2000 chars

#### `conversation_search(query, max_results = 5)`

Search conversation history.

**Validation:**
- `query`: non-empty string, max 500 chars
- `max_results`: number between 1-100

**Returns:**
```typescript
{
  success: boolean;
  message: string;
  data: Array<{ id, score, content, meta }>;
}
```

#### `archival_memory_insert(title, content)`

Store a document in archival memory.

**Validation:**
- `title`: non-empty string, max 200 chars
- `content`: non-empty string, max 50,000 chars

#### `archival_memory_search(query)`

Search archival documents.

**Validation:**
- `query`: non-empty string, max 500 chars

#### `get_memory_status()`

Get memory usage statistics.

**Returns:**
```typescript
{
  success: boolean;
  message: string; // "Memory: 1234/8192 tokens, Core facts: 5, Archival: 10"
}
```

#### `pause_heartbeats(message)`

Signal end of heartbeat loop.

**Validation:**
- `message`: optional string, max 1000 chars

---

## Utilities

### Tokenizer

Improved token counting with word-based heuristics.

```javascript
import { countTokens, countMessageTokens, exceedsLimit } from './ref/utils/tokenizer.js';
```

#### `countTokens(text)`

Estimate token count for text.

**Returns:** number

**Algorithm:**
- Words ≤4 chars: 1 token
- Words 5-8 chars: 1.5 tokens
- Longer words: ceil(length / 4) tokens
- Numbers: ceil(length / 3) tokens
- Punctuation: 1 token each

**Example:**
```javascript
const tokens = countTokens('Hello, world!');
console.log(`Estimated tokens: ${tokens}`);
```

#### `countMessageTokens(messages)`

Count tokens for an array of messages with overhead.

**Parameters:**
```typescript
messages: Array<{
  role: string;
  content: string;
  tool_call_id?: string;
}>
```

**Returns:** number

**Overhead:**
- Base: 4 tokens per message
- Tool messages: +2 tokens

#### `getTokenStats(text)`

Get detailed statistics.

**Returns:**
```typescript
{
  tokens: number;
  chars: number;
  words: number;
  avgTokensPerWord: number;
  estimatedAccuracy: string; // "±15%"
}
```

#### `exceedsLimit(text, limit, margin = 0.1)`

Check if token count exceeds limit with safety margin.

**Parameters:**
- `text` (string)
- `limit` (number) - Token limit
- `margin` (number) - Safety margin (0-1), default 0.1 (10%)

**Returns:** boolean

**Example:**
```javascript
if (exceedsLimit(text, 4000, 0.1)) {
  console.log('Text exceeds 90% of 4000 token limit');
}
```

---

## Error Handling

### Standard Error Response

All tools return standardized responses:

```typescript
interface ToolResponse {
  success: boolean;
  message: string;
  data?: any;
}
```

**Success:**
```javascript
{ success: true, message: 'Operation completed', data: [...] }
```

**Failure:**
```javascript
{ success: false, message: 'Error description' }
```

### Provider Errors

Providers automatically retry on:
- Network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND)
- HTTP 429 (rate limit)
- HTTP 500, 502, 503, 504 (server errors)

**Retry Strategy:**
- Max 3 attempts
- Exponential backoff: 1s, 2s, 4s

### Memory Store Errors

All file operations are atomic:
- Write to temporary file
- Rename to target file (atomic on POSIX systems)
- Clean up temporary files on error

**Graceful Degradation:**
- Missing files return empty defaults
- Malformed data is skipped with warnings
- Concurrent operations are serialized

---

## Performance Characteristics

### Memory Stores

**RecallStore:**
- Append: O(n) where n = number of messages being indexed
- Search: O(m) where m = total messages (TF-IDF calculation)
- Recommended max: 10,000 messages

**ArchivalStore:**
- Insert: O(1) for file write, O(n) for index update
- Search: O(d) where d = total documents
- Recommended max: 1,000 documents

**SessionStore:**
- Save/Load: O(k) where k = number of key-value pairs
- Scales well to 10,000+ entries

### Token Counting

- countTokens: O(w) where w = number of words
- Performance: ~500,000 chars/sec
- Accuracy: ±15% compared to tiktoken

---

## Configuration

### Environment Variables

```bash
GROQ_API_KEY=xxx        # Required for Groq provider
TOGETHER_API_KEY=xxx    # Required for Together AI provider
```

### Agent Configuration

```javascript
const agent = new RefAgent({
  provider: 'groq',             // Provider to use
  temperature: 0.7,             // Sampling temperature
  maxTokens: 2000,             // Max tokens per completion
  maxConversationSize: 1000,   // Memory leak prevention
  dataDir: './data'            // Storage directory
});
```

### Context Budgets

```javascript
agent.maxContext = 8192;                  // Total context window
agent.memoryPressureThreshold = 0.7;     // Warn at 70%
agent.evictionThreshold = 1.0;           // Evict at 100%
agent.evictionPercentage = 0.5;          // Evict oldest 50%
```

---

## Best Practices

### 1. Always Call ensure()

```javascript
const store = new RecallStore('./data');
await store.ensure(); // Create directories
```

### 2. Handle Validation Errors

```javascript
const result = await tools.core_memory_append({ key, value });
if (!result.success) {
  console.error('Validation failed:', result.message);
}
```

### 3. Monitor Token Usage

```javascript
const usage = agent.getTokenUsage();
if (usage.percentage > 0.8) {
  await agent.compactNow();
}
```

### 4. Use Atomic Operations

All memory stores use atomic writes. Don't bypass with direct file I/O.

### 5. Validate User Input

```javascript
// Sanitize before passing to tools
const safeTitle = title.substring(0, 200);
const safeContent = content.substring(0, 50000);
```

### 6. Implement Graceful Shutdown

```javascript
process.on('SIGINT', async () => {
  await agent.saveState();
  process.exit(0);
});
```

---

## Examples

### Complete Usage Example

```javascript
import { RefAgent } from './ref/agent.js';

// Initialize agent
const agent = new RefAgent({
  provider: 'groq',
  temperature: 0.7,
  dataDir: './my-data'
});

await agent.initProviders();
await agent.loadState();

// Process user input
const result = await agent.processUserTurn('Hello, my name is Alice');
console.log(result.message);

// Check memory
const usage = agent.getTokenUsage();
console.log(`Memory: ${usage.total}/${agent.maxContext} tokens`);

// Save and exit
await agent.saveState();
```

### Search Example

```javascript
import { RecallStore } from './ref/memory/recall.js';

const recall = new RecallStore('./data');
await recall.ensure();

const results = await recall.search('machine learning', 1, 10);
for (const hit of results) {
  console.log(`[${hit.score.toFixed(2)}] ${hit.content}`);
}
```

---

## License

MIT - See LICENSE file for details

## Support

- GitHub Issues: https://github.com/anthropics/cognitron08/issues
- Documentation: See README.md and this file
