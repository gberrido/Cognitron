export function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
export function assertEq(a, b, msg) { if (a !== b) throw new Error(msg || `Expected ${a} === ${b}`); }
export function assertIncludes(haystack, needle, msg) {
  if (!String(haystack).includes(needle)) throw new Error(msg || `Expected to include: ${needle}`);
}
