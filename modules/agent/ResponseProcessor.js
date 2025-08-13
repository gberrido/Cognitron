#!/usr/bin/env node

/**
 * Response Processor - Handles response formatting and streaming
 * Manages output display and user interaction flows
 */

import readline from 'readline';

export class ResponseProcessor {
  constructor(config = {}) {
    this.config = {
      showThinking: config.showThinking !== false,
      showToolCalls: config.showToolCalls !== false,
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
   * Format and display assistant response
   */
  async displayResponse(response, options = {}) {
    const { showToolOutput = this.config.showToolCalls } = options;

    // Show tool output if available and enabled
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
      // If no content but there were tool calls, provide a placeholder
      this.print(this.colorize('Processing tool results...', 'dim'));
    }

    // Show follow-up response if available
    if (response.isFollowUp) {
      this.print(this.colorize('\n[Follow-up response generated after tool execution]', 'dim'));
    }

    // Show usage information if available
    if (response.usage && options.showUsage) {
      const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
      this.print(this.colorize(`\n📊 Token usage: ${prompt_tokens} prompt + ${completion_tokens} completion = ${total_tokens} total`, 'dim'));
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
   * Prompt user for input
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
   * Display a formatted menu
   */
  displayMenu(title, options) {
    this.print(`\n${this.colorize(title, 'bright')}`);
    this.print('═'.repeat(title.length));
    
    options.forEach((option, index) => {
      const number = this.colorize(`${index + 1}.`, 'cyan');
      this.print(`${number} ${option}`);
    });
    
    this.print('');
  }

  /**
   * Clear console screen
   */
  clearScreen() {
    console.clear();
  }

  /**
   * Format object for display
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
   * Display table data
   */
  displayTable(headers, rows) {
    const colWidths = headers.map((header, i) => 
      Math.max(header.length, ...rows.map(row => String(row[i] || '').length))
    );
    
    // Header
    const headerRow = headers.map((header, i) => 
      header.padEnd(colWidths[i])
    ).join(' | ');
    
    this.print(this.colorize(headerRow, 'bright'));
    this.print('─'.repeat(headerRow.length));
    
    // Rows
    rows.forEach(row => {
      const formattedRow = row.map((cell, i) => 
        String(cell || '').padEnd(colWidths[i])
      ).join(' | ');
      
      this.print(formattedRow);
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