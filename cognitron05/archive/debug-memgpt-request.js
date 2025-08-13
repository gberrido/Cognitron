#!/usr/bin/env node

/**
 * Debug the exact request MemGPT makes to Together AI
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';

async function debugMemGPTRequest() {
  console.log(chalk.bold.cyan('🔍 Debugging MemGPT Request to Together AI'));
  console.log(chalk.gray('═'.repeat(50)));
  
  try {
    const memgpt = new MemGPTCognitron();
    
    // Initialize with Together AI
    await memgpt.initializeLLMProvider();
    await memgpt.loadMemory();
    
    console.log(chalk.green(`✅ Provider: ${memgpt.llmProvider.providerName}`));
    
    // Get the tools that MemGPT uses (from the internal tools object)
    const toolDefinitions = Object.values(memgpt.tools);
    console.log(chalk.blue(`🔧 Available tools: ${toolDefinitions.length}`));
    toolDefinitions.forEach(tool => {
      console.log(chalk.gray(`  - ${tool.function.name}`));
    });
    
    // Build a typical MemGPT request (using internal method)
    const messages = memgpt.buildMessages();
    console.log(chalk.blue(`💬 Message count: ${messages.length}`));
    
    console.log(chalk.blue('\n🧪 Making direct API call...'));
    
    // Try the exact same call that MemGPT would make
    const response = await memgpt.llmProvider.createChatCompletion({
      messages: messages,
      model: memgpt.llmConfig.model,
      temperature: memgpt.llmConfig.temperature,
      max_tokens: memgpt.llmConfig.maxTokens,
      tools: toolDefinitions,
      tool_choice: 'auto'
    });
    
    console.log(chalk.green('✅ Direct API call successful!'));
    
    if (response.choices && response.choices[0]) {
      const choice = response.choices[0];
      console.log(chalk.cyan(`Content: ${choice.message.content || 'No content'}`));
      
      if (choice.message.tool_calls) {
        console.log(chalk.yellow(`Tool calls: ${choice.message.tool_calls.length}`));
      }
    }
    
    return true;
    
  } catch (error) {
    console.error(chalk.red('❌ MemGPT request failed:'));
    console.error(chalk.red(`Error: ${error.message}`));
    
    if (error.response) {
      console.error(chalk.red(`HTTP Status: ${error.response.status}`));
      console.error(chalk.red(`Response: ${JSON.stringify(error.response.data, null, 2)}`));
    }
    
    if (error.cause) {
      console.error(chalk.red(`Cause: ${error.cause}`));
    }
    
    // Check if it's a network/connection issue
    if (error.code) {
      console.error(chalk.red(`Error Code: ${error.code}`));
    }
    
    console.error(chalk.red('Full error:'));
    console.error(error);
    
    return false;
  }
}

// Run debug
const success = await debugMemGPTRequest();
process.exit(success ? 0 : 1);