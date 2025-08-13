#!/usr/bin/env node

/**
 * Cognitron05 Encrypted - AI Assistant with Enterprise-Grade Security
 * Features encrypted memory, authentication, and comprehensive monitoring
 * 
 * This version integrates all security improvements:
 * - End-to-end data encryption at rest
 * - Authentication and authorization
 * - Secure file operations
 * - Monitoring and alerting
 */

import { Command } from 'commander';
import readline from 'readline';
import process from 'process';
import { ApplicationContainer } from './modules/core/ApplicationContainer.js';
import { getLogger } from './modules/utils/StructuredLogger.js';

class CognitronEncrypted {
  constructor() {
    this.container = null;
    this.logger = null;
    this.isRunning = false;
    this.rl = null;
    
    // Component references
    this.authIntegration = null;
    this.memorySystem = null;
    this.chatAgent = null;
    this.responseProcessor = null;
    this.commandRegistry = null;
    this.encryptedStorage = null;
  }

  /**
   * Initialize the complete encrypted system
   */
  async initialize() {
    try {
      console.log('🔐 Initializing Cognitron05 with enterprise security...');
      
      // Check for required encryption master key
      if (!process.env.COGNITRON_MASTER_KEY) {
        console.error('❌ COGNITRON_MASTER_KEY environment variable is required for encryption');
        console.error('   Set it to a strong 64-character hex string:');
        console.error('   export COGNITRON_MASTER_KEY="your-64-char-hex-key"');
        process.exit(1);
      }
      
      // Check for required Groq API key
      if (!process.env.GROQ_API_KEY) {
        console.error('❌ GROQ_API_KEY environment variable is required');
        console.error('   Get your API key from: https://console.groq.com');
        process.exit(1);
      }
      
      // Initialize application container
      this.container = new ApplicationContainer({
        environment: process.env.NODE_ENV || 'development',
        logLevel: process.env.LOG_LEVEL || 'INFO',
        enableMetrics: true,
        enableAuth: process.env.COGNITRON_ENABLE_AUTH !== 'false',
        defaultUsername: process.env.USER || 'cognitron_user',
        separateUserMemories: process.env.COGNITRON_SEPARATE_MEMORIES === 'true'
      });
      
      await this.container.initialize();
      
      this.logger = getLogger();
      
      // Get core components
      this.authIntegration = await this.container.get('auth.integration');
      this.encryptedStorage = await this.container.get('encryption.storage');
      this.memorySystem = await this.container.get('memory.system');
      this.chatAgent = await this.container.get('agent.chat');
      this.responseProcessor = await this.container.get('ui.processor');
      this.commandRegistry = await this.container.get('command.registry');
      
      console.log('✅ Encrypted system initialized successfully');
      
      // Display security status
      await this.displaySecurityStatus();
      
    } catch (error) {
      console.error('❌ Failed to initialize encrypted system:', error.message);
      process.exit(1);
    }
  }

  /**
   * Display security and encryption status
   */
  async displaySecurityStatus() {
    try {
      console.log('\n📊 Security Status:');
      
      // Encryption status
      const encryptionStats = this.encryptedStorage.getStats();
      console.log(`   🔒 Encryption: ${encryptionStats.enableEncryption ? '✅ ENABLED' : '❌ DISABLED'}`);
      console.log(`   🔐 Mode: ${encryptionStats.encryptionMode}`);
      
      // Authentication status
      const authStats = this.authIntegration.getStats();
      console.log(`   🔑 Authentication: ${authStats.enableAuth ? '✅ ENABLED' : '❌ DISABLED'}`);
      if (authStats.currentUser) {
        console.log(`   👤 Current User: ${authStats.currentUser.username} (${authStats.currentUser.role})`);
      }
      
      // Health checks
      const encryptionHealth = await this.encryptedStorage.healthCheck();
      const authHealth = await this.authIntegration.healthCheck();
      const memoryHealth = await this.memorySystem.healthCheck();
      
      console.log(`   💚 Encryption Health: ${encryptionHealth.healthy ? 'HEALTHY' : 'ISSUES'}`);
      console.log(`   💚 Auth Health: ${authHealth.healthy ? 'HEALTHY' : 'ISSUES'}`);
      console.log(`   💚 Memory Health: ${memoryHealth.healthy ? 'HEALTHY' : 'ISSUES'}`);
      
    } catch (error) {
      this.logger.error('Failed to display security status', {
        subsystem: 'main',
        component: 'cognitron-encrypted'
      }, error);
    }
  }

  /**
   * Start authentication session
   */
  async startAuthenticationSession(credentials = null) {
    try {
      const sessionResult = await this.authIntegration.startSession(credentials);
      
      if (!sessionResult.success) {
        if (sessionResult.requiresAuth) {
          console.log('\n🔐 Authentication required. Please login:');
          return await this.promptForLogin();
        } else {
          console.error(`❌ Authentication failed: ${sessionResult.error}`);
          return false;
        }
      }
      
      const user = sessionResult.session.user;
      console.log(`\n✅ Authenticated as: ${user.username} (${user.role})`);
      
      return true;
      
    } catch (error) {
      console.error('❌ Authentication session failed:', error.message);
      return false;
    }
  }

  /**
   * Prompt user for login credentials
   */
  async promptForLogin() {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      rl.question('Username: ', (username) => {
        rl.question('Password: ', async (password) => {
          rl.close();
          
          const sessionResult = await this.authIntegration.startSession({
            username,
            password
          });
          
          if (sessionResult.success) {
            const user = sessionResult.session.user;
            console.log(`✅ Welcome, ${user.username}!`);
            resolve(true);
          } else {
            console.error(`❌ Login failed: ${sessionResult.error}`);
            resolve(false);
          }
        });
      });
    });
  }

  /**
   * Start interactive chat mode
   */
  async startInteractive() {
    try {
      // Start authentication session
      const authSuccess = await this.startAuthenticationSession();
      if (!authSuccess) {
        console.error('❌ Authentication required to continue');
        return;
      }
      
      console.log('\n🚀 Starting encrypted chat session...');
      console.log('💡 Type your message or use commands like /help, /stats, /memory');
      console.log('🔐 All data is encrypted and secure');
      console.log('💬 Type /exit to quit\n');

      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '> '
      });

      this.isRunning = true;
      this.rl.prompt();

      this.rl.on('line', async (input) => {
        const trimmedInput = input.trim();
        
        if (!trimmedInput) {
          this.rl.prompt();
          return;
        }

        try {
          await this.handleInput(trimmedInput);
        } catch (error) {
          this.logger.error('Input handling failed', {
            subsystem: 'main',
            component: 'cognitron-encrypted',
            input: trimmedInput
          }, error);
          
          console.error('❌ An error occurred processing your input');
        }
        
        if (this.isRunning) {
          this.rl.prompt();
        }
      });

      this.rl.on('close', async () => {
        await this.shutdown();
      });

    } catch (error) {
      this.logger.error('Interactive mode failed', {
        subsystem: 'main',
        component: 'cognitron-encrypted'
      }, error);
      
      console.error('❌ Interactive mode failed:', error.message);
      await this.shutdown();
    }
  }

  /**
   * Handle user input (messages and commands)
   */
  async handleInput(input) {
    try {
      // Check authorization for command if it's a command
      if (input.startsWith('/')) {
        const [command, ...args] = input.split(' ');
        const authResult = await this.authIntegration.authorizeCommand(command, args);
        
        if (!authResult.authorized) {
          console.error(`❌ Access denied: ${authResult.reason}`);
          return;
        }
      }
      
      // Check if it's a command
      if (this.commandRegistry.isCommand(input)) {
        const result = await this.commandRegistry.executeCommand(input, {
          memorySystem: this.memorySystem,
          chatAgent: this.chatAgent,
          authIntegration: this.authIntegration,
          encryptedStorage: this.encryptedStorage,
          container: this.container
        });
        
        if (result.shouldExit) {
          await this.shutdown();
          return;
        }
        
        if (result.output) {
          console.log(result.output);
        }
        
        return;
      }

      // Regular chat message - authorize memory operations
      const memoryAuth = await this.authIntegration.authorizeMemoryOperation('write', input);
      if (!memoryAuth.authorized) {
        console.error(`❌ Memory access denied: ${memoryAuth.reason}`);
        return;
      }

      // Get user context for the conversation
      const userContext = this.authIntegration.getUserContextForMemory();

      // Generate response with user context
      const response = await this.chatAgent.generateResponse(input, {
        userContext: userContext,
        sessionId: this.authIntegration.getCurrentSession()?.sessionId
      });
      
      // Process and display response
      await this.responseProcessor.processResponse(response, {
        showMemoryOperations: true,
        showMemoryStatus: true,
        userContext: userContext
      });
      
    } catch (error) {
      this.logger.error('Input handling failed', {
        subsystem: 'main',
        component: 'cognitron-encrypted',
        input
      }, error);
      
      throw error;
    }
  }

  /**
   * Handle single question mode
   */
  async handleSingleQuestion(question) {
    try {
      console.log('🔐 Starting secure single question mode...');
      
      // Start authentication session (auto-login in dev mode)
      const authSuccess = await this.startAuthenticationSession();
      if (!authSuccess) {
        console.error('❌ Authentication required');
        return;
      }

      // Authorize memory operations
      const memoryAuth = await this.authIntegration.authorizeMemoryOperation('write', question);
      if (!memoryAuth.authorized) {
        console.error(`❌ Memory access denied: ${memoryAuth.reason}`);
        return;
      }

      // Get user context
      const userContext = this.authIntegration.getUserContextForMemory();

      // Generate and display response
      const response = await this.chatAgent.generateResponse(question, {
        userContext: userContext,
        sessionId: this.authIntegration.getCurrentSession()?.sessionId
      });
      
      await this.responseProcessor.processResponse(response, {
        showMemoryOperations: true,
        showMemoryStatus: false,
        userContext: userContext
      });
      
      console.log('\n💾 Response saved to encrypted memory');
      
    } catch (error) {
      this.logger.error('Single question mode failed', {
        subsystem: 'main',
        component: 'cognitron-encrypted',
        question
      }, error);
      
      console.error('❌ Single question mode failed:', error.message);
    }
  }

  /**
   * Display system statistics with security information
   */
  async displayStats() {
    try {
      await this.startAuthenticationSession();
      
      const containerStats = this.container.getStats();
      const encryptionStats = this.encryptedStorage.getStats();
      const authStats = this.authIntegration.getStats();
      const memoryStats = await this.memorySystem.getStats();

      console.log('\n📊 Cognitron05 Encrypted System Statistics:');
      console.log('\n🏗️  Application Container:');
      console.log(`   Components: ${containerStats.componentCount}`);
      console.log(`   Environment: ${containerStats.environment}`);
      console.log(`   Status: ${containerStats.initialized ? 'INITIALIZED' : 'NOT INITIALIZED'}`);

      console.log('\n🔐 Encryption System:');
      console.log(`   Encryption: ${encryptionStats.enableEncryption ? 'ENABLED' : 'DISABLED'}`);
      console.log(`   Mode: ${encryptionStats.encryptionMode}`);
      console.log(`   Read Operations: ${encryptionStats.readOperations}`);
      console.log(`   Write Operations: ${encryptionStats.writeOperations}`);
      console.log(`   Encrypted Reads: ${encryptionStats.encryptedReads}`);
      console.log(`   Encrypted Writes: ${encryptionStats.encryptedWrites}`);
      console.log(`   Cache Hit Rate: ${encryptionStats.cacheHitRate.toFixed(1)}%`);

      console.log('\n🔑 Authentication System:');
      console.log(`   Authentication: ${authStats.enableAuth ? 'ENABLED' : 'DISABLED'}`);
      console.log(`   Current User: ${authStats.currentUser ? `${authStats.currentUser.username} (${authStats.currentUser.role})` : 'None'}`);
      console.log(`   Sessions Created: ${authStats.sessionsCreated}`);
      console.log(`   Commands Authorized: ${authStats.commandsAuthorized}`);
      console.log(`   Commands Denied: ${authStats.commandsDenied}`);

      console.log('\n🧠 Memory System:');
      console.log(`   Working Context: ${memoryStats.workingContextSize} items`);
      console.log(`   FIFO Queue: ${memoryStats.fifoQueueSize} messages`);
      console.log(`   Recall Storage: ${memoryStats.recallStorageSize} entries`);
      console.log(`   Archival Storage: ${memoryStats.archivalStorageSize} items`);
      console.log(`   Memory Usage: ${memoryStats.memoryPressure.toFixed(1)}%`);

    } catch (error) {
      console.error('❌ Failed to display stats:', error.message);
    }
  }

  /**
   * Graceful shutdown with proper cleanup
   */
  async shutdown() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    
    try {
      console.log('\n🔒 Securing and shutting down...');
      
      if (this.rl) {
        this.rl.close();
      }
      
      // Logout user
      if (this.authIntegration) {
        await this.authIntegration.logout();
      }
      
      // Shutdown application container
      if (this.container) {
        await this.container.shutdown();
      }
      
      console.log('✅ Secure shutdown complete');
      
    } catch (error) {
      console.error('❌ Shutdown error:', error.message);
    }
    
    process.exit(0);
  }
}

// CLI Setup
const program = new Command();

program
  .name('cognitron05-encrypted')
  .description('AI Assistant with Enterprise-Grade Security and Encryption')
  .version('1.0.0');

program
  .command('start')
  .description('Start interactive encrypted chat')
  .action(async () => {
    const cognitron = new CognitronEncrypted();
    await cognitron.initialize();
    await cognitron.startInteractive();
  });

program
  .command('ask <question>')
  .description('Ask a single question with encrypted storage')
  .action(async (question) => {
    const cognitron = new CognitronEncrypted();
    await cognitron.initialize();
    await cognitron.handleSingleQuestion(question);
    await cognitron.shutdown();
  });

program
  .command('stats')
  .description('Display system statistics including security status')
  .action(async () => {
    const cognitron = new CognitronEncrypted();
    await cognitron.initialize();
    await cognitron.displayStats();
    await cognitron.shutdown();
  });

// Handle process signals for graceful shutdown
const cognitronInstance = new CognitronEncrypted();

process.on('SIGINT', async () => {
  console.log('\n⚠️  Received SIGINT, shutting down gracefully...');
  await cognitronInstance.shutdown();
});

process.on('SIGTERM', async () => {
  console.log('\n⚠️  Received SIGTERM, shutting down gracefully...');
  await cognitronInstance.shutdown();
});

process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught exception:', error.message);
  await cognitronInstance.shutdown();
});

process.on('unhandledRejection', async (reason) => {
  console.error('💥 Unhandled rejection:', reason);
  await cognitronInstance.shutdown();
});

// Default to interactive mode if no command specified
if (process.argv.length === 2) {
  (async () => {
    await cognitronInstance.initialize();
    await cognitronInstance.startInteractive();
  })();
} else {
  program.parse();
}