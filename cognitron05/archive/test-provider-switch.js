#!/usr/bin/env node

/**
 * Test script for modular provider system
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';

async function testProviderSystem() {
  console.log(chalk.bold.cyan('🧪 Testing Modular Provider System'));
  console.log(chalk.gray('═'.repeat(50)));
  
  try {
    // Create MemGPT instance
    const memgpt = new MemGPTCognitron();
    memgpt.config.dataDir = './test-provider-data';
    
    // Initialize LLM provider
    await memgpt.initializeLLMProvider();
    console.log(chalk.green(`✅ Initialized: ${memgpt.llmProvider.providerName}`));
    
    // Load memory
    await memgpt.loadMemory();
    console.log(chalk.green(`✅ Memory system loaded`));
    
    // Test a simple interaction
    console.log(chalk.blue('\n🔍 Testing basic interaction...'));
    const result = await memgpt.generateResponse("Hello, my name is TestUser");
    
    console.log(chalk.cyan('\n💬 Response:'));
    console.log(result.content);
    
    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log(chalk.yellow('\n🧠 Tool calls made:'));
      result.toolCalls.forEach(call => {
        console.log(chalk.gray(`  ✅ ${call.toolName}: ${call.result.message}`));
      });
    }
    
    console.log(chalk.green('\n✅ Provider system test successful!'));
    console.log(chalk.cyan(`💰 Used provider: ${memgpt.llmProvider.providerName}`));
    
    const providerInfo = memgpt.llmProvider.getProviderInfo();
    console.log(chalk.gray(`📊 Pricing: ${providerInfo.pricing.input} input, ${providerInfo.pricing.output} output`));
    
    return true;
    
  } catch (error) {
    console.error(chalk.red(`❌ Test failed: ${error.message}`));
    console.error(error.stack);
    return false;
  }
}

// Run test
const success = await testProviderSystem();
process.exit(success ? 0 : 1);