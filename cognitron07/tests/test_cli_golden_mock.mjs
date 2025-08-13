import { spawn } from 'child_process';
import path from 'path';
import { assertIncludes } from './util/assert.js';

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const cliPath = path.resolve(path.join(baseDir, '../cli/index.js'));

function runCLI(lines = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, '--provider', 'mock'], { env: { ...process.env }, stdio: 'pipe' });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`CLI exited ${code}\nSTDERR:\n${err}\nSTDOUT:\n${out}`));
      resolve({ out, err });
    });
    const script = [...lines, '/exit'];
    setTimeout(() => { child.stdin.write(script.join('\n')); child.stdin.end(); }, 50);
  });
}

const { out } = await runCLI([
  '/status',
  '/debugtools',
  'Hello there',
  '/stream',
  'A second turn',
]);

assertIncludes(out, 'Provider:', 'status printed');
assertIncludes(out, 'DebugTools is now', 'debugtools toggled');
assertIncludes(out, '💬 AI Response:', 'response header shown');
assertIncludes(out, 'Streaming is now', 'stream toggled');

console.log('OK cli_golden_mock');
