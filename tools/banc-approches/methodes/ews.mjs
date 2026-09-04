/*
 * LES SIGNAUX PRÉCOCES : avant une bascule, chaque jour ressemble davantage à
 * la veille et les écarts grossissent. AR(1) et variance GLISSANTES de l'humeur,
 * et leur tendance sur quatorze jours. CAUSAL : l'alerte du jour t n'utilise
 * que les données ≤ t−1, sinon on prédirait le passé. Une alerte par montée.
 * Pour le sommeil (prodrome de manie) : la nuit qui raccourcit et s'agite.
 */
import { ar1, ecartType, kendallTemps, interpoler, moyenne } from '../stats.mjs';
export const TYPES = ['ews', 'autocorr'];
export const CALIBRAGE = { seuil_tau: 0.5, fenetre: 14, repos: 7, autocorr: { high: 0.55, low: 0.05 } };

function glissant(v, W, f) {
  const out = new Array(v.length).fill(null);
  for (let u = W - 1; u < v.length; u++) { const w = v.slice(u - W + 1, u + 1); if (w.filter(x => x != null).length < W - 4) continue; out[u] = f(w); }
  return out;
}
export function alertesDe(v, C, sens = 'humeur') {
  const W = C.fenetre, x = interpoler(v, 2);
  const rAR = glissant(x, W, ar1), rSD = glissant(x, W, ecartType), rM = glissant(x, W, moyenne);
  const alertes = []; let dernier = -Infinity;
  for (let t = 2 * W; t < v.length; t++) {
    // ne voit que ≤ t−1 : les estimations glissantes finissant en t−1 … t−W
    const fen = i => i.slice(t - W, t);
    const tauSD = kendallTemps(fen(rSD));
    let ok;
    if (sens === 'humeur') { const tauAR = kendallTemps(fen(rAR)); ok = tauAR != null && tauSD != null && tauAR > C.seuil_tau && tauSD > C.seuil_tau; }
    else { const tauM = kendallTemps(fen(rM)); ok = tauM != null && tauSD != null && tauM < -C.seuil_tau && tauSD > C.seuil_tau * 0.6; }
    if (ok && t - dernier > C.repos) { alertes.push(t); dernier = t; }
  }
  return alertes;
}
export function analyser(serie, opts = {}) {
  const C = { ...CALIBRAGE, ...opts };
  const J = serie.jours;
  const alertes = [...alertesDe(J.map(j => j.humeur), C, 'humeur'), ...alertesDe(J.map(j => j.sommeil_h), C, 'sommeil')].sort((a, b) => a - b);
  const phi = ar1(J.map(j => j.humeur));
  const autocorr = phi == null ? null : phi > C.autocorr.high ? 'high' : phi < C.autocorr.low ? 'low' : null;
  return { alertes, autocorr };
}
