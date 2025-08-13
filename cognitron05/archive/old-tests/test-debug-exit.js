#!/usr/bin/env node

/**
 * Debug the exit issue
 */

import { spawn } from 'child_process';

console.log('🔍 Debugging CLI Exit Issue');

const cliProcess = spawn('node', ['/Users/saladin/Projects/Cognitron/cognitron06/client/src/cli.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
});

let step = 'waiting_prompt';

cliProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('STDOUT:', text);
    
    if (text.includes('> ') && step === 'waiting_prompt') {
        setTimeout(() => {
            console.log('\n>>> Sending: hello');
            cliProcess.stdin.write('hello\n');
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

setTimeout(() => {
    console.log('Timeout - killing process');
    cliProcess.kill();
}, 15000);