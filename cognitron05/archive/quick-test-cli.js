#!/usr/bin/env node

/**
 * Quick test of simple CLI focusing on the response issue
 */

import { spawn } from 'child_process';

console.log('🔍 Quick Test - Simple CLI Response Issue');

const cliProcess = spawn('node', ['/Users/saladin/Projects/Cognitron/cognitron06/client/simple-cli.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
    cwd: '/Users/saladin/Projects/Cognitron/cognitron06/client'
});

let step = 'waiting_prompt';

cliProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('STDOUT:', text);
    
    if (text.includes('> ') && step === 'waiting_prompt') {
        setTimeout(() => {
            console.log('\n>>> Sending test message: What is 2+2?');
            cliProcess.stdin.write('What is 2+2?\n');
            step = 'message_sent';
        }, 1000);
    }
});

cliProcess.stderr.on('data', (data) => {
    const text = data.toString();
    console.log('STDERR:', text);
});

cliProcess.on('close', (code) => {
    console.log(`\nProcess exited with code: ${code}`);
});

// Kill after 10 seconds
setTimeout(() => {
    console.log('\nTest timeout - killing process');
    cliProcess.kill();
}, 10000);