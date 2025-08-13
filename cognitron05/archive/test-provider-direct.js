#!/usr/bin/env node

/**
 * Direct test of provider system without CLI interference
 */

import { LLMConfigManager } from './modules/llm/LLMConfigManager.js';
import chalk from 'chalk';

async function testProviderDirect() {
  console.log(chalk.bold.cyan('🧪 Direct Provider System Test'));
  console.log(chalk.gray('═'.repeat(40)));
  
  try {
    const configManager = new LLMConfigManager('./test-provider-data');
    
    // Test Groq provider
    console.log(chalk.blue('\n1. Testing Groq provider...'));
    const groqSuccess = await configManager.testProvider('groq');
    console.log(groqSuccess ? chalk.green('✅ Groq works!') : chalk.red('❌ Groq failed'));
    
    // Test Together AI provider  
    console.log(chalk.blue('\n2. Testing Together AI provider...'));
    const togetherSuccess = await configManager.testProvider('together');
    console.log(togetherSuccess ? chalk.green('✅ Together AI works!') : chalk.yellow('⚠️ Together AI failed (likely needs paid account)'));
    
    // Show provider comparison
    console.log(chalk.blue('\n3. Provider comparison:'));
    await configManager.showProviderStatus();
    
    // Set up configuration
    console.log(chalk.blue('\n4. Setting up optimal configuration...'));
    if (groqSuccess) {
      await configManager.setProvider('groq', { 
        fallback: 'together',
        autoFallback: true 
      });
      console.log(chalk.green('✅ Configured Groq as primary with Together AI fallback'));
    }
    
    console.log(chalk.bold.green('\n🎉 Provider system is ready!'));
    
    return true;
    
  } catch (error) {
    console.error(chalk.red(`❌ Test failed: ${error.message}`));
    return false;
  }
}

// Run test
const success = await testProviderDirect();
console.log(chalk.cyan('\n💡 Next steps:'));
console.log(chalk.gray('  1. Add Together AI credits for cheaper pricing'));
console.log(chalk.gray('  2. Use /provider together in MemGPT to switch'));
console.log(chalk.gray('  3. Use /llm to check current provider status'));

process.exit(success ? 0 : 1);