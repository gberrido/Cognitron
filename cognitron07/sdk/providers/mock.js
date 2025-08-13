export class MockProvider {
  constructor() {}
  get ok() { return true; }
  name() { return 'mock'; }
  async complete({ messages }) {
    const last = messages[messages.length - 1] || {};
    const content = (last.content || '').toLowerCase();
    let out = '';
    if (/(my name is|i am )/.test(content)) {
      const name = (last.content.match(/my name is\s+([A-Za-z]+)/i) || [,'User'])[1];
      out += `CALL core_memory_append {"key":"user_name","value":"${name}"}\n`;
      out += `PAUSE: Nice to meet you ${name}! I\\'ve noted your name.`;
    } else if (/search\s+convo|recall\s|what did i say/.test(content)) {
      out += `CALL conversation_search {"query":"${(last.content || '').slice(0,40)}"}\n`;
      out += `PAUSE: I searched your past messages for the query.`;
    } else if (/store doc|archive this|remember this doc/.test(content)) {
      out += `CALL archival_memory_insert {"title":"Test Doc","content":"Sample archival content"}\n`;
      out += `PAUSE: I stored that in the archive.`;
    } else if (/arch(ive)?\s+search/.test(content)) {
      out += `CALL archival_memory_search {"query":"${(last.content || '').slice(0,40)}"}\n`;
      out += `PAUSE: I retrieved related archival items.`;
    } else {
      out += 'PAUSE: Acknowledged.';
    }
    return { choices: [{ message: { content: out } }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } };
  }
  async stream(payload) { return this.complete(payload); }
}

