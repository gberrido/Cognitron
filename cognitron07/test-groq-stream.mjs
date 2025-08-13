import { MemGPTAgent } from './sdk/agent.js';
const agent = new MemGPTAgent({ provider: 'groq', dataDir: './cognitron-memgpt-data' });
agent.streamEnabled = true;
await agent.initProviders();
await agent.loadState();
const r = await agent.processUserTurn('Give me one short sentence about MemGPT.');
console.log('canStream:', r.canStream);
if (r.canStream) {
  console.log('Streaming:');
  await agent.streamFinalResponse();
}
await agent.saveState();
