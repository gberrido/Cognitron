#!/usr/bin/env node

/**
 * Simple, Working Cognitron CLI
 * No readline - uses raw process.stdin for guaranteed compatibility
 */

import chalk from 'chalk';
import process from 'process';
import fetch from 'node-fetch';
import { ChatClient } from './src/chat.js';
import { AuthClient } from './src/auth.js';
import { ConfigManager } from './src/config.js';

class SimpleCLI {
  constructor() {
    this.config = new ConfigManager();
    this.authClient = null;
    this.chatClient = null;
    this.isRunning = false;
    this.inputBuffer = '';
  }

  async start() {
    console.log(chalk.cyan('🧠 Simple Cognitron CLI'));
    console.log(chalk.gray('Built for reliability - no complex readline dependencies'));
    console.log('');

    try {
      await this.config.load();
      
      const serverUrl = this.config.get('serverUrl');
      this.authClient = new AuthClient(serverUrl);
      this.chatClient = new ChatClient(serverUrl);

      // Try to authenticate
      const savedToken = await this.config.getSecure('accessToken');
      if (savedToken) {
        try {
          const userInfo = await this.authClient.validateToken(savedToken);
          this.authClient.setToken(savedToken);
          this.chatClient.setToken(savedToken);
          console.log(chalk.green(`✅ Welcome back, ${userInfo.username}!`));
        } catch (error) {
          console.log(chalk.red('❌ Session expired. Please restart and login.'));
          process.exit(1);
        }
      } else {
        console.log(chalk.red('❌ Not logged in. Please run the full CLI first to login.'));
        process.exit(1);
      }

      this.startChat();
      
    } catch (error) {
      console.error(chalk.red(`Failed to start: ${error.message}`));
      process.exit(1);
    }
  }

  startChat() {
    this.isRunning = true;
    
    console.log(chalk.cyan('\n💬 Chat started! Type your messages and press Enter.'));
    console.log(chalk.gray('Commands: /exit to quit, /help for help'));
    console.log('');
    
    // Setup stdin handling
    process.stdin.setEncoding('utf8');
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false); // Line mode, not raw mode
    }
    
    process.stdin.on('readable', () => {
      let chunk;
      while (null !== (chunk = process.stdin.read())) {
        this.inputBuffer += chunk;
        
        // Check for complete lines
        const lines = this.inputBuffer.split('\n');
        this.inputBuffer = lines.pop(); // Keep incomplete line in buffer
        
        // Process complete lines
        lines.forEach(line => {
          this.handleInput(line.trim());
        });
      }
    });
    
    process.stdin.on('end', () => {
      console.log(chalk.yellow('\n👋 Goodbye!'));
      process.exit(0);
    });

    // Handle Ctrl+C
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n👋 Goodbye!'));
      process.exit(0);
    });
    
    this.showPrompt();
  }

  showPrompt() {
    process.stdout.write(chalk.cyan('> '));
  }

  async handleInput(input) {
    if (!input) {
      this.showPrompt();
      return;
    }

    // Handle commands
    if (input.startsWith('/')) {
      await this.handleCommand(input);
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
          console.log(chalk.green(`✓ Memory updated - ready for your next message!`));
        } else {
          console.log(chalk.white(response.content));
        }
      } else {
        console.log(chalk.yellow('(AI performed actions but provided no response text)'));
      }
      
      // Display tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        response.tool_calls.forEach(toolCall => {
          const name = toolCall.function?.name || toolCall.name || 'Unknown';
          console.log(chalk.blue(`🔧 Tool: ${name}`));
        });
      }
      
      // Display usage
      if (response.usage) {
        const { total_tokens, prompt_tokens, completion_tokens } = response.usage;
        console.log(chalk.gray(`📊 Token Usage: ${total_tokens} total (${prompt_tokens} prompt + ${completion_tokens} completion)`));
      }
      
    } catch (error) {
      console.log(chalk.red(`❌ Error: ${error.message}`));
      if (error.message.includes('Failed to process message')) {
        console.log(chalk.yellow('💡 This might be a temporary server issue. Try your message again.'));
      }
    }

    console.log(''); // Empty line for readability
    this.showPrompt();
  }

  async handleCommand(command) {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();

    switch (cmd) {
      case 'exit':
      case 'quit':
        console.log(chalk.yellow('👋 Goodbye!'));
        process.exit(0);
        break;
        
      case 'help':
        console.log(chalk.cyan('\n📚 Available Commands:'));
        console.log('  /exit, /quit - Exit the chat');
        console.log('  /help - Show this help message');
        console.log('  /memory - Show memory status');
        console.log('  /status - Show server status');
        console.log('  Just type your message to chat with the AI!');
        console.log('');
        break;
        
      case 'memory':
        await this.showMemoryStatus();
        break;
        
      case 'status':
        await this.showServerStatus();
        break;
        
      default:
        console.log(chalk.red(`Unknown command: ${cmd}. Type /help for available commands.`));
    }
  }

  async showMemoryStatus() {
    try {
      // Create a temporary memory client to get status
      const { MemoryClient } = await import('./src/memory.js');
      const memoryClient = new MemoryClient(this.config.get('serverUrl'));
      
      const savedToken = await this.config.getSecure('accessToken');
      if (savedToken) {
        memoryClient.setToken(savedToken);
        const status = await memoryClient.getStatus();
        
        console.log(chalk.cyan('\n🧠 Memory Status:'));
        console.log('────────────────────');
        console.log(`Working Context: ${status.working_context_size || 0} entries`);
        console.log(`Conversation Queue: ${status.fifo_queue_size || 0} messages`);
        console.log(`Total Messages: ${status.total_messages || 0}`);
        console.log(`Archival Storage: ${status.archival_storage_size || 0} entries`);
        console.log(`Memory Usage: ${status.memory_usage || 0}%`);
        console.log('');
      } else {
        console.log(chalk.red('❌ Not authenticated - cannot access memory'));
      }
    } catch (error) {
      console.log(chalk.red(`Failed to get memory status: ${error.message}`));
    }
  }

  async showServerStatus() {
    try {
      const serverUrl = this.config.get('serverUrl');
      console.log(chalk.cyan('\n🌐 Server Status:'));
      console.log('────────────────────');
      console.log(`Server URL: ${serverUrl}`);
      
      // Test server connectivity
      const response = await fetch(serverUrl);
      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Server: ${data.name || 'Unknown'} v${data.version || '?'}`);
        console.log(`Status: ${data.status || 'Unknown'}`);
      } else {
        console.log(`❌ Server responded with: ${response.status} ${response.statusText}`);
      }
      
      // Test authentication
      const savedToken = await this.config.getSecure('accessToken');
      if (savedToken) {
        console.log('✅ Authentication: Token available');
      } else {
        console.log('❌ Authentication: No token');
      }
      
      console.log('');
    } catch (error) {
      console.log(chalk.red(`Failed to check server status: ${error.message}`));
    }
  }
}

const cli = new SimpleCLI();
cli.start().catch(error => {
  console.error('CLI Error:', error.message);
  process.exit(1);
});