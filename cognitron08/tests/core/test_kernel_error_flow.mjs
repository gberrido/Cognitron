import { runTurn } from '../../core/runTurn.js';
import { assert, assertIncludes } from '../util/assert.js';

class ScriptProvider {
  constructor(script) { this.script = script; this.i = 0; }
  async complete() { return this.script[this.i++] || { choices: [{ message: { content: 'OK' } }] }; }
}

const tools = {
  pause_heartbeats: async ({ message }) => ({ success: true, message })
};

const toolDefs = [
  { type: 'function', function: { name: 'pause_heartbeats', parameters: { type: 'object', properties: { message: {type:'string'} }, required: ['message'] } } }
];

const script = [
  // First heartbeat: unknown tool with invalid JSON
  { choices: [{ message: { tool_calls: [ { id:'x', type:'function', function:{ name: 'nonexistent_tool', arguments: '{oops' } } ] } }] } ,
  // Second heartbeat: pause
  { choices: [{ message: { tool_calls: [ { id:'z', type:'function', function:{ name: 'pause_heartbeats', arguments: JSON.stringify({ message: 'Ok after error' }) } } ] } }] }
];

const messages = [{ role: 'system', content: 'You are minimal.' }, { role: 'user', content: 'do work' }];
const provider = new ScriptProvider(script);
const res = await runTurn({ messages, provider, tools, toolDefinitions: toolDefs, maxHeartbeats: 3 });

assertIncludes(res.finalMessage, 'Ok after error', 'should finish after error flow');
const toolMsgs = res.messages.filter(m => m.role === 'tool');
assert(toolMsgs.length >= 1, 'tool message should be injected');
assertIncludes(toolMsgs[0].content, 'Unknown tool', 'unknown tool error surfaced in tool message');

console.log('OK kernel_error_flow');

