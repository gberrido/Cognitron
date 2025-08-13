#!/usr/bin/env node

/**
 * Fixed CLI that works without TTY
 */

import readline from 'readline';
import process from 'process';

console.log('🧠 Fixed CLI Test');
console.log('');

class FixedCLI {
  constructor() {
    this.isRunning = false;
    this.rl = null;
  }

  start() {
    // Force terminal mode for readline
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true  // Force terminal mode
    });

    this.rl = rl;
    this.isRunning = true;

    console.log('Starting conversation loop...');
    this.rl.prompt();

    this.rl.on('line', (input) => {
      const message = input.trim();
      
      if (!message) {
        this.rl.prompt();
        return;
      }

      if (message === '/exit') {
        console.log('👋 Goodbye!');
        this.rl.close();
        process.exit(0);
        return;
      }

      // Simulate processing
      console.log(`🤖 You said: ${message}`);
      console.log('🧠 Processing complete!');
      console.log('');

      // Always prompt for next input
      this.rl.prompt();
    });

    this.rl.on('close', () => {
      console.log('Readline closed');
      this.isRunning = false;
      process.exit(0);
    });

    this.rl.on('SIGINT', () => {
      console.log('\nReceived SIGINT');
      this.rl.close();
    });

    // Set the prompt
    this.rl.setPrompt('> ');
  }
}

const cli = new FixedCLI();
cli.start();