/*
 * LES MARQUEURS DE LANGAGE : les mots absolus suivent-ils l'état ?
 * Corrélation (Spearman : les jours aberrants ne doivent pas tout décider)
 * entre la part de mots absolus et l'humeur, ou entre cette part et les jours
 * de déréalisation ; et une tendance causale sur quatorze notes → alerte.
 */
import { spearman, seuilR, kendallTemps } from '../stats.mjs';
export const TYPES = ['language', 'ews'];
export const CALIBRAGE = { seuil_r: 0.3, seuil_tau: 0.5, fenetre: 14, repos: 7 };

export function analyser(serie, opts = {}) {
  const C = { ...CALIBRAGE, ...opts };
  const J = serie.jours;
  const A = J.map(j => j.absolus), H = J.map(j => j.humeur), D = J.map(j => j.dereel);
  const rh = spearman(A, H), rd = spearman(A, D);
  const language = {};
  if (rh.r != null && rh.r <= -C.seuil_r && Math.abs(rh.r) > seuilR(rh.n)) language.r = rh.r;
  if (rd.r != null && rd.r >= C.seuil_r && Math.abs(rd.r) > seuilR(rd.n)) language.r_dereel = rd.r;
  // tendance causale des absolus sur les 14 dernières notes
  const alertes = []; let dernier = -Infinity; const notes = [];
  for (let t = 0; t < J.length; t++) {
    if (t >= 1 && J[t - 1].absolus != null) notes.push(J[t - 1].absolus);   // ≤ t−1
    if (notes.length < C.fenetre) continue;
    const tau = kendallTemps(notes.slice(-C.fenetre));
    if (tau != null && tau > C.seuil_tau && t - dernier > C.repos) { alertes.push(t); dernier = t; }
  }
  return { language: Object.keys(language).length ? language : null, alertes };
}
