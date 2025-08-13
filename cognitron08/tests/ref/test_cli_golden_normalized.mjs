import { spawn } from 'child_process';
import path from 'path';
import { assertIncludes } from '../util/assert.js';
import { normalizeOutput } from '../util/normalize.js';

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const cliPath = path.resolve(path.join(baseDir, '../../cli/index.js'));

function runCLI(lines = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, '--provider', 'mock'], { env: { ...process.env }, stdio: 'pipe' });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`CLI exited ${code}\nSTDERR:\n${err}\nSTDOUT:\n${out}`));
      resolve({ out: normalizeOutput(out), err: normalizeOutput(err) });
    });
    const script = [...lines, '/exit'];
    let i = 0;
    const iv = setInterval(() => {
      if (i >= script.length) { clearInterval(iv); child.stdin.end(); return; }
      child.stdin.write(script[i++] + '\\n');
    }, 30);
  });
}

const { out } = await runCLI(['/status']);

assertIncludes(out, 'Provider: mock | Model: openai/gpt-oss-120b', 'provider summary');

console.log('OK ref_cli_golden_normalized');
