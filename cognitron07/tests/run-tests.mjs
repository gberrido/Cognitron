import { spawn } from 'child_process';
import path from 'path';

const baseDir = path.dirname(new URL(import.meta.url).pathname);

const tests = [
  './test_mock_basic.mjs',
  './test_tool_api.mjs',
  './test_tool_errors.mjs',
  './test_recall_archival.mjs',
  './test_state_persistence.mjs',
  './test_autosum_mock.mjs',
  './test_token_budgets.mjs',
  './test_cli_mock.mjs',
  './test_cli_golden_mock.mjs',
];

async function runNode(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(baseDir, file)], { stdio: 'inherit' });
    p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)));
  });
}

let passed = 0;
for (const t of tests) {
  try {
    await runNode(t);
    passed++;
  } catch (e) {
    console.error('FAIL', t, e.message);
    process.exitCode = 1;
    break;
  }
}
if (process.exitCode !== 1) {
  console.log(`Offline tests passed (${passed}/${tests.length})`);
}

// Optional live tests (run only if keys are provided)
const live = [];
if (process.env.GROQ_API_KEY) {
  live.push('./test_cli_live_groq.mjs');
  live.push('./test_cli_live_stream_groq.mjs');
}
if (process.env.TOGETHER_API_KEY) {
  live.push('./test_cli_live_together.mjs');
  live.push('./test_cli_live_stream_together.mjs');
}

if (live.length) {
  let livePassed = 0;
  for (const t of live) {
    try {
      await runNode(t);
      livePassed++;
    } catch (e) {
      console.error('FAIL', t, e.message);
      process.exitCode = 1;
      break;
    }
  }
  if (process.exitCode !== 1) console.log(`Live tests passed (${livePassed}/${live.length})`);
}
