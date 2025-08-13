#!/usr/bin/env node

/**
 * Debug provider switching functionality
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';

async function testProviderSwitch() {
  console.log(chalk.bold.cyan('🧪 Debug Provider Switching'));
  console.log(chalk.gray('═'.repeat(40)));
  
  try {
    const memgpt = new MemGPTCognitron();
    memgpt.config.dataDir = './test-provider-data';
    
    // Initialize
    await memgpt.initializeLLMProvider();
    console.log(chalk.green(`✅ Initial provider: ${memgpt.llmProvider.providerName}`));
    
    // Test command handler directly
    console.log(chalk.blue('\n🔍 Testing /provider together command...'));
    const result = await memgpt.handleCommand('/provider together');
    console.log(chalk.cyan(`Command result: ${result}`));
    
    console.log(chalk.green(`✅ Final provider: ${memgpt.llmProvider.providerName}`));
    
    return true;
    
  } catch (error) {
    console.error(chalk.red(`❌ Test failed: ${error.message}`));
    console.error(error.stack);
    return false;
  }
}

// Run test
const success = await testProviderSwitch();
process.exit(success ? 0 : 1);