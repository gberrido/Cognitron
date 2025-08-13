#!/usr/bin/env node

/**
 * Debug script to diagnose API issues with MemGPT
 */

import { Groq } from 'groq-sdk';
import chalk from 'chalk';

class MemGPTDebugger {
  constructor() {
    this.apiKey = process.env.GROQ_API_KEY;
    if (!this.apiKey) {
      console.error(chalk.red('❌ GROQ_API_KEY environment variable not set'));
      process.exit(1);
    }
    
    this.groq = new Groq({ apiKey: this.apiKey });
  }

  async testBasicAPICall() {
    console.log(chalk.blue('🔍 Testing basic API call...'));
    
    try {
      const response = await this.groq.chat.completions.create({
        messages: [
          { role: 'user', content: 'Hello, this is a test message.' }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.7,
        max_tokens: 100
      });
      
      console.log(chalk.green('✅ Basic API call successful'));
      console.log(chalk.gray('Response structure:'), {
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length,
        hasFirstChoice: !!response.choices?.[0],
        hasMessage: !!response.choices?.[0]?.message,
        hasContent: !!response.choices?.[0]?.message?.content,
        content: response.choices?.[0]?.message?.content?.substring(0, 100)
      });
      
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Basic API call failed:'), error.message);
      if (error.response) {
        console.error(chalk.red('Response status:'), error.response.status);
        console.error(chalk.red('Response data:'), JSON.stringify(error.response.data, null, 2));
      }
      return false;
    }
  }

  async testToolCalling() {
    console.log(chalk.blue('\n🔍 Testing tool calling...'));
    
    const testTools = [{
      type: 'function',
      function: {
        name: 'test_tool',
        description: 'A simple test tool',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Test message' }
          },
          required: ['message']
        }
      }
    }];

    try {
      const response = await this.groq.chat.completions.create({
        messages: [
          { role: 'user', content: 'Please call the test_tool with message "hello world"' }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.7,
        max_tokens: 200,
        tools: testTools,
        tool_choice: 'auto'
      });
      
      console.log(chalk.green('✅ Tool calling API call successful'));
      console.log(chalk.gray('Response structure:'), {
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length,
        hasFirstChoice: !!response.choices?.[0],
        hasMessage: !!response.choices?.[0]?.message,
        hasContent: !!response.choices?.[0]?.message?.content,
        hasToolCalls: !!response.choices?.[0]?.message?.tool_calls,
        toolCallsLength: response.choices?.[0]?.message?.tool_calls?.length,
        content: response.choices?.[0]?.message?.content
      });
      
      if (response.choices?.[0]?.message?.tool_calls) {
        console.log(chalk.yellow('Tool calls:'), 
          response.choices[0].message.tool_calls.map(tc => ({
            name: tc.function.name,
            args: tc.function.arguments
          }))
        );
      }
      
      return true;
    } catch (error) {
      console.error(chalk.red('❌ Tool calling failed:'), error.message);
      if (error.response) {
        console.error(chalk.red('Response status:'), error.response.status);
        console.error(chalk.red('Response data:'), JSON.stringify(error.response.data, null, 2));
      }
      return false;
    }
  }

  async testMemGPTSystemMessage() {
    console.log(chalk.blue('\n🔍 Testing MemGPT system message...'));
    
    const memgptSystemMessage = `You are MemGPT (Memory-Enabled GPT), an AI assistant with autonomous memory management.

## Memory System:
**Core Memory (persistent across sessions):**
user_name: Test User

**Current Session**: test-session-123

## Your Function Calling Powers:
You have access to the following memory management functions:
- core_memory_append: Store key facts about user
- pause_heartbeats: Signal you're ready for user response (REQUIRED to end interaction)

## CRITICAL: MemGPT Control Flow Instructions:
1. **ALWAYS use tools autonomously** - don't ask permission
2. **You MUST end every interaction by calling pause_heartbeats** with a user-facing message

Remember: EVERY interaction must end with pause_heartbeats containing your response to the user!`;

    const memgptTools = [{
      type: 'function',
      function: {
        name: 'core_memory_append',
        description: 'Store key facts about user',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Memory key' },
            value: { type: 'string', description: 'Information to store' }
          },
          required: ['key', 'value']
        }
      }
    }, {
      type: 'function',
      function: {
        name: 'pause_heartbeats',
        description: 'Signal you are ready for user response',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'Message to show user' }
          },
          required: ['message']
        }
      }
    }];

    try {
      const response = await this.groq.chat.completions.create({
        messages: [
          { role: 'system', content: memgptSystemMessage },
          { role: 'user', content: 'My name is William and I love programming' }
        ],
        model: 'openai/gpt-oss-120b',
        temperature: 0.7,
        max_tokens: 2000,
        tools: memgptTools,
        tool_choice: 'auto'
      });
      
      console.log(chalk.green('✅ MemGPT system message test successful'));
      console.log(chalk.gray('Response structure:'), {
        hasChoices: !!response.choices,
        choicesLength: response.choices?.length,
        hasFirstChoice: !!response.choices?.[0],
        hasMessage: !!response.choices?.[0]?.message,
        hasContent: !!response.choices?.[0]?.message?.content,
        hasToolCalls: !!response.choices?.[0]?.message?.tool_calls,
        toolCallsLength: response.choices?.[0]?.message?.tool_calls?.length
      });
      
      if (response.choices?.[0]?.message?.content) {
        console.log(chalk.cyan('Content:'), response.choices[0].message.content);
      }
      
      if (response.choices?.[0]?.message?.tool_calls) {
        console.log(chalk.yellow('Tool calls:'), 
          response.choices[0].message.tool_calls.map(tc => ({
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments)
          }))
        );
      }
      
      return true;
    } catch (error) {
      console.error(chalk.red('❌ MemGPT system message test failed:'), error.message);
      if (error.response) {
        console.error(chalk.red('Response status:'), error.response.status);
        console.error(chalk.red('Response data:'), JSON.stringify(error.response.data, null, 2));
      }
      return false;
    }
  }

  async runAllTests() {
    console.log(chalk.bold.cyan('🧪 MemGPT API Diagnostic Tool'));
    console.log(chalk.gray('═'.repeat(50)));
    
    const results = {
      basic: await this.testBasicAPICall(),
      toolCalling: await this.testToolCalling(),
      memgptSystem: await this.testMemGPTSystemMessage()
    };
    
    console.log(chalk.bold.yellow('\n📊 Test Results Summary:'));
    console.log(results.basic ? chalk.green('✅ Basic API calls working') : chalk.red('❌ Basic API calls failing'));
    console.log(results.toolCalling ? chalk.green('✅ Tool calling working') : chalk.red('❌ Tool calling failing'));
    console.log(results.memgptSystem ? chalk.green('✅ MemGPT system working') : chalk.red('❌ MemGPT system failing'));
    
    const allPassed = Object.values(results).every(r => r);
    
    if (allPassed) {
      console.log(chalk.bold.green('\n🎉 All tests passed! The API is working correctly.'));
      console.log(chalk.cyan('The issue might be in the MemGPT implementation logic.'));
    } else {
      console.log(chalk.bold.red('\n💥 Some tests failed. Check the API configuration and Groq service status.'));
    }
    
    console.log(chalk.gray('\n💡 Tips:'));
    console.log(chalk.gray('  - Ensure GROQ_API_KEY is set correctly'));
    console.log(chalk.gray('  - Check Groq API status at https://status.groq.com'));
    console.log(chalk.gray('  - Try running with DEBUG=true for more details'));
    
    return allPassed;
  }
}

// Run diagnostic if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const diagnostic = new MemGPTDebugger();
  const success = await diagnostic.runAllTests();
  process.exit(success ? 0 : 1);
}

export { MemGPTDebugger };