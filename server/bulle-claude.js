/**
 * LA BULLE DE CLAUDE CODE — LE RELAIS DES SESSIONS DANS LE CLOUD.
 *
 * « Une bulle de statut quand Claude réfléchit : rouge quand quelque chose
 * est bloqué et attend une confirmation, jaune quand il travaille, vert quand
 * c'est fini. » Une session Claude Code qui tourne dans le cloud ne peut pas
 * joindre le PC ; elle peut joindre ce site. Ses crochets (« hooks ») y posent
 * l'étape où elle en est (POST /api/machitool/claude, avec la clé de la
 * bulle) ; Machi Tool vient la lire (GET, avec la clé de la passerelle) et
 * l'affiche sur le panneau LED.
 *
 * Rien n'est écrit sur le disque : la dernière étape de chaque session, en
 * mémoire, trois heures au plus. Et rien de ce que Claude lit ou écrit : le
 * nom de l'étape, l'outil, le type de notification (et son court message),
 * le nom du dossier.
 */

const GARDE_MS = 3 * 3600 * 1000;
const SESSIONS_MAX = 20;
const CHAMPS = { hook_event_name: 40, session_id: 80, notification_type: 40, tool_name: 60, message: 120,
                 dossier: 40 };

const PAR_PERSONNE = new Map();          // userId -> Map(session -> étape)

/** Une étape d'une session arrive. `SessionEnd` l'efface. */
export function poserEtape(userId, corps, maintenant = Date.now()) {
  const nom = String(corps?.hook_event_name ?? '').slice(0, CHAMPS.hook_event_name);
  const session = String(corps?.session_id ?? '').slice(0, CHAMPS.session_id);
  if (!nom || !session) return { erreur: 'étape ou session manquante' };
  let sessions = PAR_PERSONNE.get(userId);
  if (!sessions) PAR_PERSONNE.set(userId, sessions = new Map());
  sessions.delete(session);
  if (nom === 'SessionEnd') return { ok: true };
  const etape = { quand: maintenant };
  for (const [champ, longueur] of Object.entries(CHAMPS)) {
    if (corps[champ] != null) etape[champ] = String(corps[champ]).slice(0, longueur);
  }
  sessions.set(session, etape);                     // la plus récente en dernier
  while (sessions.size > SESSIONS_MAX) sessions.delete(sessions.keys().next().value);
  return { ok: true };
}

/** Les sessions de quelqu'un : leur dernière étape, et depuis combien de secondes. */
export function lireEtapes(userId, maintenant = Date.now()) {
  const sessions = PAR_PERSONNE.get(userId);
  if (!sessions) return [];
  const r = [];
  for (const [session, { quand, ...etape }] of sessions) {
    if (maintenant - quand > GARDE_MS) { sessions.delete(session); continue; }
    r.push({ ...etape, age_s: Math.max(0, Math.round((maintenant - quand) / 1000)) });
  }
  return r;
}

/** Pour les tests. */
export function oublierTout() {
  PAR_PERSONNE.clear();
}
