import { Groq } from 'groq-sdk';

export class GroqProvider {
  constructor(apiKey, model, temperature, maxTokens) {
    this.client = apiKey ? new Groq({ apiKey }) : null;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }
  get ok() { return !!this.client; }
  name() { return 'groq'; }
  async complete(payload) {
    const body = { model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, ...payload };
    if (payload?.tools?.length) body.tool_choice = 'auto';
    return this.client.chat.completions.create(body);
  }
  async stream(payload) {
    const body = { model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, stream: true, ...payload };
    if (payload?.tools?.length) body.tool_choice = 'auto';
    return this.client.chat.completions.create(body);
  }
}
