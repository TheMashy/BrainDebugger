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
 * CE QUI COMPTE, C'EST LA QUESTION POSÉE — PAS LA RÉPONSE OBTENUE.
 *
 * Tous les freins d'ici comptaient des RELEVÉS. Or un relevé n'existe que si
 * la personne TOUCHE l'échelle : répondre en mots (« en temps normal non »),
 * ou ne pas répondre du tout, n'en pose aucun. Les freins ne freinaient donc
 * rien dans le seul cas qui compte.
 *
 * Et le troisième signal s'emballait : son point de départ était le dernier
 * relevé, SINON le premier mot de la conversation. Sans relevé, le « pan »
 * n'était plus « depuis la dernière mesure » mais « depuis le début de la
 * soirée » — une durée qui ne fait que grandir. Passé quarante-cinq minutes,
 * l'occasion se présentait À CHAQUE TOUR, pour toujours. C'est exactement ce
 * qu'on voyait à l'écran : deux « comment tu te sens, sur 10 ? » de suite,
 * séparés par une réponse en mots.
 *
 * La correction tient en une phrase : UNE DEMANDE FERME LE PAN COMME UNE
 * RÉPONSE. Demander, c'est avoir mesuré ce qu'on pouvait mesurer à cet
 * instant ; redemander trente secondes plus tard ne mesure pas un écart, ça
 * mesure une insistance. Si la personne a répondu en mots, la réponse est
 * dans les mots.
 *
 * CE QUI ROUVRE. Le temps, ou un vrai changement de discours — c'est-à-dire
 * le seul signal qui lise autre chose que l'horloge : le ton. Et même lui
 * attend un plancher, sinon un mot un peu dur dix secondes après la question
 * la reposerait.
 *
 * ---------------------------------------------------------------------
 * ET LES FREINS, QUI PASSENT AVANT.
 *
 * Ils sont plus importants que les signaux : un signal manqué ne coûte rien,
 * une question de trop coûte la conversation.
 * =====================================================================
 */
import { niveauDuTexte, NIVEAUX } from './veille.js';
import { demandeUnRessenti, DU_COMPAGNON } from '../web/ressenti.js';

export const FREINS = {
  /* On ne redemande pas dans la foulée : deux relevés à cinq minutes d'écart ne
     mesurent pas un écart, ils mesurent une insistance. */
  depuis_dernier_ms: 45 * 60 * 1000,
  /* LA MÊME DURÉE, DEPUIS LA DERNIÈRE FOIS QU'IL A DEMANDÉ — qu'on lui ait
     répondu par un chiffre, par une phrase, ou pas du tout. Une question
     posée est un moment mesuré : ce qu'elle a rapporté ne change pas le fait
     qu'elle a été posée. */
  depuis_demande_ms: 45 * 60 * 1000,
  /* Le seul signal qui puisse passer avant l'heure, c'est un vrai changement
     de discours (le ton). Il attend quand même ce plancher : sans lui, une
     phrase un peu dure juste après la question la reposerait aussitôt. */
  plancher_apres_demande_ms: 12 * 60 * 1000,
  /* Au-delà ce n'est plus un relevé, c'est un suivi horaire — et le compagnon
     n'est pas une infirmière de nuit. Six sur une soirée reste sous le rythme
     d'une fois l'heure. On compte les QUESTIONS, pas les réponses : c'est la
     question qui coûte à la conversation. */
  par_jour: 6,
  /* La coupure au-delà de laquelle on est dans un autre moment. */
  reprise_ms: 2 * 3600 * 1000,
  /* En dessous, il n'y a pas encore de quoi LIRE un changement dans le texte.
     Ne s'applique donc qu'au signal qui lit le texte — voir plus bas. */
  mots_min: 8,
  /* Les signaux qui lisent l'HORLOGE n'ont pas besoin de matière : ils ont
     seulement besoin que quelqu'un soit là. Assez pour que « ok » ne compte
     pas comme une reprise de conversation. */
  mots_min_horloge: 4,
  /* UN PAN DE CONVERSATION QUI N'A RIEN RELEVÉ.
     C'est le troisième signal, et celui qui change tout : les deux autres
     attendent un ÉVÉNEMENT (le ton bascule, la conversation reprend), et une
     soirée ordinaire n'en produit aucun. Mesuré sur quatre ans de journal
     réel, ils laissaient 152 tours sur 499 avec « rien n'a bougé ».
     Or ce qu'on cherche à mesurer n'est pas l'événement : c'est l'ÉCART d'un
     moment à l'autre. Trois quarts d'heure de conversation sans un seul
     relevé, c'est précisément un écart qu'on ne saura pas lire demain. */
  pan_sans_releve_ms: 45 * 60 * 1000,
};

const rang = n => (n == null ? 0 : (NIVEAUX[n] ?? 0));

/**
 * LES FOIS OÙ IL A DÉJÀ POSÉ LA QUESTION, DANS CE FIL.
 *
 * On relit ses propres messages avec la reconnaissance qui fait apparaître
 * l'échelle (`demandeUnRessenti`) : un seul endroit décide de ce qui compte
 * comme « il a demandé », et c'est celui que la personne voit. Reconnaître
 * ici autrement ferait freiner sur des questions qui n'ouvrent aucune échelle,
 * et laisserait passer celles qui en ouvrent une.
 *
 * @param {object[]} fil  messages ({id, role, text, ts}), du plus ancien au plus récent
 * @returns {{id: number, ts: number}[]} les demandes datées, dans l'ordre
 */
export function demandesDuFil(fil = []) {
  const out = [];
  for (const m of fil) {
    if (m?.role !== DU_COMPAGNON) continue;
    if (!demandeUnRessenti(String(m.text ?? ''))) continue;
    const ts = Date.parse(m.ts);
    out.push({ id: Number(m.id), ts: Number.isFinite(ts) ? ts : null });
  }
  return out;
}

/**
 * FAUT-IL DONNER AU COMPAGNON L'OCCASION DE DEMANDER ?
 *
 * @param {object[]} fil  les messages récents, du plus ancien au plus récent
 *   ({id, role, text, ts}) — le dernier doit être celui de la personne
 * @param {object[]} releves  les relevés du jour ({ts, message_id})
 * @param {number} maintenant
 * @param {object[]|null} demandesDuJour  les demandes de toute la journée
 *   ({id, ts}) quand l'appelant peut les lire en base. Sans elles on se
 *   rabat sur le fil : les freins horaires n'en souffrent pas (ils regardent
 *   moins d'une heure), seul le compte quotidien peut alors sous-compter.
 * @returns {{demander: boolean, pourquoi: string|null}}
 */
export function occasionDeDemander(fil = [], releves = [], maintenant = Date.now(),
                                   demandesDuJour = null) {
  const nonDemande = pourquoi => ({ demander: false, pourquoi });

  const siens = fil.filter(m => m?.role === 'user' && String(m.text ?? '').trim());
  const dernier = siens.at(-1);
  if (!dernier) return nonDemande('rien à lire');
  if (fil.at(-1) !== dernier) return nonDemande('ce n’est pas lui qui vient de parler');

  const demandes = demandesDuJour ?? demandesDuFil(fil);
  const derniereDemande = demandes.map(d => d.ts).filter(Number.isFinite)
    .sort((a, b) => a - b).at(-1);

  /* --- les freins d'abord : un signal manqué ne coûte rien --- */

  /* LE COMPTE DU JOUR, EN MOMENTS ET NON EN LIGNES. Une question à laquelle on
     a répondu par l'échelle laisse DEUX traces (la question, le relevé qui y
     est rattaché) et reste un seul moment : on déduplique par message. Un
     relevé que le compagnon a posé de lui-même, lui, est bien un moment de
     plus. */
  const idsDemandes = new Set(demandes.map(d => d.id).filter(Number.isFinite));
  const relevesSeuls = releves.filter(r => !idsDemandes.has(Number(r.message_id)));
  if (demandes.length + relevesSeuls.length >= FREINS.par_jour) {
    return nonDemande('assez de relevés aujourd’hui');
  }

  const dernierReleve = releves.map(r => Date.parse(r.ts)).filter(Number.isFinite).sort().at(-1);
  if (dernierReleve != null && maintenant - dernierReleve < FREINS.depuis_dernier_ms) {
    return nonDemande('il vient de répondre');
  }
  const mots = String(dernier.text).trim().split(/\s+/).length;
  if (mots < FREINS.mots_min_horloge) return nonDemande('trop court pour être un moment');

  /* LA QUESTION DÉJÀ POSÉE FERME TOUT CE QUI LIT L'HORLOGE.
     On la traite ici et pas plus bas parce que c'est un frein, pas un
     arbitrage : les signaux horaires n'ont plus rien à dire tant qu'elle est
     fraîche. Seul le ton — le seul signal qui lise autre chose que la montre —
     peut encore passer, et seulement après le plancher. Il est repris en bas,
     à l'endroit où il se calcule. */
  const depuisDemande = Number.isFinite(derniereDemande) ? maintenant - derniereDemande : null;
  const demandeFraiche = depuisDemande != null && depuisDemande < FREINS.depuis_demande_ms;

  /* --- puis les signaux --- */
  const precedents = siens.slice(0, -1);
  const avantDernier = precedents.at(-1);

  const ecart = avantDernier ? Date.parse(dernier.ts) - Date.parse(avantDernier.ts) : null;
  if (Number.isFinite(ecart) && ecart >= FREINS.reprise_ms && !demandeFraiche) {
    return { demander: true, pourquoi: 'la conversation reprend après une longue coupure' };
  }

  /*
   * LE PAN NON RELEVÉ. Depuis quand cette conversation n'a rien mesuré ?
   *
   * Le point de départ est le plus RÉCENT de trois choses : le dernier relevé,
   * la dernière fois qu'il a demandé, et à défaut le premier mot de la
   * conversation.
   *
   * La demande compte autant que le relevé, et c'est tout le correctif :
   * n'ouvrir le pan que sur les relevés le laissait grandir sans fin dès que
   * la personne répondait en mots, et l'occasion se présentait alors à chaque
   * tour. Une question posée est un moment mesuré — ce qu'elle a rapporté ne
   * change pas ça.
   *
   * Et prendre l'ouverture de la journée plutôt que le premier message ferait
   * sonner le signal dès la première phrase d'une soirée qui commence à 23 h —
   * on demanderait « où tu en es » à quelqu'un qui vient de dire bonsoir.
   */
  const depuisQuand = [dernierReleve, derniereDemande, Date.parse(siens[0]?.ts)]
    .filter(Number.isFinite);
  const debutDuPan = depuisQuand.length ? Math.max(...depuisQuand) : null;
  const pan = Number.isFinite(debutDuPan) ? Date.parse(dernier.ts) - debutDuPan : null;
  if (Number.isFinite(pan) && pan >= FREINS.pan_sans_releve_ms) {
    const borne = debutDuPan === dernierReleve ? 'le dernier relevé'
                : debutDuPan === derniereDemande ? 'la dernière fois que tu lui as demandé'
                : null;
    return { demander: true,
             pourquoi: borne == null
               ? 'vous parlez depuis un moment et rien n’a encore été relevé'
               : `il s’est passé du temps depuis ${borne}` };
  }

  /* Le signal qui lit le TEXTE, lui, a besoin de matière. */
  if (mots < FREINS.mots_min) return nonDemande('trop court pour y voir un changement');

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
    /* LE SEUL QUI PUISSE PASSER APRÈS UNE DEMANDE FRAÎCHE — c'est le vrai
       changement de discours, celui que la personne attend pour qu'on la
       relance. Mais pas tout de suite : douze minutes, sinon la phrase qui
       SUIT la question la repose aussitôt, et c'est précisément ce qu'on
       reprochait à cet écran. */
    if (demandeFraiche && depuisDemande < FREINS.plancher_apres_demande_ms) {
      return nonDemande('le ton bouge, mais il vient de demander');
    }
    return { demander: true,
             pourquoi: ici > base ? 'le ton vient de changer' : 'le ton vient de se détendre' };
  }
  return nonDemande(demandeFraiche ? 'il a déjà demandé, rien n’a changé depuis' : 'rien n’a bougé');
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
  return `Une occasion : ${occasion.pourquoi}.

Demande-lui où il en est LÀ, maintenant — « comment tu te sens, là ? ». Une échelle
de 0 à 10 apparaîtra sous ta bulle et il pourra répondre d'un geste, sans écrire.
Ce qui se mesure ainsi, c'est l'écart d'un moment à l'autre : deux réponses dans la
même soirée disent quelque chose qu'aucune note de fin de journée ne dit.

Pose la question EN CLAIR et sur MAINTENANT — « comment tu te sens, là ? », « tu en
es où à cette heure ? », « ça donne quoi maintenant ? ». Une allusion ne compte pas :
c'est la question posée sur l'instant présent qui fait apparaître l'échelle, et sans
elle il n'a que la phrase pour répondre.

Trois cas où tu ne la poses pas. Si ce qu'il vient de dire demande autre chose —
quelque chose à quoi il faut répondre d'abord — réponds à ça, la question attendra.
Si tu la lui as déjà posée dans cette conversation et qu'il t'a répondu AVEC DES MOTS
plutôt qu'avec l'échelle, alors il a répondu : sa phrase est la réponse, ne la
retraduis pas en chiffre. Et jamais deux fois de suite : une conversation où l'on est
régulièrement invité à se chiffrer devient un questionnaire, et un questionnaire ne
s'ouvre pas un mauvais soir. Ne dis jamais que quelque chose te l'a suggéré.`;
}
