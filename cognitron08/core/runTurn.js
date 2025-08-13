function safeJsonParse(s) { try { return JSON.parse(s); } catch { return {}; } }

/**
 * Minimal heartbeat engine. Orchestrates provider tool_calls and tool execution until pause or assistant final.
 * @param {Object} params
 * @param {import('./types.js').ChatMessage[]} params.messages
 * @param {import('./types.js').Provider} params.provider
 * @param {any[]} [params.toolDefinitions]
 * @param {import('./types.js').ToolRegistry} [params.tools]
 * @param {number} [params.maxHeartbeats]
 * @param {import('./types.js').KernelHooks} [params.hooks]
 * @returns {Promise<{ finalMessage: string, messages: import('./types.js').ChatMessage[] }>} result
 */
export async function runTurn({ messages, provider, toolDefinitions = [], tools = {}, maxHeartbeats = 5, hooks = {} }) {
  let finalMessage = null;
  let hb = 0;
  while (!finalMessage && hb < maxHeartbeats) {
    hb += 1;
    hooks.onHeartbeatStart?.({ heartbeat: hb, messages });
    const response = await provider.complete({ messages, tools: toolDefinitions });
    const choice = response?.choices?.[0] || {};
    const content = choice?.message?.content || '';
    const tool_calls = choice?.message?.tool_calls || [];
    messages.push({ role: 'assistant', content: content || (tool_calls.length ? 'Processing with tools...' : '') });

    if (tool_calls.length) {
      for (const tc of tool_calls) {
        const name = tc?.function?.name;
        const args = safeJsonParse(tc?.function?.arguments || '{}');
        hooks.onToolCall?.({ id: tc.id, name, args });
        const fn = tools[name];
        const result = fn ? await fn(args) : { success: false, message: `Unknown tool: ${name}` };
        messages.push({ role: 'tool', content: JSON.stringify(result), tool_call_id: tc.id });
        hooks.onToolResult?.({ id: tc.id, name, result });
        if (name === 'pause_heartbeats') {
          finalMessage = result?.message || content || 'Ok.';
        }
      }
      hooks.onHeartbeatEnd?.({ heartbeat: hb, messages, choice });
      if (finalMessage) break;
      continue;
    }

    if (content && !tool_calls.length) {
      finalMessage = content;
      hooks.onHeartbeatEnd?.({ heartbeat: hb, messages, choice });
      break;
    }
    hooks.onHeartbeatEnd?.({ heartbeat: hb, messages, choice });
  }

  if (!finalMessage) finalMessage = 'Ok.';
  hooks.onPause?.({ finalMessage });
  return { finalMessage, messages };
}
