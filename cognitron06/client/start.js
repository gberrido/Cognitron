#!/usr/bin/env node

/**
 * Cognitron06 CLI Launcher
 * Start the Cognitron06 CLI client
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(__dirname, 'src', 'cli.js');

console.log('🚀 Starting Cognitron06 CLI...');
console.log(`CLI Path: ${cliPath}`);
console.log('Server: http://localhost:8000');
console.log('');

// Start the CLI process with default arguments
const cli = spawn('node', [cliPath, 'chat', '--server', 'http://localhost:8000'], {
    stdio: 'inherit',
    cwd: __dirname
});

cli.on('close', (code) => {
    console.log(`\n👋 CLI exited with code ${code}`);
});

cli.on('error', (error) => {
    console.error('❌ Error running CLI:', error.message);
    console.error('💡 Make sure you are in the cognitron06/client directory');
    console.error('💡 And that the server is running: docker-compose up -d');
});