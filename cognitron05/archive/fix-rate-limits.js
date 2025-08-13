#!/usr/bin/env node

/**
 * Rate Limit Fix Helper
 * Analyzes current memory state and provides actionable solutions
 */

import { MemGPTCognitron } from './cognitron05-memgpt.js';
import chalk from 'chalk';

class RateLimitFixer {
  constructor() {
    this.cognitron = new MemGPTCognitron();
  }

  async analyzeMemoryState() {
    console.log(chalk.bold.cyan('🔍 Rate Limit Issue Analysis'));
    console.log(chalk.gray('═'.repeat(50)));
    
    await this.cognitron.loadMemory();
    
    const usage = this.cognitron.getCurrentTokenUsage();
    const messageCount = this.cognitron.memory.conversationContext.length;
    
    console.log(chalk.white('\n📊 Current Memory State:'));
    console.log(chalk.gray(`  Messages loaded: ${messageCount}`));
    console.log(chalk.gray(`  Token usage: ${usage.total}/${this.cognitron.memory.maxContextWindow} (${Math.round(usage.percentage * 100)}%)`));
    console.log(chalk.gray(`  Core memories: ${this.cognitron.memory.workingContext.size}`));
    console.log(chalk.gray(`  Has summary: ${this.cognitron.memory.recursiveSummary ? 'Yes' : 'No'}`));
    
    // Estimate API request size
    const testMessages = this.cognitron.buildMessages();
    const estimatedTokens = testMessages.reduce((sum, msg) => sum + this.cognitron.countTokens(msg.content), 0);
    
    console.log(chalk.yellow('\n⚠️ API Request Analysis:'));
    console.log(chalk.yellow(`  Messages per request: ${testMessages.length}`));
    console.log(chalk.yellow(`  Estimated tokens per request: ~${estimatedTokens}`));
    
    // Rate limit analysis
    const rateLimitRisk = this.analyzeRateLimitRisk(estimatedTokens, messageCount);
    
    console.log(chalk.bold.red('\n🚨 Rate Limit Risk Assessment:'));
    console.log(rateLimitRisk.color(rateLimitRisk.message));
    
    console.log(chalk.bold.green('\n💡 Recommended Actions:'));
    rateLimitRisk.actions.forEach(action => {
      console.log(chalk.green(`  ${action}`));
    });
    
    return { usage, messageCount, estimatedTokens, risk: rateLimitRisk.level };
  }

  analyzeRateLimitRisk(estimatedTokens, messageCount) {
    if (estimatedTokens > 1000) {
      return {
        level: 'CRITICAL',
        color: chalk.red,
        message: 'CRITICAL - Very high token usage will exhaust rate limits quickly',
        actions: [
          '1. Run: /compact command to force aggressive memory compaction',
          '2. Consider starting fresh session if compaction insufficient',
          '3. Avoid long conversations until memory is optimized'
        ]
      };
    } else if (estimatedTokens > 600) {
      return {
        level: 'HIGH',
        color: chalk.yellow,
        message: 'HIGH - Token usage will quickly consume rate limits',
        actions: [
          '1. Run: /compact command to reduce memory footprint',
          '2. Monitor token usage during conversations',
          '3. Take breaks between interactions to avoid rate limits'
        ]
      };
    } else if (messageCount > 20) {
      return {
        level: 'MEDIUM',
        color: chalk.yellow,
        message: 'MEDIUM - Many messages loaded, but token usage manageable',
        actions: [
          '1. Consider /compact command for optimal performance',
          '2. Current state should work but monitor for issues'
        ]
      };
    } else {
      return {
        level: 'LOW',
        color: chalk.green,
        message: 'LOW - Memory state optimized for rate limit management',
        actions: [
          '1. Current memory state is optimal',
          '2. System should work without rate limit issues'
        ]
      };
    }
  }

  async suggestOptimalSettings() {
    console.log(chalk.bold.cyan('\n⚙️ Optimal Settings for Rate Limit Management'));
    console.log(chalk.gray('═'.repeat(50)));
    
    console.log(chalk.white('Applied Fixes in Updated Code:'));
    console.log(chalk.green('  ✅ Maximum 8 conversation messages per API request'));
    console.log(chalk.green('  ✅ 800-token budget per API request'));
    console.log(chalk.green('  ✅ Reduced max_tokens from 2000 to 500'));
    console.log(chalk.green('  ✅ Aggressive /compact command (removes 70% of messages)'));
    console.log(chalk.green('  ✅ Token usage warnings for high consumption'));
    
    console.log(chalk.white('\nGroq Rate Limits (Free Tier):'));
    console.log(chalk.gray('  • 30 requests per minute'));
    console.log(chalk.gray('  • 8000 tokens per minute'));
    console.log(chalk.gray('  • With 800 tokens per request = ~10 requests per minute safely'));
    
    console.log(chalk.white('\nBest Practices:'));
    console.log(chalk.cyan('  • Run /compact when you have >20 messages loaded'));
    console.log(chalk.cyan('  • Take 6-second breaks between interactions (10 req/min)'));
    console.log(chalk.cyan('  • Use /memory to check current state'));
    console.log(chalk.cyan('  • Watch for "High token usage" warnings'));
  }

  async runDiagnostic() {
    const analysis = await this.analyzeMemoryState();
    await this.suggestOptimalSettings();
    
    console.log(chalk.bold.cyan('\n🎯 Next Steps:'));
    
    if (analysis.risk === 'CRITICAL' || analysis.risk === 'HIGH') {
      console.log(chalk.red('1. IMMEDIATELY run the /compact command:'));
      console.log(chalk.white('   node cognitron05-memgpt.js'));
      console.log(chalk.white('   > /compact'));
      console.log(chalk.red('2. Wait for compaction to complete'));
      console.log(chalk.red('3. Try normal interaction: "hello"'));
    } else {
      console.log(chalk.green('1. Your memory state looks good!'));
      console.log(chalk.green('2. Try normal interaction: "hello"'));
      console.log(chalk.green('3. The rate limit fixes should prevent issues'));
    }
    
    console.log(chalk.gray('\n💡 The updated code now automatically manages rate limits!'));
    
    return analysis;
  }
}

// Run diagnostic if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixer = new RateLimitFixer();
  await fixer.runDiagnostic();
}

export { RateLimitFixer };