#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import path from 'path';
import fs from 'fs/promises';
import { RefAgent } from '../ref/agent.js';

// Global shutdown state
let isShuttingDown = false;
let shutdownHandled = false;

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal, agent, rl) {
  if (shutdownHandled) return;
  shutdownHandled = true;

  console.log(chalk.yellow(`\n\n⚠️  Received ${signal}, shutting down gracefully...`));

  try {
    // Close readline interface if it exists
    if (rl) {
      rl.close();
    }

    // Save agent state
    if (agent) {
      console.log(chalk.gray('💾 Saving memory...'));
      await agent.saveState();
      console.log(chalk.green('✅ Memory saved!'));
    }

    console.log(chalk.gray('👋 Goodbye!'));
    process.exit(0);
  } catch (err) {
    console.error(chalk.red(`❌ Error during shutdown: ${err.message}`));
    process.exit(1);
  }
}

async function main() {
  const program = new Command();
  program
    .name('cognitron08')
    .description('MemGPT-style AI Assistant (reference kernel-based)')
    .version('0.1.0')
    .option('--provider <provider>', 'LLM provider (anthropic, groq, together, mock)', 'mock')
    .option('--model <model>', 'Model name (e.g., claude-sonnet-4-20250514, claude-haiku-4-20250611)')
    .option('--temperature <temperature>', 'Sampling temperature')
    .option('--max-tokens <maxTokens>', 'Max tokens for completion')
    .option('--persona <file>', 'Path to persona text file')
    .option('--script', 'Read commands from stdin non-interactively')
    .action(async () => {
      const opts = program.opts();
      const agent = new RefAgent({
        provider: (opts.provider || 'mock').toLowerCase(),
        model: opts.model,
        temperature: Number(opts.temperature) || 0.7,
        maxTokens: Number(opts.maxTokens) || 2000,
        dataDir: './cognitron08-data',
      });

      console.log(chalk.bold.cyan('🧠 Cognitron08 (Ref) - Kernel-based'));
      console.log(chalk.gray('════════════════════════════════════════════════════'));

      await agent.initProviders();

      if (opts.persona) {
        try {
          // Resolve the persona path
          const personaPath = path.resolve(opts.persona);
          const cwd = process.cwd();

          // Security: Prevent path traversal attacks
          // Only allow files within the current working directory or its subdirectories
          if (!personaPath.startsWith(cwd + path.sep) && personaPath !== cwd) {
            throw new Error('Persona file must be within the current working directory');
          }

          // Additional validation: Check file extension
          const ext = path.extname(personaPath).toLowerCase();
          if (!['.txt', '.md', ''].includes(ext)) {
            console.log(chalk.yellow(`⚠️ Warning: Persona file has unusual extension: ${ext}`));
          }

          const content = await fs.readFile(personaPath, 'utf8');

          // Validate content size (prevent loading huge files)
          if (content.length > 50000) {
            throw new Error('Persona file too large (max 50KB)');
          }

          await agent.loadPersona(content, path.basename(personaPath));
          console.log(chalk.magenta(`🎭 Loaded persona: ${path.basename(personaPath)}`));
        } catch (e) {
          console.log(chalk.yellow(`⚠️ Failed to load persona: ${e.message}`));
        }
      }

      await agent.loadState();
      const usage = agent.getTokenUsage();
      if (agent.conversation.length > 0) {
        console.log(chalk.green(`✅ Resumed session with ${agent.conversation.length} messages`));
        console.log(chalk.gray(`📊 Context: ${usage.total}/${agent.maxContext} tokens (${Math.round(usage.percentage * 100)}%)`));
      } else {
        console.log(chalk.cyan('🆕 Starting new MemGPT session'));
        console.log(chalk.gray(`📊 Context limit: ${agent.maxContext} tokens`));
      }
      console.log(chalk.blue(`\nProvider: ${agent.providerName} | Model: ${agent.model} | /help for commands\n`));

      // SCRIPT MODE START
      if (opts.script) {
        // Read all stdin, split into lines, and process deterministically
        const inputText = await new Promise((resolve) => {
          let b = '';
          process.stdin.on('data', (d) => { b += d.toString(); });
          process.stdin.on('end', () => resolve(b));
          process.stdin.resume();
        });
        const lines = inputText.split(/\r?\n/);
        for (const raw of lines) {
          const input = (raw || '').trim();
          if (!input) continue;
          if (input.startsWith('/')) {
            const out = await handleCommand(agent, input);
            if (out === 'exit') break;
            continue;
          }
          console.log(chalk.gray('🤖 Thinking and managing memory...'));
          const result = await agent.processUserTurn(input);
          if (result.tools?.length) {
            console.log(chalk.yellow('\n🧠 MemGPT Memory Operations:'));
            for (const { name, ok, message } of result.tools) {
              console.log(ok ? chalk.green(`   ✅ ${name}`) : chalk.red(`   ❌ ${name}`));
              console.log(chalk.gray(`      → ${message}`));
            }
          }
          console.log(chalk.cyan('\n💬 AI Response:'));
          console.log(result.message);
          await agent.saveState();
        }
        console.log(chalk.gray('\n💾 Saving memory...'));
        await agent.saveState();
        console.log(chalk.green('✅ Memory saved!'));
        console.log(chalk.gray('👋 Goodbye!'));
        process.exit(0);
      }
      // SCRIPT MODE END

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: chalk.cyan('> ') });

      // Set up graceful shutdown handlers
      const shutdownHandler = (signal) => gracefulShutdown(signal, agent, rl);
      process.on('SIGINT', () => shutdownHandler('SIGINT'));
      process.on('SIGTERM', () => shutdownHandler('SIGTERM'));

      rl.prompt();

      const handleLine = async (line) => {
        const input = line.trim();
        if (!input) { if (!agent._closing) rl.prompt(); return; }
        if (input.startsWith('/')) {
          const out = await handleCommand(agent, input);
          if (out === 'exit') { agent._closing = true; rl.close(); return; }
          if (!agent._closing) rl.prompt();
          return;
        }
        console.log(chalk.gray('🤖 Thinking and managing memory...'));
        const result = await agent.processUserTurn(input);
        if (result.tools?.length) {
          console.log(chalk.yellow('\n🧠 MemGPT Memory Operations:'));
          for (const { name, ok, message } of result.tools) {
            console.log(ok ? chalk.green(`   ✅ ${name}`) : chalk.red(`   ❌ ${name}`));
            console.log(chalk.gray(`      → ${message}`));
          }
        }
        console.log(chalk.cyan('\n💬 AI Response:'));
        console.log(result.message);
        await agent.saveState();
        if (!agent._closing) rl.prompt();
      };
      let chain = Promise.resolve();
      rl.on('line', (line) => { chain = chain.then(() => handleLine(line)).catch(() => {}); });
      rl.on('close', async () => {
        if (!shutdownHandled) {
          console.log(chalk.gray('\n💾 Saving memory...'));
          await agent.saveState();
          console.log(chalk.green('✅ Memory saved!'));
          console.log(chalk.gray('👋 Goodbye!'));
        }
      });
    });

  await program.parseAsync(process.argv);
}

async function handleCommand(agent, cmd) {
  const command = cmd.toLowerCase();
  switch (command) {
    case '/exit':
    case '/quit':
      await agent.saveState();
      return 'exit';
    case '/help':
      console.log(chalk.cyan('\n📚 Commands:'));
      console.log('  /help     - Show this help');
      console.log('  /provider <name> - Switch provider (anthropic, groq, together, mock)');
      console.log('  /memory   - Show memory state');
      console.log('  /compact  - Force compaction');
      console.log('  /stream   - Toggle token streaming');
      console.log('  /think    - Toggle reasoning visibility');
      console.log('  /autosum  - Toggle LLM summarization');
      console.log('  /debugtools - Toggle tool-call debug logs');
      console.log('  /recall <q> [p] [n] - Search past conversation');
      console.log('  /arch <q> [p] [n]   - Search archival documents');
      console.log('  /status   - Show provider + toggles');
      console.log('  /clear    - Clear conversation');
      console.log('  /reset    - Reset all memory');
      console.log('  /exit     - Save and exit');
      return 'continue';
    case '/memory':
      printMemoryStatus(agent);
      return 'continue';
    case '/status':
      printStatus(agent);
      return 'continue';
    case '/compact': await agent.compactNow(); return 'continue';
    case '/clear': agent.clearConversation(); await agent.saveState(); console.log(chalk.green('✅ Cleared conversation history')); return 'continue';
    case '/stream': agent.streamEnabled = !agent.streamEnabled; console.log(chalk.cyan(`🔄 Streaming is now ${agent.streamEnabled ? 'ON' : 'OFF'}`)); return 'continue';
    case '/think': agent.showThinking = !agent.showThinking; console.log(chalk.cyan(`🔄 Thinking visibility is now ${agent.showThinking ? 'ON' : 'OFF'}`)); return 'continue';
    case '/autosum': agent.autosum = !agent.autosum; console.log(chalk.cyan(`🔄 Autosum is now ${agent.autosum ? 'ON' : 'OFF'}`)); return 'continue';
    case '/reset': await agent.resetAll(); console.log(chalk.green('✅ All memory reset.')); return 'continue';
    case '/debugtools': agent.debugTools = !agent.debugTools; console.log(chalk.cyan(`🔄 DebugTools is now ${agent.debugTools ? 'ON' : 'OFF'}`)); return 'continue';
    case '/recall': console.log(chalk.yellow('Usage: /recall <query> [page] [size]')); return 'continue';
    case '/arch': console.log(chalk.yellow('Usage: /arch <query> [page] [size]')); return 'continue';
    default: {
      if (cmd.startsWith('/provider ')) {
        const p = cmd.split(' ')[1]?.trim();
        if (!p) { console.log(chalk.red('❌ Please specify provider')); return 'continue'; }
        await agent.switchProvider(p);
        return 'continue';
      }
      if (cmd.startsWith('/recall ')) {
        const { query, page, size } = parseSearchArgs(agent, cmd.slice('/recall '.length));
        const hits = await agent.recall.search(query, page, size);
        if (!hits.length) { console.log(chalk.gray('No results.')); return 'continue'; }
        console.log(chalk.cyan(`\n🔎 Recall results (page ${page}, size ${size}):`));
        hits.forEach((h, i) => {
          const ts = h.meta?.timestamp ? ` @ ${h.meta.timestamp}` : '';
          console.log(chalk.gray(`${i+1}. [${(h.score||0).toFixed(2)}] ${h.meta?.role || 'unknown'}${ts}`));
          console.log((h.content || '').slice(0, 180));
        });
        return 'continue';
      }
      if (cmd.startsWith('/arch ')) {
        const { query, page, size } = parseSearchArgs(agent, cmd.slice('/arch '.length));
        const hits = await agent.archival.search(query, page, size);
        if (!hits.length) { console.log(chalk.gray('No results.')); return 'continue'; }
        console.log(chalk.cyan(`\n📚 Archival results (page ${page}, size ${size}):`));
        hits.forEach((h, i) => console.log(chalk.gray(`${i+1}. [${(h.score||0).toFixed(2)}] ${h.title || h.id}`)));
        return 'continue';
      }
      return 'continue';
    }
  }
}

function parseSearchArgs(agent, s) {
  let page = 1, size = 5, query = '';
  const t = (s||'').trim(); if (!t) return { query, page, size };
  const m = t.match(/^\s*(["'])([\s\S]*?)\1\s*(.*)$/);
  if (m) { query = m[2]; const rest = m[3].trim().split(/\s+/).filter(Boolean); if (rest[0]&&!isNaN(+rest[0])) page=+rest[0]; if (rest[1]&&!isNaN(+rest[1])) size=+rest[1]; return { query, page, size }; }
  const parts = t.split(/\s+/); if (parts.length>=2 && !isNaN(+parts[parts.length-1])) { size=+parts.pop(); }
  if (parts.length>=2 && !isNaN(+parts[parts.length-1])) { page=+parts.pop(); }
  query = parts.join(' '); return { query, page, size };
}

function printStatus(agent) {
  console.log(chalk.cyan('\n🔧 Provider Status:'));
  console.log(chalk.green(`Current: ${agent.providerName}`));
  console.log(chalk.gray(`Model: ${agent.model}`));
  console.log(chalk.gray(`Stream: ${agent.streamEnabled ? 'on' : 'off'} | Think: ${agent.showThinking ? 'on' : 'off'} | Autosum: ${agent.autosum ? 'on' : 'off'} | DebugTools: ${agent.debugTools ? 'on' : 'off'}`));
  const groq = !!process.env.GROQ_API_KEY; const tog = !!process.env.TOGETHER_API_KEY;
  console.log(chalk.blue(`Providers: groq[${groq?'ok':'no-key'}] together[${tog?'ok':'no-key'}] mock[ok]`));
}
function printMemoryStatus(agent) {
  console.log(chalk.cyan('\n🧠 MemGPT Memory Status:'));
  const u = agent.getTokenUsage();
  console.log(chalk.gray(`Context: ${u.total}/${agent.maxContext} tokens (${Math.round(u.percentage*100)}%)`));
  console.log(chalk.gray(`Conversation messages: ${agent.conversation.length}`));
  console.log(chalk.gray(`Core memories: ${agent.coreMemory.size}`));
  if (agent.summary) console.log(chalk.yellow(`📝 Summary: ${agent.summary.substring(0,100)}...`));
}

main().catch((e) => { console.error(e); process.exit(1); });
