import { spawn } from 'child_process';
import path from 'path';
import { assertIncludes } from '../util/assert.js';

if (!process.env.GROQ_API_KEY) { console.log('SKIP ref_cli_live_stream_groq (no GROQ_API_KEY)'); process.exit(0); }

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

const script = ['/stream','Say hi in one short sentence','/exit'].join('\n') + '\n';
const output = await runCli(['--provider','groq'], script);
assertIncludes(output, 'Provider: groq', 'should show provider');
console.log('OK ref_cli_live_stream_groq');
