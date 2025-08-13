#!/usr/bin/env node

/**
 * Debug Together AI API connection issues
 */

import Together from 'together-ai';
import chalk from 'chalk';

async function debugTogetherAPI() {
  console.log(chalk.bold.cyan('🔍 Debugging Together AI API Connection'));
  console.log(chalk.gray('═'.repeat(50)));
  
  const apiKey = process.env.TOGETHER_API_KEY;
  
  if (!apiKey?.trim()) {
    console.error(chalk.red('❌ TOGETHER_API_KEY not set'));
    return false;
  }
  
  console.log(chalk.blue(`🔑 API Key: ${apiKey.substring(0, 20)}...`));
  
  try {
    const client = new Together({ apiKey: apiKey.trim() });
    console.log(chalk.green('✅ Together AI client initialized'));
    
    console.log(chalk.blue('\n🧪 Testing basic API call...'));
    
    const response = await client.chat.completions.create({
      messages: [{ role: 'user', content: 'Hello, respond with just "API test successful"' }],
      model: 'openai/gpt-oss-120b',
      max_tokens: 50,
      temperature: 0.7
    });
    
    console.log(chalk.green('✅ API call successful!'));
    console.log(chalk.cyan('Response:'));
    console.log(JSON.stringify(response, null, 2));
    
    if (response.choices && response.choices[0]) {
      console.log(chalk.yellow(`\n💬 Content: ${response.choices[0].message.content}`));
    }
    
    return true;
    
  } catch (error) {
    console.error(chalk.red('❌ API Error:'));
    console.error(chalk.red(`Message: ${error.message}`));
    
    if (error.response) {
      console.error(chalk.red(`Status: ${error.response.status}`));
      console.error(chalk.red(`Data: ${JSON.stringify(error.response.data, null, 2)}`));
    }
    
    if (error.cause) {
      console.error(chalk.red(`Cause: ${error.cause}`));
    }
    
    console.log(chalk.yellow('\n💡 Possible issues:'));
    console.log(chalk.gray('  1. API key format incorrect'));
    console.log(chalk.gray('  2. Model not available on Together AI'));
    console.log(chalk.gray('  3. Credit balance insufficient'));
    console.log(chalk.gray('  4. Network connectivity issue'));
    
    return false;
  }
}

// Run debug
const success = await debugTogetherAPI();
process.exit(success ? 0 : 1);