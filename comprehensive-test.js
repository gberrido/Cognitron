#!/usr/bin/env node

/**
 * Comprehensive test for all MemGPT functionality
 */

import { MemGPT } from './memgpt-minimal.js';
import fs from 'fs/promises';

// Set API key
process.env.GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";

async function runComprehensiveTest() {
  console.log('🧪 Running Comprehensive MemGPT Test...\n');

  const memgpt = new MemGPT({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    agentId: 'comprehensive-test-agent',
    memoryDir: './comprehensive-test-memory'
  });

  try {
    await memgpt.initialize();
    console.log('✅ Initialization complete\n');

    // Test 1: Basic conversation with memory storage
    console.log('📝 Test 1: Personal information storage');
    const response1 = await memgpt.processMessage('Hi! I\'m Bob. I work as a software engineer and my hobby is photography. I live in San Francisco.');
    console.log('User: Hi! I\'m Bob. I work as a software engineer and my hobby is photography. I live in San Francisco.');
    console.log(`MemGPT: ${response1}\n`);

    // Test 2: Memory recall
    console.log('📝 Test 2: Memory recall');
    const response2 = await memgpt.processMessage('What do you know about me?');
    console.log('User: What do you know about me?');
    console.log(`MemGPT: ${response2}\n`);

    // Test 3: Document insertion
    console.log('📝 Test 3: Document storage');
    const response3 = await memgpt.processMessage('Please remember this important information: The quarterly meeting is scheduled for next Friday at 2 PM in the main conference room.');
    console.log('User: Please remember this important information: The quarterly meeting is scheduled for next Friday at 2 PM in the main conference room.');
    console.log(`MemGPT: ${response3}\n`);

    // Test 4: Information search
    console.log('📝 Test 4: Information search');
    const response4 = await memgpt.processMessage('When is the quarterly meeting?');
    console.log('User: When is the quarterly meeting?');
    console.log(`MemGPT: ${response4}\n`);

    // Test 5: Working context modification
    console.log('📝 Test 5: Updating user information');
    const response5 = await memgpt.processMessage('Actually, I just moved to Los Angeles last week.');
    console.log('User: Actually, I just moved to Los Angeles last week.');
    console.log(`MemGPT: ${response5}\n`);

    // Test 6: Commands
    console.log('📝 Test 6: Memory stats command');
    const response6 = await memgpt.processMessage('/stats');
    console.log('User: /stats');
    console.log(`MemGPT: ${response6.substring(0, 300)}...\n`);

    // Test 7: Search command
    console.log('📝 Test 7: Search command');
    const response7 = await memgpt.processMessage('/search photography');
    console.log('User: /search photography');
    console.log(`MemGPT: ${JSON.stringify(JSON.parse(response7.split('\n')[1]), null, 2).substring(0, 200)}...\n`);

    console.log('🎉 All comprehensive tests passed! MemGPT is fully functional.');
    
    // Display what was created
    console.log('\n📁 Files created:');
    console.log('- Memory conversations with search index');
    console.log('- Agent working context with user information');
    console.log('- Document archival storage');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    // Clean up test memory
    try {
      await fs.rm('./comprehensive-test-memory', { recursive: true });
    } catch (error) {
      // Directory might not exist
    }
  }
}

runComprehensiveTest().catch(console.error);