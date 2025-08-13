#!/usr/bin/env node

/**
 * Debug the exact API call that MemGPT makes
 */

import Together from 'together-ai';
import { Groq } from 'groq-sdk';
import chalk from 'chalk';

// Sample MemGPT system message and tools
const systemMessage = {
  role: 'system',
  content: `You are an AI assistant with persistent memory capabilities. 

Core Memory (Facts about the user and key information):
- User has not shared personal details yet

Instructions:
- Use your memory tools to store important information
- Use pause_heartbeats when ready to respond to the user
- Be helpful and remember important details about the user`
};

const memgptTools = [
  {
    type: 'function',
    function: {
      name: 'core_memory_append',
      description: 'Append to core memory',
      parameters: {
        type: 'object',
        properties: {
          memory_type: { type: 'string', enum: ['facts', 'preferences'] },
          content: { type: 'string' }
        },
        required: ['memory_type', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'pause_heartbeats',
      description: 'Pause thinking and respond to user',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Response to user' }
        },
        required: ['message']
      }
    }
  }
];

async function testExactMemGPTCall() {
  console.log(chalk.bold.cyan('🔍 Testing Exact MemGPT API Call'));
  console.log(chalk.gray('═'.repeat(50)));
  
  const messages = [
    systemMessage,
    { role: 'user', content: 'Hello' }
  ];
  
  // Test Together AI
  console.log(chalk.blue('🧪 Testing Together AI with MemGPT structure...'));
  try {
    const together = new Together({ 
      apiKey: process.env.TOGETHER_API_KEY,
      timeout: 30000 
    });
    
    const response = await together.chat.completions.create({
      messages: messages,
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_tokens: 2000,
      tools: memgptTools,
      tool_choice: 'auto'
    });
    
    console.log(chalk.green('✅ Together AI with tools successful!'));
    console.log(chalk.cyan(`Response: ${response.choices[0].message.content || 'No content'}`));
    
    if (response.choices[0].message.tool_calls) {
      console.log(chalk.yellow('Tool calls:'));
      response.choices[0].message.tool_calls.forEach(call => {
        console.log(chalk.gray(`  ${call.function.name}: ${call.function.arguments}`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Together AI error:'));
    console.error(chalk.red(`Message: ${error.message}`));
    if (error.response) {
      console.error(chalk.red(`Status: ${error.response.status}`));
      console.error(chalk.red(`Data: ${JSON.stringify(error.response.data, null, 2)}`));
    }
  }
  
  // Test Groq
  console.log(chalk.blue('\n🧪 Testing Groq with MemGPT structure...'));
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    
    const response = await groq.chat.completions.create({
      messages: messages,
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_tokens: 2000,
      tools: memgptTools,
      tool_choice: 'auto'
    });
    
    console.log(chalk.green('✅ Groq with tools successful!'));
    console.log(chalk.cyan(`Response: ${response.choices[0].message.content || 'No content'}`));
    
    if (response.choices[0].message.tool_calls) {
      console.log(chalk.yellow('Tool calls:'));
      response.choices[0].message.tool_calls.forEach(call => {
        console.log(chalk.gray(`  ${call.function.name}: ${call.function.arguments}`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Groq error:'));
    console.error(chalk.red(`Message: ${error.message}`));
    if (error.response) {
      console.error(chalk.red(`Status: ${error.response.status}`));
      console.error(chalk.red(`Data: ${JSON.stringify(error.response.data, null, 2)}`));
    }
  }
}

// Run test
await testExactMemGPTCall();