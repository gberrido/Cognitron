#!/usr/bin/env node

/**
 * Test exact MemGPT tools with Together AI
 */

import Together from 'together-ai';
import chalk from 'chalk';

const memgptTools = {
  core_memory_append: {
    type: 'function',
    function: {
      name: 'core_memory_append',
      description: 'Append to core memory. Use this to remember key facts about the user, preferences, or important information that should persist across conversations.',
      parameters: {
        type: 'object',
        properties: {
          key: { 
            type: 'string', 
            description: 'A concise key for this memory (e.g., "user_name", "favorite_food")' 
          },
          value: { 
            type: 'string', 
            description: 'The information to store' 
          }
        },
        required: ['key', 'value']
      }
    }
  },
  
  core_memory_replace: {
    type: 'function',
    function: {
      name: 'core_memory_replace',
      description: 'Replace existing core memory. Use when information has changed.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'The key to update' },
          new_value: { type: 'string', description: 'The new value' }
        },
        required: ['key', 'new_value']
      }
    }
  },

  pause_heartbeats: {
    type: 'function',
    function: {
      name: 'pause_heartbeats',
      description: 'Pause to allow user interaction. Use when you need user response.',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'Message to show user' }
        },
        required: ['message']
      }
    }
  }
};

async function testMemGPTToolsWithTogether() {
  console.log(chalk.bold.cyan('🔍 Testing MemGPT Tools with Together AI'));
  console.log(chalk.gray('═'.repeat(50)));
  
  const together = new Together({ 
    apiKey: process.env.TOGETHER_API_KEY,
    timeout: 30000 
  });
  
  const messages = [
    { role: 'user', content: 'Hello, my name is TestUser' }
  ];
  
  // Test each tool individually first
  for (const [toolName, toolDef] of Object.entries(memgptTools)) {
    console.log(chalk.blue(`🧪 Testing tool: ${toolName}...`));
    
    try {
      const response = await together.chat.completions.create({
        messages: messages,
        model: 'openai/gpt-oss-120b',
        temperature: 0.7,
        max_tokens: 500,
        tools: [toolDef],
        tool_choice: 'auto'
      });
      
      console.log(chalk.green(`✅ ${toolName} works!`));
      
    } catch (error) {
      console.error(chalk.red(`❌ ${toolName} failed:`));
      console.error(chalk.red(`  Error: ${error.message}`));
      
      // Try to understand what's wrong with this specific tool
      console.log(chalk.gray(`  Tool definition:`));
      console.log(chalk.gray(`    ${JSON.stringify(toolDef, null, 2)}`));
    }
  }
  
  // Test all tools together
  console.log(chalk.blue('\n🧪 Testing all MemGPT tools together...'));
  try {
    const allTools = Object.values(memgptTools);
    
    const response = await together.chat.completions.create({
      messages: messages,
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_tokens: 500,
      tools: allTools,
      tool_choice: 'auto'
    });
    
    console.log(chalk.green('✅ All MemGPT tools work together!'));
    
    if (response.choices[0].message.tool_calls) {
      console.log(chalk.yellow('Tool calls made:'));
      response.choices[0].message.tool_calls.forEach(call => {
        console.log(chalk.gray(`  ${call.function.name}: ${call.function.arguments}`));
      });
    }
    
  } catch (error) {
    console.error(chalk.red('❌ All tools together failed:'));
    console.error(chalk.red(`Error: ${error.message}`));
  }
}

// Run test
await testMemGPTToolsWithTogether();