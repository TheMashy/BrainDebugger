/*
 * LE PHÉNOTYPAGE DIGITAL : ce que le poste voit, et rien de plus.
 *
 * Interdit de lire l'humeur, l'énergie, les cases cochées, le texte : seulement
 * les nuits, l'heure de coucher du poste et les minutes d'écran. Les ruptures
 * du sommeil font des épisodes (nuit courte = manie, nuit longue = dépressif),
 * le coucher fait la régularité et le rythme, les capteurs se relient entre eux.
 */
import { ecartType, welch, spearman, seuilR, moyenne } from '../stats.mjs';
import { ruptures } from './frise.mjs';
export const TYPES = ['episode', 'rhythm', 'regularity', 'edge'];
export const CALIBRAGE = { penalite: 3.5, min_seg: 14, seuil_t_rythme: 2.3, seuil_r: 0.2, regularity: { haute: 1.6, basse: 0.6 } };

export function analyser(serie, opts = {}) {
  const C = { ...CALIBRAGE, ...opts };
  const J = serie.jours.map(j => ({ t: j.t, sommeil_h: j.sommeil_h, coucher: j.coucher, ecran_min: j.ecran_min }));   // aveugle au reste
  const T = J.length, S = J.map(j => j.sommeil_h), Cc = J.map(j => j.coucher), E = J.map(j => j.ecran_min);
  const diff = (v, t) => { const a = moyenne(v.slice(Math.max(0, t - 14), t)), b = moyenne(v.slice(t, Math.min(T, t + 14))); return a == null || b == null ? 0 : b - a; };
  const episodes = ruptures(S, C).map(t => { const ds = diff(S, t); return { jour: t, genre: ds <= -1.5 ? 'manie' : ds >= 1.5 ? 'depressif' : null }; });
  const we = j => j.t % 7 >= 5, sortie = j => j.t % 7 === 4 || j.t % 7 === 5;
  const t1 = welch(J.filter(sortie).map(j => j.coucher), J.filter(j => !sortie(j)).map(j => j.coucher));
  const t2 = welch(J.filter(we).map(j => j.sommeil_h), J.filter(j => !we(j)).map(j => j.sommeil_h));
  const rhythm = [t1, t2].some(t => t != null && Math.abs(t) > C.seuil_t_rythme) ? [7] : [];
  const sd = ecartType(Cc);
  const regularity = sd == null ? null : sd > C.regularity.haute ? { var: 'coucher', classe: 'haute' } : sd < C.regularity.basse ? { var: 'coucher', classe: 'basse' } : null;
  const edges = [];
  const essai = (a, va, b, vb, lag, dir) => { const { r, n } = spearman(va, vb, lag); if (r != null && Math.abs(r) > Math.max(C.seuil_r, seuilR(n))) edges.push({ a, b, signe: r > 0 ? '+' : '-', lag, poids: Math.abs(r), ...(dir ? {} : { dir: false }) }); };
  essai('coucher', 'sommeil_h', Cc, S, 1, true); essai('ecran_min', 'coucher', E, Cc, 0, false); essai('ecran_min', 'sommeil_h', E, S, 1, true); essai('sommeil_h', 'ecran_min', S, E, 0, false);
  return { episodes, rhythm, regularity, edges };
}
