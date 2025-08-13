#!/usr/bin/env node

/**
 * UI rendering and formatting for Cognitron06 CLI
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
║                     🧠 Cognitron06 CLI                       ║
║              AI Assistant with MemGPT Memory                ║
╚══════════════════════════════════════════════════════════════╝
`));
    this.print(chalk.dim('Client-Server Architecture • Persistent Memory • AI Assistant'));
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
    this.print(this.colors.dim(`🔧 Tool: ${toolCall.function_name}`));
    if (toolCall.result && toolCall.result.message) {
      this.print(this.colors.dim(`   ${toolCall.result.message}`));
    }
  }

  displayMemoryStatus(status) {
    this.print(this.colors.bright('\\n🧠 Memory Status:'));
    this.print('─'.repeat(20));
    this.print(`Session: ${this.colors.primary(status.session_id)}`);
    this.print(`Working Context: ${this.colors.info(status.working_context_size)} entries`);
    this.print(`Conversation Queue: ${this.colors.info(status.fifo_queue_length)} messages`);
    this.print(`Total Messages: ${this.colors.info(status.recall_storage_size)}`);
    this.print(`Archival Storage: ${this.colors.info(status.archival_storage_size)} entries`);
    this.print(`Memory Usage: ${this.colors.warning(Math.round(status.memory_pressure * 100))}%`);
  }

  displayMemoryPressureWarning(pressure) {
    this.print(this.colors.warning(`\\n⚠️  Memory Pressure Warning:`));
    this.print(this.colors.warning(`   ${pressure.message}`));
    this.print(this.colors.warning(`   Usage: ${pressure.usage}% (${pressure.estimated_tokens}/${pressure.context_window} tokens)`));
  }

  displaySearchResults(results) {
    if (results.total_count === 0) {
      this.print(this.colors.warning(`No results found for "${results.query}"`));
      return;
    }

    this.print(this.colors.bright(`\\n🔍 Search Results for "${results.query}":`));
    this.print('═'.repeat(50));
    
    results.results.forEach((result, index) => {
      this.print(`${this.colors.primary(index + 1)}. ${this.colors.bright(result.role)}`);
      this.print(`   ${result.content.substring(0, 150)}${result.content.length > 150 ? '...' : ''}`);
      this.print(this.colors.dim(`   ${result.timestamp} • Relevance: ${result.relevance_score.toFixed(2)}`));
      this.print('');
    });
    
    this.print(this.colors.info(`Found ${results.total_count} results`));
  }

  displayWorkingContext(context) {
    if (context.length === 0) {
      this.print(this.colors.warning('Working context is empty'));
      return;
    }

    this.print(this.colors.bright('\\n💾 Working Context:'));
    this.print('═'.repeat(30));
    
    context.forEach((entry) => {
      this.print(`${this.colors.primary(entry.key)}: ${entry.value}`);
      this.print(this.colors.dim(`   Updated: ${new Date(entry.last_updated).toLocaleString()} (${entry.update_count} times)`));
      this.print('');
    });
  }

  displaySessions(sessions) {
    if (sessions.total_sessions === 0) {
      this.print(this.colors.warning('No previous sessions found'));
      return;
    }

    this.print(this.colors.bright(`\\n📚 Previous Sessions (${sessions.total_sessions}):`));
    this.print('═'.repeat(40));
    
    sessions.sessions.forEach((session, index) => {
      const isCurrent = session.session_id === sessions.current_session;
      const marker = isCurrent ? this.colors.success('→ ') : '  ';
      const suffix = isCurrent ? this.colors.success(' (current)') : '';
      
      this.print(`${marker}${index + 1}. ${session.session_id}${suffix}`);
      this.print(`     Started: ${new Date(session.start_time).toLocaleString()}`);
      this.print(`     Messages: ${session.message_count}`);
      this.print('');
    });
  }

  displayUsage(usage) {
    this.print(this.colors.dim(`\\n📊 Token Usage: ${usage.total_tokens} total (${usage.prompt_tokens} prompt + ${usage.completion_tokens} completion)`));
  }

  displayHelp() {
    this.print(this.colors.bright('\\n📖 Available Commands:'));
    this.print('═'.repeat(50));
    
    this.print(this.colors.bright('\\n💬 Chat Commands:'));
    this.print(`${this.colors.primary('/help')}           - Show this help message`);
    this.print(`${this.colors.primary('/status')}         - Show system and memory status`);
    this.print(`${this.colors.primary('/clear')}          - Clear the screen`);
    this.print(`${this.colors.primary('/exit')} or ${this.colors.primary('/quit')} - Exit the application`);
    
    this.print(this.colors.bright('\\n🧠 Memory Commands:'));
    this.print(`${this.colors.primary('/memory')}         - Show detailed memory information`);
    this.print(`${this.colors.primary('/search <query>')} - Search conversation history`);
    this.print(`${this.colors.primary('/context')}        - Show working context (core memories)`);
    this.print(`${this.colors.primary('/sessions')}       - List all conversation sessions`);
    
    this.print(this.colors.bright('\\n🤖 Model Commands:'));
    this.print(`${this.colors.primary('/models')}         - Show all available models`);
    this.print(`${this.colors.primary('/model')}          - Show current model info`);
    this.print(`${this.colors.primary('/model <name>')}   - Switch to a different model`);
    this.print(`${this.colors.primary('/modelinfo <name>')} - Get detailed model information`);
    this.print(`${this.colors.primary('/modelreset')}     - Reset to default model`);
    
    this.print(this.colors.bright('\\n⚙️  System Commands:'));
    this.print(`${this.colors.primary('/config <key> <value>')} - Update configuration`);
    this.print(`${this.colors.primary('/logout')}         - Logout and exit`);
    
    this.print('\\n' + this.colors.dim('Just type a message to start chatting with the AI assistant!'));
    this.print(this.colors.dim('Models: GPT-OSS 120B (reasoning) • Qwen3 32B (efficient) • Kimi K2 (agentic)'));
  }

  showTyping() {
    return ora({
      text: 'Thinking...',
      spinner: 'dots',
      color: 'cyan'
    }).start();
  }

  colorize(text, color) {
    return this.colors[color] ? this.colors[color](text) : text;
  }
}