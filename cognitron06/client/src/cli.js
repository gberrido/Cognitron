#!/usr/bin/env node

/**
 * Cognitron06 CLI Client
 * Connects to Cognitron06 server for AI assistant functionality
 */

import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import process from 'process';

import { AuthClient } from './auth.js';
import { ChatClient } from './chat.js';
import { MemoryClient } from './memory.js';
import { ModelsClient } from './models.js';
import { ConfigManager } from './config.js';
import { UIRenderer } from './ui.js';

class Cognitron06CLI {
  constructor() {
    this.config = new ConfigManager();
    this.ui = new UIRenderer();
    this.authClient = new AuthClient(this.config.get('serverUrl'));
    this.chatClient = null;
    this.memoryClient = null;
    this.modelsClient = null;
    this.rl = null;
    
    this.isRunning = false;
  }

  async initialize() {
    try {
      // Load saved configuration
      await this.config.load();
      
      // Initialize clients with server URL
      const serverUrl = this.config.get('serverUrl');
      this.authClient = new AuthClient(serverUrl);
      this.chatClient = new ChatClient(serverUrl);
      this.memoryClient = new MemoryClient(serverUrl);
      this.modelsClient = new ModelsClient(serverUrl);
      
      this.ui.displayWelcome();
      
    } catch (error) {
      this.ui.displayError(`Failed to initialize: ${error.message}`);
      process.exit(1);
    }
  }

  async authenticate() {
    const savedToken = await this.config.getSecure('accessToken');
    
    if (savedToken) {
      try {
        // Try to use saved token
        const userInfo = await this.authClient.validateToken(savedToken);
        this.authClient.setToken(savedToken);
        this.chatClient.setToken(savedToken);
        this.memoryClient.setToken(savedToken);
        this.modelsClient.setToken(savedToken);
        
        this.ui.displaySuccess(`Welcome back, ${userInfo.username}!`);
        return true;
      } catch (error) {
        this.ui.displayWarning('Saved session expired, please log in again.');
      }
    }
    
    return await this.promptLogin();
  }

  async promptLogin() {
    this.ui.print(chalk.cyan('🔐 Please log in to continue:'));
    
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true  // Fix: Force terminal mode for non-TTY environments
    });
    
    try {
      const username = await this.question(rl, 'Username: ');
      const password = await this.question(rl, 'Password: ', true);
      
      const loginResponse = await this.authClient.login(username, password);
      
      // Save token securely
      await this.config.setSecure('accessToken', loginResponse.access_token);
      
      // Set tokens for all clients
      this.chatClient.setToken(loginResponse.access_token);
      this.memoryClient.setToken(loginResponse.access_token);
      this.modelsClient.setToken(loginResponse.access_token);
      
      this.ui.displaySuccess(`✅ Logged in successfully! Session: ${loginResponse.session_id}`);
      return true;
      
    } catch (error) {
      this.ui.displayError(`Login failed: ${error.message}`);
      return false;
    } finally {
      rl.close();
    }
  }

  async question(rl, prompt, hidden = false) {
    return new Promise((resolve) => {
      if (hidden) {
        // Fallback for password input - just use regular input if setRawMode fails
        try {
          process.stdout.write(prompt);
          if (process.stdin.setRawMode) {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            
            let password = '';
            const onData = (char) => {
              if (char === '\n' || char === '\r' || char === '\u0004') {
                process.stdin.setRawMode(false);
                process.stdin.removeListener('data', onData);
                process.stdout.write('\n');
                resolve(password);
              } else if (char === '\u0003') {
                process.exit(1);
              } else if (char === '\u007f' || char === '\u0008') {
                if (password.length > 0) {
                  password = password.slice(0, -1);
                  process.stdout.write('\b \b');
                }
              } else {
                password += char;
                process.stdout.write('*');
              }
            };
            
            process.stdin.on('data', onData);
          } else {
            // Fallback to regular input
            rl.question(prompt, resolve);
          }
        } catch (error) {
          console.log('\nNote: Password will be visible (raw mode not available)');
          rl.question(prompt, resolve);
        }
      } else {
        rl.question(prompt, resolve);
      }
    });
  }

  async startChat(options = {}) {
    await this.initialize();
    
    // Authenticate user
    const authenticated = await this.authenticate();
    if (!authenticated) {
      process.exit(1);
    }
    
    // Display memory status
    try {
      const memoryStatus = await this.memoryClient.getStatus();
      this.ui.displayMemoryStatus(memoryStatus);
      
      if (memoryStatus.recall_storage_size > 0) {
        this.ui.displaySuccess(`Session resumed with ${memoryStatus.recall_storage_size} previous messages`);
      }
    } catch (error) {
      this.ui.displayWarning(`Could not load memory status: ${error.message}`);
    }
    
    // Start interactive chat
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> '),
      terminal: true  // Fix: Force terminal mode for non-TTY environments
    });
    
    this.isRunning = true;
    this.setupSignalHandlers();
    this.setupErrorHandlers();
    
    this.rl.prompt();
    
    this.rl.on('line', async (input) => {
      if (!this.isRunning) return;
      
      const message = input.trim();
      if (!message) {
        this.rl.prompt();
        return;
      }
      
      try {
        // Handle special commands
        if (message.startsWith('/')) {
          await this.handleCommand(message);
          this.rl.prompt();
          return;
        }
        
        // Show typing indicator
        const spinner = this.ui.showTyping();
        
        try {
          // Always use simple chat - no streaming complexity
          await this.handleStreamingChat(message);
        } finally {
          spinner.stop();
        }
        
      } catch (error) {
        this.ui.displayError(`Error: ${error.message}`);
        console.error('Full error details:', error);
      }
      
      // Always continue the conversation
      if (this.isRunning) {
        this.rl.prompt();
      }
    });
    
    this.rl.on('close', async () => {
      await this.cleanup();
    });
  }

  async handleStreamingChat(message) {
    try {
      const response = await this.chatClient.sendMessage(message);
      
      // Display the response content
      if (response.content) {
        this.ui.displayResponse(response.content);
      }
      
      // Display tool calls if any
      if (response.tool_calls && response.tool_calls.length > 0) {
        response.tool_calls.forEach(toolCall => {
          this.ui.displayToolCall(toolCall);
        });
      }
      
      // Display usage if available
      if (response.usage) {
        this.ui.displayUsage(response.usage);
      }
      
    } catch (error) {
      this.ui.displayError(`Chat error: ${error.message}`);
    }
  }

  async handleRegularChat(message) {
    const response = await this.chatClient.sendMessage(message);
    
    if (response.content) {
      this.ui.displayResponse(response.content);
    }
    
    if (response.tool_calls && response.tool_calls.length > 0) {
      response.tool_calls.forEach(toolCall => {
        this.ui.displayToolCall(toolCall);
      });
    }
    
    if (response.usage) {
      this.ui.displayUsage(response.usage);
    }
  }

  async handleCommand(command) {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    
    try {
      switch (cmd) {
        case 'help':
          this.ui.displayHelp();
          break;
          
        case 'status':
          await this.displayStatus();
          break;
          
        case 'memory':
          await this.displayMemoryDetails();
          break;
          
        case 'search':
          if (args.length === 0) {
            this.ui.displayError('Usage: /search <query>');
          } else {
            await this.searchMemory(args.join(' '));
          }
          break;
          
        case 'context':
          await this.displayWorkingContext();
          break;
          
        case 'sessions':
          await this.displaySessions();
          break;
          
        case 'models':
          await this.displayAvailableModels();
          break;
          
        case 'model':
          if (args.length === 0) {
            await this.displayCurrentModel();
          } else if (args.length === 1) {
            await this.switchModel(args[0]);
          } else {
            this.ui.displayError('Usage: /model [model-name] (no args shows current model)');
          }
          break;
          
        case 'modelinfo':
          if (args.length === 1) {
            await this.displayModelInfo(args[0]);
          } else {
            this.ui.displayError('Usage: /modelinfo <model-name>');
          }
          break;
          
        case 'modelreset':
          await this.resetToDefaultModel();
          break;
          
        case 'config':
          if (args.length === 2) {
            await this.updateConfig(args[0], args[1]);
          } else {
            this.displayCurrentConfig();
          }
          break;
          
        case 'logout':
          await this.logout();
          break;
          
        case 'clear':
          console.clear();
          this.ui.displayWelcome();
          break;
          
        case 'exit':
        case 'quit':
          await this.cleanup();
          break;
          
        default:
          this.ui.displayError(`Unknown command: ${cmd}. Type /help for available commands.`);
      }
    } catch (error) {
      this.ui.displayError(`Command error: ${error.message}`);
    }
  }

  async displayStatus() {
    try {
      const memoryStatus = await this.memoryClient.getStatus();
      const userInfo = await this.authClient.getUserInfo();
      const modelInfo = await this.modelsClient.getCurrentModel();
      
      this.ui.print(chalk.bright('\n📊 System Status:'));
      this.ui.print('═'.repeat(50));
      this.ui.print(`User: ${userInfo.username}`);
      this.ui.print(`Session: ${userInfo.session_id}`);
      this.ui.print(`Server: ${this.config.get('serverUrl')}`);
      this.ui.print(`Current Model: ${chalk.cyan(modelInfo.display_name)} (${modelInfo.model})`);
      this.ui.displayMemoryStatus(memoryStatus);
      
    } catch (error) {
      this.ui.displayError(`Failed to get status: ${error.message}`);
    }
  }

  async displayMemoryDetails() {
    try {
      const status = await this.memoryClient.getStatus();
      const pressure = await this.memoryClient.getMemoryPressure();
      
      this.ui.print(chalk.bright('\n🧠 Memory System Details:'));
      this.ui.print('═'.repeat(40));
      this.ui.displayMemoryStatus(status);
      
      if (pressure.warning) {
        this.ui.displayMemoryPressureWarning(pressure);
      }
      
    } catch (error) {
      this.ui.displayError(`Failed to get memory details: ${error.message}`);
    }
  }

  async searchMemory(query) {
    try {
      const results = await this.memoryClient.searchMemory(query);
      this.ui.displaySearchResults(results);
    } catch (error) {
      this.ui.displayError(`Search failed: ${error.message}`);
    }
  }

  async displayWorkingContext() {
    try {
      const context = await this.memoryClient.getWorkingContext();
      this.ui.displayWorkingContext(context);
    } catch (error) {
      this.ui.displayError(`Failed to get working context: ${error.message}`);
    }
  }

  async displaySessions() {
    try {
      const sessions = await this.memoryClient.getSessions();
      this.ui.displaySessions(sessions);
    } catch (error) {
      this.ui.displayError(`Failed to get sessions: ${error.message}`);
    }
  }

  async displayAvailableModels() {
    try {
      const modelsData = await this.modelsClient.getAvailableModels();
      this.ui.print(chalk.bright('\n🤖 Available Models:'));
      this.ui.print('═'.repeat(50));
      this.ui.print(this.modelsClient.formatAvailableModels(modelsData));
    } catch (error) {
      this.ui.displayError(`Failed to get available models: ${error.message}`);
    }
  }

  async displayCurrentModel() {
    try {
      const modelInfo = await this.modelsClient.getCurrentModel();
      this.ui.print(chalk.bright('\n🤖 Current Model:'));
      this.ui.print('═'.repeat(30));
      this.ui.print(this.modelsClient.formatModelInfo(modelInfo));
    } catch (error) {
      this.ui.displayError(`Failed to get current model: ${error.message}`);
    }
  }

  async switchModel(modelName) {
    try {
      this.ui.print(chalk.yellow(`🔄 Switching to model: ${modelName}...`));
      const result = await this.modelsClient.switchModel(modelName);
      
      this.ui.displaySuccess(`✅ Successfully switched to ${result.current_model}`);
      if (result.previous_model && result.previous_model !== result.current_model) {
        this.ui.print(chalk.gray(`Previous model: ${result.previous_model}`));
      }
      
      if (result.model_info) {
        this.ui.print(chalk.cyan(`Model: ${result.model_info.display_name}`));
        this.ui.print(chalk.cyan(`Optimal for: ${result.model_info.optimal_use_cases.join(', ')}`));
      }
    } catch (error) {
      this.ui.displayError(`Failed to switch model: ${error.message}`);
    }
  }

  async displayModelInfo(modelName) {
    try {
      const modelInfo = await this.modelsClient.getModelInfo(modelName);
      const capabilities = await this.modelsClient.getModelCapabilities(modelName);
      
      this.ui.print(chalk.bright(`\n🤖 Model Information: ${modelName}`));
      this.ui.print('═'.repeat(50));
      this.ui.print(this.modelsClient.formatModelInfo(modelInfo));
      
      if (capabilities.capabilities) {
        this.ui.print(chalk.bright('\nDetailed Capabilities:'));
        Object.entries(capabilities.capabilities).forEach(([key, value]) => {
          const icon = value ? '✅' : '❌';
          this.ui.print(`  ${icon} ${key}: ${value}`);
        });
      }
      
      if (capabilities.optimal_params) {
        this.ui.print(chalk.bright('\nOptimal Parameters:'));
        Object.entries(capabilities.optimal_params).forEach(([key, value]) => {
          this.ui.print(`  ${key}: ${value}`);
        });
      }
    } catch (error) {
      this.ui.displayError(`Failed to get model info: ${error.message}`);
    }
  }

  async resetToDefaultModel() {
    try {
      this.ui.print(chalk.yellow('🔄 Resetting to default model...'));
      const result = await this.modelsClient.resetToDefault();
      
      this.ui.displaySuccess(`✅ ${result.message}`);
      if (result.previous_model && result.previous_model !== result.current_model) {
        this.ui.print(chalk.gray(`Previous model: ${result.previous_model}`));
      }
      this.ui.print(chalk.cyan(`Current model: ${result.current_model}`));
    } catch (error) {
      this.ui.displayError(`Failed to reset to default model: ${error.message}`);
    }
  }

  async updateConfig(key, value) {
    try {
      this.config.set(key, value);
      await this.config.save();
      this.ui.displaySuccess(`Config updated: ${key} = ${value}`);
    } catch (error) {
      this.ui.displayError(`Failed to update config: ${error.message}`);
    }
  }

  displayCurrentConfig() {
    const config = this.config.getAll();
    this.ui.print(chalk.bright('\n⚙️  Current Configuration:'));
    this.ui.print('═'.repeat(25));
    Object.entries(config).forEach(([key, value]) => {
      this.ui.print(`${key}: ${value}`);
    });
  }

  async logout() {
    try {
      await this.authClient.logout();
      await this.config.deleteSecure('accessToken');
      this.ui.displaySuccess('Logged out successfully');
      process.exit(0);
    } catch (error) {
      this.ui.displayError(`Logout failed: ${error.message}`);
    }
  }

  setupSignalHandlers() {
    const cleanup = async () => {
      console.log('\n👋 Goodbye!');
      await this.cleanup();
    };
    
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  }

  setupErrorHandlers() {
    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      console.error('Unhandled promise rejection:', reason);
      this.ui.displayError(`Unhandled error: ${reason?.message || reason}`);
      // Continue conversation instead of crashing
      if (this.isRunning && this.rl) {
        this.rl.prompt();
      }
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('Uncaught exception:', error);
      this.ui.displayError(`Uncaught error: ${error.message}`);
      // Continue conversation instead of crashing
      if (this.isRunning && this.rl) {
        this.rl.prompt();
      }
    });
  }

  async cleanup() {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    if (this.rl) {
      this.rl.close();
    }
    
    process.exit(0);
  }
}

// CLI Setup
const program = new Command();

program
  .name('cognitron06')
  .description('AI Assistant CLI Client with MemGPT-inspired memory')
  .version('1.0.0');

program
  .command('chat')
  .description('Start interactive chat session')
  .option('--no-stream', 'disable streaming responses')
  .option('--server <url>', 'server URL', 'http://localhost:8000')
  .option('--debug', 'enable debug mode')
  .action(async (options) => {
    const cli = new Cognitron06CLI();
    
    // Set server URL if provided
    if (options.server) {
      cli.config.set('serverUrl', options.server);
    }
    
    await cli.startChat(options);
  });

program
  .command('config')
  .description('Manage configuration')
  .option('--server <url>', 'set server URL')
  .action(async (options) => {
    const config = new ConfigManager();
    await config.load();
    
    if (options.server) {
      config.set('serverUrl', options.server);
      await config.save();
      console.log(`Server URL set to: ${options.server}`);
    } else {
      console.log('Current configuration:');
      console.log(JSON.stringify(config.getAll(), null, 2));
    }
  });

// Default to chat if no command specified
if (process.argv.length === 2) {
  const cli = new Cognitron06CLI();
  cli.startChat().catch(error => {
    console.error('Error starting Cognitron06 CLI:', error.message);
    process.exit(1);
  });
} else {
  program.parse();
}