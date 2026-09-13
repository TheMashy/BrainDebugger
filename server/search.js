/**
 * SPEC 6 - Recherche textuelle, v1 : BM25 maison. Zero dependance.
 * Suffisant sous ~200 entrees textuelles. La v2 (embeddings locaux via
 * transformers.js) remplacera `score()` sans toucher au reste.
 *
 * BM25 repond a « ce mot est-il rare ? ». Le Miroir, lui, doit repondre a
 * « pourquoi ces deux journees se ressemblent ? », et la rarete y ment : sur un
 * journal, « different » et « fois » sont discriminants et vides, « fatigue »
 * est frequent et central. Le lexique (server/lexique.js) redresse ca en
 * ponderant l'idf -- il ne change ni la formule ni l'ordre des documents pour
 * les mots neutres, il empeche seulement le remplissage de gagner.
 */

import { poids, saillant, CREUX, expressions } from './lexique.js';

export const K1 = 1.5;
export const B = 0.75;

/** Combien de « pourquoi » on montre par rapprochement. */
export const MAX_TERMES = 4;

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

/*
 * L'elision. « c'est », « j'ai », « j'etais », « n'avance », « d'urgence » :
 * sans ce decoupage ils restent des tokens entiers, echappent aux stopwords, et
 * finissent par etre les mots qui « expliquent » un rapprochement -- deux
 * journees mises cote a cote parce qu'elles disent toutes les deux « c'est ».
 * C'est le premier producteur de bruit sur un journal francais, et ca ne se
 * voit qu'a l'usage.
 */
const ELISION = /\b(qu|jusqu|lorsqu|puisqu|quoiqu|[cdjlmnst])'/g;

/** Tous les mots, stopwords compris : la detection d'expressions en a besoin. */
function mots(text) {
  return (text ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // SPEC 6 - normalisation NFD
    .toLowerCase()
    .replace(ELISION, '$1 ')
    .split(/[^a-z0-9']+/)
    .map(t => t.replace(/^'+|'+$/g, ''))
    .filter(Boolean);
}

export function tokenize(text) {
  const bruts = mots(text);
  const toks = bruts.filter(t => t.length >= 2 && !STOP.has(t) && !CREUX.has(t));
  // « envie de disparaitre » est indexe comme un token a lui seul. Le « _ » est
  // un espace de noms sur : le decoupage ci-dessus n'en produit jamais.
  for (const e of expressions(bruts)) toks.push(e);
  return toks;
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
  const matched = new Map();     // docId -> Map(term -> apport) : POURQUOI ca matche

  for (const term of new Set(terms)) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const df = posting.size;
    const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5)) * poids(term);
    for (const [docId, tf] of posting) {
      if (exclude.has(docId)) continue;
      const len = index.lengths.get(docId) ?? 0;
      const denom = tf + K1 * (1 - B + B * (len / (index.avgLen || 1)));
      const apport = idf * (tf * (K1 + 1)) / denom;
      scores.set(docId, (scores.get(docId) ?? 0) + apport);
      if (!matched.has(docId)) matched.set(docId, new Map());
      matched.get(docId).set(term, apport);
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => {
      // Les termes sortent classes par ce qu'ils ont reellement apporte, et
      // plafonnes : quatre mots se lisent, douze se survolent.
      const tri = [...matched.get(id)].sort((a, b) => b[1] - a[1]).map(([t]) => t);
      return {
        id,
        score: Math.round(score * 1000) / 1000,
        terms: tri.slice(0, MAX_TERMES),
        forts: tri.filter(saillant).slice(0, MAX_TERMES)
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/*
 * =====================================================================
 *  CE QUI DISTINGUE UNE JOURNEE DES AUTRES.
 *
 * Le compagnon portait le TEXTE des journees et du carnet en permanence --
 * 125 000 signes chez quelqu'un, repayes a chaque phrase de chaque soiree.
 * Une carte coute mille fois moins et permet le meme geste : il voit de quoi
 * parle chaque journee, et va lire CELLE-LA quand la conversation y touche.
 *
 * C'est le meme calcul que la recherche, retourne. La recherche demande
 * « quelles journees ressemblent a cette phrase ? » ; ici on demande « quels
 * mots font que CETTE journee ne ressemble pas aux autres ? ». Les deux
 * lisent `postings` et pesent pareil : un mot rare dans le journal et
 * frequent dans la journee.
 *
 * UN MOT PARTOUT NE DISTINGUE RIEN. « fatigue » dans cinquante journees sur
 * soixante ne dit pas de quoi parle celle-ci -- c'est ce que l'idf retire, et
 * c'est pour ca qu'on ne se contente pas des mots les plus frequents.
 * =====================================================================
 */
export const PART_BANALE = 0.5;
export const CORPUS_MIN = 8;

export function termesDuDoc(index, docId, n = 5) {
  const out = [];
  /*
   * UN MOT PARTOUT NE DISTINGUE RIEN, et l'idf ne suffit pas a s'en
   * debarrasser : il le penalise, mais s'il n'y a rien d'autre dans la
   * journee il ressort quand meme. Une carte ou trente lignes sur soixante
   * disent « fatigue, soir, rien » ne sert a rien -- elle a l'air pleine et
   * ne permet aucun choix.
   *
   * On les retire donc. Pas sous huit documents : sur un journal qui commence,
   * « la moitie des journees » ce sont deux journees, et on viderait la carte
   * au moment ou elle sert le plus.
   */
  const banal = index.N >= CORPUS_MIN ? index.N * PART_BANALE : Infinity;
  for (const [terme, posting] of index.postings) {
    const tf = posting.get(docId);
    if (!tf) continue;
    const df = posting.size;
    if (df > banal) continue;
    const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5)) * poids(terme);
    const len = index.lengths.get(docId) ?? 0;
    const denom = tf + K1 * (1 - B + B * (len / (index.avgLen || 1)));
    out.push([terme, idf * (tf * (K1 + 1)) / denom]);
  }
  out.sort((a, b) => b[1] - a[1]);
  /*
   * LES SAILLANTS D'ABORD, LE RESTE ENSUITE. Un mot qui nomme un etat vaut
   * mieux qu'un nom propre pour retrouver une journee -- mais une carte qui
   * n'aurait QUE des etats se ressemblerait d'une ligne a l'autre. On prend
   * donc les saillants en tete, puis on complete.
   */
  const forts = out.filter(([t]) => saillant(t));
  const autres = out.filter(([t]) => !saillant(t));
  return [...forts, ...autres].slice(0, n).map(([t]) => t.replace(/_/g, ' '));
}
