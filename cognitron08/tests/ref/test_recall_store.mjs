import { RecallStore } from '../../ref/memory/recall.js';
import { assert, assertIncludes } from '../util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const testDir = path.join(process.cwd(), '.test-tmp', 'recall-test');

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
  // Test 1: Basic append and search
  {
    const store = new RecallStore(testDir);
    await store.ensure();

    const messages = [
      { id: 1, role: 'user', content: 'Hello, my name is Alice', timestamp: new Date().toISOString() },
      { id: 2, role: 'assistant', content: 'Nice to meet you, Alice!', timestamp: new Date().toISOString() }
    ];

    await store.appendMessages(messages);

    const results = await store.search('Alice', 1, 10);
    assert(results.length >= 1, 'Should find at least one result for "Alice"');
    // Check if content exists and contains Alice
    const hasAlice = results.some(r => r.content && r.content.includes('Alice'));
    assert(hasAlice, `At least one result should contain "Alice". Got: ${JSON.stringify(results.map(r => ({ id: r.id, content: r.content })))}`);
  }

  // Test 2: Concurrent appends (race condition test)
  {
    const store = new RecallStore(testDir);
    await store.ensure(); // Ensure directory and index exist

    const messages1 = [{ id: 3, role: 'user', content: 'First concurrent message', timestamp: new Date().toISOString() }];
    const messages2 = [{ id: 4, role: 'user', content: 'Second concurrent message', timestamp: new Date().toISOString() }];
    const messages3 = [{ id: 5, role: 'user', content: 'Third concurrent message', timestamp: new Date().toISOString() }];

    // Run concurrently
    await Promise.all([
      store.appendMessages(messages1),
      store.appendMessages(messages2),
      store.appendMessages(messages3)
    ]);

    // Verify all messages were saved
    const results = await store.search('concurrent', 1, 10);
    assert(results.length === 3, `Should find 3 concurrent messages, found ${results.length}`);
  }

  // Test 3: Empty query handling
  {
    const store = new RecallStore(testDir);
    const results = await store.search('', 1, 5);
    assert(Array.isArray(results), 'Should return empty array for empty query');
  }

  // Test 4: Large batch append
  {
    const store = new RecallStore(testDir);
    const largeBatch = [];
    for (let i = 0; i < 100; i++) {
      largeBatch.push({
        id: 100 + i,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Test message number ${i} about testing`,
        timestamp: new Date().toISOString()
      });
    }

    await store.appendMessages(largeBatch);

    const results = await store.search('testing', 1, 50);
    assert(results.length > 0, 'Should find messages after large batch append');
  }

  // Test 5: Pagination
  {
    const store = new RecallStore(testDir);
    const page1 = await store.search('test', 1, 5);
    const page2 = await store.search('test', 2, 5);

    assert(Array.isArray(page1), 'Page 1 should be an array');
    assert(Array.isArray(page2), 'Page 2 should be an array');

    // Pages should not overlap (if there are enough results)
    if (page1.length === 5 && page2.length > 0) {
      const page1Ids = new Set(page1.map(r => r.id));
      const overlap = page2.some(r => page1Ids.has(r.id));
      assert(!overlap, 'Pages should not overlap');
    }
  }

  // Test 6: Special characters in content
  {
    const store = new RecallStore(testDir);
    const specialMessages = [
      { id: 500, role: 'user', content: 'Test with "quotes" and \'apostrophes\'', timestamp: new Date().toISOString() },
      { id: 501, role: 'user', content: 'Test with\nnewlines\nand\ttabs', timestamp: new Date().toISOString() },
      { id: 502, role: 'user', content: 'Test with émojis 😀 and ñoñ-ASCII', timestamp: new Date().toISOString() }
    ];

    await store.appendMessages(specialMessages);

    const results = await store.search('quotes', 1, 5);
    assert(results.length > 0, 'Should handle special characters in content');
  }

  // Test 7: TF-IDF relevance scoring
  {
    const store = new RecallStore(testDir);
    const messages = [
      { id: 600, role: 'user', content: 'The quick brown fox jumps', timestamp: new Date().toISOString() },
      { id: 601, role: 'user', content: 'The lazy dog sleeps', timestamp: new Date().toISOString() },
      { id: 602, role: 'user', content: 'Fox fox fox everywhere', timestamp: new Date().toISOString() }
    ];

    await store.appendMessages(messages);

    const results = await store.search('fox', 1, 10);
    assert(results.length >= 2, 'Should find messages containing "fox"');
    // Message 602 should score higher due to term frequency
    assert(results[0].id === 602, 'Message with higher term frequency should rank first');
  }

  console.log('OK test_recall_store');
} catch (err) {
  console.error('FAIL test_recall_store:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  await cleanup();
}
