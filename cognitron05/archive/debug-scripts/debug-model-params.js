#!/usr/bin/env node

/**
 * Debug model parameters to understand reasoning_effort issue
 */

import axios from 'axios';

const SERVER_URL = 'http://localhost:8000/api/v1';

async function debugModelParams() {
    console.log('🧪 Debugging Model Parameters');
    console.log('='.repeat(40));
    
    try {
        // Login
        const login = await axios.post(`${SERVER_URL}/auth/login`, {
            username: 'demo',
            password: 'demo123'
        });
        const token = login.data.access_token;
        const headers = { Authorization: `Bearer ${token}` };
        
        // Check current model
        console.log('\n1. Current model info:');
        const current = await axios.get(`${SERVER_URL}/models/current`, { headers });
        console.log('  Current model:', current.data.model);
        console.log('  Display name:', current.data.display_name);
        
        // Check model capabilities
        console.log('\n2. Model capabilities:');
        const modelNameEncoded = current.data.model.replace('/', '%2F');
        const caps = await axios.get(`${SERVER_URL}/models/capabilities/${modelNameEncoded}`, { headers });
        console.log('  Tool calling:', caps.data.capabilities.tool_calling);
        console.log('  Reasoning effort:', caps.data.capabilities.reasoning_effort);
        console.log('  Max context:', caps.data.capabilities.max_context);
        
        // Check default parameters
        console.log('\n3. Default parameters:');
        console.log('  Parameters:', JSON.stringify(caps.data.optimal_params, null, 2));
        
        // Test if we can switch to a model without reasoning_effort
        console.log('\n4. Testing model without reasoning_effort...');
        const switchResult = await axios.post(`${SERVER_URL}/models/switch`, {
            model: 'moonshotai/kimi-k2-instruct'
        }, { headers });
        console.log('  Switched to:', switchResult.data.current_model);
        
        // Now test chat
        console.log('\n5. Testing chat with Kimi (no reasoning_effort)...');
        const chat = await axios.post(`${SERVER_URL}/chat/message`, {
            message: 'Hello! Just say "hi" back please.'
        }, { headers });
        
        console.log('✅ Chat successful with Kimi model!');
        console.log('Response preview:', chat.data.response ? chat.data.response.substring(0, 100) + '...' : chat.data.content.substring(0, 100) + '...');
        
    } catch (error) {
        console.error('❌ Debug test failed:', error.response?.data?.detail || error.message);
        if (error.response?.data) {
            console.error('Full error:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

debugModelParams();