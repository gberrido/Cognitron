import { RecallStore } from '../sdk/memory/recall.js';
import { ArchivalStore } from '../sdk/memory/archival.js';
import { assert, assertEq } from './util/assert.js';
import fs from 'fs/promises';
import path from 'path';

const tmp = path.join('./cognitron07/.test-tmp', `rec-arch-${Date.now()}`);
await fs.mkdir(tmp, { recursive: true });

const recall = new RecallStore(tmp);
await recall.ensure();
await recall.appendMessages([
  { id: 1, role: 'user', content: 'I love pizza', timestamp: new Date().toISOString() },
  { id: 2, role: 'assistant', content: 'Noted your preference.', timestamp: new Date().toISOString() },
  { id: 3, role: 'user', content: 'I also like pasta', timestamp: new Date().toISOString() },
]);
const hits = await recall.search('pizza', 1, 2);
assertEq(hits.length, 1);

const arch = new ArchivalStore(tmp);
await arch.ensure();
const id1 = await arch.insert('Food Notes', 'Pizza and pasta are popular.');
const id2 = await arch.insert('Other', 'Something unrelated.');
const ahits = await arch.search('pasta', 1, 5);
assertEq(ahits.length, 1);

console.log('OK recall_archival');

