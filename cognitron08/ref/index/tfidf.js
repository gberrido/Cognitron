function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .filter(Boolean);
}

export function addToIndex(index, docId, text, meta = {}) {
  index.df = index.df || {};
  index.docs = index.docs || {};
  const tokens = tokenize(text);
  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
  for (const term of new Set(tokens)) index.df[term] = (index.df[term] || 0) + 1;
  index.docs[docId] = { tf, len: tokens.length || 1, meta };
}

export function searchIndex(index, query, page = 1, size = 5) {
  index.df = index.df || {}; index.docs = index.docs || {};
  const qTokens = tokenize(query);
  const N = Object.keys(index.docs).length || 1;
  const scores = [];
  for (const [id, doc] of Object.entries(index.docs)) {
    let score = 0;
    for (const qt of qTokens) {
      const df = index.df[qt] || 0;
      const idf = Math.log(1 + N / (1 + df));
      const tf = (doc.tf[qt] || 0) / doc.len;
      score += tf * idf;
    }
    if (score > 0) scores.push({ docId: id, score, meta: doc.meta });
  }
  scores.sort((a,b) => b.score - a.score);
  const start = (page - 1) * size;
  return scores.slice(start, start + size);
}
