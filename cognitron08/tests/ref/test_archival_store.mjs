import { ArchivalStore } from '../../ref/memory/archival.js';
import { assert, assertIncludes } from '../util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const testDir = path.join(process.cwd(), '.test-tmp', 'archival-test');

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
  // Test 1: Basic insert and search
  {
    const store = new ArchivalStore(testDir);
    await store.ensure();

    const docId = await store.insert('Test Document', 'This is a test document about artificial intelligence');

    assert(typeof docId === 'string', 'Should return document ID');
    assertIncludes(docId, 'doc_', 'Document ID should start with "doc_"');

    const results = await store.search('artificial intelligence', 1, 10);
    assert(results.length >= 1, 'Should find the inserted document');
    assert(results[0].title === 'Test Document', 'Should return correct title');
  }

  // Test 2: Input validation
  {
    const store = new ArchivalStore(testDir);

    try {
      await store.insert('', 'content');
      assert(false, 'Should reject empty title');
    } catch (err) {
      assertIncludes(err.message, 'Title must be', 'Error should mention title');
    }

    try {
      await store.insert('title', '');
      assert(false, 'Should reject empty content');
    } catch (err) {
      assertIncludes(err.message, 'Content must be', 'Error should mention content');
    }
  }

  // Test 3: Filename sanitization (path traversal protection)
  {
    const store = new ArchivalStore(testDir);

    const maliciousTitle = '../../../etc/passwd';
    const docId = await store.insert(maliciousTitle, 'test content');

    // Check that file was created safely in the docs directory
    const docsDir = path.join(testDir, 'archival', 'documents');
    const files = await fs.readdir(docsDir);
    const docFile = files.find(f => f.includes(docId));

    assert(docFile !== undefined, 'Document file should exist');
    assert(!docFile.includes('..'), 'Filename should not contain ".."');
    assert(!docFile.includes('/'), 'Filename should not contain "/"');
  }

  // Test 4: Multiple documents with search
  {
    const store = new ArchivalStore(testDir);

    await store.insert('Machine Learning Basics', 'Introduction to supervised and unsupervised learning algorithms');
    await store.insert('Deep Learning Guide', 'Neural networks and backpropagation techniques');
    await store.insert('Data Science Overview', 'Statistics, visualization, and machine learning in practice');

    const mlResults = await store.search('machine learning', 1, 10);
    assert(mlResults.length >= 2, 'Should find documents about machine learning');

    const dlResults = await store.search('neural networks', 1, 10);
    assert(dlResults.length >= 1, 'Should find documents about neural networks');
  }

  // Test 5: Document count
  {
    const store = new ArchivalStore(testDir);
    const count = await store.count();
    assert(count >= 4, `Should have at least 4 documents, got ${count}`);
  }

  // Test 6: Concurrent inserts (race condition test)
  {
    const store = new ArchivalStore(testDir);

    const docs = [
      store.insert('Concurrent Doc 1', 'First concurrent document'),
      store.insert('Concurrent Doc 2', 'Second concurrent document'),
      store.insert('Concurrent Doc 3', 'Third concurrent document')
    ];

    const ids = await Promise.all(docs);

    assert(ids.length === 3, 'Should create 3 documents');
    assert(new Set(ids).size === 3, 'All document IDs should be unique');

    const finalCount = await store.count();
    assert(finalCount >= 7, `Count should increase to at least 7, got ${finalCount}`);
  }

  // Test 7: Large document handling
  {
    const store = new ArchivalStore(testDir);

    const largeContent = 'Lorem ipsum '.repeat(1000); // ~12KB
    const docId = await store.insert('Large Document', largeContent);

    const results = await store.search('Lorem ipsum', 1, 5);
    assert(results.length >= 1, 'Should find large document');
  }

  // Test 8: Empty search results
  {
    const store = new ArchivalStore(testDir);
    const results = await store.search('nonexistentqueryxyzabc', 1, 5);
    assert(Array.isArray(results), 'Should return array for no results');
    assert(results.length === 0, 'Should return empty array for no matches');
  }

  // Test 9: Pagination
  {
    const store = new ArchivalStore(testDir);

    // Insert multiple documents with same keyword
    for (let i = 0; i < 10; i++) {
      await store.insert(`Pagination Test ${i}`, `Document ${i} about pagination testing`);
    }

    const page1 = await store.search('pagination', 1, 3);
    const page2 = await store.search('pagination', 2, 3);
    const page3 = await store.search('pagination', 3, 3);

    assert(page1.length === 3, 'Page 1 should have 3 results');
    assert(page2.length === 3, 'Page 2 should have 3 results');
    assert(page3.length >= 1, 'Page 3 should have at least 1 result');

    // Check no overlaps
    const allIds = [...page1.map(r => r.id), ...page2.map(r => r.id), ...page3.map(r => r.id)];
    assert(new Set(allIds).size === allIds.length, 'Pages should not overlap');
  }

  // Test 10: Reset functionality
  {
    const store = new ArchivalStore(testDir);
    const countBefore = await store.count();
    assert(countBefore > 0, 'Should have documents before reset');

    await store.reset();

    const countAfter = await store.count();
    assert(countAfter === 0, 'Should have 0 documents after reset');
  }

  console.log('OK test_archival_store');
} catch (err) {
  console.error('FAIL test_archival_store:', err.message);
  console.error(err.stack);
  process.exit(1);
} finally {
  await cleanup();
}
