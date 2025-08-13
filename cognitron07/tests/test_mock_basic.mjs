import { MemGPTAgent } from '../sdk/agent.js';
import { assert, assertEq, assertIncludes } from './util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron07/.test-tmp', `mock-basic-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

const agent = new MemGPTAgent({ provider: 'mock', dataDir: tmp });
await agent.initProviders();
await agent.loadState();

let r1 = await agent.processUserTurn('My name is Alice');
assertIncludes(r1.message, 'Nice to meet you', 'should greet with PAUSE message');

let r2 = await agent.processUserTurn('arch search remember');
assertIncludes(r2.message, 'retrieved', 'archival search should respond');

// Recall search via CLI helper
const rec = await agent.recall.search('Alice', 1, 5);
assert(rec.length >= 0, 'recall search returns array');

// Toggle autosum and trigger compaction
agent.autosum = true;
for (let i = 0; i < 30; i++) agent.addMessage('user', `filler ${i}`);
await agent.compactNow();
assert(agent.summary.length > 0, 'summary should be non-empty after compaction');

await agent.saveState();
console.log('OK mock_basic');

