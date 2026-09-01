import {
  db, getSettings, setSettings, publicSettings, allEntries, getEntry, setNote,
  addMessage, messagesForDate, recentMessages, allEvents, deleteEvent,
  allAnchors, setAnchor, getUser, deleteDay, clearNote, wipe, OWNER,
  addEvent, allMotifs, addMotif, marquerMotif, motifsDesMessages, deleteMotif, teinterMotif, motifSeries,
  addCarnet, allCarnet, carnetDuJour, updateCarnet, deleteCarnet, countCarnet,
  updateEvent, renommerMotif, rangerMessage, allObjectifs, addObjectif, marquerObjectif, deleteObjectif,
  getLecture, setLecture, rembobiner, addReleve, relevesDuJour, amplitude, amplitudes, TEINTES,
  inventaireMesures, derniereMesure, oublierMesure, journalQS, viderJournalQS, mesuresDuJour,
  allSeances, addSeance, updateSeance, deleteSeance, motifsEntre,
  toutesMesures, signatureQS, activiteJours, mesuresEntre
} from './db.js';
import { usageFor, record as recordUsage } from './usage.js';
import { buildSeries, episodes, followUp, yearGrid, streak, indexByDate, addDays, median, CONTRAST_SATURATION, DEFAULT_ETALON } from './stats.js';
import { inspectCSV, applyImport } from './import-csv.js';
import { compteRendu, intervalle } from './compte-rendu.js';
import { liens } from './liens.js';
import { inspectNotes, applyNotes } from './import-notes.js';
import * as sessions from './sessions.js';
import { readMoodFil, readEnergy, SENS } from './mood.js';
import { buildGraph, MIN_JOURS } from './graph.js';
import { journee } from './journee.js';
import { horizonBlock } from './horizons.js';
import { attente, poserCle, retirerCle } from './passerelle.js';
import { corpusPour, lire, lireEnFlux, lancerLot, releverLot, MIN_JOURS as LECTURE_MIN } from './lecture.js';
import { nuitDe, archetypeDe, resumeDuJour, estDetail } from './allure.js';
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
import { reply, resolveKey, echoBlock, ECHO_CAR, memoryBlock, anchorBlock, fenetreBlock, grilleExtrait, bornerPeriode, jalonBlock, motifBlock, carnetBlock,
         CARNET_CAR, ANTHROPIC_MODELS, testKey } from './chat.js';
// L'heure de celui qui ecrit, pas celle du processus. Voir server/temps.js.
import { jourLocal, etatDuTemps } from './temps.js';
import { comparaisons } from './comparer.js';

/* ---------- cache : la serie complete coute ~10ms sur 1700 jours ----------
   Indexe par utilisateur : un cache global rendrait le journal de l'un a
   l'autre, ce qui serait la pire fuite possible sur ce produit. */
const _cache = new Map();
export function invalidate(userId) {
  if (userId === undefined) _cache.clear(); else _cache.delete(userId);
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
export const FIL_TRANSMIS = 25;

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
export function corpusDuJournal(userId, rows = series(userId).rows,
                                carnet = series(userId).carnet) {
  const avant = getLecture(userId);
  return corpusPour({
    rows, events: allEvents(userId), carnet,
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
    const corpus = corpusDuJournal(userId, rows, carnet);
    const r = await releverLot(lot.id, corpus, s);
    if (!r.pret) return null;

    recordUsage(userId, r.modele, r.usage.input, r.usage.output);
    const ecrites = rows.filter(x => x.text && x.text.trim());
    setLecture({
      contenu: r.lecture, jusqu_au: ecrites.at(-1)?.date ?? null,
      jours: corpus.jours, modele: r.modele, userId
    });
    setSettings({ lectureLot: null, lectureLotErreur: null }, userId);
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
    const t = today();
    const entry = getEntry(t, userId);
    const last = ser.length ? ser[ser.length - 1] : null;
    return {
      today: t,
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
    const date = body.date ?? today();
    const now = new Date().toISOString();

    addMessage({ ts: now, date, source: 'web', role: 'user', text, userId });
    invalidate(userId);

    const history = recentMessages(FIL_TRANSMIS, userId).map(m => ({ role: m.role, text: m.text, ts: m.ts }));
    const m = recentMemory(date, userId, text);
    const r = await reply(history, getSettings(userId), { memory: m.stable, echos: m.echos });
    if (r.usage) recordUsage(userId, r.model, r.usage.input, r.usage.output, r.usage.cacheLu, r.usage.cacheEcrit);

    addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'pet', text: r.text, userId });
    return {
      messages: recentMessages(80, userId), backend: r.backend,
      degraded: r.degraded ?? null, refused: r.refused ?? false
    };
  },

  'GET /api/messages': ({ query, userId }) =>
    query.date ? { messages: messagesForDate(query.date, userId) } : { messages: recentMessages(80, userId) },

  'POST /api/note': ({ body, userId }) => {
    const date = body.date ?? today();
    const note = body.note === null ? null : Number(body.note);
    if (note !== null && (!Number.isFinite(note) || note < 0 || note > 10)) return { error: 'note hors 0..10' };
    setNote(date, note, userId);
    invalidate(userId);
    return { entry: getEntry(date, userId) };
  },

  'GET /api/year': ({ query, userId }) => yearGrid(series(userId).series, Number(query.year ?? today().slice(0, 4))),

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
    const { series: ser, byDate, index, rows, textCount } = series(userId);
    const date = query.date ?? today();
    const cur = byDate.get(date) ?? null;
    const entry = getEntry(date, userId);
    const note = entry?.note ?? null;
    const reference = cur?.reference ?? (ser.length ? ser[ser.length - 1].reference : null);

    const floor = floorState(note, reference, s);

    // Ce que le Miroir montrait le moins bien : la journee qu'on regarde. On se
    // baladait dans l'historique sans jamais voir ce qu'on avait ecrit CE jour-la.
    const jour = { date, note, text: entry?.text ?? '' };

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
        texte: !!(e?.text && e.text.trim())
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
  'POST /api/passerelle/cle': ({ userId }) => ({ cle: poserCle(userId) }),
  'DELETE /api/passerelle/cle': ({ userId }) => { retirerCle(userId); return { ok: true }; },

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
       * dormi ? » et « ma journée est passée où ? ». Sur le DERNIER jour reçu,
       * pas sur aujourd'hui : un jour sans envoi n'a rien à raconter, et
       * afficher une nuit vide au lieu de la dernière connue serait perdre la
       * seule qu'on ait.
       */
      ...(() => {
        const tous = [...par.values()].flatMap(s2 => s2.points.map(p => ({
          date: p.date, cle: s2.cle, valeur: p.valeur, texte: p.texte, unite: s2.unite
        })));
        const dernier = dernierJour;
        if (!dernier) return { nuit: null, archetype: null };
        const duJour = tous.filter(x => x.date === dernier);
        return { jourLu: dernier, nuit: nuitDe(duJour, tous), archetype: archetypeDe(duJour, tous) };
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
        if (j.digest && typeof j.digest === 'object') {
          return { date: j.date, recu_le: j.recu_le, digest: j.digest, brut: null, resume };
        }
        let digest = null;
        try { digest = JSON.parse(j.digest); } catch { /* illisible : on le dira */ }
        return { date: j.date, recu_le: j.recu_le, digest, brut: digest ? null : String(j.digest), resume };
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
    return {
      // Une lecture faite avant la bascule vers « tout le journal » : elle
      // s'affiche, mais elle est perimee par construction.
      ancienne: !!l?.ancienne,
      lecture: l?.contenu ? decorerCarte(l.contenu, series(userId).byDate, textesParJour(userId)) : null,
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
      arelire: (!l || retard >= SEUIL) && !getSettings(userId).lectureLot,
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
    const corpus = corpusDuJournal(userId, rows, carnet);
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
        setSettings({ lectureLot: { id: lot.id, depuis: new Date().toISOString() },
                      lectureLotErreur: null }, userId);
      } catch (err) { return { error: String(err?.message ?? err).slice(0, 300) }; }
      // Pas de lecture a rendre : celle d'avant reste a l'ecran, et `enLot` dit
      // pourquoi le bouton ne repond plus.
      return { enLot: true, ...(await routes['GET /api/lecture']({ userId })) };
    }

    let r;
    try { r = await lire(corpus, s); }
    catch (err) { return { error: String(err?.message ?? err).slice(0, 300) }; }
    recordUsage(userId, r.modele, r.usage.input, r.usage.output);
    const l = setLecture({
      contenu: r.lecture, jusqu_au: ecrites.at(-1)?.date ?? null,
      jours: corpus.jours, modele: r.modele, userId
    });
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

/** Douze heures. Deux fois par jour, donc — et jamais deux fois le même soir. */
export const RETISSAGE_ATTENTE = 12 * 3600 * 1000;

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

  const corpus = corpusDuJournal(userId, rows, carnet);
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
    // Un evenement par tranche, pas par delta : le modele rend des centaines de
    // fragments par seconde, et autant d'ecritures SSE encombreraient le tuyau
    // pour une information qui ne se lit pas a cette vitesse.
    let dernier = 0;
    r = await lireEnFlux(corpus, s, ({ signes, pense }) => {
      if (signes - dernier < 400) return;
      dernier = signes;
      send('lit', { signes, pense });
    });
  } catch (err) {
    send('erreur', { error: String(err?.message ?? err).slice(0, 300) });
    return;
  }

  recordUsage(userId, r.modele, r.usage.input, r.usage.output);
  const l = setLecture({
    contenu: r.lecture, jusqu_au: ecrites.at(-1)?.date ?? null,
    jours: corpus.jours, modele: r.modele, userId
  });
  // LE TOUR EST CONSOMME ICI, et pas avant : un retissage qui echoue sur une
  // coupure de reseau ne doit pas couter les douze heures.
  setSettings({ dernierRetissage: new Date().toISOString() }, userId);

  const lecture = decorerCarte(l.contenu, series(userId).byDate, textesParJour(userId));
  // La toile d'abord — c'est elle qui se tisse à l'écran. Les groupes ensuite,
  // parce qu'ils n'ont de sens qu'une fois la toile posée.
  send('toile', { lecture, fait_le: l.fait_le, jours: l.jours, modele: l.modele });
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

  const date = body.date ?? today();
  const messageId = addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'user', text, userId });
  invalidate(userId);
  send('user', { messages: recentMessages(80, userId) });

  const history = recentMessages(FIL_TRANSMIS, userId).map(m => ({ role: m.role, text: m.text, ts: m.ts }));
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
  if (r.usage) recordUsage(userId, r.model, r.usage.input, r.usage.output, r.usage.cacheLu, r.usage.cacheEcrit);

  addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'pet',
               text: r.text, reflexion: r.pensee ?? null, userId });
  send('done', {
    messages: recentMessages(80, userId),
    motifs: motifsDuFil(userId),
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
      serie: brut.slice(-24).map(p => ({
        periode: p.periode,
        // Jamais zero quand il s'est passe quelque chose : une barre invisible
        // dirait « rien ce mois-la » alors qu'il y a eu une occurrence.
        valeur: Math.max(1, Math.round((p.n / max) * 3))
      }))
    };
  });
  return { liste, parMessage: motifsDesMessages(msgs.map(m => m.id), userId) };
}
