export function normalizeOutput(s) {
  if (!s) return '';
  // Remove ANSI escape codes
  s = s.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  // Remove emojis and fancy characters for stability
  s = s.replace(/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/gu, '');
  // Collapse whitespace
  s = s.replace(/\r/g, '').replace(/\s+\n/g, '\n').replace(/\n\s+/g, '\n');
  return s.trim();
}

