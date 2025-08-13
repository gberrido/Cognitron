import { RefAgent } from '../../ref/agent.js';
import { assert } from '../util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron08/.test-tmp', `budgets-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

const agent = new RefAgent({ provider: 'mock', dataDir: tmp });
await agent.initProviders();
await agent.loadState();

for (let i = 0; i < 40; i++) agent.addMessage('user', `msg ${i} ${'x'.repeat(20)}`);

// Force eviction by setting aggressive threshold
agent.evictionThreshold = 0.01;
await agent.processUserTurn('trigger budgets');

assert(agent.summary.length > 0, 'summary should be produced after compaction');
console.log('OK ref_token_budgets');
