/* LA PROPOSITION : frise + chaîne + signaux précoces, sur un seul axe. Les
   doublons d'épisodes (±3 j) et d'alertes (±3 j) sont fondus, pas cumulés. */
import * as frise from './frise.mjs';
import * as chaine from './chaine.mjs';
import * as ews from './ews.mjs';
export const TYPES = [...new Set([...frise.TYPES, ...chaine.TYPES, ...ews.TYPES])];
export function unir(liste) {
  const out = { edges: [], chains: [], episodes: [], alertes: [], rhythm: [], regularity: null, autocorr: null, couplings: [], language: null };
  for (const t of liste) {
    if (!t) continue;
    for (const e of t.edges ?? []) if (!out.edges.some(x => x.a === e.a && x.b === e.b && x.lag === e.lag)) out.edges.push(e);
    for (const c of t.chains ?? []) if (!out.chains.some(x => x.join('>') === c.join('>'))) out.chains.push(c);
    for (const e of t.episodes ?? []) if (!out.episodes.some(x => Math.abs(x.jour - e.jour) <= 3)) out.episodes.push(e);
    for (const a of t.alertes ?? []) if (!out.alertes.some(x => Math.abs(x - a) <= 3)) out.alertes.push(a);
    for (const p of t.rhythm ?? []) if (!out.rhythm.includes(p)) out.rhythm.push(p);
    if (!out.regularity && t.regularity) out.regularity = t.regularity;
    if (!out.autocorr && t.autocorr) out.autocorr = t.autocorr;
    for (const c of t.couplings ?? []) out.couplings.push(c);
    if (!out.language && t.language) out.language = t.language;
  }
  out.alertes.sort((a, b) => a - b);
  return out;
}
export function analyser(serie, opts = {}) {
  return unir([frise.analyser(serie, opts.frise), chaine.analyser(serie, opts.chaine), ews.analyser(serie, opts.ews)]);
}
