import { MemGPTAgent } from '../sdk/agent.js';
import { assert } from './util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron07/.test-tmp', `budgets-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

const agent = new MemGPTAgent({ provider: 'mock', dataDir: tmp, budgets: { system: 500, summary: 200, messages: 200 } });
agent.provider = { ok: true, async complete(){ return { choices:[{message:{content:'ok'}}] }; }, async stream(){ return []; } };
agent.supportsTools = false; // use text path; simpler
await agent.session.ensure();
await agent.recall.ensure();
await agent.archival.ensure();
await agent.loadState();

// Add many messages to exceed the messages budget
for (let i = 0; i < 30; i++) agent.addMessage('user', `msg ${i} ${'x'.repeat(20)}`);

const beforeLen = agent.conversation.length;
await agent.processUserTurn('final input to enforce budgets');
const afterLen = agent.conversation.length;

assert(afterLen < beforeLen, 'conversation trimmed to budget');
assert(agent.summary.length > 0, 'evicted messages summarized');

console.log('OK token_budgets');
