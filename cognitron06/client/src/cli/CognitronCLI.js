#!/usr/bin/env node

/**
 * Cognitron CLI - Enhanced command-line interface using the Cognitron SDK
 * Professional CLI wrapper that provides a user-friendly interface to the SDK
 */

import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import process from 'process';
import { CognitronSDK } from '../core/CognitronSDK.js';
import { UIRenderer } from './ui/UIRenderer.js';

export class CognitronCLI {
  constructor(options = {}) {
    this.options = {
      serverUrl: options.serverUrl || 'http://localhost:8000',
      debug: options.debug || false,
      enableStreaming: options.enableStreaming !== false,
      autoLogin: options.autoLogin !== false,
      credentials: options.credentials || { username: 'demo', password: 'demo123' },
      ...options
    };
    
    // Initialize SDK
    this.sdk = new CognitronSDK(this.options);
    
    // Initialize UI renderer
    this.ui = new UIRenderer();
    
    // CLI state
    this.rl = null;
    this.isRunning = false;
    this.commandHistory = [];
    this.sessionStartTime = new Date();
    
    // Setup SDK event listeners
    this._setupSDKEventListeners();
  }

  /**
   * Setup SDK event listeners for debugging and monitoring
   * @private
   */
  _setupSDKEventListeners() {
    if (this.options.debug) {
      // Auth events
      this.sdk.auth.on('auth_error', (error) => {
        this.ui.displayError(`Authentication error: ${error.message}`);
      });
      
      // Chat events
      this.sdk.chat.on('message_sent', ({ message }) => {
        console.log(chalk.dim(`[DEBUG] Message sent: ${message.substring(0, 50)}...`));
      });
      
      this.sdk.chat.on('response_received', (response) => {
        console.log(chalk.dim(`[DEBUG] Response received: ${response.content ? response.content.substring(0, 50) + '...' : 'No content'}`));
      });
      
      // Memory events
      this.sdk.memory.on('search_completed', ({ query, results }) => {
        console.log(chalk.dim(`[DEBUG] Memory search: "${query}" returned ${results.total_count || 0} results`));
      });
      
      // Model events
      this.sdk.models.on('model_switched', ({ new_model }) => {
        console.log(chalk.dim(`[DEBUG] Switched to model: ${new_model}`));
      });
    }
  }

  /**
   * Initialize the CLI
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      await this.sdk.initialize(this.options);
      
      if (this.options.debug) {
        this.ui.displayInfo('SDK initialized successfully');
      }
    } catch (error) {
      this.ui.displayError(`Failed to initialize CLI: ${error.message}`);
      throw error;
    }
  }

  /**
   * Authenticate with the server
   * @param {Object} options - Authentication options
   * @returns {Promise<boolean>} Success status
   */
  async authenticate(options = {}) {
    try {
      const result = await this.sdk.authenticate(
        options.credentials || this.options.credentials,
        options.force || false
      );
      
      if (result.success) {
        const typeText = {
          'existing_token': 'Using cached session',
          'saved_token': 'Restored saved session',
          'new_login': `Logged in as ${result.user.username}`
        }[result.type] || 'Authenticated successfully';
        
        this.ui.displaySuccess(typeText);
        return true;
      }
      
      return false;
    } catch (error) {
      if (!options.quiet) {
        this.ui.displayError(`Authentication failed: ${error.message}`);
      }
      return false;
    }
  }

  /**
   * Start interactive chat session
   * @param {Object} options - Chat options
   * @returns {Promise<void>}
   */
  async startInteractiveChat(options = {}) {
    // Display welcome message
    this.ui.displayWelcome();
    
    console.log(chalk.gray(`Server: ${this.sdk.config.serverUrl}`));
    
    // Switch model if requested
    if (options.model) {
      try {
        await this.sdk.switchModel(options.model);
        this.ui.displaySuccess(`Using model: ${options.model}`);
      } catch (error) {
        this.ui.displayWarning(`Could not switch to model ${options.model}: ${error.message}`);
      }
    }

    // Show system status
    try {
      const status = await this.sdk.getSystemStatus();
      if (status.memory && !status.memory.error) {
        const memoryInfo = status.memory;
        console.log(chalk.blue(`📊 Memory: ${memoryInfo.total_messages || 0} messages, ${Math.round((memoryInfo.memory_pressure || 0) * 100)}% usage`));
      }
      
      if (status.models && !status.models.error) {
        console.log(chalk.blue(`🤖 Model: ${status.models.display_name || status.models.model || 'Unknown'}`));
      }
    } catch (error) {
      if (this.options.debug) {
        this.ui.displayWarning(`Could not fetch system status: ${error.message}`);
      }
    }

    this.ui.displayInfo('Chat started! Use ↑/↓ arrows for history.');
    this.ui.showCommands();
    console.log('');
    
    this._setupReadlineInterface(options);
  }

  /**
   * Setup readline interface for interactive chat
   * @private
   */
  _setupReadlineInterface(options) {
    // Create readline interface - simple approach for better compatibility
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> '),
      // Enable history
      historySize: 100
    });

    this.isRunning = true;
    this._setupEventHandlers(options);
    this.rl.prompt();
  }

  /**
   * Setup readline event handlers
   * @private
   */
  _setupEventHandlers(options) {
    this.rl.on('line', async (input) => {
      if (!this.isRunning) return;
      
      const message = input.trim();
      if (!message) {
        this.rl.prompt();
        return;
      }

      // Add to history if it's not a duplicate
      if (this.commandHistory[this.commandHistory.length - 1] !== message) {
        this.commandHistory.push(message);
        if (this.commandHistory.length > 100) {
          this.commandHistory = this.commandHistory.slice(-100);
        }
      }

      await this._handleInput(message, options);
    });

    this.rl.on('close', () => {
      this._gracefulExit();
    });

    this.rl.on('SIGINT', () => {
      console.log(chalk.yellow('\n👋 Use /exit to quit or Ctrl+C again to force exit'));
      this.rl.prompt();
    });

    // Setup signal handlers
    process.on('SIGINT', () => {
      if (!this.isRunning) {
        process.exit(0);
      }
    });
  }

  /**
   * Handle user input (commands or chat messages)
   * @private
   */
  async _handleInput(input, options) {
    try {
      // Handle slash commands
      if (input.startsWith('/')) {
        await this._handleSlashCommand(input, options);
        this.rl.prompt();
        return;
      }

      // Handle chat messages
      await this._handleChatMessage(input, options);
      
    } catch (error) {
      this.ui.displayError(`Error: ${error.message}`);
    }

    console.log('');
    this.rl.prompt();
  }

  /**
   * Handle slash commands
   * @private
   */
  async _handleSlashCommand(command, options) {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'help':
        this.ui.displayHelp();
        break;
        
      case 'status':
        await this._showSystemStatus();
        break;
        
      case 'memory':
        await this._showMemoryStatus();
        break;
        
      case 'search':
        if (args.length > 0) {
          await this._searchMemory(args.join(' '));
        } else {
          this.ui.displayError('Usage: /search <query>');
        }
        break;
        
      case 'models':
        await this._showAvailableModels();
        break;
        
      case 'model':
        if (args.length === 0) {
          await this._showCurrentModel();
        } else {
          await this._switchModel(args[0]);
        }
        break;

      case 'history':
        this._showCommandHistory();
        break;
        
      case 'clear':
        console.clear();
        this.ui.displayWelcome();
        console.log(chalk.gray('History navigation: ↑/↓ arrows'));
        console.log('');
        break;
        
      case 'export':
        await this._exportMemory(args);
        break;
        
      case 'sessions':
        await this._showSessions();
        break;
        
      case 'context':
        await this._showWorkingContext();
        break;
        
      case 'verbose':
        this._toggleVerbose(args, options);
        break;
        
      case 'logout':
        await this._logout();
        break;
        
      case 'exit':
      case 'quit':
        this._gracefulExit();
        break;
        
      default:
        this.ui.displayError(`Unknown command: ${cmd}`);
        console.log(chalk.gray('Type /help for available commands'));
    }
  }

  /**
   * Handle chat messages
   * @private
   */
  async _handleChatMessage(message, options) {
    try {
      console.log(chalk.dim('🤖 Processing...'));
      
      if (options.stream && this.sdk.config.enableStreaming) {
        // Use streaming
        let fullResponse = '';
        const response = await this.sdk.streamChat(message, {
          onChunk: (chunk) => {
            process.stdout.write(chunk);
            fullResponse += chunk;
          },
          onThinking: (thinking) => {
            if (options.verbose) {
              console.log(chalk.gray(`\n💭 Thinking: ${thinking}`));
              console.log(chalk.yellow('🤖 AI: '), { end: '' });
            }
          },
          onToolCall: (toolCall) => {
            if (options.verbose) {
              this.ui.displayToolCall(toolCall);
            }
          },
          onStart: () => {
            console.log(chalk.dim('\r🤖 '));
          }
        });
        
        if (!fullResponse && response.tool_calls?.length > 0) {
          this.ui.displayInfo('AI performed actions but provided no response text');
        }
        
      } else {
        // Use regular API call
        const response = await this.sdk.sendMessage(message);
        
        // Show thinking if available and verbose mode is on
        if (response.thinking && options.verbose) {
          console.log(chalk.gray(`💭 Thinking: ${response.thinking}`));
          console.log('');
        }
        
        if (response.content) {
          if (response.content === "I've updated my memory based on our conversation.") {
            this.ui.displaySuccess('Memory updated - AI is ready for your next message!');
          } else {
            this.ui.displayResponse(response.content);
          }
        } else {
          this.ui.displayWarning('AI performed actions but provided no response text');
        }
        
        // Show tool calls if verbose
        if (options.verbose && response.tool_calls?.length > 0) {
          response.tool_calls.forEach(toolCall => {
            this.ui.displayToolCall(toolCall);
          });
        }
        
        // Show token usage if requested
        if (options.showUsage && response.usage) {
          this.ui.displayUsage(response.usage);
        }
      }
      
    } catch (error) {
      this.ui.displayError(error.message);
      if (error.message.includes('Authentication expired')) {
        console.log(chalk.yellow('💡 Try logging in again with /logout followed by restarting'));
      }
    }
  }

  // Command implementations

  async _showSystemStatus() {
    try {
      const status = await this.sdk.getSystemStatus();
      
      console.log(chalk.cyan('\n🌐 System Status:'));
      console.log('────────────────────');
      console.log(`Server URL: ${chalk.white(this.sdk.config.serverUrl)}`);
      console.log(`SDK Version: ${chalk.white(this.sdk.version)}`);
      console.log(`Session Duration: ${chalk.white(this._getSessionDuration())}`);
      
      if (status.user && !status.user.error) {
        console.log(`✅ User: ${chalk.green(status.user.username)}`);
        if (status.user.session_id) {
          console.log(`Session: ${chalk.white(status.user.session_id)}`);
        }
      }
      
      if (status.models && !status.models.error) {
        console.log(`🤖 Model: ${chalk.white(status.models.display_name || status.models.model)}`);
      }
      
      console.log(`Commands in history: ${chalk.white(this.commandHistory.length)}`);
      console.log('');
    } catch (error) {
      this.ui.displayError(`Failed to get system status: ${error.message}`);
    }
  }

  async _showMemoryStatus() {
    try {
      const status = await this.sdk.getMemoryStatus();
      this.ui.displayMemoryStatus(status);
    } catch (error) {
      this.ui.displayError(`Failed to get memory status: ${error.message}`);
    }
  }

  async _searchMemory(query) {
    try {
      console.log(chalk.dim(`🔍 Searching for: "${query}"...`));
      const results = await this.sdk.searchMemory(query, { maxResults: 10 });
      this.ui.displaySearchResults(results);
    } catch (error) {
      this.ui.displayError(`Search failed: ${error.message}`);
    }
  }

  async _showAvailableModels() {
    try {
      const models = await this.sdk.getAvailableModels();
      console.log(chalk.cyan('\n🤖 Available Models:'));
      console.log('─'.repeat(50));
      
      if (models.available_models && Array.isArray(models.available_models)) {
        models.available_models.forEach(model => {
          const current = model.model === models.current_model ? chalk.green('●') : '○';
          console.log(`${current} ${chalk.white(model.display_name || model.model)}`);
          if (model.description) {
            console.log(`   ${chalk.gray(model.description)}`);
          }
          if (model.optimal_use_cases) {
            console.log(`   ${chalk.blue(`Optimal for: ${model.optimal_use_cases.join(', ')}`)}`);
          }
          console.log('');
        });
      }
    } catch (error) {
      this.ui.displayError(`Failed to get models: ${error.message}`);
    }
  }

  async _showCurrentModel() {
    try {
      const model = await this.sdk.getCurrentModel();
      console.log(chalk.cyan('\n🤖 Current Model:'));
      console.log('─'.repeat(30));
      console.log(`Name: ${chalk.white(model.display_name || model.model)}`);
      if (model.description) {
        console.log(`Description: ${model.description}`);
      }
      if (model.optimal_use_cases) {
        console.log(`Optimal for: ${chalk.blue(model.optimal_use_cases.join(', '))}`);
      }
      console.log('');
    } catch (error) {
      this.ui.displayError(`Failed to get current model: ${error.message}`);
    }
  }

  async _switchModel(modelName) {
    try {
      console.log(chalk.yellow(`🔄 Switching to model: ${modelName}...`));
      const result = await this.sdk.switchModel(modelName);
      this.ui.displaySuccess(`Successfully switched to ${result.current_model || modelName}`);
    } catch (error) {
      this.ui.displayError(`Failed to switch model: ${error.message}`);
    }
  }

  _showCommandHistory() {
    console.log(chalk.cyan('\n📜 Command History:'));
    console.log('─'.repeat(30));
    
    if (this.commandHistory.length === 0) {
      console.log(chalk.gray('No commands in history yet'));
    } else {
      const recent = this.commandHistory.slice(-10);
      recent.forEach((cmd, index) => {
        const number = this.commandHistory.length - recent.length + index + 1;
        console.log(`${chalk.gray(number.toString().padStart(3))}: ${cmd}`);
      });
      
      if (this.commandHistory.length > 10) {
        console.log(chalk.gray(`... and ${this.commandHistory.length - 10} more commands`));
      }
    }
    console.log(chalk.gray('Use ↑/↓ arrow keys to navigate history'));
    console.log('');
  }

  async _showWorkingContext() {
    try {
      const context = await this.sdk.memory.getWorkingContext();
      this.ui.displayWorkingContext(context);
    } catch (error) {
      this.ui.displayError(`Failed to get working context: ${error.message}`);
    }
  }

  async _showSessions() {
    try {
      const sessions = await this.sdk.memory.getSessions();
      this.ui.displaySessions(sessions);
    } catch (error) {
      this.ui.displayError(`Failed to get sessions: ${error.message}`);
    }
  }

  async _exportMemory(args) {
    try {
      const format = args[0] || 'json';
      console.log(chalk.dim(`📦 Exporting memory in ${format} format...`));
      const data = await this.sdk.memory.exportMemory({ format });
      console.log(chalk.green(`✅ Memory exported: ${JSON.stringify(data, null, 2)}`));
    } catch (error) {
      this.ui.displayError(`Export failed: ${error.message}`);
    }
  }

  async _logout() {
    try {
      await this.sdk.logout();
      this.ui.displaySuccess('Logged out successfully');
      this._gracefulExit();
    } catch (error) {
      this.ui.displayError(`Logout failed: ${error.message}`);
    }
  }

  // Command implementations continued...

  _toggleVerbose(args, options) {
    const arg = args[0]?.toLowerCase();
    
    if (arg === 'on' || arg === 'true') {
      options.verbose = true;
      this.ui.displaySuccess('Verbose mode enabled - showing reasoning & tool calls');
    } else if (arg === 'off' || arg === 'false') {
      options.verbose = false;
      this.ui.displaySuccess('Verbose mode disabled - clean responses only');
    } else {
      // Toggle
      options.verbose = !options.verbose;
      if (options.verbose) {
        this.ui.displaySuccess('Verbose mode enabled - showing reasoning & tool calls');
      } else {
        this.ui.displaySuccess('Verbose mode disabled - clean responses only');
      }
    }
    
    console.log(chalk.dim(`Current state: ${options.verbose ? 'ON' : 'OFF'}`));
    console.log(chalk.dim('Usage: /verbose [on|off] or just /verbose to toggle'));
    console.log('');
  }

  // Utility methods

  _getSessionDuration() {
    const duration = Date.now() - this.sessionStartTime.getTime();
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  _gracefulExit() {
    console.log(chalk.yellow('\n👋 Thanks for using Cognitron! Goodbye!'));
    this.isRunning = false;
    
    if (this.rl) {
      this.rl.close();
    }
    
    // Close SDK resources
    this.sdk.close().finally(() => {
      process.exit(0);
    });
  }

  // Public API for programmatic usage

  /**
   * Ask a single question and exit
   * @param {string} question - Question to ask
   * @param {Object} options - Options
   * @returns {Promise<Object>} Response
   */
  async ask(question, options = {}) {
    try {
      if (!this.sdk.isInitialized) {
        await this.initialize();
      }
      
      if (!this.sdk.isAuthenticated) {
        const authenticated = await this.authenticate({ quiet: true });
        if (!authenticated) {
          throw new Error('Authentication failed');
        }
      }
      
      if (options.model) {
        await this.sdk.switchModel(options.model);
      }
      
      const response = await this.sdk.sendMessage(question, options);
      return response;
      
    } catch (error) {
      throw new Error(`Ask command failed: ${error.message}`);
    }
  }
}