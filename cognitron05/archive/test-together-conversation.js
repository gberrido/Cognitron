#!/usr/bin/env node

/**
 * Test actual conversation with Together AI
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';

async function testTogetherConversation() {
  console.log(chalk.bold.cyan('🧪 Testing Together AI Conversation'));
  console.log(chalk.gray('═'.repeat(50)));
  
  try {
    const memgpt = new MemGPTCognitron();
    memgpt.config.dataDir = './test-provider-data';
    
    // Initialize with Together AI
    await memgpt.initializeLLMProvider();
    await memgpt.loadMemory();
    
    console.log(chalk.green(`✅ Using provider: ${memgpt.llmProvider.providerName}`));
    
    // Switch to Together AI explicitly
    await memgpt.handleProviderSwitch('together');
    console.log(chalk.green(`✅ Switched to: ${memgpt.llmProvider.providerName}`));
    
    // Test conversation
    console.log(chalk.blue('\n🔍 Testing conversation with Together AI...'));
    const response = await memgpt.generateResponse("Hello! My name is TestUser and I'm testing the Together AI integration. Can you remember this?");
    
    console.log(chalk.cyan('\n💬 Response:'));
    console.log(response.content);
    
    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log(chalk.yellow('\n🧠 Memory Operations:'));
      response.toolCalls.forEach(call => {
        console.log(chalk.gray(`  ✅ ${call.toolName}: ${call.result.message}`));
      });
    }
    
    console.log(chalk.green('\n✅ Together AI conversation test successful!'));
    
    const providerInfo = memgpt.llmProvider.getProviderInfo();
    console.log(chalk.cyan(`💰 Cost savings: Together AI (${providerInfo.pricing.output}) vs Groq ($0.75/M output)`));
    
    return true;
    
  } catch (error) {
    console.error(chalk.red(`❌ Test failed: ${error.message}`));
    console.error(error.stack);
    return false;
  }
}

// Run test
const success = await testTogetherConversation();
process.exit(success ? 0 : 1);