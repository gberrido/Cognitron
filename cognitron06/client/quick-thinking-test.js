#!/usr/bin/env node

/**
 * Quick Thinking Test
 * Simple test to check what the current server returns
 */

import { CognitronSDK } from './src/index.js';
import chalk from 'chalk';

async function quickTest() {
  console.log(chalk.cyan('🔍 Quick Thinking Model Test\n'));

  const sdk = new CognitronSDK({
    serverUrl: 'http://localhost:8000',
    debug: false
  });

  try {
    await sdk.initialize();
    await sdk.authenticate();
    console.log(chalk.green('✅ Connected\n'));

    // Test prompt that should trigger reasoning
    const prompt = "Think step by step: What is 25% of 80?";
    
    console.log(chalk.yellow(`Prompt: "${prompt}"`));
    console.log(chalk.dim('Sending to server...\n'));

    const response = await sdk.sendMessage(prompt);
    
    console.log(chalk.cyan('📋 Raw Response Analysis:'));
    console.log('─'.repeat(40));
    
    // Show all response fields
    Object.keys(response).forEach(key => {
      const value = response[key];
      const type = typeof value;
      const length = Array.isArray(value) ? value.length : 
                   typeof value === 'string' ? value.length : 
                   typeof value === 'object' ? Object.keys(value || {}).length : 'N/A';
      
      console.log(`${chalk.blue(key.padEnd(15))}: ${type} (${length})`);
      
      if (key === 'thinking' && value) {
        console.log(chalk.gray(`   Preview: ${value.substring(0, 100)}...`));
      } else if (key === 'content' && value) {
        console.log(chalk.white(`   Preview: ${value.substring(0, 100)}...`));
      } else if (key === 'tool_calls' && value?.length > 0) {
        value.forEach((tool, i) => {
          console.log(chalk.blue(`   Tool ${i + 1}: ${tool.function?.name || tool.name || 'Unknown'}`));
        });
      }
    });

    console.log('\n' + chalk.cyan('🔍 Thinking Field Check:'));
    if (response.thinking) {
      console.log(chalk.green('✅ Thinking field present!'));
      console.log(chalk.white('Full thinking content:'));
      console.log(chalk.gray(response.thinking));
    } else {
      console.log(chalk.red('❌ No thinking field found'));
      console.log(chalk.yellow('Server may need to be updated to include thinking content'));
    }

    console.log('\n' + chalk.cyan('💬 Final Response:'));
    console.log(chalk.white(response.content || 'No content'));

    await sdk.close();

  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    if (error.response) {
      console.log(chalk.yellow('Server response:'), error.response.data);
    }
  }
}

quickTest();