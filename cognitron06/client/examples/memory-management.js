#!/usr/bin/env node

/**
 * Memory Management Example
 * Demonstrates advanced memory operations with the SDK
 */

import { CognitronSDK } from '../src/index.js';
import chalk from 'chalk';

async function memoryExample() {
  console.log(chalk.cyan('🧠 Cognitron SDK Memory Management Example\n'));

  const sdk = new CognitronSDK({
    serverUrl: 'http://localhost:8000',
    debug: false
  });

  try {
    // Initialize and authenticate
    await sdk.initialize();
    await sdk.authenticate();
    console.log(chalk.green('✅ SDK ready\n'));

    // 1. Get initial memory status
    console.log(chalk.cyan('1. Initial Memory Status'));
    console.log(chalk.dim('─'.repeat(30)));
    const initialStatus = await sdk.getMemoryStatus();
    displayMemoryStatus(initialStatus);

    // 2. Have some conversations to populate memory
    console.log(chalk.cyan('2. Populating Memory with Conversations'));
    console.log(chalk.dim('─'.repeat(40)));
    
    const conversations = [
      'My name is Alice and I love programming',
      'I work as a software engineer at TechCorp',
      'My favorite programming language is Python',
      'I have a cat named Whiskers',
      'I enjoy reading science fiction novels'
    ];

    for (const [index, message] of conversations.entries()) {
      console.log(chalk.dim(`${index + 1}. "${message}"`));
      const response = await sdk.sendMessage(message);
      console.log(chalk.green(`   ✅ Response: ${response.content.substring(0, 50)}...\n`));
    }

    // 3. Search memory
    console.log(chalk.cyan('3. Searching Memory'));
    console.log(chalk.dim('─'.repeat(20)));
    
    const searchQueries = ['Alice', 'programming', 'cat', 'TechCorp'];
    
    for (const query of searchQueries) {
      console.log(chalk.yellow(`Searching for: "${query}"`));
      const searchResults = await sdk.searchMemory(query, { maxResults: 3 });
      
      if (searchResults.total_count > 0) {
        console.log(chalk.green(`   Found ${searchResults.total_count} results:`));
        searchResults.results?.slice(0, 2).forEach((result, i) => {
          const preview = (result.content || '').substring(0, 60);
          console.log(chalk.dim(`   ${i + 1}. ${preview}...`));
        });
      } else {
        console.log(chalk.red('   No results found'));
      }
      console.log('');
    }

    // 4. Working context management
    console.log(chalk.cyan('4. Working Context Management'));
    console.log(chalk.dim('─'.repeat(30)));
    
    // Get current working context
    console.log('Current working context:');
    const workingContext = await sdk.memory.getWorkingContext();
    if (workingContext.length === 0) {
      console.log(chalk.gray('   Empty working context'));
    } else {
      workingContext.forEach((entry, i) => {
        console.log(chalk.white(`   ${i + 1}. ${entry.key}: ${entry.value}`));
      });
    }
    console.log('');

    // Update working context
    console.log('Adding entries to working context:');
    await sdk.memory.updateWorkingContext('user_name', 'Alice');
    await sdk.memory.updateWorkingContext('user_profession', 'Software Engineer');
    await sdk.memory.updateWorkingContext('user_company', 'TechCorp');
    console.log(chalk.green('   ✅ Added user information to working context'));

    // Get updated working context
    const updatedContext = await sdk.memory.getWorkingContext();
    console.log('Updated working context:');
    updatedContext.forEach((entry, i) => {
      console.log(chalk.white(`   ${i + 1}. ${entry.key}: ${entry.value}`));
    });
    console.log('');

    // 5. Archival storage
    console.log(chalk.cyan('5. Archival Storage Operations'));
    console.log(chalk.dim('─'.repeat(30)));
    
    // Insert data into archival storage
    const archivalData = {
      project_info: 'Working on a new AI chatbot project called Cognitron',
      skills: 'Expert in Python, JavaScript, and Machine Learning',
      interests: 'AI, Robotics, Science Fiction literature'
    };

    console.log('Inserting data into archival storage:');
    for (const [key, value] of Object.entries(archivalData)) {
      await sdk.memory.insertArchival(key, value, {
        category: 'user_profile',
        timestamp: new Date().toISOString()
      });
      console.log(chalk.green(`   ✅ Stored: ${key}`));
    }
    console.log('');

    // Search archival storage
    console.log('Searching archival storage for "AI":');
    const archivalResults = await sdk.memory.searchArchival('AI', 5);
    if (archivalResults.results && archivalResults.results.length > 0) {
      archivalResults.results.forEach((result, i) => {
        console.log(chalk.white(`   ${i + 1}. ${result.key}: ${result.data.substring(0, 50)}...`));
      });
    } else {
      console.log(chalk.gray('   No archival results found'));
    }
    console.log('');

    // 6. Session management
    console.log(chalk.cyan('6. Session Management'));
    console.log(chalk.dim('─'.repeat(20)));
    
    const sessions = await sdk.memory.getSessions({ limit: 5 });
    console.log(`Total sessions: ${sessions.total_sessions || 0}`);
    if (sessions.sessions && sessions.sessions.length > 0) {
      sessions.sessions.forEach((session, i) => {
        const startTime = new Date(session.start_time || session.created_at).toLocaleString();
        console.log(chalk.white(`   ${i + 1}. ${session.session_id} (${session.message_count || 0} messages, ${startTime})`));
      });
    }
    console.log('');

    // 7. Memory analytics
    console.log(chalk.cyan('7. Memory Analytics'));
    console.log(chalk.dim('─'.repeat(20)));
    
    try {
      const analytics = await sdk.memory.getAnalytics({
        timeRange: '24h',
        includeUsage: true
      });
      console.log('Memory analytics:');
      console.log(chalk.white(`   Conversations today: ${analytics.conversations_count || 0}`));
      console.log(chalk.white(`   Average response time: ${analytics.avg_response_time || 'N/A'}ms`));
      console.log(chalk.white(`   Memory efficiency: ${analytics.memory_efficiency || 'N/A'}%`));
    } catch (error) {
      console.log(chalk.yellow('   Analytics not available:', error.message));
    }
    console.log('');

    // 8. Memory export
    console.log(chalk.cyan('8. Memory Export'));
    console.log(chalk.dim('─'.repeat(15)));
    
    try {
      const exportData = await sdk.memory.exportMemory({
        format: 'json',
        includeWorkingContext: true,
        includeArchival: true,
        includeConversations: false // Skip conversations for brevity
      });
      
      console.log('Exported memory data:');
      console.log(chalk.dim(`   Working context entries: ${exportData.working_context?.length || 0}`));
      console.log(chalk.dim(`   Archival entries: ${exportData.archival_storage?.length || 0}`));
      console.log(chalk.dim(`   Export size: ${JSON.stringify(exportData).length} characters`));
    } catch (error) {
      console.log(chalk.yellow('   Export not available:', error.message));
    }
    console.log('');

    // 9. Final memory status
    console.log(chalk.cyan('9. Final Memory Status'));
    console.log(chalk.dim('─'.repeat(25)));
    const finalStatus = await sdk.getMemoryStatus();
    displayMemoryStatus(finalStatus);

    // Test memory with questions
    console.log(chalk.cyan('10. Testing Memory Recall'));
    console.log(chalk.dim('─'.repeat(25)));
    
    const memoryQuestions = [
      'What is my name?',
      'Where do I work?',
      'What programming language do I prefer?',
      'What is the name of my cat?'
    ];

    for (const question of memoryQuestions) {
      console.log(chalk.yellow(`Q: ${question}`));
      const response = await sdk.sendMessage(question);
      console.log(chalk.white(`A: ${response.content}`));
      console.log('');
    }

    // Cleanup
    await sdk.close();
    console.log(chalk.green('🎉 Memory management example completed!'));

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

function displayMemoryStatus(status) {
  console.log(chalk.white(`Working Context: ${status.working_context_size || 0} entries`));
  console.log(chalk.white(`Conversation Queue: ${status.fifo_queue_size || status.fifo_queue_length || 0} messages`));
  console.log(chalk.white(`Total Messages: ${status.total_messages || status.recall_storage_size || 0}`));
  console.log(chalk.white(`Archival Storage: ${status.archival_storage_size || 0} entries`));
  
  const memoryUsage = status.memory_usage || (status.memory_pressure ? Math.round(status.memory_pressure * 100) : 0);
  const usageColor = memoryUsage > 80 ? chalk.red : memoryUsage > 50 ? chalk.yellow : chalk.green;
  console.log(`Memory Usage: ${usageColor(memoryUsage + '%')}`);
  console.log('');
}

// Run the example
if (import.meta.url === `file://${process.argv[1]}`) {
  memoryExample();
}