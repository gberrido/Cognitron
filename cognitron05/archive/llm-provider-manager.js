#!/usr/bin/env node

/**
 * LLM Provider Manager CLI
 * Standalone utility to manage and test LLM providers
 */

import { LLMConfigManager } from './modules/llm/LLMConfigManager.js';
import { Command } from 'commander';
import chalk from 'chalk';

const program = new Command();
const configManager = new LLMConfigManager();

program
  .name('llm-provider-manager')
  .description('Manage LLM providers for MemGPT')
  .version('1.0.0');

program
  .command('status')
  .description('Show current LLM provider status')
  .action(async () => {
    await configManager.showProviderStatus();
  });

program
  .command('set')
  .description('Set the LLM provider')
  .argument('<provider>', 'Provider name (groq|together)')
  .option('-f, --fallback <provider>', 'Fallback provider')
  .option('--no-auto-fallback', 'Disable auto-fallback')
  .action(async (provider, options) => {
    try {
      await configManager.setProvider(provider, {
        fallback: options.fallback,
        autoFallback: options.autoFallback
      });
      console.log(chalk.green(`✅ Provider set to ${provider}`));
    } catch (error) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('test')
  .description('Test an LLM provider')
  .argument('[provider]', 'Provider to test (defaults to current)')
  .action(async (provider) => {
    try {
      const success = await configManager.testProvider(provider);
      if (success) {
        console.log(chalk.green('✅ Provider test successful!'));
      } else {
        console.log(chalk.red('❌ Provider test failed!'));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red(`❌ Error: ${error.message}`));
      process.exit(1);
    }
  });

program
  .command('compare')
  .description('Compare pricing between providers')
  .action(async () => {
    console.log(chalk.bold.cyan('\n💰 LLM Provider Pricing Comparison (GPT-OSS-120B)'));
    console.log(chalk.gray('═'.repeat(60)));
    
    console.log(chalk.white('\n🏢 Groq:'));
    console.log(chalk.green('  Input:  $0.15/M tokens ($0.00015/1K tokens)'));
    console.log(chalk.green('  Output: $0.75/M tokens ($0.00075/1K tokens)'));
    console.log(chalk.yellow('  Speed: 500 tokens/second (very fast!)'));
    console.log(chalk.gray('  Free tier: 30 RPM, 8K TPM'));
    
    console.log(chalk.white('\n🏢 Together AI:'));
    console.log(chalk.green('  Input:  $0.16/M tokens ($0.00016/1K tokens)'));
    console.log(chalk.green('  Output: $0.60/M tokens ($0.00060/1K tokens)'));
    console.log(chalk.yellow('  Speed: Fast inference'));
    console.log(chalk.cyan('  Batch API: 50% discount available!'));
    
    console.log(chalk.bold.green('\n🎯 Recommendations:'));
    console.log(chalk.green('  • Free usage: Groq'));
    console.log(chalk.green('  • Cheapest paid: Together AI'));
    console.log(chalk.green('  • Fastest: Groq'));
    console.log(chalk.green('  • Best overall: Together AI (cheaper + batch discounts)'));
    
    console.log(chalk.white('\n📊 Cost for 100 MemGPT interactions/day:'));
    console.log(chalk.gray('  (Assuming ~1,200 input + 200 output tokens per interaction)'));
    console.log(chalk.white('  • Groq: ~$0.033/day (~$1.00/month)'));
    console.log(chalk.white('  • Together AI: ~$0.031/day (~$0.93/month)'));
    console.log(chalk.cyan('  • Together AI + Batch: ~$0.015/day (~$0.45/month)'));
  });

program.parse();

// If no command provided, show status
if (process.argv.length === 2) {
  await configManager.showProviderStatus();
}