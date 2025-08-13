#!/usr/bin/env node

/**
 * Memory Command Handlers for Cognitron05
 * Handles memory-related commands: search, recall, forget, sessions
 */

import { BaseCommandHandler } from '../BaseCommandHandler.js';
import { InputValidator } from '../../utils/InputValidator.js';

export class SearchCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'search',
      description: 'Search conversation history',
      usage: '/search <query>',
      category: 'Memory',
      aliases: ['find'],
      validation: {
        minArgs: 1,
        maxArgs: Infinity, // Allow multiple words
        requiredArgs: 1
      }
    });
  }

  async execute(args, context) {
    const rawQuery = args.join(' ');
    await context.searchHistory(rawQuery);
    return true;
  }
}

export class RecallCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'recall',
      description: 'Recall information from archival memory',
      usage: '/recall <topic>',
      category: 'Memory',
      aliases: ['remember'],
      validation: {
        minArgs: 1,
        maxArgs: Infinity, // Allow multiple words
        requiredArgs: 1
      }
    });
  }

  async execute(args, context) {
    const rawTopic = args.join(' ');
    await context.recallArchival(rawTopic);
    return true;
  }
}

export class ForgetCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'forget',
      description: 'Remove item from working context memory',
      usage: '/forget <key>',
      category: 'Memory',
      aliases: ['remove', 'delete'],
      validation: {
        minArgs: 1,
        maxArgs: 1,
        requiredArgs: 1
      }
    });
  }

  async execute(args, context) {
    const key = args[0];
    
    if (!context.memorySystem) {
      this.displayError(context, 'Memory system not available');
      return true;
    }

    // Check if key exists in working context
    if (!context.memorySystem.workingContext.has(key)) {
      this.displayWarning(context, `Key '${key}' not found in working context`);
      return true;
    }

    // Remove the key
    const removed = context.memorySystem.workingContext.delete(key);
    
    if (removed) {
      await context.memorySystem.saveWorkingContext();
      this.displaySuccess(context, `Removed '${key}' from working context`);
    } else {
      this.displayError(context, `Failed to remove '${key}' from working context`);
    }

    return true;
  }
}

export class SessionsCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'sessions',
      description: 'List previous conversation sessions',
      usage: '/sessions [limit]',
      category: 'Memory',
      aliases: ['history', 'past']
    });
  }

  async execute(args, context) {
    const limit = args.length > 0 ? parseInt(args[0]) || 10 : 10;
    
    if (!context.memorySystem) {
      this.displayError(context, 'Memory system not available');
      return true;
    }

    try {
      // Get unique session IDs from recall storage
      const sessions = new Map();
      
      context.memorySystem.recallStorage.forEach(message => {
        if (message.sessionId && message.timestamp) {
          if (!sessions.has(message.sessionId)) {
            sessions.set(message.sessionId, {
              sessionId: message.sessionId,
              firstSeen: message.timestamp,
              lastSeen: message.timestamp,
              messageCount: 0
            });
          }
          
          const session = sessions.get(message.sessionId);
          session.messageCount++;
          session.lastSeen = message.timestamp;
        }
      });

      if (sessions.size === 0) {
        this.displayInfo(context, 'No previous sessions found');
        return true;
      }

      // Sort by last activity and limit
      const sortedSessions = Array.from(sessions.values())
        .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
        .slice(0, limit);

      context.responseProcessor.print('\n📅 Previous Sessions:');
      context.responseProcessor.print('═'.repeat(50));

      sortedSessions.forEach((session, index) => {
        const lastActive = new Date(session.lastSeen).toLocaleString();
        const duration = this.calculateDuration(session.firstSeen, session.lastSeen);
        const current = session.sessionId === context.memorySystem.currentSessionId ? ' (current)' : '';
        
        context.responseProcessor.print(`${index + 1}. ${session.sessionId}${current}`);
        context.responseProcessor.print(`   Last active: ${lastActive}`);
        context.responseProcessor.print(`   Messages: ${session.messageCount}, Duration: ${duration}`);
        context.responseProcessor.print('');
      });

    } catch (error) {
      this.displayError(context, `Failed to retrieve sessions: ${error.message}`);
    }

    return true;
  }

  calculateDuration(start, end) {
    const startTime = new Date(start);
    const endTime = new Date(end);
    const diffMs = endTime - startTime;
    
    if (diffMs < 60000) { // Less than 1 minute
      return `${Math.round(diffMs / 1000)}s`;
    } else if (diffMs < 3600000) { // Less than 1 hour
      return `${Math.round(diffMs / 60000)}m`;
    } else {
      return `${Math.round(diffMs / 3600000)}h`;
    }
  }
}

export class SaveCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'save',
      description: 'Manually save memory state to disk',
      usage: '/save',
      category: 'Memory',
      aliases: ['backup']
    });
  }

  async execute(args, context) {
    if (!context.memorySystem) {
      this.displayError(context, 'Memory system not available');
      return true;
    }

    try {
      context.responseProcessor.showMemoryOperation('Saving memory state...');
      await context.memorySystem.cleanup();
      this.displaySuccess(context, 'Memory state saved successfully');
    } catch (error) {
      this.displayError(context, `Failed to save memory state: ${error.message}`);
    }

    return true;
  }
}