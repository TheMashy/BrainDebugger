/**
 * =====================================================================
 *  LE RAPPORT DEPUIS LA DERNIÈRE SÉANCE — SES MOTS, JOUR PAR JOUR.
 *
 * Demandé en ces termes : un rapport « depuis le dernier rdv psy », structuré
 * comme ceci —
 *
 *     Le 11 : « je suis confiant ! », « détendu, j'ai mangé en gare… ».
 *     Le 21 : « … ». Le soir : « j'ai envie de prendre plein d'anxios ».
 *
 * — et en PDF. C'est le document qu'on tend en arrivant, pour ne pas avoir
 * à reconstruire deux semaines de mémoire devant quelqu'un.
 *
 * CE QUE LA MACHINE ÉCRIT : RIEN, SAUF DES DATES.
 *
 * Tout ce qui est entre guillemets est une phrase EXACTE de la personne,
 * datée par l'application au moment où elle l'a écrite. Un modèle CHOISIT
 * lesquelles garder — deux semaines de journal ne tiennent pas en deux pages
 * — mais il ne rend que des numéros : il n'écrit pas un mot du document, il
 * ne peut donc ni inventer une citation ni se tromper de jour. Les seules
 * phrases de liaison sont les repères que la personne a posés (« début de
 * l'aripiprazole ») et les moments de la journée, tirés de l'horodatage.
 *
 * CE QUI NE PEUT PAS ÊTRE OMIS.
 *
 * Tout ce qui parle de mourir, de ne plus être là, de se faire du mal ou de
 * prendre quelque chose (server/gravite.js, qui s'appuie sur la veille) entre
 * d'office, que le modèle l'ait retenu ou non. C'est exactement ce qu'un
 * soignant doit lire, et exactement ce qu'on a envie de laisser de côté.
 *
 * Et la personne RELIT avant d'imprimer : l'écran montre la sélection, on
 * peut en retirer une ligne, et le PDF se fabrique dans le navigateur.
 * =====================================================================
 */
import { OWNER, db, allEvents, seanceAvant } from './db.js';
import { heureLocale } from './temps.js';
import { messageGrave } from './gravite.js';
import { addDays } from './stats.js';

export const MAX_PAR_JOUR = 4;
export const MAX_TOTAL = 45;
export const JOURS_PAR_DEFAUT = 14;

const norm = t => String(t ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/['’`]/g, ' ').replace(/\s+/g, ' ');

/* « je suis allé au psy », « j'ai vu ma psychiatre », « séance chez le psy
   ce matin » : un rendez-vous RACONTÉ, au passé. « j'ai peur d'aller voir le
   psy » n'en est pas un. */
const PRATICIEN = /\b(psy|psys|psychiatre|psychologue|psychotherapeute|therapeute)\b/;
const VECU = /\b(suis alle|suis allee|suis passe|j ai vu|j ai eu (?:mon|ma|le|la) (?:rdv|rendez vous|seance)|sorti(?:e)? de chez|j ai parle (?:de .{1,60} )?a (?:mon|ma)|seance|rdv|rendez vous|consultation)\b/;
const PAS_ENCORE = /\b(peur (?:de|d)|vais (?:aller|voir)|demain|j aimerais|je devrais|faut que|dois aller|prochain)\b/;

/** Les jours où le journal raconte un rendez-vous, du plus récent au plus ancien. */
export function rendezVousDansLeJournal(messages) {
  const vus = new Map();
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const n = norm(m.text);
    const p = n.match(PRATICIEN);
    if (!p || !VECU.test(n) || PAS_ENCORE.test(n)) continue;
    if (!vus.has(m.date)) {
      vus.set(m.date, { date: m.date, praticien: p[1].startsWith('psychiatre') ? 'psychiatre'
                                               : p[1].startsWith('psychologue') ? 'psychologue' : 'psy',
                        phrase: String(m.text).trim().slice(0, 160) });
    }
  }
  return [...vus.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * D'où part le rapport : la dernière séance enregistrée, sinon le dernier
 * rendez-vous raconté dans le journal, sinon deux semaines. Toujours AVANT
 * aujourd'hui : le matin du rendez-vous, c'est la période qui s'achève qu'on
 * raconte.
 */
/* Psychiatre d'un côté ; psy, psychologue, thérapeute de l'autre. */
const famille = p => (p === 'psychiatre' ? 'psychiatre' : 'psy');

/** Qui on va voir, si le journal d'aujourd'hui le dit (« peur de sortir voir le psy »). */
export function praticienAttendu(messages) {
  for (const m of messages) {
    const n = norm(m.text);
    const p = n.match(PRATICIEN);
    if (p && /\b(voir|aller|chez|rdv|rendez vous|seance)\b/.test(n)) {
      return p[1].startsWith('psychiatre') ? 'psychiatre' : 'psy';
    }
  }
  return null;
}

export function debutDuRapport(userId = OWNER, aujourdhui) {
  const depuis = addDays(aujourdhui, -120);
  const msgs = db.prepare(
    "SELECT date, role, text FROM messages WHERE user_id = ? AND role = 'user' AND date >= ? AND date < ? ORDER BY ts DESC"
  ).all(userId, depuis, aujourdhui);
  const trouves = rendezVousDansLeJournal(msgs).slice(0, 6);
  const seance = seanceAvant(aujourdhui, userId);
  if (seance && (!trouves[0] || seance.date >= trouves[0].date)) {
    return { debut: seance.date, source: 'seance', indice: seance.praticien ?? null, trouves };
  }
  /* Deux rendez-vous racontés — le psy le 10, le psychiatre le 14 — et on
     va voir le psy aujourd'hui : le relevé part du dernier rendez-vous DU
     MÊME GENRE. Les autres restent proposés en un clic. */
  const attendu = praticienAttendu(db.prepare(
    "SELECT text FROM messages WHERE user_id = ? AND role = 'user' AND date >= ? ORDER BY ts DESC"
  ).all(userId, aujourdhui));
  const choisi = (attendu && trouves.find(t => famille(t.praticien) === attendu)) || trouves[0];
  if (choisi) return { debut: choisi.date, source: 'journal', indice: choisi.phrase, trouves };
  return { debut: addDays(aujourdhui, -JOURS_PAR_DEFAUT), source: 'defaut', indice: null, trouves };
}

/** Le moment de la journée, tiré de l'heure locale « HH:MM ». */
export function periodeDe(hhmm) {
  const h = parseInt(String(hhmm ?? '').slice(0, 2), 10);
  if (!Number.isFinite(h)) return null;
  if (h < 5) return 'tard dans la nuit';
  if (h < 12) return 'le matin';
  if (h < 17) return "l'après-midi";
  if (h < 19) return 'en fin d’après-midi';
  return 'le soir';
}

/**
 * Les phrases candidates. Un message court reste entier — c'est souvent tout
 * ce qu'il y a à dire ; un long se découpe en phrases, pour qu'on puisse en
 * garder une sans recopier le paragraphe.
 */
export function unites(messages, { heure = heureLocale } = {}) {
  const out = [];
  let id = 0;
  for (const m of messages) {
    if (m.role !== 'user') continue;
    const t = String(m.text ?? '').replace(/\s+/g, ' ').trim();
    if (!t || /^\[[^\]]+\]$/.test(t)) continue;             // une image seule
    const morceaux = t.length <= 320 ? [t]
      : t.match(/[^.!?…]+[.!?…]*/g).map(s => s.trim()).filter(Boolean);
    for (const texte of morceaux) {
      const mots = texte.split(' ').length;
      const grave = messageGrave(texte);
      if (mots < 3 && !grave) continue;                        // « ok », « yep »
      out.push({ id: id++, date: m.date, ts: m.ts, periode: periodeDe(heure(m.ts)),
                 texte: texte.slice(0, 600), grave });
    }
  }
  return out;
}

/** Sans modèle : ce qui est grave, puis les phrases les plus longues à la première personne. */
export function choixParDefaut(liste) {
  const garde = new Set(liste.filter(u => u.grave).map(u => u.id));
  const parJour = new Map();
  for (const u of liste) (parJour.get(u.date) ?? parJour.set(u.date, []).get(u.date)).push(u);
  for (const us of parJour.values()) {
    const place = Math.max(0, 3 - us.filter(u => garde.has(u.id)).length);
    // Une question adressée au compagnon (« tu peux me rappeler… ») n'est pas
    // un moment de la période : elle parle de l'application.
    us.filter(u => !garde.has(u.id) && !/^tu\b/i.test(u.texte)
                   && /\b(je|j'|j’|me|m'|m’|moi)\b/i.test(u.texte) && u.texte.split(' ').length >= 3)
      .sort((a, b) => b.texte.length - a.texte.length).slice(0, place)
      .forEach(u => garde.add(u.id));
  }
  return [...garde];
}

/** Ce que le modèle lit : les phrases numérotées, jour par jour. */
export function texteAChoisir(liste) {
  const lignes = [];
  let jour = null;
  for (const u of liste) {
    if (u.date !== jour) { jour = u.date; lignes.push(`\n== ${u.date} ==`); }
    lignes.push(`[${u.id}] (${u.periode ?? '?'}) ${u.texte}`);
  }
  return lignes.join('\n').trim();
}

export const CONSIGNE_CHOIX = `Tu aides une personne à préparer sa prochaine séance chez son psy. Elle apportera un relevé de ce qu'elle a écrit dans son journal depuis la dernière séance. On te donne ses phrases, numérotées, jour par jour.

Choisis celles qu'un psychiatre ou un psychologue voudrait entendre sur cette période : l'humeur et ses bascules, l'énergie, le sommeil, l'anxiété, la façon dont elle se voit ou se compare, les relations, les idées de mort ou de se faire du mal, les envies ou les prises de substances et de médicaments, les effets d'un traitement, les sensations d'irréalité, les événements qui ont compté (travail, rencontres, conflits) — et aussi les moments où ça allait bien, qui comptent autant.

Laisse de côté la politesse, la logistique, ce qui parle de l'application elle-même, et les redites : quand deux phrases disent la même chose, garde la plus parlante.

Au plus ${MAX_PAR_JOUR} phrases par jour, ${MAX_TOTAL} en tout. Tu ne réécris rien et tu ne commentes rien : tu rends seulement des numéros, avec l'outil « choisir ».`;

export const OUTIL_CHOIX = {
  name: 'choisir',
  description: 'Rendre les numéros des phrases à garder dans le relevé.',
  input_schema: {
    type: 'object',
    properties: { numeros: { type: 'array', items: { type: 'integer' } } },
    required: ['numeros']
  }
};

/**
 * Le relevé, prêt à relire et à imprimer.
 * @param {{debut, fin, liste, choisis, notes: Map, reperes: object[]}} src
 */
export function assembler({ debut, fin, liste, choisis, notes = new Map(), reperes = [] }) {
  const garde = new Set(choisis);
  // Ce qui est grave entre toujours — voir l'en-tête.
  for (const u of liste) if (u.grave) garde.add(u.id);
  const jours = new Map();
  const jour = d => jours.get(d) ?? jours.set(d, { date: d, note: notes.get(d) ?? null, reperes: [], moments: [] }).get(d);
  for (const r of reperes) if (r.date >= debut && r.date <= fin) jour(r.date).reperes.push(r.label);
  const retenues = liste.filter(u => garde.has(u.id)).sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  for (const u of retenues) {
    const j = jour(u.date);
    const dernier = j.moments.at(-1);
    const cit = { id: u.id, texte: u.texte, grave: u.grave };
    if (dernier && dernier.periode === u.periode) dernier.citations.push(cit);
    else j.moments.push({ periode: u.periode, citations: [cit] });
  }
  return [...jours.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Les messages de la personne sur la période, dans l'ordre. */
export function messagesDuRapport(userId, debut, fin) {
  return db.prepare(
    "SELECT id, ts, date, role, text FROM messages WHERE user_id = ? AND role = 'user' AND date >= ? AND date <= ? ORDER BY ts ASC, id ASC"
  ).all(userId, debut, fin);
}

export function notesDuRapport(userId, debut, fin) {
  return new Map(db.prepare(
    'SELECT date, note FROM entries WHERE user_id = ? AND date >= ? AND date <= ? AND note IS NOT NULL'
  ).all(userId, debut, fin).map(r => [r.date, r.note]));
}

export const reperesDuRapport = (userId, debut, fin) =>
  allEvents(userId).filter(e => e.date >= debut && e.date <= fin).map(e => ({ date: e.date, label: e.label }));
