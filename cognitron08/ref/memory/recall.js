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
    try {
      await fs.access(this.indexFile);
    } catch {
      // Initialize index file if it doesn't exist
      const emptyIndex = { df: {}, docs: {} };
      await fs.writeFile(this.indexFile, JSON.stringify(emptyIndex, null, 2), 'utf8');
    }
  }
  async appendMessages(messages) {
    if (!messages?.length) return;

    // First, update the index atomically using write-then-rename pattern
    const tmpIndexFile = `${this.indexFile}.tmp`;
    try {
      const idx = JSON.parse((await fs.readFile(this.indexFile, 'utf8').catch(() => '{}'))) || { df: {}, docs: {} };
      for (const m of messages) {
        addToIndex(idx, m.id, m.content || '', { role: m.role, timestamp: m.timestamp });
      }
      // Atomic write: write to temp file, then rename
      await fs.writeFile(tmpIndexFile, JSON.stringify(idx, null, 2), 'utf8');
      await fs.rename(tmpIndexFile, this.indexFile);

      // Only append to storage file after index is safely updated
      const jsonl = messages.map(m => JSON.stringify(m)).join('\n') + '\n';
      await fs.appendFile(this.file, jsonl, 'utf8');
    } catch (err) {
      // Clean up temp file on error
      try { await fs.unlink(tmpIndexFile); } catch {}
      throw new Error(`Failed to append messages: ${err.message}`);
    }
  }
  async search(query, page = 1, size = 5) {
    try {
      // Load index
      const indexData = await fs.readFile(this.indexFile, 'utf8').catch(() => '{"df":{},"docs":{}}');
      const idx = JSON.parse(indexData);
      const hits = searchIndex(idx, query, page, size);

      if (!hits.length) return [];

      // Load storage file and build content map
      const content = await fs.readFile(this.file, 'utf8').catch(() => '');
      const lines = content ? content.split('\n').filter(Boolean) : [];
      const map = new Map();

      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (rec.id) map.set(rec.id, rec.content || '');
        } catch (err) {
          // Skip malformed lines
          continue;
        }
      }

      return hits.map(h => ({
        id: h.docId,
        score: h.score,
        content: map.get(h.docId) || '',
        meta: h.meta || {}
      }));
    } catch (err) {
      console.error(`RecallStore search error: ${err.message}`);
      return [];
    }
  }
}
