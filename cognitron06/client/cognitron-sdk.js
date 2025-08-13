#!/usr/bin/env node

/**
 * Cognitron CLI using the SDK
 * Enhanced CLI powered by the Cognitron SDK
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { CognitronCLI } from './src/cli/CognitronCLI.js';

// Setup Commander.js program
const program = new Command();

program
  .name('cognitron-sdk')
  .description('🧠 Cognitron AI Assistant - SDK-powered CLI with advanced features')
  .version('1.0.0')
  .option('-s, --server <url>', 'server URL', 'http://localhost:8000')
  .option('-m, --model <name>', 'AI model to use')
  .option('-v, --verbose', 'verbose output with tool calls')
  .option('-u, --show-usage', 'show token usage statistics')
  .option('--stream', 'enable streaming responses')
  .option('--no-stream', 'disable streaming responses')
  .option('--force-login', 'force new login session')
  .option('--quiet', 'suppress non-essential output')
  .option('--debug', 'enable debug mode');

// Chat command (default)
program
  .command('chat')
  .description('Start interactive chat session (default)')
  .action(async (options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI({
      serverUrl: globalOptions.server,
      debug: globalOptions.debug,
      enableStreaming: globalOptions.stream !== false,
      ...globalOptions
    });
    
    try {
      await cli.initialize();
      
      const authenticated = await cli.authenticate({
        force: globalOptions.forceLogin,
        quiet: globalOptions.quiet
      });
      
      if (!authenticated) {
        console.log(chalk.red('❌ Authentication failed. Please check your server connection.'));
        process.exit(1);
      }
      
      await cli.startInteractiveChat({
        model: globalOptions.model,
        verbose: globalOptions.verbose,
        showUsage: globalOptions.showUsage,
        stream: globalOptions.stream
      });
      
    } catch (error) {
      console.error(chalk.red(`CLI Error: ${error.message}`));
      if (globalOptions.debug) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Ask command
program
  .command('ask <question>')
  .description('Ask a single question and exit')
  .action(async (question, options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI({
      serverUrl: globalOptions.server,
      debug: globalOptions.debug,
      ...globalOptions
    });
    
    try {
      const response = await cli.ask(question, {
        model: globalOptions.model,
        showUsage: globalOptions.showUsage
      });
      
      if (response.content) {
        console.log(response.content);
      } else {
        console.log(chalk.yellow('AI performed actions but provided no response text'));
      }
      
      if (globalOptions.showUsage && response.usage) {
        console.log(chalk.gray(`\nTokens: ${response.usage.total_tokens}`));
      }
      
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      if (globalOptions.debug) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Status command
program
  .command('status')
  .description('Show system and server status')
  .action(async (options, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI({
      serverUrl: globalOptions.server,
      debug: globalOptions.debug
    });
    
    try {
      await cli.initialize();
      
      const authenticated = await cli.authenticate({ quiet: true });
      if (!authenticated) {
        console.log(chalk.red('❌ Not authenticated'));
        process.exit(1);
      }
      
      await cli._showSystemStatus();
      
    } catch (error) {
      console.error(chalk.red(`Status check failed: ${error.message}`));
      process.exit(1);
    }
  });

// Memory command
program
  .command('memory')
  .description('Show memory status and information')
  .option('--search <query>', 'search memory for query')
  .option('--export [format]', 'export memory data')
  .action(async (cmdOptions, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI({
      serverUrl: globalOptions.server,
      debug: globalOptions.debug
    });
    
    try {
      await cli.initialize();
      
      const authenticated = await cli.authenticate({ quiet: true });
      if (!authenticated) {
        console.log(chalk.red('❌ Not authenticated'));
        process.exit(1);
      }
      
      if (cmdOptions.search) {
        await cli._searchMemory(cmdOptions.search);
      } else if (cmdOptions.export !== undefined) {
        await cli._exportMemory([cmdOptions.export || 'json']);
      } else {
        await cli._showMemoryStatus();
      }
      
    } catch (error) {
      console.error(chalk.red(`Memory command failed: ${error.message}`));
      process.exit(1);
    }
  });

// Models command
program
  .command('models')
  .description('Show available models and model information')
  .option('--current', 'show current model only')
  .option('--switch <name>', 'switch to specified model')
  .action(async (cmdOptions, command) => {
    const globalOptions = command.parent.opts();
    const cli = new CognitronCLI({
      serverUrl: globalOptions.server,
      debug: globalOptions.debug
    });
    
    try {
      await cli.initialize();
      
      const authenticated = await cli.authenticate({ quiet: true });
      if (!authenticated) {
        console.log(chalk.red('❌ Not authenticated'));
        process.exit(1);
      }
      
      if (cmdOptions.switch) {
        await cli._switchModel(cmdOptions.switch);
      } else if (cmdOptions.current) {
        await cli._showCurrentModel();
      } else {
        await cli._showAvailableModels();
      }
      
    } catch (error) {
      console.error(chalk.red(`Models command failed: ${error.message}`));
      process.exit(1);
    }
  });

// Default action (chat)
program.action(async (options) => {
  const cli = new CognitronCLI({
    serverUrl: options.server,
    debug: options.debug,
    enableStreaming: options.stream !== false
  });
  
  try {
    await cli.initialize();
    
    const authenticated = await cli.authenticate({
      force: options.forceLogin,
      quiet: options.quiet
    });
    
    if (!authenticated) {
      console.log(chalk.red('❌ Authentication failed. Please check your server connection.'));
      process.exit(1);
    }
    
    await cli.startInteractiveChat({
      model: options.model,
      verbose: options.verbose,
      showUsage: options.showUsage,
      stream: options.stream
    });
    
  } catch (error) {
    console.error(chalk.red(`CLI Error: ${error.message}`));
    if (options.debug) {
      console.error(error.stack);
    }
    process.exit(1);
  }
});

// Parse command line arguments
program.parse();