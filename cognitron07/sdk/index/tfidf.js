export function tokenize(text) {
  return (text || '').toLowerCase().replace(/[\n\r]/g, ' ').split(/[^a-z0-9]+/g).filter(Boolean);
}

export function addToIndex(idx, id, content, meta = undefined) {
  idx.df = idx.df || {}; idx.docs = idx.docs || {};
  const tf = {};
  for (const t of tokenize(content)) tf[t] = (tf[t] || 0) + 1;
  idx.docs[id] = { tf, meta };
  for (const term of Object.keys(tf)) idx.df[term] = (idx.df[term] || 0) + 1;
}

export function searchIndex(idx, query, page = 1, size = 5) {
  const q = tokenize(query);
  const qtf = {}; q.forEach(t => { qtf[t] = (qtf[t] || 0) + 1; });
  const N = Object.keys(idx.docs || {}).length || 1;
  const scores = [];
  for (const [docId, doc] of Object.entries(idx.docs || {})) {
    let score = 0;
    for (const [t, qf] of Object.entries(qtf)) {
      const df = idx.df?.[t] || 0; if (!df) continue;
      const idf = Math.log((N + 1) / (df + 1)) + 1;
      const tf = doc.tf?.[t] || 0;
      score += (qf * idf) * tf;
    }
    if (score > 0) scores.push({ docId, score, meta: doc.meta });
  }
  scores.sort((a, b) => b.score - a.score);
  return scores.slice((page - 1) * size, (page - 1) * size + size);
}

