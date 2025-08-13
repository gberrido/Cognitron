#!/usr/bin/env node

/**
 * Basic SDK Usage Example
 * Demonstrates how to use the Cognitron SDK programmatically
 */

import { CognitronSDK } from '../src/index.js';

async function basicExample() {
  console.log('🚀 Cognitron SDK Basic Usage Example\n');

  // Initialize SDK with configuration
  const sdk = new CognitronSDK({
    serverUrl: 'http://localhost:8000',
    debug: true,
    credentials: {
      username: 'demo',
      password: 'demo123'
    }
  });

  try {
    // 1. Initialize the SDK
    console.log('1. Initializing SDK...');
    await sdk.initialize();
    console.log('✅ SDK initialized\n');

    // 2. Authenticate
    console.log('2. Authenticating...');
    const authResult = await sdk.authenticate();
    console.log(`✅ Authentication successful: ${authResult.user.username}\n`);

    // 3. Get system status
    console.log('3. Getting system status...');
    const status = await sdk.getSystemStatus();
    console.log('✅ System status:');
    console.log(`   - User: ${status.user?.username || 'Unknown'}`);
    console.log(`   - Model: ${status.models?.display_name || 'Unknown'}`);
    console.log(`   - Memory: ${status.memory?.total_messages || 0} messages\n`);

    // 4. Send a chat message
    console.log('4. Sending chat message...');
    const response = await sdk.sendMessage('Hello! Can you tell me about yourself?');
    console.log('✅ Response received:');
    console.log(`   ${response.content}\n`);

    // 5. Search memory
    console.log('5. Searching memory...');
    const searchResults = await sdk.searchMemory('hello', { maxResults: 3 });
    console.log(`✅ Found ${searchResults.total_count || 0} results\n`);

    // 6. Get memory status
    console.log('6. Getting memory status...');
    const memoryStatus = await sdk.getMemoryStatus();
    console.log('✅ Memory status:');
    console.log(`   - Working Context: ${memoryStatus.working_context_size || 0} entries`);
    console.log(`   - Total Messages: ${memoryStatus.total_messages || 0}`);
    console.log(`   - Memory Usage: ${Math.round((memoryStatus.memory_pressure || 0) * 100)}%\n`);

    // 7. Get available models
    console.log('7. Getting available models...');
    const models = await sdk.getAvailableModels();
    console.log(`✅ Available models: ${models.available_models?.length || 0}\n`);

    // 8. Cleanup
    console.log('8. Cleaning up...');
    await sdk.close();
    console.log('✅ SDK closed\n');

    console.log('🎉 Basic example completed successfully!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (sdk.config.debug) {
      console.error('Stack trace:', error.stack);
    }
    
    // Cleanup on error
    try {
      await sdk.close();
    } catch (closeError) {
      console.error('❌ Error during cleanup:', closeError.message);
    }
    
    process.exit(1);
  }
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  basicExample();
}