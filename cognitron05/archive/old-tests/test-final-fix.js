#!/usr/bin/env node

/**
 * Test the final working CLI
 */

import { spawn } from 'child_process';

console.log('🎯 Testing Fixed CLI');

const cliProcess = spawn('node', ['/Users/saladin/Projects/Cognitron/cognitron06/client/src/cli.js'], {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env }
});

setTimeout(() => {
    console.log('>>> Sending: hello');
    cliProcess.stdin.write('hello\n');
    
    setTimeout(() => {
        console.log('>>> Sending: what is 2+2?');
        cliProcess.stdin.write('what is 2+2?\n');
        
        setTimeout(() => {
            console.log('>>> Sending: tell me a joke');
            cliProcess.stdin.write('tell me a joke\n');
            
            setTimeout(() => {
                console.log('>>> Exiting');
                cliProcess.stdin.write('/exit\n');
            }, 5000);
        }, 5000);
    }, 5000);
}, 3000);

cliProcess.on('close', (code) => {
    console.log(`\nCLI exited with code: ${code}`);
});

setTimeout(() => {
    cliProcess.kill();
}, 25000);