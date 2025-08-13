import { MemGPTAgent } from '../sdk/agent.js';
import { FakeToolProvider } from './fake-provider.js';
import { assert, assertIncludes } from './util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron07/.test-tmp', `autosum-mock-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

// Provider will be used by summarizeSegment via agent.complete()
const script = [
  { assistantContent: 'Summary: User greeted and discussed pizza.' }
];

const agent = new MemGPTAgent({ provider: 'mock', dataDir: tmp });
agent.provider = new FakeToolProvider(script);
agent.supportsTools = true;
agent.autosum = true;
await agent.session.ensure();
await agent.recall.ensure();
await agent.archival.ensure();
await agent.loadState();

// Seed conversation and force compaction
agent.addMessage('user', 'Hello!');
agent.addMessage('assistant', 'Hi there!');
agent.addMessage('user', 'I love pizza.');
await agent.compactNow();

assertIncludes(agent.summary, 'Summary:', 'summary should be produced via provider');

console.log('OK autosum_mock');
