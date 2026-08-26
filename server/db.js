import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.BD_DB ?? join(ROOT, 'data', 'braindebugger.db');

try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch (err) {
  // Cas classique sur un hébergeur : BD_DB pointe dans un volume qui n'a pas
  // été monté. Le message par défaut (EACCES sur un chemin) n'aide personne.
  console.error(`
  ────────────────────────────────────────────────────────────
  BASE DE DONNÉES INACCESSIBLE

  Impossible de créer ${dirname(DB_PATH)} (${err.code ?? err.message}).

  BD_DB=${DB_PATH} pointe dans un répertoire où le processus ne peut pas
  écrire. Sur un hébergeur, monte un volume sur ce chemin avant de déployer,
  ou laisse BD_DB vide pour utiliser ./data (perdu à chaque redéploiement).
  ────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  date TEXT PRIMARY KEY,          -- 'YYYY-MM-DD'
  note REAL,                      -- 0..10, nullable
  text TEXT                       -- concatenation des messages utilisateur du jour
);

CREATE TABLE IF NOT EXISTS messages (
  id     INTEGER PRIMARY KEY,
  ts     TEXT NOT NULL,           -- ISO 8601
  date   TEXT NOT NULL,           -- 'YYYY-MM-DD', jour de rattachement
  source TEXT,                    -- 'web' | 'discord'
  role   TEXT NOT NULL,           -- 'user' | 'pet'
  text   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);

CREATE TABLE IF NOT EXISTS events (
  id    INTEGER PRIMARY KEY,
  date  TEXT NOT NULL,
  label TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

-- Ancres d'etalonnage : la legende de l'echelle, dans les mots de l'utilisateur.
-- Affichee au moment de noter pour limiter la derive pluriannuelle (SPEC 10.1).
CREATE TABLE IF NOT EXISTS anchors (
  note  INTEGER PRIMARY KEY,      -- 0..10
  label TEXT NOT NULL,
  descr TEXT
);

CREATE TABLE IF NOT EXISTS embeddings (   -- phase 2
  date TEXT PRIMARY KEY,
  vec  BLOB
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL             -- JSON
);
`);

/* ---------- settings ---------- */

export const DEFAULT_SETTINGS = {
  petName: 'Cerf',
  petSprite: 'deer',          // id integre, ou 'custom'
  petImage: null,             // data URL si petSprite === 'custom'
  blipEnabled: true,          // la voix du compagnon : un blip par syllabe
  blipVoice: 'aa',            // identifiant de timbre (voir web/blips.js)
  blipPitch: 1,               // 0.6 .. 1.6
  blipVolume: 0.7,            // 0 .. 1
  chatBackend: 'scripted',    // 'scripted' | 'anthropic' | 'ollama'
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  apiKey: '',                 // cle Anthropic ; repli sur ANTHROPIC_API_KEY
  anthropicModel: 'claude-opus-5',
  anthropicEffort: 'low',     // 'low' | 'medium' | 'high' -- latence contre profondeur
  memoryDays: 14,             // journees passees transmises au compagnon (0 = aucune)
  floor: 2,                   // SPEC 4.1 - sous ce seuil, aucune statistique
  floorMode: 'fixed',         // 'fixed' | 'relative' (reference - 3)
  sustain: 2,                 // jours consecutifs >= reference pour valider un retour
  etalon: 5.7,                // constante de calage du cumul (null = mediane globale)
  cumMode: 'etalon',          // 'etalon' | 'reference'
  contrastCenter: 'reference' // 'fixed5' (formule tableur) | 'reference' (glissante)
};

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const stored = new Set(rows.map(r => r.key));
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore */ }
  }
  // Une cle fournie par l'environnement et aucun backend choisi : on part sur
  // Claude. Sinon la cle est en place, tout fonctionne, et il faut quand meme
  // deviner qu'il reste une case a cocher quelque part.
  if (!stored.has('chatBackend') && process.env.ANTHROPIC_API_KEY) out.chatBackend = 'anthropic';
  return out;
}

/**
 * Version transmissible au navigateur.
 * La cle API n'en fait JAMAIS partie : elle est stockee en base et n'a aucune
 * raison de repartir vers le client a chaque chargement. On envoie seulement
 * de quoi afficher son etat.
 */
export function publicSettings(s = getSettings()) {
  const { apiKey, ...rest } = s;
  return {
    ...rest,
    hasStoredKey: !!apiKey,
    hasEnvKey: !!process.env.ANTHROPIC_API_KEY,
    keySource: apiKey ? 'stored' : (process.env.ANTHROPIC_API_KEY ? 'env' : 'none')
  };
}

export function setSettings(patch) {
  const stmt = db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    stmt.run(k, JSON.stringify(v));
  }
  return getSettings();
}

/* ---------- entries ---------- */

export function allEntries() {
  return db.prepare('SELECT date, note, text FROM entries ORDER BY date ASC').all();
}

export function getEntry(date) {
  return db.prepare('SELECT date, note, text FROM entries WHERE date = ?').get(date) ?? null;
}

export function setNote(date, note) {
  db.prepare(`
    INSERT INTO entries(date, note) VALUES(?, ?)
    ON CONFLICT(date) DO UPDATE SET note = excluded.note
  `).run(date, note);
  return getEntry(date);
}

/**
 * entries.text est la concatenation des messages *utilisateur* du jour.
 * SPEC 4.3 : les mots exacts. On ne stocke jamais les phrases du pet
 * dans le corpus qui sera rendu a l'utilisateur.
 */
export function rebuildEntryText(date) {
  const rows = db.prepare(
    "SELECT text FROM messages WHERE date = ? AND role = 'user' ORDER BY ts ASC"
  ).all(date);
  const text = rows.map(r => r.text).join('\n');
  db.prepare(`
    INSERT INTO entries(date, text) VALUES(?, ?)
    ON CONFLICT(date) DO UPDATE SET text = excluded.text
  `).run(date, text);
  return text;
}

/* ---------- messages ---------- */

export function addMessage({ ts, date, source = 'web', role, text }) {
  const info = db.prepare(
    'INSERT INTO messages(ts, date, source, role, text) VALUES(?,?,?,?,?)'
  ).run(ts, date, source, role, text);
  if (role === 'user') rebuildEntryText(date);
  return Number(info.lastInsertRowid);
}

/**
 * Le fil, en continu. Une conversation qui repart de zero chaque matin n'est
 * pas une conversation : on revient vers quelqu'un qu'on connait, pas vers un
 * formulaire quotidien. Le changement de jour devient un simple repere dans le
 * fil, pas une coupure.
 */
export function recentMessages(limit = 80) {
  return db.prepare(
    'SELECT id, ts, date, source, role, text FROM messages ORDER BY ts DESC, id DESC LIMIT ?'
  ).all(limit).reverse();
}

export function messagesForDate(date) {
  return db.prepare(
    'SELECT id, ts, source, role, text FROM messages WHERE date = ? ORDER BY ts ASC'
  ).all(date);
}

export function recentUserMessages(limit = 40) {
  return db.prepare(
    "SELECT id, ts, date, role, text FROM messages WHERE role = 'user' ORDER BY ts DESC LIMIT ?"
  ).all(limit).reverse();
}

/* ---------- events ---------- */

export function allEvents() {
  return db.prepare('SELECT id, date, label FROM events ORDER BY date ASC').all();
}
export function addEvent(date, label) {
  const info = db.prepare('INSERT INTO events(date, label) VALUES(?,?)').run(date, label);
  return { id: Number(info.lastInsertRowid), date, label };
}
export function deleteEvent(id) {
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
}

/* ---------- anchors ---------- */

export function allAnchors() {
  return db.prepare('SELECT note, label, descr FROM anchors ORDER BY note DESC').all();
}
export function setAnchor(note, label, descr) {
  db.prepare(`
    INSERT INTO anchors(note, label, descr) VALUES(?,?,?)
    ON CONFLICT(note) DO UPDATE SET label = excluded.label, descr = excluded.descr
  `).run(note, label, descr);
}
