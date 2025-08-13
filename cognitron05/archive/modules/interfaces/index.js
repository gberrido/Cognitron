#!/usr/bin/env node

/**
 * Interfaces Index - Central export for all system interfaces
 * Provides standardized interfaces for modular architecture
 * 
 * This follows the cognitron04 pattern of clean layer separation:
 * - Memory Layer: IMemorySystem, IMemoryPersistence, IMemorySearch
 * - Tools Layer: IToolManager, IToolRegistry, IToolSecurity
 * - Agent Layer: IAgent, IChatAgent, IContextBuilder, IResponseGenerator
 * - UI Layer: IUserInterface, IConsoleInterface, IResponseProcessor
 */

// Memory Layer Interfaces
export {
  IMemorySystem,
  IMemorySystemFactory,
  IMemoryPersistence,
  IMemorySearch
} from './IMemorySystem.js';

// Tools Layer Interfaces  
export {
  IToolManager,
  IToolExecutionContext,
  IToolSecurity,
  IToolRegistry,
  IToolExecutionResult
} from './IToolManager.js';

// Agent Layer Interfaces
export {
  IAgent,
  IChatAgent,
  IContextBuilder,
  IResponseGenerator,
  IToolCallProcessor,
  IAgentOrchestrator,
  IAgentResponse
} from './IAgent.js';

// UI Layer Interfaces
export {
  IUserInterface,
  IConsoleInterface,
  IResponseProcessor,
  IInteractiveSession,
  ICommandInterface,
  IUIEventHandler,
  IUITheme
} from './IUserInterface.js';

/**
 * Interface validation utilities
 */
export class InterfaceValidator {
  /**
   * Check if an object implements required interface methods
   * @param {Object} obj - Object to validate
   * @param {Class} interfaceClass - Interface class to validate against
   * @returns {Object} Validation result
   */
  static validateImplementation(obj, interfaceClass) {
    const result = {
      valid: true,
      missingMethods: [],
      errors: []
    };

    try {
      // Get all methods from interface prototype
      const interfaceMethods = Object.getOwnPropertyNames(interfaceClass.prototype)
        .filter(name => name !== 'constructor' && typeof interfaceClass.prototype[name] === 'function');

      // Check if object implements each required method
      for (const methodName of interfaceMethods) {
        if (typeof obj[methodName] !== 'function') {
          result.valid = false;
          result.missingMethods.push(methodName);
        }
      }

      // Test method calls to ensure they don't throw "must be implemented" errors
      for (const methodName of interfaceMethods) {
        if (typeof obj[methodName] === 'function') {
          try {
            // Try to call with no arguments (may fail for other reasons, but shouldn't be "not implemented")
            const testResult = obj[methodName]();
            
            // If it's a promise that rejects with "must be implemented", mark as invalid
            if (testResult && typeof testResult.catch === 'function') {
              testResult.catch(error => {
                if (error.message && error.message.includes('must be implemented')) {
                  result.valid = false;
                  result.errors.push(`${methodName}: ${error.message}`);
                }
              });
            }
          } catch (error) {
            if (error.message && error.message.includes('must be implemented')) {
              result.valid = false;
              result.errors.push(`${methodName}: ${error.message}`);
            }
          }
        }
      }

    } catch (error) {
      result.valid = false;
      result.errors.push(`Validation error: ${error.message}`);
    }

    return result;
  }

  /**
   * Create a mock implementation of an interface for testing
   * @param {Class} interfaceClass - Interface class to mock
   * @param {Object} overrides - Method overrides
   * @returns {Object} Mock implementation
   */
  static createMockImplementation(interfaceClass, overrides = {}) {
    const mock = {};

    // Get all methods from interface prototype
    const interfaceMethods = Object.getOwnPropertyNames(interfaceClass.prototype)
      .filter(name => name !== 'constructor' && typeof interfaceClass.prototype[name] === 'function');

    // Create mock implementations
    for (const methodName of interfaceMethods) {
      if (overrides[methodName]) {
        mock[methodName] = overrides[methodName];
      } else {
        // Create default mock that returns resolved promise
        mock[methodName] = async (...args) => {
          return { mockCall: methodName, args, timestamp: new Date().toISOString() };
        };
      }
    }

    return mock;
  }

  /**
   * Generate interface documentation
   * @param {Class} interfaceClass - Interface class to document
   * @returns {Object} Interface documentation
   */
  static generateInterfaceDoc(interfaceClass) {
    const doc = {
      name: interfaceClass.name,
      description: interfaceClass.prototype.constructor.toString().match(/\/\*\*([\s\S]*?)\*\//)?.[1]?.trim() || '',
      methods: []
    };

    // Get all methods from interface prototype
    const interfaceMethods = Object.getOwnPropertyNames(interfaceClass.prototype)
      .filter(name => name !== 'constructor' && typeof interfaceClass.prototype[name] === 'function');

    // Document each method
    for (const methodName of interfaceMethods) {
      const method = interfaceClass.prototype[methodName];
      const methodStr = method.toString();
      
      // Extract parameter names
      const paramMatch = methodStr.match(/\(([^)]*)\)/);
      const params = paramMatch ? paramMatch[1].split(',').map(p => p.trim()).filter(p => p) : [];

      // Extract JSDoc comments if present
      const docMatch = methodStr.match(/\/\*\*([\s\S]*?)\*\//);
      const description = docMatch ? docMatch[1].trim() : '';

      doc.methods.push({
        name: methodName,
        parameters: params,
        description,
        async: methodStr.includes('async '),
        throws: methodStr.includes('throw new Error')
      });
    }

    return doc;
  }
}

/**
 * Layer definitions for modular architecture
 */
export const ARCHITECTURE_LAYERS = {
  MEMORY: {
    name: 'Memory Layer',
    description: 'Handles all memory operations, persistence, and search',
    interfaces: [
      'IMemorySystem',
      'IMemoryPersistence', 
      'IMemorySearch'
    ],
    dependencies: []
  },

  TOOLS: {
    name: 'Tools Layer', 
    description: 'Manages tool execution, registry, and security',
    interfaces: [
      'IToolManager',
      'IToolRegistry',
      'IToolSecurity'
    ],
    dependencies: ['MEMORY']
  },

  AGENT: {
    name: 'Agent Layer',
    description: 'AI agent logic, context building, and response generation',
    interfaces: [
      'IAgent',
      'IChatAgent',
      'IContextBuilder',
      'IResponseGenerator'
    ],
    dependencies: ['MEMORY', 'TOOLS']
  },

  UI: {
    name: 'User Interface Layer',
    description: 'User interaction, display, and command handling',
    interfaces: [
      'IUserInterface',
      'IConsoleInterface',
      'IResponseProcessor'
    ],
    dependencies: ['AGENT']
  }
};

/**
 * Get interfaces by layer
 * @param {string} layer - Layer name
 * @returns {Array<string>} Interface names for layer
 */
export function getInterfacesByLayer(layer) {
  const layerDef = ARCHITECTURE_LAYERS[layer];
  return layerDef ? layerDef.interfaces : [];
}

/**
 * Get layer dependencies
 * @param {string} layer - Layer name  
 * @returns {Array<string>} Dependency layer names
 */
export function getLayerDependencies(layer) {
  const layerDef = ARCHITECTURE_LAYERS[layer];
  return layerDef ? layerDef.dependencies : [];
}

/**
 * Validate architectural layer dependencies
 * @param {Object} implementations - Map of layer to implementations
 * @returns {Object} Validation result
 */
export function validateLayerDependencies(implementations) {
  const result = {
    valid: true,
    errors: [],
    warnings: []
  };

  // Check each layer has required implementations
  for (const [layerName, layerDef] of Object.entries(ARCHITECTURE_LAYERS)) {
    const layerImpls = implementations[layerName];
    
    if (!layerImpls) {
      result.valid = false;
      result.errors.push(`Missing implementations for ${layerName} layer`);
      continue;
    }

    // Check layer has implementations for all required interfaces
    for (const interfaceName of layerDef.interfaces) {
      if (!layerImpls[interfaceName]) {
        result.warnings.push(`Missing ${interfaceName} implementation in ${layerName} layer`);
      }
    }

    // Check layer dependencies are satisfied
    for (const depLayerName of layerDef.dependencies) {
      if (!implementations[depLayerName]) {
        result.valid = false;
        result.errors.push(`${layerName} layer depends on ${depLayerName} layer, but it's not implemented`);
      }
    }
  }

  return result;
}

// Re-import for default export
import MemoryInterfaces from './IMemorySystem.js';
import ToolInterfaces from './IToolManager.js';
import AgentInterfaces from './IAgent.js';
import UIInterfaces from './IUserInterface.js';

export default {
  // Memory Layer
  ...MemoryInterfaces,

  // Tools Layer
  ...ToolInterfaces,

  // Agent Layer
  ...AgentInterfaces,

  // UI Layer
  ...UIInterfaces,

  // Utilities
  InterfaceValidator,
  ARCHITECTURE_LAYERS,
  getInterfacesByLayer,
  getLayerDependencies,
  validateLayerDependencies
};