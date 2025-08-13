#!/usr/bin/env node

/**
 * Command System Index for Cognitron05
 * Exports all command handlers and provides registration helper
 */

import { CommandRegistry } from './CommandRegistry.js';

// Import all command handlers
import {
  HelpCommandHandler,
  StatusCommandHandler,
  ExitCommandHandler,
  ClearCommandHandler,
  MemoryCommandHandler
} from './handlers/SystemCommands.js';

import {
  SearchCommandHandler,
  RecallCommandHandler,
  ForgetCommandHandler,
  SessionsCommandHandler,
  SaveCommandHandler
} from './handlers/MemoryCommands.js';

import {
  TemperatureCommandHandler,
  ReasoningCommandHandler,
  ResetCommandHandler
} from './handlers/ConfigCommands.js';

/**
 * Create and configure the default command registry
 * @returns {CommandRegistry} Configured command registry
 */
export function createCommandRegistry() {
  const registry = new CommandRegistry();

  // Register System Commands
  registry.register('help', new HelpCommandHandler());
  registry.register('status', new StatusCommandHandler());
  registry.register('exit', new ExitCommandHandler());
  registry.register('clear', new ClearCommandHandler());
  registry.register('memory', new MemoryCommandHandler());

  // Register Memory Commands
  registry.register('search', new SearchCommandHandler());
  registry.register('recall', new RecallCommandHandler());
  registry.register('forget', new ForgetCommandHandler());
  registry.register('sessions', new SessionsCommandHandler());
  registry.register('save', new SaveCommandHandler());

  // Register Configuration Commands
  registry.register('temperature', new TemperatureCommandHandler());
  registry.register('reasoning', new ReasoningCommandHandler());
  registry.register('reset', new ResetCommandHandler());

  return registry;
}

// Export everything
export {
  CommandRegistry,
  
  // System Commands
  HelpCommandHandler,
  StatusCommandHandler,
  ExitCommandHandler,
  ClearCommandHandler,
  MemoryCommandHandler,
  
  // Memory Commands
  SearchCommandHandler,
  RecallCommandHandler,
  ForgetCommandHandler,
  SessionsCommandHandler,
  SaveCommandHandler,
  
  // Configuration Commands
  TemperatureCommandHandler,
  ReasoningCommandHandler,
  ResetCommandHandler
};

export default createCommandRegistry;