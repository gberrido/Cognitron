#!/usr/bin/env node

/**
 * UI Renderer for Cognitron CLI
 * Handles terminal output formatting and display
 */

import chalk from 'chalk';
import { marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import ora from 'ora';

// Configure marked for terminal output
marked.setOptions({
  renderer: new TerminalRenderer()
});

export class UIRenderer {
  constructor() {
    this.colors = {
      primary: chalk.cyan,
      success: chalk.green,
      warning: chalk.yellow,
      error: chalk.red,
      info: chalk.blue,
      dim: chalk.gray,
      bright: chalk.white.bold
    };
  }

  print(text) {
    console.log(text);
  }

  displayWelcome() {
    console.clear();
    this.print(chalk.cyan.bold(`
╔══════════════════════════════════════════════════════════════╗
║                     🧠 Cognitron SDK CLI                     ║
║              AI Assistant with MemGPT Memory                ║
╚══════════════════════════════════════════════════════════════╝
`));
    this.print(chalk.dim('SDK-Powered • Client-Server Architecture • Persistent Memory'));
    this.print(chalk.dim('Type /help for available commands or just start chatting!'));
    this.print('');
  }

  displaySuccess(message) {
    this.print(this.colors.success(`✅ ${message}`));
  }

  displayError(message) {
    this.print(this.colors.error(`❌ ${message}`));
  }

  displayWarning(message) {
    this.print(this.colors.warning(`⚠️  ${message}`));
  }

  displayInfo(message) {
    this.print(this.colors.info(`ℹ️  ${message}`));
  }

  displayResponse(content) {
    try {
      // Try to render as markdown
      const rendered = marked(content);
      this.print(rendered);
    } catch (error) {
      // Fall back to plain text
      this.print(this.colors.primary(content));
    }
  }

  displayToolCall(toolCall) {
    const name = toolCall.function?.name || toolCall.name || 'Unknown';
    this.print(this.colors.dim(`🔧 Tool: ${name}`));
    if (toolCall.result && toolCall.result.message) {
      this.print(this.colors.dim(`   ${toolCall.result.message}`));
    }
  }

  displayThinking(thinking) {
    this.print(this.colors.dim(`💭 Thinking: ${thinking}`));
  }

  displayMemoryStatus(status) {
    this.print(this.colors.bright('\n🧠 Memory Status:'));
    this.print('─'.repeat(20));
    
    if (status.session_id) {
      this.print(`Session: ${this.colors.primary(status.session_id)}`);
    }
    
    this.print(`Working Context: ${this.colors.info(status.working_context_size || 0)} entries`);
    this.print(`Conversation Queue: ${this.colors.info(status.fifo_queue_size || status.fifo_queue_length || 0)} messages`);
    this.print(`Total Messages: ${this.colors.info(status.total_messages || status.recall_storage_size || 0)}`);
    this.print(`Archival Storage: ${this.colors.info(status.archival_storage_size || 0)} entries`);
    
    const memoryUsage = status.memory_usage || (status.memory_pressure ? Math.round(status.memory_pressure * 100) : 0);
    this.print(`Memory Usage: ${this.colors.warning(memoryUsage)}%`);
    
    if (memoryUsage > 80) {
      this.print(this.colors.warning('⚠️  High memory usage - older conversations may be archived'));
    }
  }

  displayMemoryPressureWarning(pressure) {
    this.print(this.colors.warning(`\n⚠️  Memory Pressure Warning:`));
    this.print(this.colors.warning(`   ${pressure.message}`));
    this.print(this.colors.warning(`   Usage: ${pressure.usage}% (${pressure.estimated_tokens}/${pressure.context_window} tokens)`));
  }

  displaySearchResults(results) {
    if (!results || results.total_count === 0) {
      this.print(this.colors.warning(`No results found${results?.query ? ` for "${results.query}"` : ''}`));
      return;
    }

    this.print(this.colors.bright(`\n🔍 Search Results${results.query ? ` for "${results.query}"` : ''}:`));
    this.print('═'.repeat(50));
    
    if (results.results && Array.isArray(results.results)) {
      results.results.forEach((result, index) => {
        this.print(`${this.colors.primary(index + 1)}. ${this.colors.bright(result.role || 'Message')}`);
        
        const content = result.content || result.message || 'No content';
        const preview = content.length > 150 ? content.substring(0, 150) + '...' : content;
        this.print(`   ${preview}`);
        
        const timestamp = result.timestamp || result.created_at || 'Unknown time';
        const relevance = result.relevance_score || result.relevance || 0;
        this.print(this.colors.dim(`   ${timestamp} • Relevance: ${relevance.toFixed(2)}`));
        this.print('');
      });
    }
    
    this.print(this.colors.info(`Found ${results.total_count} results`));
  }

  displayWorkingContext(context) {
    if (!context || context.length === 0) {
      this.print(this.colors.warning('\n💾 Working context is empty'));
      return;
    }

    this.print(this.colors.bright('\n💾 Working Context:'));
    this.print('═'.repeat(30));
    
    context.forEach((entry) => {
      this.print(`${this.colors.primary(entry.key || entry.name)}: ${entry.value || entry.data || 'No value'}`);
      
      const lastUpdated = entry.last_updated || entry.updated_at || entry.timestamp;
      const updateCount = entry.update_count || entry.access_count || 0;
      
      if (lastUpdated || updateCount) {
        const timeStr = lastUpdated ? new Date(lastUpdated).toLocaleString() : 'Unknown';
        const countStr = updateCount ? ` (${updateCount} times)` : '';
        this.print(this.colors.dim(`   Updated: ${timeStr}${countStr}`));
      }
      this.print('');
    });
  }

  displaySessions(sessions) {
    if (!sessions || sessions.total_sessions === 0 || (sessions.sessions && sessions.sessions.length === 0)) {
      this.print(this.colors.warning('\n📚 No previous sessions found'));
      return;
    }

    const totalSessions = sessions.total_sessions || sessions.sessions?.length || 0;
    this.print(this.colors.bright(`\n📚 Previous Sessions (${totalSessions}):`));
    this.print('═'.repeat(40));
    
    const sessionsList = sessions.sessions || [];
    sessionsList.forEach((session, index) => {
      const isCurrent = session.session_id === sessions.current_session;
      const marker = isCurrent ? this.colors.success('→ ') : '  ';
      const suffix = isCurrent ? this.colors.success(' (current)') : '';
      
      this.print(`${marker}${index + 1}. ${session.session_id}${suffix}`);
      
      if (session.start_time || session.created_at) {
        const startTime = session.start_time || session.created_at;
        this.print(`     Started: ${new Date(startTime).toLocaleString()}`);
      }
      
      if (session.message_count !== undefined) {
        this.print(`     Messages: ${session.message_count}`);
      }
      
      this.print('');
    });
  }

  displayUsage(usage) {
    if (!usage) return;
    
    const total = usage.total_tokens || 0;
    const prompt = usage.prompt_tokens || 0;
    const completion = usage.completion_tokens || 0;
    
    this.print(this.colors.dim(`\n📊 Token Usage: ${total} total (${prompt} prompt + ${completion} completion)`));
  }

  displayHelp() {
    this.print(this.colors.bright('\n📖 Cognitron SDK CLI Commands:'));
    this.print('═'.repeat(50));
    
    this.print(this.colors.bright('\n💬 Chat Commands:'));
    this.print(`${this.colors.primary('/help')}           - Show this help message`);
    this.print(`${this.colors.primary('/status')}         - Show system and SDK status`);
    this.print(`${this.colors.primary('/clear')}          - Clear the screen`);
    this.print(`${this.colors.primary('/history')}        - Show command history`);
    this.print(`${this.colors.primary('/exit')} or ${this.colors.primary('/quit')} - Exit the application`);
    
    this.print(this.colors.bright('\n🧠 Memory Commands:'));
    this.print(`${this.colors.primary('/memory')}         - Show detailed memory information`);
    this.print(`${this.colors.primary('/search <query>')} - Search conversation history`);
    this.print(`${this.colors.primary('/context')}        - Show working context (core memories)`);
    this.print(`${this.colors.primary('/sessions')}       - List all conversation sessions`);
    this.print(`${this.colors.primary('/export [format]')} - Export memory data`);
    
    this.print(this.colors.bright('\n🤖 Model Commands:'));
    this.print(`${this.colors.primary('/models')}         - Show all available models`);
    this.print(`${this.colors.primary('/model')}          - Show current model info`);
    this.print(`${this.colors.primary('/model <name>')}   - Switch to a different model`);
    
    this.print(this.colors.bright('\n⚙️  System Commands:'));
    this.print(`${this.colors.primary('/verbose [on|off]')} - Toggle reasoning/tool visibility`);
    this.print(`${this.colors.primary('/logout')}         - Logout and exit`);
    
    this.print('\n' + this.colors.dim('Navigation:'));
    this.print(this.colors.dim('  ↑/↓ Arrow Keys   Navigate command history'));
    this.print(this.colors.dim('  Ctrl+C           Show exit options'));
    
    this.print('\n' + this.colors.dim('Just type a message to start chatting with the AI assistant!'));
    this.print(this.colors.dim('The AI has persistent memory and can remember across sessions.'));
  }

  showCommands() {
    console.log(chalk.cyan('💬 Commands:'));
    console.log(chalk.gray('  /help     - Show help'));
    console.log(chalk.gray('  /memory   - Memory status')); 
    console.log(chalk.gray('  /search   - Search conversations'));
    console.log(chalk.gray('  /models   - Available models'));
    console.log(chalk.gray('  /status   - System status'));
    console.log(chalk.gray('  /verbose  - Toggle agent thoughts'));
    console.log(chalk.gray('  /exit     - Exit chat'));
  }

  showTyping() {
    return ora({
      text: 'AI is thinking...',
      spinner: 'dots',
      color: 'cyan'
    }).start();
  }

  showProcessing() {
    return ora({
      text: 'Processing...',
      spinner: 'dots2',
      color: 'blue'
    }).start();
  }

  showConnecting() {
    return ora({
      text: 'Connecting to server...',
      spinner: 'dots3',
      color: 'yellow'
    }).start();
  }

  colorize(text, color) {
    return this.colors[color] ? this.colors[color](text) : text;
  }

  // Utility methods for progress indication
  
  showProgress(message, steps) {
    let current = 0;
    const spinner = ora(message).start();
    
    return {
      step: (stepMessage) => {
        current++;
        spinner.text = `${message} (${current}/${steps}) ${stepMessage}`;
      },
      complete: (completeMessage) => {
        spinner.succeed(completeMessage || `${message} completed`);
      },
      fail: (errorMessage) => {
        spinner.fail(errorMessage || `${message} failed`);
      }
    };
  }

  // Table formatting helper
  
  displayTable(headers, rows, options = {}) {
    if (!headers || !rows || rows.length === 0) {
      this.print(this.colors.warning('No data to display'));
      return;
    }

    const { maxWidth = 80, align = 'left' } = options;
    
    // Calculate column widths
    const colWidths = headers.map((header, i) => {
      const headerWidth = header.length;
      const maxRowWidth = Math.max(...rows.map(row => String(row[i] || '').length));
      return Math.max(headerWidth, maxRowWidth);
    });
    
    // Print header
    const headerRow = headers.map((header, i) => 
      header.padEnd(colWidths[i])
    ).join(' │ ');
    
    this.print(this.colors.bright(headerRow));
    this.print('─'.repeat(headerRow.length));
    
    // Print rows
    rows.forEach(row => {
      const rowStr = row.map((cell, i) => 
        String(cell || '').padEnd(colWidths[i])
      ).join(' │ ');
      this.print(rowStr);
    });
  }
}