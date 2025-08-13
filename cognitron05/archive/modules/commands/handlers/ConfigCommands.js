#!/usr/bin/env node

/**
 * Configuration Command Handlers for Cognitron05
 * Handles configuration commands: temperature, reasoning
 */

import { BaseCommandHandler } from '../BaseCommandHandler.js';
import { InputValidator } from '../../utils/InputValidator.js';

export class TemperatureCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'temperature',
      description: 'Set response temperature (0.0-2.0)',
      usage: '/temperature <value>',
      category: 'Configuration',
      aliases: ['temp'],
      validation: {
        minArgs: 1,
        maxArgs: 1,
        requiredArgs: 1
      }
    });
  }

  async execute(args, context) {
    const tempValidation = InputValidator.validateTemperature(args[0]);
    
    if (!tempValidation.valid) {
      this.displayError(context, tempValidation.error, tempValidation.code);
      return true;
    }

    const newTemp = tempValidation.normalized;

    // Update ChatAgent temperature
    if (context.chatAgent) {
      context.config.temperature = newTemp;
      context.chatAgent.updateConfig(context.config);
      
      // Update memory system context if it exists
      if (context.memorySystem) {
        context.memorySystem.updateWorkingContext('user_temperature_preference', newTemp, {
          source: 'user_command',
          description: `User set temperature to ${newTemp}`
        });
      }

      this.displaySuccess(context, `Temperature set to ${newTemp}`);
      
      // Provide context about what this means
      let description = '';
      if (newTemp <= 0.3) {
        description = ' (very focused, deterministic responses)';
      } else if (newTemp <= 0.7) {
        description = ' (balanced creativity and focus)';
      } else if (newTemp <= 1.2) {
        description = ' (creative and varied responses)';
      } else {
        description = ' (highly creative, more unpredictable)';
      }
      
      this.displayInfo(context, `Response style${description}`);
    } else {
      this.displayError(context, 'Chat agent not available');
    }

    return true;
  }
}

export class ReasoningCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'reasoning',
      description: 'Set reasoning level (low/medium/high)',
      usage: '/reasoning <level>',
      category: 'Configuration',
      aliases: ['reason', 'thinking'],
      validation: {
        minArgs: 1,
        maxArgs: 1,
        requiredArgs: 1
      }
    });
  }

  async execute(args, context) {
    const reasoningValidation = InputValidator.validateReasoningLevel(args[0]);
    
    if (!reasoningValidation.valid) {
      this.displayError(context, reasoningValidation.error, reasoningValidation.code);
      return true;
    }

    const newLevel = reasoningValidation.normalized;

    // Update ChatAgent reasoning level
    if (context.chatAgent) {
      context.config.reasoningLevel = newLevel;
      context.chatAgent.updateConfig(context.config);
      
      // Update memory system context if it exists
      if (context.memorySystem) {
        context.memorySystem.updateWorkingContext('user_reasoning_preference', newLevel, {
          source: 'user_command',
          description: `User set reasoning level to ${newLevel}`
        });
      }

      this.displaySuccess(context, `Reasoning level set to ${newLevel}`);
      
      // Provide context about what this means
      let description = '';
      switch (newLevel) {
        case 'low':
          description = ' (quick, direct responses with minimal analysis)';
          break;
        case 'medium':
          description = ' (balanced thinking with moderate analysis)';
          break;
        case 'high':
          description = ' (deep analysis, detailed reasoning, comprehensive responses)';
          break;
      }
      
      this.displayInfo(context, `Reasoning approach${description}`);
    } else {
      this.displayError(context, 'Chat agent not available');
    }

    return true;
  }
}

export class ResetCommandHandler extends BaseCommandHandler {
  constructor() {
    super({
      name: 'reset',
      description: 'Reset all memory (working context, archival, etc.)',
      usage: '/reset [confirm]',
      category: 'Configuration',
      aliases: ['reset-all', 'factory-reset']
    });
  }

  async execute(args, context) {
    // Safety check - require explicit confirmation
    const confirmed = args.length > 0 && (args[0].toLowerCase() === 'confirm' || args[0].toLowerCase() === 'yes');
    
    if (!confirmed) {
      this.displayWarning(context, 'This will permanently delete ALL memory data including:');
      context.responseProcessor.print('  • Working context (persistent facts about you)');
      context.responseProcessor.print('  • Conversation history (all previous messages)');
      context.responseProcessor.print('  • Archival storage (long-term structured data)');
      context.responseProcessor.print('  • Session state and preferences');
      context.responseProcessor.print('');
      this.displayInfo(context, 'To proceed, use: /reset confirm');
      return true;
    }

    if (!context.memorySystem) {
      this.displayError(context, 'Memory system not available');
      return true;
    }

    try {
      // Clear all memory components
      context.memorySystem.workingContext.clear();
      context.memorySystem.fifoQueue = [];
      context.memorySystem.recallStorage = [];
      context.memorySystem.archivalStorage.clear();
      context.memorySystem.recursiveSummary = '';
      
      // Generate new session ID
      context.memorySystem.currentSessionId = context.memorySystem.generateSessionId();
      context.memorySystem.messageIdCounter = 0;

      // Save the reset state
      await context.memorySystem.cleanup();

      this.displaySuccess(context, 'All memory data has been reset');
      this.displayInfo(context, `New session started: ${context.memorySystem.currentSessionId}`);
      
      // Clear screen and show welcome
      context.responseProcessor.clearScreen();
      const memoryStatus = context.memorySystem.getStatus();
      context.responseProcessor.displayWelcome(memoryStatus);

    } catch (error) {
      this.displayError(context, `Failed to reset memory: ${error.message}`);
    }

    return true;
  }
}