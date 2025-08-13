#!/usr/bin/env node

/**
 * Test with debugging to see what's happening with streaming
 */

import { spawn } from 'child_process';

console.log('🔍 Debug Test - Streaming Response Issue');

const cliProcess = spawn('node', ['/Users/saladin/Projects/Cognitron/cognitron06/client/src/cli.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
});

let step = 'initial';

cliProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log('STDOUT:', text);
    
    if (text.includes('> ') && step === 'initial') {
        console.log('\n>>> Sending test message: "hello"');
        cliProcess.stdin.write('hello\n');
        step = 'message_sent';
        
        setTimeout(() => {
            console.log('\n>>> Exiting after 10 seconds');
            cliProcess.stdin.write('/exit\n');
        }, 10000);
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
    cliProcess.kill();
}, 15000);