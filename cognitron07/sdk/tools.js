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
      return {
        success: true,
        message: `Memory: ${usage.total}/${agent.maxContext} tokens, Core facts: ${agent.coreMemory.size}, Archival: ${arch}`,
        data: { usage, core: agent.coreMemory.size, convo: agent.conversation.length, archival: arch }
      };
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
    {
      type: 'function',
      function: {
        name: 'core_memory_append',
        description: 'Append to core memory: remember key facts about the user or important information.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Concise key (e.g., user_name, favorite_food)' },
            value: { type: 'string', description: 'The information to store' }
          },
          required: ['key', 'value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'core_memory_replace',
        description: 'Replace existing core memory when information changes.',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The key to update' },
            new_value: { type: 'string', description: 'The new value' }
          },
          required: ['key', 'new_value']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'conversation_search',
        description: 'Search conversation history to recall previous discussions.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Keywords to search for in past conversations' },
            max_results: { type: 'number', description: 'Max results to return', default: 5 }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'archival_memory_insert',
        description: 'Store complex information in long-term archival storage.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short title for the document' },
            content: { type: 'string', description: 'Content to store' }
          },
          required: ['title', 'content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'archival_memory_search',
        description: 'Search archival storage for stored information.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Search query' } },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_memory_status',
        description: 'Get current memory usage and statistics.',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'pause_heartbeats',
        description: 'Pause to allow user interaction with a final message.',
        parameters: {
          type: 'object',
          properties: { message: { type: 'string', description: 'Message to show user' } },
          required: ['message']
        }
      }
    }
  ];
}
