import { spawn } from 'child_process';
import path from 'path';

const baseDir = path.dirname(new URL(import.meta.url).pathname);
const tests = [
  './core/test_kernel_basic.mjs',
  './core/test_kernel_multi_tool.mjs',
  './core/test_kernel_error_flow.mjs',
  './core/test_kernel_max_heartbeats.mjs',
  './ref/test_cli_mock.mjs',
  './ref/test_cli_golden_mock.mjs',
  './ref/test_cli_golden_normalized.mjs',
  './ref/test_cli_script_mode.mjs',
  './ref/test_token_budgets.mjs',
  './ref/test_cli_golden_recall_arch.mjs'
];

async function runNode(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(baseDir, file)], { stdio: 'inherit' });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)));
  });
}

let passed = 0;
for (const t of tests) {
  try { await runNode(t); passed++; }
  catch (e) { console.error('FAIL', t, e.message); process.exitCode = 1; break; }
}
if (process.exitCode !== 1) console.log(`All tests passed (${passed}/${tests.length})`);

// Optional live tests
const live = [];
if (process.env.GROQ_API_KEY) { live.push('./ref/test_cli_live_groq.mjs', './ref/test_cli_live_stream_groq.mjs'); }
(async () => {
  if (!live.length) return;
  for (const t of live) {
    try { await (new Promise((resolve,reject)=>{ const p2 = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), t)], { stdio: 'inherit' }); p2.on('close', (c)=> c===0?resolve():reject(new Error(`${t} exited ${c}`))); })); }
    catch (e) { console.error('FAIL', t, e.message); process.exitCode = 1; break; }
  }
})();

const liveTogether = [];
if (process.env.TOGETHER_API_KEY) { liveTogether.push('./ref/test_cli_live_together.mjs', './ref/test_cli_live_stream_together.mjs'); }
(async () => {
  if (!liveTogether.length) return;
  for (const t of liveTogether) {
    try { await (new Promise((resolve,reject)=>{ const p2 = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), t)], { stdio: 'inherit' }); p2.on('close', (c)=> c===0?resolve():reject(new Error(`${t} exited ${c}`))); })); }
    catch (e) { console.error('FAIL', t, e.message); process.exitCode = 1; break; }
  }
})();
