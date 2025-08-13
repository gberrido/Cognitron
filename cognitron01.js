#!/usr/bin/env node

import { Groq } from 'groq-sdk';
import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Configuration constants
const CONFIG = {
  VERSION: '1.0.1-agentic',
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
  SLASH_COMMANDS: ['/exit', '/stats', '/clear', '/help', '/reset', '/version', '/reasoning', '/history', '/limit', '/agent'],
  // Agentic settings
  AGENTIC_MODE: true,
  SHOW_AGENT_DECISIONS: true,
  MAX_TOOL_CALLS_PER_RESPONSE: 2
};

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'YOUR_GROQ_API_KEY_HERE'
});

const program = new Command();
const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g;

// Persona state
let personaContent = null;

// Agentic tool definitions
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'adjust_reasoning_level',
      description: 'Adjust the reasoning effort level based on question complexity. Use this BEFORE analyzing the user\'s question.',
      parameters: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
            description: 'low: simple questions, greetings, facts; medium: moderate analysis; high: complex math, logic, multi-step reasoning'
          },
          reason: {
            type: 'string',
            description: 'Brief explanation of why this reasoning level is appropriate for this question'
          }
        },
        required: ['level', 'reason']
      }
    }
  }
];

/**
 * Loads persona from a text file
 * @param {string} filename - Path to persona file
 * @returns {boolean} True if loaded successfully
 */
function loadPersona(filename) {
  try {
    const filePath = resolve(filename);
    if (!existsSync(filePath)) {
      console.error(chalk.red(`❌ Persona file not found: ${filename}`));
      return false;
    }
    
    personaContent = readFileSync(filePath, 'utf8').trim();
    
    if (!personaContent) {
      console.error(chalk.red(`❌ Persona file is empty: ${filename}`));
      return false;
    }
    
    console.log(chalk.green(`✅ Persona loaded from: ${filename}`));
    console.log(chalk.gray(`   Content preview: ${personaContent.substring(0, 100)}...`));
    return true;
  } catch (error) {
    console.error(chalk.red(`❌ Failed to load persona file: ${error.message}`));
    return false;
  }
}

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
 * Executes an agent tool call and updates options
 * @param {Object} toolCall - The tool call from the model
 * @param {Object} options - Mutable options object
 * @param {Array} conversationHistory - Conversation history (for future tools)
 * @returns {string} Feedback message about the tool execution
 */
function executeAgentTool(toolCall, options, conversationHistory) {
  try {
    switch (toolCall.function.name) {
      case 'adjust_reasoning_level':
        const { level, reason } = toolCall.function.arguments;
        const oldLevel = options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL;
        
        if (!CONFIG.REASONING_LEVELS.includes(level)) {
          return `❌ Invalid reasoning level: ${level}`;
        }
        
        if (level === oldLevel) {
          return `ℹ️  Reasoning level already set to ${level.toUpperCase()}`;
        }
        
        options.reasoningLevel = level;
        options.agentAdjusted = true; // Mark that agent made this adjustment
        
        return `🤖 Agent adjusted reasoning: ${oldLevel.toUpperCase()} → ${level.toUpperCase()}\n   📝 Reason: ${reason}`;
        
      default:
        return `❓ Unknown tool: ${toolCall.function.name}`;
    }
  } catch (error) {
    return `⚠️  Tool execution error: ${error.message}`;
  }
}

/**
 * Parses tool calls from model response
 * @param {string} content - Raw response content
 * @returns {Array} Array of parsed tool calls
 */
function parseToolCalls(content) {
  const toolCalls = [];
  
  // Look for function call patterns in the response
  // This is a simplified parser - in practice, you'd use the API's tool_calls field
  const functionCallRegex = /\{"name":\s*"(\w+)",\s*"arguments":\s*(\{[^}]+\})\}/g;
  let match;
  
  while ((match = functionCallRegex.exec(content)) !== null) {
    try {
      const name = match[1];
      const args = JSON.parse(match[2]);
      
      toolCalls.push({
        function: {
          name: name,
          arguments: args
        }
      });
    } catch (error) {
      console.error('Error parsing tool call:', error);
    }
  }
  
  return toolCalls;
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
 * Creates a system message based on reasoning level and agentic mode
 * @param {string} reasoningLevel - Reasoning level: 'low', 'medium', or 'high'
 * @param {boolean} agenticMode - Whether to enable autonomous reasoning level adjustment
 * @returns {string} System message for the AI
 */
function createSystemMessage(reasoningLevel = 'low', agenticMode = false) {
  let baseMessage = "You are Cognitron, a helpful AI assistant. Be concise, accurate, and friendly.";
  
  // Add persona if loaded
  if (personaContent) {
    baseMessage += " From now on you will talk and act and incarnate this persona, you are this persona: " + personaContent;
  }
  
  let reasoningInstructions = '';
  switch (reasoningLevel) {
    case 'high':
      reasoningInstructions = 'Reasoning: high. IMPORTANT: For every response, first show your detailed step-by-step thinking process wrapped in <think></think> tags, then provide your final answer.';
      break;
    case 'medium':
      reasoningInstructions = 'Reasoning: medium. For complex questions, show your thinking process wrapped in <think></think> tags before answering.';
      break;
    case 'low':
    default:
      reasoningInstructions = 'Reasoning: low. Provide direct, concise answers without showing reasoning steps.';
      break;
  }
  
  if (agenticMode) {
    const agenticInstructions = `\n\nAGENTIC CAPABILITIES:\nYou have autonomous reasoning adjustment capabilities. Before responding, evaluate if the current reasoning level (${reasoningLevel}) is appropriate for this question:\n\n- Use LOW for: greetings, simple facts, basic questions\n- Use MEDIUM for: explanations, moderate analysis, how-to questions  \n- Use HIGH for: complex math, logic puzzles, multi-step reasoning, detailed analysis\n\nIf you need to adjust your reasoning level, output: AGENT_ADJUST_REASONING:level:reason\nThen proceed with your response using the new level. For example:\nAGENT_ADJUST_REASONING:high:Complex calculus problem requires detailed step-by-step analysis`;
    return baseMessage + ' ' + reasoningInstructions + agenticInstructions;
  }
  
  return baseMessage + ' ' + reasoningInstructions;
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
  const agenticMode = options.agenticMode !== false && CONFIG.AGENTIC_MODE;
  const systemMessage = createSystemMessage(reasoningLevel, agenticMode);
    
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
    const requestOptions = {
      messages,
      model: CONFIG.MODEL,
      temperature: options.temperature || CONFIG.TEMPERATURE,
      max_completion_tokens: CONFIG.MAX_TOKENS,
      top_p: CONFIG.TOP_P,
      stream: true,
      reasoning_effort: reasoningLevel,
      stop: null
    };
    
    // Note: Using text-based commands instead of function calling for better compatibility
    
    const chatCompletion = await groq.chat.completions.create(requestOptions);

    let response = '';
    let toolCalls = [];
    let hasToolCalls = false;
    
    for await (const chunk of chatCompletion) {
      const choice = chunk.choices[0];
      
      // Handle tool calls
      if (choice?.delta?.tool_calls) {
        hasToolCalls = true;
        toolCalls.push(...choice.delta.tool_calls);
        continue;
      }
      
      const content = choice?.delta?.content || '';
      response += content;
      
      // Only stream content if no tool calls are being made
      if (!hasToolCalls) {
        process.stdout.write(content);
      }
    }
    
    // Check for agent reasoning adjustments in the response
    const adjustmentMatch = response.match(/AGENT_ADJUST_REASONING:(low|medium|high):(.+?)(?=\n|$)/i);
    if (adjustmentMatch && agenticMode) {
      const [fullMatch, newLevel, reason] = adjustmentMatch;
      const oldLevel = reasoningLevel;
      
      if (CONFIG.REASONING_LEVELS.includes(newLevel) && newLevel !== oldLevel) {
        // Remove the adjustment command from the response
        response = response.replace(fullMatch, '').trim();
        
        if (CONFIG.SHOW_AGENT_DECISIONS) {
          console.log(chalk.blue(`🤖 Agent adjusted reasoning: ${oldLevel.toUpperCase()} → ${newLevel.toUpperCase()}`));
          console.log(chalk.blue(`   📝 Reason: ${reason.trim()}`));
          console.log(chalk.gray('\n🔄 Responding with adjusted settings...\n'));
        }
        
        // Make a follow-up request with the new settings
        const followUpOptions = { ...options, reasoningLevel: newLevel, agentAdjusted: true, agenticMode: false };
        return await chatWithGroq(message, conversationHistory, followUpOptions);
      }
    }
    
    // Process regular response
    const currentReasoningLevel = options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL;
    const shouldShowReasoning = currentReasoningLevel !== 'low';
    processResponseWithReasoning(response, shouldShowReasoning);
    
    if (!response.includes('<think>')) {
      console.log(); // New line after response only if no post-processing
    }
    
    return response;
  } catch (error) {
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
      console.log(chalk.gray(`  Agentic mode: ${options.agenticMode !== false ? 'ENABLED' : 'DISABLED'}`));
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
      
    case '/version':
      console.log(chalk.blue('\n🤖 Cognitron v' + CONFIG.VERSION));
      console.log(chalk.gray(`  Model: ${CONFIG.MODEL}`));
      console.log(chalk.gray('  Powered by Groq'));
      console.log();
      return true;
      
    case '/reasoning':
      // Get current level index and cycle to next level
      const currentIndex = CONFIG.REASONING_LEVELS.indexOf(options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL);
      const nextIndex = (currentIndex + 1) % CONFIG.REASONING_LEVELS.length;
      options.reasoningLevel = CONFIG.REASONING_LEVELS[nextIndex];
      options.agentAdjusted = false; // Clear agent adjustment flag when user manually changes
      
      const levelEmojis = { 'low': '🔹', 'medium': '🔶', 'high': '🔴' };
      const levelDescriptions = {
        'low': 'Direct answers without thinking steps',
        'medium': 'Thinking shown for complex questions only', 
        'high': 'Detailed thinking shown for all responses'
      };
      
      console.log(chalk.blue(`\n👤 Manual Override: ${levelEmojis[options.reasoningLevel]} ${chalk.bold(options.reasoningLevel.toUpperCase())}`));
      console.log(chalk.gray(`  ${levelDescriptions[options.reasoningLevel]}`));
      console.log(chalk.gray(`  Agent auto-adjustment: ${options.agenticMode !== false ? 'ENABLED' : 'DISABLED'}\n`));
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
      console.log(chalk.gray('  /reasoning  - Manual override of reasoning level'));
      console.log(chalk.gray('  /agent      - Toggle autonomous reasoning adjustment'));
      console.log(chalk.gray('  /history    - Show full conversation history'));
      console.log(chalk.gray('  /limit      - Show/set history limit percentage'));
      console.log(chalk.gray('  /stats      - Show session statistics'));
      console.log(chalk.gray('  /clear      - Clear conversation history'));
      console.log(chalk.gray('  /reset      - Same as /clear'));
      console.log(chalk.gray('  /version    - Show version information'));
      console.log(chalk.gray('  /help       - Show this help message'));
      console.log(chalk.gray('\n💡 Tips:'));
      console.log(chalk.gray('  • Use /reasoning to manually override reasoning level'));
      console.log(chalk.gray('  • Use /agent to toggle autonomous reasoning adjustment'));
      console.log(chalk.gray('  • Use /limit 75 to set history to 75% of context window'));
      console.log(chalk.gray('  • Use /history to review past conversations and thoughts'));
      console.log(chalk.gray('  • Agent can auto-adjust reasoning based on question complexity'));
      console.log();
      return true;
      
    case '/agent':
      options.agenticMode = options.agenticMode !== false ? false : true;
      const agentStatus = options.agenticMode ? 'ENABLED' : 'DISABLED';
      const agentEmoji = options.agenticMode ? '🤖' : '🚫';
      
      console.log(chalk.blue(`\n${agentEmoji} Agentic Mode: ${chalk.bold(agentStatus)}`));
      
      if (options.agenticMode) {
        console.log(chalk.gray('  The agent can now autonomously adjust reasoning levels'));
        console.log(chalk.gray('  based on question complexity and context.'));
      } else {
        console.log(chalk.gray('  Agent will use manual reasoning level settings only.'));
        console.log(chalk.gray('  Use /reasoning to change levels manually.'));
      }
      
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
  if (options.agenticMode === undefined) {
    options.agenticMode = CONFIG.AGENTIC_MODE;
  }
  
  const levelEmojis = { 'low': '🔹', 'medium': '🔶', 'high': '🔴' };
  const agentEmoji = options.agenticMode ? '🤖' : '🚫';
  
  console.log(chalk.blue(`🤖 Welcome to Cognitron ${CONFIG.VERSION}! Type "/exit" to quit.`));
  console.log(chalk.gray(`Reasoning level: ${levelEmojis[options.reasoningLevel]} ${options.reasoningLevel.toUpperCase()} (manual override: /reasoning)`));
  console.log(chalk.gray(`Agentic mode: ${agentEmoji} ${options.agenticMode ? 'ENABLED' : 'DISABLED'} (toggle: /agent)`));
  console.log(chalk.gray(`History limit: ${options.historyLimitPercent}% of context window`));
  console.log(chalk.gray('Available commands: /help, /agent, /reasoning, /history, /limit, /stats, /clear, /exit\n'));
  
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
  .version('1.0.1-agentic')
  .option('-p, --persona <file>', 'Load persona from text file')
  .option('-r, --reasoning', 'Start with high reasoning level');

program
  .command('chat')
  .description('Start interactive chat mode')
  .option('-r, --reasoning', 'Start with high reasoning level')
  .option('-p, --persona <file>', 'Load persona from text file')
  .action((options) => {
    if (options.persona) {
      if (!loadPersona(options.persona)) {
        process.exit(1);
      }
    }
    const reasoningLevel = options.reasoning ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
    interactiveMode({ reasoningLevel });
  });

program
  .command('ask')
  .description('Ask a single question')
  .argument('<question>', 'The question to ask')
  .option('-r, --reasoning', 'Use high reasoning level')
  .option('-p, --persona <file>', 'Load persona from text file')
  .action(async (question, options) => {
    if (!question?.trim()) {
      console.error(chalk.red('Question cannot be empty'));
      process.exit(1);
    }
    
    if (options.persona) {
      if (!loadPersona(options.persona)) {
        process.exit(1);
      }
    }
    
    const reasoningLevel = options.reasoning ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
    process.stdout.write(chalk.cyan('Cognitron: '));
    
    try {
      await chatWithGroq(question.trim(), [], { reasoningLevel });
    } catch (error) {
      console.error(chalk.red('Failed to get response:'), error.message);
      process.exit(1);
    }
  });

// Parse command line arguments
program.parse();

// Handle global persona option for all modes
const globalOptions = program.opts();
if (globalOptions.persona) {
  if (!loadPersona(globalOptions.persona)) {
    process.exit(1);
  }
}

// Handle default interactive mode (no subcommand specified)
if (!process.argv.slice(2).some(arg => arg === 'chat' || arg === 'ask')) {
  const reasoningLevel = globalOptions.reasoning ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
  interactiveMode({ reasoningLevel });
}