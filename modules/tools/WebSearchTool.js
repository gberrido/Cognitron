#!/usr/bin/env node

/**
 * Web Search Tool - Handles web searching capabilities
 * Extracted from cognitron04.js for better modularity
 */

import https from 'https';
import { URL } from 'url';

export class WebSearchTool {
  constructor(config = {}) {
    this.config = {
      apiUrl: config.apiUrl || 'https://api.duckduckgo.com/',
      userAgent: config.userAgent || 'Cognitron AI Assistant/1.0.4',
      timeout: config.timeout || 10000,
      maxResults: config.maxResults || 5,
      ...config
    };
  }

  /**
   * Get tool definition for the AI agent
   */
  getToolDefinition() {
    return {
      type: 'function',
      function: {
        name: 'search_web',
        description: 'Search the web for current information, news, facts, or any topic. Use when user asks about recent events, current information, or anything that requires up-to-date data.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'The search query to look up on the web'
            },
            max_results: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              description: 'Maximum number of search results to return (default: 5)'
            }
          },
          required: ['query']
        }
      }
    };
  }

  /**
   * Execute web search
   */
  async execute(args) {
    const { query, max_results = this.config.maxResults } = args;
    
    if (!query || typeof query !== 'string') {
      return {
        success: false,
        error: 'Invalid query parameter'
      };
    }

    try {
      const results = await this.searchWeb(query, max_results);
      
      return {
        success: results && results.length > 0 && results[0].type !== 'error',
        message: results && results.length > 0 && results[0].type !== 'error' 
          ? `Found ${results.length} web result${results.length === 1 ? '' : 's'}`
          : 'No web results found',
        results,
        query,
        count: results ? results.length : 0
      };
    } catch (error) {
      return {
        success: false,
        message: `Web search failed: ${error.message}`,
        error: error.message,
        query
      };
    }
  }

  /**
   * Perform web search using DuckDuckGo instant answer API
   */
  async searchWeb(query, maxResults = 5) {
    try {
      const encodedQuery = encodeURIComponent(query);
      const url = `${this.config.apiUrl}?q=${encodedQuery}&format=json&no_html=1&skip_disambig=1`;
      
      return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const options = {
          hostname: urlObj.hostname,
          path: urlObj.pathname + urlObj.search,
          method: 'GET',
          headers: {
            'User-Agent': this.config.userAgent
          }
        };
        
        const req = https.request(options, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            try {
              const result = JSON.parse(data);
              const searchResults = this.parseSearchResults(result, maxResults, query);
              resolve(searchResults);
            } catch (parseError) {
              reject(new Error(`Failed to parse search results: ${parseError.message}`));
            }
          });
        });
        
        req.on('error', (error) => {
          reject(new Error(`Web search failed: ${error.message}`));
        });
        
        req.setTimeout(this.config.timeout, () => {
          req.abort();
          reject(new Error('Web search timed out'));
        });
        
        req.end();
      });
    } catch (error) {
      return [{
        title: 'Search Error',
        snippet: `Unable to perform web search: ${error.message}`,
        url: '',
        source: 'Error',
        type: 'error'
      }];
    }
  }

  /**
   * Parse DuckDuckGo API response into structured results
   */
  parseSearchResults(result, maxResults, query) {
    const searchResults = [];
    
    // Add instant answer if available
    if (result.Abstract && result.Abstract.trim()) {
      searchResults.push({
        title: result.Heading || 'Instant Answer',
        snippet: result.Abstract,
        url: result.AbstractURL || '',
        source: result.AbstractSource || 'DuckDuckGo',
        type: 'instant_answer'
      });
    }
    
    // Add definition if available
    if (result.Definition && result.Definition.trim()) {
      searchResults.push({
        title: 'Definition',
        snippet: result.Definition,
        url: result.DefinitionURL || '',
        source: result.DefinitionSource || 'Dictionary',
        type: 'definition'
      });
    }
    
    // Add answer if available
    if (result.Answer && result.Answer.trim()) {
      searchResults.push({
        title: 'Answer',
        snippet: result.Answer,
        url: result.AnswerURL || '',
        source: 'DuckDuckGo',
        type: 'answer'
      });
    }
    
    // Add related topics
    if (result.RelatedTopics && result.RelatedTopics.length > 0) {
      result.RelatedTopics.slice(0, Math.min(3, maxResults - searchResults.length)).forEach(topic => {
        if (topic.Text && topic.Text.trim()) {
          searchResults.push({
            title: topic.Text.split(' - ')[0] || 'Related Topic',
            snippet: topic.Text,
            url: topic.FirstURL || '',
            source: 'DuckDuckGo',
            type: 'related_topic'
          });
        }
      });
    }
    
    // If no results, create a basic response
    if (searchResults.length === 0) {
      searchResults.push({
        title: 'Search Query',
        snippet: `Searched for: "${query || 'unknown'}". Try refining your search terms or being more specific.`,
        url: '',
        source: 'DuckDuckGo',
        type: 'no_results'
      });
    }
    
    return searchResults.slice(0, maxResults);
  }

  /**
   * Format search results for display
   */
  formatResults(results) {
    if (!results || results.length === 0) {
      return 'No search results found.';
    }

    return results.map((result, idx) => {
      let formatted = `${idx + 1}. [${result.source}] ${result.title}\n`;
      formatted += `   ${result.snippet}`;
      if (result.url) {
        formatted += `\n   URL: ${result.url}`;
      }
      return formatted;
    }).join('\n\n');
  }
}

export default WebSearchTool;