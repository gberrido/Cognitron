import { SessionStore } from '../../ref/memory/session.js';
import { assert } from '../util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const testDir = path.join(process.cwd(), '.test-tmp', 'session-test');

// Clean up test directory
async function cleanup() {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch (err) {
    // Ignore if doesn't exist
  }
}

// Setup and teardown
await cleanup();

try {
  // Test 1: Basic working context save/load
  {
    const store = new SessionStore(testDir);
    await store.ensure();

    const workingContext = new Map([
      ['user_name', { value: 'Alice', timestamp: new Date().toISOString() }],
      ['user_location', { value: 'San Francisco', timestamp: new Date().toISOString() }]
    ]);

    await store.saveWorking(workingContext);

    const loaded = await store.loadWorking();
    assert(loaded instanceof Map, 'Should return a Map');
    assert(loaded.size === 2, `Should have 2 entries, got ${loaded.size}`);
    assert(loaded.get('user_name').value === 'Alice', 'Should load correct value for user_name');
    assert(loaded.get('user_location').value === 'San Francisco', 'Should load correct value for user_location');
  }

  // Test 2: Empty working context
  {
    const store = new SessionStore(testDir);
    await store.ensure();

    const emptyMap = new Map();
    await store.saveWorking(emptyMap);

    const loaded = await store.loadWorking();
    assert(loaded instanceof Map, 'Should return a Map');
    assert(loaded.size === 0, 'Should be empty after saving empty map');
  }

  // Test 3: Session state save/load
  {
    const store = new SessionStore(testDir);
    await store.ensure();

    const state = {
      recursiveSummary: 'This is a test summary of the conversation',
      lastUpdated: new Date().toISOString()
    };

    await store.saveSession(state);

    const loaded = await store.loadSession();
    assert(typeof loaded === 'object', 'Should return an object');
    assert(loaded.recursiveSummary === state.recursiveSummary, 'Should preserve recursive summary');
    assert(loaded.lastUpdated === state.lastUpdated, 'Should preserve lastUpdated timestamp');
  }

  // Test 4: Load non-existent files (graceful degradation)
  {
    const newDir = path.join(testDir, 'nonexistent');
    const store = new SessionStore(newDir);

    const working = await store.loadWorking();
    assert(working instanceof Map, 'Should return empty Map for non-existent working file');
    assert(working.size === 0, 'Should be empty');

    const session = await store.loadSession();
    assert(typeof session === 'object', 'Should return empty object for non-existent session file');
    assert(Object.keys(session).length === 0, 'Should be empty object');
  }

  // Test 5: Concurrent saves (race condition test)
  {
    const store = new SessionStore(testDir);

    const map1 = new Map([['key1', { value: 'value1', timestamp: new Date().toISOString() }]]);
    const map2 = new Map([['key2', { value: 'value2', timestamp: new Date().toISOString() }]]);
    const map3 = new Map([['key3', { value: 'value3', timestamp: new Date().toISOString() }]]);

    // Run saves concurrently - last one should win due to atomic writes
    await Promise.all([
      store.saveWorking(map1),
      store.saveWorking(map2),
      store.saveWorking(map3)
    ]);

    // Load and verify no corruption
    const loaded = await store.loadWorking();
    assert(loaded instanceof Map, 'Should load valid Map after concurrent saves');
    assert(loaded.size >= 1, 'Should have at least one entry');

    // One of the maps should have won
    const hasKey1 = loaded.has('key1');
    const hasKey2 = loaded.has('key2');
    const hasKey3 = loaded.has('key3');
    assert(hasKey1 || hasKey2 || hasKey3, 'Should have one of the saved keys');
  }

  // Test 6: Recent conversation loading
  {
    const store = new SessionStore(testDir);
    await store.ensure();

    // Create recall storage file manually
    const recallFile = path.join(testDir, 'recall-storage.jsonl');
    const messages = [];
    for (let i = 0; i < 100; i++) {
      messages.push(JSON.stringify({
        id: i,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        timestamp: new Date().toISOString()
      }));
    }
    await fs.writeFile(recallFile, messages.join('\n') + '\n', 'utf8');

    const recent = await store.loadRecentConversation(50);
    assert(Array.isArray(recent), 'Should return an array');
    assert(recent.length === 50, `Should return 50 most recent messages, got ${recent.length}`);
    assert(recent[0].id === 50, 'Should start with message 50 (last 50 messages)');
    assert(recent[49].id === 99, 'Should end with message 99');
  }

  // Test 7: Recent conversation with malformed JSONL
  {
    const store = new SessionStore(testDir);
    await store.ensure();

    const recallFile = path.join(testDir, 'recall-storage.jsonl');
    const lines = [
      JSON.stringify({ id: 1, role: 'user', content: 'Valid message 1' }),
      'invalid json line',
      JSON.stringify({ id: 2, role: 'assistant', content: 'Valid message 2' }),
      '{"incomplete": ',
      JSON.stringify({ id: 3, role: 'user', content: 'Valid message 3' })
    ];
    await fs.writeFile(recallFile, lines.join('\n') + '\n', 'utf8');

    const recent = await store.loadRecentConversation(10);
    assert(Array.isArray(recent), 'Should return an array');
    assert(recent.length === 3, 'Should skip malformed lines and return 3 valid messages');
  }

  // Test 8: Reset non-archival data
  {
    const store = new SessionStore(testDir);
    await store.ensure();

    // Create test files
    await store.saveWorking(new Map([['test', { value: 'data', timestamp: new Date().toISOString() }]]));
    await store.saveSession({ test: 'session' });
    await fs.writeFile(path.join(testDir, 'recall-storage.jsonl'), 'test\n', 'utf8');
    await fs.writeFile(path.join(testDir, 'recall-index.json'), '{}', 'utf8');

    await store.resetNonArchival();

    // Verify files are deleted
    const files = await fs.readdir(testDir);
    assert(!files.includes('working-context.json'), 'working-context.json should be deleted');
    assert(!files.includes('session-state.json'), 'session-state.json should be deleted');
    assert(!files.includes('recall-storage.jsonl'), 'recall-storage.jsonl should be deleted');
    assert(!files.includes('recall-index.json'), 'recall-index.json should be deleted');
  }

  // Test 9: Large working context
  {
    const store = new SessionStore(testDir);
    await store.ensure();

    const largeMap = new Map();
    for (let i = 0; i < 1000; i++) {
      largeMap.set(`key_${i}`, {
        value: `value_${i}`.repeat(10),
        timestamp: new Date().toISOString()
      });
    }

    await store.saveWorking(largeMap);

    const loaded = await store.loadWorking();
    assert(loaded.size === 1000, `Should save and load 1000 entries, got ${loaded.size}`);
    assert(loaded.get('key_0').value === 'value_0'.repeat(10), 'Should preserve values correctly');
  }

  // Test 10: Special characters in values
  {
    const store = new SessionStore(testDir);
    await store.ensure();

    const specialMap = new Map([
      ['quotes', { value: 'Test with "quotes" and \'apostrophes\'', timestamp: new Date().toISOString() }],
      ['newlines', { value: 'Test with\nnewlines\nand\ttabs', timestamp: new Date().toISOString() }],
      ['unicode', { value: 'Test with émojis 😀 and ñoñ-ASCII', timestamp: new Date().toISOString() }]
    ]);

    await store.saveWorking(specialMap);

    const loaded = await store.loadWorking();
    assert(loaded.get('quotes').value.includes('"quotes"'), 'Should handle quotes');
    assert(loaded.get('newlines').value.includes('\n'), 'Should handle newlines');
    assert(loaded.get('unicode').value.includes('😀'), 'Should handle unicode');
  }

  console.log('OK test_session_store');
} catch (err) {
  console.error('FAIL test_session_store:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  await cleanup();
}
