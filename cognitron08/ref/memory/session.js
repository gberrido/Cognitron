import fs from 'fs/promises';
import path from 'path';

export class SessionStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.sessionFile = path.join(dataDir, 'session-state.json');
    this.workingFile = path.join(dataDir, 'working-context.json');
    this.recallFile = path.join(dataDir, 'recall-storage.jsonl');
    this._workingQueue = Promise.resolve(); // Serialize working context writes
    this._sessionQueue = Promise.resolve(); // Serialize session state writes
  }
  async ensure() { await fs.mkdir(this.dataDir, { recursive: true }); }
  async loadWorking() {
    try {
      const data = await fs.readFile(this.workingFile, 'utf8');
      const parsed = JSON.parse(data);
      return new Map(parsed.entries || []);
    } catch (err) {
      return new Map();
    }
  }

  async saveWorking(map) {
    // Queue writes to prevent concurrent access issues
    this._workingQueue = this._workingQueue.then(async () => {
      await this.ensure();
      const tmpFile = `${this.workingFile}.tmp`;
      try {
        const data = {
          entries: Array.from(map.entries()),
          lastUpdated: new Date().toISOString()
        };
        // Atomic write: write to temp file, then rename
        await fs.writeFile(tmpFile, JSON.stringify(data, null, 2), 'utf8');
        await fs.rename(tmpFile, this.workingFile);
      } catch (err) {
        // Clean up temp file on error
        try { await fs.unlink(tmpFile); } catch {}
        throw new Error(`Failed to save working context: ${err.message}`);
      }
    });

    return this._workingQueue;
  }

  async loadSession() {
    try {
      const data = await fs.readFile(this.sessionFile, 'utf8');
      return JSON.parse(data);
    } catch (err) {
      return {};
    }
  }

  async saveSession(state) {
    // Queue writes to prevent concurrent access issues
    this._sessionQueue = this._sessionQueue.then(async () => {
      await this.ensure();
      const tmpFile = `${this.sessionFile}.tmp`;
      try {
        // Atomic write: write to temp file, then rename
        await fs.writeFile(tmpFile, JSON.stringify(state, null, 2), 'utf8');
        await fs.rename(tmpFile, this.sessionFile);
      } catch (err) {
        // Clean up temp file on error
        try { await fs.unlink(tmpFile); } catch {}
        throw new Error(`Failed to save session state: ${err.message}`);
      }
    });

    return this._sessionQueue;
  }
  async loadRecentConversation(n = 50) {
    try {
      const content = await fs.readFile(this.recallFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const recent = lines.slice(-n).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      return recent;
    } catch { return []; }
  }
  async resetNonArchival() {
    const filesToDelete = [
      'working-context.json',
      'recall-storage.jsonl',
      'recall-index.json',
      'session-state.json'
    ];
    for (const f of filesToDelete) {
      try {
        await fs.unlink(path.join(this.dataDir, f));
      } catch (err) {
        // Ignore if file doesn't exist
        if (err.code !== 'ENOENT') {
          console.warn(`Failed to delete ${f}: ${err.message}`);
        }
      }
    }
  }
}
