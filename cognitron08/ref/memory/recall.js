import fs from 'fs/promises';
import path from 'path';
import { addToIndex, searchIndex } from '../index/tfidf.js';

/**
 * RecallStore - Manages searchable conversation history
 *
 * Stores conversation messages in a JSONL file with TF-IDF indexing for fast retrieval.
 * Uses atomic file writes to prevent corruption on crashes.
 *
 * @class
 * @example
 * const store = new RecallStore('./data');
 * await store.ensure();
 * await store.appendMessages([{id: 1, role: 'user', content: 'Hello', timestamp: '...'}]);
 * const results = await store.search('Hello', 1, 5);
 */
export class RecallStore {
  /**
   * Create a new RecallStore
   * @param {string} dataDir - Directory to store recall data
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'recall-storage.jsonl');
    this.indexFile = path.join(dataDir, 'recall-index.json');
    this._writeQueue = Promise.resolve(); // Serialize writes to prevent race conditions
  }
  /**
   * Ensure data directory and index file exist
   * @async
   * @returns {Promise<void>}
   */
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

  /**
   * Append messages to recall storage with atomic index updates
   *
   * Uses write-then-rename pattern for atomicity. Updates index first,
   * then appends to storage file. Automatically cleans up on errors.
   *
   * @async
   * @param {Array<{id: number|string, role: string, content: string, timestamp: string}>} messages - Messages to append
   * @returns {Promise<void>}
   * @throws {Error} If write operations fail
   * @example
   * await store.appendMessages([
   *   {id: 1, role: 'user', content: 'Hello', timestamp: '2025-01-01T00:00:00Z'}
   * ]);
   */
  async appendMessages(messages) {
    if (!messages?.length) return;

    // Queue writes to prevent concurrent access issues
    this._writeQueue = this._writeQueue.then(async () => {
      // Ensure directory exists
      await fs.mkdir(this.dataDir, { recursive: true });

      // First, update the index atomically using write-then-rename pattern
      const tmpIndexFile = `${this.indexFile}.tmp`;
      try {
      // Load existing index or create empty one
      let idx;
      try {
        const indexData = await fs.readFile(this.indexFile, 'utf8');
        idx = JSON.parse(indexData);
      } catch {
        idx = { df: {}, docs: {} };
      }
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
    });

    // Return the queued promise
    return this._writeQueue;
  }
  /**
   * Search messages using TF-IDF ranking
   *
   * Returns messages matching the query, ranked by relevance.
   * Handles malformed JSONL lines gracefully.
   *
   * @async
   * @param {string} query - Search query
   * @param {number} [page=1] - Page number (1-indexed)
   * @param {number} [size=5] - Results per page
   * @returns {Promise<Array<{id: number|string, score: number, content: string, meta: Object}>>} Search results
   * @example
   * const results = await store.search('machine learning', 1, 10);
   * results.forEach(r => console.log(`[${r.score.toFixed(2)}] ${r.content}`));
   */
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
      const idMap = new Map(); // Map to preserve original ID types

      for (const line of lines) {
        try {
          const rec = JSON.parse(line);
          if (rec.id !== undefined) {
            // Store with string key to match JSON index keys
            const strId = String(rec.id);
            map.set(strId, rec.content || '');
            idMap.set(strId, rec.id); // Preserve original ID type (number or string)
          }
        } catch (err) {
          // Skip malformed lines
          continue;
        }
      }

      return hits.map(h => ({
        id: idMap.get(String(h.docId)) ?? h.docId, // Preserve original ID type
        score: h.score,
        content: map.get(String(h.docId)) || '',
        meta: h.meta || {}
      }));
    } catch (err) {
      console.error(`RecallStore search error: ${err.message}`);
      return [];
    }
  }
}
