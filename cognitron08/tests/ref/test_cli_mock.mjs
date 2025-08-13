import { spawn } from 'child_process';
import path from 'path';
import { assertIncludes } from '../util/assert.js';

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const cliPath = path.resolve(path.join(baseDir, '../../cli/index.js'));

function runCLI(lines = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, '--provider', 'mock'], { env: { ...process.env }, stdio: 'pipe' });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`CLI exited ${code}
STDERR:
${err}
STDOUT:
${out}`));
      resolve({ out, err });
    });
    // Write lines with small pacing to avoid readline close races
    const script = [...lines, '/exit'];
    let i = 0;
    const iv = setInterval(() => {
      if (i >= script.length) { clearInterval(iv); child.stdin.end(); return; }
      child.stdin.write(script[i++] + '\n');
    }, 30);
  });
}

const { out } = await runCLI(['/status', 'My name is Alice', '/recall Alice 1 5']);
assertIncludes(out, 'Provider: mock', 'status should print provider');
assertIncludes(out, '💬 AI Response:', 'should print response header');
console.log('OK ref_cli_mock');
