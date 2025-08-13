#!/usr/bin/env node

// Test script to demonstrate glow markdown rendering

import { spawn } from 'child_process';
import chalk from 'chalk';

const testMarkdown = `# Test Markdown Response

This is a **bold statement** and this is *italic text*.

## Code Example

Here's some JavaScript code:

\`\`\`javascript
function greetUser(name) {
  console.log(\`Hello, \${name}!\`);
  return "Welcome to Cognitron!";
}

const result = greetUser("User");
\`\`\`

## Features List

- ✅ **Real-time streaming** with animated indicators
- ✅ **Markdown rendering** with glow
- ✅ **Code highlighting** for multiple languages
- ✅ **Professional CLI** with comprehensive commands

### Table Example

| Feature | Status | Description |
|---------|--------|-------------|
| Streaming | ✅ ON | Real-time response display |
| Markdown | ✨ ON | Beautiful formatting with glow |
| Reasoning | 🔹 LOW | Thinking process display |

> **Quote**: "The best AI assistants combine powerful capabilities with beautiful presentation."

For more information, visit [the project](https://github.com/example).
`;

async function testGlow() {
  console.log(chalk.cyan('🧪 Testing Glow Markdown Rendering\n'));
  
  console.log(chalk.yellow('📝 Original Markdown:'));
  console.log(chalk.dim('─'.repeat(50)));
  console.log(testMarkdown);
  console.log(chalk.dim('─'.repeat(50)));
  
  console.log(chalk.green('\n✨ Rendered with Glow:'));
  console.log(chalk.dim('─'.repeat(50)));
  
  return new Promise((resolve) => {
    const glow = spawn('glow', ['-', '--style', 'dark', '--width', '80']);
    
    let output = '';
    
    glow.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    glow.on('close', (code) => {
      console.log(output);
      console.log(chalk.dim('─'.repeat(50)));
      console.log(chalk.blue('\n🎉 Glow rendering test complete!'));
      resolve();
    });
    
    glow.on('error', (err) => {
      console.error(chalk.red('❌ Glow not available:', err.message));
      resolve();
    });
    
    glow.stdin.write(testMarkdown);
    glow.stdin.end();
  });
}

testGlow();