export function assert(cond, msg = 'Assertion failed') {
  if (!cond) throw new Error(msg);
}
export function assertEq(a, b, msg = undefined) {
  if (a !== b) throw new Error(msg || `Expected ${a} === ${b}`);
}
export function assertIncludes(haystack, needle, msg = undefined) {
  if (!String(haystack).includes(needle)) throw new Error(msg || `Expected to include: ${needle}`);
}
export async function expectThrows(fn, msgContains = '') {
  let threw = false;
  try { await fn(); } catch (e) { threw = true; if (msgContains) assertIncludes(e.message || String(e), msgContains); }
  if (!threw) throw new Error('Expected function to throw');
}

