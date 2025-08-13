#!/usr/bin/env node

/**
 * Wrapper script to run the Cognitron06 CLI from current directory
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, '../cognitron06/client/src/cli.js');

console.log('🚀 Starting Cognitron06 CLI...');
console.log(`CLI Path: ${cliPath}`);

// Start the CLI process
const cli = spawn('node', [cliPath, 'chat', '--server', 'http://localhost:8000'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '../cognitron06/client')
});

cli.on('close', (code) => {
    console.log(`\n👋 CLI exited with code ${code}`);
});

cli.on('error', (error) => {
    console.error('❌ Error running CLI:', error.message);
});