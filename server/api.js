import {
  db, getSettings, setSettings, publicSettings, allEntries, getEntry, setNote,
  addMessage, messagesForDate, recentMessages, allEvents, deleteEvent,
  allAnchors, setAnchor, getUser, deleteDay, clearNote, wipe, OWNER,
  addEvent, allMotifs, addMotif, marquerMotif, motifsDesMessages, deleteMotif
} from './db.js';
import { usageFor, record as recordUsage } from './usage.js';
import { buildSeries, episodes, followUp, yearGrid, streak, indexByDate, addDays, median, CONTRAST_SATURATION, DEFAULT_ETALON } from './stats.js';
import { inspectCSV, applyImport } from './import-csv.js';
import { inspectNotes, applyNotes } from './import-notes.js';
import * as sessions from './sessions.js';
import { readMood, readEnergy } from './mood.js';
import { buildGraph, MIN_JOURS } from './graph.js';
const { presence, presenceNote } = sessions;
import { buildIndex, search } from './search.js';
// Partage avec le navigateur : le theme d'un repere doit etre le meme des deux
// cotes, sinon l'icone annoncee n'est pas celle qui s'affiche. Voir l'en-tete
// de web/reperes.js.
import { themeDe } from '../web/reperes.js';
import { reply, memoryBlock, anchorBlock, gridBlock, jalonBlock, motifBlock,
         ANTHROPIC_MODELS, testKey } from './chat.js';

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
    _cache.set(userId, { rows, series: s, byDate: indexByDate(s), index: buildIndex(textDocs), textCount: textDocs.length });
  }
  return _cache.get(userId);
}

/**
 * Les journees ecrites les plus recentes, dans les mots exacts de l'utilisateur.
 * Uniquement du TEXTE : jamais les statistiques, jamais les episodes. Le
 * compagnon n'a pas a connaitre les chiffres -- c'est le Miroir qui les montre.
 */
export function recentMemory(date, userId = OWNER) {
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
    const r = await reply(history, getSettings(userId), { memory: recentMemory(date, userId) });
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
      events: allEvents(userId).map(e => ({ ...e, theme: themeDe(e.label) })),
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

    // Le mois affiche, pour le calendrier. Les journees sans note en font partie :
    // c'est un calendrier, les trous s'y voient et c'est une information.
    const mois = date.slice(0, 7);
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
               episodes: null, similar: null, reperes: reperesDuJour(date, userId) };
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
             reperes: reperesDuJour(date, userId) };
  },

  /**
   * Echos : les entrees passees proches de ce qui est en train d'etre ecrit.
   * Appele pendant la saisie, pas sur une action de recherche -- SPEC 2.2.
   * Chercher est une corvee ; se voir rappeler ses propres mots ne l'est pas.
   */
  'POST /api/echoes': ({ body, userId }) => {
    const { index, rows, byDate, series: ser, textCount } = series(userId);
    const text = String(body.text ?? '').trim();
    const exclude = new Set([body.date ?? today()]);
    if (text.length < 12 || textCount < 2) return { items: [], textCount };
    const hits = search(index, text, { limit: Number(body.limit ?? 3), exclude });
    return {
      textCount,
      items: hits.filter(h => h.score > 0.6 && h.forts.length).map(h => ({
        date: h.id, score: h.score, terms: h.terms, forts: h.forts,
        note: byDate.get(h.id)?.note ?? null,
        text: rows.find(r => r.date === h.id)?.text ?? '',
        band: followUp(ser, h.id, 14)
      }))
    };
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
             ...buildGraph(rows, allAnchors(userId), { since }) };
  },

  'GET /api/events': ({ userId }) => ({ events: allEvents(userId) }),

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
    const rendre = () => ({ events: allEvents(userId).map(e => ({ ...e, theme: themeDe(e.label) })) });
    if (body.delete) { deleteEvent(Number(body.delete), userId); return rendre(); }
    if (!body.date || !body.label) return { error: 'date et label requis' };
    addEvent(body.date, String(body.label).slice(0, 120), userId);
    return rendre();
  },

  'POST /api/settings': ({ body, userId }) => {
    // Une chaine vide ne doit pas effacer la cle par accident : le champ est
    // vide dans l'interface puisqu'on ne la renvoie jamais. L'effacement est
    // une action explicite.
    const patch = { ...body };
    if (patch.apiKey === '' && !body.clearKey) delete patch.apiKey;
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
 * Les reperes d'une journee, plus le voisinage.
 *
 * Le repere exact du jour est rare -- il y en a peut-etre quinze sur quatre
 * ans. N'afficher que celui-la laisserait le bloc vide 99 % du temps, donc
 * invisible. Le dernier repere pose AVANT ce jour, lui, existe toujours, et
 * c'est lui qui repond a la question qu'on se pose vraiment en rouvrant une
 * vieille journee : « j'en etais ou, a ce moment-la ? »
 */
function reperesDuJour(date, userId) {
  const tous = allEvents(userId);
  const decore = e => ({ ...e, theme: themeDe(e.label) });
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
    memory: recentMemory(date, userId),
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

      const ev = addEvent(d, l, userId);
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
