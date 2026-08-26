import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Verrou mot de passe, mono-utilisateur.
 *
 * En local (127.0.0.1) il n'y a rien a proteger : seul l'utilisateur de la
 * machine peut joindre le serveur. Des que l'app ecoute sur une interface
 * publique, l'absence de verrou expose un journal intime a quiconque connait
 * l'URL. Le serveur REFUSE alors de demarrer sans BD_PASSWORD -- echouer au
 * lancement est le seul comportement acceptable ici, une note dans un README
 * ne protege personne.
 */

const COOKIE = 'bd_session';
const MAX_AGE = 30 * 24 * 3600;                  // 30 jours
const SECRET = process.env.BD_SECRET
  || (process.env.BD_PASSWORD ? `derived:${process.env.BD_PASSWORD}` : randomBytes(32).toString('hex'));

export const PASSWORD = process.env.BD_PASSWORD ?? null;
export const isLoopback = host => ['127.0.0.1', '::1', 'localhost'].includes(host);

/** Le verrou n'est actif que s'il y a un mot de passe a verifier. */
export const enabled = () => !!PASSWORD;

function sign(issued) {
  return createHmac('sha256', SECRET).update(String(issued)).digest('hex');
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  if (A.length !== B.length) return false;
  return timingSafeEqual(A, B);
}

/** La session porte desormais l'identifiant : c'est elle qui dit QUI ecrit. */
export function issueCookie(secure, userId = 'local') {
  const issued = Date.now();
  const payload = `${userId}:${issued}`;
  const value = `${payload}.${sign(payload)}`;
  return [
    `${COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${MAX_AGE}`,
    secure ? 'Secure' : null
  ].filter(Boolean).join('; ');
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

/** @returns {string|null} l'identifiant de session, ou null si absente/invalide */
export function sessionUser(req) {
  const raw = req.headers.cookie ?? '';
  const hit = raw.split(';').map(c => c.trim()).find(c => c.startsWith(`${COOKIE}=`));
  if (!hit) return null;
  const value = hit.slice(COOKIE.length + 1);
  const dot = value.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = value.slice(0, dot), sig = value.slice(dot + 1);
  const sep = payload.lastIndexOf(':');
  if (sep < 0) return null;
  const userId = payload.slice(0, sep), issued = Number(payload.slice(sep + 1));
  if (!userId || !Number.isFinite(issued)) return null;
  if (Date.now() - issued > MAX_AGE * 1000) return null;
  return safeEqual(sig, sign(payload)) ? userId : null;
}

export function isAuthed(req) {
  if (!enabled()) return true;
  return sessionUser(req) !== null;
}

/* Freinage des tentatives : rien de sophistique, juste de quoi rendre une
   attaque par force brute impraticable sur un seul mot de passe. */
const attempts = new Map();
export function checkPassword(candidate, ip = 'unknown') {
  const now = Date.now();
  const a = attempts.get(ip) ?? { n: 0, until: 0 };
  if (now < a.until) return { ok: false, waitMs: a.until - now };

  const ok = PASSWORD !== null && safeEqual(candidate ?? '', PASSWORD);
  if (ok) { attempts.delete(ip); return { ok: true }; }

  a.n++;
  if (a.n >= 5) { a.until = now + Math.min(60_000 * 2 ** (a.n - 5), 900_000); a.n = 0; }
  attempts.set(ip, a);
  return { ok: false };
}

export const LOGIN_PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BrainDebugger</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0a0c0b; color:#e9efeb;
         font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  form { width:min(340px,88vw); background:#121614; border:1px solid #19211c; border-radius:11px; padding:26px 24px; }
  h1 { margin:0 0 4px; font-size:16px; letter-spacing:-.01em; }
  p { margin:0 0 18px; font-size:13px; color:#93a099; }
  input { width:100%; box-sizing:border-box; padding:10px 12px; border-radius:8px;
          background:#0a0c0b; border:1px solid #24302a; color:inherit; font:inherit; }
  input:focus { outline:none; border-color:#1c7a42; }
  button { width:100%; margin-top:11px; padding:10px; border:0; border-radius:8px;
           background:#4ade80; color:#06120b; font:600 14px inherit; cursor:pointer; }
  .err { margin:12px 0 0; font-size:13px; color:#e0564a; min-height:1.2em; }
</style></head><body>
<form method="post" action="/login">
  <h1>BrainDebugger</h1>
  <p>Ce journal est protégé.</p>
  <input type="password" name="password" placeholder="Mot de passe" autofocus autocomplete="current-password">
  <button type="submit">Entrer</button>
  <p class="err">__ERROR__</p>
</form>
</body></html>`;
