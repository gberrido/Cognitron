#!/usr/bin/env node

/**
 * MemGPT Load Testing Script
 * Tests performance and stability under sustained load
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';
import fs from 'fs/promises';

class MemGPTLoadTest {
  constructor() {
    this.cognitron = new MemGPTCognitron();
    this.cognitron.config.dataDir = './cognitron-memgpt-load-test-data';
    this.metrics = {
      totalOperations: 0,
      totalTime: 0,
      errors: 0,
      memoryOperations: 0,
      searchOperations: 0,
      evictions: 0
    };
  }

  log(message, type = 'info') {
    const colors = { info: chalk.blue, success: chalk.green, error: chalk.red, warning: chalk.yellow };
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`${chalk.gray(timestamp)} ${colors[type](`[${type.toUpperCase()}]`)} ${message}`);
  }

  async setupLoadTest() {
    this.log('Setting up load test environment...', 'info');
    
    // Clean test environment
    try {
      await fs.rm(this.cognitron.config.dataDir, { recursive: true, force: true });
    } catch (error) {
      // Directory doesn't exist
    }
    
    await this.cognitron.loadMemory();
    this.log('Load test environment ready', 'success');
  }

  async generateTestMessages(count) {
    const messageTemplates = [
      "I'm working on a project about {topic}. It involves {detail} and requires {skill}.",
      "Can you help me understand {topic}? I'm particularly interested in {detail}.",
      "I love {hobby}. My favorite aspect is {detail}. I've been doing it for {duration}.",
      "Today I learned about {topic}. The most interesting part was {detail}.",
      "I'm planning to {action} next {timeframe}. I need to consider {factor}.",
      "My experience with {topic} has been {adjective}. The key insight was {detail}."
    ];

    const topics = ['machine learning', 'web development', 'data science', 'artificial intelligence', 'programming', 'software engineering'];
    const details = ['algorithms', 'frameworks', 'best practices', 'optimization', 'design patterns', 'performance'];
    const skills = ['Python', 'JavaScript', 'problem solving', 'critical thinking', 'communication', 'project management'];
    const hobbies = ['reading', 'cooking', 'photography', 'hiking', 'music', 'gaming'];
    const adjectives = ['challenging', 'rewarding', 'educational', 'inspiring', 'complex', 'fascinating'];
    const actions = ['start a new project', 'learn a new skill', 'change careers', 'travel somewhere', 'build something', 'write a book'];
    const timeframes = ['month', 'year', 'quarter', 'week', 'season', 'decade'];
    const factors = ['budget', 'time', 'resources', 'team size', 'technology', 'market conditions'];
    const durations = ['2 years', '5 years', 'a decade', 'since childhood', 'recently', 'professionally'];

    const messages = [];
    const replacements = { topic: topics, detail: details, skill: skills, hobby: hobbies, 
                          adjective: adjectives, action: actions, timeframe: timeframes, 
                          factor: factors, duration: durations };

    for (let i = 0; i < count; i++) {
      let template = messageTemplates[Math.floor(Math.random() * messageTemplates.length)];
      
      // Replace placeholders
      Object.entries(replacements).forEach(([key, values]) => {
        const regex = new RegExp(`\\{${key}\\}`, 'g');
        template = template.replace(regex, values[Math.floor(Math.random() * values.length)]);
      });
      
      messages.push(template);
    }
    
    return messages;
  }

  async runSingleOperation(message, operationIndex) {
    const startTime = Date.now();
    
    try {
      // Simulate realistic user interaction patterns
      const shouldSearch = Math.random() < 0.1; // 10% chance to ask for recall
      const shouldProvidePersonalInfo = Math.random() < 0.15; // 15% chance to share personal info
      
      let finalMessage = message;
      
      if (shouldSearch && this.metrics.totalOperations > 10) {
        finalMessage = "Earlier we discussed something. Can you recall what we talked about regarding " + 
                      message.split(' ').slice(0, 3).join(' ') + "?";
      } else if (shouldProvidePersonalInfo) {
        const personalFacts = [
          `My name is TestUser${operationIndex % 100}`,
          `I work as a ${['developer', 'designer', 'manager', 'analyst', 'consultant'][operationIndex % 5]}`,
          `I prefer ${['morning', 'evening', 'afternoon'][operationIndex % 3]} work sessions`
        ];
        finalMessage = personalFacts[operationIndex % personalFacts.length] + ". " + message;
      }

      const result = await this.cognitron.generateResponse(finalMessage);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Track metrics
      this.metrics.totalOperations++;
      this.metrics.totalTime += duration;
      
      if (result.toolCalls) {
        for (const toolCall of result.toolCalls) {
          if (['core_memory_append', 'core_memory_replace', 'archival_memory_insert'].includes(toolCall.toolName)) {
            this.metrics.memoryOperations++;
          }
          if (['conversation_search', 'archival_memory_search'].includes(toolCall.toolName)) {
            this.metrics.searchOperations++;
          }
        }
      }
      
      // Check if eviction occurred by monitoring conversation context size changes
      const usage = this.cognitron.getCurrentTokenUsage();
      if (usage.percentage > 0.8) {
        this.metrics.evictions++;
      }
      
      return { success: true, duration, usage: result.usage };
      
    } catch (error) {
      this.metrics.errors++;
      this.log(`Operation ${operationIndex} failed: ${error.message}`, 'error');
      return { success: false, error: error.message };
    }
  }

  async runLoadTest(totalOperations = 100, concurrency = 1) {
    this.log(`Starting load test: ${totalOperations} operations with concurrency ${concurrency}`, 'info');
    
    const testMessages = await this.generateTestMessages(totalOperations);
    const startTime = Date.now();
    
    // Run operations in batches based on concurrency
    for (let i = 0; i < totalOperations; i += concurrency) {
      const batch = [];
      
      for (let j = 0; j < concurrency && (i + j) < totalOperations; j++) {
        const operationIndex = i + j;
        const message = testMessages[operationIndex];
        batch.push(this.runSingleOperation(message, operationIndex));
      }
      
      // Wait for batch to complete
      const results = await Promise.allSettled(batch);
      
      // Log progress every 10 operations
      if ((i + concurrency) % 10 === 0 || (i + concurrency) >= totalOperations) {
        const progress = Math.min(i + concurrency, totalOperations);
        const usage = this.cognitron.getCurrentTokenUsage();
        
        this.log(`Progress: ${progress}/${totalOperations} | ` +
                 `Memory: ${Math.round(usage.percentage * 100)}% | ` +
                 `Errors: ${this.metrics.errors} | ` +
                 `Avg response: ${Math.round(this.metrics.totalTime / this.metrics.totalOperations)}ms`, 'info');
      }
      
      // Small delay between batches to prevent overwhelming
      if (concurrency > 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const totalTime = Date.now() - startTime;
    
    // Final metrics
    this.log(`\nLoad test completed in ${totalTime}ms`, 'success');
    this.displayMetrics(totalTime);
    
    return this.metrics;
  }

  displayMetrics(totalTestTime) {
    console.log(chalk.bold.cyan('\n📊 Load Test Results'));
    console.log(chalk.gray('═'.repeat(50)));
    
    const avgResponseTime = this.metrics.totalTime / this.metrics.totalOperations;
    const operationsPerSecond = (this.metrics.totalOperations / totalTestTime) * 1000;
    const errorRate = (this.metrics.errors / this.metrics.totalOperations) * 100;
    const usage = this.cognitron.getCurrentTokenUsage();
    
    console.log(chalk.white(`Total Operations: ${this.metrics.totalOperations}`));
    console.log(chalk.white(`Total Test Time: ${totalTestTime}ms`));
    console.log(chalk.white(`Average Response Time: ${Math.round(avgResponseTime)}ms`));
    console.log(chalk.white(`Operations/Second: ${operationsPerSecond.toFixed(2)}`));
    console.log(chalk.white(`Error Rate: ${errorRate.toFixed(2)}%`));
    
    console.log(chalk.yellow('\nMemory Operations:'));
    console.log(chalk.yellow(`  Memory Writes: ${this.metrics.memoryOperations}`));
    console.log(chalk.yellow(`  Search Operations: ${this.metrics.searchOperations}`));
    console.log(chalk.yellow(`  Memory Evictions: ${this.metrics.evictions}`));
    
    console.log(chalk.cyan('\nFinal Memory State:'));
    console.log(chalk.cyan(`  Context Usage: ${Math.round(usage.percentage * 100)}% (${usage.total}/${this.cognitron.memory.maxContextWindow} tokens)`));
    console.log(chalk.cyan(`  Core Memories: ${this.cognitron.memory.workingContext.size}`));
    console.log(chalk.cyan(`  Conversation Messages: ${this.cognitron.memory.conversationContext.length}`));
    console.log(chalk.cyan(`  Total Messages Processed: ${this.cognitron.memory.messageIdCounter}`));
    console.log(chalk.cyan(`  Archival Storage Entries: ${this.cognitron.memory.archivalStorage.size}`));
    
    if (this.cognitron.memory.recursiveSummary) {
      console.log(chalk.cyan(`  Has Recursive Summary: Yes (${this.cognitron.memory.recursiveSummary.length} chars)`));
    }
    
    // Performance assessment
    console.log(chalk.bold.green('\n🎯 Performance Assessment:'));
    
    if (avgResponseTime < 2000) {
      console.log(chalk.green('  ✅ Response time: Excellent (< 2s)'));
    } else if (avgResponseTime < 5000) {
      console.log(chalk.yellow('  ⚠️  Response time: Acceptable (2-5s)'));
    } else {
      console.log(chalk.red('  ❌ Response time: Poor (> 5s)'));
    }
    
    if (errorRate < 1) {
      console.log(chalk.green('  ✅ Error rate: Excellent (< 1%)'));
    } else if (errorRate < 5) {
      console.log(chalk.yellow('  ⚠️  Error rate: Acceptable (1-5%)'));
    } else {
      console.log(chalk.red('  ❌ Error rate: Poor (> 5%)'));
    }
    
    if (this.metrics.memoryOperations > this.metrics.totalOperations * 0.1) {
      console.log(chalk.green('  ✅ Memory usage: Active memory management'));
    } else {
      console.log(chalk.yellow('  ⚠️  Memory usage: Low memory activity'));
    }
    
    if (this.metrics.evictions > 0) {
      console.log(chalk.green('  ✅ Memory pressure: Handling evictions correctly'));
    } else {
      console.log(chalk.gray('  ℹ️  Memory pressure: No evictions needed'));
    }
  }

  async runMemoryStressTest() {
    this.log('Running memory-focused stress test...', 'info');
    
    // Force memory pressure by using smaller context window
    const originalWindow = this.cognitron.memory.maxContextWindow;
    const originalThreshold = this.cognitron.memory.memoryPressureThreshold;
    
    this.cognitron.memory.maxContextWindow = 2000;  // Much smaller
    this.cognitron.memory.memoryPressureThreshold = 0.5; // Earlier warning
    
    const longMessages = await this.generateTestMessages(50);
    const extendedMessages = longMessages.map(msg => msg + " " + "Additional context information. ".repeat(10));
    
    for (let i = 0; i < extendedMessages.length; i++) {
      await this.runSingleOperation(extendedMessages[i], i);
      
      if (i % 5 === 0) {
        const usage = this.cognitron.getCurrentTokenUsage();
        this.log(`Memory stress test progress: ${i}/50 | Memory: ${Math.round(usage.percentage * 100)}%`, 'info');
      }
    }
    
    // Restore original settings
    this.cognitron.memory.maxContextWindow = originalWindow;
    this.cognitron.memory.memoryPressureThreshold = originalThreshold;
    
    this.log('Memory stress test completed', 'success');
  }

  async cleanup() {
    this.log('Cleaning up test data...', 'info');
    try {
      await fs.rm(this.cognitron.config.dataDir, { recursive: true, force: true });
      this.log('Cleanup completed', 'success');
    } catch (error) {
      this.log(`Cleanup error: ${error.message}`, 'warning');
    }
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const operations = parseInt(args[0]) || 50;
  const concurrency = parseInt(args[1]) || 1;
  
  console.log(chalk.bold.cyan('🚀 MemGPT Load Testing Suite'));
  console.log(chalk.gray(`Testing with ${operations} operations, concurrency ${concurrency}\n`));
  
  const tester = new MemGPTLoadTest();
  
  try {
    await tester.setupLoadTest();
    await tester.runLoadTest(operations, concurrency);
    await tester.runMemoryStressTest();
    
    console.log(chalk.bold.green('\n✅ Load testing completed successfully!'));
    
  } catch (error) {
    console.error(chalk.red(`Load test failed: ${error.message}`));
    console.error(error.stack);
    process.exit(1);
  } finally {
    await tester.cleanup();
  }
}

export { MemGPTLoadTest };