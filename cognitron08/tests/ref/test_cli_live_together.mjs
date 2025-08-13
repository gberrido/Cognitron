import { spawn } from 'child_process';
import path from 'path';
import { assertIncludes } from '../util/assert.js';

if (!process.env.TOGETHER_API_KEY) { console.log('SKIP ref_cli_live_together (no TOGETHER_API_KEY)'); process.exit(0); }

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const cliPath = path.resolve(path.join(baseDir, '../../cli/index.js'));

function runCli(args, input, env = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, ...env }, stdio: ['pipe','pipe','pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('close', (code) => { if (code !== 0) return reject(new Error(`CLI exited ${code}\nSTDERR:\n${err}\nSTDOUT:\n${out}`)); resolve(out); });
    proc.stdin.write(input); proc.stdin.end();
  });
}

const script = ['/status','Hello live','/exit'].join('\n') + '\n';
const output = await runCli(['--provider','together'], script);
assertIncludes(output, 'Provider: together', 'should show provider');
console.log('OK ref_cli_live_together');
