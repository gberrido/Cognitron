import fs from 'fs/promises';
import path from 'path';
import { addToIndex, searchIndex } from '../index/tfidf.js';

export class ArchivalStore {
  constructor(dataDir) {
    this.base = path.join(dataDir, 'archival');
    this.docs = path.join(this.base, 'documents');
    this.metaFile = path.join(this.base, 'metadata.json');
    this.indexFile = path.join(this.base, 'embeddings.json');
  }
  async ensure() {
    await fs.mkdir(this.docs, { recursive: true });
    try { await fs.access(this.metaFile); } catch { await fs.writeFile(this.metaFile, JSON.stringify({ documents: [] }, null, 2)); }
    try { await fs.access(this.indexFile); } catch { await fs.writeFile(this.indexFile, JSON.stringify({ df: {}, docs: {} }, null, 2)); }
  }
  async insert(title, content) {
    await this.ensure();
    const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const file = path.join(this.docs, `${id}.txt`);
    await fs.writeFile(file, content, 'utf8');
    const meta = JSON.parse((await fs.readFile(this.metaFile, 'utf8')) || '{}');
    meta.documents = meta.documents || [];
    meta.documents.push({ id, title, file: `${id}.txt`, timestamp: new Date().toISOString(), length: content.length });
    await fs.writeFile(this.metaFile, JSON.stringify(meta, null, 2));
    const idx = JSON.parse((await fs.readFile(this.indexFile, 'utf8')) || '{}');
    addToIndex(idx, id, content);
    await fs.writeFile(this.indexFile, JSON.stringify(idx, null, 2));
    return id;
  }
  async search(query, page = 1, size = 5) {
    await this.ensure();
    const idx = JSON.parse((await fs.readFile(this.indexFile, 'utf8')) || '{}');
    const meta = JSON.parse((await fs.readFile(this.metaFile, 'utf8')) || '{}');
    const hits = searchIndex(idx, query, page, size);
    return hits.map(h => {
      const m = (meta.documents || []).find(d => d.id === h.docId) || { title: h.docId };
      return { id: h.docId, score: h.score, title: m.title };
    });
  }
  async count() {
    try { const meta = JSON.parse((await fs.readFile(this.metaFile, 'utf8')) || '{}'); return (meta.documents || []).length; } catch { return 0; }
  }
  async reset() { await fs.rm(this.base, { recursive: true, force: true }); }
}
