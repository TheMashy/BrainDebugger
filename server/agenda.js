/**
 * L'AGENDA : LES REPÈRES « AGENDA » DE BRAINDEBUGGER.
 *
 * « On ne va pas passer par Google Agenda ; un système dans BrainDebugger pour
 * rajouter ça à une frise / agenda, aussi visible depuis Machi Tool (les
 * repères divisés en psy et normal : ce qui est normal sera visible sur
 * l'agenda de Machi Tool). »
 *
 * Ce module ne touche QUE les repères de genre « agenda » : ni Jarvis ni Machi
 * Tool ne voient jamais un repère « psy ». Il pose et il lit ; il n'efface rien
 * (on retire un rendez-vous dans « Année », à la main).
 */
import { addEvent, agendaEntre, db, OWNER } from './db.js';
import { nuits, sommeilHabituel } from './nuits.js';

const ISO_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre',
              'octobre', 'novembre', 'décembre'];

/** Le jour civil dans un fuseau : « 2026-09-25 ». */
export function jourDans(zone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(date);
  } catch { return date.toISOString().slice(0, 10); }
}

const valide = d => ISO_JOUR.test(d) && !Number.isNaN(Date.parse(d + 'T00:00:00Z'))
  && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d;

export function plusJours(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** « jeudi 1 octobre » */
export function jourLisible(d) {
  const t = new Date(d + 'T00:00:00Z');
  return `${JOURS[t.getUTCDay()]} ${t.getUTCDate()} ${MOIS[t.getUTCMonth()]}`;
}

/** Poser un rendez-vous. Rend { evenement, texte } ou lève une erreur lisible. */
export function poserRendezVous({ titre, date, heure = null, fin = null } = {}, userId = OWNER) {
  const label = String(titre ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!label) throw new Error('Il faut un titre au rendez-vous.');
  const d = String(date ?? '').trim();
  if (!valide(d)) throw new Error('Date illisible : il faut AAAA-MM-JJ.');
  const h = heure ? String(heure).trim() : null;
  if (h && !HEURE.test(h)) throw new Error('Heure illisible : il faut HH:MM.');
  const f = fin ? String(fin).trim() : null;
  if (f && (!valide(f) || f < d)) throw new Error('Fin illisible, ou avant le début.');
  const evenement = addEvent({ date: d, fin: f && f !== d ? f : null, label, genre: 'agenda', heure: h, userId });
  return { evenement, texte: `Ajouté à l'agenda : « ${label} », ${jourLisible(d)}${h ? ` à ${h}` : ''}`
                            + `${evenement.fin ? ` jusqu'au ${jourLisible(evenement.fin)}` : ''}.` };
}

/** Les rendez-vous de `depuis` à `depuis + jours - 1`. */
export function lireAgenda({ depuis, jours = 7 } = {}, userId = OWNER, aujourdhui = null) {
  const d = depuis && valide(String(depuis)) ? String(depuis) : (aujourdhui ?? new Date().toISOString().slice(0, 10));
  const n = Math.max(1, Math.min(366, Number(jours) || 7));
  const jusqua = plusJours(d, n - 1);
  return { depuis: d, jusqua, rendezVous: agendaEntre(d, jusqua, userId) };
}

/** La même chose, en une phrase par rendez-vous, pour Jarvis. */
export function agendaEnTexte({ depuis, jusqua, rendezVous }) {
  if (!rendezVous.length) {
    return `Rien à l'agenda ${depuis === jusqua ? `le ${jourLisible(depuis)}` : `du ${jourLisible(depuis)} au ${jourLisible(jusqua)}`}.`;
  }
  return `${rendezVous.length} à l'agenda du ${jourLisible(depuis)} au ${jourLisible(jusqua)} :\n`
    + rendezVous.map(r => `- ${jourLisible(r.date)}${r.heure ? ` à ${r.heure}` : ''} : ${r.label}`
                          + `${r.fin ? ` (jusqu'au ${jourLisible(r.fin)})` : ''}`).join('\n');
}

/*
 * LE BILAN DES DERNIERS JOURS, POUR LA FENÊTRE AGENDA DE MACHI TOOL.
 *
 * « Des infos de quantified self : temps de sommeil, note, frise avec ce qui
 * arrive. » Des CHIFFRES, et rien d'autre : la durée de chaque nuit, son
 * coucher et son lever (que Machi Tool a lui-même mesurés), et la note /10 que
 * la personne a donnée à sa journée. Jamais un mot du journal, jamais un
 * repère « psy » : la clé de passerelle ne lit toujours pas le journal.
 */
export function bilanDesJours(userId = OWNER, aujourdhui = null, jours = 7) {
  const fin = aujourdhui ?? new Date().toISOString().slice(0, 10);
  const n = Math.max(1, Math.min(31, Number(jours) || 7));
  const debut = plusJours(fin, -(n - 1));
  const parNuit = new Map();
  try {
    for (const x of nuits(userId, { jours: n, jusquA: fin })) parNuit.set(x.date, x);
  } catch { /* pas de nuits lisibles : on montre les notes quand même */ }
  const notes = new Map(db.prepare(
    'SELECT date, note FROM entries WHERE user_id = ? AND date BETWEEN ? AND ? AND note IS NOT NULL'
  ).all(userId, debut, fin).map(r => [r.date, r.note]));
  const liste = [];
  for (let d = debut; d <= fin; d = plusJours(d, 1)) {
    const nu = parNuit.get(d);
    liste.push({
      date: d,
      note: notes.has(d) ? Number(notes.get(d)) : null,
      sommeil_h: typeof nu?.sommeil_h === 'number' ? nu.sommeil_h : null,
      coucher: nu?.coucher ?? null,
      lever: nu?.lever ?? null
    });
  }
  let habituel = null;
  try { habituel = sommeilHabituel(userId); } catch { habituel = null; }
  return { jours: liste, sommeil_mediane: habituel?.mediane ?? null };
}
