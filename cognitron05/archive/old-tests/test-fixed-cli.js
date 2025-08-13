#!/usr/bin/env node

/**
 * Test the fixed CLI approach
 */

import { spawn } from 'child_process';

console.log('🔍 Testing Fixed CLI Approach');

const cliProcess = spawn('node', ['/Users/saladin/Projects/Cognitron/cognitron05/fixed-cli-test.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
});

let step = 'waiting_prompt';
let messageCount = 0;

cliProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('STDOUT:', text);
    
    if (text.includes('> ') && step === 'waiting_prompt') {
        setTimeout(() => {
            console.log('\n>>> Sending message 1: hello');
            cliProcess.stdin.write('hello\n');
            step = 'message1_sent';
            messageCount++;
        }, 500);
    } else if (text.includes('> ') && step === 'message1_sent') {
        setTimeout(() => {
            console.log('\n>>> Sending message 2: what is 2+2?');
            cliProcess.stdin.write('what is 2+2?\n');
            step = 'message2_sent';
            messageCount++;
        }, 500);
    } else if (text.includes('> ') && step === 'message2_sent') {
        setTimeout(() => {
            console.log('\n>>> SUCCESS! Sending /exit');
            cliProcess.stdin.write('/exit\n');
        }, 500);
    }
});

cliProcess.stderr.on('data', (data) => {
    const text = data.toString();
    console.log('STDERR:', text);
});

cliProcess.on('close', (code) => {
    console.log(`\nProcess exited with code: ${code}`);
    if (messageCount >= 2) {
        console.log('✅ SUCCESS: CLI processed multiple messages!');
    } else {
        console.log(`❌ FAILED: Only processed ${messageCount} messages`);
    }
});

// Safety timeout
setTimeout(() => {
    console.log('\nSafety timeout - killing process');
    cliProcess.kill();
}, 8000);