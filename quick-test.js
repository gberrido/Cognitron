#!/usr/bin/env node

/**
 * Quick test for fixed MemGPT
 */

import { MemGPT } from './memgpt-minimal.js';

// Set API key
process.env.GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";

async function quickTest() {
  console.log('🧪 Quick Test of Fixed MemGPT...\n');

  const memgpt = new MemGPT({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    agentId: 'quick-test-agent',
    memoryDir: './quick-test-memory'
  });

  try {
    await memgpt.initialize();
    
    console.log('📝 Test: Introducing myself');
    const response = await memgpt.processMessage('Hi! My name is Sarah and I work as a teacher. I love gardening.');
    console.log('User: Hi! My name is Sarah and I work as a teacher. I love gardening.');
    console.log(`MemGPT: ${response}\n`);
    
    console.log('📝 Test: Asking for memory recall');  
    const response2 = await memgpt.processMessage('What do you know about me?');
    console.log('User: What do you know about me?');
    console.log(`MemGPT: ${response2}\n`);

    console.log('✅ Quick test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    // Clean up
    try {
      const fs = await import('fs/promises');
      await fs.rm('./quick-test-memory', { recursive: true });
    } catch (error) {
      // Directory might not exist
    }
  }
}

quickTest().catch(console.error);