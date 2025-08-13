import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { RefAgent } from '../../ref/agent.js';
import { normalizeOutput } from '../util/normalize.js';
import { assertIncludes } from '../util/assert.js';

// Prepare temp workspace with a data dir that the CLI will use by default
const baseDir = path.dirname(new URL(import.meta.url).pathname);
const baseTmp = path.resolve(path.join(baseDir, '..', '..', '.test-tmp'));
await fs.mkdir(baseTmp, { recursive: true });
const runId = `golden-ra-${Date.now()}`;
const cwd = path.join(baseTmp, runId);
const dataDir = path.join(cwd, 'cognitron08-data');
await fs.mkdir(dataDir, { recursive: true });

// Seed recall and archival using RefAgent directly pointing to that dataDir
const agent = new RefAgent({ provider: 'mock', dataDir });
await agent.initProviders();
await agent.loadState();
// Seed recall messages
const now = new Date().toISOString();
await agent.recall.appendMessages([
  { id: 1, role: 'user', content: 'alpha project kickoff', timestamp: now },
  { id: 2, role: 'assistant', content: 'noted alpha details', timestamp: now },
  { id: 3, role: 'user', content: 'beta unrelated', timestamp: now }
]);
// Seed archival docs
await agent.archival.insert('doc_alpha_notes', 'alpha contains core goals and scope.');
await agent.archival.insert('doc_misc', 'miscellany unrelated');

// Run CLI in that cwd and issue recall/arch commands
const cliPath = path.resolve(path.join(baseDir, '..', '..', 'cli', 'index.js'));
function runCLI(lines = [], paceMs = 30) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, '--provider', 'mock'], { env: { ...process.env }, stdio: 'pipe', cwd });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`CLI exited ${code}\nSTDERR:\n${err}\nSTDOUT:\n${out}`));
      resolve({ out: normalizeOutput(out), err: normalizeOutput(err) });
    });
    const script = [...lines, '/exit'];
    let i = 0;
    const iv = setInterval(() => { if (i >= script.length) { clearInterval(iv); child.stdin.end(); return; } child.stdin.write(script[i++] + '\n'); }, paceMs);
  });
}

// Run recall first in its own short session to avoid readline close races
const { out: outRecall } = await runCLI([
  '/status',
  '/recall "alpha" 1 5'
]);
assertIncludes(outRecall, 'Recall results (page 1, size 5):', 'recall header');

// Then run archival search in a separate session reusing the same cwd
const { out: outArch } = await runCLI([
  '/arch "alpha" 1 5'
], 300);
console.log('---OUT ARCH---\n'+outArch);
assertIncludes(outArch, 'Archival results (page 1, size 5):', 'archival header');
assertIncludes(outArch, 'doc_alpha_notes', 'archival title present');

console.log('OK ref_cli_golden_recall_arch');
