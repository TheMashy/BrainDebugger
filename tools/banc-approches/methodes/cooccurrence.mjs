/*
 * LA CARTE ACTUELLE, RÉDUITE À SA STRUCTURE.
 *
 * Deux choses sont reliées quand elles tombent dans les mêmes journées : on
 * binarise chaque variable (au-dessus ou non de sa médiane), on mesure le φ
 * le MÊME jour, on garde les paires au-dessus d'un seuil. Ni direction, ni
 * temps — c'est ce qu'un graphe de co-occurrence sait dire, et rien de plus.
 */
import { pearson, quantile } from '../stats.mjs';
export const TYPES = ['edge'];
export const VARIABLES = ['humeur', 'energie', 'sommeil_h', 'coucher', 'ecran_min', 'absolus', 'anxio', 'substance', 'social', 'declencheur', 'dereel', 'surcharge'];
const BIN = new Set(['anxio', 'substance', 'social', 'declencheur', 'dereel', 'surcharge']);
export const CALIBRAGE = { seuil_phi: 0.25 };   // remplacé par calibration.json

export function analyser(serie, opts = {}) {
  const seuil = opts.seuil_phi ?? CALIBRAGE.seuil_phi;
  const J = serie.jours;
  const B = {};
  for (const k of VARIABLES) {
    const v = J.map(j => j[k]);
    if (BIN.has(k)) { B[k] = v; continue; }
    const med = quantile(v, 0.5);
    B[k] = v.map(x => (x == null ? null : x >= med ? 1 : 0));   // égalité : haut (règle écrite)
  }
  const edges = [];
  for (let i = 0; i < VARIABLES.length; i++) for (let j = i + 1; j < VARIABLES.length; j++) {
    const a = VARIABLES[i], b = VARIABLES[j], x = [], y = [];
    for (let t = 0; t < J.length; t++) if (B[a][t] != null && B[b][t] != null) { x.push(B[a][t]); y.push(B[b][t]); }
    if (x.length < 15) continue;
    const phi = pearson(x, y);
    if (phi != null && Math.abs(phi) > seuil) edges.push({ a, b, signe: null, lag: 0, poids: Math.abs(phi), dir: false });
  }
  return { edges };
}
