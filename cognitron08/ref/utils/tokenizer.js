/**
 * Token counting utilities for context management
 *
 * This module provides token estimation for LLM context budgeting.
 * Uses a word-based approximation that's more accurate than char/4.
 *
 * For production use with real API token limits, consider using:
 * - @dqbd/tiktoken for OpenAI models
 * - gpt-tokenizer for a lighter alternative
 */

/**
 * Estimate token count using improved heuristics
 * Based on empirical observations:
 * - Average English word ≈ 1.3 tokens
 * - Numbers and special chars add overhead
 * - Whitespace doesn't count
 *
 * @param {string} text - Text to count tokens for
 * @returns {number} Estimated token count
 */
export function countTokens(text) {
  if (!text || typeof text !== 'string') return 0;

  const str = String(text);

  // Handle empty or whitespace-only strings
  if (str.trim().length === 0) return 0;

  // Count different character types for better estimation
  let tokens = 0;

  // Split into words (including punctuation as separate tokens)
  const words = str.match(/\w+|[^\w\s]/g) || [];

  for (const word of words) {
    if (/^\d+$/.test(word)) {
      // Numbers: each digit group is ~1 token, longer numbers can be multiple
      tokens += Math.ceil(word.length / 3);
    } else if (/^[^\w\s]$/.test(word)) {
      // Punctuation and symbols: usually 1 token each
      tokens += 1;
    } else {
      // Regular words: ~1.3 tokens per word on average
      // Longer words tend to be split into multiple tokens
      if (word.length <= 4) {
        tokens += 1;
      } else if (word.length <= 8) {
        tokens += 1.5;
      } else {
        tokens += Math.ceil(word.length / 4);
      }
    }
  }

  return Math.ceil(tokens);
}

/**
 * Count tokens in an array of messages
 * Includes overhead for message formatting (role, separators, etc.)
 *
 * @param {Array<{role: string, content: string}>} messages - Chat messages
 * @returns {number} Total estimated tokens
 */
export function countMessageTokens(messages) {
  if (!Array.isArray(messages)) return 0;

  return messages.reduce((total, msg) => {
    // Base content tokens
    const contentTokens = countTokens(msg.content || '');

    // Message overhead: role name, separators, formatting
    // Typical overhead: ~4 tokens per message
    const overhead = 4;

    // Tool call messages have additional overhead
    const toolOverhead = msg.tool_call_id ? 2 : 0;

    return total + contentTokens + overhead + toolOverhead;
  }, 0);
}

/**
 * Count tokens with a simple character-based fallback
 * Used when word-based counting isn't suitable
 *
 * @param {string} text - Text to count
 * @returns {number} Estimated tokens (char/4)
 */
export function countTokensSimple(text) {
  if (!text) return 0;
  return Math.ceil(String(text).length / 4);
}

/**
 * Get detailed token statistics for debugging
 *
 * @param {string} text - Text to analyze
 * @returns {Object} Token statistics
 */
export function getTokenStats(text) {
  if (!text) {
    return { tokens: 0, chars: 0, words: 0, avgTokensPerWord: 0 };
  }

  const str = String(text);
  const chars = str.length;
  const words = (str.match(/\w+/g) || []).length;
  const tokens = countTokens(str);

  return {
    tokens,
    chars,
    words,
    avgTokensPerWord: words > 0 ? tokens / words : 0,
    estimatedAccuracy: '±15%'
  };
}

/**
 * Check if token count exceeds a limit with a safety margin
 *
 * @param {string} text - Text to check
 * @param {number} limit - Token limit
 * @param {number} margin - Safety margin (0-1), default 0.1 (10%)
 * @returns {boolean} True if exceeds limit (including margin)
 */
export function exceedsLimit(text, limit, margin = 0.1) {
  const tokens = countTokens(text);
  const safeLimit = limit * (1 - margin);
  return tokens > safeLimit;
}
