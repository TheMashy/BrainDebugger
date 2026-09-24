/**
 * « JARVIS, … » — CE QU'ON DIT À VOIX HAUTE ARRIVE DANS LE MÊME FIL.
 *
 * Demandé : un mot d'éveil dans Machi Tool, des commandes, « ou juste parler
 * au chat bot », et une réponse lue à voix haute. La phrase est transcrite sur
 * le poste ; ce qui n'est pas une commande locale vient ici, par la clé de la
 * passerelle.
 *
 * Ce qui est tenu :
 *   - c'est le MÊME compagnon, par le même chemin que le chat écrit : la phrase
 *     et la réponse sont rangées dans le fil, marquées « voix » ;
 *   - la consigne « ta réponse sera lue » part au modèle, jamais dans le
 *     journal : ce qui est rangé, c'est ce que la personne a dit ;
 *   - sans la bonne clé, rien n'entre et rien ne revient ;
 *   - la clé ne lit pas le journal : la seule chose qui revient est la réponse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DB = join(mkdtempSync(join(tmpdir(), 'bd-jarvis-')), 'test.db');
process.env.BD_DB = DB;
process.env.ANTHROPIC_API_KEY = '';   // aucun appel payant : le compagnon « scripted » répond

const { OWNER, addMessage, recentMessages } = await import('../server/db.js');
const { routes, CONSIGNE_VOIX, avecConsigneVoix } = await import('../server/api.js');
const P = await import('../server/passerelle.js');

test('une phrase dite est rangée « voix », avec sa réponse, et la réponse revient', async () => {
  const out = await routes['POST /api/message']({ body: { text: 'je rentre du sport', source: 'voix' }, userId: OWNER });
  assert.equal(typeof out.reponse, 'string');
  assert.ok(out.reponse.length > 0, 'Machi Tool lit cette réponse à voix haute');
  const fil = recentMessages(10, OWNER);
  const moi = fil.find(m => m.role === 'user' && m.text === 'je rentre du sport');
  const lui = fil.find(m => m.role === 'pet' && m.text === out.reponse);
  assert.ok(moi && lui, 'les deux sont dans le fil');
  assert.equal(moi.source, 'voix');
  assert.equal(lui.source, 'voix');
});

test('la consigne de voix ne touche jamais le journal', async () => {
  await routes['POST /api/message']({ body: { text: 'bonne nuit', source: 'voix' }, userId: OWNER });
  for (const m of recentMessages(80, OWNER)) {
    assert.ok(!m.text.includes('voix de synthèse'), 'rangé tel quel : ' + m.text);
  }
});

test('la consigne va sur la DERNIÈRE phrase de la personne, et nulle part ailleurs', () => {
  const h = [{ role: 'user', text: 'a' }, { role: 'pet', text: 'b' }, { role: 'user', text: 'c' }];
  const avant = JSON.stringify(h[0]);
  avecConsigneVoix(h);
  assert.equal(h[2].text, 'c\n\n' + CONSIGNE_VOIX);
  assert.equal(JSON.stringify(h[0]), avant);
  // Un fil qui finit sur le compagnon (cas impossible ici, mais une copie ne
  // doit jamais faire parler le modèle à sa propre place).
  const h2 = [{ role: 'pet', text: 'x' }];
  avecConsigneVoix(h2);
  assert.equal(h2[0].text, 'x');
});

test('le chat écrit reste « web », et une source inventée ne passe pas', async () => {
  await routes['POST /api/message']({ body: { text: 'écrit à la main' }, userId: OWNER });
  await routes['POST /api/message']({ body: { text: 'source bizarre', source: 'discord' }, userId: OWNER });
  const fil = recentMessages(20, OWNER);
  assert.equal(fil.find(m => m.text === 'écrit à la main').source, 'web');
  assert.equal(fil.find(m => m.text === 'source bizarre').source, 'web');
});

/* ============ DE BOUT EN BOUT, PAR LA ROUTE DE LA CLÉ ============ */

async function serveur() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const racine = fileURLToPath(new URL('..', import.meta.url));
  const p = spawn(process.execPath, ['server/index.js'], {
    cwd: racine,
    env: { ...process.env, BD_DB: DB, PORT: String(port), HOST: '127.0.0.1',
           BD_PASSWORD: '', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let sortie = '';
  p.stdout.on('data', d => { sortie += d; });
  p.stderr.on('data', d => { sortie += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { await fetch(base + '/healthz'); return { p, base }; } catch { /* pas encore */ }
    await new Promise(r => setTimeout(r, 100));
  }
  p.kill();
  throw new Error('serveur muet : ' + sortie.slice(-400));
}

test('POST /api/machitool/parler : la clé, la phrase, la réponse — et rien de plus', async () => {
  // Un secret dans le journal, que la route ne doit JAMAIS rendre.
  addMessage({ ts: new Date().toISOString(), date: new Date().toISOString().slice(0, 10),
               source: 'web', role: 'user', text: 'SECRET-DU-JOURNAL', userId: OWNER });
  const cle = P.poserCle(OWNER);
  const { p, base } = await serveur();
  try {
    const poster = (corps, entetes = {}) => fetch(base + '/api/machitool/parler', {
      method: 'POST', headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify(corps)
    });
    const sans = await poster({ texte: 'coucou' });
    assert.equal(sans.status, 401);
    const mauvaise = await poster({ texte: 'coucou' }, { authorization: 'Bearer pas-la-bonne' });
    assert.equal(mauvaise.status, 401);
    const vide = await poster({ texte: '   ' }, { authorization: 'Bearer ' + cle });
    assert.equal(vide.status, 400);

    const ok = await poster({ texte: 'Jarvis dit bonjour' },
                            { authorization: 'Bearer ' + cle, 'x-fuseau': 'Europe/Paris' });
    assert.equal(ok.status, 200);
    const r = await ok.json();
    assert.deepEqual(Object.keys(r).sort(), ['degrade', 'refuse', 'texte'],
      'la réponse, et seulement elle : pas le fil, pas le journal');
    assert.ok(r.texte.length > 0);
    assert.ok(!JSON.stringify(r).includes('SECRET-DU-JOURNAL'));
    const fil = recentMessages(10, OWNER);
    assert.equal(fil.find(m => m.text === 'Jarvis dit bonjour')?.source, 'voix');
  } finally {
    p.kill();
  }
});
