#!/usr/bin/env node

/**
 * Test the fixed Cognitron06 CLI
 */

import { spawn } from 'child_process';

console.log('🔍 Testing Fixed Cognitron06 CLI');

const cliProcess = spawn('node', ['/Users/saladin/Projects/Cognitron/cognitron06/client/src/cli.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
    cwd: '/Users/saladin/Projects/Cognitron/cognitron06/client'
});

let step = 'waiting_login';
let messageCount = 0;

cliProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('STDOUT:', text);
    
    // Handle login prompt
    if (text.includes('Username:') && step === 'waiting_login') {
        setTimeout(() => {
            console.log('\n>>> Sending username: admin');
            cliProcess.stdin.write('admin\n');
            step = 'username_sent';
        }, 500);
    } else if (text.includes('Password:') && step === 'username_sent') {
        setTimeout(() => {
            console.log('\n>>> Sending password: admin');
            cliProcess.stdin.write('admin\n');
            step = 'password_sent';
        }, 500);
    } else if (text.includes('> ') && step === 'password_sent') {
        setTimeout(() => {
            console.log('\n>>> Sending message 1: hello');
            cliProcess.stdin.write('hello\n');
            step = 'message1_sent';
            messageCount++;
        }, 1000);
    } else if (text.includes('> ') && step === 'message1_sent') {
        setTimeout(() => {
            console.log('\n>>> Sending message 2: what is 2+2?');
            cliProcess.stdin.write('what is 2+2?\n');
            step = 'message2_sent';
            messageCount++;
        }, 1000);
    } else if (text.includes('> ') && step === 'message2_sent') {
        setTimeout(() => {
            console.log('\n>>> SUCCESS! Sending /exit');
            cliProcess.stdin.write('/exit\n');
        }, 1000);
    }
});

cliProcess.stderr.on('data', (data) => {
    const text = data.toString();
    console.log('STDERR:', text);
});

cliProcess.on('close', (code) => {
    console.log(`\nProcess exited with code: ${code}`);
    if (messageCount >= 2) {
        console.log('✅ SUCCESS: Cognitron06 CLI processed multiple messages!');
    } else {
        console.log(`❌ FAILED: Only processed ${messageCount} messages`);
    }
});

// Safety timeout
setTimeout(() => {
    console.log('\nSafety timeout - killing process');
    cliProcess.kill();
}, 20000);