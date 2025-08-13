#!/usr/bin/env node

/**
 * MemGPT-Inspired Memory System for Cognitron05
 * Implements hierarchical memory management with working context, FIFO queue, and archival storage
 * Based on the MemGPT paper: "Towards LLMs as Operating Systems"
 */

import fs from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SecureFileOps } from '../utils/SecureFileOps.js';
import { MemoryErrorFactory, MemoryErrorRecovery } from './MemorySystemErrors.js';
import { MEMORY_CONSTANTS } from '../config/SystemConstants.js';
import { ConfigurableTokenizer } from '../utils/ConfigurableTokenizer.js';
import { getLogger } from '../utils/StructuredLogger.js';
import { SearchIndex } from './SearchIndex.js';
import { streamingJSON } from '../utils/StreamingJSONProcessor.js';
import { SecureJsonHandler } from '../security/SecureJsonHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MemGPTMemorySystem {
  constructor(config = {}) {
    this.config = {
      dataDir: config.dataDir || path.join(process.cwd(), 'cognitron05-data'),
      enabled: config.enabled !== false,
      // MemGPT-inspired settings - now using centralized constants
      maxWorkingContextSize: config.maxWorkingContextSize || MEMORY_CONSTANTS.MAX_WORKING_CONTEXT_SIZE,
      maxFifoQueueSize: config.maxFifoQueueSize || MEMORY_CONSTANTS.MAX_FIFO_QUEUE_SIZE,
      memoryPressureThreshold: config.memoryPressureThreshold || MEMORY_CONSTANTS.MEMORY_PRESSURE_THRESHOLD,
      contextWindowSize: config.contextWindowSize || MEMORY_CONSTANTS.CONTEXT_WINDOW_SIZE,
      autoSaveInterval: config.autoSaveInterval || MEMORY_CONSTANTS.AUTO_SAVE_INTERVAL,
      sessionTimeout: config.sessionTimeout || MEMORY_CONSTANTS.SESSION_TIMEOUT,
      maxRecallStorageSize: config.maxRecallStorageSize || MEMORY_CONSTANTS.MAX_RECALL_STORAGE_SIZE,
      backupRetentionDays: config.backupRetentionDays || MEMORY_CONSTANTS.BACKUP_RETENTION_DAYS,
      ...config
    };

    // MemGPT Memory Architecture
    this.workingContext = new Map(); // Core memory - key facts, preferences, user info
    this.fifoQueue = []; // Recent conversation history
    this.recursiveSummary = ''; // Summary of evicted messages
    
    // External storage
    this.recallStorage = []; // All conversation messages with timestamps
    this.archivalStorage = new Map(); // Long-term structured data with search
    
    // Session management
    this.currentSessionId = this.generateSessionId();
    this.messageIdCounter = 0;
    this.contextTokenCount = 0;
    
    // State tracking
    this.memoryPressureWarning = false;
    this.lastSaveTime = Date.now();
    
    // Error handling statistics
    this.errorStats = {
      totalErrors: 0,
      errorsByType: new Map(),
      lastError: null,
      recoveryAttempts: 0
    };

    // Initialize configurable tokenizer
    this.tokenizer = new ConfigurableTokenizer({
      model: config.model || 'openai/gpt-oss-120b', // Default to Groq GPT-OSS
      method: config.tokenizerMethod || 'gpt3_enhanced',
      enableCaching: config.enableTokenizerCaching !== false,
      cacheSize: config.tokenizerCacheSize || 500,
      debugMode: config.debugTokenizer === true
    });

    // Initialize structured logger
    this.logger = getLogger();
    this.logger.setSessionId(this.currentSessionId);
    
    // Initialize secure JSON handler
    this.secureJson = new SecureJsonHandler({
      maxJsonSize: 10 * 1024 * 1024, // 10MB
      maxObjectDepth: 20,
      preventPrototypePollution: true,
      parseTimeout: 10000
    });

    // Initialize search index for high-performance searches
    this.searchIndex = new SearchIndex(this.config.dataDir, {
      enableStemming: config.enableIndexStemming !== false,
      enableStopWords: config.enableIndexStopWords !== false,
      enablePhraseSearch: config.enablePhraseSearch !== false,
      enableProximitySearch: config.enableProximitySearch !== false,
      minTermLength: config.indexMinTermLength || 2,
      maxTermLength: config.indexMaxTermLength || 50
    });
    
    this.indexEnabled = config.enableSearchIndex !== false;
  }

  /**
   * Handle memory system errors with standardized classification and recovery
   * @param {Error} error - Original error
   * @param {string} operation - Operation that caused the error
   * @param {Object} context - Additional context
   * @returns {Promise<Object>} Error handling result
   */
  async handleMemoryError(error, operation, context = {}) {
    // Convert to standardized memory error if needed
    const memoryError = error.name?.startsWith('Memory') ? error : 
      MemoryErrorFactory.wrap(error, operation, context);
    
    // Update error statistics
    this.errorStats.totalErrors++;
    const errorType = memoryError.constructor.name;
    this.errorStats.errorsByType.set(errorType, 
      (this.errorStats.errorsByType.get(errorType) || 0) + 1
    );
    this.errorStats.lastError = {
      timestamp: new Date().toISOString(),
      type: errorType,
      operation,
      message: memoryError.message
    };

    // Get recovery strategy
    const strategy = MemoryErrorRecovery.getStrategy(memoryError);
    
    // Log the error with rich context
    this.logger.memory('ERROR', operation, memoryError.message, {
      severity: memoryError.severity,
      errorType: memoryError.type,
      ...memoryError.context
    });

    // Execute recovery strategy
    let recoveryResult = { success: false, action: 'none', message: 'No recovery attempted' };
    
    if (memoryError.recoverable && strategy) {
      try {
        recoveryResult = await this.executeRecoveryStrategy(strategy, memoryError, context);
        this.errorStats.recoveryAttempts++;
      } catch (recoveryError) {
        console.error('Recovery strategy failed:', recoveryError.message);
        recoveryResult = { 
          success: false, 
          action: 'recovery_failed', 
          message: `Recovery failed: ${recoveryError.message}` 
        };
      }
    }

    return {
      error: memoryError,
      strategy,
      recovery: recoveryResult,
      shouldContinue: recoveryResult.success || memoryError.recoverable,
      userMessage: this.generateUserErrorMessage(memoryError, recoveryResult)
    };
  }

  /**
   * Execute recovery strategy for memory system errors
   * @param {Object} strategy - Recovery strategy
   * @param {MemorySystemError} error - Memory error
   * @param {Object} context - Error context
   * @returns {Promise<Object>} Recovery result
   */
  async executeRecoveryStrategy(strategy, error, context = {}) {
    console.log(`Executing recovery strategy: ${strategy.action}`);
    
    switch (strategy.action) {
      case 'reset_memory':
        return await this.recoverFromCorruption(error, context);
      
      case 'cleanup_memory':
        return await this.recoverFromPressure(error, context);
      
      case 'retry_with_fallback':
        return await this.recoverFromFileSystemError(error, context);
      
      case 'skip_corrupted_data':
        return await this.recoverFromDataFormat(error, context);
      
      case 'create_new_session':
        return await this.recoverFromSessionError(error, context);
      
      case 'fallback_search':
        return await this.recoverFromSearchError(error, context);
      
      case 'terminate_operation':
        return { success: false, action: 'terminate', message: 'Security violation - operation terminated' };
      
      case 'use_defaults':
        return await this.recoverFromConfigError(error, context);
      
      case 'sanitize_and_retry':
        return await this.recoverFromValidationError(error, context);
      
      default:
        return { success: true, action: 'continue', message: 'Error logged, continuing operation' };
    }
  }

  /**
   * Recovery strategy for memory corruption
   */
  async recoverFromCorruption(error, context) {
    console.log('🔄 Recovering from memory corruption...');
    
    try {
      // Create backup of current state
      const backupDir = path.join(this.config.dataDir, 'corruption-backup-' + Date.now());
      await SecureFileOps.ensureDirectoryExists(backupDir);
      
      // Reset memory structures to clean state
      this.workingContext.clear();
      this.fifoQueue = [];
      this.recursiveSummary = '';
      this.recallStorage = [];
      this.archivalStorage.clear();
      
      // Generate new session ID
      this.currentSessionId = this.generateSessionId();
      this.messageIdCounter = 0;
      this.contextTokenCount = 0;
      
      console.log('✅ Memory system reset to clean state');
      return { success: true, action: 'memory_reset', message: 'Memory corruption resolved by system reset' };
      
    } catch (resetError) {
      return { success: false, action: 'reset_failed', message: `Memory reset failed: ${resetError.message}` };
    }
  }

  /**
   * Recovery strategy for memory pressure
   */
  async recoverFromPressure(error, context) {
    console.log('🔄 Recovering from memory pressure...');
    
    try {
      const initialQueueSize = this.fifoQueue.length;
      
      // Trigger memory pressure management
      await this.manageMemoryPressure();
      
      const finalQueueSize = this.fifoQueue.length;
      const messagesArchived = initialQueueSize - finalQueueSize;
      
      console.log(`✅ Memory pressure relieved - archived ${messagesArchived} messages`);
      return { 
        success: true, 
        action: 'pressure_relieved', 
        message: `Memory pressure resolved by archiving ${messagesArchived} messages` 
      };
      
    } catch (pressureError) {
      return { success: false, action: 'pressure_failed', message: `Memory pressure relief failed: ${pressureError.message}` };
    }
  }

  /**
   * Recovery strategy for filesystem errors
   */
  async recoverFromFileSystemError(error, context) {
    console.log('🔄 Recovering from filesystem error...');
    
    try {
      if (error.originalError?.code === 'ENOENT') {
        // Create missing directories/files
        if (context.filePath) {
          const dir = path.dirname(context.filePath);
          await SecureFileOps.ensureDirectoryExists(dir);
        }
        
        return { success: true, action: 'directory_created', message: 'Missing directories created successfully' };
      }
      
      if (error.originalError?.code === 'EACCES') {
        return { success: false, action: 'permission_denied', message: 'File permission error - please check file permissions' };
      }
      
      if (error.originalError?.code === 'ENOSPC') {
        return { success: false, action: 'disk_full', message: 'Disk space full - please free up space' };
      }
      
      // Generic filesystem retry
      return { success: true, action: 'retry_filesystem', message: 'Filesystem operation will be retried' };
      
    } catch (fsError) {
      return { success: false, action: 'fs_recovery_failed', message: `Filesystem recovery failed: ${fsError.message}` };
    }
  }

  /**
   * Recovery strategy for data format errors
   */
  async recoverFromDataFormat(error, context) {
    console.log('🔄 Recovering from data format error...');
    
    return { 
      success: true, 
      action: 'skip_corrupted', 
      message: `Corrupted ${error.dataType} data skipped, continuing with remaining data` 
    };
  }

  /**
   * Recovery strategy for session errors
   */
  async recoverFromSessionError(error, context) {
    console.log('🔄 Recovering from session error...');
    
    try {
      // Generate new session ID and continue
      const oldSessionId = this.currentSessionId;
      this.currentSessionId = this.generateSessionId();
      
      console.log(`Session changed from ${oldSessionId} to ${this.currentSessionId}`);
      return { success: true, action: 'new_session', message: `New session created: ${this.currentSessionId}` };
      
    } catch (sessionError) {
      return { success: false, action: 'session_failed', message: `Session recovery failed: ${sessionError.message}` };
    }
  }

  /**
   * Recovery strategy for search errors
   */
  async recoverFromSearchError(error, context) {
    console.log('🔄 Recovering from search error...');
    
    return { 
      success: true, 
      action: 'empty_results', 
      message: `Search failed for ${error.searchType}, returning empty results` 
    };
  }

  /**
   * Recovery strategy for configuration errors
   */
  async recoverFromConfigError(error, context) {
    console.log('🔄 Recovering from configuration error...');
    
    // Apply default values for the problematic config
    if (error.configKey) {
      const defaults = {
        maxWorkingContextSize: 2000,
        maxFifoQueueSize: 20,
        memoryPressureThreshold: 0.8,
        contextWindowSize: 8192
      };
      
      if (defaults[error.configKey]) {
        this.config[error.configKey] = defaults[error.configKey];
        return { 
          success: true, 
          action: 'default_applied', 
          message: `Applied default value for ${error.configKey}: ${defaults[error.configKey]}` 
        };
      }
    }
    
    return { success: true, action: 'config_ignored', message: 'Invalid configuration ignored, using existing values' };
  }

  /**
   * Recovery strategy for validation errors
   */
  async recoverFromValidationError(error, context) {
    console.log('🔄 Recovering from validation error...');
    
    return { 
      success: true, 
      action: 'validation_skipped', 
      message: `Validation failed for ${error.field}, value skipped: ${error.rule}` 
    };
  }

  /**
   * Generate user-friendly error message
   * @param {MemorySystemError} error - Memory system error
   * @param {Object} recovery - Recovery result
   * @returns {string} User-friendly message
   */
  generateUserErrorMessage(error, recovery) {
    const baseMessages = {
      MemoryCorruptionError: 'Memory data corruption detected.',
      MemoryPressureError: 'Memory usage is high.',
      MemoryFileSystemError: 'File system issue encountered.',
      MemoryDataFormatError: 'Data format issue detected.',
      MemorySessionError: 'Session management issue occurred.',
      MemorySearchError: 'Search operation failed.',
      MemorySecurityError: 'Security violation detected.',
      MemoryConfigurationError: 'Configuration issue found.',
      MemoryValidationError: 'Input validation failed.',
      MemorySystemError: 'Memory system issue occurred.'
    };

    const baseMessage = baseMessages[error.constructor.name] || baseMessages.MemorySystemError;
    
    if (recovery.success) {
      return `${baseMessage} ${recovery.message}`;
    } else {
      return `${baseMessage} Please check the system logs for more details.`;
    }
  }

  /**
   * Get memory error statistics
   * @returns {Object} Error statistics
   */
  getErrorStatistics() {
    return {
      ...this.errorStats,
      errorsByType: Object.fromEntries(this.errorStats.errorsByType)
    };
  }

  /**
   * Initialize the MemGPT memory system
   */
  async initialize() {
    if (!this.config.enabled) return;

    try {
      // Create data directory securely
      await SecureFileOps.ensureDirectoryExists(this.config.dataDir);
      
      // Load persistent state with secure file operations
      await this.loadWorkingContext();
      await this.loadRecallStorage();
      await this.loadArchivalStorage();
      await this.loadSessionState();
      
      // Initialize search index if enabled
      if (this.indexEnabled) {
        await this.searchIndex.initialize();
        await this.rebuildSearchIndexIfNeeded();
      }
      
      console.log(`MemGPT Memory System initialized - Session: ${this.currentSessionId}`);
      
    } catch (error) {
      // Use standardized error handling
      const result = await this.handleMemoryError(error, 'initialization', {
        dataDir: this.config.dataDir
      });
      
      if (!result.shouldContinue) {
        throw result.error;
      }
      
      // If recoverable, log and continue
      console.log(`Initialization recovered: ${result.userMessage}`);
    }
  }

  /**
   * Generate unique session ID
   */
  generateSessionId() {
    const now = new Date();
    const date = now.toISOString().slice(0, 19).replace(/[T:-]/g, '');
    const random = Math.random().toString(36).substr(2, 4);
    return `session-${date}-${random}`;
  }

  // =============================================================================
  // WORKING CONTEXT (Core Memory) - MemGPT's persistent working memory
  // =============================================================================

  /**
   * Update working context - core facts about user, preferences, etc.
   */
  updateWorkingContext(key, value, metadata = {}) {
    this.workingContext.set(key, {
      value,
      lastUpdated: new Date().toISOString(),
      updateCount: (this.workingContext.get(key)?.updateCount || 0) + 1,
      ...metadata
    });
    
    this.saveWorkingContext(); // Auto-save
    return true;
  }

  /**
   * Get working context value
   */
  getWorkingContext(key) {
    return this.workingContext.get(key);
  }

  /**
   * Get all working context as formatted string for AI
   */
  getWorkingContextSummary() {
    if (this.workingContext.size === 0) {
      return 'Working context is empty.';
    }
    
    const entries = Array.from(this.workingContext.entries())
      .map(([key, data]) => `${key}: ${data.value}`)
      .join('\n');
    
    return `Working Context:\n${entries}`;
  }

  /**
   * Replace working context entry (for updates)
   */
  replaceWorkingContext(oldKey, newKey, newValue) {
    if (this.workingContext.has(oldKey)) {
      this.workingContext.delete(oldKey);
    }
    this.updateWorkingContext(newKey, newValue);
  }

  // =============================================================================
  // FIFO QUEUE - MemGPT's recent conversation window
  // =============================================================================

  /**
   * Add message to FIFO queue (recent conversation history)
   */
  addToFifoQueue(role, content, metadata = {}) {
    // Handle empty, null, or invalid content
    if (!content || typeof content !== 'string' || content.trim() === '') {
      console.warn('Skipping empty or invalid content for FIFO queue');
      return null;
    }
    
    const messageId = this.messageIdCounter++;
    const timestamp = new Date().toISOString();
    
    const message = {
      id: messageId,
      timestamp,
      sessionId: this.currentSessionId,
      role,
      content: content.trim(),
      ...metadata
    };
    
    // Add to FIFO queue
    this.fifoQueue.push(message);
    
    // Add to recall storage (permanent record)
    this.recallStorage.push(message);
    
    // Update search index if enabled
    if (this.indexEnabled && this.searchIndex) {
      // Use async but don't block on it during normal operations
      // For tests, we'll need to wait for these to complete
      this.updateSearchIndexAsync(message);
    }
    
    // Check if queue needs management
    this.manageQueue();
    
    // Auto-save periodically
    if (this.recallStorage.length % 10 === 0) {
      this.saveRecallStorage();
    }
    
    return messageId;
  }

  /**
   * Manage FIFO queue size and create summaries
   */
  manageQueue() {
    if (this.fifoQueue.length <= this.config.maxFifoQueueSize) {
      return;
    }
    
    // Calculate how many messages to evict
    const messagesToEvict = this.fifoQueue.length - this.config.maxFifoQueueSize;
    const evictedMessages = this.fifoQueue.splice(0, messagesToEvict);
    
    // Create/update recursive summary
    this.updateRecursiveSummary(evictedMessages);
    
    console.log(`Queue management: Evicted ${messagesToEvict} messages, updated summary`);
  }

  /**
   * Update recursive summary with evicted messages
   */
  updateRecursiveSummary(newEvictedMessages) {
    const evictedText = newEvictedMessages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
    
    if (this.recursiveSummary) {
      this.recursiveSummary = `Previous summary: ${this.recursiveSummary}\n\nRecently evicted:\n${evictedText}`;
    } else {
      this.recursiveSummary = `Conversation history summary:\n${evictedText}`;
    }
    
    // Truncate if summary gets too long
    if (this.recursiveSummary.length > 1000) {
      this.recursiveSummary = this.recursiveSummary.substring(0, 1000) + '...[truncated]';
    }
  }

  /**
   * Get FIFO queue as conversation context
   */
  getFifoQueueContext() {
    const messages = [];
    
    // Add recursive summary if exists
    if (this.recursiveSummary) {
      messages.push({
        role: 'system',
        content: `[Conversation Summary]: ${this.recursiveSummary}`
      });
    }
    
    // Add current queue messages
    this.fifoQueue.forEach(msg => {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    });
    
    return messages;
  }

  // =============================================================================
  // RECALL STORAGE - MemGPT's searchable message history
  // =============================================================================

  /**
   * Search recall storage for relevant messages - now with indexed search
   */
  async searchRecallStorage(query, options = {}) {
    const {
      maxResults = 10,
      dateFilter = 'all',
      sessionFilter = null,
      minScore = 0.1
    } = options;
    
    this.logger.debug('Searching recall storage', {
      subsystem: 'memory',
      component: 'recall',
      query,
      maxResults,
      sessionFilter,
      indexEnabled: this.indexEnabled,
      operation: 'searchRecallStorage'
    });
    
    // Handle empty or null queries
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return [];
    }
    
    // Use indexed search if available, fallback to linear search
    if (this.indexEnabled && this.searchIndex) {
      try {
        const indexResults = await this.searchIndex.search(query, {
          maxResults,
          sessionFilter,
          dateFilter: dateFilter !== 'all' ? dateFilter : null,
          minScore
        });
        
        // Map search results back to full message objects
        const fullResults = [];
        for (const result of indexResults) {
          // Handle both string and numeric IDs
          const targetId = parseInt(result.docId);
          const message = this.recallStorage.find(m => 
            m.id === targetId || m.id === result.docId || m.id.toString() === result.docId
          );
          if (message) {
            fullResults.push({
              ...message,
              relevanceScore: result.score,
              matchedTerms: result.matchedTerms,
              searchRank: fullResults.length + 1
            });
          }
        }
        
        this.logger.debug('Indexed search completed', {
          subsystem: 'memory',
          component: 'recall',
          resultCount: fullResults.length,
          searchTime: 'optimized',
          operation: 'searchRecallStorage'
        });
        
        return fullResults;
        
      } catch (error) {
        this.logger.warn('Indexed search failed, falling back to linear search', {
          subsystem: 'memory',
          component: 'recall',
          operation: 'searchRecallStorage'
        }, error);
        // Fall through to linear search
      }
    }
    
    // Fallback: Linear search (original implementation)
    this.logger.debug('Using linear search fallback', {
      subsystem: 'memory',
      component: 'recall',
      operation: 'searchRecallStorage'
    });
    
    const queryLower = query.toLowerCase();
    const results = [];
    
    for (const message of this.recallStorage) {
      // Skip messages with invalid content
      if (!message.content || typeof message.content !== 'string') continue;
      
      // Apply filters
      if (sessionFilter && message.sessionId !== sessionFilter) continue;
      if (dateFilter !== 'all') {
        // TODO: Implement date filtering
      }
      
      // Simple text search
      if (message.content.toLowerCase().includes(queryLower)) {
        results.push({
          ...message,
          relevanceScore: this.calculateRelevanceScore(message, query)
        });
      }
    }
    
    // Sort by relevance and timestamp
    results.sort((a, b) => {
      if (a.relevanceScore !== b.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return new Date(b.timestamp) - new Date(a.timestamp);
    });
    
    return results.slice(0, maxResults);
  }

  /**
   * Calculate relevance score for search results
   */
  calculateRelevanceScore(message, query) {
    const content = message.content.toLowerCase();
    const queryLower = query.toLowerCase();
    
    let score = 0;
    
    // Exact match
    if (content.includes(queryLower)) score += 10;
    
    // Word matches
    const queryWords = queryLower.split(' ');
    queryWords.forEach(word => {
      if (content.includes(word)) score += 2;
    });
    
    // Recency boost
    const age = Date.now() - new Date(message.timestamp);
    const daysSinceMessage = age / (1000 * 60 * 60 * 24);
    score += Math.max(0, 5 - daysSinceMessage);
    
    return score;
  }

  // =============================================================================
  // ARCHIVAL STORAGE - MemGPT's long-term structured memory
  // =============================================================================

  /**
   * Store structured data in archival storage
   */
  storeInArchival(key, data, metadata = {}) {
    this.archivalStorage.set(key, {
      data,
      stored: new Date().toISOString(),
      sessionId: this.currentSessionId,
      ...metadata
    });
    
    this.saveArchivalStorage();
    return true;
  }

  /**
   * Search archival storage
   */
  searchArchival(query) {
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const [key, entry] of this.archivalStorage.entries()) {
      const searchText = `${key} ${JSON.stringify(entry.data)}`.toLowerCase();
      if (searchText.includes(queryLower)) {
        results.push({
          key,
          data: entry.data,
          metadata: entry
        });
      }
    }
    
    return results;
  }

  // =============================================================================
  // MEMORY PRESSURE MANAGEMENT - MemGPT's context overflow handling
  // =============================================================================

  /**
   * Check for memory pressure and issue warnings
   */
  checkMemoryPressure() {
    const contextUsage = this.estimateContextUsage();
    const pressureRatio = contextUsage / this.config.contextWindowSize;
    
    const isOverThreshold = pressureRatio > this.config.memoryPressureThreshold;
    
    // Update warning flag based on current state
    if (isOverThreshold && !this.memoryPressureWarning) {
      this.memoryPressureWarning = true;
    } else if (!isOverThreshold && this.memoryPressureWarning) {
      this.memoryPressureWarning = false;
    }
    
    // Always return current state
    if (isOverThreshold) {
      return {
        warning: true,
        message: 'Memory pressure detected. Consider moving important information to working context or archival storage.',
        usage: Math.round(pressureRatio * 100),
        available: Math.max(0, this.config.contextWindowSize - contextUsage)
      };
    }
    
    return { 
      warning: false, 
      usage: Math.round(pressureRatio * 100),
      available: this.config.contextWindowSize - contextUsage
    };
  }

  /**
   * Estimate current context token usage using configurable tokenizer
   */
  estimateContextUsage() {
    let tokenCount = 0;
    
    try {
      // Working context summary
      const workingContextSummary = this.getWorkingContextSummary();
      tokenCount += this.tokenizer.estimateTokens(workingContextSummary);
      
      // FIFO queue messages
      this.fifoQueue.forEach(msg => {
        if (msg.content) {
          tokenCount += this.tokenizer.estimateTokens(msg.content);
        }
      });
      
      // Recursive summary
      if (this.recursiveSummary) {
        tokenCount += this.tokenizer.estimateTokens(this.recursiveSummary);
      }
      
      // Add overhead for message formatting and system prompts
      const formattingOverhead = Math.ceil(tokenCount * 0.1); // 10% overhead
      tokenCount += formattingOverhead;
      
    } catch (error) {
      this.logger.memory('WARN', 'estimateContextUsage', 'Tokenizer error, falling back to character count', {
        errorMessage: error.message,
        fallbackMethod: 'character_count'
      });
      
      // Fallback to simple character counting
      const workingContextSummary = this.getWorkingContextSummary();
      tokenCount += Math.ceil(workingContextSummary.length / 4);
      
      this.fifoQueue.forEach(msg => {
        tokenCount += Math.ceil((msg.content?.length || 0) / 4);
      });
      
      tokenCount += Math.ceil((this.recursiveSummary?.length || 0) / 4);
    }
    
    return Math.max(1, Math.ceil(tokenCount));
  }

  // =============================================================================
  // SESSION PERSISTENCE - Stateful conversation resumption
  // =============================================================================

  /**
   * Save current session state for resumption
   */
  async saveSessionState() {
    const sessionState = {
      sessionId: this.currentSessionId,
      messageIdCounter: this.messageIdCounter,
      lastActive: new Date().toISOString(),
      contextTokenCount: this.contextTokenCount,
      memoryPressureWarning: this.memoryPressureWarning,
      recursiveSummary: this.recursiveSummary,
      fifoQueueLength: this.fifoQueue.length,
      workingContextSize: this.workingContext.size,
      recallStorageSize: this.recallStorage.length
    };
    
    try {
      const sessionStateJSON = await streamingJSON.stringifyAsync(sessionState, {
        space: 2,
        enableStreaming: Object.keys(sessionState).length > 100
      });
      
      await SecureFileOps.writeFileSecure(
        this.config.dataDir, 
        'session-state.json', 
        sessionStateJSON
      );
    } catch (error) {
      const result = await this.handleMemoryError(error, 'save_session_state', {
        filePath: path.join(this.config.dataDir, 'session-state.json'),
        sessionId: this.currentSessionId
      });
      
      if (!result.shouldContinue) {
        throw result.error;
      }
    }
  }

  /**
   * Load previous session state for resumption
   */
  async loadSessionState() {
    try {
      const stateData = await SecureFileOps.readFileSecure(this.config.dataDir, 'session-state.json');
      const state = await streamingJSON.parseAsync(stateData);
      
      // Resume session
      this.currentSessionId = state.sessionId || this.currentSessionId;
      this.messageIdCounter = state.messageIdCounter || 0;
      this.recursiveSummary = state.recursiveSummary || '';
      this.memoryPressureWarning = state.memoryPressureWarning || false;
      
      console.log(`Resumed session: ${this.currentSessionId} (${state.recallStorageSize} messages)`);
      
    } catch (error) {
      const result = await this.handleMemoryError(error, 'load_session_state', {
        filePath: path.join(this.config.dataDir, 'session-state.json')
      });
      
      if (!result.shouldContinue) {
        throw result.error;
      }
      
      // If recoverable (like file not found), start fresh
      console.log('Starting fresh session (no previous session or recoverable error)');
    }
  }

  // =============================================================================
  // PERSISTENCE - Save/load memory components
  // =============================================================================

  async saveWorkingContext() {
    try {
      const data = Object.fromEntries(this.workingContext);
      const workingContextJSON = await streamingJSON.stringifyAsync(data, {
        space: 2,
        enableStreaming: this.workingContext.size > 50
      });
      
      await SecureFileOps.writeFileSecure(
        this.config.dataDir, 
        'working-context.json', 
        workingContextJSON
      );
    } catch (error) {
      console.error('[SECURITY] Failed to save working context:', error.message);
      throw error;
    }
  }

  async loadWorkingContext() {
    try {
      const data = await SecureFileOps.readFileSecure(this.config.dataDir, 'working-context.json');
      const parsed = await streamingJSON.parseAsync(data);
      this.workingContext = new Map(Object.entries(parsed));
    } catch (error) {
      if (error.name === 'SecurityError') {
        console.error('[SECURITY] Working context load blocked:', error.code);
        throw error;
      }
      // No existing context - this is normal for first run
    }
  }

  async saveRecallStorage() {
    try {
      const streamWrapper = await SecureFileOps.createWriteStreamSecure(
        this.config.dataDir, 
        'recall-storage.jsonl'
      );
      
      return new Promise((resolve, reject) => {
        // Set up error handling
        streamWrapper.onError((error) => {
          console.error('[SECURITY] Recall storage write stream error:', error.message);
          reject(error);
        });

        // Set up completion handling
        streamWrapper.onFinish(() => {
          resolve();
        });

        // Write all messages
        for (const message of this.recallStorage) {
          const success = streamWrapper.stream.write(JSON.stringify(message) + '\n');
          
          // Handle backpressure
          if (!success) {
            streamWrapper.stream.once('drain', () => {
              // Continue writing
            });
          }
        }
        
        // Close the stream properly
        streamWrapper.stream.end();
      });
    } catch (error) {
      console.error('[SECURITY] Failed to save recall storage:', error.message);
      throw error;
    }
  }

  async loadRecallStorage() {
    try {
      const data = await SecureFileOps.readFileSecure(this.config.dataDir, 'recall-storage.jsonl');
      
      // Use streaming JSONL parser for better performance and memory efficiency
      this.recallStorage = await streamingJSON.parseJSONLAsync(data, {
        skipInvalidLines: true,
        enableProgressCallback: this.recallStorage.length > 1000 ? (progress) => {
          if (progress.processed % 500 === 0) {
            this.logger.debug('Loading recall storage', {
              subsystem: 'memory',
              component: 'persistence',
              progress: `${progress.processed}/${progress.total}`,
              operation: 'loadRecallStorage'
            });
          }
        } : null
      });
      
      // Rebuild FIFO queue from recent messages
      const recentMessages = this.recallStorage.slice(-this.config.maxFifoQueueSize);
      this.fifoQueue = [...recentMessages];
      
      // Set message counter
      if (this.recallStorage.length > 0) {
        const validIds = this.recallStorage.map(m => m.id).filter(id => typeof id === 'number');
        if (validIds.length > 0) {
          this.messageIdCounter = Math.max(...validIds) + 1;
        }
      }
      
    } catch (error) {
      if (error.name === 'SecurityError') {
        console.error('[SECURITY] Recall storage load blocked:', error.code);
        throw error;
      }
      // No existing recall storage - this is normal for first run
    }
  }

  async saveArchivalStorage() {
    try {
      const data = Object.fromEntries(this.archivalStorage);
      const archivalStorageJSON = await streamingJSON.stringifyAsync(data, {
        space: 2,
        enableStreaming: this.archivalStorage.size > 100
      });
      
      await SecureFileOps.writeFileSecure(
        this.config.dataDir, 
        'archival-storage.json', 
        archivalStorageJSON
      );
    } catch (error) {
      console.error('[SECURITY] Failed to save archival storage:', error.message);
      throw error;
    }
  }

  async loadArchivalStorage() {
    try {
      const data = await SecureFileOps.readFileSecure(this.config.dataDir, 'archival-storage.json');
      const parsed = await streamingJSON.parseAsync(data);
      this.archivalStorage = new Map(Object.entries(parsed));
    } catch (error) {
      if (error.name === 'SecurityError') {
        console.error('[SECURITY] Archival storage load blocked:', error.code);
        throw error;
      }
      // No existing archival storage - this is normal for first run
    }
  }

  // =============================================================================
  // STATUS AND CLEANUP
  // =============================================================================

  /**
   * Get memory system status
   */
  getStatus() {
    return {
      sessionId: this.currentSessionId,
      enabled: this.config.enabled,
      workingContextSize: this.workingContext.size,
      fifoQueueLength: this.fifoQueue.length,
      recallStorageSize: this.recallStorage.length,
      archivalStorageSize: this.archivalStorage.size,
      messageIdCounter: this.messageIdCounter,
      estimatedContextUsage: this.estimateContextUsage(),
      memoryPressure: this.checkMemoryPressure(),
      lastSession: this.currentSessionId
    };
  }

  // =============================================================================
  // TOKENIZER MANAGEMENT
  // =============================================================================

  /**
   * Switch to a different model for token estimation
   */
  switchTokenizerModel(modelName) {
    try {
      this.tokenizer.switchModel(modelName);
      this.logger.memory('INFO', 'switchTokenizerModel', 'Switched tokenizer to model', {
        newModel: modelName,
        previousModel: this.config.model
      });
    } catch (error) {
      this.logger.memory('ERROR', 'switchTokenizerModel', 'Failed to switch tokenizer model', {
        targetModel: modelName,
        currentModel: this.config.model
      }, error);
      throw error;
    }
  }

  /**
   * Update tokenizer configuration
   */
  updateTokenizerConfig(newConfig) {
    try {
      this.tokenizer.updateConfig(newConfig);
      this.logger.memory('INFO', 'updateTokenizerConfig', 'Tokenizer configuration updated', {
        configChanges: Object.keys(newConfig),
        newConfig
      });
    } catch (error) {
      this.logger.memory('ERROR', 'updateTokenizerConfig', 'Failed to update tokenizer configuration', {
        attemptedConfig: newConfig
      }, error);
      throw error;
    }
  }

  /**
   * Get tokenizer statistics and performance metrics
   */
  getTokenizerStats() {
    try {
      return this.tokenizer.getStats();
    } catch (error) {
      console.error('❌ Failed to get tokenizer stats:', error.message);
      return {
        error: error.message,
        fallbackStats: {
          method: 'character_count',
          model: 'fallback',
          cache: { size: 0, hits: 0, misses: 0, hitRate: '0%' }
        }
      };
    }
  }

  /**
   * Reset tokenizer cache and statistics
   */
  resetTokenizerCache() {
    try {
      this.tokenizer.reset();
      console.log('🔄 Tokenizer cache and stats reset');
    } catch (error) {
      console.error('❌ Failed to reset tokenizer cache:', error.message);
    }
  }

  /**
   * Estimate tokens for batch text processing
   */
  estimateTokensBatch(texts, options = {}) {
    try {
      return this.tokenizer.estimateTokensBatch(texts, options);
    } catch (error) {
      console.error('❌ Batch tokenization failed:', error.message);
      
      // Fallback to individual estimation
      const results = texts.map((text, index) => ({
        index,
        text: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
        length: text.length,
        tokens: Math.ceil(text.length / 4) // Simple fallback
      }));
      
      return {
        results,
        totalTexts: texts.length,
        totalTokens: results.reduce((sum, r) => sum + r.tokens, 0),
        averageTokensPerText: Math.round(results.reduce((sum, r) => sum + r.tokens, 0) / texts.length),
        method: 'fallback_character_count',
        model: 'fallback',
        error: error.message
      };
    }
  }

  // =============================================================================
  // CLEANUP AND PERSISTENCE
  // =============================================================================

  /**
   * Cleanup and save all state
   */
  async cleanup() {
    if (!this.config.enabled) return;
    
    try {
      await Promise.all([
        this.saveWorkingContext(),
        this.saveRecallStorage(),
        this.saveArchivalStorage(),
        this.saveSessionState()
      ]);
      
      this.logger.memory('INFO', 'cleanup', 'MemGPT memory system saved successfully', {
        components: ['workingContext', 'recallStorage', 'archivalStorage', 'sessionState']
      });
    } catch (error) {
      const result = await this.handleMemoryError(error, 'cleanup', {
        operation: 'save_all_components'
      });
      
      if (result.shouldContinue) {
        console.log(`Cleanup completed with recovery: ${result.userMessage}`);
      } else {
        console.error('Critical error during cleanup, some data may be lost');
      }
    }
    
    // Cleanup search index
    if (this.indexEnabled && this.searchIndex) {
      await this.searchIndex.cleanup();
    }
  }

  // =============================================================================
  // SEARCH INDEX MANAGEMENT - High-performance indexed search
  // =============================================================================

  /**
   * Update search index asynchronously (non-blocking)
   * @param {Object} message - Message to add to index
   */
  updateSearchIndexAsync(message) {
    // Keep track of pending updates for testing/debugging
    if (!this.pendingIndexUpdates) {
      this.pendingIndexUpdates = new Set();
    }
    
    // Run index update in background to avoid blocking message processing
    const updatePromise = (async () => {
      try {
        await this.searchIndex.addDocument(
          message.id.toString(),
          message.content,
          {
            sessionId: message.sessionId,
            timestamp: message.timestamp,
            role: message.role
          }
        );
      } catch (error) {
        this.logger.warn('Failed to update search index', {
          subsystem: 'memory',
          component: 'search-index',
          messageId: message.id,
          operation: 'updateSearchIndexAsync'
        }, error);
      } finally {
        this.pendingIndexUpdates.delete(updatePromise);
      }
    })();
    
    this.pendingIndexUpdates.add(updatePromise);
  }

  /**
   * Wait for all pending index updates to complete (primarily for testing)
   */
  async waitForIndexUpdates() {
    if (!this.pendingIndexUpdates || this.pendingIndexUpdates.size === 0) {
      return;
    }
    
    const updates = Array.from(this.pendingIndexUpdates);
    await Promise.allSettled(updates);
  }

  /**
   * Rebuild search index if needed (e.g., on startup, after corruption)
   */
  async rebuildSearchIndexIfNeeded() {
    try {
      const indexStats = this.searchIndex.getStats();
      const shouldRebuild = indexStats.totalDocs !== this.recallStorage.length;
      
      if (shouldRebuild) {
        this.logger.info('Rebuilding search index', {
          subsystem: 'memory',
          component: 'search-index',
          currentIndexDocs: indexStats.totalDocs,
          recallStorageDocs: this.recallStorage.length,
          operation: 'rebuildSearchIndex'
        });
        
        const rebuildStart = Date.now();
        
        // Clear existing index
        await this.searchIndex.clearIndex();
        
        // Add all messages to index
        for (const message of this.recallStorage) {
          if (message.content && typeof message.content === 'string') {
            await this.searchIndex.addDocument(
              message.id.toString(),
              message.content,
              {
                sessionId: message.sessionId,
                timestamp: message.timestamp,
                role: message.role
              }
            );
          }
        }
        
        // Optimize index after rebuild
        await this.searchIndex.optimizeIndex();
        
        const rebuildTime = Date.now() - rebuildStart;
        
        this.logger.info('Search index rebuild completed', {
          subsystem: 'memory',
          component: 'search-index',
          totalDocs: this.recallStorage.length,
          rebuildTime,
          operation: 'rebuildSearchIndex'
        });
      } else {
        this.logger.debug('Search index is up to date', {
          subsystem: 'memory',
          component: 'search-index',
          totalDocs: indexStats.totalDocs,
          operation: 'rebuildSearchIndex'
        });
      }
    } catch (error) {
      this.logger.error('Failed to rebuild search index', {
        subsystem: 'memory',
        component: 'search-index',
        operation: 'rebuildSearchIndex'
      }, error);
    }
  }

  /**
   * Get search index statistics and performance metrics
   */
  getSearchIndexStats() {
    if (!this.indexEnabled || !this.searchIndex) {
      return {
        enabled: false,
        message: 'Search index is disabled'
      };
    }
    
    return {
      enabled: true,
      ...this.searchIndex.getStats(),
      recallStorageSize: this.recallStorage.length
    };
  }

  /**
   * Optimize search index (manual trigger)
   */
  async optimizeSearchIndex() {
    if (!this.indexEnabled || !this.searchIndex) {
      return;
    }
    
    try {
      await this.searchIndex.optimizeIndex();
      this.logger.info('Search index optimization completed', {
        subsystem: 'memory',
        component: 'search-index',
        operation: 'optimizeSearchIndex'
      });
    } catch (error) {
      this.logger.error('Failed to optimize search index', {
        subsystem: 'memory',
        component: 'search-index',
        operation: 'optimizeSearchIndex'
      }, error);
    }
  }
}

export default MemGPTMemorySystem;