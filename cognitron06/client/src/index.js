#!/usr/bin/env node

/**
 * Cognitron SDK - Main entry point
 * Exports both SDK and CLI for flexible usage
 */

// Core SDK exports
export { CognitronSDK } from './core/CognitronSDK.js';
export { AuthModule } from './core/auth/AuthModule.js';
export { ChatModule } from './core/chat/ChatModule.js';
export { MemoryModule } from './core/memory/MemoryModule.js';
export { ModelsModule } from './core/models/ModelsModule.js';
export { ConfigModule } from './core/config/ConfigModule.js';

// CLI exports
export { CognitronCLI } from './cli/CognitronCLI.js';
export { UIRenderer } from './cli/ui/UIRenderer.js';

// Default export is the main SDK
export { CognitronSDK as default } from './core/CognitronSDK.js';