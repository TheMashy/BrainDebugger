/**
 * CORRÉLER LE LOG DE LA JOURNÉE À SON CHIFFRE.
 *
 * La recherche répond « où ai-je écrit ce mot ». Celle-ci répond à la question
 * d'après, celle de la métacognition : « les jours où j'écris ce mot, est-ce
 * que ça va mieux ou moins bien que d'habitude ». On prend le LOG ENTIER de
 * chaque journée (la concaténation de tout ce qui a été tapé ce jour-là, déjà
 * rangée dans `entries.text`), on le découpe comme la recherche, et pour chaque
 * terme on compare la moyenne du chiffre les jours qui le portent à la moyenne
 * de toutes les journées.
 *
 * Le chiffre comparé est la NOTE par défaut, mais n'importe quelle mesure
 * quotidienne (sommeil, écran, bascules…) passe par le même tuyau : il suffit
 * qu'elle arrive par jour. D'où `valeurDuJour`, le seul endroit qui sait où
 * lire le nombre.
 *
 * Trois garde-fous contre le hasard, et ils comptent plus que la formule :
 *   - PRÉSENCE PAR JOUR, jamais par occurrence : un mot répété dix fois dans
 *     une journée reste une seule journée. Sinon un jour bavard dicterait tout.
 *   - un terme n'est retenu qu'au-dessus de `min` journées : sous ce seuil,
 *     « corrélation » n'est qu'un mot pour coïncidence.
 *   - un écart sous `MIN_ECART` ne s'affiche pas : il est dans le bruit de la
 *     note elle-même, le montrer ferait croire à un lien qui n'existe pas.
 *
 * Zéro dépendance. Pur : mêmes lignes en entrée, même résultat — c'est ce qui
 * le rend testable sans base ni serveur.
 */

import { tokenize } from './search.js';
import { lisible, poids } from './lexique.js';

/** En dessous, un terme n'a pas assez de journées pour qu'on en dise quoi que ce soit. */
export const MIN_JOURS = 4;

/** Écart de chiffre (sur l'échelle de la note, 0–10) sous lequel on se tait. */
export const MIN_ECART = 0.3;

/**
 * @param {Array<{date:string, note:number|null, text:string, mesures?:Object}>} rows
 * @param {{min?:number, limit?:number, metrique?:string}} [opts]
 */
export function correlations(rows, { min = MIN_JOURS, limit = 12, metrique = 'note' } = {}) {
  // On ne garde que les journées qui portent À LA FOIS un log écrit et un
  // chiffre : sans texte il n'y a rien à corréler, sans chiffre rien à mesurer.
  const jours = (rows ?? []).filter(r =>
    r.text && r.text.trim() && Number.isFinite(valeurDuJour(r, metrique)));

  const nJours = jours.length;
  // Il faut de quoi faire DEUX camps : les jours avec le terme et les autres.
  // `min * 2` est le plancher en dessous duquel le fond de comparaison est trop
  // mince pour qu'un écart veuille dire quelque chose.
  if (nJours < min * 2) {
    return { assez: false, metrique, nJours, min, base: null, hausses: [], baisses: [] };
  }

  const base = moyenne(jours.map(r => valeurDuJour(r, metrique)));

  // terme -> les chiffres des journées qui le portent (une entrée par journée).
  const parTerme = new Map();
  for (const r of jours) {
    const v = valeurDuJour(r, metrique);
    for (const t of new Set(tokenize(r.text))) {
      let vals = parTerme.get(t);
      if (!vals) parTerme.set(t, vals = []);
      vals.push(v);
    }
  }

  const retenus = [];
  for (const [t, vals] of parTerme) {
    if (vals.length < min) continue;
    const m = moyenne(vals);
    const ecart = m - base;
    if (Math.abs(ecart) < MIN_ECART) continue;
    retenus.push({
      terme: lisible(t),
      jours: vals.length,
      moyenne: arrondi(m),
      ecart: arrondi(ecart),
      // Le poids du lexique ne CLASSE pas (c'est l'écart qui classe), mais il
      // départage deux écarts égaux : un état nommé passe devant une circonstance.
      poids: poids(t)
    });
  }

  const parEcart = (a, b) => Math.abs(b.ecart) - Math.abs(a.ecart) || b.poids - a.poids;
  const hausses = retenus.filter(x => x.ecart > 0).sort(parEcart).slice(0, limit);
  const baisses = retenus.filter(x => x.ecart < 0).sort(parEcart).slice(0, limit);

  return { assez: true, metrique, nJours, min, base: arrondi(base), hausses, baisses };
}

/**
 * LE SEUL ENDROIT QUI SAIT OÙ EST LE NOMBRE D'UNE JOURNÉE.
 *
 * La note vit sur la ligne ; une mesure quantified-self vit dans `mesures`, la
 * carte {clé: valeur} qu'on attache au jour avant d'appeler. Tout le reste du
 * calcul ignore d'où vient le chiffre — c'est ce qui laisse corréler le log à
 * n'importe quelle série sans toucher à la formule.
 */
export function valeurDuJour(row, metrique = 'note') {
  const v = metrique === 'note' ? row?.note : row?.mesures?.[metrique];
  return v == null ? NaN : Number(v);
}

const moyenne = a => a.reduce((s, x) => s + x, 0) / a.length;
const arrondi = x => Math.round(x * 100) / 100;
