#!/usr/bin/env node

/**
 * Test WebSocket streaming directly
 */

import WebSocket from 'ws';

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vIiwic2Vzc2lvbl9pZCI6IjY1M2IyZTdjLThiM2QtNDkzMC05ZTA2LTkyM2Q5YjI0YmNmYyIsImV4cCI6MTc1NDUzODU3MX0.APawym5S4jQ4-EWQr-Xa5puFRKkAhBf6ZECp-8H1oUg";

console.log('🔍 Testing WebSocket Streaming Directly...');

const wsUrl = `ws://localhost:8000/api/v1/ws/chat?token=${encodeURIComponent(token)}`;
const ws = new WebSocket(wsUrl);

let fullResponse = '';

ws.on('open', () => {
    console.log('✅ WebSocket connected');
    
    // Send a chat message
    ws.send(JSON.stringify({
        type: 'chat',
        message: 'Hello! Please tell me a funny joke.',
        stream: true
    }));
});

ws.on('message', (data) => {
    try {
        const response = JSON.parse(data.toString());
        console.log(`📨 Received: ${response.type}`);
        
        switch (response.type) {
            case 'system':
                console.log(`   System: ${response.message}`);
                break;
                
            case 'stream_start':
                console.log('   🚀 Stream started');
                break;
                
            case 'stream_chunk':
                const content = response.content;
                console.log(`   📝 Chunk: "${content}"`);
                fullResponse += content;
                process.stdout.write(content);
                break;
                
            case 'stream_end':
                console.log('\n   ✅ Stream ended');
                console.log(`   Full response length: ${fullResponse.length}`);
                ws.close();
                break;
                
            case 'tool_call':
                console.log(`   🔧 Tool call: ${JSON.stringify(response.tool_call)}`);
                break;
                
            case 'error':
            case 'stream_error':
                console.log(`   ❌ Error: ${response.message}`);
                ws.close();
                break;
                
            default:
                console.log(`   ❓ Unknown: ${JSON.stringify(response)}`);
        }
    } catch (error) {
        console.error('Parse error:', error.message);
    }
});

ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error.message);
});

ws.on('close', (code, reason) => {
    console.log(`Connection closed: ${code} ${reason}`);
    console.log(`\n📊 Final Results:`);
    console.log(`   Full response: "${fullResponse}"`);
    console.log(`   Response length: ${fullResponse.length} characters`);
    
    if (fullResponse.length > 0) {
        console.log('   ✅ SUCCESS: WebSocket streaming is working!');
    } else {
        console.log('   ❌ FAILED: No content received via streaming');
    }
});

// Timeout after 15 seconds
setTimeout(() => {
    console.log('Timeout - closing WebSocket');
    ws.close();
}, 15000);