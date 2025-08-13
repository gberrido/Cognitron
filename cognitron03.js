#!/usr/bin/env node

import { Groq } from 'groq-sdk';
import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import fs from 'fs/promises';
import { createWriteStream, createReadStream, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration constants
const CONFIG = {
  VERSION: '1.0.3-memory',
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
  SLASH_COMMANDS: ['/exit', '/stats', '/clear', '/help', '/reset', '/version', '/reasoning', '/history', '/limit', '/agent', '/search', '/recall', '/memory'],
  // Agentic settings
  AGENTIC_MODE: true,
  SHOW_AGENT_DECISIONS: true,
  MAX_TOOL_CALLS_PER_RESPONSE: 5,
  // Memory settings
  CONVERSATIONS_DIR: path.join(__dirname, 'conversations'),
  ENABLE_MEMORY: true,
  MAX_CONVERSATION_DAYS: 30, // Keep conversations for 30 days
  INDEX_REBUILD_THRESHOLD: 100 // Rebuild index after N new messages
};

// Initialize Groq client
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || 'YOUR_GROQ_API_KEY_HERE'
});

const program = new Command();
const THINK_REGEX = /<think>([\s\S]*?)<\/think>/g;

// Memory system globals
let currentSessionId = generateSessionId();
let searchIndex = { terms: {}, sessions: {}, recent: [], topics: {} };
let userPatterns = { preferences: {}, expertise: {}, behavior: {} };
let messageIdCounter = 0;

// Agentic tool definitions (expanded with memory tools)
const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'adjust_reasoning_level',
      description: 'Adjust the reasoning effort level based on question complexity. Call this BEFORE providing your main response if current level is not optimal.',
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
  },
  {
    type: 'function',
    function: {
      name: 'manage_context',
      description: 'Manage conversation context and memory when approaching limits or optimization is needed.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['clear_oldest', 'summarize', 'adjust_limit'],
            description: 'clear_oldest: remove old messages; summarize: compress context; adjust_limit: change context percentage'
          },
          count: {
            type: 'number',
            description: 'Number of message pairs to clear (for clear_oldest action)'
          },
          percentage: {
            type: 'number',
            minimum: 10,
            maximum: 90,
            description: 'New context limit percentage (for adjust_limit action)'
          },
          reason: {
            type: 'string',
            description: 'Explanation for why this context management is needed'
          }
        },
        required: ['action', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'adjust_temperature',
      description: 'Adjust response creativity/randomness based on task type.',
      parameters: {
        type: 'object',
        properties: {
          temperature: {
            type: 'number',
            minimum: 0.1,
            maximum: 2.0,
            description: 'Lower values (0.1-0.5) for factual/precise tasks, higher (0.8-1.5) for creative tasks'
          },
          reason: {
            type: 'string',
            description: 'Explanation for why this temperature adjustment is needed'
          }
        },
        required: ['temperature', 'reason']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_conversation_history',
      description: 'Search through past conversations for relevant information. Use this when user asks about previous discussions or when context from past conversations would be helpful.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query - keywords or phrases to find in past conversations'
          },
          date_filter: {
            type: 'string',
            enum: ['today', 'yesterday', 'week', 'month', 'all'],
            description: 'Limit search to specific time period'
          },
          max_results: {
            type: 'number',
            minimum: 1,
            maximum: 20,
            description: 'Maximum number of results to return (default: 5)'
          }
        },
        required: ['query']
      }
    }
  }
];

/**
 * Generates a unique session ID
 * @returns {string} Session ID in format: YYYYMMDD-HHMMSS-random
 */
function generateSessionId() {
  const now = new Date();
  const date = now.toISOString().slice(0, 19).replace(/[T:-]/g, '');
  const random = Math.random().toString(36).substr(2, 4);
  return `${date}-${random}`;
}

/**
 * Gets the current date in YYYY-MM-DD format for file naming
 * @returns {string} Current date string
 */
function getCurrentDateString() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Gets the path to the conversation file for a given date
 * @param {string} dateString - Date in YYYY-MM-DD format
 * @returns {string} Full path to conversation file
 */
function getConversationFilePath(dateString = getCurrentDateString()) {
  return path.join(CONFIG.CONVERSATIONS_DIR, `${dateString}.jsonl`);
}

/**
 * Gets the path to the search index file
 * @returns {string} Full path to search index file
 */
function getSearchIndexPath() {
  return path.join(CONFIG.CONVERSATIONS_DIR, 'search-index.json');
}

/**
 * Gets the path to the user patterns file
 * @returns {string} Full path to user patterns file
 */
function getUserPatternsPath() {
  return path.join(CONFIG.CONVERSATIONS_DIR, 'user-patterns.json');
}

/**
 * Initializes the memory system by creating directories and loading indices
 */
async function initializeMemorySystem() {
  try {
    // Create conversations directory if it doesn't exist
    await fs.mkdir(CONFIG.CONVERSATIONS_DIR, { recursive: true });
    
    // Load search index
    try {
      const indexData = await fs.readFile(getSearchIndexPath(), 'utf-8');
      searchIndex = JSON.parse(indexData);
    } catch (error) {
      // Index doesn't exist, start with empty index
      searchIndex = { terms: {}, sessions: {}, recent: [], topics: {} };
    }
    
    // Load user patterns
    try {
      const patternsData = await fs.readFile(getUserPatternsPath(), 'utf-8');
      userPatterns = JSON.parse(patternsData);
    } catch (error) {
      // Patterns don't exist, start with empty patterns
      userPatterns = { preferences: {}, expertise: {}, behavior: {} };
    }
    
    // Set message ID counter from recent messages and indexed terms
    if (searchIndex.recent && searchIndex.recent.length > 0) {
      messageIdCounter = Math.max(...searchIndex.recent) + 1;
    }
    
    // Also check all indexed terms for the highest message ID
    const allMessageIds = [];
    Object.values(searchIndex.terms).forEach(ids => allMessageIds.push(...ids));
    if (allMessageIds.length > 0) {
      messageIdCounter = Math.max(messageIdCounter, Math.max(...allMessageIds) + 1);
    }
    
  } catch (error) {
    console.error(chalk.red('Error initializing memory system:'), error.message);
  }
}

/**
 * Logs a conversation message to JSONL file
 * @param {string} role - Message role (user/assistant/system)
 * @param {string} content - Message content
 * @param {Object} metadata - Additional metadata
 */
async function logConversationMessage(role, content, metadata = {}) {
  if (!CONFIG.ENABLE_MEMORY) return;
  
  try {
    const messageId = messageIdCounter++;
    const timestamp = new Date().toISOString();
    const conversationFile = getConversationFilePath();
    
    const logEntry = {
      id: messageId,
      timestamp,
      session: currentSessionId,
      role,
      content,
      ...metadata
    };
    
    // Append to JSONL file
    const writeStream = createWriteStream(conversationFile, { flags: 'a' });
    writeStream.write(JSON.stringify(logEntry) + '\n');
    writeStream.end();
    
    // Update search index
    await updateSearchIndex(logEntry);
    
  } catch (error) {
    console.error(chalk.red('Error logging conversation message:'), error.message);
  }
}

/**
 * Updates the search index with a new message
 * @param {Object} logEntry - The message log entry
 */
async function updateSearchIndex(logEntry) {
  try {
    const { id, content, timestamp, session, role } = logEntry;
    
    // Extract keywords from content (simple tokenization)
    const words = content.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2); // Filter out short words
    
    // Update terms index
    words.forEach(word => {
      if (!searchIndex.terms[word]) {
        searchIndex.terms[word] = [];
      }
      if (!searchIndex.terms[word].includes(id)) {
        searchIndex.terms[word].push(id);
      }
    });
    
    // Update sessions index
    if (!searchIndex.sessions[session]) {
      searchIndex.sessions[session] = {
        start: timestamp,
        messages: [],
        file: getCurrentDateString()
      };
    }
    searchIndex.sessions[session].messages.push(id);
    
    // Update recent messages (keep last 100)
    searchIndex.recent.push(id);
    if (searchIndex.recent.length > 100) {
      searchIndex.recent = searchIndex.recent.slice(-100);
    }
    
    // Save index frequently for testing, less frequently in production
    if (id % 2 === 0) { // Save every 2 messages for now
      await saveSearchIndex();
    }
    
  } catch (error) {
    console.error(chalk.red('Error updating search index:'), error.message);
  }
}

/**
 * Saves the search index to file
 */
async function saveSearchIndex() {
  try {
    await fs.writeFile(getSearchIndexPath(), JSON.stringify(searchIndex, null, 2));
  } catch (error) {
    console.error(chalk.red('Error saving search index:'), error.message);
  }
}

/**
 * Saves user patterns to file
 */
async function saveUserPatterns() {
  try {
    await fs.writeFile(getUserPatternsPath(), JSON.stringify(userPatterns, null, 2));
  } catch (error) {
    console.error(chalk.red('Error saving user patterns:'), error.message);
  }
}

/**
 * Searches conversation history based on query
 * @param {string} query - Search query
 * @param {Object} options - Search options
 * @returns {Array} Search results
 */
async function searchConversationHistory(query, options = {}) {
  const { date_filter = 'all', max_results = 5 } = options;
  
  try {
    // Get candidate message IDs from index
    const queryWords = query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
    
    const candidateIds = new Set();
    
    // Find messages containing query words
    queryWords.forEach(word => {
      if (searchIndex.terms[word]) {
        searchIndex.terms[word].forEach(id => candidateIds.add(id));
      }
    });
    
    if (candidateIds.size === 0) {
      return [];
    }
    
    // Load and filter messages
    const results = await loadMessagesById([...candidateIds]);
    
    // Apply date filter
    const filteredResults = results.filter(msg => {
      if (!msg || !msg.timestamp) return false;
      
      const msgDate = new Date(msg.timestamp);
      const now = new Date();
      
      switch (date_filter) {
        case 'today':
          return msgDate.toDateString() === now.toDateString();
        case 'yesterday':
          const yesterday = new Date(now);
          yesterday.setDate(yesterday.getDate() - 1);
          return msgDate.toDateString() === yesterday.toDateString();
        case 'week':
          const weekAgo = new Date(now);
          weekAgo.setDate(weekAgo.getDate() - 7);
          return msgDate >= weekAgo;
        case 'month':
          const monthAgo = new Date(now);
          monthAgo.setMonth(monthAgo.getMonth() - 1);
          return msgDate >= monthAgo;
        default:
          return true;
      }
    });
    
    // Score and sort results
    const scoredResults = filteredResults.map(msg => {
      let score = 0;
      const content = msg.content.toLowerCase();
      
      // Score based on exact query matches
      if (content.includes(query.toLowerCase())) {
        score += 10;
      }
      
      // Score based on individual word matches
      queryWords.forEach(word => {
        if (content.includes(word)) {
          score += 2;
        }
      });
      
      // Boost recent messages
      const age = (Date.now() - new Date(msg.timestamp).getTime()) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 5 - age); // Boost messages from last 5 days
      
      return { ...msg, score };
    });
    
    // Sort by score and return top results
    return scoredResults
      .sort((a, b) => b.score - a.score)
      .slice(0, max_results);
      
  } catch (error) {
    console.error(chalk.red('Error searching conversation history:'), error.message);
    return [];
  }
}

/**
 * Loads messages by their IDs from JSONL files
 * @param {Array} messageIds - Array of message IDs to load
 * @returns {Array} Array of message objects
 */
async function loadMessagesById(messageIds) {
  const messages = [];
  const filesByDate = {};
  
  try {
    // Group message IDs by the files that likely contain them
    // For now, we'll check all available JSONL files
    const files = await fs.readdir(CONFIG.CONVERSATIONS_DIR);
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
    
    for (const file of jsonlFiles) {
      const filePath = path.join(CONFIG.CONVERSATIONS_DIR, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (messageIds.includes(message.id)) {
            messages.push(message);
          }
        } catch (parseError) {
          // Skip malformed lines
          continue;
        }
      }
    }
    
    return messages;
  } catch (error) {
    console.error(chalk.red('Error loading messages by ID:'), error.message);
    return [];
  }
}

/**
 * Executes an agent tool call and updates options
 * @param {Object} toolCall - The tool call from the API
 * @param {Object} options - Mutable options object
 * @param {Array} conversationHistory - Conversation history
 * @returns {Object} Tool execution result with success status and message
 */
function executeAgentTool(toolCall, options, conversationHistory) {
  try {
    const { name, arguments: args } = toolCall.function;
    
    switch (name) {
      case 'adjust_reasoning_level':
        const { level, reason } = args;
        const oldLevel = options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL;
        
        if (!CONFIG.REASONING_LEVELS.includes(level)) {
          return { success: false, message: `Invalid reasoning level: ${level}` };
        }
        
        if (level === oldLevel) {
          return { success: true, message: `Reasoning level already optimal: ${level.toUpperCase()}` };
        }
        
        options.reasoningLevel = level;
        options.agentAdjusted = true;
        
        return {
          success: true,
          message: `Reasoning: ${oldLevel.toUpperCase()} → ${level.toUpperCase()}`,
          details: reason
        };
        
      case 'manage_context':
        const { action, count, percentage, reason: contextReason } = args;
        let result = '';
        
        switch (action) {
          case 'clear_oldest':
            const messagesToRemove = Math.min(count || 2, conversationHistory.length);
            const pairsToRemove = Math.floor(messagesToRemove / 2) * 2; // Remove in pairs
            conversationHistory.splice(0, pairsToRemove);
            result = `Cleared ${pairsToRemove} old messages`;
            break;
            
          case 'adjust_limit':
            if (percentage >= CONFIG.MIN_HISTORY_LIMIT_PERCENT && percentage <= CONFIG.MAX_HISTORY_LIMIT_PERCENT) {
              const oldLimit = options.historyLimitPercent || CONFIG.DEFAULT_HISTORY_LIMIT_PERCENT;
              options.historyLimitPercent = percentage;
              result = `Context limit: ${oldLimit}% → ${percentage}%`;
            } else {
              return { success: false, message: `Invalid percentage: ${percentage}% (must be ${CONFIG.MIN_HISTORY_LIMIT_PERCENT}-${CONFIG.MAX_HISTORY_LIMIT_PERCENT}%)` };
            }
            break;
            
          case 'summarize':
            // Placeholder for future summarization feature
            result = 'Context summarization not yet implemented';
            break;
            
          default:
            return { success: false, message: `Unknown context action: ${action}` };
        }
        
        return {
          success: true,
          message: result,
          details: contextReason
        };
        
      case 'adjust_temperature':
        const { temperature, reason: tempReason } = args;
        
        if (temperature < 0.1 || temperature > 2.0) {
          return { success: false, message: `Invalid temperature: ${temperature} (must be 0.1-2.0)` };
        }
        
        const oldTemp = options.temperature || CONFIG.TEMPERATURE;
        options.temperature = temperature;
        
        return {
          success: true,
          message: `Temperature: ${oldTemp} → ${temperature}`,
          details: tempReason
        };
        
      case 'search_conversation_history':
        // This is handled asynchronously, return a placeholder
        return {
          success: true,
          message: 'Searching conversation history...',
          details: `Query: ${args.query}`
        };
        
      default:
        return { success: false, message: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { success: false, message: `Tool execution error: ${error.message}` };
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
 * @param {boolean} agenticMode - Whether to enable autonomous tool calling
 * @returns {string} System message for the AI
 */
function createSystemMessage(reasoningLevel = 'low', agenticMode = false) {
  const baseMessage = "You are Cognitron, a helpful AI assistant with memory capabilities. Be concise, accurate, and friendly.";
  
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
    const agenticInstructions = `\n\nAGENTIC CAPABILITIES:\nYou have access to tools for self-optimization and memory. Before responding to user questions, evaluate if you need to:\n\n1. ADJUST_REASONING_LEVEL: Current level is ${reasoningLevel}\n   - LOW: greetings, simple facts, basic questions\n   - MEDIUM: explanations, moderate analysis, how-to questions\n   - HIGH: complex math, logic puzzles, multi-step reasoning, detailed analysis\n\n2. MANAGE_CONTEXT: If approaching context limits or need optimization\n   - Clear old messages if context is getting full\n   - Adjust context limits for long conversations\n\n3. ADJUST_TEMPERATURE: For different task types\n   - Lower (0.1-0.5): factual, precise, code generation\n   - Higher (0.8-1.5): creative writing, brainstorming\n\n4. SEARCH_CONVERSATION_HISTORY: When user asks about past discussions\n   - Search past conversations for relevant information\n   - Use when context from previous sessions would be helpful\n   - Reference specific past conversations when relevant\n\nCall the appropriate tools BEFORE your main response if optimizations are needed. You can call multiple tools in sequence.`;
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

  // Log user message to memory system
  await logConversationMessage('user', message, {
    reasoning_level: options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL,
    tokens: estimateTokenCount(message)
  });

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
    
    // Enable tools if in agentic mode
    if (agenticMode) {
      requestOptions.tools = AGENT_TOOLS;
      requestOptions.tool_choice = 'auto';
    }
    
    const chatCompletion = await groq.chat.completions.create(requestOptions);

    let response = '';
    let toolCalls = [];
    let hasToolCalls = false;
    let finishReason = null;
    
    // Collect streaming response
    for await (const chunk of chatCompletion) {
      const choice = chunk.choices[0];
      
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
      
      // Handle tool calls in streaming
      if (choice?.delta?.tool_calls) {
        hasToolCalls = true;
        // Merge tool call deltas
        for (const toolCallDelta of choice.delta.tool_calls) {
          if (!toolCalls[toolCallDelta.index]) {
            toolCalls[toolCallDelta.index] = {
              id: toolCallDelta.id,
              type: 'function',
              function: {
                name: toolCallDelta.function?.name || '',
                arguments: toolCallDelta.function?.arguments || ''
              }
            };
          } else {
            // Append to existing tool call
            if (toolCallDelta.function?.name) {
              toolCalls[toolCallDelta.index].function.name += toolCallDelta.function.name;
            }
            if (toolCallDelta.function?.arguments) {
              toolCalls[toolCallDelta.index].function.arguments += toolCallDelta.function.arguments;
            }
          }
        }
        continue;
      }
      
      const content = choice?.delta?.content || '';
      response += content;
      
      // Stream content if no tool calls are being made
      if (!hasToolCalls) {
        process.stdout.write(content);
      }
    }
    
    // Process tool calls if any were made
    if (hasToolCalls && toolCalls.length > 0) {
      const toolResults = [];
      let settingsChanged = false;
      let searchResults = null;
      
      if (CONFIG.SHOW_AGENT_DECISIONS) {
        console.log(chalk.blue('\n🔧 Agent Tool Calls:'));
      }
      
      // Execute each tool call
      for (const toolCall of toolCalls.slice(0, CONFIG.MAX_TOOL_CALLS_PER_RESPONSE)) {
        try {
          // Parse arguments if they're a string
          if (typeof toolCall.function.arguments === 'string') {
            toolCall.function.arguments = JSON.parse(toolCall.function.arguments);
          }
          
          // Handle search tool specially (async)
          if (toolCall.function.name === 'search_conversation_history') {
            const args = toolCall.function.arguments;
            searchResults = await searchConversationHistory(args.query, {
              date_filter: args.date_filter,
              max_results: args.max_results || 5
            });
            
            const result = {
              success: true,
              message: `Found ${searchResults.length} relevant messages`,
              details: `Query: "${args.query}"`
            };
            toolResults.push(result);
            
            if (CONFIG.SHOW_AGENT_DECISIONS) {
              console.log(chalk.blue(`   ✅ search_conversation_history(${JSON.stringify(args, null, 0)})`));
              console.log(chalk.blue(`      → ${result.message}`));
              if (result.details) {
                console.log(chalk.gray(`      📝 ${result.details}`));
              }
              
              // Show search results
              if (searchResults.length > 0) {
                console.log(chalk.gray('      📋 Search Results:'));
                searchResults.forEach((msg, idx) => {
                  const preview = msg.content.substring(0, 80);
                  const timestamp = new Date(msg.timestamp).toLocaleString();
                  console.log(chalk.gray(`        ${idx + 1}. [${timestamp}] ${preview}${msg.content.length > 80 ? '...' : ''}`));
                });
              }
            }
            
          } else {
            // Handle other tools normally
            const result = executeAgentTool(toolCall, options, conversationHistory);
            toolResults.push(result);
            
            if (CONFIG.SHOW_AGENT_DECISIONS) {
              const icon = result.success ? '✅' : '❌';
              const funcName = toolCall.function.name;
              const args = JSON.stringify(toolCall.function.arguments, null, 0);
              
              console.log(chalk.blue(`   ${icon} ${funcName}(${args})`));
              console.log(chalk.blue(`      → ${result.message}`));
              if (result.details) {
                console.log(chalk.gray(`      📝 ${result.details}`));
              }
            }
            
            if (result.success && toolCall.function.name !== 'search_conversation_history') {
              settingsChanged = true;
            }
          }
          
        } catch (error) {
          const errorResult = { success: false, message: `Tool execution failed: ${error.message}` };
          toolResults.push(errorResult);
          
          if (CONFIG.SHOW_AGENT_DECISIONS) {
            console.log(chalk.red(`   ❌ ${toolCall.function.name}: ${errorResult.message}`));
          }
        }
      }
      
      // If settings were changed, make a follow-up request
      if (settingsChanged) {
        if (CONFIG.SHOW_AGENT_DECISIONS) {
          console.log(chalk.gray('\n🔄 Responding with optimized settings...\n'));
        }
        
        // Recursive call with updated settings (disable agentic mode to prevent loops)
        const followUpOptions = { ...options, agenticMode: false };
        return await chatWithGroq(message, conversationHistory, followUpOptions);
      } else {
        // No settings changed, but tools were called - continue with normal response
        if (response) {
          process.stdout.write(response);
        }
      }
    }
    
    // Process regular response (only if no tool calls were made or no settings changed)
    if (!hasToolCalls || (!settingsChanged && hasToolCalls)) {
      const currentReasoningLevel = options.reasoningLevel || CONFIG.DEFAULT_REASONING_LEVEL;
      const shouldShowReasoning = currentReasoningLevel !== 'low';
      processResponseWithReasoning(response, shouldShowReasoning);
    }
    
    if (!response.includes('<think>')) {
      console.log(); // New line after response only if no post-processing
    }
    
    // Log assistant response to memory system
    await logConversationMessage('assistant', response, {
      reasoning_level: reasoningLevel,
      tokens: estimateTokenCount(response),
      tool_calls_made: hasToolCalls,
      finish_reason: finishReason
    });
    
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
async function handleSlashCommand(command, conversationHistory, options) {
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
      const results = await searchConversationHistory(query, { max_results: 10 });
      
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
    console.log(chalk.gray(`  Session ID: ${currentSessionId}`));
    console.log(chalk.gray(`  Memory enabled: ${CONFIG.ENABLE_MEMORY ? 'YES' : 'NO'}`));
    console.log(chalk.gray(`  Conversations directory: ${CONFIG.CONVERSATIONS_DIR}`));
    console.log(chalk.gray(`  Total indexed terms: ${Object.keys(searchIndex.terms).length.toLocaleString()}`));
    console.log(chalk.gray(`  Total sessions: ${Object.keys(searchIndex.sessions).length.toLocaleString()}`));
    console.log(chalk.gray(`  Recent messages tracked: ${searchIndex.recent.length}`));
    console.log(chalk.gray(`  Message ID counter: ${messageIdCounter}`));
    
    // Show conversation files
    try {
      const files = await fs.readdir(CONFIG.CONVERSATIONS_DIR);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      console.log(chalk.gray(`  Conversation files: ${jsonlFiles.length}`));
      if (jsonlFiles.length > 0) {
        console.log(chalk.gray(`  Files: ${jsonlFiles.slice(-5).join(', ')}`));
      }
    } catch (error) {
      console.log(chalk.gray('  Error reading conversation files'));
    }
    
    console.log();
    return true;
  }

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
      // Save indices before exit
      await saveSearchIndex();
      await saveUserPatterns();
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
      console.log(chalk.gray(`  Memory system: ${CONFIG.ENABLE_MEMORY ? 'ENABLED' : 'DISABLED'}`));
      console.log(chalk.gray('\n📝 Context Usage:'));
      console.log(chalk.gray(`  Context window: ${CONFIG.CONTEXT_WINDOW.toLocaleString()} tokens (128K)`));
      console.log(chalk.gray(`  Estimated usage: ${contextUsage.totalTokens.toLocaleString()} tokens`));
      console.log(contextColor(`  Usage percentage: ${contextUsage.usagePercentage}%`));
      console.log(chalk.gray(`  Remaining tokens: ${contextUsage.remainingTokens.toLocaleString()}`));
      
      // Memory stats
      if (CONFIG.ENABLE_MEMORY) {
        console.log(chalk.gray('\n🧠 Memory Statistics:'));
        console.log(chalk.gray(`  Session: ${currentSessionId}`));
        console.log(chalk.gray(`  Indexed terms: ${Object.keys(searchIndex.terms).length.toLocaleString()}`));
        console.log(chalk.gray(`  Tracked sessions: ${Object.keys(searchIndex.sessions).length.toLocaleString()}`));
        console.log(chalk.gray(`  Recent messages: ${searchIndex.recent.length}`));
      }
      
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
      console.log(chalk.gray('  Features: Memory system, Function calling, Agentic tools'));
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
      console.log(chalk.blue('\n🧠 Memory Commands:'));
      console.log(chalk.gray('  /search <query>  - Search conversation history'));
      console.log(chalk.gray('  /memory          - Show memory system status'));
      console.log(chalk.gray('\n💡 Tips:'));
      console.log(chalk.gray('  • Use /reasoning to manually override reasoning level'));
      console.log(chalk.gray('  • Use /agent to toggle autonomous reasoning adjustment'));
      console.log(chalk.gray('  • Use /limit 75 to set history to 75% of context window'));
      console.log(chalk.gray('  • Use /history to review past conversations and thoughts'));
      console.log(chalk.gray('  • Use /search to find specific topics from past conversations'));
      console.log(chalk.gray('  • Agent can auto-adjust reasoning based on question complexity'));
      console.log(chalk.gray('  • Agent can search your conversation history when relevant'));
      console.log();
      return true;
      
    case '/agent':
      options.agenticMode = options.agenticMode !== false ? false : true;
      const agentStatus = options.agenticMode ? 'ENABLED' : 'DISABLED';
      const agentEmoji = options.agenticMode ? '🤖' : '🚫';
      
      console.log(chalk.blue(`\n${agentEmoji} Agentic Mode: ${chalk.bold(agentStatus)}`));
      
      if (options.agenticMode) {
        console.log(chalk.gray('  The agent can now autonomously:'));
        console.log(chalk.gray('  • Adjust reasoning levels based on question complexity'));
        console.log(chalk.gray('  • Search conversation history when relevant'));
        console.log(chalk.gray('  • Manage context and temperature settings'));
      } else {
        console.log(chalk.gray('  Agent will use manual settings only.'));
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
  // Initialize memory system
  await initializeMemorySystem();
  
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
  const memoryEmoji = CONFIG.ENABLE_MEMORY ? '🧠' : '🚫';
  
  console.log(chalk.blue(`🤖 Welcome to Cognitron ${CONFIG.VERSION}! Type "/exit" to quit.`));
  console.log(chalk.gray(`Reasoning level: ${levelEmojis[options.reasoningLevel]} ${options.reasoningLevel.toUpperCase()} (manual override: /reasoning)`));
  console.log(chalk.gray(`Agentic mode: ${agentEmoji} ${options.agenticMode ? 'ENABLED' : 'DISABLED'} (toggle: /agent)`));
  console.log(chalk.gray(`Memory system: ${memoryEmoji} ${CONFIG.ENABLE_MEMORY ? 'ENABLED' : 'DISABLED'} (status: /memory)`));
  console.log(chalk.gray(`History limit: ${options.historyLimitPercent}% of context window`));
  console.log(chalk.gray('Available commands: /help, /agent, /reasoning, /history, /search, /memory, /stats, /clear, /exit\n'));
  
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
        const shouldContinue = await handleSlashCommand(trimmedInput, conversationHistory, options);
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
  .description('A CLI chat agent powered by Groq and OpenAI GPT-OSS-120B with memory capabilities')
  .version(CONFIG.VERSION);

program
  .command('chat')
  .description('Start interactive chat mode')
  .option('-r, --reasoning', 'Start with high reasoning level')
  .action(async () => {
    const reasoningLevel = hasReasoningFlag ? 'high' : CONFIG.DEFAULT_REASONING_LEVEL;
    await interactiveMode({ reasoningLevel });
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
    
    // Initialize memory system for single questions too
    await initializeMemorySystem();
    
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