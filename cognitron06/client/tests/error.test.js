import { test, strict as assert } from 'node:test';

test('Node Error cause is preserved', () => {
  const orig = new Error('original');
  const wrapped = new Error('wrapped', { cause: orig });
  assert.equal(wrapped.message, 'wrapped');
  assert.equal(wrapped.cause, orig);
});

