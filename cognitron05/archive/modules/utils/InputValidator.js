#!/usr/bin/env node

/**
 * Input Validation Utility for Cognitron05
 * Provides centralized validation for all user inputs to prevent security vulnerabilities
 */

import { CHAT_AGENT_CONSTANTS, SECURITY_CONSTANTS } from '../config/SystemConstants.js';

export class InputValidator {
  static VALID_REASONING_LEVELS = Object.values(CHAT_AGENT_CONSTANTS.REASONING_LEVELS);
  static MIN_TEMPERATURE = CHAT_AGENT_CONSTANTS.MIN_TEMPERATURE;
  static MAX_TEMPERATURE = CHAT_AGENT_CONSTANTS.MAX_TEMPERATURE;
  static MAX_QUERY_LENGTH = SECURITY_CONSTANTS.MAX_QUERY_LENGTH;
  static SAFE_PATH_CHARS = SECURITY_CONSTANTS.SAFE_CHARACTERS_REGEX;

  /**
   * Validate temperature input
   * @param {string} input - Raw user input
   * @returns {Object} Validation result with parsed value or error
   */
  static validateTemperature(input) {
    // Check for empty or null input
    if (input === null || input === undefined || typeof input !== 'string') {
      return {
        valid: false,
        error: 'Temperature value is required',
        code: 'MISSING_VALUE'
      };
    }

    const trimmed = input.trim();
    
    // Check for empty string after trimming
    if (trimmed === '' || input === '') {
      return {
        valid: false,
        error: 'Temperature value cannot be empty',
        code: 'EMPTY_VALUE'
      };
    }

    // Parse as float
    const parsed = parseFloat(trimmed);
    
    // Check for NaN (invalid number)
    if (isNaN(parsed)) {
      return {
        valid: false,
        error: `Invalid temperature format: "${trimmed}". Must be a number between ${this.MIN_TEMPERATURE} and ${this.MAX_TEMPERATURE}`,
        code: 'INVALID_FORMAT'
      };
    }

    // Check for Infinity
    if (!isFinite(parsed)) {
      return {
        valid: false,
        error: 'Temperature cannot be infinite',
        code: 'INFINITE_VALUE'
      };
    }

    // Check bounds
    if (parsed < this.MIN_TEMPERATURE || parsed > this.MAX_TEMPERATURE) {
      return {
        valid: false,
        error: `Temperature ${parsed} is out of range. Must be between ${this.MIN_TEMPERATURE} and ${this.MAX_TEMPERATURE}`,
        code: 'OUT_OF_RANGE'
      };
    }

    return {
      valid: true,
      value: parsed,
      normalized: Number(parsed.toFixed(2)) // Round to 2 decimal places
    };
  }

  /**
   * Validate reasoning level input
   * @param {string} input - Raw user input
   * @returns {Object} Validation result with parsed value or error
   */
  static validateReasoningLevel(input) {
    // Check for empty or null input
    if (input === null || input === undefined || typeof input !== 'string') {
      return {
        valid: false,
        error: 'Reasoning level is required',
        code: 'MISSING_VALUE'
      };
    }

    const trimmed = input.trim().toLowerCase();
    
    // Check for empty string after trimming
    if (trimmed === '' || input === '') {
      return {
        valid: false,
        error: 'Reasoning level cannot be empty',
        code: 'EMPTY_VALUE'
      };
    }

    // Check if valid level
    if (!this.VALID_REASONING_LEVELS.includes(trimmed)) {
      return {
        valid: false,
        error: `Invalid reasoning level: "${input}". Must be one of: ${this.VALID_REASONING_LEVELS.join(', ')}`,
        code: 'INVALID_ENUM'
      };
    }

    return {
      valid: true,
      value: trimmed,
      normalized: trimmed
    };
  }

  /**
   * Validate and sanitize search query
   * @param {string} input - Raw user input
   * @returns {Object} Validation result with sanitized value or error
   */
  static validateSearchQuery(input) {
    // Check for empty or null input
    if (input === null || input === undefined || typeof input !== 'string') {
      return {
        valid: false,
        error: 'Search query is required',
        code: 'MISSING_VALUE'
      };
    }

    const trimmed = input.trim();
    
    // Check for empty string after trimming
    if (trimmed === '' || input === '') {
      return {
        valid: false,
        error: 'Search query cannot be empty',
        code: 'EMPTY_VALUE'
      };
    }

    // Check length limits
    if (trimmed.length > this.MAX_QUERY_LENGTH) {
      return {
        valid: false,
        error: `Search query is too long (${trimmed.length} characters). Maximum allowed: ${this.MAX_QUERY_LENGTH}`,
        code: 'TOO_LONG'
      };
    }

    // Check for suspicious patterns BEFORE sanitization to catch injection attempts
    const suspiciousPatterns = [
      /\.\.\//g,           // Path traversal
      /<script/gi,         // Script injection
      /javascript:/gi,     // JavaScript protocol
      /on\w+\s*=/gi,      // Event handlers
      /\x00/g,            // Null bytes
      /[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g // Control characters except \t, \n, \r
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(trimmed)) {
        return {
          valid: false,
          error: 'Search query contains potentially unsafe characters',
          code: 'UNSAFE_CHARACTERS'
        };
      }
    }

    // Sanitize the query - remove potentially dangerous characters
    const sanitized = this.sanitizeString(trimmed);

    return {
      valid: true,
      value: sanitized,
      normalized: sanitized,
      originalLength: trimmed.length
    };
  }

  /**
   * Validate file path to prevent path traversal attacks
   * @param {string} input - Raw file path input
   * @param {string} baseDir - Base directory to restrict access to
   * @returns {Object} Validation result with safe path or error
   */
  static validateFilePath(input, baseDir = '') {
    // Check for empty or null input
    if (!input || typeof input !== 'string') {
      return {
        valid: false,
        error: 'File path is required',
        code: 'MISSING_VALUE'
      };
    }

    const trimmed = input.trim();
    
    // Check for empty string after trimming
    if (trimmed === '') {
      return {
        valid: false,
        error: 'File path cannot be empty',
        code: 'EMPTY_VALUE'
      };
    }

    // Check for path traversal attempts
    if (trimmed.includes('..')) {
      return {
        valid: false,
        error: 'Path traversal sequences (..) are not allowed',
        code: 'PATH_TRAVERSAL'
      };
    }

    // Check for absolute paths (should be relative to base directory)
    if (trimmed.startsWith('/') || trimmed.match(/^[a-zA-Z]:/)) {
      return {
        valid: false,
        error: 'Absolute paths are not allowed',
        code: 'ABSOLUTE_PATH'
      };
    }

    // Check for unsafe characters
    if (!this.SAFE_PATH_CHARS.test(trimmed)) {
      return {
        valid: false,
        error: 'File path contains unsafe characters. Only alphanumeric, dots, dashes, and forward slashes are allowed',
        code: 'UNSAFE_CHARACTERS'
      };
    }

    // Normalize the path
    const normalized = trimmed.replace(/\/+/g, '/'); // Remove duplicate slashes

    return {
      valid: true,
      value: normalized,
      normalized,
      baseDir
    };
  }

  /**
   * Sanitize a string by removing or escaping dangerous characters
   * @param {string} input - Input string to sanitize
   * @returns {string} Sanitized string
   */
  static sanitizeString(input) {
    if (!input || typeof input !== 'string') {
      return '';
    }

    return input
      // Remove null bytes and control characters (except \t, \n, \r)
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      // Trim
      .trim();
  }

  /**
   * Validate command arguments array
   * @param {Array} args - Arguments array
   * @param {Object} requirements - Validation requirements
   * @returns {Object} Validation result
   */
  static validateCommandArgs(args, requirements = {}) {
    const {
      minArgs = 0,
      maxArgs = Infinity,
      requiredArgs = 0
    } = requirements;

    if (!Array.isArray(args)) {
      return {
        valid: false,
        error: 'Arguments must be an array',
        code: 'INVALID_TYPE'
      };
    }

    if (args.length < minArgs) {
      return {
        valid: false,
        error: `Not enough arguments. Expected at least ${minArgs}, got ${args.length}`,
        code: 'TOO_FEW_ARGS'
      };
    }

    if (args.length > maxArgs) {
      return {
        valid: false,
        error: `Too many arguments. Expected at most ${maxArgs}, got ${args.length}`,
        code: 'TOO_MANY_ARGS'
      };
    }

    if (args.length < requiredArgs) {
      return {
        valid: false,
        error: `Missing required arguments. Expected ${requiredArgs}, got ${args.length}`,
        code: 'MISSING_REQUIRED_ARGS'
      };
    }

    return {
      valid: true,
      value: args,
      count: args.length
    };
  }

  /**
   * Create a validation error with consistent format
   * @param {string} message - Error message
   * @param {string} code - Error code
   * @param {Object} details - Additional error details
   * @returns {Error} Formatted validation error
   */
  static createValidationError(message, code = 'VALIDATION_ERROR', details = {}) {
    const error = new Error(message);
    error.name = 'ValidationError';
    error.code = code;
    error.details = details;
    error.timestamp = new Date().toISOString();
    return error;
  }
}

export default InputValidator;