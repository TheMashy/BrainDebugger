/*
 * L'ANALYSE EN CHAÎNE : quel enchaînement revient, maillon par maillon.
 *
 * On discrétise chaque jour en états (partagés avec la vérité terrain), puis on
 * fouille les séquences ORDONNÉES sur une fenêtre de quatre jours. Le support
 * seul ment (deux états fréquents se suivent par hasard) : chaque maillon doit
 * avoir une CONFIANCE — la part des fois où il arrive dans la fenêtre après le
 * préfixe — nettement au-dessus de son taux de base dans une fenêtre de même
 * taille. C'est un lift par maillon ; une chaîne tient si tous ses maillons
 * tiennent. On ne garde que les chaînes maximales, et les plus fortes.
 */
import { etatsDe, compterChaine, tauxFenetre, ORDRE, SEUILS } from '../etats.mjs';
export const TYPES = ['chain'];
export const CALIBRAGE = { support: 3, seuil_lift: 1.8, fenetre: SEUILS.fenetre, max: 4, longueur_min: 3 };
const sousSeq = (petit, grand) => { let i = 0; for (const s of grand) if (s === petit[i]) i++; return i === petit.length; };

export function analyser(serie, opts = {}) {
  const C = { ...CALIBRAGE, ...opts };
  const etats = etatsDe(serie.jours), T = etats.length;
  const present = ORDRE.filter(s => etats.some(e => e.includes(s)));
  // taux de base d'un état DANS UNE FENÊTRE : part des jours d tels que l'état tombe dans [d, d+f−1]
  const base = {}; for (const s of present) base[s] = tauxFenetre(etats, s, C.fenetre);
  const support = ch => compterChaine(etats, ch, C.fenetre);
  /* croissance par niveau : une chaîne ne s'étend que si chaque maillon garde son lift */
  let niveau = present.map(a => ({ etats: [a], s: support([a]), lift: Infinity }));
  const gardes = [];
  for (let longueur = 2; longueur <= 4; longueur++) {
    const suiv = [];
    for (const c of niveau) {
      if (c.s < C.support) continue;
      for (const b of present) {
        if (c.etats.includes(b) && b !== 'sommeil_court') continue;
        const ch = [...c.etats, b], s = support(ch);
        if (s < C.support) continue;
        const confiance = s / c.s, lift = confiance / Math.max(base[b], 1e-6);
        if (lift < C.seuil_lift) continue;
        suiv.push({ etats: ch, s, lift: Math.min(c.lift, lift) });
      }
    }
    niveau = suiv;
    if (longueur >= C.longueur_min) gardes.push(...suiv);
  }
  // chaînes maximales seulement, puis les plus fortes
  const max = gardes.filter(c => !gardes.some(d => d.etats.length > c.etats.length && sousSeq(c.etats, d.etats) && d.s >= 0.6 * c.s));
  max.sort((a, b) => b.lift - a.lift || b.s - a.s);
  return { chains: max.slice(0, C.max).map(c => c.etats), details: max.slice(0, C.max) };
}
