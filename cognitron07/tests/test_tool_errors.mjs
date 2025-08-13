import { MemGPTAgent } from '../sdk/agent.js';
import { FakeToolProvider } from './fake-provider.js';
import { assert, assertIncludes } from './util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron07/.test-tmp', `tool-errors-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

// Script: first heartbeat calls an unknown tool, second heartbeat pauses.
const script = [
  { toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'unknown_tool_xyz', arguments: '{}' } }], assistantContent: '' },
  { toolCalls: [{ id: 'call_2', type: 'function', function: { name: 'pause_heartbeats', arguments: JSON.stringify({ message: 'Resolved after error.' }) } }], assistantContent: '' }
];

const agent = new MemGPTAgent({ provider: 'mock', dataDir: tmp });
agent.provider = new FakeToolProvider(script);
agent.supportsTools = true;
await agent.loadState();

const r = await agent.processUserTurn('Trigger tool error then pause');
assertIncludes(r.message, 'Resolved', 'should end with pause after handling error');

// Verify that a tool-role message exists for the failed call
const toolMsgs = agent.conversation.filter(m => m.role === 'tool');
assert(toolMsgs.length >= 1, 'tool message injected');
assertIncludes(toolMsgs[0].content, 'Unknown tool', 'error propagated via tool message');

console.log('OK tool_errors');

