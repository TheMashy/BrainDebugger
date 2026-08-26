import {
  db, getSettings, setSettings, allEntries, getEntry, setNote,
  addMessage, messagesForDate, allEvents, addEvent, deleteEvent,
  allAnchors, setAnchor
} from './db.js';
import { buildSeries, episodes, followUp, yearGrid, streak, indexByDate, addDays, CONTRAST_SATURATION } from './stats.js';
import { buildIndex, search } from './search.js';
import { reply } from './chat.js';

/* ---------- cache : la serie complete coute ~10ms sur 1700 jours ---------- */
let _cache = null;
export function invalidate() { _cache = null; }
function series() {
  if (!_cache) {
    const rows = allEntries();
    const s = buildSeries(rows);
    const textDocs = rows.filter(r => r.text && r.text.trim()).map(r => ({ id: r.date, text: r.text }));
    _cache = { rows, series: s, byDate: indexByDate(s), index: buildIndex(textDocs), textCount: textDocs.length };
  }
  return _cache;
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

  'GET /api/state': () => {
    const s = getSettings();
    const { series: ser, byDate, textCount } = series();
    const t = today();
    const entry = getEntry(t);
    const last = ser.length ? ser[ser.length - 1] : null;
    return {
      today: t,
      settings: s,
      entry,
      anchors: allAnchors(),
      messages: messagesForDate(t),
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

  'POST /api/message': async ({ body }) => {
    const text = String(body.text ?? '').trim();
    if (!text) return { error: 'texte vide' };
    const date = body.date ?? today();
    const now = new Date().toISOString();

    addMessage({ ts: now, date, source: 'web', role: 'user', text });
    invalidate();

    const history = messagesForDate(date).map(m => ({ role: m.role, text: m.text }));
    const r = await reply(history, getSettings());

    addMessage({ ts: new Date().toISOString(), date, source: 'web', role: 'pet', text: r.text });
    return { messages: messagesForDate(date), backend: r.backend, degraded: r.degraded ?? null };
  },

  'GET /api/messages': ({ query }) => ({ messages: messagesForDate(query.date ?? today()) }),

  'POST /api/note': ({ body }) => {
    const date = body.date ?? today();
    const note = body.note === null ? null : Number(body.note);
    if (note !== null && (!Number.isFinite(note) || note < 0 || note > 10)) return { error: 'note hors 0..10' };
    setNote(date, note);
    invalidate();
    return { entry: getEntry(date) };
  },

  'GET /api/year': ({ query }) => yearGrid(series().series, Number(query.year ?? today().slice(0, 4))),

  /** Serie compacte pour les courbes : tableaux paralleles, ~5x plus leger que des objets. */
  'GET /api/series': () => {
    const s = series().series;
    return {
      date: s.map(x => x.date),
      note: s.map(x => x.note),
      reference: s.map(x => x.reference),
      delta: s.map(x => x.delta),
      contrastFixed: s.map(x => x.contrastFixed),
      contrastGlobal: s.map(x => x.contrastGlobal),
      contrastRelative: s.map(x => x.contrastRelative),
      cumFixed: s.map(x => x.cumFixed),
      cumGlobal: s.map(x => x.cumGlobal),
      cumRelative: s.map(x => x.cumRelative),
      events: allEvents()
    };
  },

  /**
   * Le Miroir -- SPEC 2. Trois mecanismes, par ordre d'importance :
   * preuve de resolution, similitude, contradiction.
   * Ne genere aucun texte. Rend des dates, des chiffres et des mots deja ecrits.
   */
  'GET /api/mirror': ({ query }) => {
    const s = getSettings();
    const { series: ser, byDate, index, rows, textCount } = series();
    const date = query.date ?? today();
    const cur = byDate.get(date) ?? null;
    const entry = getEntry(date);
    const note = entry?.note ?? null;
    const reference = cur?.reference ?? (ser.length ? ser[ser.length - 1].reference : null);

    const floor = floorState(note, reference, s);

    // 3. CONTRADICTION : l'entree d'hier, brute, sans commentaire.
    const y = addDays(date, -1);
    const yEntry = getEntry(y);
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

  'GET /api/search': ({ query }) => {
    const { index, rows, byDate, series: ser } = series();
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

  'GET /api/events': () => ({ events: allEvents() }),
  'POST /api/events': ({ body }) => {
    if (body.delete) { deleteEvent(Number(body.delete)); return { events: allEvents() }; }
    if (!body.date || !body.label) return { error: 'date et label requis' };
    addEvent(body.date, String(body.label).slice(0, 120));
    return { events: allEvents() };
  },

  'POST /api/settings': ({ body }) => ({ settings: setSettings(body) }),

  'POST /api/anchors': ({ body }) => {
    if (body.note === undefined) return { error: 'note requise' };
    setAnchor(Number(body.note), String(body.label ?? ''), String(body.descr ?? ''));
    return { anchors: allAnchors() };
  },

  /** Les donnees appartiennent a l'utilisateur, et il doit pouvoir partir avec. */
  'GET /api/export': () => ({
    exportedAt: new Date().toISOString(),
    entries: allEntries(),
    events: allEvents(),
    anchors: allAnchors(),
    messages: db.prepare('SELECT id, ts, date, source, role, text FROM messages ORDER BY ts').all()
  })
};
