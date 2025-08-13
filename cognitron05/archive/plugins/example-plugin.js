#!/usr/bin/env node

/**
 * Example Plugin - Demonstrates the plugin architecture capabilities
 * Shows how to create tools and commands through the plugin system
 */

export default {
  id: 'example-plugin',
  name: 'Example Plugin',
  version: '1.0.0',
  description: 'Example plugin demonstrating tools and commands',
  author: 'Cognitron05 Team',
  
  // Auto-enable this plugin when discovered
  autoEnable: true,
  
  // Plugin dependencies (none for this example)
  dependencies: [],
  
  // Tools provided by this plugin
  tools: [
    {
      name: 'get_current_time',
      description: 'Get the current date and time',
      parameters: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            description: 'Time format (iso, locale, or timestamp)',
            enum: ['iso', 'locale', 'timestamp']
          },
          timezone: {
            type: 'string',
            description: 'Timezone (optional, defaults to local)'
          }
        },
        required: []
      },
      security: {
        requiresAuth: false,
        permissions: []
      },
      async handler(parameters, context) {
        const { format = 'iso', timezone } = parameters;
        const now = new Date();
        
        context.logger.debug('Getting current time', {
          format,
          timezone,
          requestTime: now.toISOString()
        });
        
        switch (format) {
          case 'iso':
            return { time: now.toISOString(), format: 'ISO 8601' };
          case 'locale':
            return { time: now.toLocaleString(), format: 'Locale string' };
          case 'timestamp':
            return { time: now.getTime(), format: 'Unix timestamp' };
          default:
            throw new Error(`Unsupported format: ${format}`);
        }
      }
    },
    
    {
      name: 'calculate_simple',
      description: 'Perform simple mathematical calculations',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: 'Mathematical operation',
            enum: ['add', 'subtract', 'multiply', 'divide']
          },
          a: {
            type: 'number',
            description: 'First number'
          },
          b: {
            type: 'number',
            description: 'Second number'
          }
        },
        required: ['operation', 'a', 'b']
      },
      security: {
        requiresAuth: false,
        permissions: []
      },
      async handler(parameters, context) {
        const { operation, a, b } = parameters;
        
        context.logger.debug('Performing calculation', {
          operation,
          operands: [a, b]
        });
        
        let result;
        switch (operation) {
          case 'add':
            result = a + b;
            break;
          case 'subtract':
            result = a - b;
            break;
          case 'multiply':
            result = a * b;
            break;
          case 'divide':
            if (b === 0) {
              throw new Error('Division by zero');
            }
            result = a / b;
            break;
          default:
            throw new Error(`Unsupported operation: ${operation}`);
        }
        
        return {
          operation,
          operands: [a, b],
          result,
          calculation: `${a} ${operation} ${b} = ${result}`
        };
      }
    }
  ],
  
  // Commands provided by this plugin
  commands: [
    {
      name: 'example',
      description: 'Example plugin command',
      usage: '/example [message]',
      minArgs: 0,
      maxArgs: 10,
      permissions: [],
      async handler(args, context) {
        const message = args.join(' ') || 'Hello from example plugin!';
        
        context.logger.info('Example command executed', {
          argsProvided: args.length,
          message
        });
        
        if (context.responseProcessor) {
          context.responseProcessor.print(
            context.responseProcessor.colorize(`🔌 Example Plugin: ${message}`, 'cyan')
          );
        } else {
          console.log(`🔌 Example Plugin: ${message}`);
        }
        
        return true;
      }
    },
    
    {
      name: 'calc',
      description: 'Quick calculator command',
      usage: '/calc <operation> <a> <b>',
      minArgs: 3,
      maxArgs: 3,
      permissions: [],
      async handler(args, context) {
        const [operation, aStr, bStr] = args;
        
        // Validate numbers
        const a = parseFloat(aStr);
        const b = parseFloat(bStr);
        
        if (isNaN(a) || isNaN(b)) {
          throw new Error('Arguments must be valid numbers');
        }
        
        // Use the plugin's calculation tool
        const pluginManager = context.container?.get('tools.manager') || context.pluginManager;
        if (pluginManager && pluginManager.executeTool) {
          const result = await pluginManager.executeTool('calculate_simple', {
            operation,
            a,
            b
          }, context);
          
          if (result.isSuccess()) {
            const data = result.getData();
            if (context.responseProcessor) {
              context.responseProcessor.print(
                context.responseProcessor.colorize(`🧮 ${data.calculation}`, 'green')
              );
            } else {
              console.log(`🧮 ${data.calculation}`);
            }
          } else {
            throw result.getError();
          }
        } else {
          // Fallback calculation
          let result;
          switch (operation) {
            case 'add':
              result = a + b;
              break;
            case 'subtract':
              result = a - b;
              break;
            case 'multiply':
              result = a * b;
              break;
            case 'divide':
              if (b === 0) throw new Error('Division by zero');
              result = a / b;
              break;
            default:
              throw new Error(`Unsupported operation: ${operation}`);
          }
          
          if (context.responseProcessor) {
            context.responseProcessor.print(
              context.responseProcessor.colorize(`🧮 ${a} ${operation} ${b} = ${result}`, 'green')
            );
          } else {
            console.log(`🧮 ${a} ${operation} ${b} = ${result}`);
          }
        }
        
        return true;
      }
    },
    
    {
      name: 'time',
      description: 'Show current time',
      usage: '/time [format]',
      minArgs: 0,
      maxArgs: 1,
      permissions: [],
      async handler(args, context) {
        const format = args[0] || 'locale';
        
        // Use the plugin's time tool
        const pluginManager = context.container?.get('tools.manager') || context.pluginManager;
        if (pluginManager && pluginManager.executeTool) {
          const result = await pluginManager.executeTool('get_current_time', {
            format
          }, context);
          
          if (result.isSuccess()) {
            const data = result.getData();
            if (context.responseProcessor) {
              context.responseProcessor.print(
                context.responseProcessor.colorize(`🕐 Current time: ${data.time} (${data.format})`, 'blue')
              );
            } else {
              console.log(`🕐 Current time: ${data.time} (${data.format})`);
            }
          } else {
            throw result.getError();
          }
        } else {
          // Fallback time display
          const now = new Date();
          const timeString = format === 'iso' ? now.toISOString() : 
                           format === 'timestamp' ? now.getTime().toString() :
                           now.toLocaleString();
          
          if (context.responseProcessor) {
            context.responseProcessor.print(
              context.responseProcessor.colorize(`🕐 Current time: ${timeString}`, 'blue')
            );
          } else {
            console.log(`🕐 Current time: ${timeString}`);
          }
        }
        
        return true;
      }
    }
  ],
  
  // Plugin lifecycle methods
  async initialize() {
    console.log('🔌 Example plugin initialized');
  },
  
  async cleanup() {
    console.log('🔌 Example plugin cleaned up');
  },
  
  async healthCheck() {
    return {
      healthy: true,
      details: {
        toolsProvided: this.tools.length,
        commandsProvided: this.commands.length,
        status: 'All systems operational'
      }
    };
  }
};