import fs from 'fs/promises';
import path from 'path';

export class SessionStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.sessionFile = path.join(dataDir, 'session-state.json');
    this.workingFile = path.join(dataDir, 'working-context.json');
    this.recallFile = path.join(dataDir, 'recall-storage.jsonl');
  }
  async ensure() { await fs.mkdir(this.dataDir, { recursive: true }); }
  async loadWorking() {
    try { const d = JSON.parse(await fs.readFile(this.workingFile, 'utf8')); return new Map(d.entries || []); } catch { return new Map(); }
  }
  async saveWorking(map) {
    await fs.writeFile(this.workingFile, JSON.stringify({ entries: Array.from(map.entries()), lastUpdated: new Date().toISOString() }, null, 2));
  }
  async loadSession() {
    try { return JSON.parse(await fs.readFile(this.sessionFile, 'utf8')); } catch { return {}; }
  }
  async saveSession(state) { await fs.writeFile(this.sessionFile, JSON.stringify(state, null, 2)); }
  async loadRecentConversation(n = 50) {
    try {
      const content = await fs.readFile(this.recallFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const recent = lines.slice(-n).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return recent;
    } catch { return []; }
  }
  async resetNonArchival() {
    for (const f of ['working-context.json', 'recall-storage.jsonl', 'session-state.json']) {
      try { await fs.unlink(path.join(this.dataDir, f)); } catch {}
    }
  }
}
