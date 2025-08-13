import { runTurn } from '../../core/runTurn.js';
import { assert, assertIncludes } from '../util/assert.js';

class ScriptProvider {
  constructor(script) { this.script = script; this.i = 0; }
  async complete() { return this.script[this.i++] || { choices: [{ message: { content: 'OK' } }] }; }
}

const tools = {
  core_memory_append: async ({ key, value }) => ({ success: true, message: `stored ${key}=${value}` }),
  archival_memory_insert: async ({ title, content }) => ({ success: true, message: `doc saved: ${title}` }),
  pause_heartbeats: async ({ message }) => ({ success: true, message })
};

const toolDefs = [
  { type: 'function', function: { name: 'core_memory_append', parameters: { type: 'object', properties: { key: {type:'string'}, value: {type:'string'} }, required:['key','value'] } } },
  { type: 'function', function: { name: 'archival_memory_insert', parameters: { type: 'object', properties: { title: {type:'string'}, content: {type:'string'} }, required:['title','content'] } } },
  { type: 'function', function: { name: 'pause_heartbeats', parameters: { type: 'object', properties: { message: {type:'string'} }, required: ['message'] } } }
];

const script = [
  { choices: [{ message: { tool_calls: [
    { id:'a', type:'function', function:{ name: 'core_memory_append', arguments: JSON.stringify({ key:'k', value:'v' }) } },
    { id:'b', type:'function', function:{ name: 'archival_memory_insert', arguments: JSON.stringify({ title:'T', content:'C' }) } },
    { id:'c', type:'function', function:{ name: 'pause_heartbeats', arguments: JSON.stringify({ message:'Done.' }) } }
  ] } }] }
];

const messages = [{ role: 'system', content: 'You are minimal.' }, { role: 'user', content: 'do work' }];
const provider = new ScriptProvider(script);
const res = await runTurn({ messages, provider, tools, toolDefinitions: toolDefs, maxHeartbeats: 3 });

assertIncludes(res.finalMessage, 'Done', 'should end with pause message');
const countTool = res.messages.filter(m => m.role === 'tool').length;
assert(countTool >= 2, 'should include multiple tool-role messages');

console.log('OK kernel_multi_tool');

