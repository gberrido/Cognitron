import { MemGPTAgent } from './sdk/agent.js';

const agent = new MemGPTAgent({ provider: 'groq', dataDir: './cognitron-memgpt-data' });
await agent.initProviders();
await agent.loadState();
const r1 = await agent.processUserTurn('My name is Alice');
console.log('Turn1:', r1);
const r2 = await agent.processUserTurn('What did I just tell you?');
console.log('Turn2:', r2);
await agent.saveState();
