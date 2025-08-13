#!/usr/bin/env node

/**
 * Streaming Chat Example
 * Demonstrates streaming responses from the AI
 */

import { CognitronSDK } from '../src/index.js';
import chalk from 'chalk';

async function streamingExample() {
  console.log(chalk.cyan('🚀 Cognitron SDK Streaming Chat Example\n'));

  const sdk = new CognitronSDK({
    serverUrl: 'http://localhost:8000',
    enableStreaming: true,
    preferWebSocket: true,
    debug: false
  });

  try {
    // Initialize and authenticate
    console.log(chalk.dim('Initializing and authenticating...'));
    await sdk.initialize();
    await sdk.authenticate();
    console.log(chalk.green('✅ Ready for streaming chat\n'));

    // Example 1: Simple streaming
    console.log(chalk.cyan('Example 1: Simple streaming response'));
    console.log(chalk.dim('Question: Tell me a short story about AI\n'));
    
    console.log(chalk.yellow('🤖 AI: '), { end: '' });
    let fullResponse = '';
    
    await sdk.streamChat('Tell me a short story about AI', {
      onStart: () => {
        // Called when streaming starts
      },
      onChunk: (chunk) => {
        // Print each chunk as it arrives
        process.stdout.write(chunk);
        fullResponse += chunk;
      },
      onComplete: (response) => {
        console.log(chalk.green('\n✅ Streaming complete'));
        console.log(chalk.dim(`Total length: ${fullResponse.length} characters\n`));
      },
      onError: (error) => {
        console.error(chalk.red(`❌ Streaming error: ${error.message}`));
      }
    });

    // Example 2: Streaming with tool calls
    console.log(chalk.cyan('Example 2: Streaming with potential tool calls'));
    console.log(chalk.dim('Question: What is my current memory status?\n'));
    
    console.log(chalk.yellow('🤖 AI: '), { end: '' });
    fullResponse = '';
    
    await sdk.streamChat('What is my current memory status?', {
      onChunk: (chunk) => {
        process.stdout.write(chunk);
        fullResponse += chunk;
      },
      onToolCall: (toolCall) => {
        const toolName = toolCall.function?.name || toolCall.name || 'Unknown';
        console.log(chalk.blue(`\n🔧 Tool used: ${toolName}`));
        if (toolCall.result) {
          console.log(chalk.dim(`   Result: ${toolCall.result.message || 'Success'}`));
        }
        console.log(chalk.yellow('🤖 AI: '), { end: '' });
      },
      onComplete: () => {
        console.log(chalk.green('\n✅ Response with tools complete\n'));
      }
    });

    // Example 3: Multiple streaming conversations
    console.log(chalk.cyan('Example 3: Multiple quick streaming conversations'));
    
    const questions = [
      'What is 2+2?',
      'Name a color',
      'Say hello in Spanish'
    ];

    for (const [index, question] of questions.entries()) {
      console.log(chalk.dim(`${index + 1}. ${question}`));
      console.log(chalk.yellow('🤖: '), { end: '' });
      
      await sdk.streamChat(question, {
        onChunk: (chunk) => {
          process.stdout.write(chunk);
        },
        onComplete: () => {
          console.log('\n');
        }
      });
    }

    console.log(chalk.green('✅ All streaming examples completed'));

    // Show final memory status
    console.log(chalk.cyan('\nFinal memory status:'));
    const memoryStatus = await sdk.getMemoryStatus();
    console.log(chalk.dim(`Messages: ${memoryStatus.total_messages || 0}`));
    console.log(chalk.dim(`Memory usage: ${Math.round((memoryStatus.memory_pressure || 0) * 100)}%`));

    // Cleanup
    await sdk.close();
    console.log(chalk.green('\n🎉 Streaming example completed!'));

  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
    
    // Cleanup on error
    try {
      await sdk.close();
    } catch (closeError) {
      console.error(chalk.red('❌ Cleanup error:'), closeError.message);
    }
    
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\n👋 Shutting down gracefully...'));
  process.exit(0);
});

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  streamingExample();
}