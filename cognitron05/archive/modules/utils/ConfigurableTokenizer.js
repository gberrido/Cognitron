#!/usr/bin/env node

/**
 * Configurable Tokenizer - Model-specific token estimation for Cognitron05
 * Replaces hardcoded 4-chars-per-token approximation with proper model-aware calculations
 * 
 * Supports:
 * - Model-specific tokenizer configurations
 * - Multiple estimation methods (GPT-3, Claude, Groq models)
 * - Configurable fallback strategies
 * - Performance optimization with caching
 * - Validation and error handling
 */

import { TOKENIZER_CONSTANTS } from '../config/SystemConstants.js';

export class ConfigurableTokenizer {
  constructor(config = {}) {
    this.config = {
      // Primary tokenizer method
      method: config.method || 'gpt3_approximation',
      
      // Model-specific settings
      model: config.model || 'openai/gpt-oss-120b',
      
      // Performance settings
      enableCaching: config.enableCaching !== false,
      cacheSize: config.cacheSize || TOKENIZER_CONSTANTS.CACHE_SIZE,
      
      // Fallback strategy
      fallbackMethod: config.fallbackMethod || 'character_count',
      
      // Advanced settings
      chunkSize: config.chunkSize || TOKENIZER_CONSTANTS.CHUNK_SIZE,
      parallelProcessing: config.parallelProcessing !== false,
      
      // Debug and validation
      validateResults: config.validateResults !== false,
      debugMode: config.debugMode === true
    };

    // Token estimation cache for performance
    this.cache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;

    // Model-specific configurations
    this.modelConfigs = this.getModelConfigurations();
    
    // Initialize current model config
    this.currentModelConfig = this.modelConfigs[this.config.model] || 
                              this.modelConfigs['default'];

    // Initialize tokenizer methods
    this.initializeTokenizerMethods();
    
    // Initialize logger with fallback for environments without logger
    this.logger = {
      debug: (msg, ctx) => this.config.debugMode && console.log('🔢', msg, ctx),
      warn: (msg, ctx) => console.warn('⚠️', msg, ctx),
      error: (msg, ctx, err) => console.error('❌', msg, ctx, err?.message)
    };
    
    // Try to use structured logger if available
    this.initializeStructuredLogging();
    
    if (this.config.debugMode) {
      this.logger.debug('ConfigurableTokenizer initialized', {
        method: this.config.method,
        model: this.config.model,
        cacheEnabled: this.config.enableCaching
      });
    }
  }

  /**
   * Initialize structured logging if available
   */
  initializeStructuredLogging() {
    try {
      // Try to dynamically import and use structured logger
      import('../utils/StructuredLogger.js')
        .then(({ getLogger }) => {
          this.logger = getLogger();
          if (this.config.debugMode) {
            this.logger.debug('Structured logging enabled for tokenizer', {
              component: 'tokenizer',
              model: this.config.model,
              method: this.config.method
            });
          }
        })
        .catch(() => {
          // Keep fallback logger if structured logger not available
        });
    } catch {
      // Keep fallback logger
    }
  }

  /**
   * Get model-specific tokenizer configurations
   */
  getModelConfigurations() {
    return {
      // Groq models (primary focus)
      'openai/gpt-oss-120b': {
        name: 'GPT-OSS 120B',
        type: 'groq',
        avgCharsPerToken: 3.2,  // More accurate for large models
        tokenizer: 'gpt3_enhanced',
        contextWindow: 8192,
        specialTokens: ['<|endoftext|>', '<|im_start|>', '<|im_end|>'],
        encoding: 'cl100k_base'
      },
      
      'qwen/qwen3-32b': {
        name: 'Qwen3 32B', 
        type: 'groq',
        avgCharsPerToken: 2.8,  // Chinese-optimized, more efficient
        tokenizer: 'qwen_tokenizer',
        contextWindow: 32768,
        specialTokens: ['<|im_start|>', '<|im_end|>', '<|endoftext|>'],
        encoding: 'qwen_encoding'
      },
      
      'moonshotai/kimi-k2-instruct': {
        name: 'Kimi K2 Instruct',
        type: 'groq', 
        avgCharsPerToken: 3.0,  // Balanced multilingual
        tokenizer: 'kimi_tokenizer',
        contextWindow: 200000,  // Very large context
        specialTokens: ['<|im_start|>', '<|im_end|>'],
        encoding: 'kimi_encoding'
      },

      // OpenAI models (for comparison/fallback)
      'gpt-4': {
        name: 'GPT-4',
        type: 'openai',
        avgCharsPerToken: 3.0,
        tokenizer: 'cl100k_base',
        contextWindow: 8192,
        specialTokens: ['<|endoftext|>', '<|im_start|>', '<|im_end|>'],
        encoding: 'cl100k_base'
      },

      'gpt-3.5-turbo': {
        name: 'GPT-3.5 Turbo',
        type: 'openai',
        avgCharsPerToken: 4.0,  // Original approximation
        tokenizer: 'cl100k_base',
        contextWindow: 16384,
        specialTokens: ['<|endoftext|>', '<|im_start|>', '<|im_end|>'],
        encoding: 'cl100k_base'
      },

      // Anthropic models
      'claude-3': {
        name: 'Claude 3',
        type: 'anthropic',
        avgCharsPerToken: 3.5,
        tokenizer: 'claude_tokenizer',
        contextWindow: 200000,
        specialTokens: ['Human:', 'Assistant:'],
        encoding: 'claude_encoding'
      },

      // Default/fallback configuration
      'default': {
        name: 'Default Tokenizer',
        type: 'generic',
        avgCharsPerToken: 4.0,  // Conservative fallback
        tokenizer: 'character_based',
        contextWindow: 4096,
        specialTokens: [],
        encoding: 'utf8'
      }
    };
  }

  /**
   * Initialize available tokenizer methods
   */
  initializeTokenizerMethods() {
    this.methods = {
      // Enhanced GPT-3 approximation with model awareness
      gpt3_approximation: this.gpt3ApproximationTokenizer.bind(this),
      gpt3_enhanced: this.gpt3EnhancedTokenizer.bind(this),
      
      // Model-specific tokenizers
      qwen_tokenizer: this.qwenTokenizer.bind(this),
      kimi_tokenizer: this.kimiTokenizer.bind(this),
      claude_tokenizer: this.claudeTokenizer.bind(this),
      
      // Fallback methods
      character_count: this.characterCountTokenizer.bind(this),
      word_based: this.wordBasedTokenizer.bind(this),
      whitespace_based: this.whitespaceBasedTokenizer.bind(this),
      
      // Advanced methods
      statistical_estimation: this.statisticalEstimationTokenizer.bind(this),
      content_aware: this.contentAwareTokenizer.bind(this)
    };
  }

  /**
   * Main token estimation method - routes to configured tokenizer
   */
  estimateTokens(text, options = {}) {
    if (typeof text !== 'string') {
      if (this.config.debugMode) {
        console.warn('⚠️ Non-string input to estimateTokens:', typeof text);
      }
      return 0;
    }

    if (text.length === 0) {
      return 0;
    }

    // Check cache first
    const cacheKey = this.getCacheKey(text, options);
    if (this.config.enableCaching && this.cache.has(cacheKey)) {
      this.cacheHits++;
      return this.cache.get(cacheKey);
    }
    this.cacheMisses++;

    // Get tokenizer method
    const method = options.method || this.config.method;
    const tokenizerMethod = this.methods[method] || this.methods[this.config.fallbackMethod];
    
    if (!tokenizerMethod) {
      throw new Error(`Tokenizer method not found: ${method}`);
    }

    try {
      // Execute tokenization
      const tokenCount = tokenizerMethod(text, options);
      
      // Validate result
      if (this.config.validateResults) {
        this.validateTokenCount(tokenCount, text);
      }

      // Cache result
      if (this.config.enableCaching) {
        this.manageCacheSize();
        this.cache.set(cacheKey, tokenCount);
      }

      if (this.config.debugMode && text.length > 1000) {
        this.logger.debug('Large text tokenized', {
          component: 'tokenizer',
          textLength: text.length,
          tokenCount,
          method,
          ratio: (text.length / tokenCount).toFixed(2)
        });
      }

      return tokenCount;

    } catch (error) {
      this.logger.error('Tokenization error, using fallback', {
        component: 'tokenizer',
        method,
        textLength: text.length,
        fallbackMethod: 'character_count'
      }, error);

      // Fallback to safe method
      return this.methods.character_count(text, options);
    }
  }

  /**
   * Enhanced GPT-3 tokenizer with model-specific adjustments
   */
  gpt3EnhancedTokenizer(text, options = {}) {
    const modelConfig = this.currentModelConfig;
    let tokenCount = 0;

    // Handle special tokens
    let processedText = text;
    for (const specialToken of modelConfig.specialTokens) {
      const regex = new RegExp(escapeRegExp(specialToken), 'g');
      const matches = (text.match(regex) || []).length;
      tokenCount += matches; // Each special token = 1 token
      processedText = processedText.replace(regex, '');
    }

    // Estimate remaining text with model-specific ratio
    tokenCount += Math.ceil(processedText.length / modelConfig.avgCharsPerToken);

    // Apply content type adjustments
    tokenCount = this.applyContentAdjustments(tokenCount, text, modelConfig);

    return Math.max(1, Math.ceil(tokenCount));
  }

  /**
   * Original GPT-3 approximation (backward compatibility)
   */
  gpt3ApproximationTokenizer(text, options = {}) {
    return Math.ceil(text.length / 4);
  }

  /**
   * Qwen model tokenizer - optimized for Chinese and multilingual text
   */
  qwenTokenizer(text, options = {}) {
    let tokenCount = 0;
    const modelConfig = this.currentModelConfig;

    // Detect Chinese characters (more token-efficient in Qwen)
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const nonChineseText = text.replace(/[\u4e00-\u9fff]/g, '');

    // Chinese characters: ~1.5 chars per token
    tokenCount += Math.ceil(chineseChars / 1.5);

    // Non-Chinese text: use model average
    tokenCount += Math.ceil(nonChineseText.length / modelConfig.avgCharsPerToken);

    return Math.max(1, Math.ceil(tokenCount));
  }

  /**
   * Kimi model tokenizer - optimized for long context and structured data
   */
  kimiTokenizer(text, options = {}) {
    const modelConfig = this.currentModelConfig;
    let tokenCount = 0;

    // Base estimation
    tokenCount = Math.ceil(text.length / modelConfig.avgCharsPerToken);

    // Kimi is efficient with structured data
    if (this.isStructuredContent(text)) {
      tokenCount *= 0.85; // 15% reduction for structured content
    }

    // Kimi handles repetitive content efficiently
    const repetitionFactor = this.calculateRepetitionFactor(text);
    if (repetitionFactor > 0.3) {
      tokenCount *= (1 - repetitionFactor * 0.2); // Up to 20% reduction for repetitive content
    }

    return Math.max(1, Math.ceil(tokenCount));
  }

  /**
   * Claude tokenizer approximation
   */
  claudeTokenizer(text, options = {}) {
    const modelConfig = this.currentModelConfig;
    
    // Claude tends to be slightly more token-efficient than GPT
    let tokenCount = Math.ceil(text.length / modelConfig.avgCharsPerToken);

    // Adjust for dialogue format (Claude's specialty)
    if (text.includes('Human:') || text.includes('Assistant:')) {
      tokenCount *= 0.95; // 5% reduction for dialogue
    }

    return Math.max(1, Math.ceil(tokenCount));
  }

  /**
   * Character count fallback tokenizer
   */
  characterCountTokenizer(text, options = {}) {
    return Math.ceil(text.length / 4); // Conservative fallback
  }

  /**
   * Word-based tokenizer
   */
  wordBasedTokenizer(text, options = {}) {
    const words = text.trim().split(/\s+/).filter(word => word.length > 0);
    // Approximate: 1.3 tokens per word on average
    return Math.ceil(words.length * 1.3);
  }

  /**
   * Whitespace-based tokenizer
   */
  whitespaceBasedTokenizer(text, options = {}) {
    const segments = text.trim().split(/\s+/);
    let tokenCount = 0;

    for (const segment of segments) {
      if (segment.length <= 4) {
        tokenCount += 1; // Short segments are usually 1 token
      } else {
        tokenCount += Math.ceil(segment.length / 3); // Longer segments
      }
    }

    return Math.max(1, tokenCount);
  }

  /**
   * Statistical estimation tokenizer with content analysis
   */
  statisticalEstimationTokenizer(text, options = {}) {
    let tokenCount = 0;
    const modelConfig = this.currentModelConfig;

    // Base calculation
    tokenCount = Math.ceil(text.length / modelConfig.avgCharsPerToken);

    // Adjust based on content characteristics
    const contentFactors = this.analyzeContentFactors(text);
    
    // Apply statistical adjustments
    tokenCount *= contentFactors.complexityFactor;
    tokenCount *= contentFactors.languageFactor; 
    tokenCount *= contentFactors.formatFactor;

    return Math.max(1, Math.ceil(tokenCount));
  }

  /**
   * Content-aware tokenizer with deep text analysis
   */
  contentAwareTokenizer(text, options = {}) {
    const analysis = this.performContentAnalysis(text);
    let tokenCount = 0;

    // Calculate tokens based on content type
    tokenCount += analysis.codeTokens;
    tokenCount += analysis.naturalLanguageTokens;
    tokenCount += analysis.structuredDataTokens;
    tokenCount += analysis.specialFormatTokens;

    return Math.max(1, Math.ceil(tokenCount));
  }

  /**
   * Apply content-based adjustments to token count
   */
  applyContentAdjustments(baseTokens, text, modelConfig) {
    let adjustedTokens = baseTokens;

    // Code content is typically less token-efficient
    if (this.isCodeContent(text)) {
      adjustedTokens *= 1.2; // 20% increase for code
    }

    // JSON/structured data can be more efficient
    if (this.isStructuredContent(text)) {
      adjustedTokens *= 0.9; // 10% reduction for structured data
    }

    // Very short text has minimum token count
    if (text.length < 10) {
      adjustedTokens = Math.max(adjustedTokens, 1);
    }

    return adjustedTokens;
  }

  /**
   * Detect if content is primarily code
   */
  isCodeContent(text) {
    const codeIndicators = [
      /function\s+\w+\s*\(/,
      /class\s+\w+/,
      /import\s+\w+/,
      /const\s+\w+\s*=/,
      /let\s+\w+\s*=/,
      /var\s+\w+\s*=/,
      /\w+\(\)\s*{/,
      /if\s*\(/,
      /for\s*\(/,
      /while\s*\(/
    ];

    return codeIndicators.some(pattern => pattern.test(text));
  }

  /**
   * Detect if content is structured data (JSON, XML, etc.)
   */
  isStructuredContent(text) {
    const structuredIndicators = [
      /^[\s]*{.*}[\s]*$/s,  // JSON object
      /^[\s]*\[.*\][\s]*$/s, // JSON array
      /<\w+.*?>.*?<\/\w+>/s,  // XML/HTML
      /^\w+:\s*.+$/m         // YAML-like
    ];

    return structuredIndicators.some(pattern => pattern.test(text));
  }

  /**
   * Calculate repetition factor in text
   */
  calculateRepetitionFactor(text) {
    const words = text.toLowerCase().split(/\s+/);
    const wordCounts = new Map();
    
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }

    let totalRepeated = 0;
    for (const [word, count] of wordCounts) {
      if (count > 1) {
        totalRepeated += count - 1; // Count extra occurrences
      }
    }

    return words.length > 0 ? totalRepeated / words.length : 0;
  }

  /**
   * Analyze content factors for statistical estimation
   */
  analyzeContentFactors(text) {
    return {
      complexityFactor: this.calculateComplexityFactor(text),
      languageFactor: this.calculateLanguageFactor(text),
      formatFactor: this.calculateFormatFactor(text)
    };
  }

  /**
   * Calculate complexity factor based on vocabulary and structure
   */
  calculateComplexityFactor(text) {
    const words = text.split(/\s+/);
    const uniqueWords = new Set(words.map(w => w.toLowerCase()));
    
    // Higher vocabulary diversity = higher complexity = more tokens
    const vocabularyDiversity = uniqueWords.size / Math.max(words.length, 1);
    
    // Average word length also affects complexity
    const avgWordLength = words.reduce((sum, word) => sum + word.length, 0) / Math.max(words.length, 1);
    
    let complexityFactor = 1.0;
    
    if (vocabularyDiversity > 0.7) complexityFactor += 0.1; // High diversity
    if (avgWordLength > 6) complexityFactor += 0.1;        // Long words
    
    return Math.min(complexityFactor, 1.3); // Cap at 30% increase
  }

  /**
   * Calculate language factor for multilingual text
   */
  calculateLanguageFactor(text) {
    let factor = 1.0;

    // Check for non-Latin scripts (typically more token-efficient in some models)
    if (/[\u4e00-\u9fff]/.test(text)) factor *= 0.9;  // Chinese
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) factor *= 0.9; // Japanese
    if (/[\uac00-\ud7af]/.test(text)) factor *= 0.9;  // Korean
    if (/[\u0600-\u06ff]/.test(text)) factor *= 0.95; // Arabic

    return factor;
  }

  /**
   * Calculate format factor based on text structure
   */
  calculateFormatFactor(text) {
    let factor = 1.0;

    // Markdown/formatting typically adds tokens
    if (/[*_`#]/.test(text)) factor *= 1.05;
    
    // URLs and emails are token-heavy
    if (/https?:\/\/|@\w+\.\w+/.test(text)) factor *= 1.1;
    
    // Structured lists might be more efficient
    if (/^\s*[-*+]\s/m.test(text)) factor *= 0.98;

    return factor;
  }

  /**
   * Perform comprehensive content analysis
   */
  performContentAnalysis(text) {
    const analysis = {
      codeTokens: 0,
      naturalLanguageTokens: 0,
      structuredDataTokens: 0,
      specialFormatTokens: 0
    };

    // Split text into different content types and estimate separately
    const lines = text.split('\n');
    
    for (const line of lines) {
      if (this.isCodeContent(line)) {
        analysis.codeTokens += Math.ceil(line.length / 2.5); // Code is dense
      } else if (this.isStructuredContent(line)) {
        analysis.structuredDataTokens += Math.ceil(line.length / 3.5); // JSON is efficient
      } else if (/[*_`#]/.test(line)) {
        analysis.specialFormatTokens += Math.ceil(line.length / 3.2); // Markdown
      } else {
        analysis.naturalLanguageTokens += Math.ceil(line.length / this.currentModelConfig.avgCharsPerToken);
      }
    }

    return analysis;
  }

  /**
   * Switch to a different model configuration
   */
  switchModel(modelName) {
    if (this.modelConfigs[modelName]) {
      this.config.model = modelName;
      this.currentModelConfig = this.modelConfigs[modelName];
      
      // Clear cache when switching models since estimates may differ
      if (this.config.enableCaching) {
        this.cache.clear();
      }

      if (this.config.debugMode) {
        this.logger.debug('Switched tokenizer model', {
          component: 'tokenizer',
          newModel: modelName,
          previousModel: this.config.model
        });
      }
    } else {
      throw new Error(`Model configuration not found: ${modelName}`);
    }
  }

  /**
   * Update tokenizer configuration
   */
  updateConfig(newConfig) {
    const oldModel = this.config.model;
    this.config = { ...this.config, ...newConfig };

    // Update model config if model changed
    if (newConfig.model && newConfig.model !== oldModel) {
      this.switchModel(newConfig.model);
    }

    if (this.config.debugMode) {
      console.log('⚙️ Tokenizer config updated:', newConfig);
    }
  }

  /**
   * Get cache key for result caching
   */
  getCacheKey(text, options) {
    const key = `${this.config.method}:${this.config.model}:${text.length}:${this.hashString(text)}`;
    return key;
  }

  /**
   * Simple hash function for cache keys
   */
  hashString(str) {
    let hash = 0;
    for (let i = 0; i < Math.min(str.length, 100); i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  /**
   * Manage cache size to prevent memory issues
   */
  manageCacheSize() {
    if (this.cache.size > this.config.cacheSize) {
      // Remove oldest entries (simple LRU approximation)
      const entriesToRemove = this.cache.size - this.config.cacheSize + 100;
      const keys = Array.from(this.cache.keys());
      
      for (let i = 0; i < entriesToRemove; i++) {
        this.cache.delete(keys[i]);
      }
    }
  }

  /**
   * Validate token count result
   */
  validateTokenCount(tokenCount, text) {
    if (!Number.isInteger(tokenCount) || tokenCount < 0) {
      throw new Error(`Invalid token count: ${tokenCount}`);
    }

    if (tokenCount === 0 && text.length > 0) {
      throw new Error('Token count cannot be 0 for non-empty text');
    }

    // Sanity check: token count shouldn't be more than character count
    if (tokenCount > text.length) {
      console.warn(`⚠️ Token count (${tokenCount}) exceeds character count (${text.length})`);
    }
  }

  /**
   * Get tokenizer statistics and status
   */
  getStats() {
    const totalRequests = this.cacheHits + this.cacheMisses;
    const hitRate = totalRequests > 0 ? (this.cacheHits / totalRequests * 100).toFixed(1) : '0.0';

    return {
      config: this.config,
      currentModel: this.currentModelConfig.name,
      cache: {
        size: this.cache.size,
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: `${hitRate}%`
      },
      availableMethods: Object.keys(this.methods),
      availableModels: Object.keys(this.modelConfigs)
    };
  }

  /**
   * Clear cache and reset statistics
   */
  reset() {
    this.cache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;

    if (this.config.debugMode) {
      console.log('🔄 Tokenizer cache and stats reset');
    }
  }

  /**
   * Estimate tokens for batch processing
   */
  estimateTokensBatch(texts, options = {}) {
    if (!Array.isArray(texts)) {
      throw new Error('Input must be an array of strings');
    }

    const results = [];
    let totalTokens = 0;

    for (let i = 0; i < texts.length; i++) {
      const tokenCount = this.estimateTokens(texts[i], { 
        ...options, 
        batchIndex: i 
      });
      results.push({
        index: i,
        text: texts[i].substring(0, 100) + (texts[i].length > 100 ? '...' : ''),
        length: texts[i].length,
        tokens: tokenCount
      });
      totalTokens += tokenCount;
    }

    return {
      results,
      totalTexts: texts.length,
      totalTokens,
      averageTokensPerText: Math.round(totalTokens / texts.length),
      method: this.config.method,
      model: this.config.model
    };
  }
}

/**
 * Utility function to escape special regex characters
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default ConfigurableTokenizer;