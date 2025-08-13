#!/usr/bin/env node

/**
 * Debug Together AI tool calling requirements
 */

import Together from 'together-ai';
import chalk from 'chalk';

async function testTogetherToolsSimple() {
  console.log(chalk.bold.cyan('🔍 Testing Together AI Tool Requirements'));
  console.log(chalk.gray('═'.repeat(50)));
  
  const together = new Together({ 
    apiKey: process.env.TOGETHER_API_KEY,
    timeout: 30000 
  });
  
  const messages = [
    { role: 'user', content: 'Hello, store my name as John' }
  ];
  
  // Test 1: Very simple tool
  console.log(chalk.blue('🧪 Test 1: Simple tool without enum...'));
  const simpleTools = [
    {
      type: 'function',
      function: {
        name: 'store_info',
        description: 'Store information',
        parameters: {
          type: 'object',
          properties: {
            info: { type: 'string', description: 'Information to store' }
          },
          required: ['info']
        }
      }
    }
  ];
  
  try {
    const response = await together.chat.completions.create({
      messages: messages,
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_tokens: 500,
      tools: simpleTools,
      tool_choice: 'auto'
    });
    
    console.log(chalk.green('✅ Simple tool works!'));
    if (response.choices[0].message.tool_calls) {
      response.choices[0].message.tool_calls.forEach(call => {
        console.log(chalk.gray(`  ${call.function.name}: ${call.function.arguments}`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Simple tool failed:'));
    console.error(chalk.red(`${error.message}`));
  }
  
  // Test 2: Tool with enum (like core_memory_append)
  console.log(chalk.blue('\n🧪 Test 2: Tool with enum...'));
  const enumTools = [
    {
      type: 'function',
      function: {
        name: 'store_memory',
        description: 'Store in memory',
        parameters: {
          type: 'object',
          properties: {
            memory_type: { 
              type: 'string', 
              enum: ['facts', 'preferences'],
              description: 'Type of memory'
            },
            content: { type: 'string', description: 'Content to store' }
          },
          required: ['memory_type', 'content']
        }
      }
    }
  ];
  
  try {
    const response = await together.chat.completions.create({
      messages: messages,
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_tokens: 500,
      tools: enumTools,
      tool_choice: 'auto'
    });
    
    console.log(chalk.green('✅ Enum tool works!'));
    if (response.choices[0].message.tool_calls) {
      response.choices[0].message.tool_calls.forEach(call => {
        console.log(chalk.gray(`  ${call.function.name}: ${call.function.arguments}`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Enum tool failed:'));
    console.error(chalk.red(`${error.message}`));
  }
  
  // Test 3: No tools at all
  console.log(chalk.blue('\n🧪 Test 3: No tools...'));
  try {
    const response = await together.chat.completions.create({
      messages: messages,
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_tokens: 500
      // No tools
    });
    
    console.log(chalk.green('✅ No tools works!'));
    console.log(chalk.cyan(`Response: ${response.choices[0].message.content}`));
    
  } catch (error) {
    console.error(chalk.red('❌ No tools failed:'));
    console.error(chalk.red(`${error.message}`));
  }
}

// Run test
await testTogetherToolsSimple();