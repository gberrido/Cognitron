export class FakeToolProvider {
  constructor(script = []) { this.script = script; this.step = 0; }
  get ok() { return true; }
  name() { return 'fake'; }
  async complete({ messages, tools }) {
    const s = this.script[this.step++] || {};
    if (s.toolCalls) {
      return { choices: [{ message: { tool_calls: s.toolCalls, content: s.assistantContent || '' } }] };
    }
    return { choices: [{ message: { content: s.assistantContent || 'PAUSE: ok' } }] };
  }
  async stream(payload) { return this.complete(payload); }
}

