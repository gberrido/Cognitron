import { MemGPTAgent } from '../sdk/agent.js';
import { assert } from './util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron07/.test-tmp', `persist-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

let a = new MemGPTAgent({ provider: 'mock', dataDir: tmp });
await a.initProviders();
await a.loadState();
await a.processUserTurn('My name is Carol');
await a.saveState();
const len1 = a.conversation.length;

let b = new MemGPTAgent({ provider: 'mock', dataDir: tmp });
await b.initProviders();
await b.loadState();
const len2 = b.conversation.length;
assert(len2 >= len1, 'conversation should persist');

console.log('OK state_persistence');

