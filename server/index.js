import { PLATFORM } from './preflight.js';     // en premier : contrôle de version de Node
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routes, streamMessage, ambiance } from './api.js';
import { attente, cleDeLaRequete, proprietaireDeLaCle } from './passerelle.js';
import { analyser, apercuDe } from './mesures.js';
import { dansLaZone, zoneDeRequete, ZONE_SERVEUR } from './temps.js';
import { DB_PATH, db, upsertUser, countUsers, OWNER, poserMesure, noterEnvoi } from './db.js';
import { claimOwnerData } from './migrate.js';
import * as auth from './auth.js';
import * as discord from './discord.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(ROOT, 'web');

const PORT = Number(process.env.PORT ?? 4173);

// Sur un poste de travail on écoute sur 127.0.0.1 : rien ne sort de la machine.
// Dans un conteneur d'hébergeur, 127.0.0.1 est injoignable même par la sonde de
// santé de la plateforme — le service échoue au déploiement sans rien dire
// d'utile. On détecte donc la plateforme et on ouvre l'écoute par défaut ; c'est
// alors le mot de passe qui protège, et il devient obligatoire.
const HOST = process.env.HOST ?? (PLATFORM ? '0.0.0.0' : '127.0.0.1');

const LOCKED = auth.enabled() || discord.enabled();
if (!auth.isLoopback(HOST) && !LOCKED) {
  // Mot de passe prêt à coller : sans ça, on renvoie quelqu'un vers un
  // générateur, et il choisit « braindebugger » parce qu'il est pressé.
  const suggestion = randomBytes(12).toString('base64url');
  // Un seul write : l'hébergeur entrelace stdout et stderr, et un bloc écrit
  // ligne par ligne ressort illisible dans les logs.
  process.stderr.write([
    '',
    '  ════════════════════════════════════════════════════════════',
    '  REFUS DE DÉMARRER — AUCUN VERROU',
    '',
    PLATFORM
      ? `  Détecté : ${PLATFORM}. L'écoute est ouverte sur ${HOST}, donc ce`
      : `  HOST=${HOST}, donc ce`,
    '  serveur est joignable depuis internet. Aucun mot de passe n\'est défini.',
    '',
    '  Ce serveur expose un journal intime. Sans verrou, n\'importe qui',
    '  connaissant l\'URL peut le lire — il refuse donc de démarrer plutôt',
    '  que de se lancer en clair. Ce n\'est pas une panne.',
    '',
    '  À FAIRE : au choix, puis redéploie.',
    '',
    '      BD_PASSWORD=' + suggestion + '        (un seul journal, une personne)',
    '',
    '    ou, pour plusieurs personnes :',
    '',
    '      BD_DISCORD_CLIENT_ID=…',
    '      BD_DISCORD_CLIENT_SECRET=…',
    '',
    '  (mot de passe généré à l\'instant, à copier tel quel ou à remplacer)',
    '  ════════════════════════════════════════════════════════════',
    '', ''
  ].join('\n'));
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

/** Qui écrit. Sans verrou, tout appartient au propriétaire de la machine. */
const currentUser = req => auth.sessionUser(req) ?? OWNER;

const clientIp = req =>
  (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
const isSecure = req => (req.headers['x-forwarded-proto'] ?? '').split(',')[0] === 'https';

const LOGIN_DISCORD = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>BrainDebugger</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; background:#0a0c0b; color:#e9efeb;
         font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
  .box { width:min(360px,88vw); background:#121614; border:1px solid #19211c; border-radius:11px; padding:28px 26px; text-align:center; }
  h1 { margin:0 0 6px; font-size:16px; letter-spacing:-.01em; }
  p { margin:0 0 20px; font-size:13px; color:#93a099; }
  a.btn { display:flex; align-items:center; justify-content:center; gap:9px; text-decoration:none;
          padding:11px; border-radius:9px; background:#5865F2; color:#fff; font-weight:600; font-size:14px; }
  a.btn:hover { background:#4752c4; }
  svg { width:20px; height:20px; fill:currentColor; }
  .err { margin:14px 0 0; font-size:13px; color:#e0564a; min-height:1.2em; }
  .fine { margin:18px 0 0; font-size:11.5px; color:#5d6a63; line-height:1.5; }
</style></head><body>
<div class="box">
  <h1>BrainDebugger</h1>
  <p>Ton journal, derrière ton compte.</p>
  <a class="btn" href="/auth/discord">
    <svg viewBox="0 0 127 96"><path d="M107 8A105 105 0 0 0 81 0a73 73 0 0 0-3 7 97 97 0 0 0-29 0 72 72 0 0 0-4-7 105 105 0 0 0-26 8C2 34-1 58 1 82a106 106 0 0 0 32 16l7-11a69 69 0 0 1-11-5l3-2a75 75 0 0 0 64 0l3 2a68 68 0 0 1-11 5l7 11a106 106 0 0 0 32-16c3-28-2-52-20-74ZM42 67c-6 0-12-6-12-13s5-13 12-13 12 6 12 13-5 13-12 13Zm43 0c-6 0-12-6-12-13s5-13 12-13 12 6 12 13-5 13-12 13Z"/></svg>
    Se connecter avec Discord
  </a>
  <p class="err">__ERROR__</p>
  <p class="fine">On récupère ton identifiant, ton pseudo et ton avatar. Rien d'autre —
    ni ton adresse mail, ni tes serveurs. Ce que tu écris n'est visible que par toi.</p>
</div>
</body></html>`;

// Une seule fois par URI : la boucle de connexion passe ici a chaque essai, et
// une ligne par tentative noierait le reste des logs.
const announced = new Set();
function announceRedirect(uri) {
  if (announced.has(uri)) return;
  announced.add(uri);
  console.log(`  redirection OAuth envoyée à Discord : ${uri}\n` +
              '  Elle doit figurer AU CARACTÈRE PRÈS dans Developer Portal ›\n' +
              '  ton application › OAuth2 › Redirects.');
}

async function traiter(req, res) {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const key = `${req.method} ${url.pathname}`;

  // sonde de l'hebergeur : jamais derriere le verrou
  if (url.pathname === '/healthz') return json(res, 200, { ok: true });

  /* ---------- la passerelle vers une application locale ----------
   *
   * DEVANT LE VERROU, PARCE QU'ELLE N'A PAS DE NAVIGATEUR DERRIERE ELLE.
   *
   * Une application qui tourne sur la machine de quelqu'un vient demander ce
   * que le site a en attente : elle n'a pas de session, elle n'en aura jamais,
   * et lui en donner une reviendrait a lui confier une identite complete pour
   * allumer une lampe. Elle porte une CLE creee expres dans Reglages, qui
   * n'ouvre que cette route, en lecture, et qu'on peut retirer sans se
   * deconnecter de nulle part.
   *
   * Deux chemins pour une seule reponse : `machitool` est celui qu'appelle
   * l'application telle qu'elle est ecrite, `passerelle` est le nom du produit.
   * Refuser le premier ferait chercher longtemps pour rien.
   */
  if (req.method === 'GET'
      && (url.pathname === '/api/machitool/attente' || url.pathname === '/api/passerelle/attente')) {
    const userId = proprietaireDeLaCle(cleDeLaRequete(req, url));
    // Le message dit CE QU'IL FAUT FAIRE, pas juste que c'est refuse : sans la
    // phrase, un 401 sur une route qui existe ressemble a une route qui
    // n'existe pas, et on cherche du cote du chemin.
    if (!userId) return json(res, 401, {
      error: 'clé absente ou inconnue',
      indice: 'Crée-la dans Réglages › La passerelle, puis colle-la dans l’application.'
    });
    try {
      return json(res, 200, attente(userId, { ambiance: ambiance(userId) }));
    } catch (err) {
      console.error('[passerelle]', err);
      return json(res, 500, { error: String(err.message ?? err).slice(0, 200) });
    }
  }

  /* ---------- ce qu'une application de suivi POUSSE ----------
   *
   * L'autre sens de la passerelle, et la meme cle : une application de suivi
   * (montre, telephone, balance) envoie ce qu'elle mesure, le site le range.
   * Elle non plus n'a pas de navigateur derriere elle, donc elle non plus ne
   * passe pas le verrou -- elle presente sa cle, exactement comme en lecture.
   *
   * TOUT ENVOI EST JOURNALISE, y compris ceux qu'on refuse. C'est la seule
   * facon de deboguer une integration sans terminal : sans le journal, une
   * application qui envoie et un site qui repond 200 ne disent nulle part ce
   * que le site a COMPRIS de ce qui est arrive.
   *
   * Un envoi refuse faute de cle n'est journalise nulle part : on ne sait pas
   * a QUI l'ecrire, et l'ecrire chez tout le monde donnerait a n'importe qui
   * le pouvoir de remplir le journal des autres.
   */
  if (req.method === 'POST'
      && (url.pathname === '/api/qs' || url.pathname === '/api/mesures'
          || url.pathname === '/api/machitool/mesures' || url.pathname === '/api/passerelle/mesures')) {
    const userId = proprietaireDeLaCle(cleDeLaRequete(req, url));
    if (!userId) return json(res, 401, {
      error: 'clé absente ou inconnue',
      indice: 'Crée-la dans Réglages › La passerelle, puis colle-la dans l’application.'
    });
    // La zone de la personne, pas celle du serveur : une mesure sans date
    // appartient a SA journee. Une montre qui synchronise a 00h30 rangerait
    // sinon sa nuit dans la journee d'avant ou d'apres selon l'hebergeur.
    const zone = zoneDeRequete(req);
    try {
      const charge = await readBody(req);
      const { gardees, laissees, vues } = dansLaZone(zone, () => analyser(charge, { zone }));
      for (const m of gardees) poserMesure({ ...m, userId });
      const refus = laissees.length ? laissees.slice(0, 4).map(l => l.cle ? `${l.cle} : ${l.pourquoi}` : l.pourquoi).join(' · ') : null;
      noterEnvoi({ userId, source: gardees[0]?.source ?? null, statut: 200,
                   recues: gardees.length + laissees.length, gardees: gardees.length,
                   refus, apercu: apercuDe(vues) });
      // On rend le detail de ce qui a ete laisse : l'application qui envoie est
      // la seule qui puisse corriger, et elle ne lira jamais notre onglet.
      return json(res, 200, { gardees: gardees.length, laissees: laissees.length, detail: laissees.slice(0, 20) });
    } catch (err) {
      const pourquoi = String(err.message ?? err).slice(0, 200);
      noterEnvoi({ userId, statut: 400, refus: pourquoi });
      return json(res, 400, { error: pourquoi });
    }
  }

  /* ---------- verrou ---------- */

  /* ---------- connexion Discord ---------- */

  if (discord.enabled()) {
    if (key === 'GET /login' || key === 'GET /auth/discord') {
      if (auth.sessionUser(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      const { state, cookie } = discord.makeState(isSecure(req));
      // Discord refuse une redirection non déclarée par un mur muet
      // (« redirect_uri non valide ») affiché sur SON domaine : le serveur
      // n'apprend rien, et on cherche une différence entre deux chaînes dont
      // une seule est visible. On journalise donc celle qu'on envoie.
      announceRedirect(discord.redirectUri(req));
      res.writeHead(302, { Location: discord.authorizeUrl(req, state), 'Set-Cookie': cookie });
      return res.end();
    }

    if (key === 'GET /auth/discord/callback') {
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const fail = msg => html(res, 400,
        discord.enabled()
          ? LOGIN_DISCORD.replace('__ERROR__', msg)
          : auth.LOGIN_PAGE.replace('__ERROR__', msg),
        { 'Set-Cookie': discord.clearState() });

      if (url.searchParams.get('error')) return fail('Connexion annulée.');
      if (!code || !discord.checkState(req, state)) return fail('Lien de connexion expiré. Réessaie.');

      try {
        const profile = await discord.completeLogin(code, req);
        const isFirst = countUsers() === 0;
        upsertUser(profile);
        // Premiere connexion sur une instance qui contenait deja un journal :
        // ce journal est celui de la personne qui deploie.
        if (isFirst) {
          const n = claimOwnerData(db, profile.id);
          if (n) console.log(`  journal existant rattaché à ${profile.username} (${n} lignes)`);
        }
        res.writeHead(302, {
          Location: '/',
          'Set-Cookie': [auth.issueCookie(isSecure(req), profile.id), discord.clearState()]
        });
        return res.end();
      } catch (err) {
        console.error('[discord]', err);
        return fail(String(err.message ?? err).slice(0, 140));
      }
    }

    if (key === 'POST /logout' || key === 'GET /logout') {
      res.writeHead(302, { Location: '/login', 'Set-Cookie': auth.clearCookie() });
      return res.end();
    }

    if (!auth.sessionUser(req)) {
      if (url.pathname.startsWith('/api/')) return json(res, 401, { error: 'non authentifié' });
      return html(res, 200, LOGIN_DISCORD.replace('__ERROR__', ''));
    }
  } else if (auth.enabled()) {
    if (key === 'GET /login') {
      if (auth.isAuthed(req)) { res.writeHead(302, { Location: '/' }); return res.end(); }
      return html(res, 200, auth.LOGIN_PAGE.replace('__ERROR__', ''));
    }
    if (key === 'POST /login') {
      const raw = await readRaw(req, 4096);
      const password = new URLSearchParams(raw).get('password') ?? '';
      const r = auth.checkPassword(password, clientIp(req));
      if (r.ok) {
        res.writeHead(302, { Location: '/', 'Set-Cookie': auth.issueCookie(isSecure(req), OWNER) });
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
      await streamMessage(body, send, currentUser(req));
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
      const out = await routes[key]({ query, body, req, userId: currentUser(req) });
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
}

/*
 * TOUTE la requete est traitee dans la zone annoncee par le navigateur.
 *
 * Une seule enveloppe, ici, plutot qu'un parametre `zone` a trainer dans la
 * trentaine d'endroits qui demandent « quel jour sommes-nous ? ». Un seul
 * oubli, la-bas, redonnerait silencieusement la veille a quelqu'un qui note a
 * minuit et demi -- et c'est le genre de bogue qu'on ne voit qu'en relisant sa
 * grille six mois plus tard.
 */
const server = createServer((req, res) => dansLaZone(zoneDeRequete(req), () => traiter(req, res)));

server.on('error', err => {
  // Sans ça, un port occupé ou interdit sort une stack Node brute, et sur un
  // hébergeur on ne voit qu'un conteneur mort sans raison.
  const why = {
    EADDRINUSE: `Le port ${PORT} est déjà utilisé.`,
    EACCES: `Interdiction d'écouter sur le port ${PORT} (ports < 1024 réservés).`,
    EADDRNOTAVAIL: `L'adresse ${HOST} n'existe pas sur cette machine.`
  }[err.code] ?? `${err.code ?? ''} ${err.message}`.trim();
  process.stderr.write([
    '',
    '  ════════════════════════════════════════════════════════════',
    '  IMPOSSIBLE D\'OUVRIR L\'ÉCOUTE',
    '',
    `  ${why}`,
    '',
    `  tentative : ${HOST}:${PORT}`,
    `  PORT      : ${process.env.PORT ? `fourni par l'environnement (${process.env.PORT})` : 'non défini, valeur par défaut 4173'}`,
    `  HOST      : ${process.env.HOST ? `défini à ${process.env.HOST}` : (PLATFORM ? `déduit de ${PLATFORM}` : 'non défini, valeur par défaut 127.0.0.1')}`,
    '  ════════════════════════════════════════════════════════════',
    '', ''
  ].join('\n'));
  process.exit(1);
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
  verrou      ${discord.enabled() ? `Discord${discord.GUILD ? ` (serveur ${discord.GUILD})` : ''}` : auth.enabled() ? 'mot de passe' : 'aucun'}${discord.enabled() ? `
  redirection ${process.env.BD_PUBLIC_URL
      ? discord.redirectUri({ headers: {} })
      : 'déduite de la requête — définis BD_PUBLIC_URL pour la figer'}` : ''}
  clé Claude  ${process.env.ANTHROPIC_API_KEY ? 'fournie par l\'environnement' : 'aucune (mode hors-ligne)'}
  santé       /healthz
  ─────────────────────────────────────────
`);
  if (!local && !process.env.BD_DB) {
    console.warn('  ATTENTION : BD_DB non défini. La base vit dans le conteneur\n' +
                 '  et sera PERDUE au prochain déploiement. Monte un volume et\n' +
                 '  pointe BD_DB dessus (ex. /data/braindebugger.db).\n');
  }
});
