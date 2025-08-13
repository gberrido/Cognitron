#!/usr/bin/env node

/**
 * Memory System - Handles conversation persistence and search
 * Extracted from cognitron03.js for better modularity
 */

import fs from 'fs/promises';
import { createWriteStream, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class MemorySystem {
  constructor(config = {}) {
    this.config = {
      conversationsDir: config.conversationsDir || path.join(process.cwd(), 'conversations'),
      enabled: config.enabled !== false,
      maxConversationDays: config.maxConversationDays || 30,
      indexRebuildThreshold: config.indexRebuildThreshold || 100,
      ...config
    };

    // Initialize state
    this.searchIndex = { terms: {}, sessions: {}, recent: [], topics: {} };
    this.userPatterns = { preferences: {}, expertise: {}, behavior: {} };
    this.messageIdCounter = 0;
    this.currentSessionId = this.generateSessionId();
  }

  /**
   * Initialize the memory system
   */
  async initialize() {
    if (!this.config.enabled) return;

    try {
      // Create conversations directory if it doesn't exist
      await fs.mkdir(this.config.conversationsDir, { recursive: true });
      
      // Load search index
      await this.loadSearchIndex();
      
      // Load user patterns
      await this.loadUserPatterns();
      
      // Set message ID counter
      this.initializeMessageCounter();
      
    } catch (error) {
      console.error('Error initializing memory system:', error.message);
    }
  }

  /**
   * Generates a unique session ID
   */
  generateSessionId() {
    const now = new Date();
    const date = now.toISOString().slice(0, 19).replace(/[T:-]/g, '');
    const random = Math.random().toString(36).substr(2, 4);
    return `${date}-${random}`;
  }

  /**
   * Gets the current date in YYYY-MM-DD format
   */
  getCurrentDateString() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Gets the path to the conversation file for a given date
   */
  getConversationFilePath(dateString = this.getCurrentDateString()) {
    return path.join(this.config.conversationsDir, `${dateString}.jsonl`);
  }

  /**
   * Gets the path to the search index file
   */
  getSearchIndexPath() {
    return path.join(this.config.conversationsDir, 'search-index.json');
  }

  /**
   * Gets the path to the user patterns file
   */
  getUserPatternsPath() {
    return path.join(this.config.conversationsDir, 'user-patterns.json');
  }

  /**
   * Load search index from file
   */
  async loadSearchIndex() {
    try {
      const indexData = await fs.readFile(this.getSearchIndexPath(), 'utf-8');
      this.searchIndex = JSON.parse(indexData);
    } catch (error) {
      // Index doesn't exist, start with empty index
      this.searchIndex = { terms: {}, sessions: {}, recent: [], topics: {} };
    }
  }

  /**
   * Load user patterns from file
   */
  async loadUserPatterns() {
    try {
      const patternsData = await fs.readFile(this.getUserPatternsPath(), 'utf-8');
      this.userPatterns = JSON.parse(patternsData);
    } catch (error) {
      // Patterns don't exist, start with empty patterns
      this.userPatterns = { preferences: {}, expertise: {}, behavior: {} };
    }
  }

  /**
   * Initialize message ID counter from existing data
   */
  initializeMessageCounter() {
    // Set message ID counter from recent messages and indexed terms
    if (this.searchIndex.recent && this.searchIndex.recent.length > 0) {
      this.messageIdCounter = Math.max(...this.searchIndex.recent) + 1;
    }
    
    // Also check all indexed terms for the highest message ID
    const allMessageIds = [];
    Object.values(this.searchIndex.terms).forEach(ids => allMessageIds.push(...ids));
    if (allMessageIds.length > 0) {
      this.messageIdCounter = Math.max(this.messageIdCounter, Math.max(...allMessageIds) + 1);
    }
  }

  /**
   * Log a conversation message to JSONL file
   */
  async logConversationMessage(role, content, metadata = {}) {
    if (!this.config.enabled) return;
    
    try {
      const messageId = this.messageIdCounter++;
      const timestamp = new Date().toISOString();
      const conversationFile = this.getConversationFilePath();
      
      const logEntry = {
        id: messageId,
        timestamp,
        session: this.currentSessionId,
        role,
        content,
        ...metadata
      };
      
      // Append to JSONL file
      const writeStream = createWriteStream(conversationFile, { flags: 'a' });
      writeStream.write(JSON.stringify(logEntry) + '\n');
      writeStream.end();
      
      // Update search index
      await this.updateSearchIndex(logEntry);
      
      return messageId;
    } catch (error) {
      console.error('Error logging conversation message:', error.message);
      return null;
    }
  }

  /**
   * Update the search index with a new message
   */
  async updateSearchIndex(logEntry) {
    try {
      const { id, content, timestamp, session } = logEntry;
      
      // Extract keywords from content (simple tokenization)
      if (!content || typeof content !== 'string') {
        console.warn('Invalid content for search indexing:', content);
        return;
      }
      
      const words = content.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2); // Filter out short words
      
      // Update terms index
      words.forEach(word => {
        if (!this.searchIndex.terms[word]) {
          this.searchIndex.terms[word] = [];
        }
        if (!this.searchIndex.terms[word].includes(id)) {
          this.searchIndex.terms[word].push(id);
        }
      });
      
      // Update sessions index
      if (!this.searchIndex.sessions[session]) {
        this.searchIndex.sessions[session] = {
          start: timestamp,
          messages: [],
          file: this.getCurrentDateString()
        };
      }
      this.searchIndex.sessions[session].messages.push(id);
      
      // Update recent messages (keep last 100)
      this.searchIndex.recent.push(id);
      if (this.searchIndex.recent.length > 100) {
        this.searchIndex.recent = this.searchIndex.recent.slice(-100);
      }
      
      // Save index frequently for testing, less frequently in production
      if (id % 2 === 0) { // Save every 2 messages for now
        await this.saveSearchIndex();
      }
      
    } catch (error) {
      console.error('Error updating search index:', error.message);
    }
  }

  /**
   * Save the search index to file
   */
  async saveSearchIndex() {
    try {
      await fs.writeFile(this.getSearchIndexPath(), JSON.stringify(this.searchIndex, null, 2));
    } catch (error) {
      console.error('Error saving search index:', error.message);
    }
  }

  /**
   * Save user patterns to file
   */
  async saveUserPatterns() {
    try {
      await fs.writeFile(this.getUserPatternsPath(), JSON.stringify(this.userPatterns, null, 2));
    } catch (error) {
      console.error('Error saving user patterns:', error.message);
    }
  }

  /**
   * Search conversation history based on query
   */
  async searchConversationHistory(query, options = {}) {
    const { date_filter = 'all', max_results = 5 } = options;
    
    try {
      // Get candidate message IDs from index
      const queryWords = query.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2);
      
      const candidateIds = new Set();
      
      // Find messages containing query words
      queryWords.forEach(word => {
        if (this.searchIndex.terms[word]) {
          this.searchIndex.terms[word].forEach(id => candidateIds.add(id));
        }
      });
      
      if (candidateIds.size === 0) {
        return [];
      }
      
      // Load and filter messages
      const results = await this.loadMessagesById([...candidateIds]);
      
      // Apply date filter
      const filteredResults = results.filter(msg => {
        if (!msg || !msg.timestamp) return false;
        
        const msgDate = new Date(msg.timestamp);
        const now = new Date();
        
        switch (date_filter) {
          case 'today':
            return msgDate.toDateString() === now.toDateString();
          case 'yesterday':
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            return msgDate.toDateString() === yesterday.toDateString();
          case 'week':
            const weekAgo = new Date(now);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return msgDate >= weekAgo;
          case 'month':
            const monthAgo = new Date(now);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return msgDate >= monthAgo;
          default:
            return true;
        }
      });
      
      // Score and sort results
      const scoredResults = filteredResults.map(msg => {
        let score = 0;
        const content = msg.content.toLowerCase();
        
        // Score based on exact query matches
        if (content.includes(query.toLowerCase())) {
          score += 10;
        }
        
        // Score based on individual word matches
        queryWords.forEach(word => {
          if (content.includes(word)) {
            score += 2;
          }
        });
        
        // Boost recent messages
        const age = (Date.now() - new Date(msg.timestamp).getTime()) / (1000 * 60 * 60 * 24);
        score += Math.max(0, 5 - age); // Boost messages from last 5 days
        
        return { ...msg, score };
      });
      
      // Sort by score and return top results
      return scoredResults
        .sort((a, b) => b.score - a.score)
        .slice(0, max_results);
        
    } catch (error) {
      console.error('Error searching conversation history:', error.message);
      return [];
    }
  }

  /**
   * Load messages by their IDs from JSONL files
   */
  async loadMessagesById(messageIds) {
    const messages = [];
    
    try {
      // Check all available JSONL files
      const files = await fs.readdir(this.config.conversationsDir);
      const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
      
      for (const file of jsonlFiles) {
        const filePath = path.join(this.config.conversationsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          try {
            const message = JSON.parse(line);
            if (messageIds.includes(message.id)) {
              messages.push(message);
            }
          } catch (parseError) {
            // Skip malformed lines
            continue;
          }
        }
      }
      
      return messages;
    } catch (error) {
      console.error('Error loading messages by ID:', error.message);
      return [];
    }
  }

  /**
   * Get memory system status
   */
  getStatus() {
    return {
      enabled: this.config.enabled,
      sessionId: this.currentSessionId,
      conversationsDir: this.config.conversationsDir,
      totalIndexedTerms: Object.keys(this.searchIndex.terms).length,
      totalSessions: Object.keys(this.searchIndex.sessions).length,
      recentMessages: this.searchIndex.recent.length,
      messageIdCounter: this.messageIdCounter
    };
  }

  /**
   * Cleanup method to save state before shutdown
   */
  async cleanup() {
    if (!this.config.enabled) return;
    
    try {
      await this.saveSearchIndex();
      await this.saveUserPatterns();
    } catch (error) {
      console.error('Error during memory system cleanup:', error.message);
    }
  }
}

export default MemorySystem;