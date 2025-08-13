#!/usr/bin/env node

/**
 * LLM Configuration Manager
 * Manages provider selection and configuration
 */

import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { LLMProviderFactory } from './LLMProviderFactory.js';

class LLMConfigManager {
  constructor(configDir = './cognitron-memgpt-data') {
    this.configDir = configDir;
    this.configFile = path.join(configDir, 'llm-config.json');
    this.defaultConfig = {
      provider: 'groq',
      fallbackProvider: 'together',
      model: 'openai/gpt-oss-120b',
      temperature: 0.7,
      maxTokens: 2000,
      autoFallback: true,
      rateLimitRetries: 3
    };
  }

  async ensureConfigDir() {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
    } catch (error) {
      // Directory exists
    }
  }

  async loadConfig() {
    try {
      await this.ensureConfigDir();
      const configData = await fs.readFile(this.configFile, 'utf8');
      const config = JSON.parse(configData);
      return { ...this.defaultConfig, ...config };
    } catch (error) {
      // Config file doesn't exist, return defaults
      return { ...this.defaultConfig };
    }
  }

  async saveConfig(config) {
    await this.ensureConfigDir();
    const mergedConfig = { ...this.defaultConfig, ...config };
    await fs.writeFile(this.configFile, JSON.stringify(mergedConfig, null, 2));
    console.log(chalk.green(`✅ LLM configuration saved to ${this.configFile}`));
  }

  async setProvider(providerName, options = {}) {
    const config = await this.loadConfig();
    config.provider = providerName.toLowerCase();
    
    if (options.fallback) {
      config.fallbackProvider = options.fallback.toLowerCase();
    }
    
    if (options.model) {
      config.model = options.model;
    }
    
    if (options.autoFallback !== undefined) {
      config.autoFallback = options.autoFallback;
    }

    await this.saveConfig(config);
    
    console.log(chalk.cyan(`🔄 Primary LLM provider set to: ${providerName}`));
    if (config.fallbackProvider && config.autoFallback) {
      console.log(chalk.gray(`📦 Fallback provider: ${config.fallbackProvider}`));
    }
  }

  async getCurrentProvider() {
    const config = await this.loadConfig();
    return config.provider;
  }

  async createProvider(providerOverride = null) {
    const config = await this.loadConfig();
    const providerName = providerOverride || config.provider;
    
    try {
      const provider = await LLMProviderFactory.createAndInitializeProvider(providerName, {
        model: config.model,
        temperature: config.temperature,
        max_tokens: config.maxTokens
      });
      
      return { provider, config };
    } catch (error) {
      console.error(chalk.red(`❌ Failed to initialize ${providerName}: ${error.message}`));
      
      // Try fallback provider if auto-fallback is enabled
      if (config.autoFallback && config.fallbackProvider && config.fallbackProvider !== providerName) {
        console.log(chalk.yellow(`🔄 Trying fallback provider: ${config.fallbackProvider}`));
        
        try {
          const fallbackProvider = await LLMProviderFactory.createAndInitializeProvider(config.fallbackProvider, {
            model: config.model,
            temperature: config.temperature,
            max_tokens: config.maxTokens
          });
          
          return { provider: fallbackProvider, config, usingFallback: true };
        } catch (fallbackError) {
          console.error(chalk.red(`❌ Fallback provider also failed: ${fallbackError.message}`));
          throw fallbackError;
        }
      } else {
        throw error;
      }
    }
  }

  async showProviderStatus() {
    const config = await this.loadConfig();
    
    console.log(chalk.bold.cyan('\n🔧 LLM Provider Configuration'));
    console.log(chalk.gray('═'.repeat(40)));
    console.log(chalk.white(`Current Provider: ${chalk.green(config.provider)}`));
    console.log(chalk.white(`Model: ${config.model}`));
    console.log(chalk.white(`Temperature: ${config.temperature}`));
    console.log(chalk.white(`Max Tokens: ${config.maxTokens}`));
    
    if (config.autoFallback && config.fallbackProvider) {
      console.log(chalk.white(`Fallback Provider: ${chalk.yellow(config.fallbackProvider)}`));
      console.log(chalk.white(`Auto-fallback: ${chalk.green('Enabled')}`));
    } else {
      console.log(chalk.white(`Auto-fallback: ${chalk.red('Disabled')}`));
    }
    
    console.log(chalk.gray('\n💡 Available providers:'));
    const providers = LLMProviderFactory.listAvailableProviders();
    providers.forEach(p => {
      const indicator = p.name === config.provider ? chalk.green('✅') : chalk.gray('  ');
      console.log(`${indicator} ${p.name}`);
    });
    
    const recommendations = LLMProviderFactory.getProviderRecommendation();
    console.log(chalk.gray('\n🎯 Recommendations:'));
    console.log(chalk.gray(`  Free tier: ${recommendations.free}`));
    console.log(chalk.gray(`  Cheapest: ${recommendations.cheapest}`));
    console.log(chalk.gray(`  Fastest: ${recommendations.fastest}`));
    console.log(chalk.gray(`  Overall: ${recommendations.recommended}`));
  }

  async testProvider(providerName = null) {
    console.log(chalk.blue('🧪 Testing LLM provider...'));
    
    try {
      const { provider, config, usingFallback } = await this.createProvider(providerName);
      
      if (usingFallback) {
        console.log(chalk.yellow(`⚠️ Using fallback provider: ${provider.providerName}`));
      }
      
      // Test with a simple request (no tools for compatibility)
      const testResponse = await provider.createChatCompletion({
        messages: [{ role: 'user', content: 'Hello, this is a test. Please respond with just "Test successful"' }],
        max_tokens: 50
        // Note: Not including tools parameter for basic test
      });
      
      if (testResponse.choices && testResponse.choices[0]) {
        console.log(chalk.green(`✅ ${provider.providerName} test successful!`));
        console.log(chalk.gray(`Response: ${testResponse.choices[0].message.content}`));
        
        const providerInfo = provider.getProviderInfo();
        console.log(chalk.cyan('\n💰 Provider Info:'));
        console.log(chalk.gray(`  Pricing: Input ${providerInfo.pricing.input}, Output ${providerInfo.pricing.output}`));
        console.log(chalk.gray(`  Speed: ${providerInfo.pricing.speed}`));
        
        return true;
      } else {
        console.log(chalk.red('❌ Invalid response from provider'));
        return false;
      }
    } catch (error) {
      console.error(chalk.red(`❌ Provider test failed: ${error.message}`));
      return false;
    }
  }
}

export { LLMConfigManager };