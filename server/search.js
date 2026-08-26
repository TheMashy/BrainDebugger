/**
 * SPEC 6 - Recherche textuelle, v1 : BM25 maison. Zero dependance.
 * Suffisant sous ~200 entrees textuelles. La v2 (embeddings locaux via
 * transformers.js) remplacera `score()` sans toucher au reste.
 */

export const K1 = 1.5;
export const B = 0.75;

// stopwords francais + anglais courants (le corpus est bilingue chez l'utilisateur)
const STOP = new Set(`
au aux avec ce ces dans de des du elle en et eux il ils je la le les leur lui ma mais me meme mes
moi mon ne nos notre nous on ou par pas pour qu que qui sa se ses son sur ta te tes toi ton tu un
une vos votre vous y etre avoir faire tout tous toute toutes plus moins tres bien mal peu trop
ai as est sont etait etais ete suis sommes etes ont avait avais avons avez fait fais font
ca cela celui celle ceux comme donc alors quand car si sans sous entre vers chez deux dej deja
the a an and or but of to in is are was were be been being have has had do does did for on at
it its this that these those i you he she they we me my your our their not no so as with from
`.trim().split(/\s+/));

export function tokenize(text) {
  return (text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // SPEC 6 - normalisation NFD
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map(t => t.replace(/^'+|'+$/g, ''))
    .filter(t => t.length >= 2 && !STOP.has(t));
}

export function buildIndex(docs) {
  // docs : [{ id, text }]
  const postings = new Map();        // term -> Map(docId -> tf)
  const lengths = new Map();
  let totalLen = 0;

  for (const d of docs) {
    const toks = tokenize(d.text);
    lengths.set(d.id, toks.length);
    totalLen += toks.length;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [t, n] of tf) {
      if (!postings.has(t)) postings.set(t, new Map());
      postings.get(t).set(d.id, n);
    }
  }
  return {
    postings,
    lengths,
    N: docs.length,
    avgLen: docs.length ? totalLen / docs.length : 0
  };
}

export function search(index, query, { limit = 10, exclude = new Set() } = {}) {
  const terms = tokenize(query);
  if (!terms.length || index.N === 0) return [];

  const scores = new Map();
  const matched = new Map();     // docId -> Set(terms) : sert a montrer POURQUOI ca matche

  for (const term of terms) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const df = posting.size;
    const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5));
    for (const [docId, tf] of posting) {
      if (exclude.has(docId)) continue;
      const len = index.lengths.get(docId) ?? 0;
      const denom = tf + K1 * (1 - B + B * (len / (index.avgLen || 1)));
      scores.set(docId, (scores.get(docId) ?? 0) + idf * (tf * (K1 + 1)) / denom);
      if (!matched.has(docId)) matched.set(docId, new Set());
      matched.get(docId).add(term);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score: Math.round(score * 1000) / 1000, terms: [...matched.get(id)] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
