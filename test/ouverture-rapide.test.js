/*
 * L'OUVERTURE NE RETÉLÉCHARGE PAS CE QU'ELLE A DÉJÀ, ET NE RECALCULE PAS CE QUI N'A PAS BOUGÉ.
 *
 * Mesuré avant : 23 fichiers, 1,2 Mo, renvoyés en entier à CHAQUE ouverture
 * (ni ETag ni compression), et « Moi » qui refaisait 170 ms de tests par
 * décalage pour six phrases. Ce qui est tenu ici :
 *   - un fichier statique porte un ETag de contenu, et une revalidation rend 304 ;
 *   - le texte part compressé quand le navigateur l'accepte ;
 *   - les écarts de « Moi » sont mémoïsés, et un repère ajouté les fait recalculer ;
 *   - les deux lectures du fil passent par un index, sans tri temporaire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';

const DB = join(mkdtempSync(join(tmpdir(), 'bd-ouverture-')), 'test.db');
process.env.BD_DB = DB;

const { OWNER, db } = await import('../server/db.js');
const api = await import('../server/api.js');

async function serveur() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const p = spawn(process.execPath, ['server/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, BD_DB: DB, PORT: String(port), HOST: '127.0.0.1', BD_PASSWORD: '', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let sortie = '';
  p.stdout.on('data', d => { sortie += d; });
  p.stderr.on('data', d => { sortie += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + '/healthz'); return { p, port }; } catch { /* pas encore */ }
    await new Promise(r => setTimeout(r, 100));
  }
  p.kill();
  throw new Error('serveur muet : ' + sortie.slice(-400));
}

/* `fetch` décompresse et cache à sa façon : on veut voir les octets bruts. */
const brut = (port, chemin, entetes = {}) => new Promise((ok, ko) => {
  const r = request({ host: '127.0.0.1', port, path: chemin, headers: entetes }, res => {
    const morceaux = [];
    res.on('data', c => morceaux.push(c));
    res.on('end', () => ok({ status: res.statusCode, headers: res.headers, corps: Buffer.concat(morceaux) }));
  });
  r.on('error', ko);
  r.end();
});

test('fichiers statiques : ETag de contenu, 304 à la revalidation, brotli ou gzip', async () => {
  const { p, port } = await serveur();
  try {
    const nu = await brut(port, '/app.js');
    assert.equal(nu.status, 200);
    assert.match(nu.headers.etag, /^"[\w-]{22}"$/);
    assert.equal(nu.headers['cache-control'], 'no-cache');
    assert.equal(nu.headers['content-encoding'], undefined);

    const re = await brut(port, '/app.js', { 'If-None-Match': nu.headers.etag });
    assert.equal(re.status, 304);
    assert.equal(re.corps.length, 0);

    const br = await brut(port, '/app.js', { 'Accept-Encoding': 'gzip, deflate, br' });
    assert.equal(br.headers['content-encoding'], 'br');
    assert.ok(br.corps.length < nu.corps.length / 2, 'brotli devrait au moins diviser par deux');
    const gz = await brut(port, '/app.js', { 'Accept-Encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.equal(gz.headers.etag, nu.headers.etag, 'même contenu, même ETag');
    assert.match(gz.headers.vary ?? '', /Accept-Encoding/);
  } finally { p.kill(); }
});

test('les écarts de « Moi » sont mémoïsés, et un repère les fait recalculer', () => {
  // Un effet du jour de la semaine sous du bruit : périodique pur, le test par
  // décalage le jugerait indiscernable du hasard (un décalage de 7 le reproduit).
  const bruite = i => Math.max(0, Math.min(10, Math.round(
    5 + (i % 7 === 5 ? 3 : 0) + ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 2)));
  const ins = db.prepare('INSERT INTO entries (user_id, date, note) VALUES (?, ?, ?)');
  const d0 = Date.UTC(2025, 0, 1);
  for (let i = 0; i < 200; i++)
    ins.run(OWNER, new Date(d0 + i * 864e5).toISOString().slice(0, 10), bruite(i));
  api.invalidate(OWNER);
  const a = api.routes['GET /api/moi']({ userId: OWNER, query: {} }).ecarts;
  const b = api.routes['GET /api/moi']({ userId: OWNER, query: {} }).ecarts;
  assert.ok(a.length > 0, 'le jeu de données devrait produire au moins un écart');
  assert.equal(a, b, 'deux ouvertures de suite rendent le même objet');

  db.prepare("INSERT INTO events (user_id, date, label) VALUES (?, '2025-03-01', 'déménagement')").run(OWNER);
  const c = api.routes['GET /api/moi']({ userId: OWNER, query: {} }).ecarts;
  assert.notEqual(c, a, 'un repère ajouté change la clé');
});

test('le fil et les messages d’un jour se lisent par index, sans tri temporaire', () => {
  for (const q of [
    'SELECT id FROM messages WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT 80',
    'SELECT id, ts, source, role, text, via, COALESCE(rangee,0) AS rangee FROM messages WHERE user_id = ? AND date = ? ORDER BY ts ASC'
  ]) {
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + q).all(...(q.includes('date = ?') ? ['u', 'd'] : ['u']))
      .map(r => r.detail).join(' | ');
    assert.match(plan, /USING (COVERING )?INDEX/, plan);
    assert.doesNotMatch(plan, /TEMP B-TREE/, plan);
  }
});
