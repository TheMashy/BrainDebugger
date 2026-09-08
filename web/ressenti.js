/**
 * =====================================================================
 *  QUAND IL DEMANDE OÙ TU EN ES, TU PEUX RÉPONDRE EN UN GESTE.
 *
 * Le compagnon posait déjà des relevés : il ESTIME, dans les mots, où
 * quelqu'un semble être. C'est utile et c'est une lecture — jamais une note,
 * jamais posée à la place de la personne. Il manquait l'autre moitié : quand
 * il demande « comment tu te sens, là ? », la personne n'avait que la phrase
 * pour répondre, et une phrase ne se compare pas à celle d'hier.
 *
 * Ce fichier reconnaît cette question-là, et rien d'autre. Une échelle
 * apparaît sous la bulle ; la toucher pose un relevé de source « toi ».
 * Les deux vivent dans la même table parce qu'ils mesurent la même chose au
 * même instant, et gardent leur source parce qu'ils n'ont pas été posés par
 * le même juge.
 *
 * CE QUE ÇA SERT À MESURER : l'écart d'une heure à l'autre. Deux réponses dans
 * la même soirée disent quelque chose qu'aucune note de fin de journée ne dit
 * — à quelle vitesse ça bouge. C'est déjà ce que compte `amplitude` ; il lui
 * manquait de la matière.
 *
 * POURQUOI SI ÉTROIT. Une échelle proposée sous chaque message deviendrait un
 * formulaire, et un formulaire dans une conversation la transforme en
 * questionnaire. Elle n'apparaît QUE sous une question qui porte sur
 * MAINTENANT, et seulement sur la dernière prise de parole du compagnon :
 * répondre à une question de la veille n'aurait aucun sens, puisque c'est
 * l'instant qu'on relève.
 * =====================================================================
 */

const norm = s => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’`\-]/g, ' ').replace(/\s+/g, ' ');

/* La question doit porter sur l'état, à la première personne, MAINTENANT. */
const DEMANDE = [
  /\bcomment (?:tu te sens|tu vas|ca va|tu le sens|tu te situes)\b/,
  /\btu te sens comment\b/, /\bca va comment\b/, /\btu vas comment\b/,
  /\bou (?:tu en es|en es tu)\b/, /\btu en es ou\b/,
  /\btu (?:tiens|encaisses|le vis) comment\b/,
  /\bca (?:donne|rend) quoi (?:la|maintenant|ce soir|a cette heure)\b/,
  /\btu (?:dirais|mettrais|situerais) (?:quoi|combien|ca ou)\b/,
  /\bc est a combien\b/, /\bce serait combien\b/,
  /\bquel (?:est ton|ton) (?:etat|niveau)\b/,
  /\bcomment c est (?:la|maintenant|ce soir)\b/,
];

/* Ce qui ressemble à la question et n'en est pas : elle porte sur AUTRE CHOSE
   que l'état présent (le passé, quelqu'un d'autre, une explication). */
const PAS_MAINTENANT = [
  /\bcomment (?:tu te sentais|ca allait|c etait)\b/,
  /\b(?:hier|avant hier|la semaine derniere|le mois dernier|a l epoque|ce matin la)\b/,
  /\bcomment (?:il|elle|ils|elles) (?:va|vont|se sent|se sentent)\b/,
  /\bcomment (?:tu expliques|tu fais|ca marche|tu t y prends)\b/,
  /\bcomment tu (?:as|avais) (?:fait|vecu|tenu)\b/,
];

/** L'heure vaut « maintenant » tant qu'elle est fraîche : au-delà, la question
    a été posée dans une autre soirée, et on ne relève pas un instant passé. */
export const FRAICHEUR_MS = 6 * 3600 * 1000;

/**
 * Ce message demande-t-il où la personne en est, MAINTENANT ?
 * @param {string} texte  ce que le compagnon vient d'écrire
 */
export function demandeUnRessenti(texte) {
  const t = norm(texte);
  if (!t.trim() || !t.includes('?')) return false;
  // On regarde la PHRASE qui porte le point d'interrogation : un message qui
  // raconte puis demande autre chose ne doit pas compter parce que « comment
  // tu te sens » traînait trois phrases plus haut.
  const phrases = String(texte).split(/(?<=[.!?…])\s+|\n+/).filter(p => p.includes('?'));
  for (const p of phrases) {
    const np = norm(p);
    if (PAS_MAINTENANT.some(re => re.test(np))) continue;
    if (DEMANDE.some(re => re.test(np))) return true;
  }
  return false;
}

/**
 * Faut-il proposer l'échelle sous ce message ?
 *
 * @param {object} m        le message ({id, role, text, ts})
 * @param {boolean} dernier est-ce la dernière prise de parole du compagnon ?
 * @param {Set<number>} repondus  les messages qui ont déjà reçu une réponse
 * @param {number} maintenant
 */
export function proposerLechelle(m, { dernier = false, repondus = new Set(), maintenant = Date.now() } = {}) {
  if (!dernier || !m || m.role !== 'assistant') return false;
  if (repondus.has(Number(m.id))) return false;          // on ne redemande pas
  const t = Date.parse(m.ts);
  if (Number.isFinite(t) && maintenant - t > FRAICHEUR_MS) return false;
  return demandeUnRessenti(m.text);
}
