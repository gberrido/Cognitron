import { MemGPTAgent } from './sdk/agent.js';
const agent = new MemGPTAgent({ provider: 'together', dataDir: './cognitron-memgpt-data' });
await agent.initProviders();
await agent.loadState();
const r1 = await agent.processUserTurn('My name is Bob');
console.log('Turn1:', r1);
await agent.saveState();
