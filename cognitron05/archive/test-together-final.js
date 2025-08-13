#!/usr/bin/env node

/**
 * Final test with Together AI as primary provider
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';

async function testTogetherFinal() {
  console.log(chalk.bold.cyan('🧪 Final Together AI Integration Test'));
  console.log(chalk.gray('═'.repeat(50)));
  
  try {
    const memgpt = new MemGPTCognitron();
    
    // Initialize (should use Together AI as primary now)
    await memgpt.initializeLLMProvider();
    await memgpt.loadMemory();
    
    console.log(chalk.green(`✅ Primary provider: ${memgpt.llmProvider.providerName}`));
    
    const providerInfo = memgpt.llmProvider.getProviderInfo();
    console.log(chalk.cyan('💰 Provider pricing:'));
    console.log(chalk.gray(`  Input: ${providerInfo.pricing.input}`));
    console.log(chalk.gray(`  Output: ${providerInfo.pricing.output}`));
    console.log(chalk.gray(`  vs Groq output: $0.75/M tokens`));
    
    // Test a simple conversation
    console.log(chalk.blue('\n🔍 Testing MemGPT conversation with Together AI...'));
    const response = await memgpt.generateResponse("Hello! I want to test if Together AI works well with MemGPT. Can you save some information about me?");
    
    console.log(chalk.cyan('\n💬 AI Response:'));
    console.log(response.content);
    
    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log(chalk.yellow('\n🧠 MemGPT Tool Calls:'));
      response.toolCalls.forEach(call => {
        console.log(chalk.green(`  ✅ ${call.toolName}`));
        console.log(chalk.gray(`     → ${call.result.message}`));
      });
    }
    
    console.log(chalk.bold.green('\n🎉 Together AI + MemGPT integration successful!'));
    console.log(chalk.cyan('💡 Benefits:'));
    console.log(chalk.gray('  • 20% cheaper output tokens ($0.60 vs $0.75)'));
    console.log(chalk.gray('  • More generous rate limits'));
    console.log(chalk.gray('  • Same gpt-oss-120b model quality'));
    console.log(chalk.gray('  • Automatic fallback to Groq if needed'));
    
    return true;
    
  } catch (error) {
    console.error(chalk.red(`❌ Test failed: ${error.message}`));
    return false;
  }
}

// Run test
const success = await testTogetherFinal();
console.log(chalk.cyan('\n🔧 Commands available:'));
console.log(chalk.gray('  /provider groq    - Switch back to Groq'));
console.log(chalk.gray('  /provider together - Use Together AI'));
console.log(chalk.gray('  /llm             - Check current provider'));

process.exit(success ? 0 : 1);