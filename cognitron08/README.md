# Cognitron08 (Kernel + Reference)

[![Types](https://img.shields.io/badge/types-.d.ts-blue)](#typescript-typings)
[![Kernel](https://img.shields.io/badge/kernel-~55%20LoC-brightgreen)](#kernel-api)

Minimal, zero-dependency MemGPT-style kernel with a small reference layer and CLI.

- Kernel: `core/runTurn.js` (pure function-first heartbeat engine) and `core/types.js` (tiny JSDoc types)
- Reference: `ref/` implements a small “batteries-included” agent using the kernel
- CLI: `cli/index.js` — mirrors Cognitron07 CLI behavior

Run tests:

```bash
node tests/run-tests.mjs
```

Run CLI (mock):

```bash
node cli/index.js --provider mock
```

Run CLI (live):

```bash
export GROQ_API_KEY=...
export TOGETHER_API_KEY=...
node cli/index.js --provider groq   # or --provider together
```

## Kernel API

`runTurn({ messages, provider, tools, toolDefinitions, maxHeartbeats, hooks })`

- messages: Array of chat messages `{ role: 'system'|'user'|'assistant'|'tool', content, tool_call_id? }`
- provider: Object with `complete({ messages, tools? }) => Promise<Response>` and optional `stream(...)`
- tools: Map `{ [name]: async (args) => result }` — kernel executes tool_calls and injects tool-role messages
- toolDefinitions: Array of tool JSON schemas passed to provider (OpenAI-compatible)
- maxHeartbeats: Number of provider-call iterations (default 5)
- hooks (optional): `{ onHeartbeatStart, onHeartbeatEnd, onToolCall, onToolResult, onPause }`

Returns `{ finalMessage, messages }`

Example:

```js
import { runTurn } from './core/runTurn.js';

const tools = {
  core_memory_append: async ({ key, value }) => ({ success: true, message: `stored ${key}=${value}` }),
  pause_heartbeats: async ({ message }) => ({ success: true, message })
};

const toolDefs = [
  { type: 'function', function: { name: 'core_memory_append', parameters: { type: 'object', properties: { key: {type:'string'}, value: {type:'string'} }, required:['key','value'] } } },
  { type: 'function', function: { name: 'pause_heartbeats', parameters: { type: 'object', properties: { message: {type:'string'} }, required: ['message'] } } }
];

const messages = [{ role: 'system', content: 'You are minimal.' }, { role: 'user', content: 'My name is Alice' }];
const provider = { async complete() { return { choices: [{ message: { tool_calls: [
  { id:'t1', type:'function', function:{ name: 'core_memory_append', arguments: JSON.stringify({ key:'user', value:'Alice' }) } },
  { id:'t2', type:'function', function:{ name: 'pause_heartbeats', arguments: JSON.stringify({ message:'Done.' }) } }
] } }] }; } };

const res = await runTurn({ messages, provider, tools, toolDefinitions: toolDefs });
console.log(res.finalMessage); // "Done."
```

## CLI Parity

The reference CLI (`cli/index.js`) mirrors the Cognitron07 CLI:

- Commands: `/help`, `/provider <groq|together|mock>`, `/memory`, `/compact`, `/stream`, `/think`, `/autosum`, `/debugtools`, `/recall "<q>" [page] [size]`, `/arch "<q>" [page] [size]`, `/status`, `/clear`, `/reset`, `/exit`.
- Output: Provider status, toggle states, memory-ops block (per tool result), and the `💬 AI Response:` header. Streaming matches 07 (final turn only, non-mock providers).

Piped example:

```bash
printf "/status\nHello\n/exit\n" | node cli/index.js --provider mock
```

## Adapters Guide (Providers & Tools)

Providers
- Contract: `complete({ messages, tools? }) => Promise<Response>` where `Response.choices[0].message` can include either `content` or `tool_calls` (OpenAI-compatible). Optional `stream({ messages, tools? }) => AsyncIterable<ResponseChunk>`.
- Example (pseudo):

```js
class MyProvider {
  constructor(apiKey, model) { this.apiKey = apiKey; this.model = model; }
  async complete({ messages, tools }) {
    // Translate to your API; pass tools as function schemas if supported.
    return callMyLLM(this.apiKey, { model: this.model, messages, tools });
  }
  async stream({ messages, tools }) {
    // Return an async iterable of response deltas if supported.
    return callMyLLMStream(this.apiKey, { model: this.model, messages, tools });
  }
}
```

Tools
- Contract: `{ [name: string]: async (args) => result }` where `result` is serializable and will be injected back as a tool-role message.
- Example:

```js
const tools = {
  core_memory_append: async ({ key, value }) => ({ success: true, message: `stored ${key}=${value}` }),
  pause_heartbeats: async ({ message }) => ({ success: true, message })
};
```

With both in place, call `runTurn({ messages, provider, tools, toolDefinitions })` to execute the heartbeat loop.


### Schema mapping (Adapters Guide)

Most OpenAI-compatible providers accept function-call tool schemas. Map your internal tool registry to a schema array:

```js
// Your runtime tool registry
const tools = {
  core_memory_append: async ({ key, value }) => ({ success: true, message: `stored ${key}=${value}` }),
  pause_heartbeats: async ({ message }) => ({ success: true, message }),
};

// Map to JSON Schema (OpenAI-style)
const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'core_memory_append',
      description: 'Append or set a key=value in core memory',
      parameters: {
        type: 'object',
        properties: { key: { type: 'string' }, value: { type: 'string' } },
        required: ['key', 'value']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pause_heartbeats',
      description: 'Finish tool usage and return a final message to the user',
      parameters: {
        type: 'object',
        properties: { message: { type: 'string' } },
        required: ['message']
      }
    }
  }
];
```

Use these with the kernel:

```js
import { runTurn } from './core/runTurn.js';
const res = await runTurn({ messages, provider, tools, toolDefinitions, maxHeartbeats: 5 });
```

### TypeScript typings

Type definitions are shipped for editor/TS support:
- `core/types.d.ts`: ChatMessage, Provider, ToolRegistry, ToolDefinition, KernelHooks, RunTurnParams/Result
- `core/runTurn.d.ts`: `runTurn(params: RunTurnParams): Promise<RunTurnResult>`

### CLI Script Mode

For deterministic, non-interactive runs (CI/tests), pipe commands to stdin with `--script`:

```bash
printf "/status
Hello
/exit
" | node cli/index.js --provider mock --script
```
