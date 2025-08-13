#!/usr/bin/env node

/**
 * Cognitron05 - AI Assistant with MemGPT-Inspired Stateful Memory
 * Features persistent conversations that resume exactly where you left off
 */

import { Command } from 'commander';
import readline from 'readline';
import process from 'process';

// MemGPT-inspired modules
import { MemGPTMemorySystem } from './modules/memory/MemGPTMemorySystem.js';
import { MemGPTToolManager } from './modules/tools/MemGPTToolManager.js';
import { ChatAgent } from './modules/agent/ChatAgent.js';
import { ResponseProcessor } from './modules/agent/ResponseProcessor.js';
import { InputValidator } from './modules/utils/InputValidator.js';
import { createCommandRegistry } from './modules/commands/index.js';
import { ErrorBoundary } from './modules/utils/ErrorBoundary.js';
import { CHAT_AGENT_CONSTANTS, APPLICATION_CONSTANTS, ConfigValidator } from './modules/config/SystemConstants.js';

class Cognitron05 {
  constructor() {
    this.config = {
      apiKey: this.getRequiredApiKey(),
      model: CHAT_AGENT_CONSTANTS.DEFAULT_MODEL,
      temperature: CHAT_AGENT_CONSTANTS.DEFAULT_TEMPERATURE,
      maxTokens: CHAT_AGENT_CONSTANTS.DEFAULT_MAX_TOKENS,
      reasoningLevel: CHAT_AGENT_CONSTANTS.REASONING_LEVELS.LOW,
      showUsage: false,
      memoryEnabled: true
    };

    // Initialize MemGPT components
    this.memorySystem = null;
    this.toolManager = null;
    this.chatAgent = null;
    this.responseProcessor = null;
    this.commandRegistry = null;
    this.rl = null;
    this.errorBoundary = null;
    
    this.isRunning = false;
  }

  /**
   * Get API key from environment variables with proper error handling
   * @returns {string} The API key
   * @throws {Error} If API key is not found in environment variables
   */
  getRequiredApiKey() {
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey || apiKey.trim() === '') {
      throw new Error(
        'GROQ_API_KEY environment variable is required but not found.\n' +
        'Please set your Groq API key:\n' +
        '  export GROQ_API_KEY="your-api-key-here"\n' +
        'Or create a .env file with:\n' +
        '  GROQ_API_KEY=your-api-key-here'
      );
    }
    
    return apiKey.trim();
  }

  /**
   * Initialize all MemGPT components
   */
  async initialize() {
    // Initialize error boundary first
    this.errorBoundary = new ErrorBoundary({
      enableLogging: true,
      logFile: 'cognitron05-errors.log',
      maxRetries: 3,
      retryDelay: APPLICATION_CONSTANTS.RETRY_DELAY,
      gracefulShutdown: true,
      onShutdown: () => this.cleanup()
    });
    
    try {
      console.log('🧠 Initializing Cognitron05 with MemGPT Memory...');

      // Initialize MemGPT Memory System
      this.memorySystem = new MemGPTMemorySystem({
        enabled: this.config.memoryEnabled,
        dataDir: './cognitron05-data'
      });
      await this.memorySystem.initialize();

      // Initialize MemGPT Tool Manager
      this.toolManager = new MemGPTToolManager(this.memorySystem);

      // Initialize Chat Agent with MemGPT integration
      this.chatAgent = new ChatAgent(this.config, this.memorySystem, this.toolManager);

      // Initialize Response Processor with MemGPT enhancements
      this.responseProcessor = new ResponseProcessor({
        showMemoryOperations: true,
        showMemoryStatus: true,
        colors: true
      });

      // Initialize Command Registry with all commands
      this.commandRegistry = createCommandRegistry();

      // Error boundary handles shutdown, but we need to register cleanup
      // The ErrorBoundary is already configured to call this.cleanup() on shutdown

      console.log('✅ Cognitron05 initialized successfully');
      
    } catch (error) {
      // Use error boundary for initialization errors
      if (this.errorBoundary) {
        const result = await this.errorBoundary.handleError(error, { 
          operation: 'initialization',
          component: 'cognitron05'
        });
        
        if (!result.shouldContinue) {
          console.error('❌ Failed to initialize Cognitron05:', result.userMessage);
          process.exit(1);
        }
      }
      
      console.error('❌ Failed to initialize Cognitron05:', error.message);
      process.exit(1);
    }
  }

  /**
   * Cleanup resources (called by ErrorBoundary on shutdown)
   */
  async cleanup() {
    console.log('🔄 Cleaning up Cognitron05 resources...');
    
    try {
      if (this.rl) {
        this.rl.close();
      }
      
      if (this.memorySystem) {
        await this.memorySystem.cleanup();
      }
      
      console.log('✅ Cleanup completed successfully');
    } catch (error) {
      console.error('❌ Error during cleanup:', error.message);
    }
  }

  /**
   * Start interactive chat session
   */
  async startChat(options = {}) {
    await this.initialize();

    // Update config with command line options
    Object.assign(this.config, options);
    this.chatAgent.updateConfig(this.config);

    // Display welcome with memory status
    const memoryStatus = this.memorySystem.getStatus();
    this.responseProcessor.displayWelcome(memoryStatus);

    // Check if this is a resumed session
    if (memoryStatus.recallStorageSize > 0) {
      this.responseProcessor.displaySuccess(`Session resumed with ${memoryStatus.recallStorageSize} previous messages`);
    }

    // Start interactive loop
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.config.colors !== false ? '\x1b[36m> \x1b[0m' : '> '
    });

    this.isRunning = true;
    this.rl.prompt();

    this.rl.on('line', async (input) => {
      if (!this.isRunning) return;

      const message = input.trim();
      if (!message) {
        this.rl.prompt();
        return;
      }

      await this.processUserInput(message);

      this.rl.prompt();
    });

    this.rl.on('close', async () => {
      await this.saveAndExit();
    });
  }

  /**
   * Process user input with comprehensive error handling
   * @param {string} message - User input message
   */
  async processUserInput(message) {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      try {
        // Handle special commands
        if (message.startsWith('/')) {
          const handled = await this.handleCommand(message);
          if (handled) {
            return;
          }
        }

        // Show typing indicator
        await this.responseProcessor.showTyping(CHAT_AGENT_CONSTANTS.TYPING_DELAY);

        // Generate response with error boundary protection
        const response = await this.generateResponseWithRetry(message, attempt);

        // Display response
        await this.responseProcessor.displayResponse(response, {
          showUsage: this.config.showUsage,
          showMemoryStatus: this.config.showMemoryStatus
        });

        // Check memory pressure
        const memoryPressure = this.memorySystem.checkMemoryPressure();
        if (memoryPressure.warning) {
          this.responseProcessor.displayMemoryPressureWarning(memoryPressure);
        }
        
        return; // Success, exit retry loop

      } catch (error) {
        const result = await this.errorBoundary.handleError(error, {
          operation: 'user_input_processing',
          message: message,
          retryAttempt: attempt,
          maxRetries: maxRetries
        });

        if (result.shouldContinue && result.recovery.action === 'retry' && attempt < maxRetries - 1) {
          attempt++;
          this.responseProcessor.displayInfo(`${result.userMessage} (attempt ${attempt + 1}/${maxRetries})`);
          continue;
        } else if (result.shouldContinue) {
          // Handle with fallback response
          this.responseProcessor.displayError(new Error(result.userMessage));
          return;
        } else {
          // Critical error, should not continue
          this.responseProcessor.displayError(new Error(result.userMessage));
          await this.saveAndExit();
          return;
        }
      }
    }
  }

  /**
   * Generate response with retry capability
   * @param {string} message - User message
   * @param {number} attempt - Current attempt number
   * @returns {Promise<Object>} Response object
   */
  async generateResponseWithRetry(message, attempt) {
    try {
      return await this.chatAgent.generateResponse(message, this.config);
    } catch (error) {
      // Add attempt context to error
      error.retryAttempt = attempt;
      throw error;
    }
  }

  /**
   * Handle special commands with error boundary protection
   */
  async handleCommand(command) {
    try {
      return await this.executeCommand(command);
    } catch (error) {
      const result = await this.errorBoundary.handleError(error, {
        operation: 'command_execution',
        command: command
      });
      
      if (result.shouldContinue) {
        this.responseProcessor.displayError(new Error(result.userMessage));
        return true; // Command was handled (even if it failed)
      } else {
        // Critical error in command execution
        this.responseProcessor.displayError(new Error(`Critical command error: ${result.userMessage}`));
        return false;
      }
    }
  }

  /**
   * Execute command logic
   */
  async executeCommand(command) {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    // Create execution context for command handlers
    const context = {
      // Core systems
      memorySystem: this.memorySystem,
      chatAgent: this.chatAgent,
      responseProcessor: this.responseProcessor,
      commandRegistry: this.commandRegistry,
      config: this.config,
      rl: this.rl,
      
      // Utility methods that command handlers need
      displayStatus: this.displayStatus.bind(this),
      displayMemoryDetails: this.displayMemoryDetails.bind(this),
      searchHistory: this.searchHistory.bind(this),
      recallArchival: this.recallArchival.bind(this),
      clearSession: this.clearSession.bind(this),
      resetAllMemory: this.resetAllMemory.bind(this),
      saveAndExit: this.saveAndExit.bind(this),
      listSessions: this.listSessions.bind(this)
    };

    // Use command registry to execute the command
    return await this.commandRegistry.execute(cmd, args, context);
  }

  /**
   * DEPRECATED: Legacy command handling - kept for reference
   * This method has been replaced by the modular command system
   */
  async handleCommandLegacy(command) {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
        this.responseProcessor.displayHelp();
        return true;

      case 'status':
        await this.displayStatus();
        return true;

      case 'memory':
        await this.displayMemoryDetails();
        return true;

      case 'search':
        // Validate arguments count
        const searchArgsValidation = InputValidator.validateCommandArgs(args, {
          minArgs: 1,
          maxArgs: Infinity, // Allow multiple words
          requiredArgs: 1
        });
        
        if (!searchArgsValidation.valid) {
          this.responseProcessor.displayError(
            InputValidator.createValidationError(
              `Search command error: ${searchArgsValidation.error}. Usage: /search <query>`,
              searchArgsValidation.code
            )
          );
          return true;
        }

        const rawQuery = args.join(' ');
        await this.searchHistory(rawQuery);
        return true;

      case 'recall':
        // Validate arguments count
        const recallArgsValidation = InputValidator.validateCommandArgs(args, {
          minArgs: 1,
          maxArgs: Infinity, // Allow multiple words
          requiredArgs: 1
        });
        
        if (!recallArgsValidation.valid) {
          this.responseProcessor.displayError(
            InputValidator.createValidationError(
              `Recall command error: ${recallArgsValidation.error}. Usage: /recall <topic>`,
              recallArgsValidation.code
            )
          );
          return true;
        }

        const rawTopic = args.join(' ');
        await this.recallArchival(rawTopic);
        return true;

      case 'clear':
        await this.clearSession();
        return true;

      case 'reset':
        const confirmed = await this.responseProcessor.confirmAction(
          'This will permanently delete all memory (working context, archival storage, etc.). Continue?',
          false
        );
        if (confirmed) {
          await this.resetAllMemory();
        }
        return true;

      case 'temperature':
        // Validate arguments count
        const argsValidation = InputValidator.validateCommandArgs(args, {
          minArgs: 1,
          maxArgs: 1,
          requiredArgs: 1
        });
        
        if (!argsValidation.valid) {
          this.responseProcessor.displayError(
            InputValidator.createValidationError(
              `Temperature command error: ${argsValidation.error}. Usage: /temperature <0.0-2.0>`,
              argsValidation.code
            )
          );
          return true;
        }

        // Validate temperature value
        const tempValidation = InputValidator.validateTemperature(args[0]);
        
        if (!tempValidation.valid) {
          this.responseProcessor.displayError(
            InputValidator.createValidationError(tempValidation.error, tempValidation.code)
          );
          return true;
        }

        // Apply validated temperature
        this.config.temperature = tempValidation.normalized;
        this.chatAgent.updateConfig(this.config);
        this.responseProcessor.displaySuccess(
          `Temperature set to ${tempValidation.normalized} (was: ${tempValidation.value})`
        );
        return true;

      case 'reasoning':
        // Validate arguments count
        const reasoningArgsValidation = InputValidator.validateCommandArgs(args, {
          minArgs: 1,
          maxArgs: 1,
          requiredArgs: 1
        });
        
        if (!reasoningArgsValidation.valid) {
          this.responseProcessor.displayError(
            InputValidator.createValidationError(
              `Reasoning command error: ${reasoningArgsValidation.error}. Usage: /reasoning <low|medium|high>`,
              reasoningArgsValidation.code
            )
          );
          return true;
        }

        // Validate reasoning level value
        const reasoningValidation = InputValidator.validateReasoningLevel(args[0]);
        
        if (!reasoningValidation.valid) {
          this.responseProcessor.displayError(
            InputValidator.createValidationError(reasoningValidation.error, reasoningValidation.code)
          );
          return true;
        }

        // Apply validated reasoning level
        const oldLevel = this.config.reasoningLevel;
        this.config.reasoningLevel = reasoningValidation.normalized;
        this.chatAgent.updateConfig(this.config);
        this.responseProcessor.displaySuccess(
          `Reasoning level changed from ${oldLevel} to ${reasoningValidation.normalized}`
        );
        return true;

      case 'save':
        await this.memorySystem.cleanup();
        this.responseProcessor.displaySuccess('Memory state saved');
        return true;

      case 'sessions':
        await this.listSessions();
        return true;

      case 'exit':
      case 'quit':
        await this.saveAndExit();
        return true;

      default:
        return false; // Command not handled
    }
  } // End of handleCommandLegacy - DEPRECATED

  /**
   * Display system and memory status
   */
  async displayStatus() {
    const agentStatus = this.chatAgent.getStatus();
    const memoryStatus = this.memorySystem.getStatus();

    this.responseProcessor.print(this.responseProcessor.colorize('\n📊 System Status:', 'bright'));
    this.responseProcessor.print('═'.repeat(30));
    
    this.responseProcessor.print(`Model: ${agentStatus.model}`);
    this.responseProcessor.print(`Temperature: ${agentStatus.temperature}`);
    this.responseProcessor.print(`Reasoning Level: ${agentStatus.reasoningLevel}`);
    this.responseProcessor.print(`Available Tools: ${agentStatus.availableTools}`);
    
    this.responseProcessor.displayMemoryStatus(memoryStatus);
  }

  /**
   * Display detailed memory information
   */
  async displayMemoryDetails() {
    const status = this.memorySystem.getStatus();
    const pressure = this.memorySystem.checkMemoryPressure();

    this.responseProcessor.print(this.responseProcessor.colorize('\n🧠 MemGPT Memory System:', 'bright'));
    this.responseProcessor.print('═'.repeat(40));
    
    this.responseProcessor.print(`Session ID: ${status.sessionId}`);
    this.responseProcessor.print(`Working Context: ${status.workingContextSize} entries`);
    
    // Display working context contents
    if (status.workingContextSize > 0) {
      const contextSummary = this.memorySystem.getWorkingContextSummary();
      this.responseProcessor.print(this.responseProcessor.colorize('\nWorking Context Contents:', 'cyan'));
      this.responseProcessor.print(contextSummary);
    }

    this.responseProcessor.print(`\nConversation Queue: ${status.fifoQueueLength} messages`);
    this.responseProcessor.print(`Recall Storage: ${status.recallStorageSize} total messages`);
    this.responseProcessor.print(`Archival Storage: ${status.archivalStorageSize} entries`);
    
    this.responseProcessor.print(`\nMemory Usage: ${pressure.usage}% of context window`);
    if (pressure.warning) {
      this.responseProcessor.displayMemoryPressureWarning(pressure);
    }
  }

  /**
   * Search conversation history with input validation
   */
  async searchHistory(query) {
    // Validate and sanitize the search query
    const queryValidation = InputValidator.validateSearchQuery(query);
    
    if (!queryValidation.valid) {
      this.responseProcessor.displayError(
        InputValidator.createValidationError(
          `Search query error: ${queryValidation.error}`,
          queryValidation.code
        )
      );
      return;
    }

    try {
      // Use the sanitized query for search
      const results = this.memorySystem.searchRecallStorage(queryValidation.normalized, { maxResults: 5 });
      
      // Display results with original query for user reference
      this.responseProcessor.displaySearchResults(results, queryValidation.normalized);
      
      // Log successful search for security monitoring
      if (process.env.DEBUG) {
        console.log(`[SECURITY] Search query validated and executed: "${queryValidation.normalized}" (original: "${query}")`);
      }
    } catch (error) {
      this.responseProcessor.displayError(
        InputValidator.createValidationError(
          `Search execution failed: ${error.message}`,
          'SEARCH_EXECUTION_ERROR'
        )
      );
    }
  }

  /**
   * Recall from archival memory with input validation
   */
  async recallArchival(query) {
    // Validate and sanitize the search query
    const queryValidation = InputValidator.validateSearchQuery(query);
    
    if (!queryValidation.valid) {
      this.responseProcessor.displayError(
        InputValidator.createValidationError(
          `Recall query error: ${queryValidation.error}`,
          queryValidation.code
        )
      );
      return;
    }

    try {
      // Use the sanitized query for archival search
      const results = this.memorySystem.searchArchival(queryValidation.normalized);
      
      if (results.length === 0) {
        this.responseProcessor.print(this.responseProcessor.colorize(`No archival data found for: "${queryValidation.normalized}"`, 'yellow'));
        return;
      }

      this.responseProcessor.print(this.responseProcessor.colorize(`\n🗃️ Archival Memory for "${queryValidation.normalized}":`, 'bright'));
      this.responseProcessor.print('═'.repeat(50));
      
      results.forEach((result, index) => {
        this.responseProcessor.print(`${index + 1}. ${this.responseProcessor.colorize(result.key, 'cyan')}`);
        const data = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        this.responseProcessor.print(`   ${data}`);
        this.responseProcessor.print(this.responseProcessor.colorize(`   Stored: ${new Date(result.metadata.stored).toLocaleString()}`, 'dim'));
        this.responseProcessor.print('');
      });

      // Log successful recall for security monitoring
      if (process.env.DEBUG) {
        console.log(`[SECURITY] Archival recall query validated and executed: "${queryValidation.normalized}" (original: "${query}")`);
      }
    } catch (error) {
      this.responseProcessor.displayError(
        InputValidator.createValidationError(
          `Archival recall failed: ${error.message}`,
          'RECALL_EXECUTION_ERROR'
        )
      );
    }
  }

  /**
   * Clear current session (keep persistent memory)
   */
  async clearSession() {
    this.memorySystem.fifoQueue = [];
    this.responseProcessor.displaySuccess('Current session cleared (persistent memory retained)');
  }

  /**
   * Reset all memory
   */
  async resetAllMemory() {
    this.memorySystem.workingContext.clear();
    this.memorySystem.fifoQueue = [];
    this.memorySystem.recallStorage = [];
    this.memorySystem.archivalStorage.clear();
    this.memorySystem.recursiveSummary = '';
    
    await this.memorySystem.cleanup();
    this.responseProcessor.displaySuccess('All memory has been reset');
  }

  /**
   * List previous sessions
   */
  async listSessions() {
    // Group recall storage by session
    const sessions = new Map();
    
    this.memorySystem.recallStorage.forEach(message => {
      if (!sessions.has(message.sessionId)) {
        sessions.set(message.sessionId, {
          id: message.sessionId,
          start: message.timestamp,
          end: message.timestamp,
          messageCount: 0
        });
      }
      
      const session = sessions.get(message.sessionId);
      session.messageCount++;
      session.end = message.timestamp;
    });

    if (sessions.size === 0) {
      this.responseProcessor.print('No previous sessions found.');
      return;
    }

    this.responseProcessor.print(this.responseProcessor.colorize('\n📚 Previous Sessions:', 'bright'));
    this.responseProcessor.print('═'.repeat(40));
    
    Array.from(sessions.values())
      .sort((a, b) => new Date(b.start) - new Date(a.start))
      .forEach((session, index) => {
        const start = new Date(session.start).toLocaleString();
        const current = session.id === this.memorySystem.currentSessionId ? ' (current)' : '';
        
        this.responseProcessor.print(`${index + 1}. ${session.id}${current}`);
        this.responseProcessor.print(`   Started: ${start}`);
        this.responseProcessor.print(`   Messages: ${session.messageCount}`);
        this.responseProcessor.print('');
      });
  }

  /**
   * Save state and exit
   */
  async saveAndExit() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    console.log('\n💾 Saving memory state...');
    
    try {
      if (this.memorySystem) {
        await this.memorySystem.cleanup();
      }
      
      if (this.responseProcessor) {
        this.responseProcessor.cleanup();
      }
      
      if (this.rl) {
        this.rl.close();
      }
      
      console.log('✅ Memory saved. Conversation will resume exactly where you left off next time.');
      console.log('👋 Goodbye!');
      
    } catch (error) {
      console.error('❌ Error saving state:', error.message);
    }
    
    process.exit(0);
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.responseProcessor) {
      this.responseProcessor.cleanup();
    }
  }
}

// Export for testing
export { Cognitron05 };

// CLI Setup
const program = new Command();

program
  .name('cognitron05')
  .description('AI Assistant with MemGPT-inspired stateful memory')
  .version('1.0.0');

program
  .command('chat')
  .description('Start interactive chat with stateful memory')
  .option('-t, --temperature <number>', 'set temperature (0.0-2.0)', parseFloat)
  .option('-r, --reasoning <level>', 'set reasoning level (low/medium/high)')
  .option('--no-memory', 'disable memory system')
  .option('--show-usage', 'show token usage information')
  .option('--no-colors', 'disable colored output')
  .option('--debug', 'enable debug mode')
  .action(async (options) => {
    const cognitron = new Cognitron05();
    try {
      await cognitron.startChat(options);
    } catch (error) {
      console.error('❌ Failed to start chat:', error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show memory system status')
  .action(async () => {
    const cognitron = new Cognitron05();
    try {
      await cognitron.initialize();
      await cognitron.displayStatus();
      process.exit(0);
    } catch (error) {
      console.error('❌ Failed to show status:', error.message);
      process.exit(1);
    }
  });

program
  .command('reset')
  .description('Reset all persistent memory')
  .option('-y, --yes', 'skip confirmation')
  .action(async (options) => {
    const cognitron = new Cognitron05();
    try {
      await cognitron.initialize();
      
      const confirmed = options.yes || await cognitron.responseProcessor.confirmAction(
        'This will permanently delete all memory. Continue?',
        false
      );
      
      if (confirmed) {
        await cognitron.resetAllMemory();
        console.log('All memory has been reset.');
      } else {
        console.log('Operation cancelled.');
      }
      
      process.exit(0);
    } catch (error) {
      console.error('❌ Failed to reset memory:', error.message);
      process.exit(1);
    }
  });

// Default to chat if no command specified
if (process.argv.length === 2) {
  const cognitron = new Cognitron05();
  cognitron.startChat().catch(error => {
    console.error('Error starting Cognitron05:', error.message);
    process.exit(1);
  });
} else {
  program.parse();
}