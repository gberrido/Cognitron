export async function summarizeSegment(agent, messagesToSummarize) {
  if (!messagesToSummarize.length) return agent.summary;
  if (!agent.autosum) {
    const first = messagesToSummarize.map(m => `${m.role}: ${(m.content||'').split(/(?<=[.!?])\s/)[0]}`);
    const chunk = `Summarized(${new Date().toISOString()}):\n` + first.join('\n');
    return agent.summary ? `${agent.summary}\n${chunk}` : chunk;
  }
  const conversationText = messagesToSummarize.map(msg => `${msg.role}: ${msg.content}`).join('\n');
  const prompt = `Summarize this conversation segment concisely, preserving key facts, decisions, and context that might be referenced later:\n\n${conversationText}\n\nPrevious summary: ${agent.summary || 'None'}\n\nInstructions:\n- Combine with previous summary\n- Preserve important facts and decisions\n- Be concise but comprehensive\nSummary:`;
  try {
    const resp = await agent.complete([{ role: 'user', content: prompt }], []);
    const s = resp.choices?.[0]?.message?.content?.trim();
    return s || agent.summary || '';
  } catch {
    const fallback = `Previous: ${agent.summary}\nRecent: ${messagesToSummarize.slice(-3).map(m => m.content).join('; ')}`;
    return fallback.substring(0, 500);
  }
}

