import {
  db, getSettings, setSettings, publicSettings, allEntries, getEntry, setNote,
  addMessage, messagesForDate, recentMessages, allEvents, addEvent, deleteEvent,
  allAnchors, setAnchor, getUser, OWNER
} from './db.js';
import { usageFor, record as recordUsage } from './usage.js';
import { buildSeries, episodes, followUp, yearGrid, streak, indexByDate, addDays, median, CONTRAST_SATURATION, DEFAULT_ETALON } from './stats.js';
import { inspectCSV, applyImport } from './import-csv.js';
import { inspectNotes, applyNotes } from './import-notes.js';
import * as sessions from './sessions.js';
const { presence, presenceNote } = sessions;
import { buildIndex, search } from './search.js';
import { reply, memoryBlock, anchorBlock, gridBlock, ANTHROPIC_MODELS, testKey } from './chat.js';

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

  const note = presenceNote(presence(userId));
  if (note) morceaux.push(note);

  return morceaux.length ? morceaux.join('\n\n---\n\n') : null;
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
      user: publicUser(userId),
      usage: usageFor(userId),
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
      events: allEvents(userId)
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

    // 3. CONTRADICTION : l'entree d'hier, brute, sans commentaire.
    const y = addDays(date, -1);
    const yEntry = getEntry(y, userId);
    const yesterday = yEntry ? { date: y, note: yEntry.note ?? null, text: yEntry.text ?? '' } : { date: y, note: null, text: '' };

    // Sous le plancher : rien d'autre que du brut. SPEC 4.1.
    if (floor.floored) {
      const past = rows.filter(r => r.text && r.text.trim() && r.date < date)
        .slice(-5).reverse()
        .map(r => ({ date: r.date, text: r.text, note: r.note }));
      return { date, note, floored: true, floor, yesterday, rawPast: past, episodes: null, similar: null };
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
    if (curText.trim() && textCount >= 2) {
      const hits = search(index, curText, { limit: 5, exclude: new Set([date]) });
      similar = {
        mode: 'text',
        items: hits.map(h => ({
          date: h.id, score: h.score, terms: h.terms,
          note: byDate.get(h.id)?.note ?? null,
          text: rows.find(r => r.date === h.id)?.text ?? '',
          band: followUp(ser, h.id, 14)
        }))
      };
    } else if (note !== null) {
      const same = ser.filter(x => x.date < date && x.note === note).slice(-5).reverse();
      similar = {
        mode: 'note',
        reason: textCount < 2 ? 'no_text_corpus' : 'no_text_today',
        items: same.map(x => ({
          date: x.date, note: x.note, delta: x.delta, text: '',
          band: followUp(ser, x.date, 14)
        }))
      };
    }

    return { date, note, reference, delta: cur?.delta ?? null, floored: false, floor, yesterday, episodes: ep, similar, textCount };
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
      items: hits.filter(h => h.score > 0.6).map(h => ({
        date: h.id, score: h.score, terms: h.terms,
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
        date: h.id, score: h.score, terms: h.terms,
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

  'GET /api/events': ({ userId }) => ({ events: allEvents(userId) }),
  'POST /api/events': ({ body, userId }) => {
    if (body.delete) { deleteEvent(Number(body.delete), userId); return { events: allEvents(userId) }; }
    if (!body.date || !body.label) return { error: 'date et label requis' };
    addEvent(body.date, String(body.label).slice(0, 120), userId);
    return { events: allEvents(userId) };
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
export async function streamMessage(body, send, userId = OWNER) {
  const text = String(body.text ?? '').trim();
  if (!text) { send('error', { error: 'texte vide' }); return; }

  const date = body.date ?? today();
  addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'user', text, userId });
  invalidate(userId);
  send('user', { messages: recentMessages(80, userId) });

  const history = recentMessages(60, userId).map(m => ({ role: m.role, text: m.text }));
  const settings = getSettings(userId);

  const before = usageFor(userId);
  const r = await reply(history, settings, {
    memory: recentMemory(date, userId),
    onText: chunk => send('delta', { text: chunk }),
    exhausted: before.exhausted
  });
  if (r.usage) recordUsage(userId, r.model, r.usage.input, r.usage.output);

  addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'pet', text: r.text, userId });
  send('done', {
    messages: recentMessages(80, userId),
    usage: usageFor(userId),
    backend: r.backend,
    model: r.model ?? null,
    degraded: r.degraded ?? null,
    refused: r.refused ?? false,
    exhausted: r.exhausted ?? false
  });
}
