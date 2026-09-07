/**
 * LE SENS D'UN LIEN, COMPTÉ.
 *
 * La toile est tissée par le modèle : ses liens portent un verbe (« précède »,
 * « fait retomber ») et une direction déclarée. Déclarée, pas comptée. Or
 * chaque nœud porte ses journées, et le journal est daté : on peut donc
 * VÉRIFIER le sens, comme les fonctionnements vérifient un lien entre deux
 * mesures — « ceci, et cela juste après », combien de fois sur combien, contre
 * le reste.
 *
 * ================================================================
 * « JUSTE APRÈS » VEUT DIRE LA JOURNÉE ÉCRITE SUIVANTE, PAS DEMAIN.
 *
 * Première version : le lendemain civil. Elle ne posait jamais une seule
 * flèche, et c'était une erreur sur ce qu'est ce journal — pas un défaut de
 * réglage. Quelqu'un qui écrit cent quarante journées en quatre ans écrit un
 * jour sur douze : deux journées civilement consécutives arrivent une dizaine
 * de fois en tout, et un nœud présent sur douze journées a alors UN lendemain
 * observable. Il n'y a rien à compter là-dedans, quelle que soit la force du
 * lien.
 *
 * La suite d'un texte, pour qui écrit par à-coups, n'est pas le lendemain :
 * c'est la fois d'après. On compte donc sur la journée écrite SUIVANTE — celle
 * qui vient après dans son journal à lui. Un journal quotidien retombe
 * exactement sur le lendemain ; un journal espacé garde ses paires.
 *
 * Avec une borne, quand même : au-delà de `ecart_max` jours, la fois d'après
 * n'est plus une suite, c'est une autre époque. Ces paires-là ne comptent ni
 * pour ni contre — elles sortent du dénominateur, comme un lendemain qui
 * n'aurait pas été écrit.
 * ================================================================
 *
 * Deux conditions pour poser une flèche, et il faut les deux :
 *   1. B suit A plus souvent qu'il ne suit les autres journées (test exact de
 *      Fisher, unilatéral, sous 5 %, et au moins `min_apres` fois) ;
 *   2. l'inverse n'est PAS vrai aussi — sinon ce n'est pas un sens, c'est une
 *      cohabitation, et on le dit plutôt que de choisir une pointe au hasard.
 *
 * Ce qui n'est pas compté reste un trait sans pointe : le verbe du modèle
 * demeure, au survol, et la flèche ne prétend rien de plus que son compte.
 */
import { fisher } from './fonctionnements.js';

export const SEUILS_SENS = { min_apres: 3, p: 0.05, ecart_max: 30 };

/** Le jour civil suivant, en AAAA-MM-JJ. */
export function lendemain(d) {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10);
}

const jours = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * LA SUITE : pour chaque journée écrite, celle qui vient après dans le journal.
 *
 * Rendue comme une Map, construite une fois par carte et non par lien : sur
 * seize nœuds et trente liens, la refaire à chaque fois trierait le journal
 * soixante fois pour le même résultat.
 */
export function suiteDe(corpus, ecartMax = SEUILS_SENS.ecart_max) {
  const dates = [...new Set(corpus)].sort();
  const m = new Map();
  for (let i = 0; i < dates.length - 1; i++) {
    if (jours(dates[i], dates[i + 1]) <= ecartMax) m.set(dates[i], dates[i + 1]);
  }
  return m;
}

/**
 * Compte, dans un sens : combien de journées de A ont B juste après, sur
 * combien de journées de A qui ont une suite ; et pareil hors de A.
 */
function suit(A, B, suite) {
  let apres = 0, sur = 0, hors = 0, hors_sur = 0;
  for (const [d, s] of suite) {
    if (A.has(d)) { sur++; if (B.has(s)) apres++; }
    else { hors_sur++; if (B.has(s)) hors++; }
  }
  const p = sur && hors_sur ? fisher(apres, sur, hors, hors_sur) : 1;
  return { apres, sur, hors, hors_sur, p };
}

/**
 * @param {Iterable<string>} joursA  les journées du nœud de départ (`de`)
 * @param {Iterable<string>} joursB  celles du nœud d'arrivée (`vers`)
 * @param {Iterable<string>|Map} corpus  les journées écrites, ou une suite déjà faite
 * @returns {{sens:'de'|'vers'|'deux'|null, meme:number, de:object, vers:object}}
 */
export function sensDuLien(joursA, joursB, corpus, seuils = SEUILS_SENS) {
  const A = new Set(joursA ?? []), B = new Set(joursB ?? []);
  const suite = corpus instanceof Map ? corpus : suiteDe(corpus ?? [], seuils.ecart_max);
  const de = suit(A, B, suite), vers = suit(B, A, suite);
  const tient = x => x.apres >= seuils.min_apres && x.p < seuils.p;
  const tDe = tient(de), tVers = tient(vers);
  let meme = 0;
  for (const d of A) if (B.has(d)) meme++;
  return { sens: tDe && tVers ? 'deux' : tDe ? 'de' : tVers ? 'vers' : null, meme, de, vers };
}

/** Les liens de la carte, chacun avec son `appui` compté. Un nom inconnu reste sans appui. */
export function sensDesLiens(carte, corpus, seuils = SEUILS_SENS) {
  const suite = suiteDe(corpus ?? [], seuils.ecart_max);
  const parNom = new Map((carte?.noeuds ?? []).map(n => [n.nom,
    (n.jours ?? []).map(j => typeof j === 'string' ? j : j?.d).filter(Boolean)]));
  return (carte?.liens ?? []).map(l => {
    const a = parNom.get(l.de), b = parNom.get(l.vers);
    if (!a || !b) return { ...l, appui: null };
    return { ...l, appui: sensDuLien(a, b, suite, seuils) };
  });
}
