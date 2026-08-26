import { PLATFORM } from './preflight.js';     // en premier : contrôle de version de Node
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, streamMessage } from './api.js';
import { DB_PATH } from './db.js';
import * as auth from './auth.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');

const PORT = Number(process.env.PORT ?? 4173);

// Sur un poste de travail on écoute sur 127.0.0.1 : rien ne sort de la machine.
// Dans un conteneur d'hébergeur, 127.0.0.1 est injoignable même par la sonde de
// santé de la plateforme — le service échoue au déploiement sans rien dire
// d'utile. On détecte donc la plateforme et on ouvre l'écoute par défaut ; c'est
// alors le mot de passe qui protège, et il devient obligatoire.
const HOST = process.env.HOST ?? (PLATFORM ? '0.0.0.0' : '127.0.0.1');

if (!auth.isLoopback(HOST) && !auth.enabled()) {
  console.error(`
  ────────────────────────────────────────────────────────────
  REFUS DE DÉMARRER — IL MANQUE BD_PASSWORD

  ${PLATFORM ? `Détecté : ${PLATFORM}. L'écoute est ouverte sur 0.0.0.0` : `HOST=${HOST}`},
  ce qui rend ce serveur joignable depuis l'extérieur. Aucun mot de passe
  n'est défini.

  Ce serveur expose un journal intime. Sans verrou, n'importe qui connaissant
  l'URL peut le lire — c'est pourquoi il refuse de démarrer plutôt que de
  se lancer en clair.

  Définis la variable BD_PASSWORD, puis redéploie.
  ────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json'
};

function json(res, code, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function html(res, code, body, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

async function readRaw(req, limit = 12 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error('corps trop volumineux');   // PNG de compagnon en data URL
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBody(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw new Error('JSON invalide'); }
}

const clientIp = req =>
  (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
const isSecure = req => (req.headers['x-forwarded-proto'] ?? '').split(',')[0] === 'https';

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;

  // sonde de l'hebergeur : jamais derriere le verrou
  if (url.pathname === '/healthz') return json(res, 200, { ok: true });

  /* ---------- verrou ---------- */

  if (auth.enabled()) {
    if (key === 'GET /login') {
      if (auth.isAuthed(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return html(res, 200, auth.LOGIN_PAGE.replace('__ERROR__', ''));
    }
    if (key === 'POST /login') {
      const raw = await readRaw(req, 4096);
      const password = new URLSearchParams(raw).get('password') ?? '';
      const r = auth.checkPassword(password, clientIp(req));
      if (r.ok) {
        res.writeHead(302, { Location: '/', 'Set-Cookie': auth.issueCookie(isSecure(req)) });
        return res.end();
      }
      const msg = r.waitMs
        ? `Trop de tentatives. Réessaie dans ${Math.ceil(r.waitMs / 60000)} min.`
        : 'Mot de passe incorrect.';
      return html(res, 401, auth.LOGIN_PAGE.replace('__ERROR__', msg));
    }
    if (key === 'POST /logout') {
      res.writeHead(302, { Location: '/login', 'Set-Cookie': auth.clearCookie() });
      return res.end();
    }
    if (!auth.isAuthed(req)) {
      if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'non authentifié' });
      res.writeHead(302, { Location: '/login' });
      return res.end();
    }
  }

  /* ---------- flux SSE ---------- */
  // Traite avant `routes` : ecrit lui-meme dans la reponse au lieu de rendre du JSON.
  if (key === 'POST /api/message/stream') {
    try {
      const body = await readBody(req);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      await streamMessage(body, send);
      res.end();
    } catch (err) {
      console.error('[stream]', err);
      if (!res.headersSent) json(res, 500, { error: String(err.message ?? err) });
      else { res.write(`event: error\ndata: ${JSON.stringify({ error: String(err.message ?? err) })}\n\n`); res.end(); }
    }
    return;
  }

  /* ---------- API ---------- */

  if (routes[key]) {
    try {
      const query = Object.fromEntries(url.searchParams);
      const body = req.method === 'POST' ? await readBody(req) : {};
      const out = await routes[key]({ query, body, req });
      return json(res, out && out.error ? 400 : 200, out);
    } catch (err) {
      console.error(`[${key}]`, err);
      return json(res, 500, { error: String(err.message ?? err) });
    }
  }

  if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'route inconnue' });

  /* ---------- fichiers statiques ---------- */

  let rel = url.pathname === '/' ? '/index.html' : url.pathname;
  rel = normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = join(WEB, rel);
  if (!file.startsWith(WEB)) { res.writeHead(403); return res.end('forbidden'); }

  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
      'Content-Length': data.length,
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404');
  }
});

server.listen(PORT, HOST, () => {
  const local = auth.isLoopback(HOST);
  // Bannière volontairement bavarde : sur un hébergeur, c'est la seule fenêtre
  // qu'on a sur la configuration réellement appliquée.
  console.log(`
  BrainDebugger
  ─────────────────────────────────────────
  écoute      ${HOST}:${PORT}${local ? '  (local uniquement)' : ''}
  plateforme  ${PLATFORM ?? 'aucune détectée'}
  node        ${process.versions.node}
  base        ${DB_PATH}
  verrou      ${auth.enabled() ? 'actif' : 'aucun'}
  santé       /healthz
  ─────────────────────────────────────────
`);
  if (!local && !process.env.BD_DB) {
    console.warn('  ATTENTION : BD_DB non défini. La base vit dans le conteneur\n' +
                 '  et sera PERDUE au prochain déploiement. Monte un volume et\n' +
                 '  pointe BD_DB dessus (ex. /data/braindebugger.db).\n');
  }
});
