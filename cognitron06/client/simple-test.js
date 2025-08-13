#!/usr/bin/env node

/**
 * Simple test to check if readline works at all
 */

import readline from 'readline';

console.log('Testing basic readline...');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '> '
});

console.log('Readline interface created');

rl.on('line', (input) => {
  console.log(`You said: ${input}`);
  if (input.trim() === 'exit') {
    rl.close();
  } else {
    rl.prompt();
  }
});

rl.on('close', () => {
  console.log('Goodbye!');
  process.exit(0);
});

console.log('Starting prompt...');
rl.prompt();