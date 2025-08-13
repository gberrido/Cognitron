#!/usr/bin/env node

/**
 * Model Switching Example
 * Demonstrates switching between different AI models
 */

import { CognitronSDK } from '../src/index.js';
import chalk from 'chalk';

async function modelSwitchingExample() {
  console.log(chalk.cyan('🤖 Cognitron SDK Model Switching Example\n'));

  const sdk = new CognitronSDK({
    serverUrl: 'http://localhost:8000',
    debug: false
  });

  try {
    // Initialize and authenticate
    await sdk.initialize();
    await sdk.authenticate();
    console.log(chalk.green('✅ SDK ready\n'));

    // 1. Get available models
    console.log(chalk.cyan('1. Available Models'));
    console.log(chalk.dim('─'.repeat(20)));
    
    const modelsData = await sdk.getAvailableModels();
    console.log(`Current model: ${chalk.green(modelsData.current_model)}`);
    console.log(`Default model: ${chalk.blue(modelsData.default_model)}`);
    console.log('\nAvailable models:');
    
    if (modelsData.available_models && Array.isArray(modelsData.available_models)) {
      modelsData.available_models.forEach((model, i) => {
        const current = model.model === modelsData.current_model ? chalk.green(' (current)') : '';
        const defaultMark = model.model === modelsData.default_model ? chalk.blue(' (default)') : '';
        
        console.log(chalk.white(`${i + 1}. ${model.display_name}${current}${defaultMark}`));
        console.log(chalk.dim(`   Model: ${model.model}`));
        if (model.description) {
          console.log(chalk.dim(`   Description: ${model.description}`));
        }
        if (model.optimal_use_cases && model.optimal_use_cases.length > 0) {
          console.log(chalk.cyan(`   Best for: ${model.optimal_use_cases.join(', ')}`));
        }
        console.log('');
      });
    }

    // 2. Test current model
    console.log(chalk.cyan('2. Testing Current Model'));
    console.log(chalk.dim('─'.repeat(25)));
    
    const currentModel = await sdk.getCurrentModel();
    console.log(`Testing model: ${chalk.white(currentModel.display_name || currentModel.model)}`);
    
    const testPrompt = 'Explain quantum computing in one sentence.';
    console.log(chalk.dim(`Prompt: "${testPrompt}"`));
    
    const startTime = Date.now();
    const response1 = await sdk.sendMessage(testPrompt);
    const endTime = Date.now();
    
    console.log(chalk.yellow('Response:'));
    console.log(`   ${response1.content}`);
    console.log(chalk.dim(`   Response time: ${endTime - startTime}ms`));
    if (response1.usage) {
      console.log(chalk.dim(`   Tokens: ${response1.usage.total_tokens} (${response1.usage.prompt_tokens}+${response1.usage.completion_tokens})`));
    }
    console.log('');

    // 3. Switch to different models and test each
    console.log(chalk.cyan('3. Testing Different Models'));
    console.log(chalk.dim('─'.repeat(30)));
    
    const modelsToTest = modelsData.available_models?.filter(m => m.model !== modelsData.current_model) || [];
    
    for (const model of modelsToTest.slice(0, 3)) { // Test up to 3 different models
      try {
        console.log(chalk.yellow(`Switching to: ${model.display_name}`));
        await sdk.switchModel(model.model);
        
        // Test the new model
        const testStart = Date.now();
        const response = await sdk.sendMessage('What is artificial intelligence?');
        const testEnd = Date.now();
        
        console.log(chalk.green('✅ Model switched successfully'));
        console.log(chalk.white('Response preview:'));
        console.log(`   ${response.content.substring(0, 100)}${response.content.length > 100 ? '...' : ''}`);
        console.log(chalk.dim(`   Response time: ${testEnd - testStart}ms`));
        
        if (response.usage) {
          console.log(chalk.dim(`   Tokens used: ${response.usage.total_tokens}`));
        }
        
        console.log('');
        
      } catch (error) {
        console.error(chalk.red(`❌ Failed to switch to ${model.display_name}: ${error.message}`));
        console.log('');
      }
    }

    // 4. Model capabilities comparison
    console.log(chalk.cyan('4. Model Capabilities Comparison'));
    console.log(chalk.dim('─'.repeat(35)));
    
    for (const model of modelsData.available_models?.slice(0, 3) || []) {
      try {
        console.log(chalk.white(`Model: ${model.display_name}`));
        
        const capabilities = await sdk.models.getModelCapabilities(model.model);
        if (capabilities && Object.keys(capabilities).length > 0) {
          Object.entries(capabilities).forEach(([key, value]) => {
            console.log(chalk.cyan(`   ${key}: ${value}`));
          });
        } else {
          console.log(chalk.dim('   No detailed capabilities available'));
        }
        
        console.log('');
        
      } catch (error) {
        console.log(chalk.yellow(`   Could not get capabilities: ${error.message}`));
        console.log('');
      }
    }

    // 5. Performance comparison
    console.log(chalk.cyan('5. Performance Comparison'));
    console.log(chalk.dim('─'.repeat(25)));
    
    const performanceTest = async (modelName, prompt) => {
      try {
        await sdk.switchModel(modelName);
        const start = Date.now();
        const response = await sdk.sendMessage(prompt);
        const end = Date.now();
        
        return {
          model: modelName,
          responseTime: end - start,
          tokenCount: response.usage?.total_tokens || 0,
          responseLength: response.content.length,
          success: true
        };
      } catch (error) {
        return {
          model: modelName,
          error: error.message,
          success: false
        };
      }
    };

    const performancePrompt = 'Write a haiku about technology.';
    console.log(chalk.dim(`Performance test prompt: "${performancePrompt}"`));
    console.log('');

    const performanceResults = [];
    
    for (const model of modelsData.available_models?.slice(0, 3) || []) {
      console.log(chalk.yellow(`Testing ${model.display_name}...`));
      const result = await performanceTest(model.model, performancePrompt);
      performanceResults.push(result);
      
      if (result.success) {
        console.log(chalk.green(`✅ ${result.responseTime}ms, ${result.tokenCount} tokens, ${result.responseLength} chars`));
      } else {
        console.log(chalk.red(`❌ ${result.error}`));
      }
      console.log('');
    }

    // Display performance summary
    console.log(chalk.cyan('Performance Summary:'));
    console.log(chalk.dim('─'.repeat(20)));
    
    const successful = performanceResults.filter(r => r.success);
    if (successful.length > 0) {
      successful.sort((a, b) => a.responseTime - b.responseTime);
      
      console.log(chalk.white('Ranked by response time:'));
      successful.forEach((result, i) => {
        const modelName = modelsData.available_models?.find(m => m.model === result.model)?.display_name || result.model;
        console.log(`   ${i + 1}. ${chalk.green(modelName)}: ${result.responseTime}ms`);
      });
      
      const fastest = successful[0];
      const slowest = successful[successful.length - 1];
      console.log(chalk.green(`\nFastest: ${fastest.model} (${fastest.responseTime}ms)`));
      console.log(chalk.blue(`Slowest: ${slowest.model} (${slowest.responseTime}ms)`));
      console.log(chalk.dim(`Speed difference: ${slowest.responseTime - fastest.responseTime}ms`));
    }
    console.log('');

    // 6. Reset to default model
    console.log(chalk.cyan('6. Resetting to Default Model'));
    console.log(chalk.dim('─'.repeat(30)));
    
    try {
      await sdk.models.resetToDefault();
      const defaultModel = await sdk.getCurrentModel();
      console.log(chalk.green(`✅ Reset to default model: ${defaultModel.display_name || defaultModel.model}`));
    } catch (error) {
      console.log(chalk.yellow(`Could not reset to default: ${error.message}`));
    }
    console.log('');

    // 7. Model-specific conversation
    console.log(chalk.cyan('7. Model-Specific Conversation Test'));
    console.log(chalk.dim('─'.repeat(35)));
    
    const conversationTests = [
      {
        model: modelsData.available_models?.find(m => m.optimal_use_cases?.includes('reasoning'))?.model,
        prompt: 'Solve this logic puzzle: If all roses are flowers, and some flowers are red, can we conclude that some roses are red?',
        expectation: 'reasoning'
      },
      {
        model: modelsData.available_models?.find(m => m.optimal_use_cases?.includes('creative'))?.model,
        prompt: 'Write a creative opening line for a sci-fi story.',
        expectation: 'creativity'
      }
    ];

    for (const test of conversationTests) {
      if (test.model) {
        try {
          console.log(chalk.yellow(`Testing ${test.expectation} with model optimized for it`));
          await sdk.switchModel(test.model);
          
          const response = await sdk.sendMessage(test.prompt);
          console.log(chalk.green('✅ Response:'));
          console.log(`   ${response.content}`);
          console.log('');
        } catch (error) {
          console.log(chalk.red(`❌ Test failed: ${error.message}`));
          console.log('');
        }
      }
    }

    // Cleanup
    await sdk.close();
    console.log(chalk.green('🎉 Model switching example completed!'));

  } catch (error) {
    console.error(chalk.red('❌ Error:'), error.message);
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

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  modelSwitchingExample();
}