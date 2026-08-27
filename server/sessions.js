/**
 * Ouvertures et fermetures de la fenetre.
 *
 * Pourquoi le compagnon a besoin de le savoir : sans cette notion, il traite
 * identiquement quelqu'un qui ferme et rouvre deux minutes plus tard et
 * quelqu'un qui revient apres trois semaines. Dans le premier cas il redit
 * bonjour au milieu d'une phrase ; dans le second il enchaine comme si de rien
 * n'etait. Les deux cassent l'illusion de quelqu'un en face.
 *
 * Ce qu'il en fait, en revanche, est strictement borne (voir chat.js) : le fait
 * NUANCE le ton, il ne devient jamais un sujet. « Ca fait longtemps », « tu
 * n'es pas venu hier », « content de te revoir » sont exactement ce que ce
 * produit ne fait pas -- quelqu'un qui n'ouvre pas son journal pendant deux
 * semaines n'a pas besoin qu'on le lui compte au retour.
 *
 * La fermeture est best-effort : un navigateur tue peut ne jamais l'envoyer. On
 * n'en depend donc jamais pour raisonner -- seule l'ouverture fait foi, et une
 * session laissee ouverte est refermee a l'ouverture suivante.
 */

import { db, OWNER } from './db.js';

export function ensureSessionTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id        INTEGER PRIMARY KEY,
      user_id   TEXT NOT NULL,
      opened_at TEXT NOT NULL,     -- ISO 8601
      closed_at TEXT               -- NULL tant qu'on n'a pas vu la fermeture
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, opened_at);
  `);
}

const derniere = userId => db.prepare(
  'SELECT id, opened_at, closed_at FROM sessions WHERE user_id = ? ORDER BY opened_at DESC LIMIT 1'
).get(userId) ?? null;

/**
 * Ouvre une session et rend ce qu'il faut savoir de la precedente.
 * @returns {{previousEnd: string|null, gapMinutes: number|null, first: boolean}}
 */
export function open(userId = OWNER, now = new Date().toISOString()) {
  ensureSessionTable();
  const prec = derniere(userId);

  // Une session sans fermeture connue : le navigateur a ete tue, ou la balise
  // de fermeture s'est perdue. On la referme a l'instant de sa derniere trace
  // plutot que maintenant, sinon toute absence serait comptee comme presence.
  if (prec && !prec.closed_at) {
    db.prepare('UPDATE sessions SET closed_at = ? WHERE id = ?').run(prec.opened_at, prec.id);
  }

  const fin = prec ? (prec.closed_at ?? prec.opened_at) : null;
  const gapMinutes = fin ? Math.max(0, Math.round((Date.parse(now) - Date.parse(fin)) / 60000)) : null;

  db.prepare('INSERT INTO sessions(user_id, opened_at) VALUES(?, ?)').run(userId, now);
  return { previousEnd: fin, gapMinutes, first: !prec };
}

/** Ferme la session en cours. Sans effet s'il n'y en a pas -- c'est normal. */
export function close(userId = OWNER, now = new Date().toISOString()) {
  ensureSessionTable();
  const prec = derniere(userId);
  if (!prec || prec.closed_at) return false;
  db.prepare('UPDATE sessions SET closed_at = ? WHERE id = ?').run(now, prec.id);
  return true;
}

/**
 * Etat de presence, tel qu'il sera donne au modele.
 *
 * Les seuils ne sont pas decoratifs. En dessous de 30 minutes, c'est la meme
 * visite : un onglet ferme par megarde, un telephone verrouille. Au-dela d'un
 * jour, la journee a change et le fil aussi. Entre les deux, c'est la meme
 * journee mais un autre moment -- on est revenu, ce qui n'est pas rien.
 */
export function presence(userId = OWNER, now = new Date().toISOString()) {
  ensureSessionTable();
  const prec = db.prepare(
    'SELECT opened_at, closed_at FROM sessions WHERE user_id = ? ORDER BY opened_at DESC LIMIT 1 OFFSET 1'
  ).get(userId);
  if (!prec) return { kind: 'first', minutes: null };

  const fin = prec.closed_at ?? prec.opened_at;
  const minutes = Math.max(0, Math.round((Date.parse(now) - Date.parse(fin)) / 60000));

  const kind = minutes < 30      ? 'continue'
             : minutes < 60 * 24 ? 'meme-jour'
             : minutes < 60 * 24 * 7  ? 'jours'
             : minutes < 60 * 24 * 30 ? 'semaines'
             : 'longtemps';
  return { kind, minutes, days: Math.round(minutes / 1440) };
}

/**
 * La phrase donnee au modele. Volontairement seche et factuelle : c'est un
 * repere de ton, pas un scenario. L'instruction qui l'accompagne (chat.js) lui
 * interdit d'en parler.
 */
const GARDE = `Tu ne le mentionnes jamais, ni directement ni en creux. Pas de « ça faisait
longtemps », pas de « content de te revoir », pas de « tu n'es pas venu hier ». Quelqu'un qui
n'ouvre pas son journal pendant deux semaines n'a pas besoin qu'on le lui compte au retour :
c'est le meilleur moyen qu'il ne revienne pas du tout. Ça nuance ton ton, ça n'est pas un sujet.`;

export function presenceNote(p) {
  if (!p || p.kind === 'first') return null;
  const fait =
    p.kind === 'continue'  ? "Il vient de rouvrir la fenêtre : c'est la même visite, pas une nouvelle. Ne le resalue pas, reprends au milieu."
  : p.kind === 'meme-jour' ? 'Il revient plus tard dans la même journée.'
  : p.kind === 'jours'     ? `Sa dernière visite remonte à ${p.days} jour${p.days > 1 ? 's' : ''}.`
  : p.kind === 'semaines'  ? `Sa dernière visite remonte à ${p.days} jours.`
  :                          "Il n'est pas venu depuis plus d'un mois.";
  return `Contexte de présence — ${fait}\n\n${GARDE}`;
}
