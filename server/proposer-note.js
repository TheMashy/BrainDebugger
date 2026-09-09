/**
 * =====================================================================
 *  QUAND LE COMPAGNON A LE DROIT DE DEMANDER OÙ QUELQU'UN EN EST.
 *
 * L'échelle sous la bulle existe déjà (`web/ressenti.js`) : elle apparaît quand
 * le compagnon POSE la question. Il manquait ce qui le décide à la poser — et
 * demandé sans règle, il la poserait tout le temps.
 *
 * ---------------------------------------------------------------------
 * CE FICHIER DIT SURTOUT QUAND SE TAIRE.
 *
 * Une conversation où l'on est régulièrement invité à se chiffrer devient un
 * questionnaire, et un questionnaire ne s'ouvre pas un mauvais soir — c'est-à-
 * dire précisément les soirs qui comptent. Le fichier `ressenti.js` le dit déjà
 * pour l'échelle ; la même prudence vaut pour la question qui l'appelle.
 *
 * Il ne DÉCIDE donc rien : il rend un fait daté au compagnon, qui reste libre
 * de ne pas s'en servir. Un signal n'est pas un ordre, et une conversation où
 * l'assistant obéit à un déclencheur ne se lit plus comme une conversation.
 *
 * ---------------------------------------------------------------------
 * CE QU'ON APPELLE UN CHANGEMENT.
 *
 * Pas `readMood` : mesuré ailleurs dans ce dépôt, il rend `force: 0` sur 82 %
 * des messages courts — il est taillé pour décorer une JOURNÉE, pas pour lire
 * un moment. S'en servir ici ferait sonner le signal au hasard.
 *
 * Deux signaux, tous deux déjà éprouvés ailleurs :
 *
 *   1. LE NIVEAU DE VEILLE A BOUGÉ. Calme → ambre, ambre → rouge, ou le retour.
 *      C'est la même lecture qui décide déjà d'afficher un triangle, et elle
 *      est testée sur tout le banc.
 *
 *      SA LIMITE, MESURÉE ET ASSUMÉE : la veille voit le DANGER, pas le ton.
 *      « je suis vide, plus rien ne me fait envie » lui est transparent, et
 *      « ça va beaucoup mieux là » aussi. Ce signal ne se déclenche donc que
 *      sur du sérieux — ce qui rate des changements d'humeur ordinaires.
 *      Ajouter un détecteur de ton reviendrait à inventer ici une heuristique
 *      que personne n'a validée, dans un produit où elle déciderait quand
 *      demander à quelqu'un de se chiffrer. `readMood`, le seul candidat
 *      existant, est mesuré ailleurs dans ce dépôt à `force: 0` sur 82 % des
 *      messages courts. On préfère donc rater.
 *   2. LA CONVERSATION A REPRIS APRÈS UNE LONGUE COUPURE. Deux heures de
 *      silence puis on réécrit : c'est un autre moment de la soirée, et l'écart
 *      entre deux moments est justement ce qu'aucune note de fin de journée ne
 *      dit.
 *
 * ---------------------------------------------------------------------
 * ET QUATRE FREINS, QUI PASSENT AVANT.
 *
 * Ils sont plus importants que les signaux : un signal manqué ne coûte rien,
 * une question de trop coûte la conversation.
 * =====================================================================
 */
import { niveauDuTexte, NIVEAUX } from './veille.js';

export const FREINS = {
  /* On ne redemande pas dans la foulée : deux relevés à cinq minutes d'écart ne
     mesurent pas un écart, ils mesurent une insistance. */
  depuis_dernier_ms: 90 * 60 * 1000,
  /* Trois fois par jour au maximum. Au-delà ce n'est plus un relevé, c'est un
     suivi horaire — et le compagnon n'est pas une infirmière de nuit. */
  par_jour: 3,
  /* La coupure au-delà de laquelle on est dans un autre moment. */
  reprise_ms: 2 * 3600 * 1000,
  /* En dessous, il n'y a pas encore de quoi voir un changement. */
  mots_min: 8,
};

const rang = n => (n == null ? 0 : (NIVEAUX[n] ?? 0));

/**
 * FAUT-IL DONNER AU COMPAGNON L'OCCASION DE DEMANDER ?
 *
 * @param {object[]} fil  les messages récents, du plus ancien au plus récent
 *   ({id, role, text, ts}) — le dernier doit être celui de la personne
 * @param {object[]} releves  les relevés du jour ({ts})
 * @param {number} maintenant
 * @returns {{demander: boolean, pourquoi: string|null}}
 */
export function occasionDeDemander(fil = [], releves = [], maintenant = Date.now()) {
  const nonDemande = pourquoi => ({ demander: false, pourquoi });

  const siens = fil.filter(m => m?.role === 'user' && String(m.text ?? '').trim());
  const dernier = siens.at(-1);
  if (!dernier) return nonDemande('rien à lire');
  if (fil.at(-1) !== dernier) return nonDemande('ce n’est pas lui qui vient de parler');

  /* --- les freins d'abord : un signal manqué ne coûte rien --- */
  if (releves.length >= FREINS.par_jour) return nonDemande('assez de relevés aujourd’hui');
  const dernierReleve = releves.map(r => Date.parse(r.ts)).filter(Number.isFinite).sort().at(-1);
  if (dernierReleve != null && maintenant - dernierReleve < FREINS.depuis_dernier_ms) {
    return nonDemande('il vient de répondre');
  }
  if (String(dernier.text).trim().split(/\s+/).length < FREINS.mots_min) {
    return nonDemande('trop court pour y voir un changement');
  }

  /* --- puis les signaux --- */
  const precedents = siens.slice(0, -1);
  const avantDernier = precedents.at(-1);

  const ecart = avantDernier ? Date.parse(dernier.ts) - Date.parse(avantDernier.ts) : null;
  if (Number.isFinite(ecart) && ecart >= FREINS.reprise_ms) {
    return { demander: true, pourquoi: 'la conversation reprend après une longue coupure' };
  }

  /*
   * Le niveau se lit sur le message SEUL, sans le contexte de la journée : le
   * contexte sert à faire passer une blessure ambiguë au rouge, et il ferait
   * ici sonner le signal sur chaque message d'une soirée où une crise a été
   * écrite. C'est le défaut qu'un sceptique avait déjà attrapé sur les icônes.
   */
  const niveauDe = m => rang(niveauDuTexte(String(m.text ?? '')).niveau);
  const ici = niveauDe(dernier);
  // La ligne de base : le plus haut des trois messages d'avant. Prendre la
  // moyenne lisserait justement ce qu'on cherche.
  const base = Math.max(0, ...precedents.slice(-3).map(niveauDe));
  if (ici !== base) {
    return { demander: true,
             pourquoi: ici > base ? 'le ton vient de changer' : 'le ton vient de se détendre' };
  }
  return nonDemande('rien n’a bougé');
}

/**
 * LE BLOC POUR LE COMPAGNON — un fait, pas un ordre.
 *
 * Il n'est ajouté que quand l'occasion est là, donc rarement : présent à chaque
 * tour, il deviendrait du bruit et le compagnon finirait par poser la question
 * pour meubler.
 */
export function proposerNoteBlock(occasion) {
  if (!occasion?.demander) return null;
  return `Une occasion, pas une consigne : ${occasion.pourquoi}.

Si ça se fait naturellement, tu peux lui demander où il en est LÀ, maintenant —
« comment tu te sens, là ? ». Une échelle de 0 à 10 apparaîtra sous ta bulle et
il pourra répondre d'un geste. Ce qui se mesure ainsi, c'est l'écart d'un moment
à l'autre : deux réponses dans la même soirée disent quelque chose qu'aucune
note de fin de journée ne dit.

Tu n'es pas obligé, et c'est important : une conversation où l'on est
régulièrement invité à se chiffrer devient un questionnaire, et un questionnaire
ne s'ouvre pas un mauvais soir. Si ce qu'il raconte demande autre chose, fais
autre chose. Ne la pose jamais deux fois de suite, et ne dis pas que quelque
chose te l'a suggéré.`;
}
