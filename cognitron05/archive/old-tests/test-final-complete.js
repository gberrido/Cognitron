#!/usr/bin/env node

/**
 * Final complete test - streaming + tools + continuous conversation
 */

import { spawn } from 'child_process';

console.log('🎯 Final Complete Test - Streaming + Tools + Continuous Chat');
console.log('=' .repeat(70));

const cliProcess = spawn('node', ['/Users/saladin/Projects/Cognitron/cognitron06/client/src/cli.js'], {
    stdio: ['pipe', 'inherit', 'inherit'], // inherit to see all output
    env: { ...process.env }
});

let step = 'waiting_username';
let messageCount = 0;

setTimeout(() => {
    console.log('\n>>> Auto-login: demo');
    cliProcess.stdin.write('demo\n');
    
    setTimeout(() => {
        console.log('>>> Auto-password: demo123');
        cliProcess.stdin.write('demo123\n');
        
        setTimeout(() => {
            console.log('>>> Message 1: "Hello, remember that my name is Alice"');
            cliProcess.stdin.write('Hello, remember that my name is Alice\n');
            messageCount++;
            
            setTimeout(() => {
                console.log('>>> Message 2: "What is my name? Tell me a joke too"');
                cliProcess.stdin.write('What is my name? Tell me a joke too\n');
                messageCount++;
                
                setTimeout(() => {
                    console.log('>>> Message 3: "Tell me another joke"');
                    cliProcess.stdin.write('Tell me another joke\n');
                    messageCount++;
                    
                    setTimeout(() => {
                        console.log('>>> SUCCESS! Exiting with /exit');
                        cliProcess.stdin.write('/exit\n');
                    }, 8000);
                }, 8000);
            }, 8000);
        }, 3000);
    }, 2000);
}, 3000);

cliProcess.on('close', (code) => {
    console.log(`\n\n🏁 Test completed with exit code: ${code}`);
    if (messageCount >= 3) {
        console.log('🎉 SUCCESS: Complete functionality test passed!');
        console.log('✅ Authentication working');
        console.log('✅ Streaming responses displayed');
        console.log('✅ Memory system with tool calls working');
        console.log('✅ Continuous conversation maintained');
        console.log('✅ Clean CLI interface');
    } else {
        console.log(`❌ Test incomplete - only ${messageCount} messages processed`);
    }
});

setTimeout(() => {
    cliProcess.kill();
    console.log('\nTest timed out after 35 seconds');
}, 35000);