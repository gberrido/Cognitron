#!/usr/bin/env node

/**
 * LLM Provider Factory
 * Creates and manages different LLM providers (Groq, Together AI, etc.)
 */

import { Groq } from 'groq-sdk';
import Together from 'together-ai';
import chalk from 'chalk';

class BaseLLMProvider {
  constructor(config) {
    this.config = config;
    this.client = null;
    this.providerName = 'base';
  }

  async initialize() {
    throw new Error('initialize() must be implemented by provider');
  }

  async createChatCompletion(options) {
    throw new Error('createChatCompletion() must be implemented by provider');
  }

  getProviderInfo() {
    return {
      name: this.providerName,
      model: this.config.model,
      pricing: this.config.pricing || 'Unknown'
    };
  }
}

class GroqProvider extends BaseLLMProvider {
  constructor(config) {
    super(config);
    this.providerName = 'Groq';
  }

  async initialize() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error(
        'GROQ_API_KEY environment variable is required.\n' +
        'Set it with: export GROQ_API_KEY="your-api-key-here"'
      );
    }
    
    this.client = new Groq({ apiKey: apiKey.trim() });
    console.log(chalk.green(`✅ Initialized ${this.providerName} provider`));
  }

  async createChatCompletion(options) {
    if (!this.client) {
      throw new Error('Groq client not initialized');
    }

    // Groq uses the standard OpenAI-compatible format
    return await this.client.chat.completions.create({
      messages: options.messages,
      model: options.model || this.config.model,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2000,
      tools: options.tools,
      tool_choice: options.tool_choice || 'auto'
    });
  }

  getProviderInfo() {
    return {
      ...super.getProviderInfo(),
      pricing: {
        input: '$0.15/M tokens',
        output: '$0.75/M tokens',
        speed: '500 tokens/sec',
        rateLimits: 'Free: 30 RPM, 8K TPM'
      }
    };
  }
}

class TogetherAIProvider extends BaseLLMProvider {
  constructor(config) {
    super(config);
    this.providerName = 'Together AI';
  }

  async initialize() {
    const apiKey = process.env.TOGETHER_API_KEY;
    if (!apiKey?.trim()) {
      throw new Error(
        'TOGETHER_API_KEY environment variable is required.\n' +
        'Set it with: export TOGETHER_API_KEY="your-api-key-here"'
      );
    }
    
    this.client = new Together({ 
      apiKey: apiKey.trim(),
      timeout: 60000, // 60 second timeout for large requests
      maxRetries: 2   // Retry failed requests
    });
    console.log(chalk.green(`✅ Initialized ${this.providerName} provider`));
  }

  async createChatCompletion(options) {
    if (!this.client) {
      throw new Error('Together AI client not initialized');
    }

    // Together AI uses OpenAI-compatible format but may have differences
    const requestOptions = {
      messages: options.messages,
      model: options.model || this.config.model,
      temperature: options.temperature || 0.7,
      max_tokens: options.max_tokens || 2000
    };

    // Only add tools if they exist - Together AI might be sensitive to empty tools
    if (options.tools && options.tools.length > 0) {
      requestOptions.tools = options.tools;
      requestOptions.tool_choice = options.tool_choice || 'auto';
    }

    try {
      // Try with shorter timeout first to fail fast on issues
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Request timeout after 30 seconds')), 30000);
      });

      const apiPromise = this.client.chat.completions.create(requestOptions);
      const response = await Promise.race([apiPromise, timeoutPromise]);
      
      // Validate response structure
      if (!response || !response.choices || response.choices.length === 0) {
        throw new Error('Invalid response structure from Together AI');
      }
      
      return response;
    } catch (error) {
      // Enhanced error handling for Together AI specific issues
      if (error.message?.includes('timeout') || error.message?.includes('Request timeout')) {
        throw new Error('Connection timeout - Together AI request took too long. Try reducing context size with /compact or switch to /provider groq.');
      } else if (error.message?.includes('ECONNRESET') || error.message?.includes('ENOTFOUND') || error.message?.includes('Connection error')) {
        throw new Error('Network connection error to Together AI. Try /provider groq or check internet connection.');
      } else if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded on Together AI. Please wait and try again.');
      } else if (error.response?.status === 400) {
        throw new Error('Invalid request to Together AI. This may be due to large context size - try /compact or /provider groq.');
      } else if (error.response?.status >= 500) {
        throw new Error('Together AI server error. Try /provider groq as fallback.');
      } else {
        // Re-throw with original error but suggest fallback
        throw new Error(`Together AI error: ${error.message}. Try /provider groq as fallback.`);
      }
    }
  }

  getProviderInfo() {
    return {
      ...super.getProviderInfo(),
      pricing: {
        input: '$0.16/M tokens',
        output: '$0.60/M tokens',
        speed: 'Fast inference',
        rateLimits: 'More generous than Groq free tier',
        batchDiscount: '50% discount available'
      }
    };
  }
}

class LLMProviderFactory {
  static availableProviders = {
    'groq': GroqProvider,
    'together': TogetherAIProvider
  };

  static createProvider(providerName, config = {}) {
    const Provider = this.availableProviders[providerName.toLowerCase()];
    
    if (!Provider) {
      const available = Object.keys(this.availableProviders).join(', ');
      throw new Error(`Unknown provider: ${providerName}. Available: ${available}`);
    }

    // Default configurations for each provider
    const defaultConfigs = {
      groq: {
        model: 'openai/gpt-oss-120b',
        temperature: 0.7,
        max_tokens: 2000
      },
      together: {
        model: 'openai/gpt-oss-120b',
        temperature: 0.7,
        max_tokens: 2000
      }
    };

    const mergedConfig = {
      ...defaultConfigs[providerName.toLowerCase()],
      ...config
    };

    return new Provider(mergedConfig);
  }

  static async createAndInitializeProvider(providerName, config = {}) {
    const provider = this.createProvider(providerName, config);
    await provider.initialize();
    return provider;
  }

  static listAvailableProviders() {
    return Object.keys(this.availableProviders).map(name => ({
      name: name,
      className: this.availableProviders[name].name
    }));
  }

  static getProviderRecommendation() {
    return {
      free: 'groq',
      cheapest: 'together',
      fastest: 'groq',
      recommended: 'together'
    };
  }
}

export { 
  LLMProviderFactory, 
  BaseLLMProvider, 
  GroqProvider, 
  TogetherAIProvider 
};