import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, streamMessage } from './api.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');

const PORT = Number(process.env.PORT ?? 4173);
// 127.0.0.1 et pas 0.0.0.0 : rien de tout ca ne doit sortir de la machine.
// Changer cet hote expose un journal intime sur le reseau local.
const HOST = process.env.HOST ?? '127.0.0.1';

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

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 12 * 1024 * 1024) throw new Error('corps trop volumineux');  // PNG de pet en data URL
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('JSON invalide'); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;

  // Flux SSE : le compagnon ecrit au fur et a mesure. Traite avant `routes`
  // parce qu'il ecrit lui-meme dans la reponse au lieu de rendre du JSON.
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

  // fichiers statiques
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
  console.log(`\n  BrainDebugger — http://${HOST}:${PORT}`);
  console.log(`  Tout reste sur cette machine. Aucun appel sortant en mode "scripted".\n`);
});
