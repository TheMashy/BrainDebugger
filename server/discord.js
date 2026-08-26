import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Connexion par Discord.
 *
 * Choisi pour trois raisons : personne n'a de mot de passe a retenir ni a
 * reinitialiser, l'identifiant est stable, et la capture Discord de la feuille
 * de route partagera le meme compte sans rien avoir a relier.
 *
 * Portee demandee : `identify` seulement -- l'identifiant, le pseudo, l'avatar.
 * Ni l'adresse mail, ni la liste des serveurs, sauf restriction explicite.
 */

const API = 'https://discord.com/api/v10';
const STATE_COOKIE = 'bd_oauth';
const STATE_TTL = 10 * 60 * 1000;

export const CLIENT_ID = process.env.BD_DISCORD_CLIENT_ID ?? null;
const CLIENT_SECRET = process.env.BD_DISCORD_CLIENT_SECRET ?? null;
/** Restreint l'acces aux membres d'un serveur. Vide = ouvert a tout compte Discord. */
export const GUILD = process.env.BD_DISCORD_GUILD ?? null;

const SECRET = process.env.BD_SECRET
  || process.env.BD_DISCORD_CLIENT_SECRET
  || randomBytes(32).toString('hex');

export const enabled = () => !!(CLIENT_ID && CLIENT_SECRET);

/** L'URL publique : indispensable derriere un proxy, ou le Host seul ment. */
export function publicUrl(req) {
  if (process.env.BD_PUBLIC_URL) return process.env.BD_PUBLIC_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] ?? '').split(',')[0] || 'http';
  return `${proto}://${req.headers.host}`;
}
const redirectUri = req => `${publicUrl(req)}/auth/discord/callback`;

/* ---------- protection CSRF ---------- */

const sign = v => createHmac('sha256', SECRET).update(v).digest('hex');
function safeEqual(a, b) {
  const A = Buffer.from(String(a)), B = Buffer.from(String(b));
  return A.length === B.length && timingSafeEqual(A, B);
}

export function makeState(secure) {
  const nonce = `${Date.now()}.${randomBytes(12).toString('hex')}`;
  const value = `${nonce}.${sign(nonce)}`;
  const cookie = [
    `${STATE_COOKIE}=${value}`, 'HttpOnly', 'SameSite=Lax', 'Path=/',
    'Max-Age=600', secure ? 'Secure' : null
  ].filter(Boolean).join('; ');
  return { state: value, cookie };
}

export function checkState(req, state) {
  const raw = req.headers.cookie ?? '';
  const hit = raw.split(';').map(c => c.trim()).find(c => c.startsWith(`${STATE_COOKIE}=`));
  if (!hit || !state) return false;
  const cookieVal = hit.slice(STATE_COOKIE.length + 1);
  if (!safeEqual(cookieVal, state)) return false;
  const [ts, nonce, sig] = state.split('.');
  if (!ts || !nonce || !sig) return false;
  if (Date.now() - Number(ts) > STATE_TTL) return false;
  return safeEqual(sig, sign(`${ts}.${nonce}`));
}

export const clearState = () => `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

/* ---------- flux OAuth ---------- */

export function authorizeUrl(req, state) {
  const scope = GUILD ? 'identify guilds' : 'identify';
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope,
    state,
    prompt: 'none'
  });
  return `https://discord.com/oauth2/authorize?${p}`;
}

async function exchange(code, req) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(req)
    })
  });
  if (!res.ok) throw new Error(`Discord a refusé l'échange (${res.status}).`);
  return res.json();
}

const bearer = token => ({ Authorization: `Bearer ${token}` });

async function identify(token) {
  const res = await fetch(`${API}/users/@me`, { headers: bearer(token) });
  if (!res.ok) throw new Error(`Discord n'a pas renvoyé le profil (${res.status}).`);
  const u = await res.json();
  return {
    id: u.id,
    username: u.global_name || u.username,
    avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null
  };
}

async function inGuild(token) {
  const res = await fetch(`${API}/users/@me/guilds`, { headers: bearer(token) });
  if (!res.ok) throw new Error(`Impossible de vérifier l'appartenance au serveur (${res.status}).`);
  return (await res.json()).some(g => g.id === GUILD);
}

/** @returns {{id, username, avatar}} */
export async function completeLogin(code, req) {
  const tok = await exchange(code, req);
  const user = await identify(tok.access_token);
  if (GUILD && !(await inGuild(tok.access_token))) {
    throw new Error("Cet espace est réservé aux membres d'un serveur précis.");
  }
  return user;
}
