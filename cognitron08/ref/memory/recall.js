import fs from 'fs/promises';
import path from 'path';
import { addToIndex, searchIndex } from '../index/tfidf.js';

export class RecallStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'recall-storage.jsonl');
    this.indexFile = path.join(dataDir, 'recall-index.json');
  }
  async ensure() {
    await fs.mkdir(this.dataDir, { recursive: true });
    try { await fs.access(this.indexFile); } catch { await fs.writeFile(this.indexFile, JSON.stringify({ df: {}, docs: {} }, null, 2)); }
  }
  async appendMessages(messages) {
    if (!messages?.length) return;
    const jsonl = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
    await fs.appendFile(this.file, jsonl);
    const idx = JSON.parse((await fs.readFile(this.indexFile, 'utf8')) || '{}');
    for (const m of messages) addToIndex(idx, m.id, m.content || '', { role: m.role, timestamp: m.timestamp });
    await fs.writeFile(this.indexFile, JSON.stringify(idx, null, 2));
  }
  async search(query, page = 1, size = 5) {
    try {
      const idx = JSON.parse((await fs.readFile(this.indexFile, 'utf8')) || '{}');
      const hits = searchIndex(idx, query, page, size);
      let content = '';
      try { content = await fs.readFile(this.file, 'utf8'); } catch {}
      const lines = content ? content.split('\n').filter(Boolean) : [];
      const map = new Map();
      for (const line of lines) { try { const rec = JSON.parse(line); map.set(rec.id, rec.content); } catch {} }
      return hits.map(h => ({ id: h.docId, score: h.score, content: map.get(h.docId) || '', meta: h.meta }));
    } catch { return []; }
  }
}
