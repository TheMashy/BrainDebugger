/*
 * LE RÉSEAU TEMPOREL : « X aujourd'hui prédit Y demain ».
 *
 * Régression ridge de chaque variable sur toutes les autres au jour précédent,
 * arêtes gardées si le signe tient dans ≥ 60 % des tirages d'un bootstrap par
 * blocs. Les jours sans note sont imputés à la moyenne (zéro après réduction) :
 * c'est grossier, et c'est exactement ce que fait un VAR de routine devant des
 * trous. Le graphe simultané (résidus) donne des arêtes signées non dirigées.
 */
import { ridge, pearson, ar1, moyenne, ecartType } from '../stats.mjs';
import { rngDe } from '../rng.mjs';
export const TYPES = ['edge', 'autocorr'];
export const VARIABLES = ['humeur', 'energie', 'sommeil_h', 'coucher', 'ecran_min', 'absolus', 'anxio', 'substance', 'social', 'declencheur', 'dereel', 'surcharge'];
export const CALIBRAGE = { seuil_var: 0.12, seuil_cont: 0.2, lambda: 2, boots: 40, stabilite: 0.6, autocorr: { high: 0.55, low: 0.05 } };

export function analyser(serie, opts = {}) {
  const C = { ...CALIBRAGE, ...opts };
  const J = serie.jours, T = J.length, V = VARIABLES, p = V.length;
  // standardisation, imputation à 0 des null
  const Z = V.map(k => { const v = J.map(j => j[k]); const m = moyenne(v), s = ecartType(v); return v.map(x => (x == null || !s ? 0 : (x - m) / s)); });
  const valide = V.map(k => J.map(j => j[k] != null));
  const lignes = [];   // t (cible) avec prédicteurs à t−1
  for (let t = 1; t < T; t++) lignes.push(t);
  const coefs = (idx) => {
    // matrice X (t−1) et cibles y (t) pour un sous-ensemble de lignes
    const X = idx.map(t => Z.map(z => z[t - 1]));
    return V.map((k, b) => { const y = idx.map(t => Z[b][t]); const c = ridge(X, y, C.lambda); return c; });
  };
  const r = rngDe('var', serie.famille ?? 'x', serie.profil ?? 'x', serie.index ?? 0, serie.propre ? 'p' : 'o');
  const B = C.boots, bloc = 7;
  const votes = Array.from({ length: p }, () => Array.from({ length: p }, () => ({ pos: 0, neg: 0, somme: 0 })));
  const base = coefs(lignes);
  for (let b = 0; b < B; b++) {
    const idx = [];
    while (idx.length < lignes.length) { const s = 1 + Math.floor(r() * (T - bloc)); for (let k = 0; k < bloc && idx.length < lignes.length; k++) idx.push(Math.min(T - 1, s + k)); }
    const c = coefs(idx);
    for (let tgt = 0; tgt < p; tgt++) { if (!c[tgt]) continue; for (let src = 0; src < p; src++) { const v = c[tgt][src]; if (v > C.seuil_var) votes[src][tgt].pos++; else if (v < -C.seuil_var) votes[src][tgt].neg++; votes[src][tgt].somme += v; } }
  }
  const edges = [];
  for (let src = 0; src < p; src++) for (let tgt = 0; tgt < p; tgt++) {
    if (src === tgt) continue;
    const v = votes[src][tgt];
    if (v.pos / B >= C.stabilite) edges.push({ a: V[src], b: V[tgt], signe: '+', lag: 1, poids: v.somme / B });
    else if (v.neg / B >= C.stabilite) edges.push({ a: V[src], b: V[tgt], signe: '-', lag: 1, poids: -v.somme / B });
  }
  // simultané : corrélations des résidus (non dirigé)
  if (base.every(Boolean)) {
    const R = V.map((k, b) => lignes.map(t => Z[b][t] - Z.reduce((acc, z, s) => acc + base[b][s] * z[t - 1], 0)));
    for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) {
      const x = [], y = [];
      lignes.forEach((t, n) => { if (valide[i][t] && valide[j][t]) { x.push(R[i][n]); y.push(R[j][n]); } });
      if (x.length < 15) continue;
      const rr = pearson(x, y);
      if (rr != null && Math.abs(rr) > C.seuil_cont) edges.push({ a: V[i], b: V[j], signe: rr > 0 ? '+' : '-', lag: 0, poids: Math.abs(rr), dir: false });
    }
  }
  const phi = ar1(J.map(j => j.humeur));
  const autocorr = phi == null ? null : phi > C.autocorr.high ? 'high' : phi < C.autocorr.low ? 'low' : null;
  return { edges, autocorr };
}
