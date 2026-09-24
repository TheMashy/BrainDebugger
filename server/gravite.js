/**
 * =====================================================================
 *  QUAND LE COMPAGNON DOIT RÉFLÉCHIR DAVANTAGE.
 *
 * Par défaut il répond à l'effort « bas » : une conversation du soir n'a pas
 * besoin d'une longue délibération, et c'est le poste de dépense du produit.
 * Mais un soir grave n'est pas une conversation du soir. Comparé à la même
 * discussion menée ailleurs, avec réflexion, l'écart de justesse sautait aux
 * yeux exactement là : quand quelqu'un écrit qu'il aimerait « s'endormir pour
 * toujours ».
 *
 * CE DÉTECTEUR N'EST PAS LA VEILLE, ET C'EST VOULU.
 *
 * La veille pose des triangles à l'écran et des jours à surveiller : ses
 * fausses alertes se voient, et la personne a déjà dû les combattre. Elle ne
 * réagit qu'aux mots explicites — et, mesuré sur la discussion de test,
 * elle ne voyait AUCUNE des phrases indirectes (« que ça s'arrête là »,
 * « m'endormir pour toujours », « me dissoudre »).
 *
 * Ici une fausse alerte ne se voit pas : elle coûte une réponse plus
 * réfléchie, donc quelques jetons. On peut donc ratisser large — l'asymétrie
 * est la même que partout dans ce produit : une réflexion de trop coûte des
 * jetons, une de moins peut coûter bien plus.
 * =====================================================================
 */
import { niveauDuTexte } from './veille.js';

const norm = t => String(t ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’`]/g, ' ').replace(/\s+/g, ' ');

/** Les façons indirectes de dire qu'on voudrait ne plus être là. */
export const PASSIF = [
  /\b(?:m )?endormir pour (?:toujours|de bon)\b/,
  /\bne (?:plus|jamais plus|jamais) (?:me )?reveiller\b/,
  /\b(?:disparaitre|me dissoudre|m effacer|m evaporer)\b/,
  /\bque (?:ca|tout|tout ca) s arrete\b/,
  /\b(?:plus|pas) (?:d )?envie (?:de|d) (?:vivre|continuer|exister|la voir|me reveiller|etre la)\b/,
  /\ben finir\b/,
  /\bne plus (?:etre la|exister|etre vivant)\b/,
  /\b(?:mourir|me tuer|me suicider|suicide|suicidaire)\b/,
  /\ba quoi bon (?:vivre|continuer|tout ca)\b/,
  // Prendre d'un coup ce qu'on a sous la main : « plein d'anxios », « toute la
  // plaquette », « m'envoyer tous mes anxios ». La veille ne voit que la prise
  // FAITE ; l'envie compte autant pour qui doit la lire.
  /\b(?:prendre|avaler|m envoyer|m enfiler|gober)\b.{0,30}\b(?:plein|tous|toutes|toute|la boite|la plaquette|tout le tube)\b.{0,20}\b(?:anxios?|anxiolytiques?|medocs?|medicaments?|cachets?|comprimes?|pilules?|somniferes?|xanax|lexo(?:mil)?|valium|boite|plaquette)\b/,
  /\b(?:plein|tous|tout|toutes) (?:d |de |mes |les )?(?:anxios?|anxiolytiques?|medocs?|cachets?|comprimes?|somniferes?)\b/,
];

/** Ce message dit-il, même à demi-mot, qu'il voudrait ne plus être là ? */
export function messageGrave(texte) {
  const t = String(texte ?? '');
  if (niveauDuTexte(t)?.niveau) return true;
  const n = norm(t);
  return PASSIF.some(r => r.test(n));
}

/**
 * La conversation est-elle grave EN CE MOMENT ? On regarde les derniers
 * messages de la personne, pas seulement le dernier : après « j'aimerais
 * m'endormir pour toujours », le « non je ne pense pas à me tuer » qui suit
 * appelle la même attention.
 */
export const FENETRE_GRAVE = 4;

export function conversationGrave(messages, fenetre = FENETRE_GRAVE) {
  return (messages ?? []).filter(m => m.role === 'user').slice(-fenetre)
    .some(m => messageGrave(m.text));
}
