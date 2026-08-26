/**
 * Import de l'historique tableur -- SPEC 8, etape 1.
 *
 * Format attendu (export Google Sheets de la grille annuelle) :
 *   - une ligne dont la 1re cellule est une annee sur 4 chiffres ouvre un bloc
 *   - dans ce bloc, une ligne dont la 1re cellule est un mois abrege (Jan..Dec)
 *     porte les notes des jours 1..31 dans les colonnes 1..31
 *   - les cellules "8 Good" + description adjacente sont lues comme ancres
 *     d'etalonnage (SPEC 10.1)
 *
 * Usage : node server/import-csv.js <fichier.csv> [--dry]
 */
import { readFileSync } from 'node:fs';
import { db, setAnchor } from './db.js';

/** Parseur CSV RFC4180 : gere les guillemets, virgules et retours ligne echappes. */
export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const MONTHS = {
  jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, avr: 4, may: 5, mai: 5, jun: 6, juin: 6,
  jul: 7, juil: 7, aug: 8, aou: 8, sep: 9, oct: 10, nov: 11, dec: 12
};

const norm = s => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
/** "6,35" (decimale francaise) ou "6.35" -> 6.35 ; vide/non numerique -> null */
const num = s => {
  const t = (s ?? '').trim().replace(',', '.');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};

export function extractFromRows(rows) {
  const entries = [];
  const anchors = [];
  let year = null;

  for (const row of rows) {
    const c0 = (row[0] ?? '').trim();

    if (/^(19|20)\d{2}$/.test(c0)) { year = Number(c0); continue; }

    // ancres d'etalonnage : cellule "8 Good" suivie d'une description
    for (let i = 1; i < row.length; i++) {
      const m = (row[i] ?? '').trim().match(/^(\d{1,2})\s+([A-Za-zÀ-ſ][A-Za-zÀ-ſ ]*)$/);
      if (!m) continue;
      const note = Number(m[1]);
      if (note < 0 || note > 10) continue;
      let descr = '';
      for (let j = i + 1; j < row.length; j++) {
        if ((row[j] ?? '').trim()) { descr = row[j].trim().replace(/\s*\n\s*/g, ' '); break; }
      }
      anchors.push({ note, label: m[2].trim(), descr });
    }

    const mo = MONTHS[norm(c0)];
    if (!mo || year === null) continue;

    const daysInMonth = new Date(Date.UTC(year, mo, 0)).getUTCDate();
    for (let d = 1; d <= 31; d++) {
      const v = num(row[d]);
      if (v === null) continue;
      if (d > daysInMonth) continue;      // 30 fevrier & co : cellule parasite
      if (v < 0 || v > 10) continue;
      const date = `${year}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      entries.push({ date, note: v });
    }
  }
  // derniere occurrence gagne, puis tri
  const dedup = new Map();
  for (const e of entries) dedup.set(e.date, e.note);
  return {
    entries: [...dedup.entries()].map(([date, note]) => ({ date, note })).sort((a, b) => a.date < b.date ? -1 : 1),
    anchors
  };
}

export function importFile(path, { dry = false } = {}) {
  const { entries, anchors } = extractFromRows(parseCSV(readFileSync(path, 'utf8')));

  if (!dry) {
    const stmt = db.prepare(`
      INSERT INTO entries(date, note) VALUES(?, ?)
      ON CONFLICT(date) DO UPDATE SET note = excluded.note
    `);
    db.exec('BEGIN');
    try {
      for (const e of entries) stmt.run(e.date, e.note);
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); throw err; }

    const seen = new Set();
    for (const a of anchors) {
      if (seen.has(a.note)) continue;
      seen.add(a.note);
      setAnchor(a.note, a.label, a.descr);
    }
  }
  return { entries, anchors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) { console.error('usage: node server/import-csv.js <fichier.csv> [--dry]'); process.exit(1); }
  const dry = process.argv.includes('--dry');
  const { entries, anchors } = importFile(path, { dry });

  const byYear = {};
  for (const e of entries) {
    const y = e.date.slice(0, 4);
    (byYear[y] ??= []).push(e.note);
  }
  console.log(`${dry ? '[dry] ' : ''}${entries.length} journees importees`);
  for (const [y, ns] of Object.entries(byYear)) {
    const avg = ns.reduce((a, b) => a + b, 0) / ns.length;
    console.log(`  ${y} : ${String(ns.length).padStart(3)} jours, moyenne ${avg.toFixed(3)}`);
  }
  if (anchors.length) {
    console.log('ancres d\'etalonnage :');
    for (const a of anchors) console.log(`  ${a.note} ${a.label} -> ${a.descr}`);
  }
}
