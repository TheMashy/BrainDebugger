/*
 * LA FRISE (life-chart) : des ruptures dans le temps, sur un seul axe.
 *
 * Segmentation binaire de l'humeur et du sommeil : on coupe là où la moyenne
 * change le plus, on recoupe chaque côté tant que la statistique dépasse la
 * pénalité. Chaque coupure devient un début de régime, nommé par ce qui suit
 * (humeur haute et nuit courte = manie ; humeur basse = dépressif). Le rythme
 * de la semaine, la régularité du coucher et l'inertie de l'humeur se lisent
 * sur la même frise.
 */
import { ar1, ecartType, welch, moyenne, spearman, seuilR, interpoler } from '../stats.mjs';
export const TYPES = ['episode', 'rhythm', 'regularity', 'autocorr', 'coupling_sign'];
export const CALIBRAGE = { penalite: 3.5, min_seg: 14, seuil_t_rythme: 2.3, regularity: { haute: 1.6, basse: 0.6 }, autocorr: { high: 0.55, low: 0.05 } };

export function ruptures(v, C) {
  const x = interpoler(v, 2); const out = [];
  const rec = (a, b) => {
    if (b - a < 2 * C.min_seg) return;
    let best = null;
    const vals = [], idx = []; for (let t = a; t < b; t++) if (x[t] != null) { vals.push(x[t]); idx.push(t); }
    if (vals.length < 2 * C.min_seg) return;
    const n = vals.length; const tot = vals.reduce((p, q) => p + q, 0);
    const sd = ecartType(vals) || 1;
    const pref = [0]; for (const v of vals) pref.push(pref[pref.length - 1] + v);   // sommes préfixes
    for (let i = C.min_seg; i <= n - C.min_seg; i++) { const s1 = pref[i]; const m1 = s1 / i, m2 = (tot - s1) / (n - i); const stat = Math.abs(m1 - m2) / sd * Math.sqrt(i * (n - i) / n); if (!best || stat > best.stat) best = { stat, t: idx[i] }; }
    if (best && best.stat > C.penalite) { out.push(best.t); rec(a, best.t); rec(best.t, b); }
  };
  rec(0, v.length);
  return out.sort((p, q) => p - q);
}
export function analyser(serie, opts = {}) {
  const C = { ...CALIBRAGE, ...opts };
  const J = serie.jours, T = J.length, H = J.map(j => j.humeur), S = J.map(j => j.sommeil_h);
  const coupes = [...ruptures(H, C), ...ruptures(S, C)].sort((a, b) => a - b);
  const fusion = []; for (const c of coupes) if (!fusion.length || c - fusion[fusion.length - 1] > 3) fusion.push(c);
  const diff = (v, t) => { const a = moyenne(v.slice(Math.max(0, t - 14), t)), b = moyenne(v.slice(t, Math.min(T, t + 14))); return a == null || b == null ? 0 : b - a; };
  const episodes = fusion.map(t => { const dh = diff(H, t), ds = diff(S, t); const genre = dh >= 1 && ds <= -1 ? 'manie' : dh <= -1 ? 'depressif' : null; return { jour: t, genre, dh, ds }; });
  // rythme de la semaine : contraste week-end / semaine sur l'humeur et le coucher
  const we = j => j.t % 7 >= 5, sortie = j => j.t % 7 === 4 || j.t % 7 === 5;
  const t1 = welch(J.filter(we).map(j => j.humeur), J.filter(j => !we(j)).map(j => j.humeur));
  const t2 = welch(J.filter(sortie).map(j => j.coucher), J.filter(j => !sortie(j)).map(j => j.coucher));
  const rhythm = [t1, t2].some(t => t != null && Math.abs(t) > C.seuil_t_rythme) ? [7] : [];
  const sd = ecartType(J.map(j => j.coucher));
  const regularity = sd == null ? null : sd > C.regularity.haute ? { var: 'coucher', classe: 'haute' } : sd < C.regularity.basse ? { var: 'coucher', classe: 'basse' } : null;
  const phi = ar1(H);
  const autocorr = phi == null ? null : phi > C.autocorr.high ? 'high' : phi < C.autocorr.low ? 'low' : null;
  // le signe sommeil↔humeur dans chaque segment
  const bornes = [0, ...fusion, T], couplings = [];
  for (let i = 0; i + 1 < bornes.length; i++) { const a = bornes[i], b = bornes[i + 1]; const { r, n } = spearman(S.slice(a, b), H.slice(a, b)); if (r != null && Math.abs(r) > seuilR(n, 1.64)) couplings.push({ a: 'sommeil_h', b: 'humeur', signe: r > 0 ? '+' : '-', de: a, a_jour: b }); }
  return { episodes, rhythm, regularity, autocorr, couplings };
}
