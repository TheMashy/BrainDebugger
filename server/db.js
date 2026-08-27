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

-- Motifs : ce que le compagnon a decide de suivre de lui-meme.
--
-- Ce ne sont pas des mots-cles. Un mot-cle se cherche ; un motif se reconnait,
-- et seul un modele peut dire que « bon bref c'etait rien » et « t'inquiete
-- j'ai l'habitude » sont deux fois la meme chose. La table stocke donc ce que
-- le compagnon a nomme, pas un lexique -- et le compte des fois ou il l'a
-- reconnu, qui est la seule mesure honnete de la duree d'un motif.
CREATE TABLE IF NOT EXISTS motifs (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT '${OWNER}',
  nom        TEXT NOT NULL,
  mecanisme  TEXT NOT NULL,
  teinte     INTEGER NOT NULL,         -- degres HSL, choisis par l'app
  cree_le    TEXT NOT NULL,
  vu_le      TEXT NOT NULL,
  vues       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_motifs_nom ON motifs(user_id, nom);

-- Quel message porte quel motif. C'est ce qui teinte le fil : la couleur suit
-- le message, elle ne suit pas la conversation entiere.
CREATE TABLE IF NOT EXISTS motif_vues (
  motif_id   INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  PRIMARY KEY (motif_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_motif_vues_msg ON motif_vues(message_id);

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
  contrastCenter: 'reference', // 'fixed5' (formule tableur) | 'reference' (glissante)
  // Debut du fil courant. « Nouveau chat » avance ce curseur : les messages
  // anterieurs quittent la conversation, mais RIEN n'est efface -- le texte des
  // journees reste dans le journal, et c'est lui que le miroir fouille et que
  // le compagnon garde en memoire. Effacer pour de bon des annees d'ecriture
  // sur un clic serait irreparable, et ce n'est pas ce qu'on demande a un
  // bouton qui sert a changer de sujet.
  chatSince: null             // ISO 8601, ou null = tout le fil
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
/**
 * Le fil courant. `since` borne le debut : c'est « Nouveau chat ».
 *
 * Les messages plus anciens ne sont pas supprimes, seulement hors du fil. Le
 * journal, lui, les garde -- c'est la difference entre changer de sujet et
 * effacer ce qu'on a ecrit.
 */
export function recentMessages(limit = 80, userId = OWNER) {
  const since = getSettings(userId).chatSince;
  const rows = since
    ? db.prepare('SELECT id, ts, date, source, role, text FROM messages WHERE user_id = ? AND ts >= ? ORDER BY ts DESC, id DESC LIMIT ?').all(userId, since, limit)
    : db.prepare('SELECT id, ts, date, source, role, text FROM messages WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?').all(userId, limit);
  return rows.reverse();
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

/**
 * Suppression d'une journee : la note, le texte, et les messages qui l'ont
 * produit. Les trois ensemble, sinon rebuildEntryText la ferait renaitre au
 * prochain message.
 */
export function deleteDay(date, userId = OWNER) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM messages WHERE user_id = ? AND date = ?').run(userId, date);
    db.prepare('DELETE FROM entries  WHERE user_id = ? AND date = ?').run(userId, date);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return true;
}

/** Efface la note d'une journee en gardant ce qui a ete ecrit ce jour-la. */
export function clearNote(date, userId = OWNER) {
  db.prepare('UPDATE entries SET note = NULL WHERE user_id = ? AND date = ?').run(userId, date);
  // Une journee qui n'a plus ni note ni texte n'a plus de raison d'exister.
  db.prepare(
    "DELETE FROM entries WHERE user_id = ? AND date = ? AND note IS NULL AND (text IS NULL OR TRIM(text) = '')"
  ).run(userId, date);
  return true;
}

/**
 * Remise a zero. Trois portees, de la plus etroite a la plus large.
 *
 * C'est la seule fonction du fichier qui detruit sans retour. Elle est
 * volontairement explicite : pas de valeur par defaut sur `portee`, pas de
 * suppression partielle silencieuse. Ce que l'appelant demande est ce qui part,
 * et le compte de ce qui a ete efface est rendu pour pouvoir le dire.
 */
export function wipe(portee, userId = OWNER) {
  const compte = {};
  const n = (t, sql, ...a) => { compte[t] = db.prepare(sql).run(...a).changes; };

  db.exec('BEGIN');
  try {
    if (portee === 'notes') {
      // Les notes seules : le texte reste, le journal ecrit survit.
      compte.notes = db.prepare('UPDATE entries SET note = NULL WHERE user_id = ? AND note IS NOT NULL').run(userId).changes;
      db.prepare("DELETE FROM entries WHERE user_id = ? AND note IS NULL AND (text IS NULL OR TRIM(text) = '')").run(userId);
    } else if (portee === 'texte') {
      // Le texte seul : les notes restent, la courbe survit.
      n('messages', 'DELETE FROM messages WHERE user_id = ?', userId);
      compte.texte = db.prepare('UPDATE entries SET text = NULL WHERE user_id = ? AND text IS NOT NULL').run(userId).changes;
      db.prepare('DELETE FROM entries WHERE user_id = ? AND note IS NULL').run(userId);
    } else if (portee === 'tout') {
      n('entries',    'DELETE FROM entries    WHERE user_id = ?', userId);
      n('messages',   'DELETE FROM messages   WHERE user_id = ?', userId);
      n('events',     'DELETE FROM events     WHERE user_id = ?', userId);
      n('anchors',    'DELETE FROM anchors    WHERE user_id = ?', userId);
      db.prepare('DELETE FROM motif_vues WHERE motif_id IN (SELECT id FROM motifs WHERE user_id = ?)').run(userId);
      n('motifs',     'DELETE FROM motifs     WHERE user_id = ?', userId);
      n('embeddings', 'DELETE FROM embeddings WHERE user_id = ?', userId);
      // Les reglages ne partent pas : le compagnon choisi, le timbre, la cle.
      // Remettre a zero son journal n'est pas redemander son prenom.
      db.prepare("DELETE FROM settings WHERE user_id = ? AND key = 'chatSince'").run(userId);
    } else {
      throw new Error(`portée inconnue : ${portee}`);
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return compte;
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

/* ---------- motifs ---------- */

/*
 * Les teintes, en degres HSL.
 *
 * Aucune n'est dans l'intervalle 0-150 : c'est celui de l'echelle des notes,
 * du rouge au vert. Un motif teinte en vert se lirait comme une bonne journee
 * et un motif rouge comme une mauvaise, alors qu'un motif ne dit rien de bon
 * ni de mauvais -- c'est une chose qui revient, pas une chose qui va mal.
 * Elles sont aussi espacees d'au moins 20 degres, faute de quoi deux motifs
 * differents se ressemblent a l'ecran.
 */
export const TEINTES = [262, 190, 322, 168, 226, 292, 205, 338, 248, 178];

export function allMotifs(userId = OWNER) {
  return db.prepare(
    'SELECT id, nom, mecanisme, teinte, cree_le, vu_le, vues FROM motifs WHERE user_id = ? ORDER BY vues DESC, id ASC'
  ).all(userId);
}

export function addMotif({ nom, mecanisme, userId = OWNER, quand = new Date().toISOString() }) {
  const deja = db.prepare('SELECT id FROM motifs WHERE user_id = ? AND nom = ?').get(userId, nom);
  if (deja) return { id: deja.id, existait: true };
  // La teinte suit l'ordre de creation, pas un hasard : deux motifs crees a la
  // suite doivent etre visiblement distincts, ce qu'un tirage ne garantit pas.
  const n = db.prepare('SELECT COUNT(*) c FROM motifs WHERE user_id = ?').get(userId).c;
  const info = db.prepare(
    'INSERT INTO motifs(user_id, nom, mecanisme, teinte, cree_le, vu_le, vues) VALUES(?,?,?,?,?,?,0)'
  ).run(userId, nom, mecanisme, TEINTES[n % TEINTES.length], quand, quand);
  return { id: Number(info.lastInsertRowid), existait: false };
}

/** Une occurrence : le motif remonte, et le message porte sa couleur. */
export function marquerMotif(motifId, messageId, userId = OWNER, quand = new Date().toISOString()) {
  const m = db.prepare('SELECT id, nom FROM motifs WHERE id = ? AND user_id = ?').get(motifId, userId);
  if (!m) return null;
  const info = db.prepare('INSERT OR IGNORE INTO motif_vues(motif_id, message_id) VALUES(?,?)').run(motifId, messageId);
  if (info.changes) {
    db.prepare('UPDATE motifs SET vues = vues + 1, vu_le = ? WHERE id = ?').run(quand, motifId);
  }
  return m;
}

/** Les motifs portes par une liste de messages : {messageId: [motif, ...]}. */
export function motifsDesMessages(ids, userId = OWNER) {
  if (!ids?.length) return {};
  const trous = ids.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT v.message_id, m.id, m.nom, m.teinte
    FROM motif_vues v JOIN motifs m ON m.id = v.motif_id
    WHERE m.user_id = ? AND v.message_id IN (${trous})
  `).all(userId, ...ids);
  const par = {};
  for (const r of rows) (par[r.message_id] ??= []).push({ id: r.id, nom: r.nom, teinte: r.teinte });
  return par;
}

export function deleteMotif(id, userId = OWNER) {
  const m = db.prepare('SELECT id FROM motifs WHERE id = ? AND user_id = ?').get(id, userId);
  if (!m) return false;
  db.prepare('DELETE FROM motif_vues WHERE motif_id = ?').run(id);
  db.prepare('DELETE FROM motifs WHERE id = ?').run(id);
  return true;
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
