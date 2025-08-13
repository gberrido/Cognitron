import { spawn } from 'child_process';
import path from 'path';
import { assertIncludes } from '../util/assert.js';

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const cliPath = path.resolve(path.join(baseDir, '../../cli/index.js'));

function runCliScript(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cliPath, '--provider', 'mock', '--script'], { stdio: ['pipe','pipe','pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`CLI exited ${code}\nSTDERR:\n${err}\nSTDOUT:\n${out}`));
      resolve(out);
    });
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

const script = ['/status', 'Hello there', '/exit'].join('\n') + '\n';
const output = await runCliScript(script);
assertIncludes(output, 'Provider Status:', 'should show provider status');
assertIncludes(output, '💬 AI Response:', 'should show response header');
console.log('OK ref_cli_script_mode');
