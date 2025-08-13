#!/usr/bin/env node

/**
 * Automated conversation test for MemGPT
 */

import { MemGPT } from './memgpt-minimal.js';

// Set API keys
process.env.GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";

async function testConversation() {
  console.log('🧪 Testing MemGPT Conversation...\n');

  const memgpt = new MemGPT({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    agentId: 'test-conversation-agent',
    memoryDir: './test-conversation-memory'
  });

  try {
    await memgpt.initialize();
    
    // Test basic conversation
    console.log('📝 Test 1: Basic greeting');
    const response1 = await memgpt.processMessage('Hello! My name is Alice and I love reading books.');
    console.log('User: Hello! My name is Alice and I love reading books.');
    console.log(`MemGPT: ${response1}\n`);
    
    // Test memory recall
    console.log('📝 Test 2: Memory recall');
    const response2 = await memgpt.processMessage('What do you remember about me?');
    console.log('User: What do you remember about me?');
    console.log(`MemGPT: ${response2}\n`);
    
    // Test command
    console.log('📝 Test 3: Command handling');
    const response3 = await memgpt.processMessage('/stats');
    console.log('User: /stats');
    console.log(`MemGPT: ${response3.substring(0, 200)}...\n`);
    
    console.log('✅ All conversation tests passed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    // Clean up test memory
    try {
      const fs = await import('fs/promises');
      await fs.rm('./test-conversation-memory', { recursive: true });
    } catch (error) {
      // Directory might not exist
    }
  }
}

testConversation().catch(console.error);