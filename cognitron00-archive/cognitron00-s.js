#!/usr/bin/env node

import { Groq } from 'groq-sdk';
import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';

// Configuration constants
const CONFIG = {
  VERSION: '1.0.0-streaming',
  MODEL: 'openai/gpt-oss-120b',
  CONTEXT_WINDOW: 131072, // 128K tokens
  TEMPERATURE: 0.7,
  MAX_TOKENS: 8192,
  TOP_P: 1,
  DEFAULT_HISTORY_LIMIT_PERCENT: 50, // 50% of context window by default
  MIN_HISTORY_LIMIT_PERCENT: 10,
  MAX_HISTORY_LIMIT_PERCENT: 90,
  REASONING_LEVELS: ['low', 'medium', 'high'],
  DEFAULT_REASONING_LEVEL: 'low',
  SLASH_COMMANDS: ['/exit', '/stats', '/clear', '/help', '/reset', '/version', '/reasoning', '/history', '/limit', '/stream'],
  // Enhanced streaming settings
  ENABLE_STREAMING: true,
  STREAM_DELAY_MS: 0, // No artificial delay for real streaming
  SHOW_TYPING_INDICATOR: true,
  STREAM_BUFFER_SIZE: 1, // Process every character immediately
  TYPING_CHARS: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
};

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'YOUR_GROQ_API_KEY_HERE'
});

const program = new Command();
const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g;

// Streaming state
let isStreaming = false;
let typingInterval = null;

/**
 * Estimates token count for text (rough approximation)
 * @param {string} text - Text to count tokens for
 * @returns {number} Estimated token count
 */
function estimateTokenCount(text) {
  if (!text) return 0;
  // Rough approximation: ~4 characters per token on average
  // This is a simplified estimate - real tokenization is more complex
  return Math.ceil(text.length / 4);
}

/**
 * Calculates total context usage from conversation history and system message
 * @param {Array} conversationHistory - Current conversation history
 * @param {string} systemMessage - System message text
 * @returns {Object} Context usage information
 */
function calculateContextUsage(conversationHistory, systemMessage = '') {
  let totalTokens = 0;
  
  // Count system message tokens
  totalTokens += estimateTokenCount(systemMessage);
  
  // Count conversation history tokens
  conversationHistory.forEach(msg => {
    totalTokens += estimateTokenCount(msg.content);
    // Add a few tokens for role and formatting
    totalTokens += 10;
  });
  
  const usagePercentage = Math.round((totalTokens / CONFIG.CONTEXT_WINDOW) * 100);
  
  return {
    totalTokens,
    contextWindow: CONFIG.CONTEXT_WINDOW,
    usagePercentage,
    remainingTokens: CONFIG.CONTEXT_WINDOW - totalTokens
  };
}

/**
 * Manages conversation history based on context percentage limit
 * @param {Array} conversationHistory - Current conversation history (mutable)
 * @param {string} systemMessage - System message text
 * @param {number} limitPercent - Percentage of context window to use for history
 */
function manageConversationHistory(conversationHistory, systemMessage, limitPercent) {
  const maxHistoryTokens = Math.floor((CONFIG.CONTEXT_WINDOW * limitPercent) / 100);
  
  while (conversationHistory.length > 0) {
    const usage = calculateContextUsage(conversationHistory, systemMessage);
    
    if (usage.totalTokens <= maxHistoryTokens) {
      break; // Within limit
    }
    
    // Remove oldest pair (user + assistant)
    conversationHistory.splice(0, 2);
    
    // Safety check to prevent infinite loop
    if (conversationHistory.length < 2) {
      break;
    }
  }
}

/**
 * Creates a system message based on reasoning level
 * @param {string} reasoningLevel - Reasoning level: 'low', 'medium', or 'high'
 * @returns {string} System message for the AI
 */
function createSystemMessage(reasoningLevel = 'low') {
  const baseMessage = "You are Cognitron, a helpful AI assistant. Be concise, accurate, and friendly. CRITICAL FORMATTING REQUIREMENT: You must respond ONLY in plain text. Do NOT use any markdown formatting whatsoever including: **bold**, *italics*, `backticks for code`, ```code blocks```, # headers, - bullet lists, > quotes, | tables |, --- dividers, [links](url), or any other markdown syntax. Format code examples using simple indentation and plain text only. Use regular text formatting like capitalization and spacing for emphasis instead of markdown.";
  
  switch (reasoningLevel) {
    case 'high':
      return `${baseMessage} Reasoning: high. IMPORTANT: For every response, first show your detailed step-by-step thinking process wrapped in <think></think> tags, then provide your final answer. Always include comprehensive thinking tags even for simple questions to show your complete reasoning process.`;
    
    case 'medium':
      return `${baseMessage} Reasoning: medium. For complex questions, show your thinking process wrapped in <think></think> tags before answering. Use reasoning tags when the question requires analysis or multi-step thinking.`;
    
    case 'low':
    default:
      return `${baseMessage} Reasoning: low. Provide direct, concise answers without showing reasoning steps.`;
  }
}

/**
 * Enhanced streaming functions
 */

/**
 * Show typing indicator with animation
 * @param {string} message - Message to show with indicator
 * @returns {Promise} Resolves when typing indicator is stopped
 */
async function showTypingIndicator(message = 'Thinking') {
  if (!CONFIG.SHOW_TYPING_INDICATOR || isStreaming) return;
  
  let frameIndex = 0;
  const frames = CONFIG.TYPING_CHARS;
  
  return new Promise((resolve) => {
    typingInterval = setInterval(() => {
      process.stdout.write(`\r${chalk.dim(frames[frameIndex % frames.length] + ' ' + message + '...')}`);
      frameIndex++;
    }, 80);
    
    // Store resolve function to call from stopTypingIndicator
    showTypingIndicator.resolve = resolve;
  });
}

/**
 * Stop typing indicator
 */
function stopTypingIndicator() {
  if (typingInterval) {
    clearInterval(typingInterval);
    typingInterval = null;
    process.stdout.write('\r' + ' '.repeat(50) + '\r'); // Clear the line
    if (showTypingIndicator.resolve) {
      showTypingIndicator.resolve();
      showTypingIndicator.resolve = null;
    }
  }
}

/**
 * Enhanced streaming text processor with color support
 * @param {string} chunk - Text chunk to process
 * @param {Object} options - Streaming options
 */
function processStreamingChunk(chunk, options = {}) {
  if (!chunk || !CONFIG.ENABLE_STREAMING) return;
  
  const { 
    showColors = true,
    bufferSize = CONFIG.STREAM_BUFFER_SIZE,
    delay = CONFIG.STREAM_DELAY_MS 
  } = options;
  
  // Process chunk character by character for smooth streaming
  for (let i = 0; i < chunk.length; i += bufferSize) {
    const charChunk = chunk.slice(i, i + bufferSize);
    
    if (showColors && charChunk.match(/[.!?]/)) {
      // Slight pause at sentence endings for natural flow
      setTimeout(() => {
        process.stdout.write(chalk.white(charChunk));
      }, delay + 50);
    } else {
      if (delay > 0) {
        setTimeout(() => {
          process.stdout.write(charChunk);
        }, delay);
      } else {
        process.stdout.write(charChunk);
      }
    }
  }
}

/**
 * Enhanced streaming status display
 */
function showStreamingStatus() {
  const status = isStreaming ? chalk.green('ON') : chalk.red('OFF');
  console.log(`\n🌊 Streaming: ${status}`);
  console.log(chalk.gray(`   Buffer size: ${CONFIG.STREAM_BUFFER_SIZE} chars`));
  console.log(chalk.gray(`   Delay: ${CONFIG.STREAM_DELAY_MS}ms`));
  console.log(chalk.gray(`   Typing indicator: ${CONFIG.SHOW_TYPING_INDICATOR ? 'ON' : 'OFF'}`));
}

/**
 * Processes response to extract and display reasoning
 * @param {string} response - Raw response from the AI
 * @param {boolean} showReasoning - Whether to display reasoning
 */
function processResponseWithReasoning(response, showReasoning) {
  if (!response.includes('<think>')) {
    return;
  }

  const thinkMatches = [...response.matchAll(THINK_REGEX)];
  
  // Clear the previously streamed content
  const lines = response.split('\n').length;
  for (let i = 0; i < lines; i++) {
    process.stdout.write('\x1b[1A\x1b[2K'); // Move up and clear line
  }
  process.stdout.write('\r'); // Return to start of line
  
  if (showReasoning && thinkMatches.length > 0) {
    // Show reasoning first
    thinkMatches.forEach(match => {
      const thinking = match[1].trim();
      console.log(chalk.yellow(`💭 Thinking: ${thinking}\n`));
    });
  }
  
  // Show clean answer
  const cleanResponse = response.replace(THINK_REGEX, '').trim();
  if (cleanResponse) {
    console.log(cleanResponse);
  }
}

/**
 * Main chat function that communicates with Groq API
 * @param {string} message - User message
 * @param {Array} conversationHistory - Previous messages
 * @param {Object} options - Configuration options
 * @returns {Promise<string|null>} AI response or null on error
 */
async function chatWithGroq(message, conversationHistory = [], options = {}) {
  if (!message?.trim()) {
    throw new Error('Message cannot be empty');
  }

  const reasoningLevel = options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL;
  const systemMessage = createSystemMessage(reasoningLevel);
    
  const messages = [
    {
      role: "system",
      content: systemMessage
    },
    ...conversationHistory,
    {
      role: "user",
      content: message
    }
  ];

  try {
    // Show typing indicator while request is being processed
    const typingPromise = showTypingIndicator('Generating response');
    
    const chatCompletion = await groq.chat.completions.create({
      messages,
      model: CONFIG.MODEL,
      temperature: CONFIG.TEMPERATURE,
      max_completion_tokens: CONFIG.MAX_TOKENS,
      top_p: CONFIG.TOP_P,
      stream: CONFIG.ENABLE_STREAMING,
      reasoning_effort: reasoningLevel,
      stop: null
    });

    let response = '';
    let chunkCount = 0;
    const startTime = Date.now();
    
    // Stop typing indicator and start streaming
    stopTypingIndicator();
    isStreaming = true;
    
    process.stdout.write(chalk.cyan('Cognitron: '));
    
    for await (const chunk of chatCompletion) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        response += content;
        chunkCount++;
        
        // Enhanced streaming with better visual feedback
        if (CONFIG.ENABLE_STREAMING) {
          processStreamingChunk(content, { 
            showColors: true,
            delay: CONFIG.STREAM_DELAY_MS
          });
        } else {
          process.stdout.write(content);
        }
      }
    }
    
    isStreaming = false;
    const endTime = Date.now();
    const streamDuration = endTime - startTime;
    
    const shouldShowReasoning = reasoningLevel !== 'low';
    processResponseWithReasoning(response, shouldShowReasoning);
    
    if (!response.includes('<think>')) {
      console.log(); // New line after response only if no post-processing
    }
    
    // Show streaming stats if verbose mode
    if (options.showStreamStats) {
      console.log(chalk.dim(`\n⚡ Streamed ${chunkCount} chunks in ${streamDuration}ms (${response.length} chars)`));
    }
    
    return response;
  } catch (error) {
    // Clean up on error
    stopTypingIndicator();
    isStreaming = false;
    if (error.status === 401) {
      console.error(chalk.red('Authentication error: Please check your GROQ_API_KEY'));
    } else if (error.status === 429) {
      console.error(chalk.red('Rate limit exceeded. Please try again later.'));
    } else {
      console.error(chalk.red('Error communicating with Groq:'), error.message);
    }
    return null;
  }
}

/**
 * Handles slash commands in interactive mode
 * @param {string} command - The slash command
 * @param {Array} conversationHistory - Current conversation history
 * @param {Object} options - Configuration options (mutable)
 * @returns {boolean} Whether to continue the conversation
 */
function handleSlashCommand(command, conversationHistory, options) {
  // Handle /limit command with optional percentage argument
  if (command.startsWith('/limit')) {
    const parts = command.trim().split(/\s+/);
    
    if (parts.length === 1) {
      // Show current limit
      console.log(chalk.blue(`\n📏 Current History Limit: ${options.historyLimitPercent || CONFIG.DEFAULT_HISTORY_LIMIT_PERCENT}%`));
      const maxTokens = Math.floor((CONFIG.CONTEXT_WINDOW * (options.historyLimitPercent || CONFIG.DEFAULT_HISTORY_LIMIT_PERCENT)) / 100);
      console.log(chalk.gray(`  Max history tokens: ${maxTokens.toLocaleString()}`));
      console.log(chalk.gray(`  Range: ${CONFIG.MIN_HISTORY_LIMIT_PERCENT}% - ${CONFIG.MAX_HISTORY_LIMIT_PERCENT}%`));
      console.log(chalk.gray('\n  Usage: /limit <percentage>  (e.g., /limit 75)\n'));
      return true;
    }
    
    const newPercent = parseInt(parts[1]);
    
    if (isNaN(newPercent) || newPercent < CONFIG.MIN_HISTORY_LIMIT_PERCENT || newPercent > CONFIG.MAX_HISTORY_LIMIT_PERCENT) {
      console.log(chalk.red(`\n❌ Invalid percentage. Must be between ${CONFIG.MIN_HISTORY_LIMIT_PERCENT}% and ${CONFIG.MAX_HISTORY_LIMIT_PERCENT}%.\n`));
      return true;
    }
    
    options.historyLimitPercent = newPercent;
    console.log(chalk.blue(`\n📏 History limit updated to ${newPercent}%`));
    const maxTokens = Math.floor((CONFIG.CONTEXT_WINDOW * newPercent) / 100);
    console.log(chalk.gray(`  Max history tokens: ${maxTokens.toLocaleString()}`));
    
    // Apply the new limit immediately
    const reasoningLevel = options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL;
    const systemMessage = createSystemMessage(reasoningLevel);
    manageConversationHistory(conversationHistory, systemMessage, newPercent);
    console.log(chalk.gray(`  History pruned to fit new limit.\n`));
    
    return true;
  }
  
  switch (command.toLowerCase()) {
    case '/exit':
      console.log(chalk.blue('\n👋 Goodbye!'));
      return false;
      
    case '/stats':
      const messageCount = conversationHistory.length;
      const userMessages = conversationHistory.filter(m => m.role === 'user').length;
      const assistantMessages = conversationHistory.filter(m => m.role === 'assistant').length;
      const reasoningLevel = options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL;
      const reasoningStatus = reasoningLevel.toUpperCase();
      const memoryUsage = `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`;
      
      // Calculate context usage
      const systemMessage = createSystemMessage(reasoningLevel);
      const contextUsage = calculateContextUsage(conversationHistory, systemMessage);
      const contextColor = contextUsage.usagePercentage > 80 ? chalk.red : 
                          contextUsage.usagePercentage > 60 ? chalk.yellow : chalk.green;
      
      console.log(chalk.blue('\n📊 Session Statistics:'));
      console.log(chalk.gray(`  Total messages: ${messageCount}`));
      console.log(chalk.gray(`  Your messages: ${userMessages}`));
      console.log(chalk.gray(`  Assistant responses: ${assistantMessages}`));
      console.log(chalk.gray(`  Reasoning level: ${reasoningStatus}`));
      console.log(chalk.gray(`  Model: ${CONFIG.MODEL}`));
      console.log(chalk.gray(`  Memory usage: ${memoryUsage}`));
      const historyLimit = options.historyLimitPercent || CONFIG.DEFAULT_HISTORY_LIMIT_PERCENT;
      const maxHistoryTokens = Math.floor((CONFIG.CONTEXT_WINDOW * historyLimit) / 100);
      console.log(chalk.gray(`  History limit: ${historyLimit}% (${maxHistoryTokens.toLocaleString()} tokens)`));
      console.log(chalk.gray('\n📝 Context Usage:'));
      console.log(chalk.gray(`  Context window: ${CONFIG.CONTEXT_WINDOW.toLocaleString()} tokens (128K)`));
      console.log(chalk.gray(`  Estimated usage: ${contextUsage.totalTokens.toLocaleString()} tokens`));
      console.log(contextColor(`  Usage percentage: ${contextUsage.usagePercentage}%`));
      console.log(chalk.gray(`  Remaining tokens: ${contextUsage.remainingTokens.toLocaleString()}`));
      
      // Add usage warnings
      if (contextUsage.usagePercentage > 80) {
        console.log(chalk.red('  ⚠️  Warning: High context usage! Consider using /clear to reset.'));
      } else if (contextUsage.usagePercentage > 60) {
        console.log(chalk.yellow('  🟡 Moderate context usage. Monitor for optimal performance.'));
      } else {
        console.log(chalk.gray('  ✅ Context usage is healthy.'));
      }
      
      console.log();
      return true;
      
    case '/stream':
      // Toggle streaming or show status
      if (command.trim().length > 7) {
        const arg = command.slice(8).toLowerCase();
        switch (arg) {
          case 'on':
            CONFIG.ENABLE_STREAMING = true;
            console.log(chalk.green('\n🌊 Streaming enabled'));
            break;
          case 'off':
            CONFIG.ENABLE_STREAMING = false;
            console.log(chalk.red('\n🌊 Streaming disabled'));
            break;
          case 'status':
            showStreamingStatus();
            break;
          default:
            console.log(chalk.red('\n❌ Invalid stream command. Use: /stream on|off|status'));
        }
      } else {
        // Toggle streaming
        CONFIG.ENABLE_STREAMING = !CONFIG.ENABLE_STREAMING;
        const status = CONFIG.ENABLE_STREAMING ? chalk.green('ON') : chalk.red('OFF');
        console.log(`\n🌊 Streaming: ${status}`);
      }
      return true;

    case '/version':
      console.log(chalk.blue('\n🤖 Cognitron v' + CONFIG.VERSION));
      console.log(chalk.gray(`  Model: ${CONFIG.MODEL}`));
      console.log(chalk.gray('  Powered by Groq'));
      console.log(chalk.gray(`  Enhanced streaming: ${CONFIG.ENABLE_STREAMING ? '✅' : '❌'}`));
      console.log();
      return true;
      
    case '/reasoning':
      // Get current level index and cycle to next level
      const currentIndex = CONFIG.REASONING_LEVELS.indexOf(options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL);
      const nextIndex = (currentIndex + 1) % CONFIG.REASONING_LEVELS.length;
      options.reasoningLevel = CONFIG.REASONING_LEVELS[nextIndex];
      
      const levelEmojis = { 'low': '🔹', 'medium': '🔶', 'high': '🔴' };
      const levelDescriptions = {
        'low': 'Direct answers without thinking steps',
        'medium': 'Thinking shown for complex questions only', 
        'high': 'Detailed thinking shown for all responses'
      };
      
      console.log(chalk.blue(`\n🧠 Reasoning Level: ${levelEmojis[options.reasoningLevel]} ${chalk.bold(options.reasoningLevel.toUpperCase())}`));
      console.log(chalk.gray(`  ${levelDescriptions[options.reasoningLevel]}\n`));
      return true;
      
    case '/history':
      if (conversationHistory.length === 0) {
        console.log(chalk.blue('\n📝 No conversation history yet.\n'));
        return true;
      }
      
      console.log(chalk.blue('\n📝 Conversation History:'));
      console.log(chalk.gray(''.padEnd(60, '─')));
      
      conversationHistory.forEach((msg, index) => {
        const isUser = msg.role === 'user';
        const prefix = isUser ? '👤 You:' : '🤖 Cognitron:';
        const color = isUser ? chalk.green : chalk.cyan;
        
        console.log(color(`\n${prefix}`));
        
        // Extract and display reasoning if present
        if (msg.content.includes('<think>')) {
          const thinkMatches = [...msg.content.matchAll(THINK_REGEX)];
          thinkMatches.forEach(match => {
            const thinking = match[1].trim();
            console.log(chalk.yellow(`💭 Thinking: ${thinking}`));
          });
          
          // Show clean content
          const cleanContent = msg.content.replace(THINK_REGEX, '').trim();
          if (cleanContent) {
            console.log(cleanContent);
          }
        } else {
          console.log(msg.content);
        }
      });
      
      console.log(chalk.gray('\n' + ''.padEnd(60, '─')));
      console.log(chalk.gray(`Total messages: ${conversationHistory.length}\n`));
      return true;
      
    case '/clear':
    case '/reset':
      conversationHistory.length = 0; // Clear the array
      console.log(chalk.blue('\n🧹 Conversation history cleared.\n'));
      return true;
      
    case '/help':
      console.log(chalk.blue('\n📖 Available Commands:'));
      console.log(chalk.gray('  /exit       - Exit the chat'));
      console.log(chalk.gray('  /reasoning  - Cycle through low/medium/high reasoning levels'));
      console.log(chalk.gray('  /history    - Show full conversation history'));
      console.log(chalk.gray('  /limit      - Show/set history limit percentage'));
      console.log(chalk.gray('  /stats      - Show session statistics'));
      console.log(chalk.gray('  /clear      - Clear conversation history'));
      console.log(chalk.gray('  /reset      - Same as /clear'));
      console.log(chalk.gray('  /version    - Show version information'));
      console.log(chalk.gray('  /help       - Show this help message'));
      console.log(chalk.blue('\n🌊 Streaming Commands:'));
      console.log(chalk.gray('  /stream      - Toggle streaming on/off'));
      console.log(chalk.gray('  /stream on   - Enable streaming'));
      console.log(chalk.gray('  /stream off  - Disable streaming'));
      console.log(chalk.gray('  /stream status - Show streaming configuration'));
      console.log(chalk.blue('\n💡 Tips:'));
      console.log(chalk.gray('  • Use /reasoning to cycle through low/medium/high thinking levels'));
      console.log(chalk.gray('  • Use /limit 75 to set history to 75% of context window'));
      console.log(chalk.gray('  • Use /history to review past conversations and thoughts'));
      console.log(chalk.gray('  • History is auto-managed based on context percentage'));
      console.log(chalk.gray('  • Real-time streaming provides instant response feedback'));
      console.log(chalk.gray('  • Animated typing indicators show processing status'));
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
 * @param {Object} options - Configuration options
 */
async function interactiveMode(options = {}) {
  // Set defaults if not specified
  if (!options.historyLimitPercent) {
    options.historyLimitPercent = CONFIG.DEFAULT_HISTORY_LIMIT_PERCENT;
  }
  if (!options.reasoningLevel) {
    options.reasoningLevel = CONFIG.DEFAULT_REASONING_LEVEL;
  }
  
  const levelEmojis = { 'low': '🔹', 'medium': '🔶', 'high': '🔴' };
  console.log(chalk.blue(`🤖 Welcome to Cognitron v${CONFIG.VERSION}! Enhanced with real-time streaming.`));
  console.log(chalk.gray(`Reasoning level: ${levelEmojis[options.reasoningLevel]} ${options.reasoningLevel.toUpperCase()} (use /reasoning to cycle)`));
  console.log(chalk.gray(`History limit: ${options.historyLimitPercent}% of context window`));
  const streamStatus = CONFIG.ENABLE_STREAMING ? chalk.green('ON') : chalk.red('OFF');
  console.log(chalk.gray(`Streaming: ${streamStatus} (use /stream to toggle)`));
  console.log(chalk.gray('Available commands: /help, /reasoning, /history, /limit, /stats, /stream, /clear, /exit\n'));
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  const conversationHistory = [];
  
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
        const shouldContinue = handleSlashCommand(trimmedInput, conversationHistory, options);
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
        const response = await chatWithGroq(trimmedInput, conversationHistory, options);
        
        if (response) {
          conversationHistory.push({ role: "user", content: trimmedInput });
          conversationHistory.push({ role: "assistant", content: response });
          
          // Manage conversation history based on context percentage
          const reasoningLevel = options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL;
          const systemMessage = createSystemMessage(reasoningLevel);
          manageConversationHistory(conversationHistory, systemMessage, options.historyLimitPercent);
        }
      } catch (error) {
        console.error(chalk.red('Failed to get response:'), error.message);
      }
      
      askQuestion();
    });
  };
  
  askQuestion();
}

program
  .name('cognitron')
  .description('A CLI chat agent powered by Groq and OpenAI GPT-OSS-120B')
  .version('1.0.0');

program
  .command('chat')
  .description('Start interactive chat mode')
  .option('-r, --reasoning', 'Start with high reasoning level')
  .action(() => {
    const reasoningLevel = hasReasoningFlag ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
    interactiveMode({ reasoningLevel });
  });

program
  .command('ask')
  .description('Ask a single question')
  .argument('<question>', 'The question to ask')
  .option('-r, --reasoning', 'Use high reasoning level')
  .action(async (question) => {
    if (!question?.trim()) {
      console.error(chalk.red('Question cannot be empty'));
      process.exit(1);
    }
    
    const reasoningLevel = hasReasoningFlag ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
    process.stdout.write(chalk.cyan('Cognitron: '));
    
    try {
      await chatWithGroq(question.trim(), [], { reasoningLevel });
    } catch (error) {
      console.error(chalk.red('Failed to get response:'), error.message);
      process.exit(1);
    }
  });

// Parse command line arguments manually for reasoning flag
const hasReasoningFlag = process.argv.includes('--reasoning') || process.argv.includes('-r');

// Default to interactive mode if no command specified
program.parse();

if (!process.argv.slice(2).length || (hasReasoningFlag && !process.argv.slice(2).some(arg => arg === 'chat' || arg === 'ask'))) {
  const reasoningLevel = hasReasoningFlag ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
  interactiveMode({ reasoningLevel });
}