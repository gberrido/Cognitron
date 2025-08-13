export async function summarizeSegment(agent, messagesToSummarize) {
  if (!messagesToSummarize.length) return agent.summary;
  if (!agent.autosum) {
    const first = messagesToSummarize.map(m => `${m.role}: ${(m.content||'').split(/(?<=[.!?])\s/)[0]}`);
    const chunk = `Summarized(${new Date().toISOString()}):\n` + first.join('\n');
    return agent.summary ? `${agent.summary}\n${chunk}` : chunk;
  }
  // In ref, keep local path only to avoid external calls
  const fallback = `Previous: ${agent.summary}\nRecent: ${messagesToSummarize.slice(-3).map(m => m.content).join('; ')}`;
  return fallback.substring(0, 500);
}
