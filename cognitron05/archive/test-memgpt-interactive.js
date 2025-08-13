#!/usr/bin/env node

/**
 * Interactive MemGPT Validation Script
 * Tests real-world scenarios with user interaction
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import readline from 'readline';
import chalk from 'chalk';

class InteractiveMemGPTValidator {
  constructor() {
    this.cognitron = new MemGPTCognitron();
    this.cognitron.config.dataDir = './cognitron-memgpt-validation-data';
    this.testScenarios = [];
    this.currentScenario = 0;
  }

  async setupValidationScenarios() {
    this.testScenarios = [
      {
        name: "Memory Storage and Recall",
        description: "Test if AI stores and recalls personal information correctly",
        instructions: [
          "1. Tell the AI your name, age, and favorite hobby",
          "2. Have a conversation about something else for a few messages", 
          "3. Ask the AI to recall what you told them about yourself",
          "4. Verify the AI remembers and uses core_memory tools"
        ],
        expected: "AI should autonomously store your info and recall it accurately"
      },
      {
        name: "Memory Pressure Handling",
        description: "Test memory eviction and summarization under pressure",
        instructions: [
          "1. Engage in a very long conversation (20+ back-and-forth messages)",
          "2. Include important facts spread throughout the conversation",
          "3. Watch for memory pressure warnings in the output",
          "4. Continue until eviction occurs",
          "5. Ask AI to recall earlier parts of conversation"
        ],
        expected: "AI should warn about memory pressure, evict old messages, create summaries, and still recall key facts"
      },
      {
        name: "Search and Reference Previous Conversations",
        description: "Test conversation search when referencing past discussions",
        instructions: [
          "1. Discuss a specific topic (e.g., 'machine learning projects')",
          "2. End conversation and restart the system",
          "3. Reference the previous conversation (e.g., 'remember when we talked about machine learning?')",
          "4. Verify AI searches and finds relevant information"
        ],
        expected: "AI should autonomously search conversation history and reference previous discussions"
      },
      {
        name: "Heartbeat Mechanism Validation",
        description: "Test that AI chains multiple tool calls before responding",
        instructions: [
          "1. Introduce yourself with multiple facts (name, job, interests, preferences)",
          "2. Watch the 'MemGPT Memory Operations' output",
          "3. Verify multiple core_memory_append calls happen before AI responds",
          "4. Check that final response acknowledges all the facts you shared"
        ],
        expected: "AI should make multiple tool calls in sequence, then pause_heartbeats with comprehensive response"
      },
      {
        name: "Session Persistence",
        description: "Test memory persistence across system restarts",
        instructions: [
          "1. Have conversation and share personal information",
          "2. Exit the system cleanly with /exit",
          "3. Restart the system",
          "4. Verify AI remembers previous conversation and personal facts",
          "5. Reference something from the previous session"
        ],
        expected: "AI should resume with all memory intact and reference previous session naturally"
      },
      {
        name: "Complex Information Storage",
        description: "Test archival memory for complex structured information",
        instructions: [
          "1. Share complex information (e.g., project details, plans, structured data)",
          "2. Ask AI to store this for future reference",
          "3. Later, ask AI to retrieve and summarize the stored information",
          "4. Verify AI uses archival_memory_insert and archival_memory_search"
        ],
        expected: "AI should store complex information in archival memory and retrieve it accurately when requested"
      }
    ];
  }

  async displayScenario(scenarioIndex) {
    const scenario = this.testScenarios[scenarioIndex];
    console.clear();
    
    console.log(chalk.bold.cyan(`\n🧪 MemGPT Validation Test ${scenarioIndex + 1}/${this.testScenarios.length}`));
    console.log(chalk.bold.yellow(`${scenario.name}`));
    console.log(chalk.gray('═'.repeat(60)));
    
    console.log(chalk.white(`\nDescription: ${scenario.description}`));
    console.log(chalk.white('\nTest Instructions:'));
    scenario.instructions.forEach(instruction => {
      console.log(chalk.cyan(`  ${instruction}`));
    });
    
    console.log(chalk.green(`\nExpected Behavior:`));
    console.log(chalk.green(`  ${scenario.expected}`));
    
    console.log(chalk.yellow('\nKey Things to Watch For:'));
    console.log(chalk.yellow('  • 🧠 MemGPT Memory Operations section'));
    console.log(chalk.yellow('  • ✅ Tool calls (core_memory_append, conversation_search, etc.)'));
    console.log(chalk.yellow('  • 📊 Token usage and heartbeat information'));
    console.log(chalk.yellow('  • ⚠️ Memory pressure warnings'));
    
    console.log(chalk.gray('\nPress ENTER to start this test, or type "skip" to move to next test...'));
  }

  async runInteractiveValidation() {
    console.log(chalk.bold.cyan('🧠 MemGPT Interactive Validation Suite'));
    console.log(chalk.gray('This will test real-world MemGPT functionality with guided scenarios\n'));
    
    await this.setupValidationScenarios();
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    for (let i = 0; i < this.testScenarios.length; i++) {
      await this.displayScenario(i);
      
      const startTest = await new Promise(resolve => {
        rl.question('', (answer) => {
          resolve(answer.trim().toLowerCase() !== 'skip');
        });
      });
      
      if (!startTest) {
        console.log(chalk.yellow('Skipping this test...\n'));
        continue;
      }
      
      console.log(chalk.green('\nStarting MemGPT system for this test...\n'));
      
      // Initialize fresh cognitron instance for each test
      this.cognitron = new MemGPTCognitron();
      this.cognitron.config.dataDir = './cognitron-memgpt-validation-data';
      
      // Load any existing memory
      await this.cognitron.loadMemory();
      
      console.log(chalk.bold.green('✅ MemGPT system ready! Begin the test scenario.'));
      console.log(chalk.gray('Type /next when ready to move to next test, or /exit to quit\n'));
      
      // Start interactive session for this test
      await this.runTestSession(rl, i);
    }
    
    console.log(chalk.bold.green('\n🎉 All validation tests completed!'));
    console.log(chalk.cyan('Review the results to ensure MemGPT is working as expected.'));
    
    rl.close();
  }

  async runTestSession(rl, scenarioIndex) {
    return new Promise((resolve) => {
      const promptUser = () => {
        rl.question(chalk.cyan('> '), async (input) => {
          const trimmedInput = input.trim();
          
          if (trimmedInput === '/next') {
            console.log(chalk.green('\nMoving to next test...\n'));
            await this.cognitron.saveMemory();
            resolve();
            return;
          }
          
          if (trimmedInput === '/exit') {
            await this.cognitron.saveMemory();
            process.exit(0);
          }
          
          if (trimmedInput.startsWith('/')) {
            const result = await this.cognitron.handleCommand(trimmedInput);
            if (result === 'exit') {
              process.exit(0);
            }
          } else if (trimmedInput) {
            console.log(chalk.gray('🤖 Processing with MemGPT...'));
            const result = await this.cognitron.generateResponse(trimmedInput);
            
            // Display detailed output for validation
            this.displayValidationOutput(result);
          }
          
          promptUser();
        });
      };
      
      promptUser();
    });
  }

  displayValidationOutput(result) {
    // Display tool calls with detailed analysis
    if (result.toolCalls && result.toolCalls.length > 0) {
      console.log(chalk.bold.yellow('\n🧠 MemGPT Memory Operations (VALIDATION):'));
      
      let hasMemoryOperation = false;
      let hasSearch = false;
      let hasPauseHeartbeats = false;
      
      for (const { toolName, args, result: toolResult } of result.toolCalls) {
        if (toolResult.success) {
          console.log(chalk.green(`   ✅ ${toolName}(${JSON.stringify(args).substring(0, 100)})`));
          console.log(chalk.gray(`      → ${toolResult.message}`));
          
          // Analyze tool usage patterns
          if (['core_memory_append', 'core_memory_replace'].includes(toolName)) {
            hasMemoryOperation = true;
          }
          if (['conversation_search', 'archival_memory_search'].includes(toolName)) {
            hasSearch = true;
          }
          if (toolName === 'pause_heartbeats') {
            hasPauseHeartbeats = true;
          }
        } else {
          console.log(chalk.red(`   ❌ ${toolName}: ${toolResult.message}`));
        }
      }
      
      // Validation indicators
      console.log(chalk.bold.cyan('\n📊 VALIDATION INDICATORS:'));
      console.log(hasMemoryOperation ? 
        chalk.green('   ✅ Memory operations detected (storing/updating facts)') : 
        chalk.yellow('   ⚠️  No memory operations (might be expected for this interaction)'));
      
      console.log(hasSearch ? 
        chalk.green('   ✅ Search operations detected (recalling information)') : 
        chalk.gray('   ℹ️  No search operations (not needed for this interaction)'));
      
      console.log(hasPauseHeartbeats ? 
        chalk.green('   ✅ Proper heartbeat mechanism (ended with pause_heartbeats)') : 
        chalk.red('   ❌ Missing pause_heartbeats (this should always happen)'));
      
      console.log('');
    }
    
    // Display AI response
    if (result.content) {
      console.log(chalk.white(result.content));
    }
    
    // Display performance metrics
    if (result.usage) {
      const { prompt_tokens, completion_tokens, total_tokens } = result.usage;
      const heartbeatInfo = result.heartbeats ? ` | ${result.heartbeats} heartbeats` : '';
      console.log(chalk.gray(`\n📊 Performance: ${total_tokens} tokens (${prompt_tokens} + ${completion_tokens})${heartbeatInfo}`));
    }
    
    // Display memory status
    const usage = this.cognitron.getCurrentTokenUsage();
    const memoryWarning = usage.percentage > 0.7 ? 
      chalk.red(`⚠️ HIGH MEMORY USAGE: ${Math.round(usage.percentage * 100)}%`) :
      chalk.gray(`Memory: ${Math.round(usage.percentage * 100)}%`);
    
    console.log(chalk.gray(`🧠 Context: ${usage.total}/${this.cognitron.memory.maxContextWindow} tokens | `) + memoryWarning);
    console.log(chalk.gray(`💾 Core memories: ${this.cognitron.memory.workingContext.size} | Messages: ${this.cognitron.memory.conversationContext.length}`));
    
    console.log('');
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const validator = new InteractiveMemGPTValidator();
  await validator.runInteractiveValidation();
}

export { InteractiveMemGPTValidator };