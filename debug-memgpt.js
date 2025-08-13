#!/usr/bin/env node

/**
 * Debug script for MemGPT - test API connectivity
 */

import { Groq } from 'groq-sdk';
import Together from 'together-ai';

// Set API keys
process.env.TOGETHER_API_KEY = "YOUR_TOGETHER_API_KEY_HERE";
process.env.GROQ_API_KEY = "YOUR_GROQ_API_KEY_HERE";

async function testGroqAPI() {
  console.log('🧪 Testing Groq API...');
  
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    
    console.log('Sending test message to Groq...');
    const response = await groq.chat.completions.create({
      messages: [{ role: 'user', content: 'Say hello and introduce yourself briefly.' }],
      model: 'llama3-8b-8192', // Using a current Groq model
      temperature: 0.7,
      max_tokens: 100
    });
    
    console.log('✅ Groq API Response:');
    console.log(response.choices[0].message);
    
    // Try with GPT-OSS-120B
    console.log('\nTesting with GPT-OSS-120B model...');
    const response2 = await groq.chat.completions.create({
      messages: [{ role: 'user', content: 'Hello, what model are you?' }],
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_tokens: 100
    });
    
    console.log('✅ GPT-OSS-120B Response:');
    console.log(response2.choices[0].message);
    
  } catch (error) {
    console.error('❌ Groq API Error:', error.message);
    console.log('Error details:', error);
  }
}

async function testTogetherAPI() {
  console.log('\n🧪 Testing Together AI API...');
  
  try {
    const together = new Together({ apiKey: process.env.TOGETHER_API_KEY });
    
    console.log('Sending test message to Together AI...');
    const response = await together.chat.completions.create({
      messages: [{ role: 'user', content: 'Say hello and introduce yourself briefly.' }],
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      max_tokens: 100
    });
    
    console.log('✅ Together AI Response:');
    console.log(response.choices[0].message);
    
  } catch (error) {
    console.error('❌ Together AI Error:', error.message);
    console.log('Error details:', error);
  }
}

async function main() {
  console.log('🚀 Starting API Debug Tests...\n');
  
  await testGroqAPI();
  await testTogetherAPI();
  
  console.log('\n🏁 Debug tests completed');
}

main().catch(console.error);