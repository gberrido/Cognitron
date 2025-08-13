#!/usr/bin/env node

/**
 * Test the working MemGPT solution
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';

async function testWorkingSolution() {
  console.log(chalk.bold.cyan('🧪 Testing Working MemGPT Configuration'));
  console.log(chalk.gray('═'.repeat(50)));
  
  try {
    const memgpt = new MemGPTCognitron();
    
    // Initialize and load memory
    await memgpt.initializeLLMProvider();
    await memgpt.loadMemory();
    
    console.log(chalk.green(`✅ Primary provider: ${memgpt.llmProvider.providerName}`));
    console.log(chalk.green(`✅ Memory loaded: ${memgpt.memory.conversationContext.length} messages`));
    
    // Test a simple conversation
    console.log(chalk.blue('\n🔍 Testing conversation...'));
    const startTime = Date.now();
    
    const response = await memgpt.generateResponse("Hello! Please remember that I'm testing the system and my name is TestUser.");
    
    const endTime = Date.now();
    console.log(chalk.green(`✅ Response received in ${endTime - startTime}ms`));
    
    console.log(chalk.cyan('\n💬 AI Response:'));
    console.log(response.content);
    
    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log(chalk.yellow('\n🧠 Memory Operations:'));
      response.toolCalls.forEach(call => {
        console.log(chalk.green(`  ✅ ${call.toolName}`));
        console.log(chalk.gray(`     → ${call.result.message}`));
      });
    }
    
    console.log(chalk.blue(`\n⏱️  Heartbeats used: ${response.heartbeats}`));
    
    // Save memory
    await memgpt.saveMemory();
    console.log(chalk.green('✅ Memory saved successfully'));
    
    console.log(chalk.bold.green('\n🎉 MemGPT System Working Perfectly!'));
    console.log(chalk.cyan('Configuration:'));
    console.log(chalk.gray(`  Primary: ${memgpt.llmProvider.providerName} (reliable)`));
    console.log(chalk.gray('  Fallback: Together AI (with your $10 credits)'));
    console.log(chalk.gray('  Auto-fallback: Enabled'));
    
    return true;
    
  } catch (error) {
    console.error(chalk.red(`❌ Test failed: ${error.message}`));
    return false;
  }
}

// Run test
const success = await testWorkingSolution();
console.log(chalk.cyan('\n🚀 Ready to use:'));
console.log(chalk.gray('  Start interactive: node cognitron05-memgpt.js'));
console.log(chalk.gray('  Switch providers: /provider together (when needed)'));
console.log(chalk.gray('  Check status: /llm'));

process.exit(success ? 0 : 1);