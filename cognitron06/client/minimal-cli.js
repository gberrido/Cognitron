#!/usr/bin/env node

/**
 * Minimal CLI to test the conversation loop issue
 */

import readline from 'readline';
import { ChatClient } from './src/chat.js';
import { AuthClient } from './src/auth.js';
import { ConfigManager } from './src/config.js';
import chalk from 'chalk';

class MinimalCLI {
  constructor() {
    this.config = new ConfigManager();
    this.authClient = new AuthClient('http://localhost:8000');
    this.chatClient = new ChatClient('http://localhost:8000');
    this.isRunning = false;
  }

  async start() {
    console.log(chalk.cyan('🧠 Minimal Cognitron CLI Test'));
    console.log('');

    // Login
    const savedToken = await this.config.getSecure('accessToken');
    if (savedToken) {
      try {
        const userInfo = await this.authClient.validateToken(savedToken);
        this.authClient.setToken(savedToken);
        this.chatClient.setToken(savedToken);
        console.log(chalk.green(`✅ Welcome back, ${userInfo.username}!`));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Session expired, please restart and login'));
        process.exit(1);
      }
    } else {
      console.log(chalk.red('❌ No saved session found. Please run the full CLI first to login.'));
      process.exit(1);
    }

    // Start conversation loop
    this.startConversation();
  }

  startConversation() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> '),
      terminal: true  // Fix: Force terminal mode for non-TTY environments
    });

    this.isRunning = true;
    console.log('Starting conversation loop...');
    rl.prompt();

    rl.on('line', async (input) => {
      const message = input.trim();
      
      if (!message) {
        rl.prompt();
        return;
      }

      if (message === '/exit') {
        console.log('👋 Goodbye!');
        rl.close();
        process.exit(0);
        return;
      }

      try {
        console.log(chalk.dim('🤖 Processing...'));
        
        // Send message and get response
        const response = await this.chatClient.sendMessage(message);
        
        // Display response
        if (response.content) {
          console.log(chalk.green(response.content));
        } else {
          console.log(chalk.yellow('(No response content)'));
        }
        
        // Display tool calls
        if (response.tool_calls && response.tool_calls.length > 0) {
          console.log(chalk.blue(`🔧 ${response.tool_calls.length} tool calls executed`));
        }
        
        console.log(''); // Empty line
        
      } catch (error) {
        console.log(chalk.red(`❌ Error: ${error.message}`));
      }
      
      // Critical: Always prompt for next input
      console.log('About to call rl.prompt()...');
      rl.prompt();
      console.log('Called rl.prompt()');
    });

    rl.on('close', () => {
      console.log('Readline closed');
      this.isRunning = false;
      process.exit(0);
    });

    rl.on('SIGINT', () => {
      console.log('\nReceived SIGINT');
      rl.close();
    });
  }
}

const cli = new MinimalCLI();
cli.start().catch(error => {
  console.error('CLI Error:', error.message);
  process.exit(1);
});