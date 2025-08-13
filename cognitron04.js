#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Import modular components
import MemorySystem from './modules/memory/MemorySystem.js';
import ToolManager from './modules/tools/ToolManager.js';
import ChatAgent from './modules/agent/ChatAgent.js';
import ResponseProcessor from './modules/agent/ResponseProcessor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration constants
const CONFIG = {
  VERSION: '1.0.4-modular',
  MODEL: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  TEMPERATURE: 0.7,
  MAX_TOKENS: 2048,
  DEFAULT_REASONING_LEVEL: 'low',
  SLASH_COMMANDS: ['/exit', '/stats', '/clear', '/help', '/reset', '/version', '/reasoning', '/history', '/limit', '/agent', '/search', '/memory'],
  // Memory settings
  CONVERSATIONS_DIR: path.join(__dirname, 'conversations'),
  ENABLE_MEMORY: true
};

const program = new Command();

// Initialize modular components
let memorySystem = null;
let toolManager = null;
let chatAgent = null;
let responseProcessor = null;

/**
 * Initialize all modular components
 */
async function initializeComponents() {
  try {
    // Initialize memory system
    memorySystem = new MemorySystem({
      conversationsDir: CONFIG.CONVERSATIONS_DIR,
      enabled: CONFIG.ENABLE_MEMORY
    });
    await memorySystem.initialize();
    
    // Initialize tool manager with memory system
    toolManager = new ToolManager(memorySystem);
    
    // Initialize chat agent
    chatAgent = new ChatAgent({
      apiKey: process.env.GROQ_API_KEY || 'YOUR_GROQ_API_KEY_HERE',
      model: CONFIG.MODEL,
      temperature: CONFIG.TEMPERATURE,
      maxTokens: CONFIG.MAX_TOKENS,
      reasoningLevel: CONFIG.DEFAULT_REASONING_LEVEL
    }, memorySystem, toolManager);
    
    // Initialize response processor
    responseProcessor = new ResponseProcessor({
      showThinking: true,
      showToolCalls: true,
      streamOutput: false,
      colors: true
    });
    
  } catch (error) {
    console.error(chalk.red('Error initializing components:'), error.message);
    process.exit(1);
  }
}

/**
 * Main chat function using the modular architecture
 */
async function chat(message, options = {}) {
  if (!message?.trim()) {
    throw new Error('Message cannot be empty');
  }

  try {
    responseProcessor.showThinking('Generating response...');
    
    const response = await chatAgent.generateResponse(message, options);
    
    await responseProcessor.displayResponse(response, {
      showUsage: options.showUsage || false
    });

    return response.content;
  } catch (error) {
    responseProcessor.displayError(error);
    throw error;
  }
}

/**
 * Handles slash commands in interactive mode
 */
async function handleSlashCommand(command, options) {
  // Handle /search command
  if (command.startsWith('/search')) {
    const parts = command.trim().split(/\s+/);
    if (parts.length === 1) {
      console.log(chalk.blue('\n🔍 Search Usage:'));
      console.log(chalk.gray('  /search <query> - Search conversation history'));
      console.log(chalk.gray('  Example: /search "javascript functions"'));
      console.log();
      return true;
    }
    
    const query = parts.slice(1).join(' ');
    console.log(chalk.blue(`\n🔍 Searching for: "${query}"`));
    
    try {
      const results = await memorySystem.searchConversationHistory(query, { max_results: 10 });
      
      if (results.length === 0) {
        console.log(chalk.yellow('  No results found.\n'));
      } else {
        console.log(chalk.green(`  Found ${results.length} results:\n`));
        results.forEach((msg, idx) => {
          const timestamp = new Date(msg.timestamp).toLocaleString();
          const preview = msg.content.substring(0, 100);
          const role = msg.role === 'user' ? '👤' : '🤖';
          console.log(chalk.gray(`  ${idx + 1}. ${role} [${timestamp}] (Score: ${msg.score?.toFixed(1)})`));
          console.log(chalk.gray(`     ${preview}${msg.content.length > 100 ? '...' : ''}\n`));
        });
      }
    } catch (error) {
      console.log(chalk.red(`  Error searching: ${error.message}\n`));
    }
    
    return true;
  }

  // Handle /memory command
  if (command.toLowerCase() === '/memory') {
    console.log(chalk.blue('\n🧠 Memory System Status:'));
    const status = memorySystem.getStatus();
    console.log(chalk.gray(`  Session ID: ${status.sessionId}`));
    console.log(chalk.gray(`  Memory enabled: ${status.enabled ? 'YES' : 'NO'}`));
    console.log(chalk.gray(`  Conversations directory: ${status.conversationsDir}`));
    console.log(chalk.gray(`  Total indexed terms: ${status.totalIndexedTerms.toLocaleString()}`));
    console.log(chalk.gray(`  Total sessions: ${status.totalSessions.toLocaleString()}`));
    console.log(chalk.gray(`  Recent messages tracked: ${status.recentMessages}`));
    console.log(chalk.gray(`  Message ID counter: ${status.messageIdCounter}`));
    console.log();
    return true;
  }
  
  switch (command.toLowerCase()) {
    case '/exit':
      console.log(chalk.blue('\n👋 Goodbye!'));
      // Cleanup components
      if (memorySystem) await memorySystem.cleanup();
      if (responseProcessor) responseProcessor.cleanup();
      return false;
      
    case '/stats':
      const agentStatus = chatAgent.getStatus();
      const toolStatus = toolManager ? toolManager.tools.size : 0;
      
      console.log(chalk.blue('\n📊 Session Statistics:'));
      console.log(chalk.gray(`  Model: ${agentStatus.model}`));
      console.log(chalk.gray(`  Temperature: ${agentStatus.temperature}`));
      console.log(chalk.gray(`  Reasoning level: ${agentStatus.reasoningLevel.toUpperCase()}`));
      console.log(chalk.gray(`  Conversation length: ${agentStatus.historyLength} messages`));
      console.log(chalk.gray(`  Memory system: ${agentStatus.hasMemorySystem ? 'ENABLED' : 'DISABLED'}`));
      console.log(chalk.gray(`  Available tools: ${toolStatus}`));
      console.log();
      return true;
      
    case '/version':
      console.log(chalk.blue('\n🤖 Cognitron v' + CONFIG.VERSION));
      console.log(chalk.gray(`  Model: ${CONFIG.MODEL}`));
      console.log(chalk.gray('  Architecture: Modular'));
      console.log(chalk.gray('  Features: Memory system, Web search, Function calling'));
      console.log();
      return true;
      
    case '/reasoning':
      // Get current level and cycle to next
      const levels = ['low', 'medium', 'high'];
      const currentIndex = levels.indexOf(chatAgent.config.reasoningLevel);
      const nextIndex = (currentIndex + 1) % levels.length;
      const newLevel = levels[nextIndex];
      
      chatAgent.updateConfig({ reasoningLevel: newLevel });
      
      const levelEmojis = { 'low': '🔹', 'medium': '🔶', 'high': '🔴' };
      const levelDescriptions = {
        'low': 'Direct answers without thinking steps',
        'medium': 'Thinking shown for complex questions only', 
        'high': 'Detailed thinking shown for all responses'
      };
      
      console.log(chalk.blue(`\n👤 Manual Override: ${levelEmojis[newLevel]} ${chalk.bold(newLevel.toUpperCase())}`));
      console.log(chalk.gray(`  ${levelDescriptions[newLevel]}\n`));
      return true;
      
    case '/clear':
    case '/reset':
      chatAgent.clearHistory();
      console.log(chalk.blue('\n🧹 Conversation history cleared.\n'));
      return true;
      
    case '/help':
      console.log(chalk.blue('\n📖 Available Commands:'));
      console.log(chalk.gray('  /exit       - Exit the chat'));
      console.log(chalk.gray('  /reasoning  - Manual override of reasoning level'));
      console.log(chalk.gray('  /stats      - Show session statistics'));
      console.log(chalk.gray('  /clear      - Clear conversation history'));
      console.log(chalk.gray('  /reset      - Same as /clear'));
      console.log(chalk.gray('  /version    - Show version information'));
      console.log(chalk.gray('  /help       - Show this help message'));
      console.log(chalk.blue('\n🧠 Memory Commands:'));
      console.log(chalk.gray('  /search <query>  - Search conversation history'));
      console.log(chalk.gray('  /memory          - Show memory system status'));
      console.log(chalk.blue('\n🌐 Web Search:'));
      console.log(chalk.gray('  AI can automatically search the web for current information when needed'));
      console.log(chalk.gray('\n💡 Tips:'));
      console.log(chalk.gray('  • Use /reasoning to cycle through reasoning levels'));
      console.log(chalk.gray('  • Use /search to find specific topics from past conversations'));
      console.log(chalk.gray('  • Agent can auto-adjust reasoning based on question complexity'));
      console.log(chalk.gray('  • Agent can search your conversation history when relevant'));
      console.log();
      return true;
      
    default:
      console.log(chalk.red(`\nUnknown command: ${command}`));
      console.log(chalk.gray('Type /help to see available commands.\n'));
      return true;
  }
}

/**
 * Starts interactive chat mode
 */
async function interactiveMode(options = {}) {
  await initializeComponents();
  
  const agentStatus = chatAgent.getStatus();
  const memoryStatus = memorySystem.getStatus();
  
  console.log(chalk.blue(`🤖 Welcome to Cognitron ${CONFIG.VERSION}! Type "/exit" to quit.`));
  console.log(chalk.gray(`Reasoning level: 🔹 ${agentStatus.reasoningLevel.toUpperCase()} (cycle: /reasoning)`));
  console.log(chalk.gray(`Memory system: 🧠 ${memoryStatus.enabled ? 'ENABLED' : 'DISABLED'} (status: /memory)`));
  console.log(chalk.gray(`Web search: 🌐 ENABLED (DuckDuckGo API)`));
  console.log(chalk.gray(`Available tools: ${agentStatus.availableTools} (search_web, search_conversation_history, agent tools)`));
  console.log(chalk.gray('Available commands: /help, /reasoning, /search, /memory, /stats, /clear, /exit\n'));
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const askQuestion = () => {
    rl.question(chalk.green('You: '), async (input) => {
      const trimmedInput = input.trim();
      
      // Handle empty input
      if (!trimmedInput) {
        askQuestion();
        return;
      }
      
      // Handle slash commands
      if (trimmedInput.startsWith('/')) {
        const shouldContinue = await handleSlashCommand(trimmedInput, options);
        if (!shouldContinue) {
          rl.close();
          return;
        }
        askQuestion();
        return;
      }
      
      // Handle regular chat messages
      process.stdout.write(chalk.cyan('Cognitron: '));
      
      try {
        await chat(trimmedInput, options);
      } catch (error) {
        console.error(chalk.red('Failed to get response:'), error.message);
      }
      
      askQuestion();
    });
  };
  
  askQuestion();
}

// Program setup
program
  .name('cognitron')
  .description('A modular CLI chat agent with memory and web search capabilities')
  .version(CONFIG.VERSION);

program
  .command('chat')
  .description('Start interactive chat mode')
  .option('-r, --reasoning', 'Start with high reasoning level')
  .action(async (options) => {
    const reasoningLevel = options.reasoning ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
    await interactiveMode({ reasoningLevel });
  });

program
  .command('ask')
  .description('Ask a single question')
  .argument('<question>', 'The question to ask')
  .option('-r, --reasoning', 'Use high reasoning level')
  .option('--usage', 'Show token usage statistics')
  .action(async (question, options) => {
    if (!question?.trim()) {
      console.error(chalk.red('Question cannot be empty'));
      process.exit(1);
    }
    
    await initializeComponents();
    
    const reasoningLevel = options.reasoning ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
    chatAgent.updateConfig({ reasoningLevel });
    
    process.stdout.write(chalk.cyan('Cognitron: '));
    
    try {
      await chat(question.trim(), { 
        reasoningLevel,
        showUsage: options.usage 
      });
    } catch (error) {
      console.error(chalk.red('Failed to get response:'), error.message);
      process.exit(1);
    }
  });

// Default to interactive mode if no command specified
program.parse();

if (!process.argv.slice(2).length) {
  interactiveMode();
}