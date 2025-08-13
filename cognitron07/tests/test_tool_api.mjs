import { MemGPTAgent } from '../sdk/agent.js';
import { FakeToolProvider } from './fake-provider.js';
import { assert, assertIncludes } from './util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron07/.test-tmp', `tool-api-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

// Script: first response asks to store memory via tool_call, then pause
const script = [
  { toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'core_memory_append', arguments: JSON.stringify({ key: 'user', value: 'Bob' }) } }], assistantContent: '' },
  { toolCalls: [{ id: 'call_2', type: 'function', function: { name: 'pause_heartbeats', arguments: JSON.stringify({ message: 'Done.' }) } }], assistantContent: '' }
];

const agent = new MemGPTAgent({ provider: 'mock', dataDir: tmp });
agent.provider = new FakeToolProvider(script);
agent.supportsTools = true;
agent.debugTools = true;
await agent.loadState();

const r = await agent.processUserTurn('Please remember my name and pause');
assertIncludes(r.message, 'Done', 'should end with pause message');
// Ensure tool result persisted in core memory
assert(agent.coreMemory.get('user')?.value === 'Bob', 'core memory updated');

console.log('OK tool_api');

