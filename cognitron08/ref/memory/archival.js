import fs from 'fs/promises';
import path from 'path';
import { addToIndex, searchIndex } from '../index/tfidf.js';

export class ArchivalStore {
  constructor(dataDir) {
    this.base = path.join(dataDir, 'archival');
    this.docs = path.join(this.base, 'documents');
    this.metaFile = path.join(this.base, 'metadata.json');
    this.indexFile = path.join(this.base, 'embeddings.json');
    this._writeQueue = Promise.resolve(); // Serialize writes to prevent race conditions
  }
  async ensure() {
    await fs.mkdir(this.docs, { recursive: true });
    try {
      await fs.access(this.metaFile);
    } catch {
      const emptyMeta = { documents: [] };
      await fs.writeFile(this.metaFile, JSON.stringify(emptyMeta, null, 2), 'utf8');
    }
    try {
      await fs.access(this.indexFile);
    } catch {
      const emptyIndex = { df: {}, docs: {} };
      await fs.writeFile(this.indexFile, JSON.stringify(emptyIndex, null, 2), 'utf8');
    }
  }
  async insert(title, content) {
    // Validate inputs before queueing
    if (!title || typeof title !== 'string') {
      throw new Error('Title must be a non-empty string');
    }
    if (!content || typeof content !== 'string') {
      throw new Error('Content must be a non-empty string');
    }

    // Queue writes to prevent concurrent access issues
    this._writeQueue = this._writeQueue.then(async () => {
      await this.ensure();

      // Sanitize title for safe filename usage
      const sanitizeFilename = (str) => str.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 100);
      const safeTitle = sanitizeFilename(title);

      const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const filename = `${id}_${safeTitle}.txt`;
      const filepath = path.join(this.docs, filename);

      const tmpMetaFile = `${this.metaFile}.tmp`;
      const tmpIndexFile = `${this.indexFile}.tmp`;

      try {
        // Write document content first
        await fs.writeFile(filepath, content, 'utf8');

        // Update metadata atomically
        const metaData = await fs.readFile(this.metaFile, 'utf8').catch(() => '{"documents":[]}');
        const meta = JSON.parse(metaData);
        meta.documents = meta.documents || [];
        meta.documents.push({
          id,
          title,
          file: filename,
          timestamp: new Date().toISOString(),
          length: content.length
        });
        await fs.writeFile(tmpMetaFile, JSON.stringify(meta, null, 2), 'utf8');
        await fs.rename(tmpMetaFile, this.metaFile);

        // Update index atomically
        const indexData = await fs.readFile(this.indexFile, 'utf8').catch(() => '{"df":{},"docs":{}}');
        const idx = JSON.parse(indexData);
        addToIndex(idx, id, content);
        await fs.writeFile(tmpIndexFile, JSON.stringify(idx, null, 2), 'utf8');
        await fs.rename(tmpIndexFile, this.indexFile);

        return id;
      } catch (err) {
        // Clean up on error
        try { await fs.unlink(filepath); } catch {}
        try { await fs.unlink(tmpMetaFile); } catch {}
        try { await fs.unlink(tmpIndexFile); } catch {}
        throw new Error(`Failed to insert document: ${err.message}`);
      }
    });

    return this._writeQueue;
  }
  async search(query, page = 1, size = 5) {
    try {
      await this.ensure();
      const indexData = await fs.readFile(this.indexFile, 'utf8').catch(() => '{"df":{},"docs":{}}');
      const idx = JSON.parse(indexData);
      const metaData = await fs.readFile(this.metaFile, 'utf8').catch(() => '{"documents":[]}');
      const meta = JSON.parse(metaData);
      const hits = searchIndex(idx, query, page, size);

      return hits.map(h => {
        const m = (meta.documents || []).find(d => d.id === h.docId) || { title: h.docId };
        return { id: h.docId, score: h.score, title: m.title || h.docId };
      });
    } catch (err) {
      console.error(`ArchivalStore search error: ${err.message}`);
      return [];
    }
  }

  async count() {
    try {
      const metaData = await fs.readFile(this.metaFile, 'utf8').catch(() => '{"documents":[]}');
      const meta = JSON.parse(metaData);
      return (meta.documents || []).length;
    } catch (err) {
      console.error(`ArchivalStore count error: ${err.message}`);
      return 0;
    }
  }
  async reset() { await fs.rm(this.base, { recursive: true, force: true }); }
}
