#!/usr/bin/env node

/**
 * MemGPT Response Processor - Handles response formatting and memory visualization
 * Enhanced for MemGPT memory operations and stateful conversations
 */

import readline from 'readline';

export class ResponseProcessor {
  constructor(config = {}) {
    this.config = {
      showThinking: config.showThinking !== false,
      showMemoryOperations: config.showMemoryOperations !== false,
      showMemoryStatus: config.showMemoryStatus !== false,
      streamOutput: config.streamOutput !== false,
      colors: config.colors !== false,
      ...config
    };
    
    this.rl = null;
  }

  /**
   * Initialize readline interface if needed
   */
  initializeReadline() {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
    }
    return this.rl;
  }

  /**
   * Format and display assistant response with MemGPT enhancements
   */
  async displayResponse(response, options = {}) {
    const { 
      showToolOutput = this.config.showMemoryOperations,
      showMemoryStatus = this.config.showMemoryStatus 
    } = options;

    // Show memory operations if available and enabled
    if (response.toolOutput && showToolOutput) {
      this.print(response.toolOutput);
    }

    // Show main response content
    if (response.content && response.content.trim()) {
      if (this.config.streamOutput && !options.noStream) {
        await this.streamText(response.content);
      } else {
        this.print(response.content);
      }
    } else if (response.toolCalls && response.toolCalls.length > 0) {
      // If no content but there were memory operations, provide context
      this.print(this.colorize('Processing memory operations...', 'dim'));
    }

    // Show memory pressure warnings
    if (response.memoryPressure && response.memoryPressure.warning) {
      this.displayMemoryPressureWarning(response.memoryPressure);
    }

    // Show session resumption info
    if (response.sessionResumed) {
      this.displaySessionResumption(response.sessionInfo);
    }

    // Show follow-up response indicator
    if (response.isFollowUp) {
      this.print(this.colorize('\n[Response generated after memory operations]', 'dim'));
    }

    // Show usage and memory status if available
    if (response.usage && options.showUsage) {
      this.displayUsageInfo(response.usage, response.memoryUsage);
    }
  }

  /**
   * Display memory pressure warning
   */
  displayMemoryPressureWarning(pressure) {
    const icon = pressure.usage > 90 ? '🔴' : '🟡';
    const message = `${icon} Memory Pressure: ${pressure.usage}% used (${pressure.available} tokens available)`;
    this.print(this.colorize(message, 'yellow'));
    this.print(this.colorize('Consider using memory management tools to optimize context usage.', 'dim'));
  }

  /**
   * Display session resumption information
   */
  displaySessionResumption(sessionInfo) {
    this.print(this.colorize('🔄 Conversation resumed from previous session', 'cyan'));
    if (sessionInfo) {
      this.print(this.colorize(`   Session: ${sessionInfo.sessionId}`, 'dim'));
      this.print(this.colorize(`   Messages: ${sessionInfo.messageCount}`, 'dim'));
      if (sessionInfo.lastActive) {
        this.print(this.colorize(`   Last active: ${new Date(sessionInfo.lastActive).toLocaleString()}`, 'dim'));
      }
    }
    this.print('');
  }

  /**
   * Display memory system status
   */
  displayMemoryStatus(memoryStatus) {
    if (!memoryStatus) return;

    this.print(this.colorize('\n🧠 Memory System Status:', 'bright'));
    this.print(`   Working Context: ${memoryStatus.workingContextSize} entries`);
    this.print(`   Conversation Queue: ${memoryStatus.fifoQueueLength} messages`);
    this.print(`   Recall Storage: ${memoryStatus.recallStorageSize} total messages`);
    this.print(`   Archival Storage: ${memoryStatus.archivalStorageSize} entries`);
    
    if (memoryStatus.estimatedContextUsage) {
      const percentage = Math.round((memoryStatus.estimatedContextUsage / 8192) * 100);
      this.print(`   Context Usage: ~${memoryStatus.estimatedContextUsage} tokens (${percentage}%)`);
    }
    
    this.print('');
  }

  /**
   * Display usage information with memory context
   */
  displayUsageInfo(usage, memoryUsage = null) {
    const { prompt_tokens, completion_tokens, total_tokens } = usage;
    this.print(this.colorize(`\n📊 API Usage: ${prompt_tokens} prompt + ${completion_tokens} completion = ${total_tokens} total tokens`, 'dim'));
    
    if (memoryUsage) {
      this.print(this.colorize(`🧠 Memory Usage: ${memoryUsage.contextTokens} context tokens (${memoryUsage.percentage}%)`, 'dim'));
    }
  }

  /**
   * Stream text output character by character
   */
  async streamText(text, delay = 10) {
    for (const char of text) {
      process.stdout.write(char);
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    process.stdout.write('\n');
  }

  /**
   * Print text to console with optional formatting
   */
  print(text, options = {}) {
    const { newline = true, color } = options;
    const output = color ? this.colorize(text, color) : text;
    
    if (newline) {
      console.log(output);
    } else {
      process.stdout.write(output);
    }
  }

  /**
   * Apply color formatting to text
   */
  colorize(text, color) {
    if (!this.config.colors) return text;
    
    const colors = {
      reset: '\x1b[0m',
      bright: '\x1b[1m',
      dim: '\x1b[2m',
      red: '\x1b[31m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      blue: '\x1b[34m',
      magenta: '\x1b[35m',
      cyan: '\x1b[36m',
      white: '\x1b[37m'
    };
    
    return colors[color] ? `${colors[color]}${text}${colors.reset}` : text;
  }

  /**
   * Display error message
   */
  displayError(error, options = {}) {
    const { showStack = false } = options;
    
    this.print(`❌ Error: ${error.message}`, { color: 'red' });
    
    if (showStack && error.stack) {
      this.print(error.stack, { color: 'dim' });
    }
  }

  /**
   * Display warning message
   */
  displayWarning(message) {
    this.print(`⚠️  ${message}`, { color: 'yellow' });
  }

  /**
   * Display info message
   */
  displayInfo(message) {
    this.print(`ℹ️  ${message}`, { color: 'cyan' });
  }

  /**
   * Display success message
   */
  displaySuccess(message) {
    this.print(`✅ ${message}`, { color: 'green' });
  }

  /**
   * Show memory operation indicator
   */
  showMemoryOperation(operation = 'Managing memory...') {
    if (!this.config.showMemoryOperations) return;
    
    this.print(this.colorize(`🧠 ${operation}`, 'dim'));
  }

  /**
   * Show thinking/processing indicator
   */
  showThinking(message = 'Thinking...') {
    if (!this.config.showThinking) return;
    
    this.print(this.colorize(`🤔 ${message}`, 'dim'));
  }

  /**
   * Show typing indicator with animation
   */
  showTyping(duration = 1000) {
    if (!this.config.showThinking) return;
    
    return new Promise(resolve => {
      const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
      let i = 0;
      
      const interval = setInterval(() => {
        process.stdout.write(`\r${this.colorize(frames[i % frames.length] + ' Generating response...', 'dim')}`);
        i++;
      }, 80);
      
      setTimeout(() => {
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(30) + '\r');
        resolve();
      }, duration);
    });
  }

  /**
   * Display MemGPT-specific welcome message
   */
  displayWelcome(memoryStatus) {
    this.print(this.colorize('🧠 Welcome to Cognitron05 with MemGPT Memory', 'bright'));
    this.print(this.colorize('═'.repeat(50), 'bright'));
    
    if (memoryStatus && memoryStatus.sessionId) {
      if (memoryStatus.recallStorageSize > 0) {
        this.print(this.colorize(`Resuming session: ${memoryStatus.sessionId}`, 'cyan'));
        this.print(this.colorize(`Loaded ${memoryStatus.recallStorageSize} previous messages`, 'dim'));
      } else {
        this.print(this.colorize(`Starting new session: ${memoryStatus.sessionId}`, 'cyan'));
      }
      
      if (memoryStatus.workingContextSize > 0) {
        this.print(this.colorize(`Working context: ${memoryStatus.workingContextSize} persistent memories`, 'dim'));
      }
    }
    
    this.print('');
    this.print('Features:');
    this.print('• 🧠 Persistent memory across sessions');
    this.print('• 📚 Automatic conversation archiving');
    this.print('• 🔍 Searchable conversation history');
    this.print('• ⚙️  Intelligent memory management');
    this.print('• 💾 Stateful resumption');
    this.print('');
    this.print(this.colorize('Type your message or "/help" for commands', 'dim'));
    this.print('');
  }

  /**
   * Prompt user for input with MemGPT context
   */
  async promptUser(question, options = {}) {
    const rl = this.initializeReadline();
    const { defaultValue, validator } = options;
    
    return new Promise((resolve) => {
      const prompt = defaultValue ? `${question} (${defaultValue}): ` : `${question}: `;
      
      rl.question(this.colorize(prompt, 'cyan'), (answer) => {
        const value = answer.trim() || defaultValue || '';
        
        if (validator && !validator(value)) {
          this.displayError(new Error('Invalid input. Please try again.'));
          resolve(this.promptUser(question, options));
        } else {
          resolve(value);
        }
      });
    });
  }

  /**
   * Prompt user for confirmation
   */
  async confirmAction(message, defaultValue = true) {
    const defaultText = defaultValue ? 'Y/n' : 'y/N';
    const answer = await this.promptUser(`${message} (${defaultText})`);
    
    if (!answer) return defaultValue;
    
    const normalized = answer.toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  }

  /**
   * Display command help with MemGPT-specific commands
   */
  displayHelp() {
    this.print(this.colorize('\nCognitron05 Commands:', 'bright'));
    this.print('════════════════════');
    
    this.print('Chat Commands:');
    this.print('  /help        - Show this help');
    this.print('  /status      - Show memory and system status');
    this.print('  /memory      - Display memory system details');
    this.print('  /clear       - Clear current session (keeps persistent memory)');
    this.print('  /reset       - Reset all memory (working context, archival, etc.)');
    this.print('  /exit, /quit - Save state and exit');
    this.print('');
    
    this.print('Memory Commands:');
    this.print('  /search <query>   - Search conversation history');
    this.print('  /recall <topic>   - Recall information from archival memory');
    this.print('  /forget <key>     - Remove item from working context');
    this.print('  /sessions         - List previous sessions');
    this.print('');
    
    this.print('System Commands:');
    this.print('  /temperature <n>  - Set response temperature (0.0-2.0)');
    this.print('  /reasoning <level> - Set reasoning level (low/medium/high)');
    this.print('  /save            - Manually save memory state');
    this.print('');
  }

  /**
   * Clear console screen
   */
  clearScreen() {
    console.clear();
  }

  /**
   * Format object for display with memory-specific styling
   */
  formatObject(obj, options = {}) {
    const { indent = 2, colors = this.config.colors } = options;
    
    if (colors) {
      return JSON.stringify(obj, null, indent)
        .replace(/("([^"]+)":\s*)/g, this.colorize('$1', 'cyan'))
        .replace(/(:\s*)("([^"]+)")/g, `$1${this.colorize('$2', 'green')}`)
        .replace(/(:\s*)(\d+)/g, `$1${this.colorize('$2', 'yellow')}`);
    }
    
    return JSON.stringify(obj, null, indent);
  }

  /**
   * Display conversation search results
   */
  displaySearchResults(results, query) {
    if (!results || results.length === 0) {
      this.print(this.colorize(`No results found for: "${query}"`, 'yellow'));
      return;
    }
    
    this.print(this.colorize(`\n🔍 Search Results for "${query}":`, 'bright'));
    this.print('═'.repeat(50));
    
    results.forEach((result, index) => {
      const timestamp = new Date(result.timestamp).toLocaleString();
      const preview = result.content.length > 100 ? 
        result.content.substring(0, 100) + '...' : 
        result.content;
      
      this.print(`${index + 1}. [${timestamp}] ${this.colorize(result.role, 'cyan')}`);
      this.print(`   ${preview}`);
      if (result.score) {
        this.print(this.colorize(`   Relevance: ${result.score.toFixed(1)}`, 'dim'));
      }
      this.print('');
    });
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

export default ResponseProcessor;