export class MockProvider {
  get ok() { return true; }
  async complete({ messages, tools }) {
    // Very simple mock: if user introduces name, propose tool_calls; else pause.
    const last = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const calls = [];
    if (/my name is (\w+)/i.test(last)) {
      const name = last.match(/my name is (\w+)/i)[1];
      calls.push({ id: 'call_1', type: 'function', function: { name: 'core_memory_append', arguments: JSON.stringify({ key: 'user_name', value: name }) } });
    }
    calls.push({ id: 'call_2', type: 'function', function: { name: 'pause_heartbeats', arguments: JSON.stringify({ message: 'Okay. I saved that.' }) } });
    return { choices: [{ message: { tool_calls: calls, content: '' } }] };
  }
  async stream() { return []; }
}
