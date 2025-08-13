// Optional tokenizer utility. Falls back to char/4 when no tokenizer is available.
// Tries to dynamically import @dqbd/tiktoken/lite (if user installs it) without making it required.

let cached = null;

export function createTokenizer() {
  if (cached) return cached;
  // Fallback implementation
  const fallback = {
    name: 'fallback-char4',
    countTokens(text) { if (!text) return 0; return Math.ceil(String(text).length / 4); },
    countMessages(msgs) { return (msgs || []).reduce((t, m) => t + this.countTokens(m.content || '') + 4, 0); }
  };

  cached = fallback;
  // Try to upgrade to a real tokenizer if available, without throwing on failure.
  try {
    // Dynamic import so the package remains optional.
    // Note: this path assumes users may install @dqbd/tiktoken; we keep graceful fallback otherwise.
    // eslint-disable-next-line no-new-func
    const dynamic = new Function("return import('@dqbd/tiktoken/lite')");
    dynamic().then((mod) => {
      if (!mod) return;
      const encoder = mod.get_encoding ? mod.get_encoding('cl100k_base') : null;
      if (!encoder) return;
      cached = {
        name: 'tiktoken-cl100k',
        countTokens(text) { if (!text) return 0; return encoder.encode(String(text)).length; },
        countMessages(msgs) {
          let total = 0; for (const m of (msgs || [])) { total += this.countTokens(m.content || '') + 4; } return total;
        }
      };
    }).catch(() => { /* ignore; fallback remains */ });
  } catch {
    // ignore; fallback remains
  }
  return cached;
}

