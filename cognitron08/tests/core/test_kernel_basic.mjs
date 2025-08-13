import { runTurn } from '../../core/runTurn.js';
import { assert, assertIncludes } from '../util/assert.js';

class FakeToolProvider {
  constructor(script = []) { this.script = script; this.step = 0; }
  async complete() {
    const s = this.script[this.step++] || {};
    if (s.toolCalls) return { choices: [{ message: { tool_calls: s.toolCalls, content: s.assistantContent || '' } }] };
    return { choices: [{ message: { content: s.assistantContent || '' } }] };
  }
}

const tools = {
  core_memory_append: async ({ key, value }) => ({ success: true, message: `stored ${key}=${value}` }),
  pause_heartbeats: async ({ message }) => ({ success: true, message }),
};

const toolDefs = [
  { type: 'function', function: { name: 'core_memory_append', parameters: { type: 'object', properties: { key: {type:'string'}, value: {type:'string'} }, required: ['key','value'] } } },
  { type: 'function', function: { name: 'pause_heartbeats', parameters: { type: 'object', properties: { message: {type:'string'} }, required: ['message'] } } }
];

const messages = [{ role: 'system', content: 'You are minimal.' }];

const script = [
  { toolCalls: [{ id: 't1', type: 'function', function: { name: 'core_memory_append', arguments: JSON.stringify({ key: 'user', value: 'Bob' }) } }], assistantContent: '' },
  { toolCalls: [{ id: 't2', type: 'function', function: { name: 'pause_heartbeats', arguments: JSON.stringify({ message: 'Done.' }) } }], assistantContent: '' },
];

const provider = new FakeToolProvider(script);
const res = await runTurn({ messages, provider, toolDefinitions: toolDefs, tools, maxHeartbeats: 5 });

assertIncludes(res.finalMessage, 'Done', 'should return final pause message');
assert(res.messages.some(m => m.role === 'tool'), 'should include tool-role messages');

console.log('OK kernel_basic');
