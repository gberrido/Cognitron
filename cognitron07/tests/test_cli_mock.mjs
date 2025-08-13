import { spawn } from 'child_process';
import path from 'path';
const baseDir = path.dirname(new URL(import.meta.url).pathname);
const cliPath = path.resolve(path.join(baseDir, '../cli/index.js'));
import { assertIncludes } from './util/assert.js';

function runCli(args, input, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cliPath, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`CLI exited ${code}\nSTDERR:\n${err}\nSTDOUT:\n${out}`));
      resolve(out);
    });
    // write the script, then end stdin
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

const script = [
  '/status',
  'My name is Testy',
  '/recall Testy 1 5',
  '/exit'
].join('\n') + '\n';

const output = await runCli(['--provider', 'mock'], script);
assertIncludes(output, 'Provider: mock', 'should show provider');
assertIncludes(output, '💬 AI Response:', 'should show response header');
console.log('OK cli_mock');
