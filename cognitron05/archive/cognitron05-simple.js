#!/usr/bin/env node

/**
 * Cognitron05 Simple - Streamlined version that actually works
 * Removes complex modular architecture in favor of direct, reliable implementation
 */

import { Groq } from 'groq-sdk';
import { Command } from 'commander';
import readline from 'readline';
import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { marked } from 'marked';

class SimpleCognitron {
  constructor() {
    this.config = {
      apiKey: this.getRequiredApiKey(),
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      maxTokens: 2000,
      dataDir: './cognitron-simple-data'
    };
    
    // Simple direct Groq client - no complex pooling
    this.groq = new Groq({ apiKey: this.config.apiKey });
    
    this.memory = {
      workingContext: new Map(),
      messages: [],
      sessionId: null
    };
    
    this.isRunning = false;
  }

  getRequiredApiKey() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error(
        'GROQ_API_KEY environment variable is required.\n' +
        'Set it with: export GROQ_API_KEY="your-api-key-here"'
      );
    }
    return apiKey.trim();
  }

  async ensureDataDirectory() {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist, ignore
    }
  }

  async loadMemory() {
    await this.ensureDataDirectory();
    
    try {
      // Load working context
      const contextFile = path.join(this.config.dataDir, 'context.json');
      const contextData = await fs.readFile(contextFile, 'utf8');
      const context = JSON.parse(contextData);
      this.memory.workingContext = new Map(Object.entries(context));
    } catch (error) {
      console.log('🆕 Starting with empty memory');
    }

    try {
      // Load recent messages
      const messagesFile = path.join(this.config.dataDir, 'messages.json');
      const messagesData = await fs.readFile(messagesFile, 'utf8');
      const data = JSON.parse(messagesData);
      this.memory.messages = data.messages || [];
      this.memory.sessionId = data.sessionId || this.generateSessionId();
    } catch (error) {
      this.memory.sessionId = this.generateSessionId();
    }
  }

  async saveMemory() {
    await this.ensureDataDirectory();
    
    // Save context
    const contextFile = path.join(this.config.dataDir, 'context.json');
    const contextObj = Object.fromEntries(this.memory.workingContext);
    await fs.writeFile(contextFile, JSON.stringify(contextObj, null, 2));
    
    // Save messages (keep last 50)
    const messagesFile = path.join(this.config.dataDir, 'messages.json');
    const recentMessages = this.memory.messages.slice(-50);
    await fs.writeFile(messagesFile, JSON.stringify({
      sessionId: this.memory.sessionId,
      messages: recentMessages,
      lastSaved: new Date().toISOString()
    }, null, 2));
  }

  generateSessionId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '').substring(0, 15);
    const random = Math.random().toString(36).substring(2, 8);
    return `session-${timestamp}-${random}`;
  }

  addMessage(role, content) {
    const message = {
      role,
      content,
      timestamp: new Date().toISOString(),
      id: Date.now().toString()
    };
    this.memory.messages.push(message);
    return message;
  }

  buildMessages() {
    const messages = [{
      role: 'system',
      content: `You are Cognitron05, an AI assistant with persistent memory.

Current session: ${this.memory.sessionId}
Working context: ${Array.from(this.memory.workingContext.entries())
  .map(([k, v]) => `${k}: ${v}`)
  .join(', ') || 'Empty'}

You can remember important facts about the user by saying "REMEMBER: key=value" in your response.
Always be helpful, concise, and remember what the user tells you.`
    }];

    // Add recent conversation (last 10 messages) - strip extra fields for API
    const recentMessages = this.memory.messages.slice(-10).map(msg => ({
      role: msg.role,
      content: msg.content
    }));
    messages.push(...recentMessages);

    return messages;
  }

  extractMemoryUpdates(content) {
    const rememberPattern = /REMEMBER:\s*(\w+)=(.+?)(?=\n|$)/gi;
    let match;
    const updates = [];

    while ((match = rememberPattern.exec(content)) !== null) {
      const key = match[1].trim();
      const value = match[2].trim();
      this.memory.workingContext.set(key, value);
      updates.push({ key, value });
    }

    return updates;
  }

  async generateResponse(userInput) {
    this.addMessage('user', userInput);
    
    try {
      const messages = this.buildMessages();
      
      const response = await this.groq.chat.completions.create({
        messages,
        model: this.config.model,
        temperature: this.config.temperature,
        max_tokens: this.config.maxTokens,
      });

      const assistantResponse = response.choices[0].message.content;
      this.addMessage('assistant', assistantResponse);

      // Extract and process memory updates
      const memoryUpdates = this.extractMemoryUpdates(assistantResponse);
      
      // Remove REMEMBER: lines from displayed response
      const cleanResponse = assistantResponse.replace(/REMEMBER:\s*\w+=.+?(\n|$)/gi, '').trim();

      return {
        content: cleanResponse,
        memoryUpdates,
        usage: {
          prompt_tokens: response.usage.prompt_tokens,
          completion_tokens: response.usage.completion_tokens,
          total_tokens: response.usage.total_tokens
        }
      };

    } catch (error) {
      console.error(chalk.red('API Error:'), error.message);
      return {
        content: "I'm having trouble connecting to my language service. Please try again.",
        memoryUpdates: [],
        usage: null
      };
    }
  }

  async handleCommand(input) {
    const command = input.toLowerCase();
    
    switch (command) {
      case '/exit':
      case '/quit':
        console.log(chalk.gray('\n💾 Saving memory...'));
        await this.saveMemory();
        console.log(chalk.green('✅ Memory saved. See you next time!'));
        console.log(chalk.gray('👋 Goodbye!'));
        return 'exit';
        
      case '/help':
        console.log(chalk.cyan('\n📚 Available Commands:'));
        console.log('  /help     - Show this help message');
        console.log('  /memory   - Show current memory');
        console.log('  /clear    - Clear conversation (keeps memory)');
        console.log('  /reset    - Reset all memory');
        console.log('  /exit     - Save and exit');
        return 'continue';
        
      case '/memory':
        console.log(chalk.cyan('\n🧠 Current Memory:'));
        console.log(chalk.gray(`Session: ${this.memory.sessionId}`));
        console.log(chalk.gray(`Messages: ${this.memory.messages.length}`));
        
        if (this.memory.workingContext.size > 0) {
          console.log(chalk.yellow('Working Context:'));
          for (const [key, value] of this.memory.workingContext) {
            console.log(`  ${key}: ${value}`);
          }
        } else {
          console.log(chalk.gray('Working context is empty'));
        }
        return 'continue';
        
      case '/clear':
        this.memory.messages = [];
        console.log(chalk.yellow('🗑️ Conversation cleared (memory preserved)'));
        return 'continue';
        
      case '/reset':
        this.memory.workingContext.clear();
        this.memory.messages = [];
        this.memory.sessionId = this.generateSessionId();
        console.log(chalk.yellow('🔄 All memory reset'));
        return 'continue';
        
      default:
        console.log(chalk.red(`Unknown command: ${input}`));
        console.log('Type /help for available commands');
        return 'continue';
    }
  }

  async startChat() {
    console.log(chalk.bold.cyan('🧠 Simple Cognitron05 - Persistent AI Assistant'));
    console.log(chalk.gray('═══════════════════════════════════════════════════'));
    
    await this.loadMemory();
    
    if (this.memory.messages.length > 0) {
      console.log(chalk.green(`✅ Resumed session with ${this.memory.messages.length} messages`));
      console.log(chalk.gray(`Session: ${this.memory.sessionId}`));
      
      if (this.memory.workingContext.size > 0) {
        console.log(chalk.yellow(`Memory: ${this.memory.workingContext.size} items remembered`));
      }
    } else {
      console.log(chalk.cyan('🆕 Starting new conversation'));
    }
    
    console.log(chalk.gray('\nType your message or /help for commands\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> ')
    });

    this.isRunning = true;
    rl.prompt();

    rl.on('line', async (input) => {
      const trimmedInput = input.trim();
      
      if (!trimmedInput) {
        rl.prompt();
        return;
      }

      // Handle commands
      if (trimmedInput.startsWith('/')) {
        const result = await this.handleCommand(trimmedInput);
        if (result === 'exit') {
          rl.close();
          return;
        }
        rl.prompt();
        return;
      }

      // Generate AI response
      console.log(chalk.gray('⏳ Thinking...'));
      const response = await this.generateResponse(trimmedInput);
      
      // Show memory updates
      if (response.memoryUpdates.length > 0) {
        console.log(chalk.yellow('\n🧠 Memory Updates:'));
        for (const update of response.memoryUpdates) {
          console.log(chalk.gray(`   ${update.key} = ${update.value}`));
        }
        console.log('');
      }
      
      // Display response
      console.log(marked(response.content));
      
      // Show usage info
      if (response.usage) {
        const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
        console.log(chalk.gray(`\n📊 Tokens: ${total_tokens} (${prompt_tokens} + ${completion_tokens})`));
      }
      
      console.log('');
      rl.prompt();
    });

    rl.on('close', () => {
      if (this.isRunning) {
        console.log(chalk.gray('\n👋 Goodbye!'));
      }
      process.exit(0);
    });

    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log(chalk.gray('\n\n💾 Saving memory before exit...'));
      await this.saveMemory();
      console.log(chalk.green('✅ Memory saved!'));
      process.exit(0);
    });
  }
}

// CLI Setup
const program = new Command();

program
  .name('cognitron05-simple')
  .description('Simple AI Assistant with Persistent Memory')
  .version('1.0.0');

program
  .command('chat')
  .description('Start interactive chat')
  .action(async () => {
    const cognitron = new SimpleCognitron();
    await cognitron.startChat();
  });

program
  .action(async () => {
    // Default action - start chat
    const cognitron = new SimpleCognitron();
    await cognitron.startChat();
  });

program.parse();