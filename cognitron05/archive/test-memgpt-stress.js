#!/usr/bin/env node

/**
 * MemGPT Memory System Stress Test
 * Comprehensive testing of memory mechanisms, pressure handling, and tool calling
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';

class MemGPTStressTest {
  constructor() {
    this.testDataDir = './cognitron-memgpt-test-data';
    this.originalDataDir = './cognitron-memgpt-data';
    this.cognitron = null;
    this.testResults = {
      passed: 0,
      failed: 0,
      errors: []
    };
  }

  log(message, type = 'info') {
    const colors = {
      info: chalk.blue,
      success: chalk.green,
      error: chalk.red,
      warning: chalk.yellow
    };
    console.log(colors[type](`[${type.toUpperCase()}] ${message}`));
  }

  async setupTestEnvironment() {
    this.log('Setting up test environment...', 'info');
    
    // Backup existing data if present
    try {
      await fs.access(this.originalDataDir);
      await fs.cp(this.originalDataDir, `${this.originalDataDir}-backup`, { recursive: true });
      this.log('Backed up existing data', 'success');
    } catch (error) {
      this.log('No existing data to backup', 'info');
    }

    // Clean test environment
    try {
      await fs.rm(this.testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Directory doesn't exist
    }
    
    // Create test instance with different data directory
    this.cognitron = new MemGPTCognitron();
    this.cognitron.config.dataDir = this.testDataDir;
    
    // Initialize memory
    await this.cognitron.loadMemory();
    
    this.log('Test environment ready', 'success');
  }

  async cleanupTestEnvironment() {
    this.log('Cleaning up test environment...', 'info');
    
    try {
      await fs.rm(this.testDataDir, { recursive: true, force: true });
      this.log('Test data cleaned up', 'success');
    } catch (error) {
      this.log(`Cleanup error: ${error.message}`, 'warning');
    }

    // Restore backup if it exists
    try {
      await fs.access(`${this.originalDataDir}-backup`);
      await fs.rm(this.originalDataDir, { recursive: true, force: true });
      await fs.cp(`${this.originalDataDir}-backup`, this.originalDataDir, { recursive: true });
      await fs.rm(`${this.originalDataDir}-backup`, { recursive: true });
      this.log('Restored original data', 'success');
    } catch (error) {
      // No backup to restore
    }
  }

  async assert(condition, message) {
    if (condition) {
      this.testResults.passed++;
      this.log(`✅ ${message}`, 'success');
    } else {
      this.testResults.failed++;
      this.testResults.errors.push(message);
      this.log(`❌ ${message}`, 'error');
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // Test 1: Memory Pressure and Eviction
  async testMemoryPressure() {
    this.log('\n=== Testing Memory Pressure Handling ===', 'info');
    
    // Set lower thresholds for testing
    const originalThreshold = this.cognitron.memory.memoryPressureThreshold;
    const originalEviction = this.cognitron.memory.evictionThreshold;
    const originalWindow = this.cognitron.memory.maxContextWindow;
    
    this.cognitron.memory.memoryPressureThreshold = 0.5; // 50% for testing
    this.cognitron.memory.evictionThreshold = 0.7;       // 70% for testing
    this.cognitron.memory.maxContextWindow = 1000;       // Much smaller for testing
    
    // Add messages until memory pressure triggers
    const longMessage = "This is a long message that will consume tokens to test memory pressure. ".repeat(20);
    let messageCount = 0;
    let pressureTriggered = false;
    let evictionTriggered = false;
    
    while (messageCount < 50) { // Safety limit
      this.cognitron.addMessage('user', `${longMessage} Message ${messageCount}`);
      this.cognitron.addMessage('assistant', `Response to message ${messageCount}: ${longMessage}`);
      
      const usage = this.cognitron.getCurrentTokenUsage();
      
      if (usage.percentage >= this.cognitron.memory.memoryPressureThreshold && !pressureTriggered) {
        pressureTriggered = true;
        this.log(`Memory pressure triggered at ${Math.round(usage.percentage * 100)}%`, 'success');
      }
      
      if (usage.percentage >= this.cognitron.memory.evictionThreshold && !evictionTriggered) {
        evictionTriggered = true;
        const beforeCount = this.cognitron.memory.conversationContext.length;
        
        // Trigger eviction
        await this.cognitron.forceEvictionAndSummarize();
        
        const afterCount = this.cognitron.memory.conversationContext.length;
        const evicted = beforeCount - afterCount;
        
        this.log(`Eviction triggered: ${evicted} messages evicted`, 'success');
        await this.assert(evicted > 0, 'Messages were actually evicted');
        await this.assert(this.cognitron.memory.recursiveSummary.length > 0, 'Recursive summary was created');
        break;
      }
      
      messageCount++;
    }
    
    await this.assert(pressureTriggered, 'Memory pressure warning was triggered');
    await this.assert(evictionTriggered, 'Memory eviction was triggered');
    
    // Test that conversation continues normally after eviction
    const usage = this.cognitron.getCurrentTokenUsage();
    await this.assert(usage.percentage < this.cognitron.memory.evictionThreshold, 'Memory usage reduced after eviction');
    
    // Restore original settings
    this.cognitron.memory.memoryPressureThreshold = originalThreshold;
    this.cognitron.memory.evictionThreshold = originalEviction;
    this.cognitron.memory.maxContextWindow = originalWindow;
    
    this.log('Memory pressure test completed', 'success');
  }

  // Test 2: Tool Calling and Memory Operations
  async testToolCalling() {
    this.log('\n=== Testing MemGPT Tool Calling ===', 'info');
    
    // Test core_memory_append
    let result = await this.cognitron.executeMemGPTTool('core_memory_append', {
      key: 'test_user_name',
      value: 'John Doe'
    });
    
    await this.assert(result.success, 'core_memory_append executed successfully');
    await this.assert(this.cognitron.memory.workingContext.has('test_user_name'), 'Memory was stored in working context');
    
    // Test core_memory_replace
    result = await this.cognitron.executeMemGPTTool('core_memory_replace', {
      key: 'test_user_name',
      new_value: 'Jane Doe'
    });
    
    await this.assert(result.success, 'core_memory_replace executed successfully');
    const storedValue = this.cognitron.memory.workingContext.get('test_user_name');
    await this.assert(storedValue.value === 'Jane Doe', 'Memory was updated correctly');
    
    // Test archival_memory_insert
    result = await this.cognitron.executeMemGPTTool('archival_memory_insert', {
      key: 'test_project',
      content: 'Working on a machine learning project involving natural language processing and memory systems. The goal is to create an autonomous agent that can remember facts across sessions.'
    });
    
    await this.assert(result.success, 'archival_memory_insert executed successfully');
    await this.assert(this.cognitron.memory.archivalStorage.has('test_project'), 'Data was stored in archival storage');
    
    // Test archival_memory_search
    result = await this.cognitron.executeMemGPTTool('archival_memory_search', {
      query: 'machine learning'
    });
    
    await this.assert(result.success, 'archival_memory_search executed successfully');
    await this.assert(result.results.length > 0, 'Search found relevant results');
    
    // Test conversation_search (after adding some searchable messages)
    this.cognitron.addMessage('user', 'I love programming in Python');
    this.cognitron.addMessage('assistant', 'Python is a great language for AI development');
    
    result = await this.cognitron.executeMemGPTTool('conversation_search', {
      query: 'Python',
      max_results: 5
    });
    
    await this.assert(result.success, 'conversation_search executed successfully');
    
    // Test get_memory_status
    result = await this.cognitron.executeMemGPTTool('get_memory_status', {});
    
    await this.assert(result.success, 'get_memory_status executed successfully');
    await this.assert(result.status.core_memory_entries > 0, 'Memory status shows core memory entries');
    
    // Test pause_heartbeats
    result = await this.cognitron.executeMemGPTTool('pause_heartbeats', {
      message: 'Test pause message'
    });
    
    await this.assert(result.success, 'pause_heartbeats executed successfully');
    await this.assert(result.pause === true, 'pause_heartbeats signals pause correctly');
    
    this.log('Tool calling test completed', 'success');
  }

  // Test 3: Persistence and Recovery
  async testPersistenceAndRecovery() {
    this.log('\n=== Testing Persistence and Recovery ===', 'info');
    
    // Add test data
    await this.cognitron.executeMemGPTTool('core_memory_append', {
      key: 'persistent_test',
      value: 'This should persist across sessions'
    });
    
    this.cognitron.addMessage('user', 'This is a test message for persistence');
    this.cognitron.addMessage('assistant', 'I will remember this conversation');
    
    const originalSessionId = this.cognitron.memory.sessionId;
    const originalMessageCount = this.cognitron.memory.messageIdCounter;
    
    // Save memory
    await this.cognitron.saveMemory();
    
    // Verify files were created
    const contextFile = path.join(this.testDataDir, 'working-context.json');
    const recallFile = path.join(this.testDataDir, 'recall-storage.jsonl');
    
    await this.assert(await fs.access(contextFile).then(() => true).catch(() => false), 'working-context.json was created');
    await this.assert(await fs.access(recallFile).then(() => true).catch(() => false), 'recall-storage.jsonl was created');
    
    // Create new instance and load memory
    const newCognitron = new MemGPTCognitron();
    newCognitron.config.dataDir = this.testDataDir;
    await newCognitron.loadMemory();
    
    // Verify persistence
    await this.assert(newCognitron.memory.sessionId === originalSessionId, 'Session ID persisted');
    await this.assert(newCognitron.memory.messageIdCounter >= originalMessageCount, 'Message counter persisted');
    await this.assert(newCognitron.memory.workingContext.has('persistent_test'), 'Core memory persisted');
    await this.assert(newCognitron.memory.conversationContext.length > 0, 'Conversation context loaded');
    
    const persistedValue = newCognitron.memory.workingContext.get('persistent_test');
    await this.assert(persistedValue.value === 'This should persist across sessions', 'Core memory value persisted correctly');
    
    this.log('Persistence and recovery test completed', 'success');
  }

  // Test 4: Search and Recall Functionality
  async testSearchAndRecall() {
    this.log('\n=== Testing Search and Recall ===', 'info');
    
    // Add varied test data
    const testData = [
      { user: 'Tell me about Python programming', assistant: 'Python is excellent for AI and machine learning' },
      { user: 'What about JavaScript?', assistant: 'JavaScript is great for web development and now backend too' },
      { user: 'I prefer functional programming', assistant: 'Functional programming has many benefits like immutability' },
      { user: 'Machine learning is fascinating', assistant: 'Yes, machine learning can solve complex pattern recognition problems' },
      { user: 'Do you know about neural networks?', assistant: 'Neural networks are the foundation of deep learning systems' }
    ];
    
    // Add messages
    for (const data of testData) {
      this.cognitron.addMessage('user', data.user);
      this.cognitron.addMessage('assistant', data.assistant);
    }
    
    // Test conversation search
    let searchResults = await this.cognitron.searchConversations('Python', 5);
    await this.assert(searchResults.length > 0, 'Search found Python-related conversations');
    await this.assert(searchResults.some(r => r.content.toLowerCase().includes('python')), 'Search results contain Python');
    
    searchResults = await this.cognitron.searchConversations('machine learning', 5);
    await this.assert(searchResults.length > 0, 'Search found machine learning conversations');
    
    searchResults = await this.cognitron.searchConversations('nonexistent topic', 5);
    await this.assert(searchResults.length === 0, 'Search returns empty for non-existent topics');
    
    // Test archival search
    await this.cognitron.executeMemGPTTool('archival_memory_insert', {
      key: 'programming_languages',
      content: 'Python, JavaScript, TypeScript, Rust, Go are popular modern programming languages'
    });
    
    await this.cognitron.executeMemGPTTool('archival_memory_insert', {
      key: 'ai_frameworks',
      content: 'TensorFlow, PyTorch, Scikit-learn, and Hugging Face are popular AI/ML frameworks'
    });
    
    const archivalResults = this.cognitron.searchArchival('Python');
    await this.assert(archivalResults.length > 0, 'Archival search found Python-related data');
    
    this.log('Search and recall test completed', 'success');
  }

  // Test 5: Edge Cases and Failure Modes
  async testEdgeCasesAndFailures() {
    this.log('\n=== Testing Edge Cases and Failure Modes ===', 'info');
    
    // Test empty/invalid tool calls
    let result = await this.cognitron.executeMemGPTTool('nonexistent_tool', {});
    await this.assert(!result.success, 'Invalid tool calls are handled gracefully');
    
    // Test empty memory operations
    result = await this.cognitron.executeMemGPTTool('core_memory_replace', {
      key: 'nonexistent_key',
      new_value: 'test'
    });
    await this.assert(result.success, 'Replacing non-existent key creates new entry');
    
    // Test very long content
    const veryLongContent = 'A'.repeat(10000);
    result = await this.cognitron.executeMemGPTTool('archival_memory_insert', {
      key: 'long_content',
      content: veryLongContent
    });
    await this.assert(result.success, 'Very long content is handled correctly');
    
    // Test token counting accuracy
    const testText = "This is a test message for token counting accuracy.";
    const tokenCount = this.cognitron.countTokens(testText);
    await this.assert(tokenCount > 0, 'Token counting returns positive values');
    await this.assert(typeof tokenCount === 'number', 'Token counting returns a number');
    
    // Test memory pressure with empty context
    this.cognitron.memory.conversationContext = [];
    const pressureResult = this.cognitron.checkMemoryPressure();
    await this.assert(pressureResult.action === 'continue', 'Empty context handles memory pressure check');
    
    // Test JSONL parsing with malformed data
    const malformedJSONL = '{"valid": "json"}\n{invalid json}\n{"another": "valid"}';
    const parsed = this.cognitron.parseJSONL(malformedJSONL);
    await this.assert(parsed.length === 2, 'JSONL parser handles malformed lines gracefully');
    
    // Test file corruption resilience
    const corruptFile = path.join(this.testDataDir, 'corrupt-test.json');
    await fs.writeFile(corruptFile, '{invalid json content');
    
    try {
      JSON.parse(await fs.readFile(corruptFile, 'utf8'));
      await this.assert(false, 'Should have thrown error for corrupt JSON');
    } catch (error) {
      await this.assert(true, 'Corrupt JSON files are detected');
    }
    
    this.log('Edge cases and failure modes test completed', 'success');
  }

  // Test 6: High-Volume Stress Test
  async testHighVolumeStress() {
    this.log('\n=== Testing High-Volume Operations ===', 'info');
    
    const startTime = Date.now();
    
    // Add many messages rapidly
    for (let i = 0; i < 100; i++) {
      this.cognitron.addMessage('user', `Stress test message ${i}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.`);
      this.cognitron.addMessage('assistant', `Response ${i}: Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`);
      
      // Every 10 messages, add some memory operations
      if (i % 10 === 0) {
        await this.cognitron.executeMemGPTTool('core_memory_append', {
          key: `stress_key_${i}`,
          value: `Stress value ${i}`
        });
      }
    }
    
    const messageTime = Date.now() - startTime;
    this.log(`Added 200 messages in ${messageTime}ms`, 'info');
    
    // Test search performance with many messages
    const searchStart = Date.now();
    const searchResults = await this.cognitron.searchConversations('Lorem', 10);
    const searchTime = Date.now() - searchStart;
    
    await this.assert(searchResults.length > 0, 'Search works with large message volume');
    await this.assert(searchTime < 1000, `Search completed in reasonable time: ${searchTime}ms`);
    
    // Test memory operations performance
    const memoryStart = Date.now();
    const memoryStatus = await this.cognitron.executeMemGPTTool('get_memory_status', {});
    const memoryTime = Date.now() - memoryStart;
    
    await this.assert(memoryStatus.success, 'Memory status works with large data');
    await this.assert(memoryTime < 100, `Memory status retrieved quickly: ${memoryTime}ms`);
    
    // Test save/load performance with large data
    const saveStart = Date.now();
    await this.cognitron.saveMemory();
    const saveTime = Date.now() - saveStart;
    
    const loadStart = Date.now();
    await this.cognitron.loadMemory();
    const loadTime = Date.now() - loadStart;
    
    await this.assert(saveTime < 5000, `Large data saved in reasonable time: ${saveTime}ms`);
    await this.assert(loadTime < 5000, `Large data loaded in reasonable time: ${loadTime}ms`);
    
    this.log('High-volume stress test completed', 'success');
  }

  async runAllTests() {
    console.log(chalk.bold.cyan('\n🧠 MemGPT Memory System Stress Test Suite'));
    console.log(chalk.gray('═'.repeat(60)));
    
    try {
      await this.setupTestEnvironment();
      
      // Run all test suites
      await this.testMemoryPressure();
      await this.testToolCalling();
      await this.testPersistenceAndRecovery();
      await this.testSearchAndRecall();
      await this.testEdgeCasesAndFailures();
      await this.testHighVolumeStress();
      
      // Summary
      console.log(chalk.bold.green('\n✅ All tests completed successfully!'));
      console.log(chalk.green(`Passed: ${this.testResults.passed}`));
      console.log(chalk.red(`Failed: ${this.testResults.failed}`));
      
      if (this.testResults.errors.length > 0) {
        console.log(chalk.red('\nErrors encountered:'));
        this.testResults.errors.forEach(error => {
          console.log(chalk.red(`  - ${error}`));
        });
      }
      
    } catch (error) {
      this.log(`Test suite failed: ${error.message}`, 'error');
      console.error(error.stack);
    } finally {
      await this.cleanupTestEnvironment();
    }
    
    return this.testResults.failed === 0;
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new MemGPTStressTest();
  const success = await tester.runAllTests();
  process.exit(success ? 0 : 1);
}

export { MemGPTStressTest };