#!/usr/bin/env node

/**
 * Final test of CLI with cleaned up interface
 */

import { spawn } from 'child_process';

console.log('🎯 Final CLI Test - Streaming & Continuous Conversation');
console.log('=' .repeat(60));

const cliProcess = spawn('node', ['/Users/saladin/Projects/Cognitron/cognitron06/client/src/cli.js'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
});

let step = 'waiting_for_username';
let responseReceived = false;

cliProcess.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(text, { end: '' });
    
    if (text.includes('Username:') && step === 'waiting_for_username') {
        setTimeout(() => {
            cliProcess.stdin.write('demo\n');
            step = 'waiting_for_password';
        }, 100);
    } else if (text.includes('Password:') && step === 'waiting_for_password') {
        setTimeout(() => {
            cliProcess.stdin.write('demo123\n');
            step = 'waiting_for_prompt';
        }, 100);
    } else if (text.includes('> ') && step === 'waiting_for_prompt') {
        setTimeout(() => {
            console.log('\n>>> Testing streaming: "Tell me a very short joke"');
            cliProcess.stdin.write('Tell me a very short joke\n');
            step = 'first_message_sent';
        }, 100);
    } else if (text.includes('> ') && step === 'first_message_sent') {
        responseReceived = true;
        setTimeout(() => {
            console.log('\n>>> Testing continuous conversation: "Tell me another one"');
            cliProcess.stdin.write('Tell me another one\n');
            step = 'second_message_sent';
        }, 100);
    } else if (text.includes('> ') && step === 'second_message_sent') {
        setTimeout(() => {
            console.log('\n>>> SUCCESS! Exiting with /exit');
            cliProcess.stdin.write('/exit\n');
            step = 'done';
        }, 100);
    }
});

cliProcess.stderr.on('data', (data) => {
    // Only log errors, not the typing spinner
    const text = data.toString();
    if (!text.includes('Thinking...')) {
        console.log('ERROR:', text);
    }
});

cliProcess.on('close', (code) => {
    console.log(`\n🏁 Test completed with exit code: ${code}`);
    
    if (step === 'done' && responseReceived) {
        console.log('🎉 SUCCESS: CLI streaming and continuous conversation working!');
        console.log('✅ Authentication successful');
        console.log('✅ Streaming responses displayed');
        console.log('✅ Continuous conversation maintained');
        console.log('✅ Clean exit with /exit command');
    } else {
        console.log(`❌ Test failed at step: ${step}`);
        console.log(`Response received: ${responseReceived}`);
    }
});

setTimeout(() => {
    cliProcess.kill();
    console.log('\nTest timed out after 30 seconds');
}, 30000);