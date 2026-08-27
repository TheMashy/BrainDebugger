import {
  db, getSettings, setSettings, publicSettings, allEntries, getEntry, setNote,
  addMessage, messagesForDate, recentMessages, allEvents, deleteEvent,
  allAnchors, setAnchor, getUser, deleteDay, clearNote, wipe, OWNER,
  addEvent, allMotifs, addMotif, marquerMotif, motifsDesMessages, deleteMotif,
  addCarnet, allCarnet, carnetDuJour, updateCarnet, deleteCarnet, countCarnet,
  updateEvent, rangerMessage, allObjectifs, addObjectif, marquerObjectif, deleteObjectif,
  getLecture, setLecture, TEINTES
} from './db.js';
import { usageFor, record as recordUsage } from './usage.js';
import { buildSeries, episodes, followUp, yearGrid, streak, indexByDate, addDays, median, CONTRAST_SATURATION, DEFAULT_ETALON } from './stats.js';
import { inspectCSV, applyImport } from './import-csv.js';
import { inspectNotes, applyNotes } from './import-notes.js';
import * as sessions from './sessions.js';
import { readMood, readEnergy } from './mood.js';
import { buildGraph, MIN_JOURS } from './graph.js';
import { corpusPour, lire, HORIZONS, MIN_JOURS as LECTURE_MIN } from './lecture.js';
const { presence, presenceNote } = sessions;
import { buildIndex, search, tokenize } from './search.js';
// Partage avec le navigateur : le theme d'un repere doit etre le meme des deux
// cotes, sinon l'icone annoncee n'est pas celle qui s'affiche. Voir l'en-tete
// de web/reperes.js.
import { themeDe, ICONES } from '../web/reperes.js';
// Meme raison : la geometrie de la frise doit etre calculee une seule fois, au
// meme endroit, sinon le serveur annonce une hauteur et le navigateur en
// dessine une autre.
import { voies, etendue, estPeriode, finEffective } from '../web/frise.js';
import { reply, resolveKey, echoBlock, ECHO_CAR, memoryBlock, anchorBlock, gridBlock, jalonBlock, motifBlock, carnetBlock, objectifBlock,
         CARNET_CAR, ANTHROPIC_MODELS, testKey } from './chat.js';

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

  // La grille entiere. Sans elle, a la question « sur l'annee, mes ecarts
  // sont-ils inquietants ? », le compagnon repondait qu'il n'avait que des
  // bouts -- vrai, et absurde quand l'application tient quatre ans de notes.
  const { rows, series: ser } = series(userId);
  const ref = ser.length ? ser[ser.length - 1].reference : null;
  const grille = gridBlock(rows, { reference: ref });
  if (grille) morceaux.push(grille);

  // Ce que le compagnon a deja pose. Sans cette liste il reposerait chaque
  // matin le repere de la veille, et declarerait trois fois le meme motif sous
  // trois noms voisins -- l'echec classique d'un agent sans etat.
  const jalons = jalonBlock(allEvents(userId));
  if (jalons) morceaux.push(jalons);
  const motifs = motifBlock(allMotifs(userId));
  if (motifs) morceaux.push(motifs);
  // Hors du `if (days)` : un objectif est un engagement pris AVEC lui, pas un
  // souvenir de journee. A memoire zero il doit encore savoir ce qu'on tient.
  const obj = objectifBlock(allObjectifs(userId), today());
  if (obj) morceaux.push(obj);

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
      if (bloc) morceaux.push(bloc);
    }
  }

  const note = presenceNote(presence(userId));
  if (note) morceaux.push(note);

  return morceaux.length ? morceaux.join('\n\n---\n\n') : null;
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
  const msgs = recentMessages(80, userId).filter(m => m.role === 'user');
  const texte = msgs.map(m => m.text).join(' ');
  const t = today();
  const note = getEntry(t, userId)?.note ?? null;
  const { series: ser } = series(userId);
  const ref = ser.length ? ser[ser.length - 1].reference : null;
  const m = readMood(texte, note);
  return { scene: m.scene, force: m.force, energie: readEnergy(note, ref) };
}

/** Ce que le navigateur a le droit de savoir de la personne connectée. */
export function publicUser(userId) {
  const u = getUser(userId);
  return u ? { id: u.id, username: u.username, avatar: u.avatar } : { id: userId, username: null, avatar: null };
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

export const routes = {

  'GET /api/state': ({ userId }) => {
    const s = getSettings(userId);
    const { series: ser, byDate, textCount } = series(userId);
    const t = today();
    const entry = getEntry(t, userId);
    const last = ser.length ? ser[ser.length - 1] : null;
    return {
      today: t,
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
        years: [...new Set(ser.map(x => x.date.slice(0, 4)))].sort()
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

    const history = recentMessages(60, userId).map(m => ({ role: m.role, text: m.text }));
    const r = await reply(history, getSettings(userId), { memory: recentMemory(date, userId, text) });
    if (r.usage) recordUsage(userId, r.model, r.usage.input, r.usage.output);

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
      return { date, note, jour, calendrier, floored: true, floor, yesterday, rawPast: past,
               episodes: null, similar: null, reperes: reperesDuJour(date, userId),
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

  'GET /api/carnet': ({ userId }) => ({ notes: allCarnet(userId), compte: countCarnet(userId) }),

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
  'GET /api/lecture': ({ query, userId }) => {
    const horizon = HORIZONS[query.horizon] ? query.horizon : 'moyen';
    const { rows } = series(userId);
    const ecrites = rows.filter(r => r.text && r.text.trim());
    const dernier = ecrites.at(-1)?.date ?? null;
    const l = getLecture(horizon, userId);
    /*
     * Le RETARD : combien de journees ecrites depuis la derniere que la lecture
     * a vue. C'est ce qui decide de relancer toute seule, et pas le simple fait
     * qu'une journee ait ete ajoutee -- ecrire tous les soirs declencherait
     * alors une relecture complete du corpus tous les soirs, pour un theme qui
     * n'aura pas bouge d'un cheveu.
     *
     * Le seuil suit la fenetre : sur trente jours, une semaine de plus est un
     * quart du corpus ; sur quatre ans, elle ne change rien.
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
    const SEUIL = { court: 3, moyen: 14, long: 30 }[horizon] ?? 14;
    return {
      horizon,
      lecture: l?.contenu ?? null,
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
      arelire: !l || retard >= SEUIL,
      cle: resolveKey(getSettings(userId)).source !== 'none'
    };
  },

  'POST /api/lecture': async ({ body, userId }) => {
    const horizon = HORIZONS[body.horizon] ? body.horizon : 'moyen';
    const s = getSettings(userId);
    const { rows, carnet } = series(userId);
    const ecrites = rows.filter(r => r.text && r.text.trim());
    if (ecrites.length < LECTURE_MIN) {
      return { error: `Il faut au moins ${LECTURE_MIN} journées écrites pour que ça veuille dire quelque chose.` };
    }
    const corpus = corpusPour(horizon, {
      rows, events: allEvents(userId), carnet,
      motifs: allMotifs(userId), objectifs: allObjectifs(userId)
    }, today());
    if (!corpus.dates.size) {
      return { error: "Rien d'écrit sur cette fenêtre. Essaie une fenêtre plus large." };
    }
    let r;
    try { r = await lire(horizon, corpus, s); }
    catch (err) { return { error: String(err?.message ?? err).slice(0, 300) }; }
    recordUsage(userId, r.modele, r.usage.input, r.usage.output);
    const l = setLecture({
      horizon, contenu: r.lecture, jusqu_au: ecrites.at(-1)?.date ?? null,
      jours: corpus.jours, modele: r.modele, userId
    });
    return { horizon, lecture: l.contenu, fait_le: l.fait_le, jours: l.jours,
             modele: l.modele, possible: true, perime: false, retard: 0,
             arelire: false, cle: true, usage: usageFor(userId) };
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

export async function streamMessage(body, send, userId = OWNER) {
  const text = String(body.text ?? '').trim();
  if (!text) { send('error', { error: 'texte vide' }); return; }

  const date = body.date ?? today();
  const messageId = addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'user', text, userId });
  invalidate(userId);
  send('user', { messages: recentMessages(80, userId) });

  const history = recentMessages(60, userId).map(m => ({ role: m.role, text: m.text }));
  const settings = getSettings(userId);

  const before = usageFor(userId);
  const r = await reply(history, settings, {
    // le texte du message en cours : c'est lui qui declenche les echos
    memory: recentMemory(date, userId, text),
    onText: chunk => send('delta', { text: chunk }),
    exhausted: before.exhausted,
    outils: outilsPour(userId, messageId, send)
  });
  if (r.usage) recordUsage(userId, r.model, r.usage.input, r.usage.output);

  addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'pet', text: r.text, userId });
  send('done', {
    messages: recentMessages(80, userId),
    motifs: motifsDuFil(userId),
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
     * Un objectif n'est jamais pose sans accord : le prompt le dit, et le code
     * ne peut pas le verifier -- seule la conversation sait si la personne a
     * dit oui. Ce qui EST verifiable est ici : un libelle court, un genre
     * connu, une date qui existe, et un plafond.
     */
    poser_objectif: ({ quoi, genre, depuis }) => {
      const q = String(quoi ?? '').trim().replace(/\s+/g, ' ');
      if (q.length < 3 || q.length > 70) return { erreur: 'Trois à huit mots, dans ses mots à elle.' };
      const g = ICONES[String(genre ?? '')] ? String(genre) : 'jalon';
      const d = depuis == null ? today() : String(depuis).trim();
      if (!ISO_JOUR.test(d)) return { erreur: 'Date invalide : il faut AAAA-MM-JJ.' };
      if (d > today()) return { erreur: 'Cette date est dans le futur.' };
      const liste = allObjectifs(userId);
      // Huit, et pas douze comme les motifs : un objectif se REGARDE, et une
      // liste ou rien ne ressort ne se regarde plus.
      if (liste.length >= 8) return { erreur: 'Huit objectifs, c\'est le maximum. Au-delà, plus rien ne ressort.' };
      if (liste.some(o => o.quoi.toLowerCase() === q.toLowerCase())) {
        return { erreur: 'Cet objectif existe déjà.' };
      }
      const o = addObjectif({ quoi: q, genre: g, depuis: d, userId });
      const fait = { type: 'objectif', nouveau: true, ...o };
      send('geste', fait);
      return { message: `Objectif noté : « ${q} », identifiant ${o.id}, depuis le ${d}.`, fait };
    },

    marquer_objectif: ({ id, tenu, date }) => {
      const d = date == null ? today() : String(date).trim();
      if (!ISO_JOUR.test(d)) return { erreur: 'Date invalide : il faut AAAA-MM-JJ.' };
      if (d > today()) return { erreur: 'Cette date est dans le futur.' };
      const o = marquerObjectif(Number(id), { tenu: !!tenu, date: d }, userId);
      if (!o) return { erreur: `Aucun objectif d'identifiant ${id}.` };
      const fait = { type: 'objectif', nouveau: false, ...o };
      send('geste', fait);
      return { message: tenu ? `« ${o.quoi} » repart du ${d}.` : `« ${o.quoi} » marqué rompu.`, fait };
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
  return {
    liste: allMotifs(userId),
    parMessage: motifsDesMessages(msgs.map(m => m.id), userId)
  };
}
