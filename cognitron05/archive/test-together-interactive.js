#!/usr/bin/env node

/**
 * Test Together AI without stdin piping issues
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';

async function testTogetherInteractive() {
  console.log(chalk.bold.cyan('🧪 Testing Together AI - No Stdin'));
  console.log(chalk.gray('═'.repeat(50)));
  
  try {
    const memgpt = new MemGPTCognitron();
    
    // Initialize
    await memgpt.initializeLLMProvider();
    await memgpt.loadMemory();
    
    console.log(chalk.green(`✅ Provider: ${memgpt.llmProvider.providerName}`));
    
    // Test conversation without stdin interference
    console.log(chalk.blue('\n🔍 Testing conversation...'));
    
    const startTime = Date.now();
    const response = await memgpt.generateResponse("Hello Together AI! Can you tell me your name and remember mine is TestUser?");
    const endTime = Date.now();
    
    console.log(chalk.green(`✅ Response received in ${endTime - startTime}ms`));
    console.log(chalk.cyan('\n💬 AI Response:'));
    console.log(response.content);
    
    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log(chalk.yellow('\n🧠 Tool Calls:'));
      response.toolCalls.forEach(call => {
        console.log(chalk.green(`  ✅ ${call.toolName}`));
        console.log(chalk.gray(`     ${call.result.message}`));
      });
    }
    
    if (response.usage) {
      console.log(chalk.blue('\n📊 Usage:'));
      console.log(chalk.gray(`  Input tokens: ${response.usage.prompt_tokens}`));
      console.log(chalk.gray(`  Output tokens: ${response.usage.completion_tokens}`));
      console.log(chalk.gray(`  Total tokens: ${response.usage.total_tokens}`));
    }
    
    // Save memory
    await memgpt.saveMemory();
    console.log(chalk.green('✅ Memory saved'));
    
    console.log(chalk.bold.green('\n🎉 Together AI conversation successful!'));
    
    return true;
    
  } catch (error) {
    console.error(chalk.red(`❌ Test failed: ${error.message}`));
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
    return false;
  }
}

// Run test
const success = await testTogetherInteractive();
process.exit(success ? 0 : 1);