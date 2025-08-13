#!/usr/bin/env node

/**
 * Demo script for MemGPT with your API keys
 */

import { MemGPT } from './memgpt-minimal.js';

// Set your API keys (from the requirements document)
process.env.TOGETHER_API_KEY = "YOUR_TOGETHER_API_KEY_HERE";
process.env.GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";

async function runDemo() {
  console.log('🚀 Starting MemGPT Demo with GPT-OSS-120B...\n');

  // Initialize MemGPT with Groq provider (recommended)
  const memgpt = new MemGPT({
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    temperature: 0.7,
    agentId: 'demo-agent'
  });

  try {
    await memgpt.initialize();
    
    console.log('✅ MemGPT initialized successfully!');
    console.log('🔑 Using your provided API keys');
    console.log('🤖 Model: GPT-OSS-120B via Groq');
    console.log('📝 Ready for conversation with persistent memory\n');
    console.log('Starting interactive chat...\n');

    // Start the CLI interface
    await memgpt.startCLI();

  } catch (error) {
    console.error('❌ Error starting MemGPT:', error.message);
    
    if (error.message.includes('API')) {
      console.log('\n💡 Tip: Make sure your API keys are valid and have sufficient credits');
      console.log('   - Groq: https://console.groq.com/');
      console.log('   - Together AI: https://api.together.ai/');
    }
    
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runDemo().catch(console.error);
}

export { runDemo };