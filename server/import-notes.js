/**
 * Import de notes deja ecrites.
 *
 * Le miroir ne sait rendre que ce qu'on lui a donne. Quelqu'un qui arrive avec
 * quatre ans de notes dans un fichier texte a le corpus, mais pas dans l'appli :
 * la recherche par similitude n'a rien a comparer, et les journees passees sont
 * des chiffres sans mots. Ce module colle ce fosse.
 *
 * On colle un bloc, il en ressort des journees datees. Aucune ecriture n'a lieu
 * sans qu'on ait montre d'abord ce qui va etre ecrit : se tromper de format et
 * ecraser des annees de journal serait irreparable, et l'inverse -- un import
 * silencieux qui ne prend que la moitie des entrees -- se remarque des mois plus
 * tard, quand le miroir ment par omission.
 *
 * Les notes importees entrent comme des MESSAGES, pas directement dans
 * entries.text. C'est le meme chemin que ce qui est ecrit dans la conversation,
 * donc : elles remontent dans le fil aux bonnes dates, elles survivent a un
 * rebuildEntryText (qui recalcule entries.text depuis les messages et effacerait
 * un texte pose a cote), et il n'y a qu'un seul endroit ou le corpus se
 * fabrique. Deux chemins d'ecriture pour la meme donnee, c'est la garantie
 * qu'ils divergeront.
 */

import { db, rebuildEntryText, OWNER } from './db.js';

/* ---------- dates ---------- */

const MOIS = {
  janvier: 1, janv: 1, jan: 1, january: 1,
  fevrier: 2, fevr: 2, fev: 2, feb: 2, february: 2,
  mars: 3, mar: 3, march: 3,
  avril: 4, avr: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jun: 6, june: 6,
  juillet: 7, juil: 7, jul: 7, july: 7,
  aout: 8, aou: 8, aug: 8, august: 8,
  septembre: 9, sept: 9, sep: 9, september: 9,
  octobre: 10, oct: 10, october: 10,
  novembre: 11, nov: 11, november: 11,
  decembre: 12, dec: 12, december: 12
};

/** Sans accents ni casse : « Février », « fevrier » et « FÉVRIER » sont le meme mot. */
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/*
 * Jours de la semaine, en tete de ligne. Les formes longues passent AVANT les
 * courtes : sinon « mardi » se fait manger comme « mar » et laisse « di ».
 *
 * Et surtout, pas de joker apres l'abreviation. Un `[a-z]*` derriere `mar`
 * avalait « mars » -- toutes les dates en toutes lettres du mois de mars
 * partaient a la poubelle sans un mot.
 */
const JOURS = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lun|mar|mer|jeu|ven|sam|dim|mon|tue|wed|thu|fri|sat|sun)\.?,?\s+/i;

const pad = n => String(n).padStart(2, '0');

/** Valide un triplet et le rend en 'YYYY-MM-DD'. Rejette le 31 fevrier. */
function iso(y, m, d) {
  if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Reconnait une date en tete de ligne et rend { date, reste }.
 *
 * Le jour vient avant le mois en 12/03/2024 : c'est un outil ecrit en francais,
 * pour un journal tenu en francais. L'apercu affiche les dates interpretees en
 * clair, ce qui est la seule facon honnete de lever l'ambiguite -- une note en
 * bas de page ne serait jamais lue.
 */
export function parseDateLine(line) {
  const s = String(line).trim().replace(/^[-–—*•>#\s]+/, '');
  if (!s) return null;

  // On tente d'abord la chaine telle quelle. Retirer un jour de semaine en
  // premier ferait lire « mars 12, 2024 » comme « mardi » suivi de « 12, 2024 »,
  // et le nom du mois serait perdu. L'ordre est ce qui leve l'ambiguite, pas la
  // regex.
  const direct = formats(s);
  if (direct) return direct;

  const sansJour = s.replace(JOURS, '');
  return sansJour === s ? null : formats(sansJour);
}

function formats(s) {
  const suite = rest => rest.replace(/^\s*[-–—:,.]+\s*/, '').trim();

  // 2024-03-12  |  2024/03/12
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b(.*)$/);
  if (m) {
    const d = iso(+m[1], +m[2], +m[3]);
    if (d) return { date: d, reste: suite(m[4]) };
  }

  // 12/03/2024  |  12-03-2024  |  12.03.2024  |  12/03/24
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b(.*)$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y <= 68 ? 2000 : 1900;   // pivot POSIX
    const d = iso(y, +m[2], +m[1]);
    if (d) return { date: d, reste: suite(m[4]) };
  }

  // 12 mars 2024  |  12 mars 2024 :
  m = s.match(/^(\d{1,2})(?:er)?\s+([A-Za-zÀ-ÿ]+)\.?\s+(\d{4})\b(.*)$/);
  if (m) {
    const mo = MOIS[norm(m[2])];
    if (mo) {
      const d = iso(+m[3], mo, +m[1]);
      if (d) return { date: d, reste: suite(m[4]) };
    }
  }

  // mars 12, 2024  |  March 12 2024
  m = s.match(/^([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2}),?\s+(\d{4})\b(.*)$/);
  if (m) {
    const mo = MOIS[norm(m[1])];
    if (mo) {
      const d = iso(+m[3], mo, +m[2]);
      if (d) return { date: d, reste: suite(m[4]) };
    }
  }

  return null;
}

/**
 * Decoupe un bloc colle en journees datees.
 *
 * Une ligne-date ouvre une journee ; tout ce qui suit lui appartient jusqu'a la
 * date suivante. Ce qui precede la premiere date est ignore -- c'est un titre de
 * document, pas une journee, et l'attacher a la premiere date la salirait.
 *
 * Deux blocs portant la meme date sont recolles plutot que de s'ecraser : dans un
 * journal recopie a la main, une date qui revient est presque toujours un ajout
 * du soir, pas une correction.
 */
export function parseNotes(text) {
  const lignes = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const ordre = [];
  const par = new Map();
  const avant = [];
  let courant = null;

  for (const ligne of lignes) {
    const hit = parseDateLine(ligne);
    if (hit) {
      courant = hit.date;
      if (!par.has(courant)) { par.set(courant, []); ordre.push(courant); }
      if (hit.reste) par.get(courant).push(hit.reste);
      continue;
    }
    if (courant === null) { if (ligne.trim()) avant.push(ligne.trim()); continue; }
    par.get(courant).push(ligne);
  }

  const entries = [];
  for (const date of ordre) {
    const corps = par.get(date).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (corps) entries.push({ date, text: corps });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, ignore: avant.join('\n').trim() };
}

/* ---------- apercu ---------- */

const SOURCE = 'import';

/** Ce qui a deja ete importe pour cette journee, pour ne pas coller deux fois. */
function dejaImporte(userId, date) {
  return db.prepare(
    `SELECT text FROM messages WHERE user_id = ? AND date = ? AND source = ?`
  ).all(userId, date, SOURCE).map(r => r.text);
}

/**
 * Analyse sans rien ecrire. On montre ce qui va se passer plutot que de demander
 * de faire confiance -- meme regle que pour l'import CSV.
 */
export function inspectNotes(text, userId = OWNER) {
  const { entries, ignore } = parseNotes(text);

  let nouvelles = 0, ajouts = 0, identiques = 0;
  const apercu = entries.map(e => {
    const anciens = dejaImporte(userId, e.date);
    const etat = anciens.includes(e.text) ? 'identique'
               : anciens.length ? 'ajout'
               : 'nouvelle';
    if (etat === 'identique') identiques++;
    else if (etat === 'ajout') ajouts++;
    else nouvelles++;
    return {
      date: e.date,
      etat,
      mots: e.text.split(/\s+/).filter(Boolean).length,
      extrait: e.text.length > 120 ? e.text.slice(0, 117).trimEnd() + '…' : e.text
    };
  });

  return {
    total: entries.length,
    nouvelles, ajouts, identiques,
    first: entries.length ? entries[0].date : null,
    last: entries.length ? entries[entries.length - 1].date : null,
    mots: entries.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0),
    ignore: ignore.length > 200 ? ignore.slice(0, 197) + '…' : ignore,
    apercu,
    entries
  };
}

/* ---------- ecriture ---------- */

/**
 * Ecriture en une transaction. Un import a moitie applique laisserait un corpus
 * dont on ne sait plus ce qu'il contient, et le miroir mentirait sans le dire.
 *
 * L'horodatage est 21h00 heure locale du jour concerne : ces notes ont ete
 * ecrites le soir, et c'est l'ordre dans la journee qui compte, pas la minute.
 * Un ts a l'instant de l'import les ferait toutes remonter aujourd'hui dans le
 * fil, ce qui est exactement l'inverse du but.
 */
export function applyNotes(entries, userId = OWNER) {
  const ins = db.prepare(
    'INSERT INTO messages(user_id, ts, date, source, role, text) VALUES(?,?,?,?,?,?)'
  );

  const touchees = new Set();
  let ecrites = 0;

  db.exec('BEGIN');
  try {
    for (const e of entries ?? []) {
      if (!e?.date || !e?.text) continue;
      if (dejaImporte(userId, e.date).includes(e.text)) continue;   // deja colle
      ins.run(userId, `${e.date}T21:00:00.000Z`, e.date, SOURCE, 'user', e.text);
      touchees.add(e.date);
      ecrites++;
    }
    // Dans la MEME transaction que les insertions : entries.text est derive des
    // messages, et le recalculer apres coup laisserait, si le processus tombe
    // entre les deux, un corpus dont le miroir ne verrait que la moitie.
    for (const date of touchees) rebuildEntryText(date, userId);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }

  return { ecrites, journees: touchees.size };
}
