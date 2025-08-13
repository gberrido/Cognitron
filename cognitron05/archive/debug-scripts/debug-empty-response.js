#!/usr/bin/env node

/**
 * Debug empty response issue by testing the API directly
 */

import fetch from 'node-fetch';

const SERVER_URL = 'http://localhost:8000';

async function testDirectAPI() {
    console.log('🔍 Testing API directly to debug empty responses');
    
    try {
        // Test with a simple message
        const response = await fetch(`${SERVER_URL}/api/v1/chat/message`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJkZW1vIiwiaWF0IjoxNzMzNTU5NDI3LCJleHAiOjE3MzM2NDU4Mjd9.IiMQyA-sJnHhVkfuANxnJjvqhJJmb5VZ6Hy3qJ2M9dQ'
            },
            body: JSON.stringify({
                message: 'What is 2+2? Please give me a direct answer.'
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        console.log('\n📝 Raw API Response:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n🔍 Analysis:');
        console.log(`Content: "${data.content}"`);
        console.log(`Content length: ${data.content?.length || 0}`);
        console.log(`Tool calls: ${data.tool_calls?.length || 0}`);
        console.log(`Usage: ${JSON.stringify(data.usage)}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

testDirectAPI();