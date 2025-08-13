export function getToolRegistry(agent) {
  return {
    core_memory_append: async ({ key, value }) => {
      agent.coreMemory.set(key, { value, timestamp: new Date().toISOString() });
      await agent.persistWorking();
      return { success: true, message: `Stored in core memory: ${key} = ${value}` };
    },
    core_memory_replace: async ({ key, new_value }) => {
      if (!agent.coreMemory.has(key)) return { success: false, message: `Key not found: ${key}` };
      agent.coreMemory.set(key, { value: new_value, timestamp: new Date().toISOString() });
      await agent.persistWorking();
      return { success: true, message: `Updated: ${key} = ${new_value}` };
    },
    conversation_search: async ({ query, max_results = 5 }) => {
      const res = await agent.recall.search(query, 1, max_results);
      return { success: true, message: `Found ${res.length} results for "${query}"`, data: res };
    },
    archival_memory_insert: async ({ title, content }) => {
      const id = await agent.archival.insert(title || 'Untitled', content || '');
      return { success: true, message: `Stored doc ${id} (${title || 'Untitled'})` };
    },
    archival_memory_search: async ({ query }) => {
      const res = await agent.archival.search(query || '', 1, 5);
      return { success: true, message: `Found ${res.length} results for "${query}"`, data: res };
    },
    get_memory_status: async () => {
      const usage = agent.getTokenUsage();
      const arch = await agent.archival.count();
      return { success: true, message: `Memory: ${usage.total}/${agent.maxContext} tokens, Core facts: ${agent.coreMemory.size}, Archival: ${arch}` };
    },
    pause_heartbeats: async ({ message }) => ({ success: true, message: message || 'Pausing', pause: true })
  };
}

export function parseTextToolCalls(text) {
  const calls = [];
  if (!text) return calls;
  const regex = /^\s*CALL\s+([a-zA-Z0-9_]+)\s*(\{[\s\S]*?\})?\s*$/gmi;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const name = match[1];
    const json = match[2];
    let args = {};
    if (json) { try { args = JSON.parse(json); } catch {} }
    calls.push({ toolName: name, args });
  }
  return calls;
}

export function getToolDefinitions() {
  return [
    { type: 'function', function: { name: 'core_memory_append', parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key','value'] } } },
    { type: 'function', function: { name: 'core_memory_replace', parameters: { type: 'object', properties: { key: { type: 'string' }, new_value: { type: 'string' } }, required: ['key','new_value'] } } },
    { type: 'function', function: { name: 'conversation_search', parameters: { type: 'object', properties: { query: { type: 'string' }, max_results: { type: 'number', default: 5 } }, required: ['query'] } } },
    { type: 'function', function: { name: 'archival_memory_insert', parameters: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string' } }, required: ['title','content'] } } },
    { type: 'function', function: { name: 'archival_memory_search', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'get_memory_status', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'pause_heartbeats', parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] } } }
  ];
}
