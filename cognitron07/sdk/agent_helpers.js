import chalk from 'chalk';

export function printStatus(agent) {
  console.log(chalk.cyan('\n🔧 Provider Status:'));
  console.log(chalk.green(`Current: ${agent.providerName}`));
  console.log(chalk.gray(`Model: ${agent.model}`));
  console.log(chalk.gray(`Stream: ${agent.streamEnabled ? 'on' : 'off'} | Think: ${agent.showThinking ? 'on' : 'off'} | Autosum: ${agent.autosum ? 'on' : 'off'} | DebugTools: ${agent.debugTools ? 'on' : 'off'}`));
  const groq = !!process.env.GROQ_API_KEY; const tog = !!process.env.TOGETHER_API_KEY;
  console.log(chalk.blue(`Providers: groq[${groq?'ok':'no-key'}] together[${tog?'ok':'no-key'}] mock[ok]`));
}

export function printMemoryStatus(agent) {
  console.log(chalk.cyan('\n🧠 MemGPT Memory Status:'));
  const u = agent.getTokenUsage();
  console.log(chalk.gray(`Context: ${u.total}/${agent.maxContext} tokens (${Math.round(u.percentage*100)}%)`));
  console.log(chalk.gray(`Conversation messages: ${agent.conversation.length}`));
  console.log(chalk.gray(`Core memories: ${agent.coreMemory.size}`));
  if (agent.summary) console.log(chalk.yellow(`📝 Summary: ${agent.summary.substring(0,100)}...`));
}
