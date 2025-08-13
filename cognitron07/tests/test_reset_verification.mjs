import { MemGPTAgent } from '../sdk/agent.js';
import { assert } from './util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron07/.test-tmp', `reset-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

const agent = new MemGPTAgent({ provider: 'mock', dataDir: tmp });
agent.provider = { ok: true, async complete(){ return { choices:[{message:{content:'ok'}}] }; }, async stream(){ return []; } };
await agent.loadState();

// Create some state
agent.addMessage('user', 'remember this');
await agent.saveState();
const id = await agent.archival.insert('Doc', 'Some content...');
assert(id, 'inserted archival');

// Verify files exist
const working = path.join(tmp, 'working-context.json');
const recall = path.join(tmp, 'recall-storage.jsonl');
const archBase = path.join(tmp, 'archival');
await fs.access(archBase);

// Reset all
await agent.resetAll();

// Verify archival base removed; working/recall/session may be gone
let archivalRemoved = false;
try { await fs.access(archBase); archivalRemoved = false; } catch { archivalRemoved = true; }
assert(archivalRemoved, 'archival directory removed');

console.log('OK reset_verification');

