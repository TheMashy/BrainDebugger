import {
  db, getSettings, setSettings, publicSettings, allEntries, getEntry, setNote,
  addMessage, messagesForDate, recentMessages, filAncre, allEvents, deleteEvent,
  comptesVerdicts,
  allAnchors, setAnchor, getUser, deleteDay, clearNote, wipe, OWNER,
  addEvent, allMotifs, addMotif, marquerMotif, motifsDesMessages, deleteMotif, teinterMotif, motifSeries,
  promouvoirMotif,
  addCarnet, allCarnet, carnetDuJour, updateCarnet, deleteCarnet, countCarnet,
  updateEvent, renommerMotif, rangerMessage, allObjectifs, addObjectif, marquerObjectif, deleteObjectif,
  getLecture, setLecture, rembobiner, addReleve, relevesDuJour, relevesDuMessage, relevesDeToi, amplitude, amplitudes, TEINTES,
  inventaireMesures, derniereMesure, oublierMesure, journalQS, viderJournalQS, mesuresDuJour,
  allSeances, addSeance, updateSeance, deleteSeance, motifsEntre,
  toutesMesures, signatureQS, activiteJours, activiteDuJour, derniereSynchro, versionMachiTool, joursEcrits,
  mesuresEntre, poserMesure, normaliserTs,
  redaterMessages, rebuildEntryText, tousMessagesUtilisateur
} from './db.js';
import { usageFor, record as recordUsage, serieUsage, profilUsage, FENETRES } from './usage.js';
import { buildSeries, episodes, followUp, yearGrid, streak, indexByDate, addDays, median, CONTRAST_SATURATION, DEFAULT_ETALON } from './stats.js';
import { inspectCSV, applyImport } from './import-csv.js';
import { compteRendu, intervalle } from './compte-rendu.js';
import { joursDuRendezVous, comptesDuRendezVous } from './rendez-vous.js';
import { passagesSansVerdict, lancerLotVeille, releverLotVeille, MAX_PAR_LOT }
  from './juge-veille-lot.js';
import { SENS_VERDICT } from './juge-veille.js';
import { liens } from './liens.js';
import { inspectNotes, applyNotes } from './import-notes.js';
import * as sessions from './sessions.js';
import { readMoodFil, readEnergy, SENS } from './mood.js';
import { buildGraph, MIN_JOURS } from './graph.js';
import { journee } from './journee.js';
import { fonctionnements } from './fonctionnements.js';
import { nuits, nuitDuJour, rythmeUtilisateur, paireEstUneNuit, MIN_NUIT } from './nuits.js';
import { occasionDeDemander, proposerNoteBlock } from './proposer-note.js';
import { horizonBlock } from './horizons.js';
import { attente, poserCle, retirerCle, synchroDemandee } from './passerelle.js';
import { corpusPour, lire, lireEnFlux, lancerLot, releverLot, MIN_JOURS as LECTURE_MIN, VERSION_LECTURE } from './lecture.js';
import { sensDesLiens } from './sens.js';
import { etats as etatsMotifs, injecterPromus, SEUILS_PROMOTION } from './promotion.js';
import { nuitDe, archetypeDe, usageDuJour, resumeDuJour, estDetail, enMinutes,
         chiffresDuJour, contient, COUCHER, LEVER, DERNIERE, PREMIERE } from './allure.js';
import { lireDigest } from './digest.js';
import { bornesDitesDans, bornesConnues, medianeBorne, jourVecuDe, coupureDe, veilleDe,
         SOURCE_DIT, CLE_LEVER, CLE_COUCHER, MIDI, noteDiteDans } from './jour-vecu.js';
import { veilleDuJour, DIT as VEILLE_DIT, AIDE as VEILLE_AIDE } from './veille.js';
const { presence, presenceNote } = sessions;
import { buildIndex, search, tokenize } from './search.js';
import { saillant, poids as poidsMot, lisible } from './lexique.js';
// Partage avec le navigateur : le theme d'un repere doit etre le meme des deux
// cotes, sinon l'icone annoncee n'est pas celle qui s'affiche. Voir l'en-tete
// de web/reperes.js.
import { themeDe, ICONES } from '../web/reperes.js';
// Meme raison : la geometrie de la frise doit etre calculee une seule fois, au
// meme endroit, sinon le serveur annonce une hauteur et le navigateur en
// dessine une autre.
import { voies, etendue, estPeriode, finEffective } from '../web/frise.js';
import { reply, resolveKey, echoBlock, ECHO_CAR, memoryBlock, anchorBlock, fenetreBlock, grilleExtrait, bornerPeriode, jalonBlock, motifBlock, carnetBlock, prisesBlock,
         CARNET_CAR, ANTHROPIC_MODELS, testKey } from './chat.js';
// L'heure de celui qui ecrit, pas celle du processus. Voir server/temps.js.
import { jourLocal, heureLocale, etatDuTemps } from './temps.js';
import { comparaisons } from './comparer.js';
import { prises } from './prises.js';
import { proposerLechelle } from '../web/ressenti.js';

/* ---------- cache : la serie complete coute ~10ms sur 1700 jours ----------
   Indexe par utilisateur : un cache global rendrait le journal de l'un a
   l'autre, ce qui serait la pire fuite possible sur ce produit. */
const _cache = new Map();
/*
 * LES PRISES ONT LEUR CACHE, ET IL EST OBLIGATOIRE.
 *
 * `prises()` repasse les expressions de six familles sur TOUT le journal :
 * mesuré à 270 ms sur 750 journées d'un millier de caractères. Ce n'est rien
 * pour un onglet qu'on ouvre, et c'est inacceptable dans `recentMemory`, qui
 * tourne à CHAQUE message envoyé — un quart de seconde de calcul bloquant
 * ajouté à chaque phrase, sur le seul fil du serveur.
 *
 * Le calcul ne dépend que du journal et de la carte, et `invalidate` est déjà
 * appelé à chaque écriture. Le même cache, la même clé, la même vidange.
 */
const _prises = new Map();
export function invalidate(userId) {
  if (userId === undefined) { _cache.clear(); _prises.clear(); }
  else { _cache.delete(userId); _prises.delete(userId); }
}
function prisesDe(userId = OWNER) {
  if (!_prises.has(userId))
    _prises.set(userId, prises(userId, { carte: getLecture(userId)?.contenu?.carte ?? null }));
  return _prises.get(userId);
}
function series(userId = OWNER) {
  if (!_cache.has(userId)) {
    const rows = allEntries(userId);
    const s = buildSeries(rows, { etalon: getSettings(userId).etalon });
    const textDocs = rows.filter(r => r.text && r.text.trim()).map(r => ({ id: r.date, text: r.text }));
    // Le carnet a SON index, jamais fusionne avec celui des journees. BM25
    // normalise par la longueur moyenne des documents : verser les notes dans
    // l'index des journees deplacerait cette moyenne pour TOUTES les journees et
    // degraderait « Tu as deja ecrit ca » partout, y compris sur des journees
    // sans aucun rapport. Le prefixe « n » garantit qu'un identifiant de note ne
    // peut jamais etre confondu avec une cle de date.
    const carnet = allCarnet(userId);
    _cache.set(userId, {
      rows, series: s, byDate: indexByDate(s),
      index: buildIndex(textDocs), textCount: textDocs.length,
      carnet, indexCarnet: buildIndex(carnet.map(c => ({ id: `n${c.id}`, text: c.texte })))
    });
  }
  return _cache.get(userId);
}

/**
 * Les journees ecrites les plus recentes, dans les mots exacts de l'utilisateur.
 * Uniquement du TEXTE : jamais les statistiques, jamais les episodes. Le
 * compagnon n'a pas a connaitre les chiffres -- c'est le Miroir qui les montre.
 */
/**
 * @param {string} date
 * @param {string} userId
 * @param {string|null} texte  ce qu'il vient d'ecrire, pour y chercher des echos
 */
/**
 * COMBIEN DE MESSAGES DU FIL PARTENT AVEC CHAQUE QUESTION.
 *
 * C'etait soixante. Renvoyes a chaque tour, et un echange avec outils coute
 * deux ou trois tours : soixante messages traversaient le reseau trois fois
 * pour une reponse de deux phrases.
 *
 * Vingt-cinq suffisent, parce que la memoire longue de ce produit ne passe pas
 * par le fil : les journees passees, les reperes, la grille et les motifs
 * arrivent par le bloc de memoire, et ce que la lecture de fond a compris
 * arrive par la lecture. Le fil ne sert qu'a une chose -- savoir de quoi on
 * est en train de parler -- et vingt-cinq messages, c'est une soiree entiere.
 */
/*
 * Pair, parce que la fenetre est ancree par paliers pairs (voir `filAncre`) :
 * un debut de fenetre qui tombe toujours sur un message de la personne.
 */
export const FIL_TRANSMIS = 24;

export function recentMemory(date, userId = OWNER, texte = null) {
  const s = getSettings(userId);
  const days = Number(s.memoryDays ?? 0);

  const morceaux = [];

  if (days) {
    const rows = db.prepare(`
      SELECT date, note, text FROM entries
      WHERE user_id = ? AND date < ? AND text IS NOT NULL AND TRIM(text) <> ''
      ORDER BY date DESC LIMIT ?
    `).all(userId, date, days).reverse();
    const bloc = memoryBlock(rows);
    if (bloc) morceaux.push(bloc);
  }

  // Les reperes survivent a « Nouveau chat » : c'est ce qui fait qu'un fil
  // repartant de zero connait quand meme la personne en face.
  const ancres = anchorBlock(allAnchors(userId));
  if (ancres) morceaux.push(ancres);

  /*
   * LA FENETRE COURTE, PAS LA GRILLE ENTIERE.
   *
   * La grille complete tenait ici, et pesait 2951 des 3855 tokens de la memoire
   * stable a trois ans -- 77 %, le seul bloc qui grandisse vraiment, mille
   * tokens de plus par annee vecue, a chaque message. Elle est remplacee par
   * cinq semaines jour par jour, plus trois lignes de socle, et le reste
   * s'atteint avec `lire_grille`.
   *
   * La grille ne disparait pas : elle reste ce qu'elle a toujours ete pour la
   * personne -- son historique, a l'ecran, en entier. C'est le COMPAGNON qui
   * cesse de la porter en permanence.
   */
  const { rows, series: ser } = series(userId);
  const ref = ser.length ? ser[ser.length - 1].reference : null;
  const fenetre = fenetreBlock(rows, { fin: date, reference: ref });
  if (fenetre) morceaux.push(fenetre);

  // Ce que le compagnon a deja pose. Sans cette liste il reposerait chaque
  // matin le repere de la veille, et declarerait trois fois le meme motif sous
  // trois noms voisins -- l'echec classique d'un agent sans etat.
  /*
   * OU IL EN EST, SUR PLUSIEURS DISTANCES.
   *
   * Le compagnon avait les quatorze dernieres journees telles qu'ecrites, et la
   * grille des notes sur quatre ans. Entre les deux, rien : sur « ca fait
   * combien de temps que ca dure ? », il avait le texte de la semaine et une
   * suite de chiffres, et il repondait a cote.
   *
   * Ces quatre synthese sont ecrites UNE FOIS par la lecture de fond, qui lit
   * deja tout. Elles ne remplacent pas les journees brutes -- il doit lire ce
   * qu'elle a ECRIT, pas un resume d'elle -- elles portent la DISTANCE, qu'il
   * n'avait pas du tout. Et elles ne changent qu'une fois par semaine, donc
   * elles se mettent en cache avec le reste de la memoire stable.
   */
  if (days) {
    const h = horizonBlock(getLecture(userId)?.contenu?.horizons);
    if (h) morceaux.push(h);
  }

  const jalons = jalonBlock(allEvents(userId));
  if (jalons) morceaux.push(jalons);
  const motifs = motifBlock(allMotifs(userId));
  if (motifs) morceaux.push(motifs);

  // Le carnet, sous le MEME `if (days)` que les journees : l'interface promet
  // qu'a zero le compagnon ne connait que la conversation du jour, et ca doit
  // rester vrai. C'est aussi la maniere de retirer le carnet du contexte sans
  // rien detruire.
  if (days && s.carnetMemoire !== false) {
    const c = carnetBlock(series(userId).carnet);
    if (c) morceaux.push(c);
  }

  /*
   * CE QUI A DE LA PRISE, SOUS LA MEME GARDE.
   *
   * Meme raison que le carnet : a memoire zero, l'interface promet qu'il ne
   * connait que la conversation du jour. Et un reglage a lui, parce que se
   * savoir compte sur ce terrain-la n'est pas la meme chose que se savoir lu.
   *
   * Le bloc est calcule ici et pas mis en cache ailleurs : `prises()` relit le
   * journal entier, mais uniquement du texte deja charge, et le resultat ne
   * change qu'avec les comptages -- donc il se met en cache avec le reste de la
   * memoire stable, ce qui est tout l'interet de le poser ici plutot que dans
   * le tour en cours.
   */
  if (days && s.prisesMemoire !== false) {
    try {
      const p = prisesBlock(prisesDe(userId));
      if (p) morceaux.push(p);
    } catch { /* un comptage qui echoue ne doit pas emporter la conversation */ }
  }

  /*
   * Les echos : ce qu'il a deja ecrit de tres proche de ce qu'il vient de dire.
   *
   * Sous le MEME `if (days)` que les journees, et pour la meme raison : a
   * memoire zero, l'interface promet qu'il ne connait que la conversation du
   * jour, et lui passer trois journees de 2023 par une autre porte ferait de
   * cette promesse un mensonge.
   *
   * Le seuil est celui de l'ancien panneau, a l'identique -- score > 0.6 ET au
   * moins un mot saillant. C'est ce qui fait que le bloc est absent la plupart
   * du temps : present a chaque tour, il deviendrait du bruit, et le compagnon
   * finirait par le citer pour meubler.
   */
  /*
   * ===================================================================
   * A PARTIR D'ICI, CE QUI CHANGE A CHAQUE PHRASE.
   *
   * Tout ce qui precede tient la journee : les journees passees, les ancres,
   * la grille, les jalons, les motifs, le carnet. Ces blocs partent dans le
   * prompt systeme, avec un point de reprise de cache -- ils sont relus a
   * un dixieme du prix a chaque message de la soiree.
   *
   * Les echos et la presence, eux, dependent de CE QUI VIENT D'ETRE ECRIT.
   * Poses dans le systeme, ils invalideraient a chaque phrase le cache de
   * toute la conversation qui suit : le cache ne prendrait jamais, et on
   * paierait en plus le quart de surcout de l'ecriture. Ils partent donc a
   * part, et le compagnon les recoit dans le dernier tour.
   * ===================================================================
   */
  const stable = morceaux.length ? morceaux.join('\n\n---\n\n') : null;
  const volatil = [];

  if (days && texte && String(texte).trim().length >= 12) {
    const { index, rows, byDate, textCount } = series(userId);
    if (textCount >= 2) {
      const hits = search(index, String(texte), { limit: 3, exclude: new Set([date]) })
        .filter(h => h.score > 0.6 && h.forts.length);
      const bloc = echoBlock(hits.map(h => ({
        date: h.id,
        note: byDate.get(h.id)?.note ?? null,
        text: rows.find(r => r.date === h.id)?.text ?? ''
      })).filter(h => h.text.trim()));
      if (bloc) volatil.push(bloc);
    }
  }

  // La presence : depuis quand il n'a rien dit. Elle change entre deux
  // messages par definition, donc elle est du cote volatil.
  const note = presenceNote(presence(userId));
  if (note) volatil.push(note);

  /*
   * L'OCCASION DE DEMANDER OÙ IL EN EST — volatile par nature.
   *
   * Elle dépend du message qu'on vient de lire et des relevés déjà posés
   * aujourd'hui : posée du côté stable, elle invaliderait le cache à chaque
   * phrase. Et elle est RARE par construction (voir proposer-note.js) : un bloc
   * présent à chaque tour deviendrait du bruit, et le compagnon finirait par
   * poser la question pour meubler.
   */
  try {
    const occ = occasionDeDemander(recentMessages(30, userId), relevesDuJour(today(), userId));
    const bloc = proposerNoteBlock(occ);
    if (bloc) volatil.push(bloc);
  } catch { /* un signal qui échoue ne doit pas emporter la conversation */ }

  return { stable, echos: volatil.length ? volatil.join('\n\n---\n\n') : null };
}

/**
 * La scene du fond, pour le navigateur.
 *
 * Calculee sur le fil COURANT, pas sur tout l'historique : le decor suit la
 * conversation en train de se tenir. Rien de ce qui est ici ne remonte au
 * compagnon -- s'il savait qu'un decor existe, il en parlerait, et commenter le
 * decor revient a commenter l'humeur.
 */
export function ambiance(userId = OWNER) {
  // Du plus ancien au plus recent : `readMoodFil` fait decroitre le poids en
  // remontant, et l'ordre est ce qui le lui dit.
  const msgs = recentMessages(80, userId).filter(m => m.role === 'user').map(m => m.text);
  const t = today();
  const note = getEntry(t, userId)?.note ?? null;
  const { series: ser } = series(userId);
  const ref = ser.length ? ser[ser.length - 1].reference : null;
  const m = readMoodFil(msgs, note);
  /*
   * `drift` a deux vies, et il ne faut pas les confondre. C'est la scene par
   * DEFAUT -- celle qu'on affiche quand rien ne ressort -- et c'est aussi
   * celle d'un etat, etre perdu, qui a maintenant ses mots a elle. La force
   * les separe : a zero, on n'a rien compris et on ne pretend rien ; au-dessus,
   * c'est une reponse, et elle a le droit de se dire.
   */
  return { scene: m.scene, force: m.force,
           sens: m.force > 0 ? (SENS[m.scene] ?? null) : null,
           energie: readEnergy(note, ref) };
}

/** Ce que le navigateur a le droit de savoir de la personne connectée. */
export function publicUser(userId) {
  const u = getUser(userId);
  return u ? { id: u.id, username: u.username, avatar: u.avatar } : { id: userId, username: null, avatar: null };
}

/**
 * La journee de CELUI QUI ECRIT.
 *
 * Pas celle du processus : heberge, il tourne en UTC, et une note posee a
 * 00h30 a Paris tombait sur la veille -- un trou dans la grille, et la
 * journee d'avant notee deux fois. La zone vient du navigateur (en-tete
 * « X-Fuseau », pose une fois pour toute la requete dans index.js) ; a
 * defaut, celle du serveur, qui est la bonne quand tout tourne sur la meme
 * machine -- le cas nominal de ce produit.
 */
export const today = () => jourLocal(Date.now());

/* ==================================================================
   LA JOURNEE VECUE : celle qui commence au lever, pas a minuit.
   ================================================================== */

/** Sur quelle fenetre on cherche ses bornes. Assez pour une mediane stable. */
const FENETRE_LEVERS = 120;

const MEMO_LEVERS = new Map();

/**
 * SES BORNES, RELUES UNE FOIS PAR CHANGEMENT DE MESURES.
 *
 * La question « a quelle journee appartient cet instant ? » se pose a chaque
 * message ; recharger cent vingt jours de mesures a chaque fois serait cent
 * vingt jours pour une seule heure. Comme pour les liens, l'invalidation se
 * fait a la SIGNATURE et pas au temps : une borne qu'on vient d'enregistrer
 * doit compter tout de suite, et c'est justement le moment ou quelqu'un ecrit.
 */
export function bornesDe(userId = OWNER) {
  const sig = signatureQS(userId);
  const vu = MEMO_LEVERS.get(userId);
  if (vu?.sig === sig) return vu.out;
  const fin = today();
  const bornes = bornesConnues(mesuresEntre(addDays(fin, -FENETRE_LEVERS + 1), fin, userId));
  const out = { bornes, med: medianeBorne(bornes) };
  MEMO_LEVERS.set(userId, { sig, out });
  return out;
}

/**
 * LA JOURNEE A LAQUELLE APPARTIENT MAINTENANT.
 *
 * C'est ce qui remplace `today()` pour un message qui arrive : quelqu'un qui
 * ecrit a 2 h du matin finit sa soiree, il ne commence pas sa journee. Sans
 * lever connu, `jourVecuDe` rend la journee civile -- on ne deplace rien sur
 * une supposition.
 *
 * CE QUI EST DEJA ECRIT NE BOUGE PAS. Une borne enregistree a 8 h ne va pas
 * rechercher les messages de 7 h pour les redater : la grille de quelqu'un ne
 * doit pas se reecrire derriere lui.
 */
export const jourVecu = (userId = OWNER, quand = Date.now()) => {
  const { bornes, med } = bornesDe(userId);
  return jourVecuDe(quand, { bornes, medBorne: med }) ?? today();
};

/**
 * CE QUE CE MESSAGE DIT DE SON LEVER OU DE SON COUCHER, ENREGISTRE.
 *
 * Le chemin sans modele et sans application tierce : « je viens de me lever »
 * suffit. L'heure vient de la phrase quand elle y est, sinon de l'instant du
 * message -- quelqu'un qui ecrit « je viens de me lever » vient de se lever.
 *
 * @returns {boolean} vrai si une borne a ete posee.
 */
export function noterBornesDites(texte, userId = OWNER, quand = Date.now()) {
  const b = bornesDitesDans(texte);
  if (!b) return false;
  const heure = b.heure ?? heureLocale(quand);
  const date = jourLocal(quand);
  if (!heure || !date) return false;
  poserMesure({ date, source: SOURCE_DIT, cle: b.genre === 'lever' ? CLE_LEVER : CLE_COUCHER,
                texte: heure, userId });
  recalerLaNuit(date, userId);
  return true;
}

/**
 * UNE NOTE ECRITE DANS LA CONVERSATION DEVIENT UN RELEVE.
 *
 * « ressenti avant de m'endormir 1/10 la » : ecrit noir sur blanc, et absent
 * partout. Le compagnon a bien un outil pour poser un releve, mais c'est LUI
 * qui decide de s'en servir — hors ligne, distrait, ou simplement occupe a
 * repondre, il ne le fait pas. Ce qui est ecrit en toutes lettres ne doit
 * dependre de personne.
 *
 * LE RELEVE PORTE `source: 'toi'`, le mot que la colonne emploie deja pour
 * « la personne l'a pose elle-meme ». C'est exactement ce dont il s'agit : elle
 * l'a ecrit. Inventer un troisieme mot ferait un troisieme vocabulaire pour la
 * meme chose, et `relevesDeToi` — qui alimente deja l'ecran — ne le verrait
 * pas.
 *
 * ET IL N'Y EN A QU'UN PAR MESSAGE. Le meme message relu deux fois — une
 * relecture retroactive, un rangement — ne doit pas empiler deux fois la meme
 * note : `addReleve` est ancre au message, et on regarde d'abord s'il en porte
 * deja un.
 *
 * @returns {boolean} vrai si un releve a ete pose.
 */
export function noterNoteDite(texte, messageId, date, userId = OWNER) {
  if (!messageId || !date) return false;
  const n = noteDiteDans(texte);
  if (!n) return false;
  if (relevesDuMessage(messageId, userId).length) return false;
  const r = addReleve({ messageId, date, valeur: n.valeur, quoi: n.extrait,
                        source: 'toi', userId });
  return !!r;
}

/**
 * LA NUIT QU'ON VIENT DE FERMER REJOINT LA JOURNEE QU'ELLE TERMINAIT.
 *
 * On apprend la frontiere APRES coup : « je vais me coucher » arrive a 6 h du
 * matin, et tout ce qui a ete ecrit cette nuit-la est deja range sur la
 * journee civile du lendemain. Sans ce recalage, la borne est enregistree, la
 * regle est juste, et l'ecran continue d'afficher la soiree au mauvais endroit
 * -- ce qui revient a n'avoir rien fait.
 *
 * CE QUI EST DEPLACE EST BORNE ET EXPLICABLE : les messages de CETTE journee
 * civile, ecrits AVANT la coupure. Rien d'autre, jamais plus d'un jour en
 * arriere. Une grille ne se reecrit pas toute seule ; une soiree se range
 * derriere l'heure ou elle s'est terminee.
 *
 * @returns {number} combien de messages ont change de journee.
 */
export function recalerLaNuit(date, userId = OWNER, bornesPretes = null) {
  // Les bornes peuvent venir de l'appelant : quand on reprend tout le journal,
  // les recalculer par jour ferait des milliers de requêtes pour le même
  // résultat.
  const { bornes, med } = bornesPretes ?? bornesDe(userId);
  const coupure = coupureDe(date, bornes, med);
  if (coupure == null) return 0;

  const avant = messagesForDate(date, userId).filter(m => {
    // IDEMPOTENCE : ne toucher qu'aux messages RÉELLEMENT écrits le jour civil
    // `date`. Un message déjà rangé sur `date` par un recalage précédent garde
    // un ts du petit matin ; sans ce garde, on le comparerait encore à la
    // coupure de `date` et on le renverrait un jour plus tôt à chaque passe —
    // dérive sans fin, texte des journées corrompu. Le jour civil se lit sur le
    // TS (jamais réécrit), comme le fait jourVecuDe.
    if (jourLocal(m.ts) !== date) return false;
    const h = enMinutes(heureLocale(m.ts));
    return h != null && h < coupure;
  });
  if (!avant.length) return 0;

  const veille = veilleDe(date);
  const bouges = redaterMessages(avant.map(m => m.id), veille, userId);
  // Le texte d'une journee est DERIVE de ses messages : les deux jours touches
  // se reconstruisent, sinon la veille garderait un texte trop court et le
  // lendemain un texte qui ne lui appartient plus.
  rebuildEntryText(date, userId);
  rebuildEntryText(veille, userId);
  invalidate(userId);
  return bouges;
}

/**
 * UNE BORNE RECALE LA NUIT, QUELLE QUE SOIT LA PORTE PAR LAQUELLE ELLE ENTRE.
 *
 * Le recalage n'etait declenche que par les deux chemins qui passent par le
 * compagnon : la phrase (« je vais me coucher ») et l'outil `noter_bornes`. Une
 * heure de coucher qui arrivait par la PASSERELLE -- le JSON que Machi Tool ou
 * une montre pousse -- etait enregistree, s'affichait dans « ce qui a ete
 * mesure », servait a `coupureDe`... et ne deplacait rien.
 *
 * Le resultat se voyait a l'ecran : coucher dit 06:10 le 1er septembre, et les
 * messages de 01:56 et 05:43 toujours ranges sur le 1er, alors que la regle du
 * produit les met au 31 aout. La borne etait la, la regle etait juste, et la
 * grille montrait autre chose -- ce qui revient a n'avoir rien fait.
 *
 * Une seule regle, un seul endroit : toute mesure qui peut deplacer la coupure
 * d'une journee fait rejouer le recalage de cette journee-la.
 *
 * @param {Array<{date: string, cle: string}>} mesures
 * @returns {number} combien de messages ont change de journee.
 */
export function recalerSurBornes(mesures, userId = OWNER) {
  const jours = new Set();
  for (const m of mesures ?? []) {
    if (!m?.date || !m?.cle) continue;
    // Les memes familles de cles que `bornesConnues` sait lire. Une cle qui ne
    // pese pas sur la coupure ne doit pas faire rejouer un deplacement.
    if (contient(m.cle, [...COUCHER, ...LEVER, ...DERNIERE, ...PREMIERE])
        || m.cle === CLE_COUCHER || m.cle === CLE_LEVER) jours.add(m.date);
  }
  let bouges = 0;
  for (const d of jours) bouges += recalerLaNuit(d, userId);
  return bouges;
}

/**
 * LA REPRISE : LES NUITS QU'ON N'A PAS RANGEES A L'EPOQUE.
 *
 * Brancher le recalage sur la passerelle ne soigne que ce qui arrivera. Une
 * base qui porte deja « coucher 06:10 » le 1er septembre garde ses deux
 * messages de la nuit sur le 1er, indefiniment -- la borne est la, la regle est
 * juste, et l'ecran continue de montrer autre chose.
 *
 * On rejoue donc la regle une fois au demarrage, sur la fenetre ou les bornes
 * comptent. C'est BORNE (jamais plus d'un jour en arriere, jamais au-dela de la
 * fenetre), IDEMPOTENT (un message deja range est du bon cote de la coupure et
 * ne bouge plus), et ANNONCE : le compte part dans le journal de demarrage
 * plutot que de se faire en silence.
 *
 * Ce n'est pas « la grille se reecrit toute seule » : c'est la meme regle,
 * appliquee aux memes bornes, au seul moment ou l'on peut encore rattraper ce
 * qui a ete manque.
 *
 * @returns {number} combien de messages ont change de journee.
 */
export function reprendreLesNuits(userId = OWNER) {
  const fin = today();
  const debut = addDays(fin, -FENETRE_LEVERS + 1);
  return recalerSurBornes(mesuresEntre(debut, fin, userId), userId);
}

/* ==================================================================
   RANGER TOUT LE JOURNAL SUR LES JOURNÉES VÉCUES.

   `reprendreLesNuits` ne regarde que les cent vingt derniers jours, et
   seulement les jours qui portent une MESURE. Deux trous, et le second est le
   plus grave : pendant des mois, Machi Tool n'a envoyé aucun coucher (il le
   calculait pour le mauvais jour), donc aucune nuit n'a jamais recalé quoi que
   ce soit. Des soirées entières sont restées sur le lendemain.

   Depuis, `server/nuits.js` sait relire ces nuits dans ce qui était DÉJÀ
   stocké — la dernière touche du soir, la première du matin, les absences.
   On peut donc reprendre tout le journal, une fois, du premier jour au
   dernier : pour chaque journée, la coupure la plus sûre qu'on connaisse, et
   les messages écrits avant elle rejoignent la soirée qu'ils terminaient.

   L'ordre compte : du plus ANCIEN au plus récent. Un message déplacé de D vers
   D−1 ne doit pas être redéplacé quand on traitera D−1 — le garde
   d'idempotence de `recalerLaNuit` (le jour civil se lit sur le ts, jamais
   réécrit) s'en charge, et le sens du parcours évite d'y revenir.
   ================================================================== */

/**
 * Les coupures de TOUT le journal : les nuits relues d'abord (elles viennent du
 * clavier, c'est la source la plus sûre), les mesures ensuite, la médiane pour
 * les jours qui n'ont ni l'une ni l'autre.
 *
 * @returns {{bornes: Map<string, number>, med: number|null}}
 */
export function bornesDuJournal(userId = OWNER) {
  const bornes = bornesConnues(toutesMesures(userId).map(m => ({ ...m, texte: m.texte ?? null })));
  // Les nuits passent DEVANT : « couché à 04:17 » lu dans le clavier vaut mieux
  // qu'une extinction de poste, et couvre les jours où aucune mesure n'existe.
  for (const n of nuits(userId, { jours: 3650 })) {
    const h = enMinutes(n.coucher);
    if (h == null || h >= MIDI) continue;   // un coucher d'après-midi ne borne rien
    bornes.set(n.date, h);
  }
  return { bornes, med: medianeBorne(bornes) };
}

/**
 * RELIRE LE PASSÉ AVEC L'EXTRACTEUR D'AUJOURD'HUI.
 *
 * `noterBornesDites` ne tourne qu'À L'ÉCRITURE : « je viens de me lever » pose
 * une mesure au moment où la phrase arrive, et jamais après. Tout ce qui a été
 * écrit AVANT que cet extracteur existe — ou avant qu'il apprenne une tournure
 * de plus — n'a donc jamais été lu. Le journal contient la phrase, l'appli sait
 * la comprendre, et pourtant la mesure n'existe pas : c'est le trou le moins
 * visible, parce que rien ne le signale.
 *
 * On repasse donc sur tous les messages de la personne. L'heure de repli n'est
 * pas « maintenant » mais l'INSTANT DU MESSAGE : « je viens de me lever »,
 * écrit il y a trois ans à 15:12, dit un lever à 15:12 ce jour-là, pas un lever
 * aujourd'hui. C'est toute la différence entre relire et réécrire.
 *
 * IDEMPOTENT, ET DANS LE BON SENS : on ne pose que ce qui manque. Une borne
 * déjà dite ce jour-là — par la personne, par le compagnon, par un passage
 * précédent — n'est jamais écrasée ; on ne va pas contredire ce qui a été
 * enregistré à chaud avec une relecture faite après coup. Un seul message par
 * jour et par genre suffit : le PREMIER dans le temps gagne, comme à l'époque.
 *
 * @returns {number} combien de bornes ont été retrouvées.
 */
export function relireLesBornesDites(userId = OWNER) {
  // `toutesMesures` ne rendrait rien ici : elle filtre sur `valeur IS NOT NULL`,
  // et une borne dite vit dans `texte` (« 15:12 »), pas dans `valeur`.
  const deja = new Set();
  for (const m of mesuresEntre('0001-01-01', '9999-12-31', userId))
    if (m.source === SOURCE_DIT) deja.add(`${m.date}|${m.cle}`);
  let poses = 0;
  // `tousMessagesUtilisateur` rend du plus récent au plus ancien : on remonte le
  // temps à l'endroit pour que le premier message d'une journée l'emporte.
  for (const msg of tousMessagesUtilisateur(userId).slice().reverse()) {
    const b = bornesDitesDans(msg.text);
    if (!b) continue;
    const quand = normaliserTs(msg.ts) ?? Date.parse(`${msg.date}T12:00:00`);
    const heure = b.heure ?? heureLocale(quand);
    const date = jourLocal(quand);
    if (!heure || !date) continue;
    const cle = b.genre === 'lever' ? CLE_LEVER : CLE_COUCHER;
    if (deja.has(`${date}|${cle}`)) continue;
    poserMesure({ date, source: SOURCE_DIT, cle, texte: heure, userId });
    deja.add(`${date}|${cle}`);
    poses++;
  }
  return poses;
}

/**
 * ET LES NOTES DITES, SUR TOUT LE JOURNAL.
 *
 * Même raison que pour les bornes : l'extracteur vient d'apparaître, et tout ce
 * qui a été écrit avant lui est resté lettre morte. « ressenti avant de
 * m'endormir 1/10 là » attendait depuis le 8 septembre.
 *
 * Idempotent par construction — `noterNoteDite` refuse un message qui porte
 * déjà un relevé — donc on peut la relancer sans empiler.
 *
 * @returns {number} combien de relevés ont été posés.
 */
export function relireLesNotesDites(userId = OWNER) {
  let poses = 0;
  for (const msg of tousMessagesUtilisateur(userId)) {
    if (noterNoteDite(msg.text, msg.id, msg.date, userId)) poses++;
  }
  return poses;
}

/**
 * RANGER TOUT LE JOURNAL. Rend ce qui a bougé, et sur combien de jours.
 * @returns {{jours: number, messages: number, sans_coupure: number,
 *            bornes_retrouvees: number, notes_retrouvees: number}}
 */
export function rangerToutLeJournal(userId = OWNER) {
  // Les notes dites d'abord : elles ne déplacent aucune journée, donc leur
  // ordre vis-à-vis du rangement n'a pas d'importance — mais les oublier ici
  // laisserait tout un journal sans elles jusqu'au prochain message écrit.
  const notes_retrouvees = relireLesNotesDites(userId);
  // D'ABORD RELIRE, ENSUITE RANGER. Une borne retrouvée dans un vieux message
  // est une coupure de plus, et donc une soirée de plus remise à sa place :
  // ranger avant de relire ferait le travail sur des bornes qu'on est justement
  // en train de retrouver.
  const bornesRetrouvees = relireLesBornesDites(userId);
  const { bornes, med } = bornesDuJournal(userId);
  const dates = joursEcrits(userId);
  let messages = 0, jours = 0, sansCoupure = 0;
  for (const d of dates) {
    const coupure = coupureDe(d, bornes, med);
    if (coupure == null) { sansCoupure++; continue; }
    const bouges = recalerLaNuit(d, userId, { bornes, med });
    if (bouges) { messages += bouges; jours++; }
  }
  if (messages || bornesRetrouvees) invalidate(userId);
  return { jours, messages, sans_coupure: sansCoupure,
           bornes_retrouvees: bornesRetrouvees, notes_retrouvees };
}

/* ==================================================================
   LES LIENS ENTRE LES MESURES ET LES NOTES, CALCULES UNE FOIS.
   ================================================================== */

const MEMO_LIENS = new Map();

/**
 * Le calcul croise toute la base de mesures contre tout le journal. On
 * feuillette vingt journées d'affilée dans « Moi », et le refaire à chaque clic
 * serait vingt fois le même travail pour vingt fois le même résultat.
 *
 * L'invalidation ne se fait pas au temps mais à la SIGNATURE des données : un
 * cache d'une minute rendrait un résultat périmé juste après un envoi, ce qui
 * est précisément le moment où quelqu'un regarde.
 */
export function liensDe(userId = OWNER) {
  const sig = signatureQS(userId);
  const vu = MEMO_LIENS.get(userId);
  if (vu?.sig === sig) return vu.out;
  const out = liens(toutesMesures(userId), allEntries(userId));
  MEMO_LIENS.set(userId, { sig, out });
  return out;
}

/**
 * LES MESURES D'UNE JOURNEE, SITUEES.
 *
 * « 5,4 » tout seul ne dit rien : ni si c'est beaucoup, ni si ça compte. On
 * ajoute donc deux choses, et seulement deux.
 *
 * D'abord le COTE : au-dessus ou en dessous de la médiane de la série. C'est ce
 * qui transforme un nombre en information sans demander à personne de retenir
 * ses propres normales.
 *
 * Ensuite le LIEN, quand il existe et qu'il a survécu à la correction. Une
 * mesure sans lien connu reste affichée : elle est arrivée, elle a le droit
 * d'être vue, et la cacher ferait croire qu'elle n'a pas été reçue.
 */
export function mesuresSituees(date, userId = OWNER, { avecLiens = true } = {}) {
  const jour = mesuresDuJour(date, userId);
  if (!jour.length) return [];
  const { liens: trouves } = avecLiens ? liensDe(userId) : { liens: [] };
  const toutes = toutesMesures(userId);

  const medianes = new Map();
  for (const m of toutes) {
    const k = `${m.source} ${m.cle}`;
    if (!medianes.has(k)) medianes.set(k, []);
    medianes.get(k).push(m.valeur);
  }
  for (const [k, v] of medianes) {
    v.sort((a, b) => a - b);
    medianes.set(k, v.length % 2 ? v[(v.length - 1) / 2]
      : (v[v.length / 2 - 1] + v[v.length / 2]) / 2);
  }

  return jour.map(m => {
    const k = `${m.source} ${m.cle}`;
    const med = medianes.get(k) ?? null;
    // Le lien du jour même passe devant celui du lendemain : sur la journée
    // qu'on est en train de lire, c'est celui qui parle d'elle.
    const pour = trouves.filter(l => l.source === m.source && l.cle === m.cle)
                        .sort((a, b) => a.decalage - b.decalage);
    return {
      ...m,
      /*
       * UN ROUAGE, OU UNE MESURE QU'ON VIENT LIRE ?
       *
       * Le meme partage qu'au panneau : `temps_par_contexte_s_*`,
       * `titres <app>:<page>`, `bascules`, `pauses_nombre` sont ce qui PRODUIT
       * la nuit et l'archetype, deja dits en une ligne juste en dessous. Sur un
       * vrai traqueur ils sont quarante, et la colonne du milieu de la journee
       * redevenait le mur qu'on venait d'enlever ailleurs.
       *
       * Ils ne disparaissent pas -- ils se replient. Ce qui se mesure sur un
       * CORPS reste ouvert : le sommeil, le poids, les pas, le coeur.
       */
      detail: estDetail(m.cle),
      mediane: med == null ? null : Math.round(med * 100) / 100,
      /*
       * TROIS ETATS. Avec deux, la valeur qui EST la médiane tombait du côté
       * « haut » et s'annonçait au-dessus d'elle-même. Sur une série impaire,
       * c'est exactement la journée du milieu — pas un cas de bord.
       */
      cote: med == null || m.valeur == null ? null
        : m.valeur === med ? 'pile' : m.valeur > med ? 'haut' : 'bas',
      lien: pour[0] ?? null
    };
  });
}

/**
 * LE POSTE DU JOUR, EN LEGER : lever, coucher, sommeil, temps d'ecran.
 *
 * De quoi tenir la colonne « ce qui a ete mesure » sans y deverser les quarante
 * cles du digest. Chaque borne porte SA SOURCE, dans l'ordre du plus sur au
 * moins sur -- ce que la personne a DIT, puis ce que la machine a MESURE, puis
 * une ESTIMATION lue sur la plage d'activite, puis rien du tout (inconnu). On ne
 * fait jamais passer une estimation pour une mesure.
 *
 * L'ecran est fendu en temps d'application et temps web, chacun avec ses trois
 * premiers, pour le survol.
 */
export function posteDuJour(date, userId = OWNER) {
  const dig = activiteDuJour(date, userId)?.digest ?? null;
  const jourM = mesuresDuJour(date, userId);
  const jourMdemain = mesuresDuJour(addDays(date, 1), userId);
  const ditLever = () => {
    const m = jourM.find(x => x.source === SOURCE_DIT && x.cle === CLE_LEVER);
    return m ? (m.texte ?? null) : null;
  };
  /*
   * LE COUCHER QUI FERME LE JOUR N'EST PAS CELUI DU MATIN MÊME.
   *
   * Un coucher DIT posé le jour D à une heure du MATIN (< MIDI) n'est pas la fin
   * de D : c'est la coupure qui OUVRE D — on s'est endormi ce matin-là après une
   * nuit blanche, et ce coucher ferme D-1. Le prendre pour le coucher de D
   * affichait « couché 09:45 » un jour où on venait de se lever à 17:30, et où
   * l'on ne s'était pas encore recouché. Le coucher qui ferme VRAIMENT D est :
   *   - un coucher DIT du SOIR de D (>= MIDI : « je vais me coucher » ce soir), ou
   *   - un coucher DIT du MATIN de D+1 (< MIDI : « je me couche » passé minuit).
   */
  const ditCoucherFermant = () => {
    const soir = jourM.find(x => x.source === SOURCE_DIT && x.cle === CLE_COUCHER
                              && (enMinutes(x.texte) ?? 0) >= MIDI);
    if (soir) return soir.texte ?? null;
    const apresMinuit = jourMdemain.find(x => x.source === SOURCE_DIT && x.cle === CLE_COUCHER
                              && (enMinutes(x.texte) ?? 1440) < MIDI);
    return apresMinuit ? (apresMinuit.texte ?? null) : null;
  };
  const poste = dig?.poste ?? {};
  const plage = dig?.plage ?? {};
  // LA NUIT LUE DANS LE CLAVIER (server/nuits.js) : plus juste que le poste
  // quand l'ordinateur reste allumé, et elle dit ce qui ne colle pas. Le rythme
  // de la personne (ses médianes sur quatre-vingt-dix jours) départage les
  // silences du jour — sans lui, une journée loin du poste passerait devant
  // une nuit plus courte.
  const rythme = rythmeUtilisateur(userId);
  const nuit = nuitDuJour(dig, activiteDuJour(addDays(date, -1), userId)?.digest ?? null, { rythme });
  // LE COUCHER MESURÉ QUI FERME LE JOUR EST DANS LE DIGEST DU LENDEMAIN.
  //
  // `poste.coucher` de D est la dernière extinction AVANT le réveil de D —
  // c'est-à-dire le coucher de la nuit qui a OUVERT D (soir de D-1), apparié à
  // `poste.reveil` pour donner `sommeil_h`. Le coucher qui FERME le jour vécu D
  // (soir de D) est la dernière extinction avant le réveil de D+1 : il vit donc
  // dans le digest de D+1. Le lever, lui, reste celui de D.
  const digDemain = activiteDuJour(addDays(date, 1), userId)?.digest ?? null;
  const posteFin = digDemain?.poste ?? {};
  /*
   * LA NUIT QUI FERME D, lue dans le clavier : le silence qui commence le soir
   * de D (ou après minuit) et se termine au réveil de D+1. Son `coucher` est
   * exactement l'heure où la journée vécue D s'est arrêtée — y compris quand
   * elle s'arrête à 3 h du matin.
   */
  const nuitFin = nuitDuJour(digDemain, dig, { rythme });
  /*
   * 23:59 N'EST PAS UNE HEURE DE COUCHER, C'EST UNE FIN DE JOURNÉE CIVILE.
   *
   * `plage.a` est la dernière touche relevée DANS le fichier du jour, et ce
   * fichier s'arrête à minuit. Quelqu'un encore debout à minuit y laisse donc
   * 23:59 — ce qui veut dire « la journée n'était pas finie », l'exact contraire
   * d'un coucher. Affiché tel quel, ça collait le coucher au bord du jour civil
   * pendant que le lever, lui, était à 15:34 : les deux bornes ne racontaient
   * plus la même journée vécue.
   */
  const auBordDeMinuit = h => (enMinutes(h) ?? 0) >= 23 * 60 + 55;
  /*
   * ET LE COUCHER NE PEUT PAS ÊTRE AVANT LA DERNIÈRE CHOSE ÉCRITE.
   *
   * Les messages sont déjà rangés sur les journées vécues : celui de 03:18
   * appartient à la journée ouverte à 15:34 la veille. Un coucher proposé à
   * 23:59 est donc réfuté par une phrase écrite trois heures plus tard — la
   * personne était manifestement debout. On mesure tout depuis le lever, dans
   * le sens du temps, pour que « 03:18 » compte comme APRÈS « 23:59 ».
   */
  const depuisLever = (h, lever) => {
    const a = enMinutes(lever), b = enMinutes(h);
    if (a == null || b == null) return null;
    return (((b - a) % 1440) + 1440) % 1440;
  };
  const dernierEcrit = () => {
    const m = messagesForDate(date, userId)
      // Comparaison de CHAÎNES ISO : elle est juste, l'ordre lexicographique
      // d'un ISO 8601 est son ordre chronologique — mais seulement à fuseau
      // constant. On trie sur l'instant, comme partout ailleurs.
      .filter(x => x.role === 'user' && x.text?.trim() && Number.isFinite(Date.parse(x.ts)))
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)).at(-1);
    return m ? heureLocale(m.ts) : null;
  };
  /*
   * LE COUCHER PAR LE SILENCE, EN DERNIER RECOURS.
   *
   * Ni l'ordi éteint (le JSON), ni une phrase (« je vais me coucher ») : reste ce
   * que la nuit laisse toujours — l'arrêt d'écrire. On cherche, dans la fenêtre
   * soir de D → matin de D+1, le dernier message d'une salve suivi d'un silence
   * d'au moins ~6-7 h (le message suivant vient bien plus tard). Ce message-là
   * marque l'endormissement. Un jour encore en cours n'a pas ce silence : rien
   * n'est estimé tant qu'on n'a pas recommencé à écrire le lendemain.
   */
  const estimeCoucherParSilence = () => {
    const SEUIL = 6.5 * 3600 * 1000;
    /*
     * `ts` EST UNE CHAÎNE ISO, PAS UN NOMBRE — et c'est ce qui cassait tout.
     *
     * `messagesForDate` rend le `ts` tel qu'il est stocké : « 2026-09-07T03:18…».
     * Soustraire deux chaînes donne NaN, et `NaN < SEUIL` est FAUX : la garde
     * qui devait passer au message suivant tant que le silence est trop court
     * ne passait jamais. La fonction rendait donc le PREMIER message du soir de
     * D — c'est-à-dire, chez quelqu'un qui se lève l'après-midi, son lever
     * lui-même. « Couché 15:34, levé 15:34 » : réfuté deux lignes plus bas par
     * la phrase de 03:18, et le coucher disparaissait de l'écran.
     *
     * D'où l'absence de la lune à côté du soleil, tous les jours où Machi Tool
     * n'avait pas encore envoyé le trou du lendemain. Le tri souffrait du même
     * mal — un comparateur qui rend NaN ne trie rien.
     */
    const instant = m => Date.parse(m.ts);
    const users = [...messagesForDate(date, userId), ...messagesForDate(addDays(date, 1), userId)]
      .filter(m => m.role === 'user' && m.text?.trim() && Number.isFinite(instant(m)))
      .sort((a, b) => instant(a) - instant(b));
    /*
     * LE PLUS LONG SILENCE, PAS LE PREMIER ASSEZ LONG.
     *
     * En rendant le premier écart de plus de six heures et demie, on prenait
     * une soirée sans écrire pour un endormissement : « 18:37 puis plus rien
     * jusqu'à 03:18 » donnait couché 18:37, alors que la phrase de 03:18 prouve
     * qu'on était debout. La réfutation d'en dessous rattrapait le coup en
     * effaçant le coucher — le résultat juste, obtenu de la mauvaise façon :
     * l'écran n'affichait plus rien du tout là où la bonne réponse (03:18) était
     * dans les données.
     *
     * Le sommeil qui ferme la journée est le plus long silence de la fenêtre,
     * pas le premier qui dépasse un seuil. Le seuil ne sert plus qu'à dire
     * « c'est une nuit, pas une pause ». Quand le plus long silence est une
     * absence de l'après-midi, la réfutation écarte bien cette estimation —
     * mais elle n'efface PLUS la journée pour autant : depuis que les cinq
     * sources sont une liste et non un escalier de `return`, `plage.a` a
     * encore sa chance derrière, et sur un jour clos c'est elle qu'on voit.
     * Ce commentaire a dit le contraire pendant tout le temps où une source
     * réfutée emportait les suivantes avec elle — le défaut du 7 septembre.
     */
    let choisi = null, plusLong = SEUIL;
    for (let i = 0; i < users.length - 1; i++) {
      const creux = instant(users[i + 1]) - instant(users[i]);
      if (creux < plusLong) continue;
      const jourMsg = jourLocal(users[i].ts);
      const min = enMinutes(heureLocale(users[i].ts)) ?? 0;
      const soirD = jourMsg === date && min >= MIDI;
      const matinDemain = jourMsg === addDays(date, 1) && min < MIDI;
      if (soirD || matinDemain) { choisi = heureLocale(users[i].ts); plusLong = creux; }
    }
    return choisi;
  };
  /*
   * 00:00 N'EST PAS UN LEVER NON PLUS, C'EST LE BORD OÙ LE FICHIER S'OUVRE.
   *
   * Symétrique de 23:59 : chez quelqu'un encore debout à minuit, la première
   * touche du fichier du jour est 00:00 — la suite de la veille, pas un réveil.
   * Les vieux digests de Machi Tool en faisaient un `poste.reveil` sans
   * coucher, que l'écran affichait « levé 00:00 (mesure) » pendant que la vraie
   * nuit (05:26 → 16:15) n'était nulle part. Une mesure de lever a un coucher
   * devant elle, sinon ce n'est pas une nuit — et une estimation sur `plage.de`
   * ne vaut qu'au delà des cinq premières minutes du jour civil.
   */
  const auBordDeMinuitOuvrant = h => (enMinutes(h) ?? 0) <= 5;
  /*
   * ================================================================
   * UN LEVER EST PRÉCÉDÉ D'UN SILENCE. SINON CE N'EST PAS UN LEVER.
   *
   * Chez quelqu'un de nocturne encore debout à minuit, le fichier du jour
   * s'ouvre à 00:19 — et 00:19 est passé pour un lever, avec `poste.reveil`
   * comme avec `plage.de`. Sur une journée réelle : « levé 00:19, couché 16:27,
   * 3,7 h », là où la personne s'était couchée à 11:30 et levée à 18:00. Les
   * trois nombres étaient faux ensemble, et rien ne le disait.
   *
   * Le garde qui existait ne refusait que les cinq premières minutes du jour
   * civil — un seuil arbitraire, que dix-neuf minutes suffisent à franchir. La
   * règle juste ne parle pas d'heure : elle demande qu'il se soit passé quelque
   * chose AVANT, ou plutôt que rien ne se soit passé. Une dernière touche à
   * 23:59 et un « lever » à 00:19, c'est vingt minutes : personne n'a dormi, le
   * fichier civil a simplement changé de nom.
   *
   * Sans digest de la veille on ne sait pas, et on accepte : refuser
   * effacerait le lever de la première journée de tout le monde.
   * ================================================================
   */
  const digVeille = activiteDuJour(addDays(date, -1), userId)?.digest ?? null;
  const derniereActiviteAvant = min => {
    // Sur un axe où 0 = minuit qui ouvre `date` ; la veille est négative.
    const bouts = [];
    const av = enMinutes(digVeille?.plage?.a);
    if (av != null) bouts.push(av - 1440);
    for (const tr of digVeille?.trous ?? []) {
      const a = enMinutes(tr.a); if (a != null) bouts.push(a - 1440);
    }
    for (const tr of dig?.trous ?? []) {
      const a = enMinutes(tr.a); if (a != null) bouts.push(a);
    }
    const avant = bouts.filter(t => t < min);
    return avant.length ? Math.max(...avant) : null;
  };
  const apresUnSilence = h => {
    const t = enMinutes(h);
    if (t == null) return false;
    const derniere = derniereActiviteAvant(t);
    // Rien de connu avant : on ne sait pas, et on ne refuse pas.
    return derniere == null || t - derniere >= MIN_NUIT * 60;
  };
  const bornerLever = () => {
    const d = ditLever();
    if (d) return { heure: d, source: 'dit' };
    if (nuit?.lever && nuit.coucher) return { heure: nuit.lever, source: 'mesure' };
    if (paireEstUneNuit(poste) && apresUnSilence(poste.reveil)) {
      return { heure: poste.reveil, source: 'mesure' };
    }
    if (plage.de && !auBordDeMinuitOuvrant(plage.de) && apresUnSilence(plage.de)) {
      return { heure: plage.de, source: 'estime' };
    }
    return { heure: null, source: null };
  };
  /*
   * LE COUCHER, DANS L'ORDRE DEMANDÉ : d'abord le JSON (l'ordinateur éteint —
   * l'extinction mesurée), sinon la nuit lue au clavier, sinon ce qui est dit
   * dans la conversation (« je vais me coucher »), sinon l'estimation par le
   * silence. `plage.a` (la dernière activité relevée) reste le tout dernier filet.
   *
   * UNE LISTE, PAS UN ESCALIER DE `return` QUI REND LA PREMIÈRE RÉPONSE.
   *
   * La réfutation d'en dessous (« on ne se couche pas avant d'avoir écrit »)
   * arrivait APRÈS le choix : la première source qui répondait gagnait, et si
   * elle se faisait réfuter, le coucher tombait à null sans que personne n'aille
   * demander aux suivantes. Le 7 septembre : levé 19:00, la nuit lue au clavier
   * proposait 21:33 (Machi Tool n'avait envoyé du 8 que le début de la nuit
   * blanche, sans le trou du matin), réfuté par la phrase de 07:47 — et
   * l'estimation par le silence, qui donnait justement 07:47, n'était jamais
   * consultée. « ☀ 19:00 » tout seul, sans lune, alors que la bonne heure était
   * dans les données. On garde donc TOUS les candidats et la réfutation choisit
   * parmi eux, au lieu d'effacer dès le premier.
   *
   * Chacun est une fonction, pas une valeur : `estimeCoucherParSilence` relit
   * deux journées de messages, et on ne la paie que si les candidats d'avant
   * n'ont rien donné ou se sont fait réfuter.
   */
  const candidatsCoucher = [
    // La paire du lendemain passe par le même juge : « couché 16:27, réveil
    // 18:00 » n'est pas une nuit, et n'était donc pas un coucher.
    () => paireEstUneNuit(posteFin) ? { heure: posteFin.coucher, source: 'mesure' } : null,
    // Le silence du clavier qui ferme D : il traverse minuit sans se faire
    // couper, là où `plage.a` s'arrête au bord du fichier du jour.
    () => nuitFin?.coucher ? { heure: nuitFin.coucher, source: 'mesure' } : null,
    () => { const dit = ditCoucherFermant(); return dit ? { heure: dit, source: 'dit' } : null; },
    () => { const est = estimeCoucherParSilence(); return est ? { heure: est, source: 'estime' } : null; },
    // `plage.a` est la dernière touche RELEVÉE, pas la dernière de la journée :
    // sur une journée en cours, c'est « maintenant » — le digest arrivé à 19:47
    // affichait « couché 19:47 » à quelqu'un qui n'a pas quitté sa chaise. Elle
    // ne vaut estimation que sur une journée close.
    () => (plage.a && !auBordDeMinuit(plage.a) && date < today()) ? { heure: plage.a, source: 'estime' } : null
  ];
  const tp = dig?.temps_par_contexte_s ?? {};
  let appS = 0, webS = 0; const apps = [], webs = [];
  for (const [k, v] of Object.entries(tp)) {
    if (typeof v !== 'number' || v <= 0) continue;
    if (k.startsWith('web:')) { webS += v; webs.push([k.slice(4), v]); }
    else { appS += v; apps.push([k, v]); }
  }
  /*
   * LE NOM DE L'ONGLET D'ABORD, LE SITE ENSUITE.
   *
   * La légende de l'écran disait « youtube · 34 % », « autre · 9 % » — c'est-à-
   * dire l'endroit, jamais la page. Or personne ne se demande combien de temps
   * il a passé « sur youtube » : la question est ce qu'il y regardait, et Machi
   * Tool envoie déjà les titres d'onglets par catégorie quand l'option est
   * cochée. Ils étaient là, au fond du digest brut, derrière deux replis.
   *
   * Le site NE DISPARAÎT PAS : il reste sous le titre, parce que c'est lui qui
   * a servi à compter et qu'un titre seul ne dit pas d'où il vient. Et quand
   * les titres ne sont pas collectés, la ligne reste le site seul — on ne fait
   * pas semblant d'avoir une donnée qu'on n'a pas.
   */
  const parCat = dig?.titres ?? {};
  const titresDe = cle => Object.entries(parCat[cle] ?? {})
    .filter(([, sec]) => typeof sec === 'number' && sec > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([t, sec]) => ({ titre: String(t).slice(0, 120), min: Math.round(sec / 60) }))
    .filter(x => x.min >= 1)
    .slice(0, 10);
  const top = (arr, prefixe = '') => arr.sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([nom, s]) => {
      const titres = titresDe(prefixe + nom);
      return { nom, min: Math.round(s / 60), ...(titres.length ? { titres } : {}) };
    });
  /*
   * LES THÉMATIQUES : DE QUOI PARLAIT CE QU'ON REGARDAIT.
   *
   * « 249 min web » ne dit rien — trois heures de documentaires et trois heures
   * de doomscroll font le même chiffre, et le site ne recevait que celui-là.
   * Machi Tool classe désormais chaque instant par SUJET, sur le titre de
   * l'onglet, EN LOCAL : seul le mot arrive ici, jamais le titre.
   *
   * Le total des thèmes ne vaut PAS le total de l'écran, et c'est voulu : un
   * instant que rien ne classe ne compte nulle part plutôt que d'être rangé de
   * force. L'écran doit donc le dire, pas les faire coïncider.
   */
  /*
   * DE QUOI PARLE CE QU'ON CONSULTE SUR INTERNET — et rien d'autre.
   *
   * On montrait `temps_par_theme_s`, qui mêle les applications : une heure de
   * « création » passée DANS Blender y voisinait avec une heure passée à
   * regarder un tuto de Blender. L'une est du travail, l'autre de la
   * consultation, et les additionner rendait la question sans réponse. C'est
   * `temps_par_theme_web_s` qu'on lit maintenant — le navigateur seul.
   *
   * ET LES TITRES DERRIÈRE, quand Machi Tool les garde : un chiffre qui annonce
   * « 40 min de guerre » sans pouvoir montrer sur quoi il se fonde est une
   * autorité qu'on ne peut pas contredire, et une table de mots-clés se trompe
   * forcément quelque part. Pouvoir ouvrir la liste et dire « ça, ce n'était pas
   * de la guerre » est la seule chose qui rend la mesure honnête.
   */
  /*
   * ET LES SOUS-CATÉGORIES, sous leur thème.
   *
   * « 40 min de guerre » est déjà mieux que « 249 min web ». Mais la guerre
   * suivie sur des cartes et une nuit de bodycams ne sont pas la même soirée,
   * et le thème les compte pareil. Machi Tool fait une seconde passe, en local,
   * sur le titre de l'onglet.
   *
   * Leur total est INFÉRIEUR à celui du thème, toujours : ce qu'aucune
   * sous-catégorie ne reconnaît reste dans son thème, compté une seule fois.
   * L'écran doit donc les montrer comme une précision sur une part, jamais
   * comme une découpe complète — sinon la barre mentirait par construction.
   */
  const th = dig?.temps_par_theme_web_s ?? dig?.temps_par_theme_s ?? {};
  const parTitre = dig?.titres_par_theme ?? {};
  const parSous = dig?.temps_par_sous_theme_web_s ?? {};
  const themes = Object.entries(th)
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([nom, s]) => {
      const sous = Object.entries(parSous[nom] ?? {})
        .filter(([, v]) => typeof v === 'number' && v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([n, sec]) => ({ nom: n, min: Math.round(sec / 60) }))
        .filter(x => x.min >= 1);
      return {
        nom, min: Math.round(s / 60),
        ...(sous.length ? { sous } : {}),
        titres: Object.entries(parTitre[nom] ?? {})
          .sort((a, b) => b[1] - a[1])
          .map(([t, sec]) => ({ titre: String(t).slice(0, 120), min: Math.round(sec / 60) }))
          .filter(x => x.min >= 1)
      };
    })
    .filter(x => x.min > 0);
  const ecran = (appS || webS) ? {
    app_min: Math.round(appS / 60), web_min: Math.round(webS / 60),
    top_app: top(apps), top_web: top(webs, 'web:'),
    themes: themes.length ? themes : null
  } : null;
  const lever = bornerLever();
  /*
   * LE COUCHER FERME LA JOURNÉE QUE LE LEVER A OUVERTE — ou il n'est pas là.
   *
   * Une journée en cours n'a pas encore de coucher (le dernier candidat refuse
   * `plage.a` tant que le jour n'est pas clos), et c'est une réponse : « — »
   * se lit tout de suite, « couché 23:59 » se croit. Reste le cas où un coucher
   * proposé est réfuté par une phrase écrite plus tard : ça écarte CE candidat,
   * pas la journée — le suivant a droit à sa chance. Quand aucun ne survit, on
   * rend null, et c'est la bonne réponse.
   */
  let ecrit;   // lu au plus une fois : `dernierEcrit` relit les messages du jour,
               // et une journée où aucun candidat ne se présente n'a rien à réfuter.
  const refute = h => {
    if (ecrit === undefined) ecrit = lever.heure ? depuisLever(dernierEcrit(), lever.heure) : null;
    const fin = depuisLever(h, lever.heure);
    return ecrit != null && fin != null && fin < ecrit;
  };
  let coucher = { heure: null, source: null };
  for (const proposer of candidatsCoucher) {
    const c = proposer();
    if (c?.heure && !refute(c.heure)) { coucher = c; break; }
  }
  /*
   * LA DURÉE VIENT DE LA NUIT RETENUE, ET DE NULLE PART AILLEURS.
   *
   * Elle se rabattait sur `poste.sommeil_h` quand aucune nuit n'était dérivée —
   * c'est-à-dire précisément quand `nuitDuJour` venait de JUGER cette paire
   * inutilisable. Le chiffre revenait alors par la fenêtre : « 3,7 h » sous un
   * lever vide, sur une journée où la personne avait dormi six heures et demie.
   * Un seul juge, une seule réponse.
   */
  const sommeil_h = nuit?.sommeil_h ?? null;
  if (!lever.heure && !coucher.heure && sommeil_h == null && !ecran) return null;
  // `dormi_de` : l'heure de coucher de la nuit QU'ON A DORMIE (celle qui va avec
  // `sommeil_h` et le réveil), lue telle quelle dans le digest. C'est ce qu'on
  // montre en « couché » sur la vue minimaliste — le sommeil comme un épisode
  // (couché -> levé -> durée), pas le coucher qui fermera CE soir.
  /*
   * SUR QUEL JOUR TOMBE CHAQUE BORNE — parce que « levé 15:51, couché 10:33 »
   * se lit comme une absurdité tant qu'on ne dit pas que le 10:33 est celui du
   * LENDEMAIN.
   *
   * Chez quelqu'un qui vit la nuit, les deux bouts d'une même journée vécue
   * tombent presque toujours sur deux dates civiles différentes. L'écran
   * affichait deux heures nues, et il fallait refaire le raisonnement de tête à
   * chaque fois — y compris pour savoir si le site s'était trompé.
   *
   * LE CALCUL SE FAIT ICI, ET PAS DANS LA PAGE. La règle « a-t-on passé
   * minuit » est déjà écrite dans ce fichier, à deux endroits (`depuisLever` et
   * `ditCoucherFermant`) ; la réécrire dans le client ferait un troisième juge,
   * et le jour où les trois ne diraient plus la même chose, c'est l'écran qui
   * aurait tort sans qu'on sache pourquoi.
   *
   * Le lever OUVRE la journée : il est sur `date`, par définition. Le coucher
   * la FERME : il est sur `date` s'il vient après le lever dans la journée
   * vécue, sur le lendemain s'il a fallu passer minuit pour l'atteindre. Sans
   * lever connu, on retombe sur la convention de `ditCoucherFermant` : avant
   * midi, c'est le lendemain.
   */
  const jourDeLaBorne = (h, apres) => {
    const b = enMinutes(h);
    if (b == null) return null;
    const a = enMinutes(apres);
    if (a == null) return b < MIDI ? addDays(date, 1) : date;
    return b < a ? addDays(date, 1) : date;
  };
  if (lever.heure) lever.jour = date;
  if (coucher.heure) coucher.jour = jourDeLaBorne(coucher.heure, lever.heure);
  /*
   * `dormi_de` est l'autre sens : c'est le coucher qui a OUVERT la nuit
   * terminée par ce lever, donc il est DERRIÈRE lui. Même matin que le lever
   * s'il est plus tôt dans la journée (endormi à 06:48, levé à 15:51), la
   * veille sinon (endormi à 23:59, levé le lendemain à 15:51).
   */
  const dormi_de = nuit?.coucher ?? null;
  const dormi_de_jour = dormi_de && enMinutes(dormi_de) != null && enMinutes(lever.heure) != null
    ? (enMinutes(dormi_de) < enMinutes(lever.heure) ? date : addDays(date, -1))
    : null;
  return { lever, coucher, sommeil_h,
           // Même raison que `sommeil_h` : le coucher de la nuit DORMIE vient de
           // la nuit retenue. Le reprendre au poste ressusciterait la paire que
           // `nuitDuJour` vient d'écarter.
           dormi_de, dormi_de_jour, nuit_souci: nuit?.souci ?? null, ecran };
}

/* Découpe un texte en phrases, pour situer une occurrence à l'endroit précis
   où elle a été écrite plutôt que dans six cents mots. */
const enPhrases = t => String(t).split(/(?<=[.!?…])\s+|\n+/).map(p => p.trim()).filter(Boolean);
/* Sans accent ni casse : « fatigue » trouve « fatigué ». Même aplatissement des
   deux côtés, pour ne jamais rater un mot à cause d'un accent. */
const normCherche = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const MAX_RESULTATS = 500;

/**
 * TOUTES LES INSTANCES D'UN MOT OU D'UNE PHRASE, PAR JOUR ET PAR HEURE.
 *
 * On rend la phrase qui porte le terme (pas le message entier), avec le jour et
 * l'horodatage — de quoi répondre à « quand ai-je parlé de ça, et combien de
 * fois ». Groupé par journée, la plus récente d'abord ; dans chaque journée,
 * dans l'ordre où c'est arrivé. Plafonné, parce qu'un terme courant sortirait
 * la moitié du journal et la recherche n'est plus une recherche.
 */
export function chercher(terme, userId = OWNER) {
  const brut = String(terme ?? '').trim();
  const q = normCherche(brut).replace(/\s+/g, ' ').trim();
  if (q.length < 2) return { q: brut, total: 0, jours: [], court: true };

  const parJour = new Map();
  let total = 0, tronque = false;
  for (const r of tousMessagesUtilisateur(userId)) {
    for (const p of enPhrases(r.text)) {
      if (!normCherche(p).includes(q)) continue;
      if (total >= MAX_RESULTATS) { tronque = true; break; }
      const e = parJour.get(r.date) ?? [];
      e.push({ id: r.id, ts: r.ts, extrait: p.slice(0, 400), rangee: !!r.rangee });
      parJour.set(r.date, e);
      total++;
    }
    if (tronque) break;
  }
  const jours = [...parJour.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([date, hits]) => ({ date, hits: hits.sort((x, y) => (x.ts < y.ts ? -1 : 1)) }));
  return { q: brut, total, jours, tronque };
}

/**
 * SPEC 4.1 - Le plancher.
 * Sous le seuil, AUCUNE statistique n'est calculee ni renvoyee. Uniquement les
 * entrees passees, brutes. La regle est appliquee ici, pas dans l'interface :
 * un chiffre rassurant a ce moment-la est vecu comme une invalidation, et une
 * regle qui ne vit que dans le front finit toujours par etre contournee.
 */
export function floorState(note, reference, s) {
  if (note === null || note === undefined) return { floored: false };
  const threshold = s.floorMode === 'relative' && reference !== null
    ? reference - 3
    : s.floor;
  return { floored: note <= threshold, threshold, mode: s.floorMode };
}

const MIN_COMPARABLE = 5;   // SPEC 4.4 - aveu d'ignorance

/* =====================  handlers  ===================== */

/**
 * Les journees d'un noeud, decorees de leur ecart.
 *
 * La lecture stocke des DATES, pas des ecarts : un ecart se calcule contre une
 * reference glissante, et fige dans le JSON il vaudrait ce qu'il valait le jour
 * de la lecture. Deux mois plus tard la carte afficherait une meteo perimee
 * sans que rien ne le signale. On decore donc au moment de lire.
 *
 * L'ecart, et pas la note : la carte du Miroir dit des ECARTS partout ailleurs,
 * et deux echelles differentes dans la meme page se lisent l'une pour l'autre.
 */
/*
 * COMBIEN DE JOURNEES D'UN NOEUD ON RENVOIE EN TOUTES LETTRES.
 *
 * Un noeud porte jusqu'a cent vingt dates. Les rendre toutes avec le texte de
 * la journee ferait passer la lecture de quelques dizaines de kilo-octets a
 * plusieurs centaines, pour un panneau qui en montre six. Les plus RECENTES,
 * parce que c'est celles-la qu'on reconnait -- et parce qu'une chose qui
 * revient encore compte plus qu'une chose qui revenait.
 */
const EXTRAITS_PAR_NOEUD = 6;
const EXTRAIT_CAR = 110;

/** Le texte de chaque journee ecrite, par date. Bati a la demande, pas mis en cache :
    il ne sert qu'aux deux routes de la lecture, et il vit le temps d'une reponse. */
function textesParJour(userId) {
  const m = new Map();
  for (const r of series(userId).rows) if (r.text?.trim()) m.set(r.date, r.text);
  return m;
}

function decorerCarte(lecture, byDate, parJour = new Map()) {
  const c = lecture?.carte;
  if (!c?.noeuds?.length) return lecture;
  return {
    ...lecture,
    carte: {
      ...c,
      /*
       * LE SENS DES LIENS, COMPTÉ. Le modèle déclare « précède » ; les
       * journées des deux nœuds permettent de le vérifier -- ceci un jour,
       * cela le lendemain, contre le reste. La toile ne pose une flèche que
       * là où le compte tient (voir sens.js) ; ailleurs le trait reste nu et
       * le verbe reste au survol.
       */
      liens: sensDesLiens(c, new Set(parJour.keys())),
      noeuds: c.noeuds.map(n => {
        const jours = (n.jours ?? []).map(d => {
          const j = byDate.get(d);
          return { d, e: j?.delta ?? null };
        });
        /*
         * LES OCCURRENCES, EN TOUTES LETTRES.
         *
         * Un noeud avait ses dates et rien d'autre : quarante points sur une
         * couronne, et pour savoir ce qu'il y avait dedans il fallait ouvrir
         * une journee, puis une autre. Un theme, lui, montre ses preuves
         * datees avec la phrase. Le noeud n'avait pas de raison d'en montrer
         * moins -- c'est la meme question : « pourquoi cette chose est-elle
         * la ? »
         *
         * On ne garde que les journees qui portent du TEXTE : une date sans
         * rien a lire donne une ligne vide, et une ligne vide dans une liste
         * de preuves ressemble a une preuve qui manque.
         */
        const extraits = [...(n.jours ?? [])].reverse()
          .map(d => ({ date: d, texte: (parJour.get(d) ?? '').trim() }))
          .filter(x => x.texte)
          .slice(0, EXTRAITS_PAR_NOEUD)
          .map(x => ({
            date: x.date,
            extrait: x.texte.length > EXTRAIT_CAR
              ? x.texte.slice(0, EXTRAIT_CAR).trimEnd() + '…' : x.texte
          }));
        return { ...n, jours, extraits };
      })
    }
  };
}

/**
 * De quoi parle un texte : ses termes saillants, et le theme qui les domine.
 *
 * `saillant` est le meme seuil que celui du reste de l'application : ce sont
 * les mots qui nomment un etat ou un mecanisme, pas ceux qui nomment une
 * circonstance. « anxieux » pese, « ensuite » non.
 */
function quoiDedans(texte, max = 4) {
  const t = tokenize(String(texte ?? ''));
  const compte = new Map();
  for (const m of t) {
    if (!saillant(m)) continue;
    compte.set(m, (compte.get(m) ?? 0) + 1);
  }
  const termes = [...compte.entries()]
    // Le poids d'abord, la frequence ensuite : un mot lourd vu une fois dit
    // plus qu'un mot tiede vu trois fois.
    .sort((a, b) => (poidsMot(b[0]) - poidsMot(a[0])) || (b[1] - a[1]))
    .slice(0, max)
    .map(([m]) => m);
  return { termes, theme: termes.length ? themeDe(termes.join(' ')) : 'jalon' };
}

/**
 * Les sept derniers jours sans note, aujourd'hui exclu (il a sa propre carte).
 * Du plus recent au plus ancien : on rattrape en remontant.
 */
function aNoter(rows, aujourdhui) {
  // `rows`, pas la serie : la serie porte les notes et les ecarts, pas le
  // TEXTE -- et c'est le texte qui dit lesquels de ces jours valent d'etre
  // rattrapes en premier.
  const par = new Map(rows.map(r => [r.date, r]));
  const out = [];
  for (let k = 1; k <= 7; k++) {
    const d = addDays(aujourdhui, -k);
    const j = par.get(d);
    if (j?.note === null || j?.note === undefined) {
      out.push({ date: d, ecrit: !!j?.text?.trim() });
    }
  }
  return out;
}

/**
 * TOUT CE QUE LE MODELE VOIT QUAND IL RELIT LE JOURNAL.
 *
 * Extrait de la route pour une raison precise : la LECTURE PRECEDENTE en fait
 * partie, et c'est le genre de branchement qui tombe en panne sans bruit. Sans
 * elle, chaque relecture repart de zero -- les memes journees, relues a froid,
 * ressortent sous d'autres noms et dans d'autres groupes. Vu de l'ecran, ce
 * n'est pas une lecture plus fine : c'est toute la carte qui se reorganise
 * parce qu'on a ecrit trois soirs de plus, et plus rien de ce qu'on avait
 * compris ne s'y retrouve.
 *
 * Rien ici ne peut se verifier depuis la route, qui s'arrete au modele. En
 * appelant CETTE fonction, un test lit le corpus lui-meme et voit si la lecture
 * d'avant y est.
 */
/**
 * UNE LECTURE À REFAIRE EN ENTIER.
 *
 * Elle existe (sinon c'est une première lecture, pas une refonte) et elle a été
 * faite par une version antérieure de la façon de lire. Ce n'est pas « en
 * retard » : ce qu'elle rend n'a plus la forme qu'on attend, et la relecture
 * qui la remplace se fait sur TOUT le journal, pas sur l'échantillon.
 */
export function lectureARefondre(userId) {
  const l = getLecture(userId);
  return !!l?.contenu && (Number(l.contenu.version) || 1) < VERSION_LECTURE;
}

/**
 * OÙ EN EST CHAQUE MOTIF, VIS-À-VIS DE LA CARTE.
 *
 * Une seule source pour les deux routes qui en ont besoin : celle qui rend la
 * lecture (pour y poser les nœuds promus) et celle qui rend la liste des
 * motifs (pour y montrer les propositions). Deux calculs séparés finiraient par
 * diverger, et la divergence se lirait comme un nœud proposé d'un côté et
 * absent de l'autre — ce que personne ne saurait expliquer.
 */
export function etatDesMotifs(userId, carte = null) {
  const c = carte ?? getLecture(userId)?.contenu?.carte ?? null;
  const ecrites = series(userId).rows.filter(r => r.text && r.text.trim()).map(r => r.date);
  return etatsMotifs(allMotifs(userId), motifSeries(userId), c, ecrites);
}

export function corpusDuJournal(userId, rows = series(userId).rows,
                                carnet = series(userId).carnet, { complet = false } = {}) {
  const avant = getLecture(userId);
  return corpusPour({
    rows, events: allEvents(userId), carnet, complet,
    motifs: allMotifs(userId), objectifs: allObjectifs(userId),
    amplitudes: amplitudes(userId),
    // La consigne lui demande d'en reprendre les noms ; la validation, elle, ne
    // se contente pas de le demander : elle verifie ce qui a ete repris et fait
    // suivre les couleurs.
    precedente: avant?.contenu ? { ...avant.contenu, fait_le: avant.fait_le } : null
  });
}

/**
 * ALLER VOIR SI LE LOT EST PRET, ET LE RANGER S'IL L'EST.
 *
 * Appelee en passant, quand quelqu'un ouvre « Ma carte ». Elle ne jette jamais :
 * un lot qui echoue range son message d'erreur et rend la main -- l'ecran doit
 * afficher la lecture precedente, pas une page blanche parce que le releve d'un
 * lot n'a pas abouti.
 *
 * Le corpus est RECONSTRUIT ici, pas conserve depuis le lancement. Le journal ne
 * fait que grandir : une date que le modele a citee etait dans le corpus qu'il a
 * lu, donc elle est dans celui d'aujourd'hui. Garder une copie de tout le corpus
 * dans les reglages pendant une heure aurait coute plus cher que le lot.
 */
async function releverLecture(userId) {
  const s = getSettings(userId);
  const lot = s.lectureLot;
  if (!lot?.id) return null;
  try {
    const { rows, carnet } = series(userId);
    const corpus = corpusDuJournal(userId, rows, carnet, { complet: !!lot.complet });
    const r = await releverLot(lot.id, corpus, s);
    if (!r.pret) return null;

    recordUsage(userId, r.modele, r.usage.input, r.usage.output, r.usage.cacheLu, r.usage.cacheEcrit, 'carte');
    const ecrites = rows.filter(x => x.text && x.text.trim());
    const pose = setLecture({
      contenu: r.lecture, jusqu_au: ecrites.at(-1)?.date ?? null,
      jours: corpus.jours, modele: r.modele, userId
    });
    // Le lot est fini quoi qu'il arrive — on ne le relèvera pas deux fois — mais
    // s'il n'a rien rendu, ça se dit là où l'écran va le lire.
    setSettings({ lectureLot: null,
                  lectureLotErreur: pose?.refusee
                    ? "La lecture de fond n'a rien rendu — ta carte précédente est gardée." : null }, userId);
    return r;
  } catch (err) {
    /*
     * ON NE JETTE LE LOT QUE S'IL EST VRAIMENT FINI.
     *
     * Une cle absente, une coupure de trois secondes, un 500 passager : ce sont
     * des pannes qui passent, et jeter le lot pour l'une d'elles perdrait une
     * lecture deja payee. Seul un lot expire, echoue ou introuvable est retire
     * -- le garder ferait retenter le meme echec a chaque ouverture de la page.
     */
    if (err?.lotFini) {
      setSettings({ lectureLot: null, lectureLotErreur: String(err.message).slice(0, 200) }, userId);
    }
    return null;
  }
}

export const routes = {

  /*
   * L'heure que le serveur retient, a la demande.
   *
   * Elle existe pour etre REGARDEE : si cet encart et l'horloge du navigateur
   * ne disent pas la meme minute, c'est que l'en-tete « X-Fuseau » ne passe
   * pas -- un proxy qui la coupe, une page servie depuis un cache d'avant.
   * Sans ce point de controle, le symptome se lit six mois plus tard, sous la
   * forme d'un trou dans la grille qu'on ne s'explique pas.
   */
  'GET /api/temps': () => etatDuTemps(),

  'GET /api/state': ({ userId }) => {
    const s = getSettings(userId);
    const { series: ser, byDate, textCount } = series(userId);
    /*
     * « AUJOURD'HUI » EST SA JOURNEE, PAS CELLE DU CALENDRIER.
     *
     * A 2 h du matin, quelqu'un finit sa soiree : la note qu'il pose, ce qu'il
     * ecrit et les sujets qu'il aborde appartiennent a la journee qui se
     * termine. Sans lever connu, `jourVecu` rend la journee civile -- rien ne
     * bouge tant qu'on ne sait rien.
     *
     * `jourCivil` part a cote parce que les BORNES restent civiles : la date
     * maximale d'un repere ou d'une note de carnet est ce que dit le
     * calendrier, sinon la journee d'apres devient injoignable pendant la nuit.
     */
    const t = jourVecu(userId);
    const civil = today();
    const entry = getEntry(t, userId);
    const last = ser.length ? ser[ser.length - 1] : null;
    return {
      today: t,
      jourCivil: civil,
      // De quoi verifier a l'ecran que la chaine tient : la zone que le serveur
      // a retenue et l'heure qu'il en tire. Si ca ne colle pas avec l'horloge du
      // navigateur, c'est que l'en-tete ne passe pas.
      temps: etatDuTemps(),
      settings: publicSettings(s),
      entry,
      anchors: allAnchors(userId),
      messages: recentMessages(80, userId),
      motifs: motifsDuFil(userId),
      user: publicUser(userId),
      usage: usageFor(userId),
      ambiance: ambiance(userId),
      stats: {
        days: ser.length,
        textDays: textCount,
        firstDate: ser.length ? ser[0].date : null,
        lastDate: last ? last.date : null,
        reference: last ? last.reference : null,
        streak: streak(ser, entry?.note != null ? t : addDays(t, -1)),
        years: [...new Set(ser.map(x => x.date.slice(0, 4)))].sort(),
        /*
         * LES JOURS QU'IL N'A PAS NOTES, DERRIERE LUI.
         *
         * On ne note qu'aujourd'hui, et une semaine sautee restait sautee pour
         * toujours : la grille gardait ses trous, et la reference glissante
         * comptait avec un mois de moins. Ce n'est pas une lacune d'interface,
         * c'est une perte de donnees -- la seule que ce produit ne sache pas
         * reparer.
         *
         * Sept jours, pas trente. Au-dela, on ne se souvient plus de sa
         * journee, et une note posee de memoire lointaine vaut moins que pas de
         * note du tout : elle entre dans la meme serie que les autres sans
         * avoir ete calibree comme elles.
         */
        aNoter: aNoter(series(userId).rows, t)
      },
      saturation: CONTRAST_SATURATION
    };
  },

  /** Les N dernieres journees ecrites, pour donner de la continuite au compagnon. */
  'GET /api/models': () => ({ models: ANTHROPIC_MODELS, hasEnvKey: !!process.env.ANTHROPIC_API_KEY }),

  /** Vérifie la clé sans consommer de jetons (API des modèles, pas de génération). */
  'POST /api/test-key': async ({ userId }) => {
    try { return await testKey(getSettings(userId)); }
    catch (err) { return { ok: false, reason: String(err.message ?? err) }; }
  },

  'POST /api/message': async ({ body, userId }) => {
    const text = String(body.text ?? '').trim();
    if (!text) return { error: 'texte vide' };
    /*
     * SA JOURNEE, PAS CELLE DU CALENDRIER.
     *
     * `body.date` est explicite quand la personne ecrit DANS un jour passe
     * qu'elle a ouvert : ce choix-la l'emporte sur tout. Sans lui, la journee
     * est celle qu'elle vit -- a 2 h du matin, c'est encore hier.
     *
     * La borne se pose AVANT de dater : « je viens de me lever » a 11 h doit
     * ouvrir la journee de 11 h, pas se ranger dans celle d'avant.
     */
    noterBornesDites(text, userId);
    const date = body.date ?? jourVecu(userId);
    const now = new Date().toISOString();

    const idMsg = addMessage({ ts: now, date, source: 'web', role: 'user', text, userId });
    // Une note écrite en toutes lettres devient un relevé, sans passer par le
    // modèle : voir `noterNoteDite`. Après l'enregistrement, parce qu'un relevé
    // s'ancre au message qui le porte.
    noterNoteDite(text, idMsg, date, userId);
    invalidate(userId);

    const history = filAncre(FIL_TRANSMIS, userId).map(m => ({ role: m.role, text: m.text, ts: m.ts }));
    const m = recentMemory(date, userId, text);
    /*
     * LES OUTILS AUSSI SUR CETTE ROUTE-CI.
     *
     * Elle appelait `reply` sans eux, alors que la route en flux les passe :
     * le compagnon n'était donc pas le même selon le tuyau — ici il ne pouvait
     * ni poser un repère, ni relever une humeur, ni corriger une date. Et
     * comme les outils ouvrent le préfixe de cache, les deux routes n'en
     * partageaient aucun : celle-ci repayait tout son prompt à chaque message.
     */
    const r = await reply(history, getSettings(userId), { memory: m.stable, echos: m.echos,
                                                          outils: outilsPour(userId, idMsg) });
    if (r.usage) recordUsage(userId, r.model, r.usage.input, r.usage.output, r.usage.cacheLu, r.usage.cacheEcrit, 'chat');

    addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'pet', text: r.text, userId });
    return {
      messages: recentMessages(80, userId), backend: r.backend,
      degraded: r.degraded ?? null, refused: r.refused ?? false
    };
  },

  /* `ressentis` voyage avec le fil : sans lui, l'échelle réapparaîtrait sous
     une question déjà répondue à chaque rechargement de la page, et le même
     instant se relèverait deux fois. */
  'GET /api/messages': ({ query, userId }) => {
    const messages = query.date ? messagesForDate(query.date, userId) : recentMessages(80, userId);
    return { messages, ressentis: relevesDeToi(messages.map(m => m.id), userId)
      .map(r => ({ message_id: r.message_id, valeur: r.valeur })) };
  },

  'POST /api/note': ({ body, userId }) => {
    const date = body.date ?? today();
    const note = body.note === null ? null : Number(body.note);
    if (note !== null && (!Number.isFinite(note) || note < 0 || note > 10)) return { error: 'note hors 0..10' };
    setNote(date, note, userId);
    invalidate(userId);
    return { entry: getEntry(date, userId) };
  },

  /*
   * L'ANNÉE PORTE LES SIGNES, ELLE AUSSI.
   *
   * C'est la seule vue où l'on voit une PÉRIODE : trois rouges en une semaine
   * ne se lisent pas en feuilletant les jours un par un, et c'est justement la
   * forme qu'on est venu chercher ici.
   *
   * Les signes se calculent sur l'année demandée, pas sur tout le journal :
   * relire quatre ans de messages pour peindre une grille de trois cent
   * soixante-cinq cases coûterait une seconde à chaque changement d'année.
   */
  'GET /api/year': ({ query, userId }) => {
    const an = Number(query.year ?? today().slice(0, 4));
    const grille = yearGrid(series(userId).series, an);
    for (const mo of grille.months) {
      for (const j of mo.days) {
        if (j?.date) j.veille = veilleDuJour(j.date, userId)?.niveau ?? null;
      }
    }
    return grille;
  },

  /**
   * CHERCHER UN MOT OU UNE PHRASE DANS TOUT CE QU'ON A ÉCRIT.
   *
   * Pas une carte de proximité (ça, c'est « ma carte »), pas un résumé : le
   * texte EXACT, partout où on l'a tapé. Chaque instance porte SON jour et SON
   * heure — « quand ai-je parlé de ça, et combien de fois ». On rend la phrase
   * qui contient le terme, pas le message entier : c'est l'endroit précis qu'on
   * cherche, pas six cents mots autour.
   *
   * Insensible aux accents et à la casse (« fatigue » trouve « fatigué »). On
   * cherche ce que la PERSONNE a écrit, jamais les réponses du compagnon.
   */
  'GET /api/chercher': ({ query, userId }) => chercher(query.q ?? '', userId),

  /** Serie compacte pour les courbes : tableaux paralleles, ~5x plus leger que des objets. */
  'GET /api/series': ({ userId }) => {
    const s = series(userId).series;
    return {
      date: s.map(x => x.date),
      note: s.map(x => x.note),
      reference: s.map(x => x.reference),
      delta: s.map(x => x.delta),
      contrastFixed: s.map(x => x.contrastFixed),
      contrastGlobal: s.map(x => x.contrastGlobal),
      contrastRelative: s.map(x => x.contrastRelative),
      midValue: s.map(x => x.midValue),
      cumEtalon: s.map(x => x.cumEtalon),
      cumDeltaRef: s.map(x => x.cumDeltaRef),
      cumFixed: s.map(x => x.cumFixed),
      cumGlobal: s.map(x => x.cumGlobal),
      cumRelative: s.map(x => x.cumRelative),
      etalon: getSettings(userId).etalon ?? median(s.map(x => x.note).sort((a, b) => a - b)),
      globalMedian: median(s.map(x => x.note).sort((a, b) => a - b)),
      mean: s.length ? Math.round(s.reduce((a, b) => a + b.note, 0) / s.length * 1000) / 1000 : null,
      events: reperes(userId).events,
      motifs: motifsDuFil(userId)
    };
  },

  /**
   * Le Miroir -- SPEC 2. Trois mecanismes, par ordre d'importance :
   * preuve de resolution, similitude, contradiction.
   * Ne genere aucun texte. Rend des dates, des chiffres et des mots deja ecrits.
   */
  'GET /api/mirror': ({ query, userId }) => {
    const s = getSettings(userId);
    const date = query.date ?? today();
    /*
     * LA NUIT DU JOUR REGARDÉ EST RANGÉE AVANT D'ÊTRE LUE.
     *
     * Une borne peut arriver bien après les messages qu'elle range (« couché
     * 06:10 » posé à 6 h du matin, ou poussé par Machi Tool le lendemain), et
     * `reprendreLesNuits` ne repasse qu'au démarrage. Sans ce filet, on ouvre la
     * journée et on la voit encore mal rangée. `recalerLaNuit` est borné (jamais
     * plus d'un jour en arrière, seulement les messages d'avant une coupure
     * CONNUE) et idempotent : un jour déjà rangé n'y bouge rien.
     */
    recalerLaNuit(date, userId);
    const { series: ser, byDate, index, rows, textCount } = series(userId);
    const cur = byDate.get(date) ?? null;
    const entry = getEntry(date, userId);
    const note = entry?.note ?? null;
    const reference = cur?.reference ?? (ser.length ? ser[ser.length - 1].reference : null);

    const floor = floorState(note, reference, s);

    // Ce que le Miroir montrait le moins bien : la journee qu'on regarde. On se
    // baladait dans l'historique sans jamais voir ce qu'on avait ecrit CE jour-la.
    /*
     * SUR LA JOURNÉE OUVERTE, LE SIGNE ARRIVE AVEC SA PREUVE.
     *
     * Un signe sans la phrase qui l'a produit serait un verdict de machine.
     * Avec elle, c'est un rappel de ce qu'on a écrit — et si le signe est faux,
     * ça se voit tout de suite, ce qu'il faut pour qu'on continue à le croire
     * quand il est juste.
     */
    const veille = veilleDuJour(date, userId);
    const jour = { date, note, text: entry?.text ?? '',
                   veille: veille ? { ...veille, dit: VEILLE_DIT[veille.niveau],
                                      aide: veille.niveau === 'rouge' ? VEILLE_AIDE : null } : null };

    // Le mois affiche, pour le calendrier. Il ne suit PAS forcement le jour
    // ouvert : on feuillette mars sans quitter la journee qu'on lisait.
    // Les journees sans note en font partie : c'est un calendrier, les trous s'y
    // voient et c'est une information.
    const mois = /^\d{4}-\d{2}$/.test(String(query.mois ?? '')) ? query.mois : date.slice(0, 7);
    const [an, mo] = mois.split('-').map(Number);
    const nbJours = new Date(Date.UTC(an, mo, 0)).getUTCDate();
    const calendrier = [];
    for (let d = 1; d <= nbJours; d++) {
      const j = `${mois}-${String(d).padStart(2, '0')}`;
      const pt = byDate.get(j);
      const e = rows.find(r => r.date === j);
      calendrier.push({
        date: j,
        note: e?.note ?? null,
        delta: pt?.delta ?? null,
        texte: !!(e?.text && e.text.trim()),
        /*
         * LE SIGNE DE VEILLE, SUR LE RUBAN DU MOIS.
         *
         * Une pastille « crise 5 » avait le même poids visuel qu'une pastille
         * « création 3 » : cinq passages sur une crise et trois sur un projet,
         * rangés côte à côte comme deux sujets de conversation. Ici le mois
         * porte le NIVEAU, et rien d'autre — le détail s'ouvre en cliquant le
         * jour, avec la phrase qui l'a déclenché.
         */
        veille: veilleDuJour(j, userId)?.niveau ?? null
      });
    }

    // 3. CONTRADICTION : l'entree d'hier, brute, sans commentaire.
    const y = addDays(date, -1);
    const yEntry = getEntry(y, userId);
    const yesterday = yEntry ? { date: y, note: yEntry.note ?? null, text: yEntry.text ?? '' } : { date: y, note: null, text: '' };

    // Sous le plancher : rien d'autre que du brut. SPEC 4.1.
    if (floor.floored) {
      const past = rows.filter(r => r.text && r.text.trim() && r.date < date)
        .slice(-5).reverse()
        .map(r => ({ date: r.date, text: r.text, note: r.note }));
      // Les reperes passent le plancher : ce sont des faits que la personne a
      // elle-meme poses, pas une statistique calculee sur elle.
      /*
       * LES MESURES PASSENT LE PLANCHER, LEURS LIENS NON.
       *
       * La règle du plancher n'est pas « on cache tout » : les repères et les
       * notes apportées le franchissent déjà, parce que ce sont des FAITS que
       * la personne a posés, pas une statistique calculée sur elle. Une durée
       * de sommeil relevée par une montre est de la même nature — un fait,
       * daté, que rien n'interprète.
       *
       * La phrase du lien, elle, est exactement ce que le plancher existe pour
       * retenir. « Les journées au-dessus de 6,2 h sont notées 2,2 points plus
       * haut », sur une journée que quelqu'un vient de noter 2, c'est
       * l'application qui explique à quelqu'un qui va mal que ça se voyait
       * venir. On garde le chiffre, on retire le commentaire.
       */
      return { date, note, jour, calendrier, floored: true, floor, yesterday, rawPast: past,
               episodes: null, similar: null, reperes: reperesDuJour(date, userId),
               amplitude: amplitude(date, userId),
               mesures: mesuresSituees(date, userId, { avecLiens: false }),
               carnet: carnetDuJour(date, userId) };
    }

    // 1. PREUVE DE RESOLUTION
    const sustain = Number(query.sustain ?? s.sustain ?? 2);
    const ep = note === null ? { applicable: false, reason: 'no_note' }
                             : episodes(ser, note, { horizon: 60, sustain });
    if (ep.applicable && ep.count < MIN_COMPARABLE) {
      ep.insufficient = true;             // SPEC 4.4
      ep.minComparable = MIN_COMPARABLE;
    }

    // 2. SIMILITUDE
    // v1 textuelle (BM25) quand il y a du texte ; sinon repli numerique honnete
    // sur les journees de meme note. L'historique importe ne contient que des
    // chiffres : sans ce repli, le Miroir serait vide le premier jour.
    let similar = null;
    const curText = entry?.text ?? '';
    // Un rapprochement doit tenir sur un mot qui NOMME quelque chose. Deux
    // journees qui n'ont en commun que « juste », « encore » ou « c'est » ne se
    // ressemblent pas : elles sont ecrites dans la meme langue. Les afficher
    // quand meme donne une fausse impression de theme, ce qui est pire que ne
    // rien montrer -- on retombe alors sur la comparaison par note, honnete.
    const hits = curText.trim() && textCount >= 2
      ? search(index, curText, { limit: 8, exclude: new Set([date]) }).filter(h => h.forts.length)
      : [];
    if (hits.length) {
      similar = {
        mode: 'text',
        items: hits.slice(0, 5).map(h => ({
          date: h.id, score: h.score, terms: h.terms, forts: h.forts,
          note: byDate.get(h.id)?.note ?? null,
          text: rows.find(r => r.date === h.id)?.text ?? '',
          band: followUp(ser, h.id, 14)
        }))
      };
    } else if (note !== null) {
      const same = ser.filter(x => x.date < date && x.note === note).slice(-5).reverse();
      similar = {
        mode: 'note',
        reason: textCount < 2 ? 'no_text_corpus' : (curText.trim() ? 'no_theme' : 'no_text_today'),
        items: same.map(x => ({
          date: x.date, note: x.note, delta: x.delta, text: '',
          band: followUp(ser, x.date, 14)
        }))
      };
    }

    // Les rapprochements partent des plus recents : ce qu'on a ecrit le mois
    // dernier eclaire mieux aujourd'hui qu'une journee de 2022, meme si le score
    // de similitude y est plus fort.
    if (similar?.items?.length) {
      similar.items = similar.items.slice().sort((a, b) => b.date.localeCompare(a.date));
    }
    return { date, note, jour, calendrier, reference, delta: cur?.delta ?? null,
             floored: false, floor, yesterday, episodes: ep, similar, textCount,
             reperes: reperesDuJour(date, userId),
             amplitude: amplitude(date, userId),
             /*
              * LA JOURNEE HEURE PAR HEURE. Ce qui manquait le plus : on ouvrait
              * une journee et on y voyait sa note et son texte, jamais ce qui
              * s'y etait PASSE. Une journee notee 8 peut contenir « juste envie
              * de mourir » ecrit le soir, et c'est la bascule qui la raconte.
              */
             /*
              * LA RÉFÉRENCE VOYAGE AVEC LA JOURNÉE. Les estimations des moments
              * se lisent par rapport à la normale DE LA PERSONNE : chez
              * quelqu'un qui tourne à 4, une journée à 5 est une bonne journée,
              * et la caler sur le milieu de l'échelle la peindrait en médiocre.
              */
             journee: journee(date, userId, { reference }),
             /*
              * CE QU'UNE MACHINE A MESURE CE JOUR-LA. Une journée notée 4 avec
              * quatre heures de sommeil derrière n'est pas la même journée
              * qu'une journée notée 4 après huit heures — et c'est exactement
              * ce dont personne ne se souvient en relisant.
              */
             mesures: mesuresSituees(date, userId),
             // Le poste en leger : lever, coucher, sommeil, temps d'ecran. Ce
             // qui tient la colonne « ce qui a ete mesure » ; le detail se
             // replie derriere.
             poste: posteDuJour(date, userId),
             // L'etat de la synchro, en leger : depuis combien de temps le
             // dernier envoi de Machi Tool a ete recu. La vue minimaliste le
             // montre a cote du poste ; l'ecran choisit les mots.
             synchro: (() => {
               const ts = derniereSynchro(userId);
               return { depuis_min: ts ? Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 60000)) : null,
                        version: versionMachiTool(userId) };
             })(),
             // Les notes apportees passent le plancher, pour la meme raison que
             // les reperes : ce sont des faits que la personne a poses
             // elle-meme, pas une statistique calculee sur elle.
             carnet: carnetDuJour(date, userId) };
  },

    'GET /api/search': ({ query, userId }) => {
    const { index, rows, byDate, series: ser } = series(userId);
    const q = String(query.q ?? '').trim();
    if (!q) return { items: [], query: q };
    const hits = search(index, q, { limit: 20 });
    return {
      query: q,
      items: hits.map(h => ({
        date: h.id, score: h.score, terms: h.terms, forts: h.forts,
        note: byDate.get(h.id)?.note ?? null,
        text: rows.find(r => r.date === h.id)?.text ?? '',
        band: followUp(ser, h.id, 14)
      }))
    };
  },

  /**
   * Import d'un historique tableur depuis l'interface -- SPEC 8, etape 1.
   * En deux temps : un apercu qui ne touche a rien, puis l'ecriture. Ecraser
   * des annees de notes sur un simple choix de fichier serait indefendable.
   */
  'POST /api/import': ({ body, userId }) => {
    const csv = String(body.csv ?? '');
    if (!csv.trim()) return { error: 'fichier vide' };

    const existing = new Map(allEntries(userId).filter(r => r.note !== null).map(r => [r.date, r.note]));
    let report;
    try { report = inspectCSV(csv, { existing }); }
    catch (err) { return { error: `CSV illisible : ${err.message}` }; }

    if (!report.total) {
      return { error: "Aucune journée reconnue. Le format attendu est une grille année par année, avec une ligne par mois (Jan, Feb, …) et les notes en colonnes 1 à 31." };
    }
    if (!body.apply) {
      const { entries, ...preview } = report;
      return { preview };
    }
    const written = applyImport(report.entries, report.anchors, userId);
    invalidate(userId);
    const { entries, ...preview } = report;
    return { imported: written, preview };
  },

  /**
   * Import de notes deja ecrites, collees en bloc.
   *
   * Le pendant texte de l'import CSV. Les notes du tableur donnent des chiffres ;
   * celles-ci donnent des mots, et sans mots le miroir n'a rien a comparer : la
   * recherche par similitude reste muette sur des annees de journal.
   *
   * Meme regle qu'ailleurs : un apercu qui ne touche a rien, puis l'ecriture.
   */
  'POST /api/import-notes': ({ body, userId }) => {
    const texte = String(body.text ?? '');
    if (!texte.trim()) return { error: 'rien à importer' };

    // `today` vient d'ici et non du fond du parseur : c'est lui qui sert de
    // repere aux dates sans annee, et le fuseau du serveur n'est pas celui de
    // la personne qui colle.
    const report = inspectNotes(texte, userId, { today: today() });
    if (!report.total) {
      return { error: "Aucune date reconnue. Chaque journée commence par une date — 2024-03-12, 12/03/2024, 12 mars 2024, ou 17/08 sans l'année — soit sur sa propre ligne avec le texte en dessous, soit dans une colonne si tu colles un tableau." };
    }
    const { entries, ...preview } = report;
    if (!body.apply) return { preview };

    const written = applyNotes(entries, userId);
    invalidate(userId);
    return { imported: written, preview };
  },

  /**
   * Ouverture et fermeture de la fenetre.
   *
   * La fermeture arrive par sendBeacon et peut se perdre : un navigateur tue ne
   * l'envoie jamais. On ne s'en sert donc que comme indice -- c'est l'ouverture
   * qui fait foi, et une session restee ouverte est refermee a la suivante.
   */
  'POST /api/session': ({ body, userId }) => {
    if (body.close) return { closed: sessions.close(userId) };
    const info = sessions.open(userId);
    return { session: info, presence: sessions.presence(userId) };
  },

  /**
   * Nouveau fil.
   *
   * Le curseur avance : les messages anterieurs quittent la conversation. RIEN
   * n'est efface -- le texte des journees reste dans le journal, le miroir le
   * fouille toujours, et le compagnon garde ses reperes et sa memoire des jours
   * ecrits. C'est un changement de sujet, pas une suppression : effacer des
   * annees d'ecriture sur un clic serait irreparable, et personne ne clique un
   * bouton « nouveau chat » en pensant perdre son journal.
   */
  'POST /api/chat/new': ({ userId }) => {
    const since = new Date().toISOString();
    setSettings({ chatSince: since }, userId);
    return { chatSince: since, messages: recentMessages(80, userId) };
  },

  /**
   * Suppression d'une journee, depuis le Miroir ou la grille.
   * `note: true` n'efface que le chiffre et garde ce qui a ete ecrit.
   */
  'POST /api/delete-day': ({ body, userId }) => {
    const date = String(body.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'date invalide' };
    if (body.noteOnly) clearNote(date, userId); else deleteDay(date, userId);
    invalidate(userId);
    return { date, ok: true };
  },

  /**
   * Remise a zero.
   *
   * Le mot a retaper n'est pas de la ceremonie : c'est la seule action de
   * l'application qui detruise des annees sans retour, et un bouton seul se
   * clique par reflexe. On demande donc un geste qui ne peut pas etre fait
   * distraitement, et on rend le compte de ce qui est parti -- sans quoi
   * personne ne sait si l'action a marche.
   */
  'POST /api/wipe': ({ body, userId }) => {
    const portee = String(body.portee ?? '');
    if (!['notes', 'texte', 'tout'].includes(portee)) return { error: 'portée inconnue' };
    if (String(body.confirm ?? '') !== 'SUPPRIMER') {
      return { error: 'confirmation manquante' };
    }
    const compte = wipe(portee, userId);
    invalidate(userId);
    const { series: ser, textCount } = series(userId);
    return { portee, compte, restant: { days: ser.length, textDays: textCount } };
  },

  /**
   * La carte des mots.
   *
   * Elle ne sort QUE du texte deja ecrit et des notes deja posees. Rien n'est
   * genere, rien n'est qualifie : on compte ce qui revient, et avec quoi.
   *
   * Le plancher s'applique ici comme partout ailleurs (SPEC 4.1) : sous le
   * seuil, aucune statistique. Une carte est une statistique -- une tres jolie,
   * ce qui la rend plus dangereuse qu'un chiffre, pas moins.
   */
  'GET /api/graph': ({ query, userId }) => {
    const s = getSettings(userId);
    const { rows, series: ser } = series(userId);
    const t = today();
    const note = getEntry(t, userId)?.note ?? null;
    const reference = ser.length ? ser[ser.length - 1].reference : null;
    const floor = floorState(note, reference, s);
    if (floor.floored) return { floored: true, floor };

    const f = String(query.fenetre ?? 'tout');
    const jours = f === '30' ? 30 : f === '90' ? 90 : f === '365' ? 365 : null;
    const since = jours ? addDays(t, -jours) : null;

    return { floored: false, fenetre: f, minimum: MIN_JOURS,
             ...buildGraph(rows, allAnchors(userId), { since, carnet: series(userId).carnet }) };
  },

  'GET /api/events': ({ userId }) => ({ events: allEvents(userId) }),

  /**
   * La frise de vie.
   *
   * Elle ne calcule AUCUNE statistique : elle place des faits que la personne a
   * elle-meme poses, et va chercher la couleur des journees qu'ils couvrent.
   * C'est pourquoi elle traverse le plancher de la SPEC 4.1 la ou la carte
   * s'arrete -- il n'y a rien ici qui puisse etre rendu contre quelqu'un un
   * mauvais soir, seulement ce qu'il a ecrit lui-meme.
   */
  'GET /api/frise': ({ userId }) => {
    const s = getSettings(userId);
    const { series: ser, byDate } = series(userId);
    const events = allEvents(userId);
    const t = today();

    const et = etendue({
      naissance: s.naissance,
      events: events.map(e => ({ date: e.date, fin: finEffective(e, t) })),
      premierJour: ser.length ? ser[0].date : null,
      dernierJour: ser.length ? ser[ser.length - 1].date : null,
      aujourdhui: t
    });

    /*
     * LA REGLE DE COULEUR : ce qui est REMPLI est MESURE, ce qui est CONTOURE
     * est DECLARE.
     *
     * Le serveur ne rend donc jamais une couleur : il rend les ECARTS des
     * journees couvertes, et le dessin en fait un degrade. Une periode prend
     * ainsi le degrade des jours qu'elle recouvre, jamais leur moyenne -- sur un
     * corpus reel, la moyenne des ecarts sur trois ans tient entre −0,08 et
     * +0,12, soit deux jaunes indiscernables : six barres de la meme couleur.
     *
     * Et la ou il n'y a pas de journees -- l'enfance, tout ce qui precede le
     * journal -- il n'y a pas d'ecart, donc pas de couleur. On ne colorie pas ce
     * qu'on ne sait pas.
     */
    const couverture = (debut, fin) => ser
      .filter(x => x.date >= debut && x.date <= fin)
      .map(x => ({ date: x.date, delta: x.delta ?? null }));

    const jours = (a, b) => Math.round(
      (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;

    const periodes = events.filter(estPeriode);
    const lanes = voies(periodes.map(e => ({ date: e.date, fin: finEffective(e, t) })), 14);

    return {
      etendue: et,
      naissance: s.naissance,
      teintes: TEINTES,
      points: events.filter(e => !estPeriode(e)).map(e => ({
        id: e.id, date: e.date, label: e.label,
        theme: e.theme ?? themeDe(e.label),
        teinte: e.teinte ?? null, fort: e.fort ? 1 : 0,
        ecart: byDate.get(e.date)?.delta ?? null,
        note: byDate.get(e.date)?.note ?? null
      })),
      periodes: periodes.map((e, i) => {
        const fin = finEffective(e, t);
        return {
          id: e.id, date: e.date, fin, ouvert: e.ouvert ? 1 : 0, label: e.label,
          theme: e.theme ?? themeDe(e.label),
          teinte: e.teinte ?? null, fort: e.fort ? 1 : 0,
          voie: lanes[i].voie,
          duree: jours(e.date, fin),
          // Les journees ecrites sous la barre. Leur nombre dit aussi sur quoi
          // la couleur repose : une barre de quatre ans posee sur trois mois de
          // journal ne doit pas se lire comme quatre ans de mesure.
          jours: couverture(e.date, fin)
        };
      })
    };
  },

  /**
   * Le carnet.
   *
   * N'appelle JAMAIS floorState : elle ne rend aucun agregat calcule sur la
   * personne, seulement des lignes qu'elle a posees elle-meme. Meme exception
   * que pour les reperes -- le plancher retire des chiffres, jamais des faits
   * qu'on a soi-meme deposes, et c'est precisement un mauvais soir qu'on a
   * quelque chose a deposer.
   */
  /**
   * « Ce que je remarque » — l'etat global.
   *
   * Un recensement du corpus, pas un bulletin. Il repond a « qu'est-ce que ce
   * journal contient », jamais a « comment vas-tu ». Le sujet de chaque ligne
   * est un MOT ; la personne n'y est jamais sujet.
   *
   * Le plancher est teste ICI, avant tout calcul : une regle qui ne vit que
   * dans l'interface finit toujours par etre contournee.
   */
  'GET /api/remarque': ({ query, userId }) => {
    const s = getSettings(userId);
    const { rows, series: ser, carnet } = series(userId);
    const t = today();
    const note = getEntry(t, userId)?.note ?? null;
    const reference = ser.length ? ser[ser.length - 1].reference : null;
    const floor = floorState(note, reference, s);
    if (floor.floored) return { floored: true, floor };

    const f = String(query.fenetre ?? 'tout');
    const j = f === '30' ? 30 : f === '90' ? 90 : f === '365' ? 365 : null;
    const since = j ? addDays(t, -j) : null;
    const anchors = allAnchors(userId);
    const G = buildGraph(rows, anchors, { since, carnet });

    return {
      ...G,
      fenetre: f,
      // Les journees ECRITES qui portent aussi une note, pas toutes les journees
      // notees : « 425 écrites · 1700 notées » posait deux populations
      // differentes sous deux etiquettes voisines, ce que cet ecran existe
      // precisement pour empecher.
      notees: rows.filter(r => r.text && r.text.trim() && r.note !== null
                            && (!since || r.date >= since)).length,
      bouge: G.assez ? deplacements(rows, anchors, carnet, t) : [],
      carnetNotes: carnet.slice(-3).reverse()
    };
  },

  /**
   * Le dossier d'un theme.
   *
   * `nom` est verifie contre l'amas trouve par son id : les amas sont
   * renumerotes a chaque construction du graphe, donc un identifiant seul,
   * garde dans un lien ou dans l'historique du navigateur, designerait un jour
   * un autre theme sans que rien ne le signale.
   */
  'GET /api/theme': ({ query, userId }) => {
    const s = getSettings(userId);
    const { rows, series: ser, byDate, carnet } = series(userId);
    const t = today();
    const note = getEntry(t, userId)?.note ?? null;
    const reference = ser.length ? ser[ser.length - 1].reference : null;
    const floor = floorState(note, reference, s);
    if (floor.floored) return { floored: true, floor };

    const f = String(query.fenetre ?? 'tout');
    const j = f === '30' ? 30 : f === '90' ? 90 : f === '365' ? 365 : null;
    const since = j ? addDays(t, -j) : null;
    const G = buildGraph(rows, allAnchors(userId), { since, carnet });
    if (!G.assez) return { assez: false, jours: G.jours, minimum: G.minimum };

    const id = Number(query.amas);
    const amas = G.amas.find(a => a.id === id);
    if (!amas) return { perime: true };
    if (query.nom && amas.nom !== String(query.nom)) return { perime: true, nom: amas.nom };

    const membres = G.noeuds.filter(n => n.amas === id);
    const mots = new Set(membres.map(n => n.mot));

    // Les journees ou au moins un mot du theme apparait. On repart du texte :
    // `n.dates` n'expose que les six dernieres, de quoi ouvrir le Miroir, pas de
    // quoi lister.
    const dedans = rows
      .filter(r => r.text && r.text.trim() && (!since || r.date >= since))
      .map(r => ({ r, hits: [...new Set(tokenize(r.text))].filter(m => mots.has(m)) }))
      .filter(x => x.hits.length)
      .map(x => ({
        date: x.r.date, note: x.r.note ?? null,
        delta: byDate.get(x.r.date)?.delta ?? null,
        mots: x.hits,
        extrait: x.r.text.slice(0, 260)
      }))
      .reverse();

    // Les notes du carnet qui contiennent un mot du theme. Rendues ENTIERES, et
    // jamais melangees aux journees : aucune moyenne, aucun ecart, et le mot
    // « jours » n'apparait pas a cote d'elles.
    const notes = carnet
      .filter(c => tokenize(c.texte).some(m => mots.has(m)))
      .map(c => ({ ...c, mots: [...new Set(tokenize(c.texte))].filter(m => mots.has(m)) }))
      .reverse();

    const idx = new Map(G.noeuds.map((n, i) => [i, n]));
    const liens = G.liens
      .filter(l => idx.get(l.s)?.amas === id && idx.get(l.t)?.amas === id)
      .map(l => ({
        a: idx.get(l.s).mot, b: idx.get(l.t).mot, n: l.jours ?? null,
        ja: idx.get(l.s).jours, jb: idx.get(l.t).jours, force: l.force
      }))
      .sort((x, y) => y.force - x.force)
      .slice(0, 12);

    return {
      amas, membres, liens, jours: dedans, notes,
      fenetre: f, minNotees: G.minNotees,
      moyenneGlobale: G.moyenneGlobale,
      carnetTotal: carnet.length
    };
  },

  /*
   * LES NOTES, AVEC CE QUI EN RESSORT.
   *
   * Une note collee fait souvent trois mille signes. Deroulees, dix d'entre
   * elles remplissent quinze ecrans, et l'on ne peut plus retrouver celle qu'on
   * cherche -- une liste ou rien ne se distingue n'est pas une liste, c'est un
   * mur.
   *
   * On calcule donc pour chacune les quelques termes qui pesent (le meme
   * lexique que partout ailleurs, jamais un lexique a part), et le theme
   * dominant qui lui donne son icone. Ca ne resume pas la note -- le resume
   * serait une reformulation, et ses mots lui appartiennent : ca dit seulement
   * de quoi elle parle, pour qu'on sache laquelle ouvrir.
   */
  'GET /api/carnet': ({ userId }) => ({
    notes: allCarnet(userId).map(n => ({ ...n, ...quoiDedans(n.texte) })),
    compte: countCarnet(userId)
  }),

  /**
   * CE QUE LE COMPAGNON A LU.
   *
   * Une seule question : « qu'est-ce qu'il sait de moi ? ». Elle se pose, et
   * jusqu'ici rien n'y repondait -- les notes rangees depuis la conversation
   * disparaissaient dans une table que rien n'affichait en entier.
   *
   * Trois populations, jamais melangees, parce qu'elles ne veulent pas dire la
   * meme chose : les JOURNEES ecrites (ce qu'il a vecu et note), les MESSAGES
   * du fil (ce qu'ils se sont dit), les NOTES rangees (ce qu'il a apporte
   * d'ailleurs). Une seule addition des trois et le compte de journees, qui
   * sert de denominateur a toute la carte, cesserait de vouloir dire quelque
   * chose.
   */
  'GET /api/contexte': ({ userId }) => {
    const { rows, carnet } = series(userId);
    const msg = db.prepare(
      "SELECT COUNT(*) t, COUNT(DISTINCT date) j FROM messages WHERE user_id = ? AND role = 'user'"
    ).get(userId);
    const ecrites = rows.filter(r => r.text && r.text.trim()).length;
    return {
      notes: carnet,
      compte: countCarnet(userId),
      journal: { jours: rows.length, ecrites,
                 premier: rows[0]?.date ?? null, dernier: rows.at(-1)?.date ?? null },
      fil: { messages: msg.t, jours: msg.j },
      memoire: getSettings(userId).memoryDays
    };
  },

  /**
   * Ecrire dans le carnet. La validation est ICI et pas dans une consigne.
   *
   * `jour` et `quand` s'excluent : une date connue OU les mots de la personne
   * quand elle ne l'est pas. Les garder tous les deux ferait deux verites sur
   * la meme note, et l'affichage devrait en choisir une.
   */
  'POST /api/carnet': ({ body, userId }) => {
    const rendre = () => ({ notes: allCarnet(userId), compte: countCarnet(userId) });

    if (body.delete) { deleteCarnet(Number(body.delete), userId); invalidate(userId); return rendre(); }

    const texte = String(body.texte ?? '').trim();
    if (!texte) return { error: 'Rien à ajouter.' };
    if (texte.length > 4000) {
      return { error: "Trop long pour une note (4000 caractères). Pour un bloc entier, passe par « Coller des notes déjà écrites » dans Réglages : il découpe par date." };
    }

    let jour = body.jour ? String(body.jour) : null;
    if (jour && !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return { error: 'Date invalide : il faut AAAA-MM-JJ.' };
    if (jour && jour > today()) return { error: "Cette date est dans le futur." };
    // Exclusifs : une date connue, ou des mots a la place. Jamais les deux.
    const quand = jour ? null : (String(body.quand ?? '').trim().slice(0, 60) || null);

    if (body.id) {
      if (!updateCarnet(Number(body.id), { texte, jour, quand }, userId)) return { error: 'Note introuvable.' };
    } else {
      addCarnet({ texte, jour, quand, source: body.source === 'colle' ? 'colle' : 'saisie', userId });
    }
    invalidate(userId);
    return rendre();
  },

  /**
   * LA LECTURE : ce que le compagnon comprend du fonctionnement.
   *
   * GET rend ce qui est en base, avec de quoi savoir s'il faut relancer. Une
   * lecture est perimee quand des journees ont ete ecrites APRES la derniere
   * qu'elle a vue -- pas quand elle est vieille. Une lecture faite il y a un
   * mois sur un journal auquel on n'a rien ajoute est toujours juste, et la
   * relancer couterait des jetons pour rendre exactement la meme chose.
   */
  /*
   * « MOI » : ce que la vue simplifiee a besoin de savoir en plus du calendrier.
   *
   * Le calendrier et la journee ouverte viennent deja de /api/mirror -- les
   * redemander ici ferait deux sources pour la meme case de grille, et un jour
   * elles divergeraient. Cette route ne rend donc que ce qui lui manque : les
   * PISTES de la fenetre choisie, et les ECARTS que le serveur sait calculer.
   *
   * Les ecarts ne passent PAS par le modele. Ils sont mesures ici, phrase
   * comprise -- « LE MODELE CHOISIT LE FAIT, LE SERVEUR POSSEDE LE NOMBRE ».
   * C'est aussi pour ca qu'ils s'affichent meme quand aucune lecture n'a
   * jamais tourne : ils ne coutent rien et ne dependent de personne.
   */
  'GET /api/moi': ({ userId }) => {
    const { rows, series: ser } = series(userId);
    const l = getLecture(userId);
    const ecarts = comparaisons(rows, allEvents(userId))
      // Les plus gros ecarts d'abord : une vue « simplifiee » qui rend
      // vingt-deux comparaisons dans l'ordre du calcul n'a rien simplifie.
      .sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart))
      .slice(0, 6);
    const dernier = ser.length ? ser[ser.length - 1] : null;
    return {
      pistes: l?.contenu?.pistes ?? [],
      themes: (l?.contenu?.themes ?? []).map(t => ({ nom: t.nom, quoi: t.quoi, intensite: t.intensite })),
      synthese: l?.contenu?.synthese ?? null,
      fait_le: l?.fait_le ?? null,
      lue: !!l,
      ecarts,
      resume: {
        jours: rows.length,
        ecrites: rows.filter(r => r.text && r.text.trim()).length,
        reference: dernier?.reference ?? null,
        serie: streak(ser)
      }
    };
  },

  /* ---------- la passerelle vers une application locale ----------
     Creer la cle et la retirer se font depuis la session, comme tout le reste
     des reglages. C'est la LECTURE de /api/passerelle/attente qui se passe de
     session : elle est appelee par un programme, pas par un navigateur. */
  /*
   * « SYNCHRONISER » QUAND L'APPLICATION N'EST PAS À PORTÉE.
   *
   * Le site ne peut rien pousser vers la machine de Machi Tool : elle n'a pas
   * d'adresse joignable depuis Internet. Depuis un téléphone, un autre poste,
   * ou quand le serveur local ne répond pas, la demande se DÉPOSE ici et Machi
   * Tool la ramasse à son prochain relevé (quelques minutes). Le chemin direct
   * — le navigateur qui interroge 127.0.0.1 — reste le plus rapide et passe
   * d'abord ; celui-ci est le filet.
   */
  'POST /api/passerelle/synchro': ({ userId }) => ({
    demande_le: synchroDemandee(userId),
    // De quoi écrire une phrase juste à l'écran, sans supposer l'intervalle.
    delai_max_min: 10
  }),
  'POST /api/passerelle/cle': ({ userId }) => ({ cle: poserCle(userId) }),
  'DELETE /api/passerelle/cle': ({ userId }) => { retirerCle(userId); return { ok: true }; },

  /*
   * DE QUOI ALLER CHERCHER LE DIGEST DIRECTEMENT SUR LA MACHINE.
   *
   * Le navigateur, qui tourne sur le meme poste que Machi Tool, peut tirer le
   * digest du jour de 127.0.0.1 quand on ouvre une journee encore ouverte --
   * sans attendre le prochain envoi automatique. Il lui faut pour cela la MEME
   * cle que la passerelle (celle que Machi Tool presente deja), et l'adresse
   * locale. Cette route est DERRIERE le verrou : seule la personne connectee, sur
   * sa propre machine, recoit sa propre cle. Elle ne sort jamais autrement.
   */
  'GET /api/passerelle/local': ({ userId }) => ({
    cle: getSettings(userId).passerelleCle || '',
    url: 'http://127.0.0.1:7373'
  }),

  /*
   * LA CONSOMMATION DE JETONS DANS LE TEMPS. Une courbe, par heure (48 dernières)
   * ou par jour (30 derniers). De quoi voir d'un coup où ça a coûté, sans ouvrir
   * une facture — l'enveloppe reste une jauge, pas un compte.
   */
  /*
   * LE PROFIL D'UN ÉCHANGE, CETTE SEMAINE ET LA PRÉCÉDENTE. C'est ce qui dit
   * si une optimisation a servi : le total du mois, lui, monte avec l'usage.
   */
  'GET /api/usage/profil': ({ userId }) => profilUsage(userId),

  /*
   * QUATRE FENÊTRES, ET LA MESURE SE CHOISIT À L'ÉCRAN.
   *
   * Le serveur rend les quatre mesures sur la même série — volume, jetons par
   * échange, dollars par échange, part du cache. Les recalculer par un
   * aller-retour à chaque clic ferait payer un changement d'axe au prix d'une
   * requête, pour des données déjà là.
   */
  'GET /api/usage/serie': ({ query, userId }) =>
    serieUsage(userId, FENETRES[query.grain] ? query.grain : 'jour'),

  /* ---------- quantified self : ce qui est arrive, et par quel tuyau ----------
   *
   * L'inventaire AVANT le journal, et c'est l'ordre qui compte : deux series
   * presque identiques (`pas` et `pas_jour`) sautent aux yeux dans un
   * inventaire et se noient dans une liste d'envois. La question qu'on se pose
   * en ouvrant l'onglet est « qu'est-ce que le site croit savoir ? », pas
   * « qu'est-ce qui est arrive a 14h07 ? ».
   */
  'GET /api/qs': ({ userId }) => {
    const series = inventaireMesures(userId).map(x => ({
      ...x,
      moyenne: x.moyenne == null ? null : Math.round(x.moyenne * 100) / 100,
      derniere: derniereMesure(x.source, x.cle, userId)
    }));
    return {
      series,
      total: series.reduce((n, x) => n + x.n, 0),
      journal: journalQS(userId),
      // La cle est la meme que celle de la lecture : un seul secret a coller
      // dans l'application qui envoie, un seul a revoquer si elle fuit.
      cle: !!getSettings(userId).passerelleCle
    };
  },

  /*
   * TOUT CE QUI EST ARRIVE, AVEC SES VALEURS.
   *
   * `GET /api/qs` sert la console de Reglages : elle repond « quelles series
   * existent, et est-ce que ca rentre ». Celle-ci repond a une autre question,
   * qui est celle de quelqu'un qui regarde SES donnees : « qu'est-ce qu'il y a
   * dedans ». D'ou les points eux-memes, et les digests d'activite tels
   * qu'envoyes.
   *
   * Les digests ne se lisaient que par la cle, c'est-a-dire depuis
   * l'application qui les envoie -- jamais depuis le site. Ils arrivaient donc
   * et n'etaient visibles nulle part.
   */
  'GET /api/qs/contenu': ({ query, userId }) => {
    const jours = Math.max(7, Math.min(365, Number(query?.jours) || 60));
    const fin = today();
    const debut = addDays(fin, -jours + 1);
    /*
     * LE JOUR REGARDE, ET PAS LE DERNIER RECU.
     *
     * Le bloc decrivait toujours la derniere journee arrivee, ou qu'on soit
     * dans le calendrier. Ouvert au 2 septembre, il annoncait « la derniere
     * journee recue · 1 sep » et affichait la nuit du 1er sous le titre du 2 :
     * a cote de « rien n'a ete dit ce jour-la », la page racontait deux
     * journees differentes en meme temps.
     *
     * On decrit donc LE jour demande. Quand rien n'est arrive ce jour-la, on le
     * dit -- c'est une information, pas un trou a combler avec la journee
     * d'a cote.
     */
    const jourVise = /^\d{4}-\d{2}-\d{2}$/.test(String(query?.jour ?? ''))
      ? String(query.jour) : fin;

    const par = new Map();
    for (const m of mesuresEntre(debut, fin, userId)) {
      const k = `${m.source} ${m.cle}`;
      if (!par.has(k)) par.set(k, { source: m.source, cle: m.cle, unite: m.unite ?? null, points: [] });
      par.get(k).points.push({ date: m.date, valeur: m.valeur, texte: m.texte });
    }
    /*
     * LES LIENS SONT CALCULES SUR TOUT L'HISTORIQUE, PAS SUR LA FENETRE.
     *
     * Une correlation demande vingt journees appariees au minimum. La calculer
     * sur les trente derniers jours la rendrait a la fois fragile et dependante
     * du reglage de la fenetre -- « je passe de 30 a 90 jours et un lien
     * apparait » est exactement ce qu'un lien ne doit pas faire. La fenetre
     * regle ce qu'on REGARDE, pas ce qu'on calcule.
     */
    const { liens: trouves } = liensDe(userId);

    const series = [...par.values()].map(s => {
      const v = s.points.map(p => p.valeur).filter(x => x != null);
      const tri = [...v].sort((a, b) => a - b);
      const med = tri.length
        ? (tri.length % 2 ? tri[(tri.length - 1) / 2] : (tri[tri.length / 2 - 1] + tri[tri.length / 2]) / 2)
        : null;
      // Le dernier point qui porte QUELQUE CHOSE : une série de texte
      // (« premiere_activite : 08:23 ») en a un, et « 08:23 » est ce qu'on veut
      // voir. Ne chercher que du numérique la laissait vide.
      const dernier = [...s.points].reverse().find(p => p.valeur != null || p.texte) ?? null;
      // Le lien du jour meme passe devant celui du lendemain, comme a cote de
      // la journee : deux vues du meme fait doivent dire la meme chose.
      const pour = trouves.filter(l => l.source === s.source && l.cle === s.cle)
                          .sort((a, b) => a.decalage - b.decalage);
      return {
        ...s,
        n: s.points.length,
        bas: v.length ? Math.min(...v) : null,
        haut: v.length ? Math.max(...v) : null,
        // La moyenne sert d'echelle au trace, pas de verite sur la personne.
        moyenne: v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null,
        /*
         * LA MEDIANE, ET PAS SEULEMENT LA MOYENNE. C'est elle qui sert de
         * repere sur la courbe et qui decide du COTE d'une valeur -- la meme
         * convention qu'a cote de la journee, pour que « au-dessus de » veuille
         * dire la meme chose aux deux endroits.
         */
        mediane: med == null ? null : Math.round(med * 100) / 100,
        /*
         * UN ROUAGE DE LA NUIT OU DE L'ARCHÉTYPE. Il a déjà été dit plus haut,
         * en phrase ; sa carte se replie plutôt que de répéter. Il ne disparaît
         * pas : une mesure arrivée a le droit d'être vue.
         */
        detail: estDetail(s.cle),
        // Pour une série de texte : combien de valeurs DIFFERENTES. Une seule
        // sur quarante jours dit que la mesure est constante, donc muette.
        distinctes: new Set(s.points.map(p => p.texte).filter(Boolean)).size,
        dernier,
        cote: med == null || dernier?.valeur == null ? null
          : dernier.valeur === med ? 'pile' : dernier.valeur > med ? 'haut' : 'bas',
        lien: pour[0] ?? null
      };
    }).sort((a, b) => b.n - a.n || a.cle.localeCompare(b.cle));

    /*
     * LA RECEPTION. « Quatre series » ne dit pas si l'application envoie
     * encore. Un branchement casse se voit ici, et nulle part ailleurs : le
     * dernier jour recu, et combien de jours sur la fenetre en portent.
     */
    const joursAvecMesure = new Set();
    for (const s of par.values()) for (const p of s.points) joursAvecMesure.add(p.date);
    const jourDActivite = new Set(activiteJours(userId, 400).map(j => j.date));
    const couverts = new Set([...joursAvecMesure, ...[...jourDActivite].filter(d => d >= debut && d <= fin)]);
    const dernierJour = couverts.size ? [...couverts].sort().at(-1) : null;

    return {
      depuis: debut, jusqu_au: fin, jours,
      series,
      reception: {
        couverts: couverts.size,
        attendus: jours,
        dernier: dernierJour,
        // Le silence en jours, plutot qu'une date a soustraire de tete.
        depuis_jours: dernierJour
          ? Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${dernierJour}T00:00:00Z`)) / 86400000)
          : null
      },
      // Le digest est garde tel quel en base : on le rend parse, pas reformate.
      // Sa forme appartient a l'application qui l'envoie, pas a ce site.
      /*
       * `activiteJours` REND DEJA LE DIGEST RELU. Le reparser le faisait
       * echouer sur un objet, et chaque journee ressortait « illisible » alors
       * qu'elles etaient toutes bonnes. On accepte quand meme la chaine, au
       * cas ou la base porte une ligne ecrite avant ce parsage.
       */
      /*
       * LA NUIT ET LA FORME DU JOUR, calculées sur la fenêtre regardée.
       *
       * Elles ne sortent pas d'une série de plus : elles répondent aux deux
       * questions qu'on se pose vraiment devant ces chiffres — « j'ai mal
       * dormi ? » et « ma journée est passée où ? ». Sur LE JOUR REGARDÉ, et
       * sur aucun autre.
       */
      ...(() => {
        const tous = [...par.values()].flatMap(s2 => s2.points.map(p => ({
          date: p.date, cle: s2.cle, valeur: p.valeur, texte: p.texte, unite: s2.unite
        })));
        const duJour = tous.filter(x => x.date === jourVise);
        const act = activiteDuJour(jourVise, userId);
        /*
         * `recu` DIT S'IL EST ARRIVE QUELQUE CHOSE, et il se calcule sur les
         * deux sources : la montre peut avoir envoyé sans Machi Tool, ou
         * l'inverse. Sans lui, une journée vide et une journée jamais reçue
         * s'affichent pareil — or l'une dit « tu n'as rien fait » et l'autre
         * « on ne sait pas », ce qui n'est pas du tout la même chose.
         */
        if (!duJour.length && !act) {
          return { jourLu: jourVise, recu: false,
                   nuit: null, archetype: null, usage: null, jour: null, jourActivite: null };
        }
        /*
         * `usage` PART AVEC L'ARCHETYPE, ET SORT DU MEME COMPTAGE.
         *
         * L'archetype nomme la forme de la journee en un mot ; l'usage dit de
         * quoi elle etait faite, famille par famille. Recalculer l'un des deux
         * ailleurs, plus tard, ferait deux comptages qui peuvent diverger -- et
         * une etiquette qui contredit ses propres chiffres est pire qu'une
         * etiquette seule. `jour` sort du meme comptage, pour la meme raison.
         */
        return { jourLu: jourVise, recu: true,
                 nuit: nuitDe(duJour, tous),
                 archetype: archetypeDe(duJour, tous), usage: usageDuJour(duJour),
                 // Les quelques chiffres qui font les puces : le temps d'écran,
                 // où il est passé, le rythme. Chacun avec son écart à SA normale.
                 jour: chiffresDuJour(duJour, tous),
                 /*
                  * LE DIGEST DU JOUR PART AVEC, RELU.
                  *
                  * `activite` n'en porte que soixante ; une journée plus
                  * ancienne serait ouverte sans rien à montrer alors que la
                  * base l'a. Une requête ciblée coûte une ligne et vaut pour
                  * toute la profondeur de l'historique.
                  */
                 jourActivite: act
                   ? { date: act.date, recu_le: act.recu_le, digest: act.digest,
                       lu: lireDigest(act.digest) }
                   : null };
      })(),

      /*
       * EST-CE QUE C'EST A JOUR ?
       *
       * `reception` répond « quels jours sont couverts » — c'est la DONNÉE.
       * Ici on répond « quand la machine a-t-elle parlé pour la dernière
       * fois », ce qui est la LIAISON, et les deux se cassent séparément : une
       * passerelle muette depuis deux jours laisse un historique parfaitement
       * couvert jusqu'à avant-hier. Sans cette ligne, une journée vide se lit
       * comme « je n'ai rien fait » alors qu'elle veut dire « rien n'est
       * arrivé ».
       */
      synchro: (() => {
        const ts = derniereSynchro(userId);
        return {
          recu_le: ts,
          // En minutes : l'écran choisit lui-même s'il dit « il y a 20 min »
          // ou « il y a deux jours ». Le serveur ne met pas en français une
          // durée dont il ne sait pas comment elle sera affichée.
          depuis_min: ts ? Math.max(0, Math.round((Date.now() - Date.parse(ts)) / 60000)) : null,
          dernierJour,
          // La version de l'application qui a parlé en dernier : c'est elle qui
          // dit si « demande déposée » a une chance d'être lue.
          version: versionMachiTool(userId)
        };
      })(),

      /*
       * CHAQUE JOUR PART AVEC SON RÉSUMÉ.
       *
       * La ligne qui referme un digest disait « 7 champs ». Sept champs de
       * quoi ? Elle dit maintenant ce qu'il y a dedans — combien d'écran, où
       * c'est passé, à quel rythme — et le brut reste derrière le clic, entier,
       * pour qui veut vérifier.
       */
      activite: activiteJours(userId, 60).map(j => {
        const duJour = mesuresDuJour(j.date, userId);
        const resume = resumeDuJour(duJour);
        /*
         * LE DIGEST PART LU, EN PLUS DE PARTIR BRUT.
         *
         * Brut, un vrai digest fait vingt lignes dont quatorze sont des titres
         * de pages : tout est la et rien ne se lit. `lu` dit la meme chose
         * regroupee -- les titres deviennent une ligne « navigateur, 14 pages,
         * les deux plus longues » -- et le brut reste, entier, pour verifier.
         */
        if (j.digest && typeof j.digest === 'object') {
          return { date: j.date, recu_le: j.recu_le, digest: j.digest, brut: null,
                   resume, lu: lireDigest(j.digest) };
        }
        let digest = null;
        try { digest = JSON.parse(j.digest); } catch { /* illisible : on le dira */ }
        return { date: j.date, recu_le: j.recu_le, digest, brut: digest ? null : String(j.digest),
                 resume, lu: lireDigest(digest) };
      })
    };
  },

  'POST /api/qs/oublier': ({ body, userId }) => {
    const { source, cle } = body ?? {};
    if (!source || !cle) return { error: 'source et clé requises' };
    // Une integration ratee doit pouvoir s'annuler. Sans ca, un premier essai
    // qui envoie des minutes la ou on voulait des heures pollue la serie pour
    // toujours, et la seule issue est d'en creer une deuxieme a cote.
    return { retirees: oublierMesure(source, cle, userId) };
  },

  'POST /api/qs/journal/vider': ({ userId }) => ({ vides: viderJournalQS(userId) }),

  /* ---------- le suivi : les séances, et le compte rendu ---------- */

  'GET /api/seances': ({ userId }) => ({ seances: allSeances(userId) }),

  'POST /api/seances': ({ body, userId }) => {
    const { id, date, praticien, apporter, supprimer } = body ?? {};
    if (supprimer && id) return { supprimee: deleteSeance(id, userId) };
    if (id) {
      const patch = {};
      for (const k of ['date', 'praticien', 'apporter']) if (k in (body ?? {})) patch[k] = body[k];
      if ('date' in patch && !/^\d{4}-\d{2}-\d{2}$/.test(String(patch.date))) return { error: 'date invalide' };
      const s = updateSeance(id, patch, userId);
      return s ? { seance: s } : { error: 'séance introuvable' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) return { error: 'date invalide' };
    return { seance: addSeance({ date, praticien, apporter, userId }) };
  },

  /*
   * LE COMPTE RENDU. Aucun appel a un modele -- voir l'en-tete de
   * server/compte-rendu.js pour les trois raisons. Ici, on se contente de
   * poser devant lui tout ce que la base sait, et il compte.
   *
   * L'intervalle se calcule AVANT d'aller chercher les motifs : ils se lisent
   * sur deux fenetres (celle-ci et la precedente, de meme longueur), et il faut
   * connaitre les bornes pour les demander.
   */
  /**
   * LE DOCUMENT D'UN RENDEZ-VOUS, EN UN SEUL APPEL.
   *
   * Deux frises, et elles ne répondent pas à la même question. La première va
   * de la naissance à aujourd'hui : c'est le CONTEXTE, les faits que la
   * personne a posés elle-même. La seconde tient sur trente jours et montre
   * ce qui s'est dit et ce qui s'est mesuré, jour par jour.
   *
   * TOUT EST DÉJÀ CALCULÉ AILLEURS, et c'est voulu : la frise vient de la même
   * route que l'écran, les nuits de `nuits()`, les signes de `veilleDuJour`.
   * Un document qui recalculerait ses chiffres à sa façon finirait par ne plus
   * dire la même chose que l'application dont il sort — et c'est le document
   * qu'on emporte, donc c'est lui qui aurait tort devant quelqu'un.
   */
  /**
   * RELIRE LES PASSAGES SIGNALÉS — le lot part, et on n'attend pas.
   *
   * Il ne juge que ce qui n'a pas encore de verdict : un jugement est payé, et
   * il ne changera pas tant que le passage ne change pas. Relancer sur un
   * journal déjà relu ne repose donc rien et ne coûte rien.
   */
  'POST /api/veille/juger': async ({ userId }) => {
    const s = getSettings(userId);
    if (s.veilleLot?.id) return { deja: true, lot: s.veilleLot };
    const dates = series(userId).rows.map(r => r.date);
    const aJuger = passagesSansVerdict(dates, userId);
    if (!aJuger.length) return { n: 0, message: 'Tous les passages signalés ont déjà été relus.' };
    const lot = await lancerLotVeille(aJuger, s);
    setSettings({ veilleLot: { id: lot.id, n: lot.n, le: Date.now() },
                  veilleLotErreur: null }, userId);
    return { n: lot.n, lot: lot.id, reste: aJuger.length >= MAX_PAR_LOT };
  },

  /** Où en est la relecture. Appelée en passant, jamais en boucle. */
  'GET /api/veille/jugement': async ({ userId }) => {
    const s = getSettings(userId);
    const comptes = comptesVerdicts(userId);
    if (!s.veilleLot?.id) return { enCours: false, comptes, sens: SENS_VERDICT,
                                   erreur: s.veilleLotErreur ?? null };
    try {
      const dates = new Map();
      for (const r of series(userId).rows)
        for (const m of messagesForDate(r.date, userId)) dates.set(m.id, r.date);
      const r = await releverLotVeille(s.veilleLot.id, s, { userId, dates });
      if (!r.pret) return { enCours: true, etat: r.etat, n: s.veilleLot.n, comptes, sens: SENS_VERDICT };
      setSettings({ veilleLot: null }, userId);
      invalidate(userId);
      return { enCours: false, poses: r.poses, illisibles: r.illisibles,
               comptes: comptesVerdicts(userId), sens: SENS_VERDICT };
    } catch (err) {
      // Même règle que pour la lecture : on ne jette le lot que s'il est
      // vraiment fini. Une coupure de trois secondes perdrait un lot déjà payé.
      if (err?.lotFini) setSettings({ veilleLot: null,
        veilleLotErreur: String(err.message).slice(0, 200) }, userId);
      return { enCours: !err?.lotFini, erreur: String(err.message).slice(0, 200), comptes };
    }
  },

  /**
   * LA FRISE ET L'ANNÉE, EN UN FICHIER QU'ON PEUT DONNER À LIRE.
   *
   * Pour itérer sur le dessin avec de vraies données : une frise se règle sur
   * un vrai parcours, pas sur sept repères inventés qui tombent tous bien.
   *
   * `phrases=0` REMPLACE CHAQUE CITATION PAR SA LONGUEUR. C'est la version qui
   * suffit à travailler la mise en page — ce qui compte pour un dessin, c'est
   * combien de signes une ligne doit porter, pas ce qu'elle raconte. Elle
   * existe pour qu'on n'ait pas à choisir entre « aider quelqu'un à régler son
   * écran » et « lui donner son journal à lire ».
   */
  'GET /api/export/frise': ({ query, userId }) => {
    const jours = Math.max(7, Math.min(400, parseInt(query?.jours ?? '30', 10) || 30));
    const phrases = query?.phrases === '1';
    const rdv = routes['GET /api/rendez-vous']({ query: { jours: String(jours) }, userId });
    const muet = t => t == null ? null : (phrases ? t : `«${String(t).length} signes»`);
    return {
      genere_le: today(),
      avec_phrases: phrases,
      frise: rdv.frise,
      comptes: rdv.comptes,
      derniers: rdv.derniers.map(j => ({
        ...j,
        signes: j.signes.map(x => ({ ...x, extrait: muet(x.extrait) })),
        evoques: j.evoques.map(x => ({ ...x, extrait: muet(x.extrait) }))
      })),
      // La grille de l'année : c'est elle qui donne la densité réelle du
      // journal, et donc à quoi ressemble une frise qui n'est pas remplie.
      annee: series(userId).rows.map(r => ({ date: r.date, note: r.note ?? null,
                                             ecrit: !!(r.text && r.text.trim()) }))
    };
  },

  'GET /api/rendez-vous': ({ query, userId }) => {
    const jours = Math.max(7, Math.min(120, parseInt(query?.jours ?? '30', 10) || 30));
    const { byDate } = series(userId);
    const notes = new Map([...byDate].map(([d, x]) => [d, x?.note ?? null]));
    const derniers = joursDuRendezVous(userId, { jours, notes });
    return {
      fait_le: today(),
      jours,
      frise: routes['GET /api/frise']({ userId }),
      derniers,
      comptes: comptesDuRendezVous(derniers)
    };
  },

  'GET /api/compte-rendu': ({ query, userId }) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(query?.date ?? '')) ? query.date : today();
    const entries = allEntries(userId);
    const seances = allSeances(userId);
    const iv = intervalle(seances, date, entries[0]?.date ?? null);

    const avantFin = iv.precedente ? addDays(iv.debut, -1) : null;
    const avantDebut = avantFin ? addDays(avantFin, -(iv.jours - 1)) : null;

    return {
      date,
      rendu: compteRendu({
        entries, seances,
        events: allEvents(userId),
        ancres: allAnchors(userId),
        motifs: motifsEntre(iv.debut, iv.fin, userId),
        motifsAvant: avantDebut ? motifsEntre(avantDebut, avantFin, userId) : [],
        amplitudes: amplitudes(userId)
      }, date)
    };
  },

  /*
   * LES FONCTIONNEMENTS : comment ça marche chez cette personne, en comptant.
   * Aucun modèle, aucune clé : tout se calcule ici, sur ce que la base tient
   * (notes, nuits, coucher, écran, mots absolus, mesures). C'est la carte
   * qu'un banc d'essai a jugée la plus juste ; voir server/fonctionnements.js.
   */
  /**
   * LES NUITS D'UNE PÉRIODE : coucher, lever, durée, et ce qui ne colle pas.
   * Lues dans l'activité du poste (server/nuits.js), le dit passant devant.
   */
  /*
   * RANGER TOUT LE JOURNAL SUR LES JOURNÉES VÉCUES.
   *
   * Une journée ne commence pas à minuit : elle commence au lever et finit au
   * coucher, souvent bien après minuit. Pendant des mois, aucune nuit n'est
   * arrivée (Machi Tool les calculait pour le mauvais jour), donc rien n'a
   * jamais été rangé : des soirées entières sont restées sur le lendemain.
   * Les nuits se relisent maintenant dans ce qui était déjà stocké — c'est ce
   * bouton qui reprend le journal entier, du premier jour au dernier.
   */
  'POST /api/nuits/ranger': ({ userId }) => rangerToutLeJournal(userId),

  'GET /api/nuits': ({ query, userId }) => {
    const jours = Math.max(7, Math.min(730, parseInt(query.jours ?? '90', 10) || 90));
    return { jours, nuits: nuits(userId, { jours }) };
  },

  'GET /api/fonctionnements': ({ query, userId }) => {
    const jours = Math.max(60, Math.min(730, parseInt(query.jours ?? '180', 10) || 180));
    return fonctionnements(userId, { jours });
  },

  /*
   * CE QUI A DE LA PRISE.
   *
   * La carte de la lecture entre dans le calcul : c'est elle qui donne « ce qui
   * vient avant ». Sans clé, sans lecture, la route répond quand même — les
   * comptages, les séries et les signes ne demandent que le journal ; seul le
   * déclencheur manque, et il manque en silence plutôt que de tout retenir.
   */
  'GET /api/prises': ({ userId }) => prisesDe(userId),

  /*
   * TU RÉPONDS TOI-MÊME À LA QUESTION QU'IL VIENT DE POSER.
   *
   * Le compagnon estimait déjà où quelqu'un SEMBLE être (`relever_humeur`).
   * Ceci est l'autre moitié : ce que la personne dit d'elle, en un geste,
   * quand il demande « où tu en es ». Le relevé garde sa source, parce que les
   * deux n'ont pas été posés par le même juge — et c'est ce qui permet, plus
   * tard, de ne jamais présenter l'un pour l'autre.
   *
   * On refuse un relevé qui n'est pas une réponse à une vraie question : sans
   * ce garde-fou, n'importe quel appel poserait un chiffre sur n'importe quel
   * message, et l'amplitude de la journée compterait des points qui ne veulent
   * rien dire.
   */
  'POST /api/releve': ({ body, userId }) => {
    const id = Number(body?.messageId);
    const v = Number(body?.valeur);
    if (!Number.isFinite(id) || !Number.isFinite(v)) return { erreur: 'il manque le message ou la valeur' };
    const fil = recentMessages(80, userId);
    const m = fil.find(x => Number(x.id) === id);
    if (!m) return { erreur: 'ce message n’est plus dans le fil' };
    const dernierDuCompagnon = [...fil].reverse().find(x => x.role === 'assistant');
    const repondus = new Set(relevesDeToi(fil.map(x => x.id), userId).map(r => Number(r.message_id)));
    if (!proposerLechelle(m, { dernier: Number(dernierDuCompagnon?.id) === id, repondus }))
      return { erreur: 'ce message ne demande pas où tu en es' };
    const r = addReleve({ messageId: id, date: jourVecu(userId), valeur: v,
                          quoi: String(m.text).trim().slice(0, 160), source: 'toi', userId });
    if (!r) return { erreur: 'valeur illisible' };
    invalidate(userId);
    return { ok: true, releve: r };
  },

  'GET /api/lecture': async ({ userId }) => {
    /*
     * ON RELEVE LE LOT EN PASSANT.
     *
     * Pas de `setInterval` qui interroge l'API toute la nuit : il couterait
     * plus d'appels que la lecture elle-meme n'en fait. On regarde quand
     * quelqu'un ouvre « Ma carte » -- c'est-a-dire exactement quand le resultat
     * sert a quelque chose.
     */
    await releverLecture(userId);
    const { rows } = series(userId);
    const ecrites = rows.filter(r => r.text && r.text.trim());
    const dernier = ecrites.at(-1)?.date ?? null;
    const l = getLecture(userId);
    /*
     * Le RETARD : combien de journees ecrites depuis la derniere que la lecture
     * a vue. C'est ce qui decide de relancer toute seule, et pas le simple fait
     * qu'une journee ait ete ajoutee -- ecrire tous les soirs declencherait
     * alors une relecture complete du corpus tous les soirs, pour un theme qui
     * n'aura pas bouge d'un cheveu.
     *
     * Le seuil ne suit plus une fenetre : il n'y en a plus qu'une, tout le
     * journal. Sept journees ecrites de plus, c'est le moment ou une nouvelle
     * lecture a une chance de dire autre chose -- en dessous, on paierait un
     * appel pour retrouver les memes themes.
     */
    /*
     * Le retard compte les journees ecrites ET les notes apportees depuis.
     *
     * Coller trois ans de carnet est l'evenement qui change le plus une carte,
     * et c'est exactement celui qui ne comptait pas : une note rangee n'est pas
     * une journee (c'est tout l'invariant du carnet), donc elle ne bougeait pas
     * le retard, donc la carte restait celle d'avant.
     *
     * Elles se comptent par leur date d'APPORT, pas par le jour dont elles
     * parlent : un souvenir de 1998 apporte ce soir est nouveau ce soir.
     */
    const notes = carnetRecent(l?.fait_le, userId);
    const retard = (l?.jusqu_au
      ? ecrites.filter(r => r.date > l.jusqu_au).length
      : ecrites.length) + notes;
    const SEUIL = 7;
    const refonte = lectureARefondre(userId);
    return {
      // La façon de lire a changé depuis cette lecture : elle est à refaire, en entier.
      refonte,
      version: l?.contenu?.version ?? null,
      // Une lecture faite avant la bascule vers « tout le journal » : elle
      // s'affiche, mais elle est perimee par construction.
      ancienne: !!l?.ancienne,
      /*
       * LES MOTIFS PROMUS SONT POSÉS SUR LA CARTE ICI, AU RENDU.
       *
       * Pas en base : la lecture stockée reste ce que le modèle a écrit. Un
       * nœud promu apparaît quand la carte part vers l'écran et disparaît si la
       * personne revient en arrière — donc une relecture ne l'efface pas, et
       * une promotion ne salit pas la lecture. Les deux objets gardent leur
       * nature, ce qui est la seule raison pour laquelle cette fonctionnalité
       * n'est pas « tous les motifs deviennent des nœuds » avec des étapes.
       *
       * L'injection passe AVANT `decorerCarte` : le nœud promu reçoit alors ses
       * journées décorées et ses extraits comme n'importe quel autre, et
       * `sensDesLiens` recompte ses flèches avec la même règle que celles du
       * modèle. Un traitement à part se verrait, et se verrait comme un
       * privilège.
       */
      lecture: l?.contenu
        ? decorerCarte(
            l.contenu.carte
              ? { ...l.contenu, carte: injecterPromus(l.contenu.carte, etatDesMotifs(userId, l.contenu.carte)) }
              : l.contenu,
            series(userId).byDate, textesParJour(userId))
        : null,
      fait_le: l?.fait_le ?? null,
      jours: l?.jours ?? 0,
      modele: l?.modele ?? null,
      // Assez de matiere pour que la question ait un sens ?
      possible: ecrites.length >= LECTURE_MIN,
      minimum: LECTURE_MIN,
      ecrites: ecrites.length,
      retard,
      notes,
      perime: !!l && retard > 0,
      // Ce qui declenche une relecture sans qu'on la demande.
      /*
       * ET PAS PENDANT QU'UN LOT EST EN VOL. Le garde vaut aussi -- surtout --
       * quand il n'y a AUCUNE lecture : c'est le cas ou `arelire` est vrai
       * quoi qu'il arrive, donc celui ou la relance automatique repartirait a
       * chaque ouverture de la page sur un lot deja parti.
       */
      arelire: (!l || retard >= SEUIL || refonte) && !getSettings(userId).lectureLot,
      /*
       * UN LOT EN COURS SE DIT. Sans ca, l'ecran affiche « relire » pendant
       * qu'une lecture est deja partie, et cliquer en lancerait une deuxieme
       * -- payante, sur le meme corpus, pour le meme resultat.
       */
      enLot: !!getSettings(userId).lectureLot,
      lotErreur: getSettings(userId).lectureLotErreur || null,
      /*
       * CE QU'IL RESTE A ATTENDRE AVANT DE POUVOIR RETISSER.
       *
       * En millisecondes, et pas un booleen : « pas maintenant » est une porte
       * fermee sans explication. « dans 4 h 20 » est une porte fermee dont on
       * connait l'heure d'ouverture, et ce n'est pas la meme chose a vivre.
       */
      retissage: attenteRetissage(userId),
      cle: resolveKey(getSettings(userId)).source !== 'none'
    };
  },

  'POST /api/lecture': async ({ body, userId }) => {
    const s = getSettings(userId);
    const { rows, carnet } = series(userId);
    const ecrites = rows.filter(r => r.text && r.text.trim());
    if (ecrites.length < LECTURE_MIN) {
      return { error: `Il faut au moins ${LECTURE_MIN} journées écrites pour que ça veuille dire quelque chose.` };
    }
    /*
     * EN ENTIER quand on le demande (« relire tout »), ou quand la façon de lire
     * a changé depuis la dernière lecture : c'est la relecture qui refait les
     * schémas sur tout le journal, pas sur les cinquante journées les plus
     * denses. Le reste du temps, l'échantillon suffit et coûte dix fois moins.
     */
    const complet = !!body?.complet || lectureARefondre(userId);
    const corpus = corpusDuJournal(userId, rows, carnet, { complet });
    if (!corpus.dates.size) {
      return { error: "Rien d'écrit dans ton journal — il n'y a rien à lire." };
    }
    /*
     * EN LOT QUAND PERSONNE N'ATTEND, DIRECT QUAND QUELQU'UN ATTEND.
     *
     * `fond: true` est mis par la relance automatique : elle part toute seule
     * quand le retard atteint le seuil, l'ecran garde la lecture precedente
     * affichee, et personne ne regarde. Le lot rend en une heure au lieu de deux
     * minutes et facture la moitie -- c'est exactement l'echange qu'on veut.
     *
     * Le bouton « relire » n'envoie pas `fond` : quelqu'un vient de cliquer, il
     * attend une reponse, et lui faire attendre une heure pour economiser trente
     * centimes serait un mauvais echange.
     */
    if (body?.fond && s.lectureEnLot !== false) {
      if (s.lectureLot?.id) return { error: 'Une lecture est déjà partie.' };
      try {
        const lot = await lancerLot(corpus, s);
        setSettings({ lectureLot: { id: lot.id, depuis: new Date().toISOString(), complet },
                      lectureLotErreur: null }, userId);
      } catch (err) { return { error: String(err?.message ?? err).slice(0, 300) }; }
      // Pas de lecture a rendre : celle d'avant reste a l'ecran, et `enLot` dit
      // pourquoi le bouton ne repond plus.
      return { enLot: true, ...(await routes['GET /api/lecture']({ userId })) };
    }

    let r;
    try { r = await lire(corpus, s); }
    catch (err) { return { error: String(err?.message ?? err).slice(0, 300) }; }
    recordUsage(userId, r.modele, r.usage.input, r.usage.output, r.usage.cacheLu, r.usage.cacheEcrit, 'carte');
    const l = setLecture({
      contenu: r.lecture, jusqu_au: ecrites.at(-1)?.date ?? null,
      jours: corpus.jours, modele: r.modele, userId
    });
    if (l?.refusee) return { error: "Le modèle n'a rien rendu cette fois — ta carte précédente est gardée telle quelle. Réessaie." };
    return { ancienne: false,
             lecture: decorerCarte(l.contenu, series(userId).byDate, textesParJour(userId)),
             fait_le: l.fait_le, jours: l.jours,
             modele: l.modele, possible: true, perime: false, retard: 0,
             arelire: false, cle: true, usage: usageFor(userId) };
  },

  /*
   * REMBOBINER : revenir a un message et repartir de la.
   *
   * On rend le texte du message vise pour que l'interface le remette dans le
   * composeur. Rien n'est perdu en silence : ce qui disparait de la base
   * reapparait dans le champ ou on ecrit, et c'est la personne qui decide de le
   * renvoyer ou non.
   *
   * `invalidate` n'est pas facultatif : la serie, l'index de recherche et le
   * compte des journees ecrites sont en cache, et le rembobinage vient de
   * changer le texte d'une journee. Sans lui, l'ecran suivant montrerait des
   * chiffres calcules sur une phrase qui n'existe plus.
   */
  'POST /api/message/rembobiner': ({ body, userId }) => {
    const id = Number(body?.id);
    if (!Number.isInteger(id)) return { error: 'identifiant de message manquant' };
    const r = rembobiner(id, userId);
    if (!r) return { error: "Ce message n'existe plus." };
    invalidate(userId);
    return { ...r, messages: recentMessages(80, userId), motifs: motifsDuFil(userId) };
  },

  'GET /api/objectifs': ({ userId }) => ({ objectifs: allObjectifs(userId) }),

  /**
   * Retirer un objectif. C'est le compagnon qui les enregistre, mais c'est la
   * personne qui decide de ce qu'elle s'engage a tenir -- sans quoi une
   * resolution prise un soir la suit pour de bon.
   */
  'POST /api/objectifs': ({ body, userId }) => {
    if (body.delete) deleteObjectif(Number(body.delete), userId);
    return { objectifs: allObjectifs(userId) };
  },

  'GET /api/motifs': ({ userId }) => motifsDuFil(userId),

  /**
   * OÙ EN EST CHAQUE MOTIF, ET CE QUI LUI MANQUE POUR MONTER.
   *
   * `manque` part avec l'état, toujours : un seuil qu'on ne peut pas voir est
   * un seuil qu'on ne peut pas contester, et celui-ci sera contesté — c'est un
   * chiffre choisi, pas une loi.
   */
  'GET /api/promotion': ({ userId }) => {
    const carte = getLecture(userId)?.contenu?.carte ?? null;
    return {
      seuils: SEUILS_PROMOTION,
      // Sans carte, aucun motif ne peut s'ancrer : l'écran doit le dire plutôt
      // que d'afficher onze mécanismes qui « n'ont pas assez de liens ».
      carte: carte?.noeuds?.length ?? 0,
      motifs: etatDesMotifs(userId, carte),
    };
  },

  /**
   * MONTER, ÉCARTER, REVENIR EN ARRIÈRE.
   *
   * Trois gestes et pas deux. Sans le troisième, un « non » cliqué par erreur
   * serait définitif et un « oui » regretté resterait sur la carte — or c'est
   * précisément le geste qui sépare une lecture collaborative d'un verdict.
   */
  'POST /api/promotion': ({ body, userId }) => {
    const id = Number(body?.id);
    if (!Number.isInteger(id)) return { error: 'Quel motif ?' };
    const oui = body.oui === true ? true : body.oui === false ? false : null;
    /*
     * ON NE MONTE QUE CE QUI EST PROPOSABLE. La route est le seul chemin, et
     * un client (ou un onglet resté ouvert depuis avant que le compte change)
     * pourrait sinon promouvoir un motif à trois journées. Écarter et revenir
     * en arrière restent permis dans tous les cas : ce sont des retraits.
     */
    if (oui === true) {
      const e = etatDesMotifs(userId).find(x => x.id === id);
      if (!e) return { error: `Aucun motif #${id}.` };
      if (e.etat !== 'proposable' && e.etat !== 'ecarte') {
        return { error: 'Ce motif ne remplit pas encore les conditions.', manque: e.manque };
      }
      if (e.etat === 'ecarte' && e.manque.length) {
        return { error: 'Ce motif ne remplit plus les conditions.', manque: e.manque };
      }
    }
    const r = promouvoirMotif(id, oui, userId);
    if (!r.ok) return { error: `Aucun motif #${id}.` };
    const carte = getLecture(userId)?.contenu?.carte ?? null;
    return { seuils: SEUILS_PROMOTION, carte: carte?.noeuds?.length ?? 0,
             motifs: etatDesMotifs(userId, carte) };
  },

  /**
   * Retirer un motif. C'est le compagnon qui les cree, mais c'est la personne
   * qui decide de ce qui est suivi chez elle -- sans quoi une observation posee
   * de travers s'installe pour de bon.
   */
  'POST /api/motifs': ({ body, userId }) => {
    if (body.delete) deleteMotif(Number(body.delete), userId);
    if (body.teinte) teinterMotif(Number(body.id), Number(body.teinte), userId);
    return motifsDuFil(userId);
  },
  'POST /api/events': ({ body, userId }) => {
    if (body.delete) { deleteEvent(Number(body.delete), userId); return reperes(userId); }
    if (!body.date || !body.label) return { error: 'date et label requis' };
    if (!ISO_JOUR.test(String(body.date))) return { error: 'Date invalide : il faut AAAA-MM-JJ.' };
    // `fin` accepte ici, et c'est ce qui rend une periode possible : la colonne
    // existait, l'affectation en voies etait ecrite et testee, et aucun chemin
    // ne pouvait en creer une.
    const fin = body.fin ? String(body.fin) : null;
    if (fin && !ISO_JOUR.test(fin)) return { error: 'Fin invalide : il faut AAAA-MM-JJ.' };
    if (fin && fin < body.date) return { error: 'La fin est avant le début.' };
    // Validation en code, jamais dans une consigne : la teinte doit venir de la
    // table declaree, sinon la separation avec la rampe des notes ne tient plus.
    const teinte = body.teinte == null ? null : Number(body.teinte);
    if (teinte !== null && !TEINTES.includes(teinte)) return { error: 'Teinte inconnue.' };

    const champs = {
      date: String(body.date), fin, label: String(body.label).slice(0, 120),
      theme: body.theme ?? null, teinte, fort: body.fort ? 1 : 0,
      ouvert: body.ouvert ? 1 : 0
    };
    /*
     * MODIFIER, ET PAS SEULEMENT POSER.
     *
     * Sans ce chemin, corriger une date se faisait en supprimant le repere et
     * en le reposant -- sur le fait le plus lourd d'une frise, avec un bouton
     * « × » comme premiere etape. updateEvent filtre deja sur user_id : un
     * identifiant devine ne suffit pas.
     */
    if (body.id) {
      if (!updateEvent(Number(body.id), champs, userId)) return { error: 'Repère introuvable.' };
    } else {
      addEvent({ ...champs, userId });
    }
    return reperes(userId);
  },

  'POST /api/settings': ({ body, userId }) => {
    // Une chaine vide ne doit pas effacer la cle par accident : le champ est
    // vide dans l'interface puisqu'on ne la renvoie jamais. L'effacement est
    // une action explicite.
    const patch = { ...body };
    if (patch.apiKey === '' && !body.clearKey) delete patch.apiKey;

    // setSettings ne verifie que l'existence de la cle, jamais la forme. Une
    // naissance dans le futur etire la frise de plusieurs annees sur du vide ;
    // une naissance posterieure a la premiere journee ecrite la ferait
    // commencer apres son propre journal.
    if (patch.naissance !== undefined && patch.naissance !== null && patch.naissance !== '') {
      const n = String(patch.naissance);
      const { series: ser } = series(userId);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(n) || n < '1900-01-01') {
        return { error: 'Date de naissance invalide.' };
      }
      if (n > today()) return { error: "Cette date est dans le futur." };
      if (ser.length && n > ser[0].date) {
        return { error: `Ta première journée écrite est le ${ser[0].date} : la naissance ne peut pas être après.` };
      }
    }
    if (patch.naissance === '') patch.naissance = null;
    if (body.clearKey) patch.apiKey = '';
    delete patch.clearKey;
    return { settings: publicSettings(setSettings(patch, userId)) };
  },

  'POST /api/anchors': ({ body, userId }) => {
    if (body.note === undefined) return { error: 'note requise' };
    setAnchor(Number(body.note), String(body.label ?? ''), String(body.descr ?? ''), userId);
    return { anchors: allAnchors(userId) };
  },

  /** Les donnees appartiennent a l'utilisateur, et il doit pouvoir partir avec. */
  'GET /api/export': ({ userId }) => ({
    exportedAt: new Date().toISOString(),
    entries: allEntries(userId),
    events: allEvents(userId),
    anchors: allAnchors(userId),
    messages: db.prepare('SELECT id, ts, date, source, role, text FROM messages WHERE user_id = ? ORDER BY ts').all(userId)
  }),

  /** La jauge de jetons : ce qu'il reste ce mois-ci, et ce que ça a coûté. */
  'GET /api/usage': ({ userId }) => usageFor(userId),
};


/**
 * Envoi d'un message avec reponse streamee.
 *
 * `send(event, data)` ecrit un evenement SSE. Sequence :
 *   user  -> le message de l'utilisateur est enregistre
 *   delta -> fragments de texte, au fil de la generation
 *   done  -> message complet enregistre, etat du backend
 */
/**
 * Ce qui a change de place.
 *
 * DEUX FRACTIONS posees cote a cote, jamais une tendance. « augmente »,
 * « progresse », « s'ameliore » sont des verbes de trajectoire, et une
 * trajectoire est deja une these sur quelqu'un. On rend les deux proportions
 * avec leurs denominateurs, on classe par leur ecart, et on s'arrete la.
 */
function deplacements(rows, anchors, carnet, t) {
  const recent = buildGraph(rows, anchors, { since: addDays(t, -90), carnet });
  if (!recent.assez) return [];
  const tout = buildGraph(rows, anchors, { carnet });
  if (!tout.assez) return [];

  const parMot = new Map(tout.noeuds.map(n => [n.mot, n]));
  return recent.noeuds
    .filter(n => parMot.has(n.mot))
    .map(n => {
      const g = parMot.get(n.mot);
      return {
        mot: n.mot,
        recentJours: n.jours, recentSur: recent.jours,
        toutJours: g.jours, toutSur: tout.jours,
        // Ce nombre ne s'affiche pas : il ne sert qu'a classer.
        ecart: (n.jours / recent.jours) - (g.jours / tout.jours)
      };
    })
    .sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart))
    .slice(0, 8);
}

/**
 * Les reperes d'une journee, plus le voisinage.
 *
 * Le repere exact du jour est rare -- il y en a peut-etre quinze sur quatre
 * ans. N'afficher que celui-la laisserait le bloc vide 99 % du temps, donc
 * invisible. Le dernier repere pose AVANT ce jour, lui, existe toujours, et
 * c'est lui qui repond a la question qu'on se pose vraiment en rouvrant une
 * vieille journee : « j'en etais ou, a ce moment-la ? »
 */
const ISO_JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Les notes apportees depuis un instant donne, par leur date d'apport. */
const carnetRecent = (depuis, userId) =>
  depuis ? allCarnet(userId).filter(c => c.cree_le > depuis).length : allCarnet(userId).length;

/**
 * Les reperes, decores de leur theme.
 *
 * `e.theme ?? themeDe(e.label)`, et jamais `themeDe(e.label)` seul : la colonne
 * dit « NULL = deduit du libelle », donc une valeur presente est un CHOIX. La
 * liste ecrasait ce choix a chaque lecture -- on pouvait changer l'icone d'un
 * repere, le serveur l'enregistrait, et il revenait a l'icone du libelle au
 * rechargement suivant, sans que rien ne le signale.
 */
export const reperes = userId => ({
  events: allEvents(userId).map(e => ({ ...e, theme: e.theme ?? themeDe(e.label) }))
});

function reperesDuJour(date, userId) {
  const tous = allEvents(userId);
  const decore = e => ({ ...e, theme: e.theme ?? themeDe(e.label) });
  const avant = tous.filter(e => e.date < date).slice(-1)[0] ?? null;
  return {
    jour: tous.filter(e => e.date === date).map(decore),
    avant: avant ? { ...decore(avant), jours: joursEntre(avant.date, date) } : null
  };
}

const joursEntre = (a, b) =>
  Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

/*
 * LES PIECES JOINTES D'UN MESSAGE.
 *
 * Elles valent pour CE tour : le fil garde la mention du fichier, le binaire
 * ne touche jamais la base. Voir l'en-tete de blocsDePiece() dans chat.js --
 * ce qui compte dans un compte rendu se range en note, en texte, et c'est la
 * qu'il sert ensuite.
 *
 * Les fichiers TEXTE (.md, .txt, .csv...) ne passent pas par ici : le
 * navigateur les lit et les colle dans le message. Ils sont donc enregistres
 * avec lui, comme tout ce qu'on ecrit.
 */
const PIECES_MAX = 5;
const PIECE_OCTETS = 8 * 1024 * 1024;

function piecesDe(body) {
  const out = [];
  for (const p of (Array.isArray(body?.pieces) ? body.pieces : []).slice(0, PIECES_MAX)) {
    const donnees = String(p?.donnees ?? '');
    // La taille est verifiee ICI et pas seulement dans le navigateur : le
    // client peut mentir, et un PDF de cent mega fait tomber la requete
    // entiere -- avec le message qu'on venait d'ecrire.
    if (!donnees || donnees.length * 0.75 > PIECE_OCTETS) continue;
    out.push({ nom: String(p?.nom ?? 'pièce jointe').slice(0, 120),
               media: String(p?.media ?? ''), donnees });
  }
  return out;
}

/* ==========================================================================
   RETISSER LA TOILE.

   « Relire » existait deja : un bouton, deux minutes de sablier, une carte qui
   apparait d'un coup. Ce qui se passe entre les deux est pourtant ce qui a le
   plus de valeur -- tout le journal est relu, tous les motifs sont repasses, et
   la toile se refait. Le cacher derriere un sablier, c'est jeter la seule chose
   que cette application fait de spectaculaire.

   Retisser, c'est le meme travail, MONTRE. Le serveur dit ce qu'il rassemble,
   puis combien le modele a ecrit, puis rend la carte ; l'ecran la tisse pour de
   bon -- la simulation tourne a l'image, ce ne sont pas des decorations.

   DEUX FOIS PAR JOUR. Ce n'est pas une limite de cout, meme si ca en est une :
   une lecture de fond coute entre dix-huit et soixante centimes. C'est que
   RIEN NE CHANGE en une heure. Une toile qu'on peut refaire a volonte devient
   un bouton qu'on presse en attendant qu'il dise autre chose, et une lecture
   qu'on rejoue jusqu'a ce qu'elle plaise n'est plus une lecture.
   ========================================================================== */

/**
 * ZÉRO — LE REFROIDISSEMENT EST LEVÉ, POUR L'INSTANT.
 *
 * Il valait douze heures, et la raison tenait : rien ne change en une heure,
 * une toile qu'on peut refaire à volonté devient un bouton qu'on presse en
 * attendant qu'il dise autre chose. Le produit est encore en construction et
 * il faut pouvoir retisser en boucle pour regarder ce que ça donne : la
 * mécanique reste entière, seul le délai passe à zéro, et le remettre est une
 * ligne.
 *
 * Ce qui a changé entre-temps et rend la levée moins chère : la lecture porte
 * maintenant un cache de prefixe. Deux retissages du même journal à quelques
 * minutes d'intervalle relisent quatre-vingt mille jetons à un dixième du
 * prix — c'est-à-dire exactement le geste que ce délai empêchait.
 */
export const RETISSAGE_ATTENTE = 0;

/**
 * Ce qu'il reste à attendre, en millisecondes. 0 quand c'est possible.
 * Lu depuis les réglages : le champ n'est écrit QUE par un retissage manuel
 * réussi — ni la relecture de fond ni un échec ne consomment le tour.
 */
export function attenteRetissage(userId = OWNER) {
  const q = getSettings(userId).dernierRetissage;
  if (!q) return 0;
  const t = Date.parse(q);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, RETISSAGE_ATTENTE - (Date.now() - t));
}

/**
 * Le retissage, en flux.
 *
 * Les evenements disent CE QUI SE PASSE, jamais un pourcentage : on ne sait pas
 * combien de temps le modele va prendre, et une barre qui avance vers une fin
 * inventee est un mensonge de plus a chaque seconde.
 */
export async function retisser(body, send, userId = OWNER) {
  const attente = attenteRetissage(userId);
  if (attente > 0) {
    send('refus', { attente, raison: 'Tu as déjà retissé récemment.' });
    return;
  }

  const s = getSettings(userId);
  const { rows, carnet } = series(userId);
  const ecrites = rows.filter(r => r.text && r.text.trim());
  if (ecrites.length < LECTURE_MIN) {
    send('erreur', { error: `Il faut au moins ${LECTURE_MIN} journées écrites pour que ça veuille dire quelque chose.` });
    return;
  }

  const corpus = corpusDuJournal(userId, rows, carnet, { complet: !!body?.complet || lectureARefondre(userId) });
  if (!corpus.dates.size) {
    send('erreur', { error: "Rien d'écrit dans ton journal — il n'y a rien à lire." });
    return;
  }

  /*
   * CE QU'ON RASSEMBLE, EN CHIFFRES REELS.
   *
   * L'ecran en fait une lueur par journee. Ce ne sont pas des particules
   * decoratives : il y a exactement autant de points que de journees relues, et
   * c'est ce qui fait que regarder ca veut dire quelque chose.
   */
  /*
   * CHAQUE JOURNEE PART AVEC SON ECART.
   *
   * L'ecran en fait une lueur, et l'ecart en fait sa COULEUR : la meme rampe
   * que la grille, que la journee, que les points d'un noeud. Sans lui, on
   * regarde une pluie de points identiques ; avec, on regarde ses annees
   * s'allumer dans les couleurs qu'elles ont vraiment eues.
   */
  const { byDate } = series(userId);
  send('corpus', {
    journees: rows.length,
    ecrites: ecrites.length,
    jours: [...corpus.dates].sort().map(d => ({ d, e: byDate.get(d)?.delta ?? null })),
    reperes: allEvents(userId).length,
    motifs: allMotifs(userId).length,
    carnet: carnet.length,
    depuis: rows[0]?.date ?? null,
    jusqu_au: ecrites.at(-1)?.date ?? null
  });

  let r;
  try {
    /*
     * DEUX RYTHMES, PARCE QUE CE SONT DEUX CHOSES.
     *
     * Une TROUVAILLE part tout de suite : c'est un nom que le modele vient
     * d'ecrire, et l'attendre pour l'annoncer avec le compteur suivant le
     * ferait arriver apres coup. Le compteur, lui, se calme -- le modele rend
     * des centaines de fragments par seconde, et autant d'ecritures SSE
     * encombreraient le tuyau pour un chiffre qui ne se lit pas si vite.
     */
    let dernier = 0;
    r = await lireEnFlux(corpus, s, ({ signes, pense, trouves, pourcent, comptes }) => {
      for (const t of trouves ?? []) send('trouve', { ...t, pourcent });
      if (signes - dernier < 400) return;
      dernier = signes;
      send('lit', { signes, pense, pourcent, comptes });
    });
  } catch (err) {
    send('erreur', { error: String(err?.message ?? err).slice(0, 300) });
    return;
  }

  recordUsage(userId, r.modele, r.usage.input, r.usage.output, r.usage.cacheLu, r.usage.cacheEcrit, 'carte');
  const l = setLecture({
    contenu: r.lecture, jusqu_au: ecrites.at(-1)?.date ?? null,
    jours: corpus.jours, modele: r.modele, userId
  });
  /*
   * UNE LECTURE VIDE NE REMPLACE PAS CELLE D'AVANT (voir `setLecture`), et
   * l'écran doit l'apprendre autrement que par un « 0 choses, 0 liens ». On
   * envoie une erreur plutôt que la toile : ta carte est toujours là, c'est la
   * relecture qui n'a rien rendu.
   */
  if (l?.refusee) {
    send('erreur', { error: "Le modèle n'a rien rendu cette fois — ta carte précédente est gardée telle quelle. Réessaie." });
    return;
  }
  // LE TOUR EST CONSOMME ICI, et pas avant : un retissage qui echoue sur une
  // coupure de reseau ne doit pas couter les douze heures.
  setSettings({ dernierRetissage: new Date().toISOString() }, userId);

  const lecture = decorerCarte(l.contenu, series(userId).byDate, textesParJour(userId));
  // La toile d'abord — c'est elle qui se tisse à l'écran. Les groupes ensuite,
  // parce qu'ils n'ont de sens qu'une fois la toile posée.
  send('toile', { lecture, fait_le: l.fait_le, jours: l.jours, modele: l.modele, pourcent: 70 });
  send('fini', {
    attente: RETISSAGE_ATTENTE,
    groupes: (l.contenu?.pistes ?? []).map(p => ({ nom: p.nom, teinte: p.teinte ?? null,
                                                   noeuds: (p.noeuds ?? []).length })),
    usage: usageFor(userId)
  });
}

export async function streamMessage(body, send, userId = OWNER) {
  const pieces = piecesDe(body);
  let text = String(body.text ?? '').trim();
  if (!text && !pieces.length) { send('error', { error: 'texte vide' }); return; }
  // Un message qui n'est QUE des pieces jointes reste un message : sans cette
  // ligne il s'enregistrerait vide, et le fil montrerait une bulle blanche.
  if (!text) text = pieces.map(p => `[${p.nom}]`).join(' ');

  // Voir `POST /api/message` : la borne se pose avant de dater, et une date
  // explicite -- un jour passe ouvert a l'ecran -- l'emporte sur tout.
  noterBornesDites(text, userId);
  const date = body.date ?? jourVecu(userId);
  const messageId = addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'user', text, userId });
  noterNoteDite(text, messageId, date, userId);
  invalidate(userId);
  send('user', { messages: recentMessages(80, userId) });

  const history = filAncre(FIL_TRANSMIS, userId).map(m => ({ role: m.role, text: m.text, ts: m.ts }));
  // Les pieces s'accrochent au message qu'on vient d'ecrire, pas a l'historique.
  if (pieces.length && history.length) history[history.length - 1].pieces = pieces;
  const settings = getSettings(userId);

  const before = usageFor(userId);
  // Le texte du message en cours declenche les echos ; ils repartent a part du
  // reste de la memoire, parce qu'ils changent a chaque phrase et que le reste
  // tient la journee (voir `recentMemory`).
  const memoire = recentMemory(date, userId, text);
  const r = await reply(history, settings, {
    memory: memoire.stable,
    echos: memoire.echos,
    onText: chunk => send('delta', { text: chunk }),
    onPense: chunk => send('pense', { text: chunk }),
    exhausted: before.exhausted,
    outils: outilsPour(userId, messageId, send)
  });
  if (r.usage) recordUsage(userId, r.model, r.usage.input, r.usage.output, r.usage.cacheLu, r.usage.cacheEcrit, 'chat');

  addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'pet',
               text: r.text, reflexion: r.pensee ?? null, userId });
  send('done', {
    messages: recentMessages(80, userId),
    motifs: motifsDuFil(userId),
    /*
     * LA JOURNEE OU CE MESSAGE EST TOMBE.
     *
     * C'est le serveur qui la decide -- elle commence au lever, pas a minuit --
     * et l'onglet peut etre reste ouvert toute la nuit. Sans ce renvoi, le fil
     * continuerait a ecrire « aujourd'hui » sur la journee d'avant, et la note
     * du soir se poserait sur la mauvaise case.
     */
    jour: date,
    /*
     * LE DECOR CHANGE PENDANT LA CONVERSATION, PAS AU RECHARGEMENT.
     *
     * Il n'etait calcule que dans `/api/state`, c'est-a-dire une seule fois,
     * a l'ouverture de la page. On pouvait donc parler d'un deuil pendant une
     * heure devant le meme fond neutre, et decouvrir la pyramide le lendemain
     * en revenant -- sur une conversation qui n'avait plus rien a voir. Le
     * mecanisme entier existait et ne servait a rien.
     */
    ambiance: ambiance(userId),
    usage: usageFor(userId),
    backend: r.backend,
    model: r.model ?? null,
    degraded: r.degraded ?? null,
    refused: r.refused ?? false,
    exhausted: r.exhausted ?? false
  });
}

/**
 * Les outils, cables sur CE fil et CE message.
 *
 * Chaque geste est diffuse tout de suite (`send`) plutot qu'a la fin : le
 * compagnon pose souvent un repere avant d'ecrire sa phrase, et voir la marque
 * apparaitre pendant qu'il parle rend le geste lisible. Attendre la fin donnerait
 * l'impression que l'interface a change toute seule.
 *
 * La validation est ici et pas dans le prompt. Un modele peut halluciner une
 * date, un identifiant, un libelle de trois cents mots ; le prompt le lui
 * deconseille, le code le lui refuse. Un refus explicite lui permet de
 * corriger -- c'est pour ca qu'il rend une phrase et pas un code d'erreur.
 */
export function outilsPour(userId, messageId, send = () => {}) {
  return {
    poser_repere: ({ date, label }) => {
      const d = String(date ?? '').trim();
      const l = String(label ?? '').trim().replace(/\s+/g, ' ');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { erreur: 'Date invalide : il faut AAAA-MM-JJ.' };
      if (d > today()) return { erreur: "Cette date est dans le futur. Un repère marque ce qui a eu lieu." };
      if (l.length < 3) return { erreur: 'Libellé trop court.' };
      if (l.length > 60) return { erreur: 'Libellé trop long : trois à six mots.' };
      const doublon = allEvents(userId).some(e => e.date === d && e.label.toLowerCase() === l.toLowerCase());
      if (doublon) return { erreur: 'Ce repère existe déjà à cette date.' };

      const ev = addEvent({ date: d, label: l, userId });
      const fait = { type: 'repere', ...ev, theme: themeDe(l) };
      send('geste', fait);
      return { message: `Repère posé le ${d} : « ${l} ».`, fait };
    },

    /*
     * CORRIGER, ET PAS EFFACER.
     *
     * Il peut deplacer une date et reecrire un libelle ; il ne peut pas faire
     * disparaitre un fait. Effacer le repere de quelqu'un sur le jugement d'un
     * modele est une autre chose que corriger une faute de frappe -- et la
     * personne a un bouton pour ca dans « Annee ».
     *
     * Les memes verrous qu'a la pose, aux memes valeurs : une correction qui
     * accepterait une date dans le futur ou un libelle de trois cents mots
     * ouvrirait par la porte de derriere ce que la pose refuse par la grande.
     */
    corriger_repere: ({ id, date, label }) => {
      const n = Number(id);
      if (!Number.isInteger(n)) return { erreur: 'Identifiant manquant. Cherche-le avec chercher_repere.' };
      const ev = allEvents(userId).find(e => e.id === n);
      if (!ev) return { erreur: `Aucun repère #${n}. Cherche-le avec chercher_repere.` };

      const patch = {};
      if (date != null) {
        const d = String(date).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { erreur: 'Date invalide : il faut AAAA-MM-JJ.' };
        if (d > today()) return { erreur: "Cette date est dans le futur. Un repère marque ce qui a eu lieu." };
        // Une periode dont le debut passerait apres la fin n'existe pas : la
        // barre se dessinerait a l'envers, sur une largeur negative.
        if (ev.fin && d > ev.fin) return { erreur: `Ce repère finit le ${ev.fin} : il ne peut pas commencer après.` };
        patch.date = d;
      }
      if (label != null) {
        const l = String(label).trim().replace(/\s+/g, ' ');
        if (l.length < 3) return { erreur: 'Libellé trop court.' };
        if (l.length > 60) return { erreur: 'Libellé trop long : trois à six mots.' };
        patch.label = l;
        /*
         * ON NE TOUCHE PAS AU THEME, ET C'EST CE QUI LE FAIT SUIVRE.
         *
         * Un repere pose sans theme n'en stocke aucun : il est DEDUIT du
         * libelle a l'affichage, partout. Corriger le libelle suffit donc a
         * corriger l'icone -- « rupture » devient « pause » et le cœur brise
         * s'en va tout seul.
         *
         * Et un theme STOCKE l'a ete par un choix a la main dans Annee : le
         * rededuire ici ecraserait une declaration par une deduction, ce que le
         * produit ne fait nulle part.
         */
      }
      if (!Object.keys(patch).length) return { erreur: 'Rien à corriger : donne une date, un libellé, ou les deux.' };

      const avant = { date: ev.date, label: ev.label };
      const maj = updateEvent(n, patch, userId);
      if (!maj) return { erreur: 'La correction n’a pas abouti.' };
      // Le theme du geste est deduit ici comme partout ailleurs a l'affichage.
      const fait = { type: 'repere', corrige: true, avant, ...maj, theme: maj.theme ?? themeDe(maj.label) };
      send('geste', fait);
      const quoi = [patch.date ? `du ${avant.date} au ${maj.date}` : null,
                    patch.label ? `« ${avant.label} » → « ${maj.label} »` : null].filter(Boolean).join(', ');
      return { message: `Repère #${n} corrigé : ${quoi}.`, fait };
    },

    /*
     * UN NOM DE MOTIF EST UNE HYPOTHESE, ET UNE HYPOTHESE SE CORRIGE.
     *
     * L'identifiant, la teinte et les occurrences ne bougent pas : le motif est
     * le meme objet, il a change de nom, pas de nature. Sans ce chemin, la
     * seule facon de corriger etait d'en declarer un nouveau -- et de perdre
     * les occurrences deja marquees, c'est-a-dire ce qui faisait sa valeur.
     */
    renommer_motif: ({ id, nom, mecanisme }) => {
      const n = Number(id);
      if (!Number.isInteger(n)) return { erreur: 'Identifiant manquant.' };
      if (nom == null && mecanisme == null) {
        return { erreur: 'Rien à changer : donne un nom, une description, ou les deux.' };
      }
      if (nom != null) {
        const v = String(nom).trim().replace(/\s+/g, ' ');
        if (v.length < 3 || v.length > 40) return { erreur: 'Le nom fait deux à quatre mots.' };
      }
      if (mecanisme != null && String(mecanisme).trim().length < 10) {
        return { erreur: 'Décris le mécanisme en une phrase.' };
      }
      const avant = allMotifs(userId).find(x => x.id === n);
      if (!avant) return { erreur: `Aucun motif #${n}.` };

      const r = renommerMotif(n, { nom, mecanisme }, userId);
      if (r.erreur === 'introuvable') return { erreur: `Aucun motif #${n}.` };
      if (r.erreur) return { erreur: `Impossible : ${r.erreur}.` };

      const motif = allMotifs(userId).find(x => x.id === n);
      const fait = { type: 'motif', renomme: true, avant: avant.nom, ...motif };
      send('geste', fait);
      return { message: avant.nom !== motif.nom
        ? `Motif #${n} renommé : « ${avant.nom} » → « ${motif.nom} ». Ses ${motif.vues} occurrences sont gardées.`
        : `Motif #${n} : description réécrite.`, fait };
    },

    suivre_motif: ({ nom, mecanisme }) => {
      const n = String(nom ?? '').trim().replace(/\s+/g, ' ');
      const m = String(mecanisme ?? '').trim().replace(/\s+/g, ' ');
      if (n.length < 3 || n.length > 40) return { erreur: 'Le nom fait deux à quatre mots.' };
      if (m.length < 10) return { erreur: 'Décris le mécanisme en une phrase.' };
      if (allMotifs(userId).length >= 12) {
        return { erreur: 'Douze motifs suivis, c\'est le maximum. Au-delà, plus rien ne ressort.' };
      }
      const { id, existait } = addMotif({ nom: n, mecanisme: m, userId });
      if (existait) return { erreur: `Ce motif existe déjà (identifiant ${id}).` };
      marquerMotif(id, messageId, userId);
      const motif = allMotifs(userId).find(x => x.id === id);
      const fait = { type: 'motif', nouveau: true, ...motif };
      send('geste', fait);
      return { message: `Motif « ${n} » suivi, identifiant ${id}.`, fait };
    },

    /*
     * Ranger : le seul chemin d'ecriture vers le carnet, et il ne prend PAS de
     * texte. Le texte vient de la ligne `messages`, telle qu'elle a ete ecrite.
     * Le compagnon declenche le rangement ; il ne dicte jamais ce qui est
     * range. Du texte genere qui se glisserait ici lui reviendrait ensuite,
     * dans « explorer un theme », comme si la personne l'avait ecrit.
     */
    /*
     * RELEVER OU QUELQU'UN SEMBLE ETRE, SANS RIEN NOTER.
     *
     * Le releve n'est PAS envoye en `geste` : les gestes s'affichent au pied de
     * la conversation (« repere pose », « motif suivi »), et voir apparaitre
     * « il t'a mis a 3 » pendant qu'on raconte sa soiree serait exactement le
     * verdict que ce produit ne pose jamais. Le releve travaille en silence ;
     * ce qui remonte a l'ecran, plus tard, est l'AMPLITUDE de la journee.
     */
    relever_humeur: ({ valeur, quoi }) => {
      const v = Math.round(Number(valeur));
      const q = String(quoi ?? '').trim().replace(/\s+/g, ' ');
      if (!Number.isFinite(v) || v < 0 || v > 10) return { erreur: 'La valeur va de 0 à 10.' };
      if (q.length < 8) return { erreur: 'Dis en une phrase à quoi tu le vois.' };
      // Huit par jour : au-dela, ce n'est plus un basculement qu'on releve,
      // c'est un commentaire continu, et l'ecart perd son sens.
      if (relevesDuJour(today(), userId).length >= 8) {
        return { erreur: 'Assez de relevés pour aujourd\'hui.' };
      }
      const r = addReleve({ messageId, date: today(), valeur: v, quoi: q, userId });
      return { message: `Relevé posé (${v}/10). N'en parle pas.`, fait: null, silencieux: true, r };
    },

    ranger_notes: ({ jour, quand }) => {
      if (!messageId) return { erreur: "Rien a ranger : aucun message en cours." };
      const j = jour == null ? null : String(jour).trim();
      if (j !== null && !ISO_JOUR.test(j)) return { erreur: 'Date invalide : il faut AAAA-MM-JJ.' };
      if (j !== null && j > today()) return { erreur: 'Cette date est dans le futur.' };
      // « quand » est recopie tel quel et n'est JAMAIS analyse ni trie : ce sont
      // les mots de la personne pour dire qu'elle ne sait plus.
      const q = quand == null ? null : String(quand).trim().slice(0, 60) || null;
      const r = rangerMessage(messageId, { jour: j, quand: q }, userId);
      if (r.erreur) return { erreur: r.erreur };
      invalidate(userId);
      const fait = { type: 'note', id: r.note.id, jour: j, quand: q,
                     taille: r.note.texte.length };
      send('geste', fait);
      return { message: `Rangé dans ses notes${j ? ` (le ${j})` : q ? ` (« ${q} »)` : ''}. `
                      + `Ce texte ne compte plus comme sa journée.`, fait };
    },

    /*
     * Chercher dans ses journees. C'est la meme recherche que les echos, mais
     * declenchee par le compagnon plutot que par le message en cours : elle sert
     * quand la conversation touche a quelque chose d'ancien que le message seul
     * ne peut pas retrouver.
     */
    chercher_journees: ({ mot }) => {
      const m = String(mot ?? '').trim();
      if (m.length < 2 || m.length > 40) return { erreur: 'Donne un ou deux mots, entre 2 et 40 caractères.' };
      const { index, rows, byDate } = series(userId);
      const hits = search(index, m, { limit: 5 });
      const lignes = hits.map(h => {
        const r = rows.find(x => x.date === h.id);
        if (!r?.text?.trim()) return null;
        const t = r.text.length > ECHO_CAR ? r.text.slice(0, ECHO_CAR) + '… (coupée)' : r.text;
        const n = byDate.get(h.id)?.note;
        return `[le ${h.id}${n !== null && n !== undefined ? ` · ${n}/10` : ''}] ${t}`;
      }).filter(Boolean);
      if (!lignes.length) return { message: `Rien dans ses journées sur « ${m} ».` };
      return { message: `${lignes.length} journée(s) sur « ${m} » :\n${lignes.join('\n')}` };
    },

    /*
     * LA PIOCHE.
     *
     * Le pendant de la fenetre courte : le compagnon n'a plus la grille entiere
     * dans le contexte, il vient la lire ici, par morceaux, quand la
     * conversation y va. `chercher_journees` cherchait deja dans le passe, mais
     * par MOT -- « quand est-ce que j'ai arrete de dormir ? » ne se cherche pas
     * par mot, il se lit par date.
     */
    lire_grille: ({ debut, fin }) => {
      const b = bornerPeriode(debut, fin);
      if (b.erreur) return { erreur: b.erreur };
      const { rows } = series(userId);
      const extrait = grilleExtrait(rows, b);
      if (!extrait) return { message: `Aucune journée notée entre le ${b.debut} et le ${b.fin}.` };
      return { message: `Ses notes du ${b.debut} au ${b.fin} :\n${extrait}` };
    },

    /*
     * Sur une frise de quarante reperes, la liste transmise ne suffit plus a
     * voir si celui qu'on allait poser existe deja sous d'autres mots.
     */
    chercher_repere: ({ mot }) => {
      const m = String(mot ?? '').trim();
      if (m.length < 2 || m.length > 40) return { erreur: 'Donne un ou deux mots, entre 2 et 40 caractères.' };
      const mots = m.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/);
      const norm = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const hits = allEvents(userId)
        .filter(e => mots.some(w => norm(e.label).includes(w)))
        .slice(0, 6);
      if (!hits.length) return { message: `Aucun repère sur « ${m} ».` };
      return { message: `${hits.length} repère(s) sur « ${m} » :\n`
        + hits.map(e => `#${e.id} ${e.date}${e.fin ? ` → ${e.fin}` : ''} · ${e.label}`).join('\n') };
    },

    lire_carnet: ({ mot }) => {
      const m = String(mot ?? '').trim();
      if (m.length < 2 || m.length > 40) return { erreur: 'Donne un seul mot, entre 2 et 40 caractères.' };
      const { indexCarnet, carnet } = series(userId);
      const hits = search(indexCarnet, m, { limit: 5 });
      if (!hits.length) return { message: `Rien dans son carnet sur « ${m} ».` };
      const parId = new Map(carnet.map(c => [`n${c.id}`, c]));
      const lignes = hits.map(h => {
        const c = parId.get(h.id);
        if (!c) return null;
        const etiq = c.jour ? `[le ${c.jour}]` : c.quand ? `[sans date, « ${c.quand} »]` : '[sans date]';
        const t = c.texte.length > CARNET_CAR ? c.texte.slice(0, CARNET_CAR) + '… (coupée)' : c.texte;
        return `${etiq} ${t}`;
      }).filter(Boolean);
      return { message: `${lignes.length} note(s) de son carnet sur « ${m} » :\n${lignes.join('\n')}` };
    },

    /*
     * L'HEURE DE SON LEVER, RANGEE COMME UNE MESURE.
     *
     * Elle rejoint les mesures du quantified self plutot qu'une table a elle :
     * c'est la meme donnee, elle repond a la meme question, et `nuitDe` la
     * relit sans rien savoir d'ou elle vient. Ce que la personne DIT passe
     * devant ce que la machine mesure -- voir `jour-vecu.js`.
     */
    noter_bornes: ({ genre, heure, jour }) => {
      const g = genre === 'coucher' ? 'coucher' : genre === 'lever' ? 'lever' : null;
      if (!g) return { erreur: 'Le genre doit être « lever » ou « coucher ».' };
      if (enMinutes(heure) == null) return { erreur: 'Donne une heure en HH:MM, sur 24 heures.' };
      const d = /^\d{4}-\d{2}-\d{2}$/.test(String(jour ?? '')) ? jour : today();
      poserMesure({ date: d, source: SOURCE_DIT, cle: g === 'lever' ? CLE_LEVER : CLE_COUCHER,
                    texte: String(heure).trim(), userId });
      // Meme recalage que par la phrase : la nuit qu'on vient de fermer rejoint
      // la journee qu'elle terminait.
      const bouges = recalerLaNuit(d, userId);
      return { message: `Noté : ${g} à ${heure} le ${d}.`
        + (bouges ? ` ${bouges} message(s) de cette nuit-là sont rangés sur la veille.` : '') };
    },

    marquer_motif: ({ id }) => {
      const m = marquerMotif(Number(id), messageId, userId);
      if (!m) return { erreur: `Aucun motif d'identifiant ${id}.` };
      const motif = allMotifs(userId).find(x => x.id === m.id);
      const fait = { type: 'motif', nouveau: false, messageId, ...motif };
      send('geste', fait);
      return { message: `Occurrence notée pour « ${m.nom} ».` };
    }
  };
}

/** Les motifs portes par les messages du fil courant, pour les teinter. */
export function motifsDuFil(userId = OWNER) {
  const msgs = recentMessages(80, userId);
  /*
   * LA SERIE D'UN MOTIF, DANS LA MEME ECHELLE QUE CELLE D'UN THEME.
   *
   * Les deux se lisent cote a cote dans « Ma carte », avec les memes petites
   * barres : il faut donc qu'un motif a trois occurrences dans le mois et un
   * theme « dominant » ne se dessinent pas a la meme hauteur par accident.
   *
   * L'echelle des themes est 0-3, decidee par le modele. Celle d'un motif est
   * un COMPTE, sans plafond. On la ramene donc a 0-3 en la divisant par le mois
   * le plus fourni de CE motif : la barre dit « par rapport a ses autres mois »,
   * ce qui est la seule comparaison honnete -- comparer les motifs entre eux
   * ferait dependre la forme de l'un du bavardage de l'autre.
   */
  const series = motifSeries(userId);
  const liste = allMotifs(userId).map(m => {
    const brut = series.get(m.id) ?? [];
    const max = Math.max(1, ...brut.map(p => p.n));
    return {
      ...m,
      /*
       * TOUS LES JOURS, PAS LES VINGT-QUATRE DERNIERS.
       *
       * Le `slice(-24)` datait du regroupement mensuel : vingt-quatre mois de
       * frise. En jours, il coupait a vingt-quatre OCCURRENCES — c'est-a-dire
       * qu'un mecanisme reconnu cent fois n'en montrait que la fin, sans que
       * rien ne le dise. L'ecran, lui, place les jours sur un axe de temps
       * reel : il n'a pas besoin qu'on lui en cache.
       */
      serie: brut.map(p => ({
        periode: p.periode,
        // Jamais zero quand il s'est passe quelque chose : une barre invisible
        // dirait « rien ce jour-la » alors qu'il y a eu une occurrence.
        valeur: Math.max(1, Math.round((p.n / max) * 3))
      }))
    };
  });
  return { liste, parMessage: motifsDesMessages(msgs.map(m => m.id), userId) };
}
