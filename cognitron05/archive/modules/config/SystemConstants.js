#!/usr/bin/env node

/**
 * System Constants for Cognitron05
 * Centralized configuration constants extracted from throughout the codebase
 * Replaces magic numbers with named, configurable values
 */

// Memory System Constants (MemGPTMemorySystem)
export const MEMORY_CONSTANTS = {
  // Working context configuration
  MAX_WORKING_CONTEXT_SIZE: 2000, // tokens - persistent facts about user
  
  // FIFO queue configuration
  MAX_FIFO_QUEUE_SIZE: 20, // messages - recent conversation history
  
  // Memory pressure management
  MEMORY_PRESSURE_THRESHOLD: 0.8, // 80% of context window before pressure kicks in
  
  // Context window configuration
  CONTEXT_WINDOW_SIZE: 8192, // tokens - total context window size for model
  
  // Timing constants
  AUTO_SAVE_INTERVAL: 30000, // 30 seconds - how often to auto-save memory state
  SESSION_TIMEOUT: 1800000, // 30 minutes - session timeout in milliseconds
  
  // File operation constants
  MAX_RECALL_STORAGE_SIZE: 1000000, // 1MB - maximum size for recall storage file
  BACKUP_RETENTION_DAYS: 7, // days - how long to keep backup files
};

// Tokenizer System Constants (ConfigurableTokenizer)
export const TOKENIZER_CONSTANTS = {
  // Cache configuration
  CACHE_SIZE: 1000, // maximum number of cached token estimations
  
  // Performance settings
  CHUNK_SIZE: 1024, // characters - size for text chunking in parallel processing
  MAX_PARALLEL_CHUNKS: 4, // maximum parallel processing chunks
  
  // Model-specific defaults
  DEFAULT_CHARS_PER_TOKEN: 4.0, // conservative fallback ratio
  GPT3_CHARS_PER_TOKEN: 4.0, // original GPT-3 approximation
  GPT4_CHARS_PER_TOKEN: 3.0, // more accurate for GPT-4
  GROQ_GPT_OSS_CHARS_PER_TOKEN: 3.2, // GPT-OSS 120B model
  GROQ_QWEN_CHARS_PER_TOKEN: 2.8, // Qwen3 32B model (Chinese-optimized)
  GROQ_KIMI_CHARS_PER_TOKEN: 3.0, // Kimi K2 model (multilingual)
  CLAUDE_CHARS_PER_TOKEN: 3.5, // Claude models
  
  // Content type adjustments
  CODE_CONTENT_MULTIPLIER: 1.2, // code is typically less token-efficient
  STRUCTURED_DATA_MULTIPLIER: 0.9, // JSON/XML is more token-efficient
  MARKDOWN_MULTIPLIER: 1.05, // markdown formatting adds tokens
  URL_EMAIL_MULTIPLIER: 1.1, // URLs and emails are token-heavy
  
  // Language-specific adjustments
  CHINESE_CHARS_PER_TOKEN: 1.5, // Chinese characters are more token-efficient
  CJK_ADJUSTMENT_FACTOR: 0.9, // Chinese, Japanese, Korean adjustment
  ARABIC_ADJUSTMENT_FACTOR: 0.95, // Arabic script adjustment
  
  // Validation constants
  MIN_TOKEN_COUNT: 1, // minimum tokens for non-empty text
  MAX_TOKENS_PER_CHAR: 1.0, // sanity check - tokens shouldn't exceed characters
  
  // Statistical constants
  COMPLEXITY_THRESHOLD: 0.7, // vocabulary diversity threshold for complexity
  REPETITION_THRESHOLD: 0.3, // repetition factor threshold
  AVG_WORD_LENGTH_THRESHOLD: 6, // average word length for complexity
};

// Logging System Constants (StructuredLogger)
export const LOGGING_CONSTANTS = {
  // Buffer configuration
  BUFFER_SIZE: 100, // number of log entries to buffer before flushing
  FLUSH_INTERVAL: 5000, // milliseconds - how often to flush buffer to file
  
  // File management
  MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB - maximum size before log rotation
  MAX_FILES: 10, // maximum number of rotated log files to keep
  
  // Log levels (in order of severity)
  LOG_LEVELS: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2, 
    ERROR: 3,
    FATAL: 4
  },
  
  // Default configurations
  DEFAULT_LOG_LEVEL: 'INFO',
  DEFAULT_CONSOLE_OUTPUT: true,
  DEFAULT_FILE_OUTPUT: false,
  DEFAULT_JSON_FORMAT: false,
  
  // Performance settings
  MAX_CONTEXT_SIZE: 1000, // maximum size of context object
  MAX_MESSAGE_LENGTH: 10000, // maximum length of log message
  MAX_STACK_DEPTH: 10, // maximum operation stack depth to track
  
  // Format settings
  TIMESTAMP_FORMAT: 'ISO', // ISO, UTC, or LOCAL
  INCLUDE_PID: true,
  INCLUDE_HOSTNAME: false,
  INCLUDE_LOCATION: false, // file/line info (performance impact)
  
  // Security settings
  SANITIZE_SENSITIVE_DATA: true, // remove sensitive data from logs
  SENSITIVE_KEYS: ['password', 'token', 'key', 'secret', 'auth', 'api_key'],
};

// API Error Recovery Constants (ApiErrorRecovery)
export const API_ERROR_CONSTANTS = {
  // HTTP status codes
  HTTP_STATUS_CODES: {
    OK: 200,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504
  },
  
  // Retry configuration
  MAX_RETRIES: 3, // number of retry attempts
  BASE_DELAY: 1000, // 1 second - base delay between retries
  MAX_DELAY: 30000, // 30 seconds - maximum delay between retries
  BACKOFF_MULTIPLIER: 2, // exponential backoff multiplier
  
  // Circuit breaker configuration
  CIRCUIT_BREAKER_THRESHOLD: 5, // failures before opening circuit breaker
  CIRCUIT_BREAKER_TIMEOUT: 60000, // 1 minute - circuit breaker timeout
  
  // Rate limiting configuration
  DEFAULT_RATE_LIMIT_DELAY: 60, // 60 seconds - default rate limit delay
  RATE_LIMIT_JITTER: 0.25, // 25% jitter for rate limiting
  
  // Timeout configuration
  DEFAULT_API_TIMEOUT: 30000, // 30 seconds - default API timeout
  FOLLOW_UP_TIMEOUT: 20000, // 20 seconds - timeout for follow-up responses
  
  // Fallback configuration
  ENABLE_FALLBACKS: true, // whether to enable fallback responses
  ENABLE_CIRCUIT_BREAKER: true, // whether to enable circuit breaker
};

// Chat Agent Constants (ChatAgent, ResponseGenerator)
export const CHAT_AGENT_CONSTANTS = {
  // Model configuration
  DEFAULT_MODEL: 'openai/gpt-oss-120b', // default Groq model
  DEFAULT_TEMPERATURE: 0.7, // default temperature setting
  DEFAULT_MAX_TOKENS: 2048, // default maximum tokens per response
  
  // Temperature bounds
  MIN_TEMPERATURE: 0.0, // minimum allowed temperature
  MAX_TEMPERATURE: 2.0, // maximum allowed temperature
  
  // Token limits
  MIN_MAX_TOKENS: 1, // minimum tokens per response
  MAX_MAX_TOKENS: 8192, // maximum tokens per response (model limit)
  
  // Reasoning levels
  REASONING_LEVELS: {
    LOW: 'low',
    MEDIUM: 'medium', 
    HIGH: 'high'
  },
  
  // Response timing
  TYPING_DELAY: 500, // 500ms - simulated typing delay
  RESPONSE_CHUNK_DELAY: 50, // 50ms - delay between response chunks for streaming effect
};

// Application Constants (cognitron05.js)
export const APPLICATION_CONSTANTS = {
  // Retry configuration
  MAX_RETRY_ATTEMPTS: 3, // maximum retry attempts for failed operations
  RETRY_DELAY: 1000, // 1 second - delay between retries
  
  // File system constants
  DEFAULT_DATA_DIR: 'cognitron05-data', // default data directory name
  
  // Session management
  SESSION_ID_LENGTH: 12, // length of generated session IDs
  MESSAGE_ID_PREFIX: 'msg_', // prefix for message IDs
  
  // UI constants
  COMMAND_PROMPT: '> ', // command prompt string
  LOADING_SPINNER_DELAY: 100, // 100ms - spinner animation delay
  
  // Data validation
  MAX_MESSAGE_LENGTH: 10000, // maximum length for user messages
  MAX_SEARCH_QUERY_LENGTH: 500, // maximum length for search queries
};

// Security Constants (SecureFileOps, Input Validation)
export const SECURITY_CONSTANTS = {
  // Path traversal protection
  ALLOWED_FILE_EXTENSIONS: ['.json', '.jsonl', '.txt', '.md'], // allowed file extensions
  MAX_FILE_PATH_LENGTH: 260, // maximum file path length (Windows limit)
  MAX_FILE_NAME_LENGTH: 255, // maximum file name length
  
  // Input validation
  MAX_QUERY_LENGTH: 1000, // maximum search query length
  ALLOWED_SEARCH_PATTERNS: /^[\w\s\-\.!?'"]+$/, // allowed characters in search queries
  
  // File size limits
  MAX_MEMORY_FILE_SIZE: 50 * 1024 * 1024, // 50MB - maximum memory file size
  MAX_LOG_FILE_SIZE: 10 * 1024 * 1024, // 10MB - maximum log file size
  
  // Encoding and sanitization
  DEFAULT_ENCODING: 'utf8', // default file encoding
  SAFE_CHARACTERS_REGEX: /^[\w\s\-\.@]+$/, // safe characters for file names
};

// Performance Constants
export const PERFORMANCE_CONSTANTS = {
  // Memory management
  GARBAGE_COLLECTION_INTERVAL: 300000, // 5 minutes - GC interval for long-running sessions
  MAX_CONCURRENT_FILE_OPERATIONS: 5, // maximum concurrent file operations
  
  // Streaming configuration
  STREAM_CHUNK_SIZE: 1024, // 1KB - chunk size for streaming operations
  STREAM_HIGH_WATER_MARK: 16384, // 16KB - high water mark for streams
  
  // Indexing and search
  MAX_SEARCH_RESULTS: 50, // maximum search results to return
  SEARCH_RELEVANCE_THRESHOLD: 0.3, // minimum relevance score for search results
  INDEX_UPDATE_BATCH_SIZE: 100, // batch size for index updates
  
  // Monitoring intervals
  HEALTH_CHECK_INTERVAL: 30000, // 30 seconds - health check frequency
  METRICS_COLLECTION_INTERVAL: 60000, // 1 minute - metrics collection frequency
};

// Development and Testing Constants
export const TESTING_CONSTANTS = {
  // Test configuration
  DEFAULT_TEST_TIMEOUT: 10000, // 10 seconds - default test timeout
  INTEGRATION_TEST_TIMEOUT: 30000, // 30 seconds - integration test timeout
  
  // Mock data generation
  TEST_SESSION_ID: 'test-session-123', // test session ID
  TEST_MESSAGE_COUNT: 50, // number of test messages to generate
  
  // Performance testing
  STRESS_TEST_MESSAGE_COUNT: 1000, // messages for stress testing
  LOAD_TEST_CONCURRENT_USERS: 10, // concurrent users for load testing
};

// Export all constants as a single configuration object
export const SYSTEM_CONFIG = {
  MEMORY: MEMORY_CONSTANTS,
  API_ERROR: API_ERROR_CONSTANTS,
  CHAT_AGENT: CHAT_AGENT_CONSTANTS,
  APPLICATION: APPLICATION_CONSTANTS,
  SECURITY: SECURITY_CONSTANTS,
  PERFORMANCE: PERFORMANCE_CONSTANTS,
  TESTING: TESTING_CONSTANTS
};

// Validation functions for configuration values
export class ConfigValidator {
  /**
   * Validate temperature value
   */
  static validateTemperature(value) {
    const temp = parseFloat(value);
    if (isNaN(temp)) {
      return { valid: false, error: 'Temperature must be a number' };
    }
    if (temp < CHAT_AGENT_CONSTANTS.MIN_TEMPERATURE || temp > CHAT_AGENT_CONSTANTS.MAX_TEMPERATURE) {
      return { 
        valid: false, 
        error: `Temperature must be between ${CHAT_AGENT_CONSTANTS.MIN_TEMPERATURE} and ${CHAT_AGENT_CONSTANTS.MAX_TEMPERATURE}` 
      };
    }
    return { valid: true, normalized: temp };
  }

  /**
   * Validate max tokens value
   */
  static validateMaxTokens(value) {
    const tokens = parseInt(value);
    if (isNaN(tokens)) {
      return { valid: false, error: 'Max tokens must be a number' };
    }
    if (tokens < CHAT_AGENT_CONSTANTS.MIN_MAX_TOKENS || tokens > CHAT_AGENT_CONSTANTS.MAX_MAX_TOKENS) {
      return { 
        valid: false, 
        error: `Max tokens must be between ${CHAT_AGENT_CONSTANTS.MIN_MAX_TOKENS} and ${CHAT_AGENT_CONSTANTS.MAX_MAX_TOKENS}` 
      };
    }
    return { valid: true, normalized: tokens };
  }

  /**
   * Validate reasoning level
   */
  static validateReasoningLevel(value) {
    const validLevels = Object.values(CHAT_AGENT_CONSTANTS.REASONING_LEVELS);
    if (!validLevels.includes(value)) {
      return { 
        valid: false, 
        error: `Reasoning level must be one of: ${validLevels.join(', ')}` 
      };
    }
    return { valid: true, normalized: value };
  }

  /**
   * Validate memory pressure threshold
   */
  static validateMemoryPressureThreshold(value) {
    const threshold = parseFloat(value);
    if (isNaN(threshold)) {
      return { valid: false, error: 'Memory pressure threshold must be a number' };
    }
    if (threshold < 0.1 || threshold > 0.95) {
      return { 
        valid: false, 
        error: 'Memory pressure threshold must be between 0.1 and 0.95' 
      };
    }
    return { valid: true, normalized: threshold };
  }

  /**
   * Validate file size
   */
  static validateFileSize(size, maxSize = SECURITY_CONSTANTS.MAX_MEMORY_FILE_SIZE) {
    if (typeof size !== 'number' || size < 0) {
      return { valid: false, error: 'File size must be a positive number' };
    }
    if (size > maxSize) {
      return { 
        valid: false, 
        error: `File size cannot exceed ${Math.round(maxSize / 1024 / 1024)}MB` 
      };
    }
    return { valid: true, normalized: size };
  }
}

// Configuration loader with environment variable support
export class ConfigLoader {
  /**
   * Load configuration with environment variable overrides
   */
  static loadConfig(overrides = {}) {
    const config = JSON.parse(JSON.stringify(SYSTEM_CONFIG)); // Deep copy
    
    // Apply environment variable overrides
    const envOverrides = this.getEnvironmentOverrides();
    this.mergeConfig(config, envOverrides);
    
    // Apply provided overrides
    this.mergeConfig(config, overrides);
    
    return config;
  }

  /**
   * Get configuration overrides from environment variables
   */
  static getEnvironmentOverrides() {
    const overrides = {};
    
    // Memory configuration from environment
    if (process.env.COGNITRON_MAX_WORKING_CONTEXT_SIZE) {
      overrides.MEMORY = overrides.MEMORY || {};
      overrides.MEMORY.MAX_WORKING_CONTEXT_SIZE = parseInt(process.env.COGNITRON_MAX_WORKING_CONTEXT_SIZE);
    }
    
    if (process.env.COGNITRON_MAX_FIFO_QUEUE_SIZE) {
      overrides.MEMORY = overrides.MEMORY || {};
      overrides.MEMORY.MAX_FIFO_QUEUE_SIZE = parseInt(process.env.COGNITRON_MAX_FIFO_QUEUE_SIZE);
    }
    
    if (process.env.COGNITRON_MEMORY_PRESSURE_THRESHOLD) {
      overrides.MEMORY = overrides.MEMORY || {};
      overrides.MEMORY.MEMORY_PRESSURE_THRESHOLD = parseFloat(process.env.COGNITRON_MEMORY_PRESSURE_THRESHOLD);
    }
    
    // Chat agent configuration from environment
    if (process.env.COGNITRON_DEFAULT_TEMPERATURE) {
      overrides.CHAT_AGENT = overrides.CHAT_AGENT || {};
      overrides.CHAT_AGENT.DEFAULT_TEMPERATURE = parseFloat(process.env.COGNITRON_DEFAULT_TEMPERATURE);
    }
    
    if (process.env.COGNITRON_DEFAULT_MAX_TOKENS) {
      overrides.CHAT_AGENT = overrides.CHAT_AGENT || {};
      overrides.CHAT_AGENT.DEFAULT_MAX_TOKENS = parseInt(process.env.COGNITRON_DEFAULT_MAX_TOKENS);
    }
    
    if (process.env.COGNITRON_DEFAULT_MODEL) {
      overrides.CHAT_AGENT = overrides.CHAT_AGENT || {};
      overrides.CHAT_AGENT.DEFAULT_MODEL = process.env.COGNITRON_DEFAULT_MODEL;
    }
    
    // API error recovery configuration
    if (process.env.COGNITRON_API_MAX_RETRIES) {
      overrides.API_ERROR = overrides.API_ERROR || {};
      overrides.API_ERROR.MAX_RETRIES = parseInt(process.env.COGNITRON_API_MAX_RETRIES);
    }
    
    if (process.env.COGNITRON_API_TIMEOUT) {
      overrides.API_ERROR = overrides.API_ERROR || {};
      overrides.API_ERROR.DEFAULT_API_TIMEOUT = parseInt(process.env.COGNITRON_API_TIMEOUT);
    }
    
    return overrides;
  }

  /**
   * Merge configuration objects recursively
   */
  static mergeConfig(target, source) {
    for (const key in source) {
      if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        target[key] = target[key] || {};
        this.mergeConfig(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }
}

export default {
  SYSTEM_CONFIG,
  MEMORY_CONSTANTS,
  API_ERROR_CONSTANTS,
  CHAT_AGENT_CONSTANTS,
  APPLICATION_CONSTANTS,
  SECURITY_CONSTANTS,
  PERFORMANCE_CONSTANTS,
  TESTING_CONSTANTS,
  ConfigValidator,
  ConfigLoader
};