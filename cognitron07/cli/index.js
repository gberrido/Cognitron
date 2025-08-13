#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'readline';
import path from 'path';
import fs from 'fs/promises';
import { MemGPTAgent } from '../sdk/agent.js';
import { printStatus, printMemoryStatus } from '../sdk/agent_helpers.js';

async function main() {
  const program = new Command();
  program
    .name('cognitron07')
    .description('MemGPT-style AI Assistant (SDK-backed)')
    .version('1.0.0')
    .option('--provider <provider>', 'LLM provider (groq|together|mock)', 'groq')
    .option('--temperature <temperature>', 'Sampling temperature')
    .option('--max-tokens <maxTokens>', 'Max tokens for completion')
    .option('--persona <file>', 'Path to persona text file')
    .option('--test', 'Run offline tests and exit', false)
    .action(async () => {
      const opts = program.opts();
      const agent = new MemGPTAgent({
        provider: (opts.provider || 'groq').toLowerCase(),
        temperature: Number(opts.temperature) || 0.7,
        maxTokens: Number(opts.maxTokens) || 2000,
        dataDir: './cognitron-memgpt-data',
      });

      console.log(chalk.bold.cyan('🧠 Cognitron07 (SDK) - Infinite Conversation Memory'));
      console.log(chalk.gray('════════════════════════════════════════════════════'));

      await agent.initProviders();

      // persona
      if (opts.persona) {
        try {
          const p = path.resolve(opts.persona);
          const content = await fs.readFile(p, 'utf8');
          await agent.loadPersona(content, path.basename(p));
          console.log(chalk.magenta(`🎭 Loaded persona: ${path.basename(p)}`));
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

      if (opts.test) {
        await agent.runMockTests();
        return;
      }

      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: chalk.cyan('> ') });
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
        if (agent.streamEnabled && result.canStream && agent.providerName !== 'mock') {
          await agent.streamFinalResponse();
        } else {
          console.log(result.message);
        }
        await agent.saveState();
        if (!agent._closing) rl.prompt();
      };
      let chain = Promise.resolve();
      rl.on('line', (line) => { chain = chain.then(() => handleLine(line)).catch(() => {}); });

      rl.on('close', async () => {
        console.log(chalk.gray('\n💾 Saving memory...'));
        await agent.saveState();
        console.log(chalk.green('✅ Memory saved!'));
        console.log(chalk.gray('👋 Goodbye!'));
        process.exit(0);
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
      console.log('  /provider - Switch provider (groq|together|mock)');
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
    case '/compact':
      await agent.compactNow();
      return 'continue';
    case '/clear':
      agent.clearConversation();
      await agent.saveState();
      console.log(chalk.green('✅ Cleared conversation history'));
      return 'continue';
    case '/stream':
      agent.streamEnabled = !agent.streamEnabled;
      console.log(chalk.cyan(`🔄 Streaming is now ${agent.streamEnabled ? 'ON' : 'OFF'}`));
      return 'continue';
    case '/think':
      agent.showThinking = !agent.showThinking;
      console.log(chalk.cyan(`🔄 Thinking visibility is now ${agent.showThinking ? 'ON' : 'OFF'}`));
      return 'continue';
    case '/autosum':
      agent.autosum = !agent.autosum;
      console.log(chalk.cyan(`🔄 Autosum is now ${agent.autosum ? 'ON' : 'OFF'}`));
      return 'continue';
    case '/reset':
      await agent.resetAll();
      console.log(chalk.green('✅ All memory reset.'));
      return 'continue';
    case '/debugtools':
      agent.debugTools = !agent.debugTools;
      console.log(chalk.cyan(`🔄 DebugTools is now ${agent.debugTools ? 'ON' : 'OFF'}`));
      return 'continue';
    case '/recall':
      console.log(chalk.yellow('Usage: /recall <query> [page] [size]'));
      return 'continue';
    case '/arch':
      console.log(chalk.yellow('Usage: /arch <query> [page] [size]'));
      return 'continue';
    default: {
      if (cmd.startsWith('/provider ')) {
        const p = cmd.split(' ')[1]?.trim();
        if (!p) { console.log(chalk.red('❌ Please specify provider')); return 'continue'; }
        await agent.switchProvider(p);
        return 'continue';
      }
      if (cmd.startsWith('/recall ')) {
        const { query, page, size } = agent.parseSearchArgs(cmd.slice('/recall '.length));
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
        const { query, page, size } = agent.parseSearchArgs(cmd.slice('/arch '.length));
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

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
