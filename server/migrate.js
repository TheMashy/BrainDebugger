/**
 * Passage mono-utilisateur -> multi-utilisateurs.
 *
 * Quatre tables ont une cle primaire naturelle (entries.date, anchors.note,
 * settings.key, embeddings.date) qui doit devenir composite avec l'utilisateur.
 * SQLite ne sait pas modifier une cle primaire : il faut recreer, recopier,
 * renommer. Le tout dans une transaction -- une migration a moitie appliquee
 * sur des annees de journal serait irreparable.
 *
 * Les donnees existantes sont attribuees a OWNER. Au premier login Discord,
 * ce lot est reattribue a ce compte : c'est l'instance de quelqu'un qui
 * l'ouvre a d'autres, pas une base vierge.
 */

export const OWNER = 'local';

const hasColumn = (db, table, col) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);

const tableExists = (db, name) =>
  !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(name);

export function migrate(db) {
  if (!tableExists(db, 'entries') || hasColumn(db, 'entries', 'user_id')) {
    ensureUserTables(db);
    return { migrated: false };
  }

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    // --- tables a cle primaire composite : recreation ---
    db.exec(`
      CREATE TABLE entries_new (
        user_id TEXT NOT NULL DEFAULT '${OWNER}',
        date    TEXT NOT NULL,
        note    REAL,
        text    TEXT,
        PRIMARY KEY (user_id, date)
      );
      INSERT INTO entries_new(user_id, date, note, text)
        SELECT '${OWNER}', date, note, text FROM entries;
      DROP TABLE entries;
      ALTER TABLE entries_new RENAME TO entries;

      CREATE TABLE anchors_new (
        user_id TEXT NOT NULL DEFAULT '${OWNER}',
        note    INTEGER NOT NULL,
        label   TEXT NOT NULL,
        descr   TEXT,
        PRIMARY KEY (user_id, note)
      );
      INSERT INTO anchors_new(user_id, note, label, descr)
        SELECT '${OWNER}', note, label, descr FROM anchors;
      DROP TABLE anchors;
      ALTER TABLE anchors_new RENAME TO anchors;

      CREATE TABLE settings_new (
        user_id TEXT NOT NULL DEFAULT '${OWNER}',
        key     TEXT NOT NULL,
        value   TEXT NOT NULL,
        PRIMARY KEY (user_id, key)
      );
      INSERT INTO settings_new(user_id, key, value)
        SELECT '${OWNER}', key, value FROM settings;
      DROP TABLE settings;
      ALTER TABLE settings_new RENAME TO settings;

      CREATE TABLE embeddings_new (
        user_id TEXT NOT NULL DEFAULT '${OWNER}',
        date    TEXT NOT NULL,
        vec     BLOB,
        PRIMARY KEY (user_id, date)
      );
      INSERT INTO embeddings_new(user_id, date, vec)
        SELECT '${OWNER}', date, vec FROM embeddings;
      DROP TABLE embeddings;
      ALTER TABLE embeddings_new RENAME TO embeddings;
    `);

    // --- tables a cle auto-incrementee : une colonne suffit ---
    db.exec(`ALTER TABLE messages ADD COLUMN user_id TEXT NOT NULL DEFAULT '${OWNER}'`);
    db.exec(`ALTER TABLE events   ADD COLUMN user_id TEXT NOT NULL DEFAULT '${OWNER}'`);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw new Error(`Migration multi-utilisateurs échouée : ${err.message}`);
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }

  ensureUserTables(db);
  return { migrated: true };
}

/** Tables qui n'existaient pas du tout avant, plus les index de cloisonnement. */
export function ensureUserTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id         TEXT PRIMARY KEY,      -- identifiant Discord, ou 'local'
      username   TEXT,
      avatar     TEXT,
      created_at TEXT NOT NULL,
      seen_at    TEXT,
      allowance  INTEGER                -- jetons par mois ; NULL = valeur par defaut
    );

    -- Comptage des jetons. Une ligne par appel : on garde le detail pour
    -- pouvoir expliquer un compteur, pas seulement l'afficher.
    CREATE TABLE IF NOT EXISTS usage (
      id            INTEGER PRIMARY KEY,
      user_id       TEXT NOT NULL,
      ts            TEXT NOT NULL,
      month         TEXT NOT NULL,      -- 'YYYY-MM', pour l'agregation
      model         TEXT,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage(user_id, month);

    CREATE INDEX IF NOT EXISTS idx_messages_user_date ON messages(user_id, date);
    CREATE INDEX IF NOT EXISTS idx_events_user_date   ON events(user_id, date);
  `);
}

/**
 * Premier login Discord sur une instance qui contenait deja un journal :
 * ce journal appartient a la personne qui deploie, pas a un fantome.
 */
export function claimOwnerData(db, userId) {
  if (userId === OWNER) return 0;
  const has = db.prepare(`SELECT COUNT(*) c FROM entries WHERE user_id = ?`).get(OWNER).c
            + db.prepare(`SELECT COUNT(*) c FROM messages WHERE user_id = ?`).get(OWNER).c;
  if (!has) return 0;
  db.exec('BEGIN');
  try {
    for (const t of ['entries', 'messages', 'events', 'anchors', 'settings', 'embeddings']) {
      db.prepare(`UPDATE ${t} SET user_id = ? WHERE user_id = ?`).run(userId, OWNER);
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return has;
}
