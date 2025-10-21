import chalk from 'chalk';
import { GroqProvider } from './providers/groq.js';
import { TogetherProvider } from './providers/together.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { MockProvider } from './providers/mock.js';

// Sets agent.provider (and may adjust agent.providerName) based on env keys and fallbacks
export async function setupProvider(agent) {
  if (agent.providerName === 'mock') {
    agent.provider = new MockProvider();
    console.log(chalk.green('✅ Using mock provider (offline)'));
    return;
  }
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  const togetherKey = process.env.TOGETHER_API_KEY;

  if (agent.providerName === 'anthropic') {
    if (anthropicKey) {
      const anthropic = new AnthropicProvider(anthropicKey, agent.model, agent.temperature, agent.maxTokens);
      if (anthropic.ok) agent.provider = anthropic;
    }
    if (!agent.provider && groqKey) {
      const groq = new GroqProvider(groqKey, agent.model, agent.temperature, agent.maxTokens);
      if (groq.ok) { agent.providerName = 'groq'; agent.provider = groq; console.log(chalk.cyan('🔄 Switched to Groq (Anthropic unavailable)')); }
    }
    if (!agent.provider && togetherKey) {
      const tog = new TogetherProvider(togetherKey, agent.model, agent.temperature, agent.maxTokens);
      if (tog.ok) { agent.providerName = 'together'; agent.provider = tog; console.log(chalk.cyan('🔄 Switched to Together (Anthropic unavailable)')); }
    }
  } else if (agent.providerName === 'groq') {
    if (groqKey) {
      const groq = new GroqProvider(groqKey, agent.model, agent.temperature, agent.maxTokens);
      if (groq.ok) agent.provider = groq;
    }
    if (!agent.provider && anthropicKey) {
      const anthropic = new AnthropicProvider(anthropicKey, agent.model, agent.temperature, agent.maxTokens);
      if (anthropic.ok) { agent.providerName = 'anthropic'; agent.provider = anthropic; console.log(chalk.cyan('🔄 Switched to Anthropic (Groq unavailable)')); }
    }
    if (!agent.provider && togetherKey) {
      const tog = new TogetherProvider(togetherKey, agent.model, agent.temperature, agent.maxTokens);
      if (tog.ok) { agent.providerName = 'together'; agent.provider = tog; console.log(chalk.cyan('🔄 Switched to Together (Groq unavailable)')); }
    }
  } else if (agent.providerName === 'together') {
    if (togetherKey) {
      const tog = new TogetherProvider(togetherKey, agent.model, agent.temperature, agent.maxTokens);
      if (tog.ok) agent.provider = tog;
    }
    if (!agent.provider && anthropicKey) {
      const anthropic = new AnthropicProvider(anthropicKey, agent.model, agent.temperature, agent.maxTokens);
      if (anthropic.ok) { agent.providerName = 'anthropic'; agent.provider = anthropic; console.log(chalk.cyan('🔄 Switched to Anthropic (Together unavailable)')); }
    }
    if (!agent.provider && groqKey) {
      const groq = new GroqProvider(groqKey, agent.model, agent.temperature, agent.maxTokens);
      if (groq.ok) { agent.providerName = 'groq'; agent.provider = groq; console.log(chalk.cyan('🔄 Switched to Groq (Together unavailable)')); }
    }
  }
  if (!agent.provider) throw new Error('No providers available! Set ANTHROPIC_API_KEY, GROQ_API_KEY, or TOGETHER_API_KEY');
  console.log(chalk.green(`✅ Using provider: ${agent.providerName}`));
}
