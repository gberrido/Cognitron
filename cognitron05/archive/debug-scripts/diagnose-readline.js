#!/usr/bin/env node

/**
 * Comprehensive diagnosis of readline issues
 */

import readline from 'readline';
import process from 'process';

console.log('🔍 Node.js Readline Diagnosis');
console.log('Node.js version:', process.version);
console.log('Platform:', process.platform);
console.log('TTY stdin:', process.stdin.isTTY);
console.log('TTY stdout:', process.stdout.isTTY);
console.log('');

// Test 1: Basic readline
console.log('Test 1: Basic readline interface...');
const rl1 = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let test1Closed = false;
rl1.on('close', () => {
  console.log('Test 1: Readline closed immediately');
  test1Closed = true;
});

setTimeout(() => {
  if (!test1Closed) {
    console.log('Test 1: SUCCESS - readline stayed open');
    rl1.close();
  }
  runTest2();
}, 1000);

function runTest2() {
  console.log('\nTest 2: Process stdin events...');
  
  const originalListeners = process.stdin.listeners('data');
  console.log('Existing stdin data listeners:', originalListeners.length);
  
  let dataReceived = false;
  process.stdin.on('data', (chunk) => {
    console.log('Test 2: Data received:', chunk.toString().trim());
    dataReceived = true;
  });
  
  process.stdin.on('end', () => {
    console.log('Test 2: stdin ended');
  });
  
  process.stdin.on('close', () => {
    console.log('Test 2: stdin closed');
  });
  
  setTimeout(() => {
    if (!dataReceived) {
      console.log('Test 2: No data received in 2 seconds');
    }
    runTest3();
  }, 2000);
}

function runTest3() {
  console.log('\nTest 3: Different readline options...');
  
  const rl3 = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });
  
  let test3Closed = false;
  rl3.on('close', () => {
    console.log('Test 3: Non-terminal readline closed');
    test3Closed = true;
  });
  
  setTimeout(() => {
    if (!test3Closed) {
      console.log('Test 3: Non-terminal readline stayed open');
      rl3.close();
    }
    
    console.log('\n🏁 Diagnosis complete');
    process.exit(0);
  }, 1000);
}