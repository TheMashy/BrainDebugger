import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, ensureUserTables, OWNER } from './migrate.js';
export { OWNER };

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

// Schema cible : multi-comptes. Chaque table porte user_id, et les cles
// naturelles (date, note, key) sont composites avec lui -- deux personnes ont
// chacune leur 2026-08-26.
//
// Sur une base creee avant les comptes, ces CREATE ... IF NOT EXISTS ne font
// rien : les tables existent deja, a l'ancienne forme. C'est migrate() juste
// en dessous qui les reecrit. Une base neuve, elle, nait directement a la
// bonne forme et n'a rien a migrer.
db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  date    TEXT NOT NULL,          -- 'YYYY-MM-DD'
  note    REAL,                   -- 0..10, nullable
  text    TEXT,                   -- concatenation des messages utilisateur du jour
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  ts      TEXT NOT NULL,          -- ISO 8601
  date    TEXT NOT NULL,          -- 'YYYY-MM-DD', jour de rattachement
  source  TEXT,                   -- 'web' | 'discord'
  role    TEXT NOT NULL,          -- 'user' | 'pet'
  text    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);

CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  date    TEXT NOT NULL,
  label   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

-- Ancres d'etalonnage : la legende de l'echelle, dans les mots de l'utilisateur.
-- Affichee au moment de noter pour limiter la derive pluriannuelle (SPEC 10.1).
CREATE TABLE IF NOT EXISTS anchors (
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  note    INTEGER NOT NULL,       -- 0..10
  label   TEXT NOT NULL,
  descr   TEXT,
  PRIMARY KEY (user_id, note)
);

CREATE TABLE IF NOT EXISTS embeddings (   -- phase 2
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  date    TEXT NOT NULL,
  vec     BLOB,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,          -- JSON
  PRIMARY KEY (user_id, key)
);
`);

const _m = migrate(db);
if (_m.migrated) console.log('  base migrée vers le mode multi-utilisateurs');
ensureUserTables(db);

/* ---------- utilisateurs ---------- */

export function upsertUser({ id, username, avatar }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users(id, username, avatar, created_at, seen_at) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET username = excluded.username,
                                  avatar   = excluded.avatar,
                                  seen_at  = excluded.seen_at
  `).run(id, username ?? null, avatar ?? null, now, now);
  return getUser(id);
}
export const getUser = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
export const countUsers = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;

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

export function getSettings(userId = OWNER) {
  const rows = db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId);
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
    // Meme ordre que resolveKey() dans chat.js. Deux endroits qui repondent
    // « quelle cle sert ? » differemment, c'est une interface qui ment.
    keySource: process.env.ANTHROPIC_API_KEY ? 'env' : (apiKey ? 'stored' : 'none')
  };
}

export function setSettings(patch, userId = OWNER) {
  const stmt = db.prepare(
    'INSERT INTO settings(user_id, key, value) VALUES(?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    stmt.run(userId, k, JSON.stringify(v));
  }
  return getSettings(userId);
}

/* ---------- entries ---------- */

export function allEntries(userId = OWNER) {
  return db.prepare('SELECT date, note, text FROM entries WHERE user_id = ? ORDER BY date ASC').all(userId);
}

export function getEntry(date, userId = OWNER) {
  return db.prepare('SELECT date, note, text FROM entries WHERE user_id = ? AND date = ?').get(userId, date) ?? null;
}

export function setNote(date, note, userId = OWNER) {
  db.prepare(`
    INSERT INTO entries(user_id, date, note) VALUES(?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET note = excluded.note
  `).run(userId, date, note);
  return getEntry(date, userId);
}

/**
 * entries.text est la concatenation des messages *utilisateur* du jour.
 * SPEC 4.3 : les mots exacts. On ne stocke jamais les phrases du pet
 * dans le corpus qui sera rendu a l'utilisateur.
 */
export function rebuildEntryText(date, userId = OWNER) {
  const rows = db.prepare(
    "SELECT text FROM messages WHERE user_id = ? AND date = ? AND role = 'user' ORDER BY ts ASC"
  ).all(userId, date);
  const text = rows.map(r => r.text).join('\n');
  db.prepare(`
    INSERT INTO entries(user_id, date, text) VALUES(?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET text = excluded.text
  `).run(userId, date, text);
  return text;
}

/* ---------- messages ---------- */

export function addMessage({ ts, date, source = 'web', role, text, userId = OWNER }) {
  const info = db.prepare(
    'INSERT INTO messages(user_id, ts, date, source, role, text) VALUES(?,?,?,?,?,?)'
  ).run(userId, ts, date, source, role, text);
  if (role === 'user') rebuildEntryText(date, userId);
  return Number(info.lastInsertRowid);
}

/**
 * Le fil, en continu. Une conversation qui repart de zero chaque matin n'est
 * pas une conversation : on revient vers quelqu'un qu'on connait, pas vers un
 * formulaire quotidien. Le changement de jour devient un simple repere dans le
 * fil, pas une coupure.
 */
export function recentMessages(limit = 80, userId = OWNER) {
  return db.prepare(
    'SELECT id, ts, date, source, role, text FROM messages WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?'
  ).all(userId, limit).reverse();
}

export function messagesForDate(date, userId = OWNER) {
  return db.prepare(
    'SELECT id, ts, source, role, text FROM messages WHERE user_id = ? AND date = ? ORDER BY ts ASC'
  ).all(userId, date);
}

export function recentUserMessages(limit = 40, userId = OWNER) {
  return db.prepare(
    "SELECT id, ts, date, role, text FROM messages WHERE user_id = ? AND role = 'user' ORDER BY ts DESC LIMIT ?"
  ).all(userId, limit).reverse();
}

/* ---------- events ---------- */

export function allEvents(userId = OWNER) {
  return db.prepare('SELECT id, date, label FROM events WHERE user_id = ? ORDER BY date ASC').all(userId);
}
export function addEvent(date, label, userId = OWNER) {
  const info = db.prepare('INSERT INTO events(user_id, date, label) VALUES(?,?,?)').run(userId, date, label);
  return { id: Number(info.lastInsertRowid), date, label };
}
export function deleteEvent(id, userId = OWNER) {
  // filtre sur l'utilisateur : un identifiant devine ne doit pas suffire
  db.prepare('DELETE FROM events WHERE id = ? AND user_id = ?').run(id, userId);
}

/* ---------- anchors ---------- */

export function allAnchors(userId = OWNER) {
  return db.prepare('SELECT note, label, descr FROM anchors WHERE user_id = ? ORDER BY note DESC').all(userId);
}
export function setAnchor(note, label, descr, userId = OWNER) {
  db.prepare(`
    INSERT INTO anchors(user_id, note, label, descr) VALUES(?,?,?,?)
    ON CONFLICT(user_id, note) DO UPDATE SET label = excluded.label, descr = excluded.descr
  `).run(userId, note, label, descr);
}
