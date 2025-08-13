import TogetherWrapper from 'together-ai';

export class TogetherProvider {
  constructor(apiKey, model, temperature, maxTokens) {
    const Together = (TogetherWrapper && TogetherWrapper.default) ? TogetherWrapper.default : TogetherWrapper;
    this.client = apiKey ? new Together({ apiKey, timeout: 60000 }) : null;
    this.model = model;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
    this.apiKey = apiKey;
  }
  get ok() { return !!this.client; }
  name() { return 'together'; }
  async complete(payload) {
    const body = { model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, ...payload };
    if (this.client?.chat?.completions?.create) {
      if (payload?.tools?.length) body.tool_choice = 'auto';
      return this.client.chat.completions.create(body);
    }
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ ...body, stream: false })
    });
    if (!res.ok) throw new Error(`Together HTTP ${res.status}`);
    return await res.json();
  }
  async stream(payload) {
    const body = { model: this.model, temperature: this.temperature, max_tokens: this.maxTokens, ...payload };
    if (this.client?.chat?.completions?.create) {
      if (payload?.tools?.length) body.tool_choice = 'auto';
      return this.client.chat.completions.create({ ...body, stream: true });
    }
    const res = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.apiKey}` },
      body: JSON.stringify({ ...body, stream: true })
    });
    if (!res.ok || !res.body) throw new Error(`Together HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    async function* iter() {
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') return;
          try {
            const json = JSON.parse(data);
            const delta = json.choices?.[0]?.delta || {};
            yield { choices: [{ delta }] };
          } catch {}
        }
      }
      if (buf) {
        try { const json = JSON.parse(buf.replace(/^data:\s*/, '')); const delta = json.choices?.[0]?.delta || {}; yield { choices: [{ delta }] }; } catch {}
      }
    }
    return iter();
  }
}
