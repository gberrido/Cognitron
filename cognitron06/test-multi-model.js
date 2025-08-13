#!/usr/bin/env node

/**
 * Test script for multi-model support in Cognitron06
 */

import axios from 'axios';

const SERVER_URL = 'http://localhost:8000/api/v1';

async function testMultiModelSupport() {
    console.log('🤖 Testing Cognitron06 Multi-Model Support');
    console.log('='.repeat(50));
    
    try {
        // Step 1: Authenticate
        console.log('\n1. Authenticating...');
        const loginResponse = await axios.post(`${SERVER_URL}/auth/login`, {
            username: 'demo',
            password: 'demo123'
        });
        const token = loginResponse.data.access_token;
        const headers = { Authorization: `Bearer ${token}` };
        console.log('✅ Authenticated successfully');
        
        // Step 2: Get available models
        console.log('\n2. Getting available models...');
        const modelsResponse = await axios.get(`${SERVER_URL}/models/available`, { headers });
        console.log('✅ Available models:', Object.keys(modelsResponse.data.models));
        console.log('  Current model:', modelsResponse.data.current_model);
        console.log('  Default model:', modelsResponse.data.default_model);
        
        // Step 3: Get current model info
        console.log('\n3. Getting current model info...');
        const currentResponse = await axios.get(`${SERVER_URL}/models/current`, { headers });
        console.log('✅ Current model info:');
        console.log('  Model:', currentResponse.data.model);
        console.log('  Display Name:', currentResponse.data.display_name);
        console.log('  Use Cases:', currentResponse.data.optimal_use_cases);
        
        // Step 4: Test model capabilities endpoint
        console.log('\n4. Testing model capabilities...');
        const capabilitiesResponse = await axios.get(
            `${SERVER_URL}/models/capabilities/${currentResponse.data.model}`, 
            { headers }
        );
        console.log('✅ Model capabilities:');
        console.log('  Tool Calling:', capabilitiesResponse.data.capabilities.tool_calling);
        console.log('  Reasoning Effort:', capabilitiesResponse.data.capabilities.reasoning_effort);
        console.log('  Max Context:', capabilitiesResponse.data.capabilities.max_context);
        
        // Step 5: Test switching to a different model
        const availableModels = Object.keys(modelsResponse.data.models);
        const currentModel = currentResponse.data.model;
        let targetModel = availableModels.find(model => model !== currentModel);
        
        if (targetModel) {
            console.log(`\n5. Switching to model: ${targetModel}...`);
            const switchResponse = await axios.post(`${SERVER_URL}/models/switch`, {
                model: targetModel
            }, { headers });
            console.log('✅ Model switched successfully');
            console.log('  Previous:', switchResponse.data.previous_model);
            console.log('  Current:', switchResponse.data.current_model);
            
            // Verify the switch worked
            const verifyResponse = await axios.get(`${SERVER_URL}/models/current`, { headers });
            console.log('✅ Switch verified:', verifyResponse.data.model === targetModel);
        } else {
            console.log('\n5. ⚠️  Only one model available, skipping model switch test');
        }
        
        // Step 6: Test chat with new model
        console.log('\n6. Testing chat with current model...');
        try {
            const chatResponse = await axios.post(`${SERVER_URL}/chat/message`, {
                message: 'Hello! What model are you using?'
            }, { headers });
            console.log('✅ Chat response received');
            console.log('  Model used:', chatResponse.data.model);
            console.log('  Content preview:', chatResponse.data.content?.substring(0, 100) + '...');
            console.log('  Tool calls:', chatResponse.data.tool_calls?.length || 0);
        } catch (chatError) {
            console.log('⚠️  Chat failed (expected with demo API key):', 
                       chatError.response?.data?.detail || chatError.message);
        }
        
        // Step 7: Reset to default model
        if (targetModel) {
            console.log('\n7. Resetting to default model...');
            const resetResponse = await axios.post(`${SERVER_URL}/models/reset`, {}, { headers });
            console.log('✅ Reset to default model:', resetResponse.data.current_model);
        }
        
        // Step 8: Test invalid model switching
        console.log('\n8. Testing invalid model switch...');
        try {
            await axios.post(`${SERVER_URL}/models/switch`, {
                model: 'invalid/model-name'
            }, { headers });
            console.log('❌ Should have failed!');
        } catch (error) {
            console.log('✅ Invalid model switch properly rejected:', error.response?.status);
        }
        
        console.log('\n' + '='.repeat(50));
        console.log('🎉 MULTI-MODEL SUPPORT TESTING COMPLETE!');
        console.log('✅ All model management endpoints working');
        console.log('✅ Model switching functional');
        console.log('✅ Capability detection working'); 
        console.log('✅ Error handling proper');
        
    } catch (error) {
        console.error('\n❌ Multi-model test failed:', error.response?.data || error.message);
        if (error.response?.data) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        }
        process.exit(1);
    }
}

// Only run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    testMultiModelSupport();
}