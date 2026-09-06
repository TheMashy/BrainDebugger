/**
 * LE SENS D'UN LIEN, COMPTÉ.
 *
 * La toile est tissée par le modèle : ses liens portent un verbe (« précède »,
 * « fait retomber ») et une direction déclarée. Déclarée, pas comptée. Or
 * chaque nœud porte ses journées, et le corpus est daté : on peut donc VÉRIFIER
 * le sens, exactement comme les fonctionnements vérifient un lien entre deux
 * mesures — « ceci un jour, cela le lendemain », combien de fois sur combien,
 * contre le reste.
 *
 * Deux conditions pour poser une flèche, et il faut les deux :
 *   1. B suit A plus souvent qu'il ne suit les autres jours (test exact de
 *      Fisher, unilatéral, sous 5 %, et au moins quatre lendemains) ;
 *   2. l'inverse n'est PAS vrai aussi — sinon ce n'est pas un sens, c'est une
 *      cohabitation, et on le dit plutôt que de choisir une pointe au hasard.
 *
 * Ce qui n'est pas compté reste un trait sans pointe : le verbe du modèle
 * demeure, au survol, et la flèche ne prétend rien de plus que son compte.
 */
import { fisher } from './fonctionnements.js';

export const SEUILS_SENS = { min_apres: 4, p: 0.05 };

/** Le jour civil suivant, en AAAA-MM-JJ. Les dates sont déjà des journées vécues. */
export function lendemain(d) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

/**
 * Compte, dans un sens : combien de jours de A ont B le lendemain, sur combien
 * de jours de A qui ont un lendemain écrit ; et pareil pour les jours SANS A.
 */
function suit(A, B, corpus) {
  let apres = 0, sur = 0, hors = 0, hors_sur = 0;
  for (const d of corpus) {
    const l = lendemain(d);
    if (!corpus.has(l)) continue;             // pas de lendemain écrit : on ne sait pas
    if (A.has(d)) { sur++; if (B.has(l)) apres++; }
    else { hors_sur++; if (B.has(l)) hors++; }
  }
  const p = sur && hors_sur ? fisher(apres, sur, hors, hors_sur) : 1;
  return { apres, sur, hors, hors_sur, p };
}

/**
 * @param {Iterable<string>} joursA  les journées du nœud de départ (`de`)
 * @param {Iterable<string>} joursB  celles du nœud d'arrivée (`vers`)
 * @param {Iterable<string>} corpus  toutes les journées écrites
 * @returns {{sens: 'de'|'vers'|'deux'|null, meme: number, de: object, vers: object}}
 *   `de` : A puis B le lendemain ; `vers` : B puis A. `sens` dit lequel tient.
 */
export function sensDuLien(joursA, joursB, corpus, seuils = SEUILS_SENS) {
  const A = new Set(joursA ?? []), B = new Set(joursB ?? []), C = new Set(corpus ?? []);
  const de = suit(A, B, C), vers = suit(B, A, C);
  const tient = x => x.apres >= seuils.min_apres && x.p < seuils.p;
  const tDe = tient(de), tVers = tient(vers);
  let meme = 0;
  for (const d of A) if (B.has(d)) meme++;
  return {
    sens: tDe && tVers ? 'deux' : tDe ? 'de' : tVers ? 'vers' : null,
    meme, de, vers
  };
}

/** Les liens de la carte, chacun avec son `appui` compté. Un nom inconnu reste sans appui. */
export function sensDesLiens(carte, corpus) {
  const jours = new Map((carte?.noeuds ?? []).map(n => [n.nom, (n.jours ?? []).map(j => typeof j === 'string' ? j : j?.d).filter(Boolean)]));
  return (carte?.liens ?? []).map(l => {
    const a = jours.get(l.de), b = jours.get(l.vers);
    if (!a || !b) return { ...l, appui: null };
    return { ...l, appui: sensDuLien(a, b, corpus) };
  });
}
