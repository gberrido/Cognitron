#!/usr/bin/env node

/**
 * Cognitron05 Modular - New modular architecture implementation
 * Demonstrates the new interface-based, dependency-injected architecture
 * 
 * This is the new main entry point that showcases the modular design:
 * - Clean layer separation (Memory, Tools, Agent, UI)
 * - Dependency injection container
 * - Interface-based components
 * - Proper lifecycle management
 */

import { Command } from 'commander';
import { ApplicationBootstrap } from './modules/core/ApplicationBootstrap.js';
import { getLogger } from './modules/utils/StructuredLogger.js';
import { APPLICATION_CONSTANTS } from './modules/config/SystemConstants.js';
import readline from 'readline';

class CognitronModular {
  constructor(options = {}) {
    this.options = {
      dataDir: options.dataDir || './cognitron05-data',
      environment: process.env.NODE_ENV || 'development',
      logLevel: process.env.LOG_LEVEL || 'INFO',
      ...options
    };
    
    // Application context from bootstrap
    this.app = null;
    this.logger = null;
    this.rl = null;
    this.isRunning = false;
  }

  /**
   * Get API key from environment with validation
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
   * Bootstrap the modular application
   */
  async bootstrap() {
    try {
      // Validate API key first
      this.getRequiredApiKey();
      
      console.log('🔧 Bootstrapping Cognitron05 with modular architecture...');
      
      // Create and bootstrap application
      const bootstrap = new ApplicationBootstrap({
        dataDir: this.options.dataDir,
        environment: this.options.environment,
        logLevel: this.options.logLevel,
        enableMetrics: true
      });
      
      this.app = await bootstrap.bootstrap();
      this.logger = getLogger();
      
      this.logger.info('Modular Cognitron05 bootstrapped successfully', {
        subsystem: 'main',
        architecture: 'modular',
        dataDir: this.options.dataDir,
        uptime: this.app.getUptime()
      });
      
      console.log('✅ Modular architecture initialized successfully');
      
      return this.app;
      
    } catch (error) {
      console.error('❌ Failed to bootstrap modular application:', error.message);
      throw error;
    }
  }

  /**
   * Start interactive chat session
   */
  async startChat(cliOptions = {}) {
    if (!this.app) {
      await this.bootstrap();
    }

    try {
      // Get components from application context
      const { 
        memorySystem, 
        chatAgent, 
        responseProcessor, 
        commandRegistry 
      } = this.app;

      // Update agent configuration with CLI options
      if (cliOptions.temperature) {
        await chatAgent.updateConfig({ temperature: cliOptions.temperature });
      }
      if (cliOptions.reasoning) {
        await chatAgent.updateConfig({ reasoningLevel: cliOptions.reasoning });
      }
      
      // Display welcome and memory status
      const memoryStatus = await memorySystem.getStatus();
      responseProcessor.displayWelcome(memoryStatus);

      if (memoryStatus.recallStorageSize > 0) {
        responseProcessor.displaySuccess(`Session resumed with ${memoryStatus.recallStorageSize} previous messages`);
      }

      // Start interactive session
      await this.startInteractiveSession();
      
    } catch (error) {
      this.logger?.error('Failed to start modular chat session', {
        subsystem: 'main',
        operation: 'startChat'
      }, error);
      
      console.error('❌ Failed to start chat session:', error.message);
      throw error;
    }
  }

  /**
   * Start interactive session with proper readline handling
   */
  async startInteractiveSession() {
    return new Promise((resolve, reject) => {
      try {
        this.rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: '\x1b[36m> \x1b[0m'
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
          
          if (this.isRunning) {
            this.rl.prompt();
          }
        });

        this.rl.on('close', async () => {
          await this.shutdown();
          resolve();
        });

        // Handle process signals
        process.on('SIGINT', async () => {
          console.log('\nReceived SIGINT, shutting down gracefully...');
          await this.shutdown();
          resolve();
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Process user input through modular architecture
   */
  async processUserInput(message) {
    try {
      const { 
        commandRegistry, 
        chatAgent, 
        responseProcessor, 
        memorySystem,
        errorBoundary 
      } = this.app;

      // Handle commands
      if (message.startsWith('/')) {
        const handled = await this.handleCommand(message, commandRegistry);
        if (handled) {
          return;
        }
      }

      // Show typing indicator
      await responseProcessor.showTyping(1000);

      this.logger.debug('Processing user input through modular architecture', {
        subsystem: 'main',
        messageLength: message.length,
        operation: 'processUserInput'
      });

      // Generate response through agent layer
      const response = await chatAgent.generateResponse(message, {
        enableMemory: true,
        enableTools: true
      });

      // Display response through UI layer
      await responseProcessor.displayResponse(response, {
        showUsage: false,
        showMemoryStatus: true
      });

      // Check memory pressure
      const memoryPressure = await memorySystem.checkMemoryPressure();
      if (memoryPressure.warning) {
        responseProcessor.displayMemoryPressureWarning(memoryPressure);
      }

    } catch (error) {
      // Use error boundary for error handling
      const { errorBoundary, responseProcessor } = this.app;
      
      const result = await errorBoundary.handleError(error, {
        operation: 'user_input_processing',
        message: message
      });

      if (result.shouldContinue) {
        responseProcessor.displayError(new Error(result.userMessage));
      } else {
        responseProcessor.displayError(new Error(`Critical error: ${result.userMessage}`));
        await this.shutdown();
      }
    }
  }

  /**
   * Handle user commands through modular command registry
   */
  async handleCommand(commandString, commandRegistry) {
    try {
      const parts = commandString.slice(1).split(' ');
      const cmd = parts[0].toLowerCase();
      const args = parts.slice(1);

      // Special handling for exit commands
      if (cmd === 'exit' || cmd === 'quit') {
        await this.shutdown();
        return true;
      }

      // Create command context with all needed components
      const context = {
        ...this.app, // Include all app components
        rl: this.rl,
        shutdown: this.shutdown.bind(this),
        isRunning: () => this.isRunning
      };

      // Execute through command registry
      const handled = await commandRegistry.execute(cmd, args, context);

      this.logger.debug('Command processed through modular registry', {
        subsystem: 'main',
        command: cmd,
        handled,
        operation: 'handleCommand'
      });

      return handled;

    } catch (error) {
      this.logger.error('Error processing command through modular registry', {
        subsystem: 'main',
        command: commandString,
        operation: 'handleCommand'
      }, error);

      this.app.responseProcessor.displayError(error);
      return true; // Command was handled (even if it failed)
    }
  }

  /**
   * Display system status using modular components
   */
  async displayStatus() {
    if (!this.app) {
      console.log('Application not bootstrapped');
      return;
    }

    try {
      const { chatAgent, memorySystem, responseProcessor } = this.app;

      // Get status from components
      const agentStatus = chatAgent.getStatus();
      const memoryStatus = await memorySystem.getStatus();
      const appStats = this.app.getStats();

      // Display through response processor
      responseProcessor.print(responseProcessor.colorize('\n📊 Modular System Status:', 'bright'));
      responseProcessor.print('═'.repeat(40));
      
      responseProcessor.print(`Architecture: Modular (Interface-based)`);
      responseProcessor.print(`Uptime: ${Math.round(appStats.uptime / 1000)}s`);
      responseProcessor.print(`Components: ${appStats.componentCount}`);
      responseProcessor.print(`Environment: ${appStats.environment}`);
      
      responseProcessor.print(`\nAgent Configuration:`);
      responseProcessor.print(`  Model: ${agentStatus.model}`);
      responseProcessor.print(`  Temperature: ${agentStatus.temperature}`);
      responseProcessor.print(`  Reasoning Level: ${agentStatus.reasoningLevel}`);
      
      responseProcessor.displayMemoryStatus(memoryStatus);

      this.logger.info('System status displayed', {
        subsystem: 'main',
        uptime: appStats.uptime,
        components: appStats.componentCount,
        operation: 'displayStatus'
      });

    } catch (error) {
      this.logger.error('Failed to display system status', {
        subsystem: 'main',
        operation: 'displayStatus'
      }, error);
      
      console.error('❌ Failed to display status:', error.message);
    }
  }

  /**
   * Graceful shutdown of modular application
   */
  async shutdown() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;

    try {
      console.log('\n💾 Shutting down modular Cognitron05...');

      // Close readline interface
      if (this.rl) {
        this.rl.close();
      }

      // Shutdown application through bootstrap
      if (this.app && typeof this.app.shutdown === 'function') {
        await this.app.shutdown();
      }

      this.logger?.info('Modular Cognitron05 shutdown completed', {
        subsystem: 'main',
        operation: 'shutdown'
      });

      console.log('✅ Modular architecture shutdown complete');
      console.log('👋 Goodbye!');

    } catch (error) {
      console.error('❌ Error during shutdown:', error.message);
    }

    process.exit(0);
  }

  /**
   * Health check for modular application
   */
  async healthCheck() {
    if (!this.app) {
      return { healthy: false, reason: 'Application not bootstrapped' };
    }

    try {
      // Perform application-level health check
      const healthResult = await this.app.healthCheck();

      this.logger.debug('Modular application health check completed', {
        subsystem: 'main',
        healthy: healthResult.healthy,
        operation: 'healthCheck'
      });

      return healthResult;

    } catch (error) {
      this.logger.error('Modular application health check failed', {
        subsystem: 'main',
        operation: 'healthCheck'
      }, error);

      return {
        healthy: false,
        reason: `Health check failed: ${error.message}`
      };
    }
  }
}

// CLI Setup
const program = new Command();

program
  .name('cognitron05-modular')
  .description('AI Assistant with modular architecture and MemGPT-inspired memory')
  .version('1.0.0-modular');

program
  .command('chat')
  .description('Start interactive chat with modular architecture')
  .option('-t, --temperature <number>', 'set temperature (0.0-2.0)', parseFloat)
  .option('-r, --reasoning <level>', 'set reasoning level (low/medium/high)')
  .option('--no-memory', 'disable memory system')
  .option('--show-usage', 'show token usage information')
  .option('--no-colors', 'disable colored output')
  .option('--debug', 'enable debug mode')
  .action(async (options) => {
    const cognitron = new CognitronModular();
    try {
      await cognitron.startChat(options);
    } catch (error) {
      console.error('❌ Failed to start modular chat:', error.message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show modular system status')
  .action(async () => {
    const cognitron = new CognitronModular();
    try {
      await cognitron.bootstrap();
      await cognitron.displayStatus();
      await cognitron.shutdown();
    } catch (error) {
      console.error('❌ Failed to show modular status:', error.message);
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Check modular system health')
  .action(async () => {
    const cognitron = new CognitronModular();
    try {
      await cognitron.bootstrap();
      const health = await cognitron.healthCheck();
      
      console.log('🏥 Modular System Health Check');
      console.log('═'.repeat(30));
      console.log(`Status: ${health.healthy ? '✅ Healthy' : '❌ Unhealthy'}`);
      
      if (!health.healthy) {
        console.log(`Reason: ${health.reason}`);
      }
      
      if (health.uptime) {
        console.log(`Uptime: ${Math.round(health.uptime / 1000)}s`);
      }
      
      if (health.componentCount) {
        console.log(`Components: ${health.componentCount}`);
      }
      
      await cognitron.shutdown();
      process.exit(health.healthy ? 0 : 1);
      
    } catch (error) {
      console.error('❌ Failed to check modular health:', error.message);
      process.exit(1);
    }
  });

// Default to chat if no command specified
if (process.argv.length === 2) {
  const cognitron = new CognitronModular();
  cognitron.startChat().catch(error => {
    console.error('Error starting modular Cognitron05:', error.message);
    process.exit(1);
  });
} else {
  program.parse();
}

export { CognitronModular };