#!/usr/bin/env node

/**
 * Cognitron06 CLI with Proper Readline History Support
 * Fixed arrow key handling for terminal compatibility
 */

import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import process from 'process';
import fetch from 'node-fetch';
import { ChatClient } from './src/chat.js';
import { AuthClient } from './src/auth.js';
import { MemoryClient } from './src/memory.js';
import { ModelsClient } from './src/models.js';
import { ConfigManager } from './src/config.js';

class CognitronFixedCLI {
  constructor() {
    this.config = new ConfigManager();
    this.authClient = null;
    this.chatClient = null;
    this.memoryClient = null;
    this.modelsClient = null;
    this.rl = null;
    this.isRunning = false;
    this.commandHistory = [];
    this.historyIndex = -1;
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
    
    // Auto-login with demo credentials
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
    console.log(chalk.gray('Enhanced CLI with history navigation (↑/↓ arrows work!)'));
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
      console.log(chalk.blue(`📊 Memory: ${memoryStatus.total_messages || 0} messages, ${memoryStatus.memory_usage || 0}% usage`));
    } catch (error) {
      // Ignore memory status errors
    }

    console.log(chalk.cyan('\n💬 Chat started! Use ↑/↓ arrows for history. Commands:'));
    console.log(chalk.gray('  /help     - Show help'));
    console.log(chalk.gray('  /memory   - Memory status'));
    console.log(chalk.gray('  /models   - Available models'));
    console.log(chalk.gray('  /status   - System status'));
    console.log(chalk.gray('  /history  - Show command history'));
    console.log(chalk.gray('  /clear    - Clear screen'));
    console.log(chalk.gray('  /exit     - Exit chat'));
    console.log('');
    
    this.setupProperReadline(options);
  }

  setupProperReadline(options) {
    // Force proper terminal settings for readline
    if (process.stdin.isTTY === undefined) {
      process.stdin.isTTY = true;
    }
    if (process.stdout.isTTY === undefined) {
      process.stdout.isTTY = true;
    }

    // Create readline interface with explicit settings
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,  // Force terminal mode
      historySize: 100,  // Enable history
      removeHistoryDuplicates: true,
      prompt: chalk.cyan('> '),
      completer: this.getCompleter()
    });

    // Override the _normalWrite method to properly handle escape sequences
    if (this.rl.input._normalWrite) {
      const originalNormalWrite = this.rl.input._normalWrite;
      this.rl.input._normalWrite = (chunk) => {
        // Handle arrow key sequences
        const str = chunk.toString();
        if (str === '\u001b[A') { // Up arrow
          this.navigateHistory('up');
          return;
        } else if (str === '\u001b[B') { // Down arrow  
          this.navigateHistory('down');
          return;
        }
        return originalNormalWrite.call(this.rl.input, chunk);
      };
    }

    // Enable keypress events for better arrow key handling
    if (process.stdin.setRawMode) {
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false); // We want line mode, not raw mode
      }
    }

    this.isRunning = true;
    this.setupEventHandlers(options);
    
    // Display initial prompt
    this.rl.prompt();
  }

  navigateHistory(direction) {
    if (this.commandHistory.length === 0) return;
    
    if (direction === 'up') {
      if (this.historyIndex === -1) {
        this.historyIndex = this.commandHistory.length - 1;
      } else if (this.historyIndex > 0) {
        this.historyIndex--;
      }
    } else if (direction === 'down') {
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
      } else {
        this.historyIndex = -1;
        this.rl.line = '';
        this.rl.cursor = 0;
        this.rl._refreshLine();
        return;
      }
    }
    
    if (this.historyIndex >= 0 && this.historyIndex < this.commandHistory.length) {
      const historyCommand = this.commandHistory[this.historyIndex];
      this.rl.line = historyCommand;
      this.rl.cursor = historyCommand.length;
      this.rl._refreshLine();
    }
  }

  getCompleter() {
    const commands = [
      '/help', '/memory', '/status', '/models', '/model', '/history', '/clear', '/exit', '/quit'
    ];
    
    return (line) => {
      const hits = commands.filter((c) => c.startsWith(line));
      return [hits.length ? hits : commands, line];
    };
  }

  setupEventHandlers(options) {
    this.rl.on('line', async (input) => {
      if (!this.isRunning) return;
      
      const message = input.trim();
      if (!message) {
        this.rl.prompt();
        return;
      }

      // Add to history if it's not a duplicate of the last command
      if (this.commandHistory[this.commandHistory.length - 1] !== message) {
        this.commandHistory.push(message);
        // Keep history manageable
        if (this.commandHistory.length > 100) {
          this.commandHistory = this.commandHistory.slice(-100);
        }
      }
      
      // Reset history index
      this.historyIndex = -1;

      await this.handleInput(message, options);
    });

    this.rl.on('close', () => {
      this.gracefulExit();
    });

    this.rl.on('SIGINT', () => {
      console.log(chalk.yellow('\n👋 Use /exit to quit or Ctrl+C again to force exit'));
      this.rl.prompt();
    });

    // Setup signal handlers
    let sigintCount = 0;
    process.on('SIGINT', () => {
      sigintCount++;
      if (sigintCount >= 2) {
        console.log(chalk.red('\nForce exit'));
        process.exit(0);
      }
      setTimeout(() => { sigintCount = 0; }, 1000);
    });
  }

  async handleInput(input, options) {
    // Handle commands
    if (input.startsWith('/')) {
      await this.handleSlashCommand(input, options);
      this.rl.prompt();
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
    this.rl.prompt();
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

      case 'history':
        this.showCommandHistory();
        break;
        
      case 'clear':
        console.clear();
        console.log(chalk.cyan.bold('🧠 Cognitron AI Assistant'));
        console.log(chalk.gray('↑/↓ arrows work for history navigation!'));
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
    console.log(chalk.white('Navigation:'));
    console.log('  ↑/↓ Arrow Keys   Navigate command history (FIXED!)');
    console.log('  Tab              Auto-complete commands');
    console.log('  Ctrl+C           Show exit options');
    console.log('');
    console.log(chalk.white('Chat Commands:'));
    console.log('  Just type your message to chat with the AI');
    console.log('  The AI has persistent memory across conversations');
    console.log('');
    console.log(chalk.white('System Commands:'));
    console.log('  /help            Show this help message');
    console.log('  /memory          Show memory status and usage');
    console.log('  /status          Show system and server status');
    console.log('  /models          List available AI models');
    console.log('  /model [name]    Show current model or switch to specified model');
    console.log('  /history         Show command history');
    console.log('  /clear           Clear the screen');
    console.log('  /exit, /quit     Exit the chat');
    console.log('');
  }

  showCommandHistory() {
    console.log(chalk.cyan('\n📜 Command History:'));
    console.log('─'.repeat(30));
    
    if (this.commandHistory.length === 0) {
      console.log(chalk.gray('No commands in history yet'));
    } else {
      const recent = this.commandHistory.slice(-10);  // Show last 10 commands
      recent.forEach((cmd, index) => {
        const number = this.commandHistory.length - recent.length + index + 1;
        console.log(`${chalk.gray(number.toString().padStart(3))}: ${cmd}`);
      });
      
      if (this.commandHistory.length > 10) {
        console.log(chalk.gray(`... and ${this.commandHistory.length - 10} more commands`));
      }
    }
    console.log(chalk.green('Use ↑/↓ arrow keys to navigate history (NOW WORKING!)'));
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
      
      console.log(`Commands in history: ${chalk.white(this.commandHistory.length)}`);
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
    this.isRunning = false;
    if (this.rl) {
      this.rl.close();
    }
    process.exit(0);
  }
}

// Setup Commander.js
const program = new Command();

program
  .name('cognitron')
  .description('🧠 Cognitron AI Assistant - CLI with WORKING arrow key navigation!')
  .version('2.2.0')
  .option('-s, --server <url>', 'server URL', 'http://localhost:8000')
  .option('-m, --model <name>', 'AI model to use')
  .option('-v, --verbose', 'verbose output with tool calls')
  .option('-u, --show-usage', 'show token usage statistics')
  .option('--force-login', 'force new login session')
  .option('--quiet', 'suppress non-essential output');

program
  .command('chat')
  .description('Start interactive chat session with WORKING arrow keys (default)')
  .action(async (options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronFixedCLI();
    
    try {
      await cli.initialize();
      
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

// Add single question mode
program
  .command('ask <question>')
  .description('Ask a single question and exit')
  .action(async (question, options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronFixedCLI();
    
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

// Default action - start interactive chat
program
  .action(async (options) => {
    const cli = new CognitronFixedCLI();
    
    try {
      await cli.initialize();
      
      if (options.server) {
        cli.config.set('serverUrl', options.server);
      }
      
      const authenticated = await cli.authenticate(options);
      if (!authenticated) {
        console.log(chalk.red('❌ Authentication failed. Please check server connection.'));
        process.exit(1);
      }
      
      await cli.startInteractiveChat(options);
      
    } catch (error) {
      console.error(chalk.red(`CLI Error: ${error.message}`));
      process.exit(1);
    }
  });

program.parse();