#!/usr/bin/env node

/**
 * Cognitron06 Enhanced CLI
 * Professional CLI interface using Commander.js with continuous conversation support
 */

import { Command } from 'commander';
import chalk from 'chalk';
import process from 'process';
import fetch from 'node-fetch';
import { ChatClient } from './src/chat.js';
import { AuthClient } from './src/auth.js';
import { MemoryClient } from './src/memory.js';
import { ModelsClient } from './src/models.js';
import { ConfigManager } from './src/config.js';

class CognitronCLI {
  constructor() {
    this.config = new ConfigManager();
    this.authClient = null;
    this.chatClient = null;
    this.memoryClient = null;
    this.modelsClient = null;
    this.isRunning = false;
    this.inputBuffer = '';
  }

  async initialize() {
    await this.config.load();
    
    const serverUrl = this.config.get('serverUrl');
    this.authClient = new AuthClient(serverUrl);
    this.chatClient = new ChatClient(serverUrl);
    this.memoryClient = new MemoryClient(serverUrl);
    this.modelsClient = new ModelsClient(serverUrl);
  }

  async authenticate(options = {}) {
    const savedToken = await this.config.getSecure('accessToken');
    
    if (savedToken && !options.forceLogin) {
      try {
        const userInfo = await this.authClient.validateToken(savedToken);
        this.authClient.setToken(savedToken);
        this.chatClient.setToken(savedToken);
        this.memoryClient.setToken(savedToken);
        this.modelsClient.setToken(savedToken);
        
        console.log(chalk.green(`✅ Welcome back, ${userInfo.username}!`));
        return true;
      } catch (error) {
        if (!options.quiet) {
          console.log(chalk.yellow('⚠️  Session expired'));
        }
      }
    }
    
    // Auto-login with demo credentials if available
    if (!options.interactive) {
      try {
        const loginResponse = await this.authClient.login('demo', 'demo123');
        await this.config.setSecure('accessToken', loginResponse.access_token);
        
        this.chatClient.setToken(loginResponse.access_token);
        this.memoryClient.setToken(loginResponse.access_token);
        this.modelsClient.setToken(loginResponse.access_token);
        
        console.log(chalk.green(`✅ Logged in as demo`));
        return true;
      } catch (error) {
        console.log(chalk.red('❌ Auto-login failed. Please check server connection.'));
        return false;
      }
    }
    
    return false;
  }

  async startInteractiveChat(options = {}) {
    console.log(chalk.cyan.bold('\n🧠 Cognitron AI Assistant'));
    console.log(chalk.gray('Enhanced CLI with persistent memory and continuous conversation'));
    console.log(chalk.gray(`Server: ${this.config.get('serverUrl')}`));
    
    if (options.model) {
      try {
        await this.modelsClient.switchModel(options.model);
        console.log(chalk.green(`✅ Using model: ${options.model}`));
      } catch (error) {
        console.log(chalk.yellow(`⚠️  Could not switch to model ${options.model}: ${error.message}`));
      }
    }

    // Show memory status if available
    try {
      const memoryStatus = await this.memoryClient.getStatus();
      console.log(chalk.blue(`📊 Memory: ${memoryStatus.total_messages} messages, ${memoryStatus.memory_usage}% usage`));
    } catch (error) {
      // Ignore memory status errors
    }

    console.log(chalk.cyan('\n💬 Chat started! Type your messages or use commands:'));
    console.log(chalk.gray('  /help     - Show help'));
    console.log(chalk.gray('  /memory   - Memory status'));
    console.log(chalk.gray('  /models   - Available models'));
    console.log(chalk.gray('  /status   - System status'));
    console.log(chalk.gray('  /exit     - Exit chat'));
    console.log('');
    
    this.isRunning = true;
    this.setupInteractiveMode(options);
  }

  setupInteractiveMode(options) {
    // Setup stdin handling for continuous conversation
    process.stdin.setEncoding('utf8');
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    
    process.stdin.on('readable', () => {
      let chunk;
      while (null !== (chunk = process.stdin.read())) {
        this.inputBuffer += chunk;
        
        const lines = this.inputBuffer.split('\n');
        this.inputBuffer = lines.pop();
        
        lines.forEach(line => {
          this.handleInput(line.trim(), options);
        });
      }
    });
    
    process.stdin.on('end', () => {
      this.gracefulExit();
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      this.gracefulExit();
    });
    
    this.showPrompt();
  }

  showPrompt() {
    process.stdout.write(chalk.cyan('> '));
  }

  async handleInput(input, options) {
    if (!input) {
      this.showPrompt();
      return;
    }

    // Handle commands
    if (input.startsWith('/')) {
      await this.handleSlashCommand(input, options);
      this.showPrompt();
      return;
    }

    // Handle chat messages
    try {
      console.log(chalk.dim('🤖 Processing...'));
      
      const response = await this.chatClient.sendMessage(input);
      
      // Display response
      if (response.content) {
        if (response.content === "I've updated my memory based on our conversation.") {
          console.log(chalk.green(`✓ Memory updated - AI is ready for your next message!`));
        } else {
          console.log(chalk.white(response.content));
        }
      } else {
        console.log(chalk.yellow('(AI performed actions but provided no response text)'));
      }
      
      // Display tool calls if verbose
      if (options.verbose && response.tool_calls && response.tool_calls.length > 0) {
        response.tool_calls.forEach(toolCall => {
          const name = toolCall.function?.name || toolCall.name || 'Unknown';
          console.log(chalk.blue(`🔧 Tool: ${name}`));
        });
      }
      
      // Display usage if requested
      if (options.showUsage && response.usage) {
        const { total_tokens, prompt_tokens, completion_tokens } = response.usage;
        console.log(chalk.gray(`📊 Tokens: ${total_tokens} (${prompt_tokens}+${completion_tokens})`));
      }
      
    } catch (error) {
      console.log(chalk.red(`❌ Error: ${error.message}`));
      if (error.message.includes('Failed to process message')) {
        console.log(chalk.yellow('💡 This might be a temporary server issue. Try again.'));
      }
    }

    console.log('');
    this.showPrompt();
  }

  async handleSlashCommand(command, options) {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
        this.showHelp();
        break;
        
      case 'memory':
        await this.showMemoryStatus();
        break;
        
      case 'status':
        await this.showSystemStatus();
        break;
        
      case 'models':
        await this.showAvailableModels();
        break;
        
      case 'model':
        if (args.length === 0) {
          await this.showCurrentModel();
        } else {
          await this.switchModel(args[0]);
        }
        break;
        
      case 'clear':
        console.clear();
        console.log(chalk.cyan.bold('🧠 Cognitron AI Assistant'));
        console.log('');
        break;
        
      case 'exit':
      case 'quit':
        this.gracefulExit();
        break;
        
      default:
        console.log(chalk.red(`Unknown command: ${cmd}`));
        console.log(chalk.gray('Type /help for available commands'));
    }
  }

  showHelp() {
    console.log(chalk.cyan.bold('\n📚 Cognitron Commands:'));
    console.log('');
    console.log(chalk.white('Chat Commands:'));
    console.log('  Just type your message to chat with the AI');
    console.log('  The AI has persistent memory across conversations');
    console.log('');
    console.log(chalk.white('System Commands:'));
    console.log('  /help         Show this help message');
    console.log('  /memory       Show memory status and usage');
    console.log('  /status       Show system and server status');
    console.log('  /models       List available AI models');
    console.log('  /model [name] Show current model or switch to specified model');
    console.log('  /clear        Clear the screen');
    console.log('  /exit, /quit  Exit the chat');
    console.log('');
  }

  async showMemoryStatus() {
    try {
      const status = await this.memoryClient.getStatus();
      
      console.log(chalk.cyan('\n🧠 Memory System Status:'));
      console.log('────────────────────────────');
      console.log(`Working Context: ${chalk.white(status.working_context_size || 0)} entries`);
      console.log(`Conversation Queue: ${chalk.white(status.fifo_queue_size || 0)} messages`);
      console.log(`Total Messages: ${chalk.white(status.total_messages || 0)}`);
      console.log(`Archival Storage: ${chalk.white(status.archival_storage_size || 0)} entries`);
      console.log(`Memory Usage: ${chalk.white(status.memory_usage || 0)}%`);
      
      if (status.memory_usage > 80) {
        console.log(chalk.yellow('⚠️  High memory usage - older conversations may be archived'));
      }
      console.log('');
    } catch (error) {
      console.log(chalk.red(`Failed to get memory status: ${error.message}`));
    }
  }

  async showSystemStatus() {
    try {
      const serverUrl = this.config.get('serverUrl');
      console.log(chalk.cyan('\n🌐 System Status:'));
      console.log('────────────────────');
      console.log(`Server URL: ${chalk.white(serverUrl)}`);
      
      // Test server connectivity
      const response = await fetch(serverUrl);
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Server: ${chalk.green(data.name || 'Cognitron06')} v${data.version || '1.0'}`);
        console.log(`Status: ${chalk.green(data.status || 'running')}`);
      } else {
        console.log(`❌ Server: ${chalk.red(`${response.status} ${response.statusText}`)}`);
      }
      
      // Authentication status
      const savedToken = await this.config.getSecure('accessToken');
      if (savedToken) {
        try {
          const userInfo = await this.authClient.getUserInfo();
          console.log(`✅ Authentication: ${chalk.green(`Logged in as ${userInfo.username}`)}`);
          console.log(`Session: ${chalk.white(userInfo.session_id)}`);
        } catch (error) {
          console.log(`❌ Authentication: ${chalk.red('Token expired')}`);
        }
      } else {
        console.log(`❌ Authentication: ${chalk.red('Not logged in')}`);
      }
      
      console.log('');
    } catch (error) {
      console.log(chalk.red(`Failed to check system status: ${error.message}`));
    }
  }

  async showAvailableModels() {
    try {
      const modelsData = await this.modelsClient.getAvailableModels();
      console.log(chalk.cyan('\n🤖 Available Models:'));
      console.log('─'.repeat(50));
      
      if (modelsData.available_models && Array.isArray(modelsData.available_models)) {
        modelsData.available_models.forEach(model => {
          const current = model.model === modelsData.current_model ? chalk.green('●') : '○';
          console.log(`${current} ${chalk.white(model.display_name)}`);
          console.log(`   ${chalk.gray(model.description)}`);
          console.log(`   ${chalk.blue(`Optimal for: ${model.optimal_use_cases.join(', ')}`)}`);
          console.log('');
        });
      } else {
        console.log(chalk.yellow('No models data available'));
        console.log(chalk.gray('Raw response:'), JSON.stringify(modelsData, null, 2));
      }
    } catch (error) {
      console.log(chalk.red(`Failed to get available models: ${error.message}`));
    }
  }

  async showCurrentModel() {
    try {
      const modelInfo = await this.modelsClient.getCurrentModel();
      console.log(chalk.cyan('\n🤖 Current Model:'));
      console.log('─'.repeat(30));
      console.log(`Name: ${chalk.white(modelInfo.display_name)}`);
      console.log(`Model: ${chalk.gray(modelInfo.model)}`);
      console.log(`Description: ${modelInfo.description}`);
      console.log(`Optimal for: ${chalk.blue(modelInfo.optimal_use_cases.join(', '))}`);
      console.log('');
    } catch (error) {
      console.log(chalk.red(`Failed to get current model: ${error.message}`));
    }
  }

  async switchModel(modelName) {
    try {
      console.log(chalk.yellow(`🔄 Switching to model: ${modelName}...`));
      const result = await this.modelsClient.switchModel(modelName);
      console.log(chalk.green(`✅ Successfully switched to ${result.current_model}`));
      if (result.model_info) {
        console.log(chalk.cyan(`Optimal for: ${result.model_info.optimal_use_cases.join(', ')}`));
      }
    } catch (error) {
      console.log(chalk.red(`Failed to switch model: ${error.message}`));
    }
  }

  gracefulExit() {
    console.log(chalk.yellow('\n👋 Thanks for using Cognitron! Goodbye!'));
    process.exit(0);
  }
}

// Setup Commander.js
const program = new Command();

program
  .name('cognitron')
  .description('🧠 Cognitron AI Assistant - Advanced CLI with persistent memory')
  .version('2.0.0')
  .option('-s, --server <url>', 'server URL', 'http://localhost:8000')
  .option('-m, --model <name>', 'AI model to use')
  .option('-v, --verbose', 'verbose output with tool calls')
  .option('-u, --show-usage', 'show token usage statistics')
  .option('--force-login', 'force new login session')
  .option('--quiet', 'suppress non-essential output');

program
  .command('chat')
  .description('Start interactive chat session (default)')
  .action(async (options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI();
    
    try {
      await cli.initialize();
      
      // Set server URL if provided
      if (globalOptions.server) {
        cli.config.set('serverUrl', globalOptions.server);
      }
      
      const authenticated = await cli.authenticate(globalOptions);
      if (!authenticated) {
        console.log(chalk.red('❌ Authentication failed. Please check your server connection.'));
        process.exit(1);
      }
      
      await cli.startInteractiveChat({
        ...globalOptions,
        model: globalOptions.model,
        verbose: globalOptions.verbose,
        showUsage: globalOptions.showUsage
      });
      
    } catch (error) {
      console.error(chalk.red(`CLI Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('ask <question>')
  .description('Ask a single question and exit')
  .action(async (question, options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI();
    
    try {
      await cli.initialize();
      
      if (globalOptions.server) {
        cli.config.set('serverUrl', globalOptions.server);
      }
      
      const authenticated = await cli.authenticate({ ...globalOptions, quiet: true });
      if (!authenticated) {
        console.log(chalk.red('❌ Authentication failed'));
        process.exit(1);
      }
      
      if (globalOptions.model) {
        await cli.modelsClient.switchModel(globalOptions.model);
      }
      
      if (!globalOptions.quiet) {
        console.log(chalk.dim('🤖 Processing...'));
      }
      
      const response = await cli.chatClient.sendMessage(question);
      
      if (response.content) {
        console.log(response.content);
      }
      
      if (globalOptions.showUsage && response.usage) {
        console.log(chalk.gray(`\nTokens: ${response.usage.total_tokens}`));
      }
      
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show system status')
  .action(async (options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI();
    
    try {
      await cli.initialize();
      
      if (globalOptions.server) {
        cli.config.set('serverUrl', globalOptions.server);
      }
      
      await cli.authenticate({ ...globalOptions, quiet: true });
      await cli.showSystemStatus();
      
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('models')
  .description('List available AI models')
  .action(async (options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI();
    
    try {
      await cli.initialize();
      
      if (globalOptions.server) {
        cli.config.set('serverUrl', globalOptions.server);
      }
      
      await cli.authenticate({ ...globalOptions, quiet: true });
      await cli.showAvailableModels();
      
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Make chat the default action
program
  .action(async (options) => {
    // Default action - start interactive chat
    const cli = new CognitronCLI();
    
    try {
      await cli.initialize();
      
      if (options.server) {
        cli.config.set('serverUrl', options.server);
      }
      
      const authenticated = await cli.authenticate(options);
      if (!authenticated) {
        console.log(chalk.red('❌ Authentication failed. Please check your server connection.'));
        process.exit(1);
      }
      
      await cli.startInteractiveChat(options);
      
    } catch (error) {
      console.error(chalk.red(`CLI Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();