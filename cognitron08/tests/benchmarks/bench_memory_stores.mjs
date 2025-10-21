/**
 * Performance benchmarks for memory stores
 * Run with: node tests/benchmarks/bench_memory_stores.mjs
 */

import { RecallStore } from '../../ref/memory/recall.js';
import { ArchivalStore } from '../../ref/memory/archival.js';
import { SessionStore } from '../../ref/memory/session.js';
import fs from 'fs/promises';
import path from 'path';

const testDir = path.join(process.cwd(), '.test-tmp', 'bench');

// Clean up test directory
async function cleanup() {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore if doesn't exist
  }
}

// Format duration
function formatDuration(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// Benchmark function
async function benchmark(name, iterations, fn) {
  // Warmup
  for (let i = 0; i < Math.min(iterations, 10); i++) {
    await fn();
  }

  // Actual benchmark
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    await fn();
  }
  const duration = Date.now() - start;

  const avgMs = duration / iterations;
  const opsPerSecond = Math.floor(1000 / avgMs);

  console.log(`  ${name}`);
  console.log(`    Iterations: ${iterations}`);
  console.log(`    Total time: ${formatDuration(duration)}`);
  console.log(`    Avg time: ${formatDuration(avgMs)}`);
  console.log(`    Ops/sec: ${opsPerSecond.toLocaleString()}`);
  console.log('');

  return { name, iterations, avgMs, opsPerSecond };
}

console.log('🏁 Memory Store Performance Benchmarks\n');
console.log('=' .repeat(60));
console.log('');

const results = [];

try {
  await cleanup();

  // ==================== RecallStore Benchmarks ====================
  console.log('📝 RecallStore Benchmarks');
  console.log('-'.repeat(60));
  console.log('');

  {
    const store = new RecallStore(testDir + '-recall-append');
    await store.ensure();

    const result = await benchmark('Append single message', 100, async () => {
      const msg = { id: Date.now(), role: 'user', content: 'Test message', timestamp: new Date().toISOString() };
      await store.appendMessages([msg]);
    });
    results.push(result);
  }

  {
    const store = new RecallStore(testDir + '-recall-batch');
    await store.ensure();

    const batch = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Batch message ${i}`,
      timestamp: new Date().toISOString()
    }));

    const result = await benchmark('Append batch (10 messages)', 50, async () => {
      await store.appendMessages(batch);
    });
    results.push(result);
  }

  {
    const store = new RecallStore(testDir + '-recall-search');
    await store.ensure();

    // Populate with data
    const messages = Array.from({ length: 1000 }, (_, i) => ({
      id: i,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i} about testing and benchmarks`,
      timestamp: new Date().toISOString()
    }));
    await store.appendMessages(messages);

    const result = await benchmark('Search in 1000 messages', 100, async () => {
      await store.search('testing', 1, 10);
    });
    results.push(result);
  }

  // ==================== ArchivalStore Benchmarks ====================
  console.log('📚 ArchivalStore Benchmarks');
  console.log('-'.repeat(60));
  console.log('');

  {
    const store = new ArchivalStore(testDir + '-archival-insert');
    await store.ensure();

    const result = await benchmark('Insert document (1KB)', 50, async () => {
      const content = 'Lorem ipsum '.repeat(100); // ~1.2KB
      await store.insert('Test Document', content);
    });
    results.push(result);
  }

  {
    const store = new ArchivalStore(testDir + '-archival-search');
    await store.ensure();

    // Populate with documents
    for (let i = 0; i < 100; i++) {
      await store.insert(`Document ${i}`, `Content ${i} about testing and performance benchmarks`);
    }

    const result = await benchmark('Search in 100 documents', 100, async () => {
      await store.search('testing', 1, 10);
    });
    results.push(result);
  }

  {
    const store = new ArchivalStore(testDir + '-archival-count');
    await store.ensure();

    // Populate
    for (let i = 0; i < 50; i++) {
      await store.insert(`Doc ${i}`, 'content');
    }

    const result = await benchmark('Count documents', 500, async () => {
      await store.count();
    });
    results.push(result);
  }

  // ==================== SessionStore Benchmarks ====================
  console.log('💾 SessionStore Benchmarks');
  console.log('-'.repeat(60));
  console.log('');

  {
    const store = new SessionStore(testDir + '-session-save');
    await store.ensure();

    const workingContext = new Map([
      ['key1', { value: 'value1', timestamp: new Date().toISOString() }],
      ['key2', { value: 'value2', timestamp: new Date().toISOString() }],
      ['key3', { value: 'value3', timestamp: new Date().toISOString() }]
    ]);

    const result = await benchmark('Save working context (3 entries)', 200, async () => {
      await store.saveWorking(workingContext);
    });
    results.push(result);
  }

  {
    const store = new SessionStore(testDir + '-session-load');
    await store.ensure();

    const workingContext = new Map([
      ['key1', { value: 'value1', timestamp: new Date().toISOString() }]
    ]);
    await store.saveWorking(workingContext);

    const result = await benchmark('Load working context', 500, async () => {
      await store.loadWorking();
    });
    results.push(result);
  }

  {
    const store = new SessionStore(testDir + '-session-state');
    await store.ensure();

    const state = {
      recursiveSummary: 'This is a test summary ' + 'x'.repeat(100),
      lastUpdated: new Date().toISOString()
    };

    const result = await benchmark('Save session state', 200, async () => {
      await store.saveSession(state);
    });
    results.push(result);
  }

  // ==================== Scalability Benchmarks ====================
  console.log('📊 Scalability Benchmarks');
  console.log('-'.repeat(60));
  console.log('');

  {
    const store = new RecallStore(testDir + '-recall-scale');
    await store.ensure();

    // Test with increasing sizes
    for (const size of [100, 1000, 5000]) {
      const messages = Array.from({ length: size }, (_, i) => ({
        id: i,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: new Date().toISOString()
      }));

      await store.appendMessages(messages);

      const start = Date.now();
      await store.search('Message', 1, 10);
      const duration = Date.now() - start;

      console.log(`  Search in ${size.toLocaleString()} messages: ${formatDuration(duration)}`);
    }
    console.log('');
  }

  {
    const store = new ArchivalStore(testDir + '-archival-scale');
    await store.ensure();

    for (const size of [10, 50, 100]) {
      for (let i = 0; i < size; i++) {
        await store.insert(`Document ${i}`, `Content for document ${i}`);
      }

      const start = Date.now();
      await store.search('document', 1, 10);
      const duration = Date.now() - start;

      console.log(`  Search in ${size} documents: ${formatDuration(duration)}`);
    }
    console.log('');
  }

  // ==================== Summary ====================
  console.log('=' .repeat(60));
  console.log('📋 Summary');
  console.log('=' .repeat(60));
  console.log('');

  // Find fastest/slowest operations
  const sorted = [...results].sort((a, b) => a.avgMs - b.avgMs);
  const fastest = sorted[0];
  const slowest = sorted[sorted.length - 1];

  console.log(`Fastest: ${fastest.name}`);
  console.log(`  ${formatDuration(fastest.avgMs)} (${fastest.opsPerSecond.toLocaleString()} ops/sec)`);
  console.log('');
  console.log(`Slowest: ${slowest.name}`);
  console.log(`  ${formatDuration(slowest.avgMs)} (${slowest.opsPerSecond.toLocaleString()} ops/sec)`);
  console.log('');

  // Performance tiers
  console.log('Performance Tiers:');
  const fast = results.filter(r => r.avgMs < 1);
  const medium = results.filter(r => r.avgMs >= 1 && r.avgMs < 10);
  const slow = results.filter(r => r.avgMs >= 10);

  console.log(`  Fast (< 1ms): ${fast.length} operations`);
  console.log(`  Medium (1-10ms): ${medium.length} operations`);
  console.log(`  Slow (> 10ms): ${slow.length} operations`);
  console.log('');

  console.log('✅ All benchmarks completed successfully!');

} catch (err) {
  console.error('❌ Benchmark error:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  await cleanup();
}
