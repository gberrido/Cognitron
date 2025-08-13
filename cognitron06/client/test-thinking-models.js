#!/usr/bin/env node

/**
 * Test Thinking Models Support
 * Tests the 3 Groq models to see what thinking/reasoning data they provide
 */

import { CognitronSDK } from './src/index.js';
import chalk from 'chalk';

async function testThinkingModels() {
  console.log(chalk.cyan.bold('🧠 Testing Thinking Model Support\n'));

  const sdk = new CognitronSDK({
    serverUrl: 'http://localhost:8000',
    debug: true,
    credentials: {
      username: 'demo',
      password: 'demo123'
    }
  });

  try {
    // Initialize and authenticate
    console.log(chalk.dim('Initializing SDK and authenticating...'));
    await sdk.initialize();
    await sdk.authenticate();
    console.log(chalk.green('✅ SDK ready\n'));

    // Get available models
    const modelsData = await sdk.getAvailableModels();
    console.log(chalk.cyan('Available models:'));
    modelsData.available_models?.forEach((model, i) => {
      console.log(`  ${i + 1}. ${model.display_name} (${model.model})`);
    });
    console.log('');

    // Test prompts designed to trigger reasoning
    const testPrompts = [
      {
        prompt: "Solve this step by step: If all roses are flowers, and some flowers are red, can we conclude that some roses are red?",
        expectation: "logical reasoning"
      },
      {
        prompt: "Think through this math problem: What is 15% of 240?",
        expectation: "mathematical reasoning"
      },
      {
        prompt: "Analyze this: Why might someone choose Python over JavaScript for data science?",
        expectation: "analytical reasoning"
      }
    ];

    // Test each available model
    const modelsToTest = modelsData.available_models?.slice(0, 3) || [];
    
    for (const [modelIndex, model] of modelsToTest.entries()) {
      console.log(chalk.cyan.bold(`\n📊 Testing Model ${modelIndex + 1}: ${model.display_name}`));
      console.log(chalk.dim(`Model ID: ${model.model}`));
      console.log(chalk.dim('─'.repeat(60)));

      try {
        // Switch to the model
        await sdk.switchModel(model.model);
        console.log(chalk.green(`✅ Switched to ${model.display_name}\n`));

        // Test each prompt
        for (const [promptIndex, test] of testPrompts.entries()) {
          console.log(chalk.yellow(`Test ${promptIndex + 1}: ${test.expectation}`));
          console.log(chalk.dim(`Prompt: "${test.prompt.substring(0, 60)}..."`));
          
          // Test regular API call first
          console.log(chalk.blue('\n🔍 Testing Regular API Call:'));
          const startTime = Date.now();
          const response = await sdk.sendMessage(test.prompt);
          const endTime = Date.now();

          // Analyze response structure
          console.log(chalk.white('Response structure:'));
          console.log(`  📝 Content: ${response.content ? 'YES' : 'NO'} (${response.content?.length || 0} chars)`);
          console.log(`  🧠 Thinking: ${response.thinking ? 'YES' : 'NO'} ${response.thinking ? `(${response.thinking.length} chars)` : ''}`);
          console.log(`  🔧 Tool calls: ${response.tool_calls?.length || 0}`);
          console.log(`  ⚡ Response time: ${endTime - startTime}ms`);
          console.log(`  🎯 Token usage: ${response.usage?.total_tokens || 'N/A'}`);

          // Show thinking content if present
          if (response.thinking) {
            console.log(chalk.gray('\n💭 Thinking content preview:'));
            const thinkingPreview = response.thinking.length > 200 
              ? response.thinking.substring(0, 200) + '...'
              : response.thinking;
            console.log(chalk.gray(`   ${thinkingPreview}`));
          }

          // Show response preview
          console.log(chalk.white('\n📄 Response preview:'));
          const responsePreview = response.content?.length > 150 
            ? response.content.substring(0, 150) + '...'
            : response.content || 'No content';
          console.log(chalk.white(`   ${responsePreview}`));

          // Test streaming if model supports it
          console.log(chalk.blue('\n🌊 Testing Streaming:'));
          let streamedThinking = '';
          let streamedContent = '';
          let toolCallsReceived = 0;

          try {
            const streamStart = Date.now();
            await sdk.streamChat(test.prompt, {
              onThinking: (thinking) => {
                streamedThinking += thinking;
                console.log(chalk.gray(`💭 [STREAM] Thinking chunk: ${thinking.length} chars`));
              },
              onChunk: (chunk) => {
                streamedContent += chunk;
                // Don't log every chunk, just count
              },
              onToolCall: (toolCall) => {
                toolCallsReceived++;
                console.log(chalk.blue(`🔧 [STREAM] Tool call: ${toolCall.function?.name || toolCall.name}`));
              },
              onComplete: (finalResponse) => {
                const streamEnd = Date.now();
                console.log(chalk.green(`✅ [STREAM] Complete in ${streamEnd - streamStart}ms`));
              },
              onError: (error) => {
                console.log(chalk.red(`❌ [STREAM] Error: ${error.message}`));
              }
            });

            console.log(chalk.white('Streaming results:'));
            console.log(`  🧠 Thinking received: ${streamedThinking ? 'YES' : 'NO'} (${streamedThinking.length} chars)`);
            console.log(`  📝 Content received: ${streamedContent ? 'YES' : 'NO'} (${streamedContent.length} chars)`);
            console.log(`  🔧 Tool calls: ${toolCallsReceived}`);

          } catch (streamError) {
            console.log(chalk.red(`❌ Streaming failed: ${streamError.message}`));
          }

          console.log(chalk.dim('\n' + '─'.repeat(40)));
        }

        // Model summary
        console.log(chalk.cyan(`\n📋 ${model.display_name} Summary:`));
        console.log(`  Thinking support: ${response.thinking ? chalk.green('YES') : chalk.red('NO')}`);
        console.log(`  Streaming support: ${streamedThinking ? chalk.green('YES') : chalk.red('NO')}`);
        console.log(`  Tool calls: ${response.tool_calls?.length > 0 ? chalk.green('YES') : chalk.yellow('NO')}`);

      } catch (modelError) {
        console.log(chalk.red(`❌ Error testing ${model.display_name}: ${modelError.message}`));
      }

      console.log('\n' + '═'.repeat(70));
    }

    // Final summary
    console.log(chalk.cyan.bold('\n📊 Final Test Summary'));
    console.log(chalk.dim('─'.repeat(30)));
    
    console.log(chalk.white('Models tested: ') + modelsToTest.length);
    console.log(chalk.white('Test prompts: ') + testPrompts.length);
    
    console.log(chalk.yellow('\n💡 Findings:'));
    console.log('• Check which models provide thinking/reasoning content');
    console.log('• Verify streaming support for thinking models');
    console.log('• Confirm response structure matches expectations');
    console.log('• Test both API and streaming endpoints');

    console.log(chalk.blue('\n🔧 Server Implementation Notes:'));
    console.log('• If thinking content is missing, server needs to extract it');
    console.log('• Check response.thinking field in server response');
    console.log('• Verify streaming includes thinking chunks');
    console.log('• Consider WebSocket message type "thinking" support');

    // Cleanup
    await sdk.close();
    console.log(chalk.green('\n🎉 Testing completed!'));

  } catch (error) {
    console.error(chalk.red('❌ Test failed:'), error.message);
    if (sdk.config.debug) {
      console.error('Stack trace:', error.stack);
    }
    
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
  console.log(chalk.yellow('\n👋 Test interrupted. Shutting down...'));
  process.exit(0);
});

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  testThinkingModels();
}