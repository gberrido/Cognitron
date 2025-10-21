export function getToolRegistry(agent) {
  return {
    core_memory_append: async ({ key, value }) => {
      // Validate key
      if (!key || typeof key !== 'string') {
        return { success: false, message: 'Invalid key: must be a non-empty string' };
      }
      if (key.length > 100) {
        return { success: false, message: 'Invalid key: maximum length is 100 characters' };
      }

      // Validate value
      if (value === undefined || value === null || typeof value !== 'string') {
        return { success: false, message: 'Invalid value: must be a string' };
      }
      if (value.length > 2000) {
        return { success: false, message: 'Invalid value: maximum length is 2000 characters' };
      }

      try {
        agent.coreMemory.set(key, { value, timestamp: new Date().toISOString() });
        await agent.persistWorking();
        return { success: true, message: `Stored in core memory: ${key} = ${value}` };
      } catch (err) {
        return { success: false, message: `Failed to store: ${err.message}` };
      }
    },

    core_memory_replace: async ({ key, new_value }) => {
      // Validate key
      if (!key || typeof key !== 'string') {
        return { success: false, message: 'Invalid key: must be a non-empty string' };
      }
      if (key.length > 100) {
        return { success: false, message: 'Invalid key: maximum length is 100 characters' };
      }

      // Check if key exists
      if (!agent.coreMemory.has(key)) {
        return { success: false, message: `Key not found: ${key}` };
      }

      // Validate new_value
      if (new_value === undefined || new_value === null || typeof new_value !== 'string') {
        return { success: false, message: 'Invalid value: must be a string' };
      }
      if (new_value.length > 2000) {
        return { success: false, message: 'Invalid value: maximum length is 2000 characters' };
      }

      try {
        agent.coreMemory.set(key, { value: new_value, timestamp: new Date().toISOString() });
        await agent.persistWorking();
        return { success: true, message: `Updated: ${key} = ${new_value}` };
      } catch (err) {
        return { success: false, message: `Failed to update: ${err.message}` };
      }
    },

    conversation_search: async ({ query, max_results = 5 }) => {
      // Validate query
      if (!query || typeof query !== 'string') {
        return { success: false, message: 'Invalid query: must be a non-empty string' };
      }
      if (query.length > 500) {
        return { success: false, message: 'Invalid query: maximum length is 500 characters' };
      }

      // Validate max_results
      if (typeof max_results !== 'number' || max_results < 1 || max_results > 100) {
        max_results = 5; // Use default if invalid
      }

      try {
        const res = await agent.recall.search(query, 1, Math.floor(max_results));
        return { success: true, message: `Found ${res.length} results for "${query}"`, data: res };
      } catch (err) {
        return { success: false, message: `Search failed: ${err.message}` };
      }
    },

    archival_memory_insert: async ({ title, content }) => {
      // Validate title
      if (!title || typeof title !== 'string') {
        return { success: false, message: 'Invalid title: must be a non-empty string' };
      }
      if (title.length > 200) {
        return { success: false, message: 'Invalid title: maximum length is 200 characters' };
      }

      // Validate content
      if (!content || typeof content !== 'string') {
        return { success: false, message: 'Invalid content: must be a non-empty string' };
      }
      if (content.length > 50000) {
        return { success: false, message: 'Invalid content: maximum length is 50000 characters' };
      }

      try {
        const id = await agent.archival.insert(title, content);
        return { success: true, message: `Stored doc ${id} (${title})` };
      } catch (err) {
        return { success: false, message: `Failed to insert: ${err.message}` };
      }
    },

    archival_memory_search: async ({ query }) => {
      // Validate query
      if (!query || typeof query !== 'string') {
        return { success: false, message: 'Invalid query: must be a non-empty string' };
      }
      if (query.length > 500) {
        return { success: false, message: 'Invalid query: maximum length is 500 characters' };
      }

      try {
        const res = await agent.archival.search(query, 1, 5);
        return { success: true, message: `Found ${res.length} results for "${query}"`, data: res };
      } catch (err) {
        return { success: false, message: `Search failed: ${err.message}` };
      }
    },

    get_memory_status: async () => {
      try {
        const usage = agent.getTokenUsage();
        const arch = await agent.archival.count();
        return { success: true, message: `Memory: ${usage.total}/${agent.maxContext} tokens, Core facts: ${agent.coreMemory.size}, Archival: ${arch}` };
      } catch (err) {
        return { success: false, message: `Failed to get status: ${err.message}` };
      }
    },

    pause_heartbeats: async ({ message }) => {
      // Validate message (optional parameter)
      if (message !== undefined && typeof message !== 'string') {
        return { success: false, message: 'Invalid message: must be a string' };
      }
      if (message && message.length > 1000) {
        return { success: false, message: 'Invalid message: maximum length is 1000 characters' };
      }

      return { success: true, message: message || 'Pausing', pause: true };
    }
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
