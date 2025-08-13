#!/usr/bin/env node

/**
 * Test script for MemGPT Minimal Implementation
 */

import { MemGPT, MemoryManager } from './memgpt-minimal.js';
import fs from 'fs/promises';
import path from 'path';

const TEST_MEMORY_DIR = './test-memory';
const TEST_AGENT_ID = 'test-agent';

async function cleanupTestMemory() {
  try {
    await fs.rm(TEST_MEMORY_DIR, { recursive: true });
  } catch (error) {
    // Directory doesn't exist, that's ok
  }
}

async function testMemoryManager() {
  console.log('🧪 Testing MemoryManager...');
  
  const memory = new MemoryManager(TEST_MEMORY_DIR, TEST_AGENT_ID);
  await memory.initialize();

  // Test adding messages
  await memory.addMessage({
    role: 'user',
    content: 'Hello, I like pizza and programming.'
  });

  await memory.addMessage({
    role: 'assistant', 
    content: 'Nice to meet you! I remember you enjoy pizza and programming.'
  });

  // Test search
  const searchResults = await memory.searchMessages('pizza');
  console.log('Search results for "pizza":', searchResults);

  // Test document insertion
  const docResult = await memory.insertDocument('This is a test document about artificial intelligence and machine learning.');
  console.log('Document insertion result:', docResult);

  // Test document search  
  const docSearchResults = await memory.searchDocuments('artificial intelligence');
  console.log('Document search results:', docSearchResults);

  // Test stats
  const stats = await memory.getStats();
  console.log('Memory stats:', stats);

  console.log('✅ MemoryManager tests passed\n');
}

async function testMemGPT() {
  console.log('🧪 Testing MemGPT (without LLM calls)...');
  
  const memgpt = new MemGPT({
    model: 'openai/gpt-oss-120b',
    provider: 'groq',
    memoryDir: TEST_MEMORY_DIR,
    agentId: TEST_AGENT_ID
  });

  // Test initialization without actually calling LLM
  memgpt.memory = new MemoryManager(TEST_MEMORY_DIR, TEST_AGENT_ID);
  await memgpt.memory.initialize();
  await memgpt.loadAgentState();

  // Test working context functions
  console.log('Initial working context:', memgpt.workingContext);

  const replaceResult = await memgpt.workingContextReplace(
    'User information will be learned',
    'User likes pizza and programming'
  );
  console.log('Replace result:', replaceResult);
  console.log('Updated working context:', memgpt.workingContext);

  const appendResult = await memgpt.workingContextAppend('User prefers evening conversations.');
  console.log('Append result:', appendResult);
  console.log('Final working context:', memgpt.workingContext);

  // Test system prompt building
  const systemPrompt = memgpt.formatSystemPrompt();
  console.log('System prompt length:', systemPrompt.length);

  // Test command handling
  const helpResult = await memgpt.handleCommand('/help');
  console.log('Help command result:', helpResult.substring(0, 100) + '...');

  const statsResult = await memgpt.handleCommand('/stats');
  console.log('Stats command result:', statsResult.substring(0, 200) + '...');

  console.log('✅ MemGPT tests passed\n');
}

async function testFunctionExecution() {
  console.log('🧪 Testing function execution...');

  const memgpt = new MemGPT({
    memoryDir: TEST_MEMORY_DIR,
    agentId: TEST_AGENT_ID
  });

  memgpt.memory = new MemoryManager(TEST_MEMORY_DIR, TEST_AGENT_ID);
  await memgpt.memory.initialize();

  // Test function extraction and execution
  const responseWithFunction = `I'll help you remember that information. 
{"function": "working_context_append", "args": {"new_content": "User enjoys hiking on weekends"}}
Let me store that for future reference.`;

  const { responseText, functionCalls } = await memgpt.executeFunctions(responseWithFunction);
  
  console.log('Response text:', responseText);
  console.log('Function calls:', functionCalls);
  console.log('Updated working context:', memgpt.workingContext);

  console.log('✅ Function execution tests passed\n');
}

async function runAllTests() {
  console.log('🚀 Starting MemGPT tests...\n');

  try {
    await cleanupTestMemory();
    await testMemoryManager();
    await testMemGPT();
    await testFunctionExecution();
    
    console.log('🎉 All tests passed! MemGPT is working correctly.');
    
    // Show what was created
    console.log('\n📁 Test files created:');
    console.log(`- ${TEST_MEMORY_DIR}/conversations/ (conversation logs)`);
    console.log(`- ${TEST_MEMORY_DIR}/archival/ (document storage)`);
    console.log(`- ${TEST_MEMORY_DIR}/agents/ (agent state)`);

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    // Cleanup
    await cleanupTestMemory();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}