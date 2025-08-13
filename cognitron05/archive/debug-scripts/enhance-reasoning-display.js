#!/usr/bin/env node

/**
 * Enhanced Reasoning Display
 * Demonstrates how to improve reasoning visibility in the CLI
 */

import chalk from 'chalk';

/**
 * Enhanced reasoning pattern detection and highlighting
 */
export class ReasoningEnhancer {
  constructor() {
    // Common reasoning patterns in model responses
    this.reasoningPatterns = {
      steps: /(?:step \d+|first[,:]|second[,:]|third[,:]|next[,:]|then[,:]|finally[,:])/gi,
      thinking: /(?:let me think|thinking|analyzing|considering|reasoning)/gi,
      logic: /(?:therefore|because|since|given that|assuming|if.*then)/gi,
      math: /(?:\d+\s*[×*+\-÷/]\s*\d+|equals?|result)/gi,
      conclusion: /(?:conclusion|answer|result|solution)/gi
    };
  }

  /**
   * Analyze content for reasoning patterns
   */
  analyzeReasoning(content) {
    if (!content) return { hasReasoning: false, patterns: [] };
    
    const foundPatterns = [];
    let totalMatches = 0;
    
    Object.entries(this.reasoningPatterns).forEach(([type, pattern]) => {
      const matches = content.match(pattern) || [];
      if (matches.length > 0) {
        foundPatterns.push({
          type,
          matches: matches.length,
          examples: matches.slice(0, 3)
        });
        totalMatches += matches.length;
      }
    });
    
    return {
      hasReasoning: totalMatches > 0,
      patterns: foundPatterns,
      confidence: Math.min(totalMatches / 3, 1.0), // 0-1 scale
      totalMatches
    };
  }

  /**
   * Format reasoning content with enhanced highlighting
   */
  formatReasoningContent(content, showHighlights = true) {
    if (!content || !showHighlights) {
      return content;
    }

    let formatted = content;
    
    // Highlight step patterns
    formatted = formatted.replace(
      /(?:^|\n)((?:step \d+|first[,:]?|second[,:]?|third[,:]?|next[,:]?|then[,:]?|finally[,:]?).*?)(?=\n|$)/gmi,
      (match, step) => `\n${chalk.cyan('📍')} ${chalk.white.bold(step)}`
    );
    
    // Highlight thinking patterns  
    formatted = formatted.replace(
      /(let me think|thinking|analyzing|considering|reasoning)/gi,
      (match) => chalk.blue.italic(match)
    );
    
    // Highlight logical connectors
    formatted = formatted.replace(
      /(therefore|because|since|given that)/gi,
      (match) => chalk.yellow.bold(match)
    );
    
    // Highlight conclusions
    formatted = formatted.replace(
      /(conclusion|answer|result|solution)/gi,
      (match) => chalk.green.bold(match)
    );
    
    return formatted;
  }

  /**
   * Display reasoning analysis summary
   */
  displayReasoningAnalysis(analysis) {
    if (!analysis.hasReasoning) {
      console.log(chalk.dim('💭 No structured reasoning detected'));
      return;
    }

    const confidence = Math.round(analysis.confidence * 100);
    const confidenceColor = confidence > 70 ? chalk.green : 
                           confidence > 40 ? chalk.yellow : 
                           chalk.red;
    
    console.log(chalk.cyan(`💭 Reasoning detected: ${confidenceColor(confidence + '%')} confidence`));
    
    analysis.patterns.forEach(pattern => {
      const examples = pattern.examples.join(', ');
      console.log(chalk.dim(`   ${pattern.type}: ${pattern.matches} matches (${examples})`));
    });
  }
}

// Usage example for CLI integration
export function enhancedVerboseDisplay(response, options = {}) {
  const enhancer = new ReasoningEnhancer();
  
  if (response.content && options.verbose) {
    // Analyze reasoning content
    const analysis = enhancer.analyzeReasoning(response.content);
    
    if (analysis.hasReasoning) {
      // Show reasoning analysis
      enhancer.displayReasoningAnalysis(analysis);
      
      // Display enhanced content
      console.log(chalk.white('🧠 Reasoning Process:'));
      const enhanced = enhancer.formatReasoningContent(response.content, true);
      console.log(enhanced);
    } else {
      // Regular content display
      console.log(chalk.white('💬 Response:'));
      console.log(response.content);
    }
  } else {
    // Non-verbose mode - just show content
    console.log(response.content);
  }
}

// Example usage
if (import.meta.url === `file://${process.argv[1]}`) {
  // Demo the enhancer
  const enhancer = new ReasoningEnhancer();
  
  const sampleResponse = `Let me think through this step by step:

Step 1: First, I need to understand what 25% means. 25% is the same as 25/100 = 0.25

Step 2: Next, I'll multiply 80 by 0.25 to get the answer.
80 × 0.25 = 20

Therefore, 25% of 80 equals 20.

Conclusion: The answer is 20.`;

  console.log(chalk.cyan('🧠 Reasoning Enhancement Demo\n'));
  
  const analysis = enhancer.analyzeReasoning(sampleResponse);
  enhancer.displayReasoningAnalysis(analysis);
  
  console.log(chalk.white('\n📄 Enhanced Display:'));
  console.log(enhancer.formatReasoningContent(sampleResponse, true));
}