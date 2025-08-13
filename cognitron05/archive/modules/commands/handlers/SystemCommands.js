#!/usr/bin/env node

/**
 * System Command Handlers for Cognitron05
 * Handles basic system commands: help, status, exit, clear
 */

import { BaseCommandHandler } from '../BaseCommandHandler.js';

export class HelpCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'help',
      description: 'Show available commands and usage information',
      usage: '/help [category]',
      category: 'System',
      aliases: ['?', 'commands']
    });
  }

  async execute(args, context) {
    const category = args.length > 0 ? args[0] : null;
    
    if (context.commandRegistry) {
      // Use command registry to generate dynamic help
      const helpText = context.commandRegistry.generateHelp(category);
      context.responseProcessor.print('\nCognitron05 Commands:');
      context.responseProcessor.print('════════════════════');
      context.responseProcessor.print(helpText);
      context.responseProcessor.print('');
    } else {
      // Fallback to static help display
      context.responseProcessor.displayHelp();
    }
    
    return true;
  }
}

export class StatusCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'status',
      description: 'Show system status and memory information',
      usage: '/status',
      category: 'System',
      aliases: ['info', 'stat']
    });
  }

  async execute(args, context) {
    await context.displayStatus();
    return true;
  }
}

export class ExitCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'exit',
      description: 'Save state and exit the application',
      usage: '/exit',
      category: 'System',
      aliases: ['quit', 'bye']
    });
  }

  async execute(args, context) {
    await context.saveAndExit();
    return true;
  }
}

export class ClearCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'clear',
      description: 'Clear current session (keeps persistent memory)',
      usage: '/clear',
      category: 'System',
      aliases: ['cls', 'reset-session']
    });
  }

  async execute(args, context) {
    // Clear the FIFO queue but keep working context and archival storage
    if (context.memorySystem) {
      context.memorySystem.fifoQueue = [];
      context.memorySystem.recursiveSummary = '';
      
      // Generate new session ID
      context.memorySystem.currentSessionId = context.memorySystem.generateSessionId();
      
      await context.memorySystem.saveSessionState();
    }

    context.responseProcessor.clearScreen();
    context.responseProcessor.displaySuccess('Session cleared. Persistent memory and working context preserved.');
    
    // Display welcome message for new session
    if (context.memorySystem) {
      const memoryStatus = context.memorySystem.getStatus();
      context.responseProcessor.displayWelcome(memoryStatus);
    }
    
    return true;
  }
}

export class MemoryCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'memory',
      description: 'Display detailed memory system information',
      usage: '/memory',
      category: 'System',
      aliases: ['mem', 'brain']
    });
  }

  async execute(args, context) {
    await context.displayMemoryDetails();
    return true;
  }
}