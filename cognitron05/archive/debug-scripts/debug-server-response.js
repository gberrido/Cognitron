#!/usr/bin/env node

/**
 * Debug Server Response Issue
 * Deep dive into why the API returns wrong format
 */

import axios from 'axios';

async function debugServerResponse() {
  console.log('🔍 Deep Debugging Server Response Issue\n');
  
  try {
    // Authenticate
    const authResponse = await axios.post('http://localhost:8000/api/v1/auth/login', {
      username: 'demo',
      password: 'demo123'
    });
    
    const token = authResponse.data.access_token;
    
    // Get the raw response with all headers
    const response = await axios.get('http://localhost:8000/api/v1/models/available', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    console.log('📋 Response Analysis:');
    console.log('Status:', response.status);
    console.log('Content-Type:', response.headers['content-type']);
    console.log('Server:', response.headers['server'] || 'Unknown');
    
    console.log('\n📊 Raw Response Data:');
    console.log(JSON.stringify(response.data, null, 2));
    
    console.log('\n🔍 Response Structure Analysis:');
    const data = response.data;
    
    console.log('Top-level keys:', Object.keys(data));
    console.log('Has available_models:', 'available_models' in data);
    console.log('Has models:', 'models' in data);
    
    if (data.models) {
      console.log('Models type:', typeof data.models);
      console.log('Models is array:', Array.isArray(data.models));
      console.log('Models keys:', Object.keys(data.models));
      console.log('Models count:', Object.keys(data.models).length);
    }
    
    if (data.available_models) {
      console.log('Available models type:', typeof data.available_models);
      console.log('Available models is array:', Array.isArray(data.available_models));
      console.log('Available models length:', data.available_models.length);
    }
    
    console.log('\n🤔 Problem Analysis:');
    console.log('Expected format: { available_models: [], current_model: "", default_model: "" }');
    console.log('Actual format:   { models: {}, current_model: "", default_model: "" }');
    
    console.log('\n💡 This suggests one of these issues:');
    console.log('1. The server code changes were not applied/deployed');
    console.log('2. There\'s a Pydantic serialization override');  
    console.log('3. The Docker container is using cached/old code');
    console.log('4. There\'s another API endpoint being called');
    
    // Test if this is a FastAPI documentation issue
    console.log('\n📋 Testing FastAPI OpenAPI schema...');
    try {
      const schemaResponse = await axios.get('http://localhost:8000/openapi.json');
      const schema = schemaResponse.data;
      
      if (schema.components && schema.components.schemas && schema.components.schemas.AvailableModelsResponse) {
        console.log('AvailableModelsResponse schema:');
        console.log(JSON.stringify(schema.components.schemas.AvailableModelsResponse, null, 2));
      }
    } catch (e) {
      console.log('Could not fetch OpenAPI schema');
    }
    
  } catch (error) {
    console.error('Debug failed:', error.message);
  }
}

debugServerResponse().catch(console.error);