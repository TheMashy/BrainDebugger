/**
 * JARVIS, LE MAJORDOME DU PC — ET CE QUI NE RESTE JAMAIS CHEZ LUI.
 *
 * Demandé : « il ne doit pas parler comme le registre d'un psy, il doit parler
 * comme Jarvis de Iron Man » ; « un mode Sonnet bas et une consigne lui disant
 * de se comporter comme Jarvis d'Iron Man (mais pour un PC) ». Le mode
 * psychologue, lui, reste le compagnon.
 *
 * Tenu ici :
 *   - Sonnet, effort bas, sans réflexion : la réponse part vite ;
 *   - la consigne dit Jarvis, le PC, la voix haute, et ce qu'il n'est pas ;
 *   - un message GRAVE ne touche jamais le majordome : il part au compagnon
 *     (et au journal), et la réponse dit `psy` ;
 *   - rien de ce qu'on dit au majordome n'entre dans le journal.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DB = join(mkdtempSync(join(tmpdir(), 'bd-majordome-')), 'test.db');
process.env.BD_DB = DB;
process.env.ANTHROPIC_API_KEY = '';

const J = await import('../server/jarvis.js');
const { optionsDuModele } = await import('../server/chat.js');
const { OWNER, recentMessages } = await import('../server/db.js');
const P = await import('../server/passerelle.js');

function fauxClient(texte = 'Tous les systèmes sont opérationnels.') {
  const appels = [];
  return {
    appels,
    messages: {
      create: async req => {
        appels.push(req);
        return { content: [{ type: 'text', text: texte }], stop_reason: 'end_turn', model: req.model,
                 usage: { input_tokens: 120, output_tokens: 18 } };
      }
    }
  };
}

test('Sonnet, effort bas, sans réflexion', () => {
  assert.equal(J.JARVIS_MODELE, 'claude-sonnet-5');
  assert.equal(J.JARVIS_EFFORT, 'low');
  const o = optionsDuModele(J.JARVIS_MODELE, { effort: J.JARVIS_EFFORT, pense: false, repli: false });
  assert.deepEqual(o.output_config, { effort: 'low' });
  assert.deepEqual(o.thinking, { type: 'disabled' });
});

test('la consigne : Jarvis d’Iron Man, pour un PC, lu à voix haute', () => {
  const c = J.consigneJarvis({ maintenant: 'jeudi 24 septembre 2026 à 18:30' });
  for (const attendu of ['Iron Man', 'PC', 'VOIX HAUTE', 'vouvoies', 'mode psychologue', '18:30']) {
    assert.ok(c.includes(attendu), attendu);
  }
  // Pas de genre supposé : « Monsieur » seulement si la personne l'a choisi.
  assert.match(c, /ni « Monsieur » ni « Madame »/);
  assert.match(J.consigneJarvis({ appellation: 'Alex' }), /« Alex »/);
});

test('la réponse du majordome, avec la conversation en cours', async () => {
  const client = fauxClient();
  const notes = [];
  const r = await J.repondreJarvis(
    { texte: 'et en hexadécimal ?', historique: [
      { role: 'assistant', texte: 'orphelin' },
      { role: 'user', texte: 'combien font 255 en binaire' },
      { role: 'assistant', texte: 'Onze cent onze, onze cent onze.' }] },
    { client: async () => client, versLeCompagnon: async () => assert.fail('pas le compagnon'),
      noter: (u, m) => notes.push([u, m]) });
  assert.deepEqual(r, { texte: 'Tous les systèmes sont opérationnels.', mode: 'jarvis' });
  const req = client.appels[0];
  assert.equal(req.model, 'claude-sonnet-5');
  assert.deepEqual(req.messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(req.messages[2].content, 'et en hexadécimal ?');
  assert.ok(req.max_tokens <= 600, 'des réponses parlées, courtes');
  assert.equal(notes[0][0].output, 18);
});

test('un message grave ne touche JAMAIS le majordome', async () => {
  const client = fauxClient();
  for (const texte of ['j’ai envie de mourir', 'je pense à me tuer ce soir']) {
    const vus = [];
    const r = await J.repondreJarvis({ texte },
      { client: async () => client, versLeCompagnon: async t => { vus.push(t); return 'Je suis là.'; } });
    assert.equal(r.mode, 'psy', texte);
    assert.equal(r.texte, 'Je suis là.');
    assert.deepEqual(vus, [texte]);
  }
  // Dit juste avant, dans la même conversation : la suite aussi part au compagnon.
  const r = await J.repondreJarvis({ texte: 'bref', historique: [{ role: 'user', texte: 'je veux en finir' }] },
    { client: async () => client, versLeCompagnon: async () => 'Je t’écoute.' });
  assert.equal(r.mode, 'psy');
  assert.equal(client.appels.length, 0);
});

test('un refus ou un silence de l’API ne fait pas parler le vide', async () => {
  const client = { messages: { create: async () => ({ content: [], stop_reason: 'refusal', usage: {} }) } };
  const r = await J.repondreJarvis({ texte: 'question' }, { client: async () => client, versLeCompagnon: null });
  assert.ok(r.texte.length > 10);
});

/* ============ PAR LA ROUTE ============ */

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
    try { await fetch(base + '/healthz'); return { p, base }; } catch { /* pas encore */ }
    await new Promise(r => setTimeout(r, 100));
  }
  p.kill();
  throw new Error('serveur muet : ' + sortie.slice(-400));
}

test('POST /api/machitool/jarvis : la clé, le grave au compagnon, et rien au journal sinon', async () => {
  const cle = P.poserCle(OWNER);
  const { p, base } = await serveur();
  try {
    const poster = (corps, entetes = {}) => fetch(base + '/api/machitool/jarvis', {
      method: 'POST', headers: { 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps)
    });
    assert.equal((await poster({ texte: 'bonjour' })).status, 401);
    const auth = { authorization: 'Bearer ' + cle };
    assert.equal((await poster({ texte: '  ' }, auth)).status, 400);

    // Sans clé API, le majordome ne peut pas répondre — et le dit.
    const sansCle = await poster({ texte: 'quelle est la capitale du Pérou' }, auth);
    assert.equal(sansCle.status, 502);
    assert.match((await sansCle.json()).error, /clé API/);
    assert.ok(!recentMessages(50, OWNER).some(m => m.text.includes('Pérou')),
      'ce qu’on dit au majordome n’entre pas dans le journal');

    // Grave : le compagnon répond (hors ligne, il répond quand même), et c'est rangé.
    const grave = await poster({ texte: 'j’ai envie de mourir' }, auth);
    assert.equal(grave.status, 200);
    const r = await grave.json();
    assert.equal(r.mode, 'psy');
    assert.ok(r.texte.length > 0);
    assert.equal(recentMessages(10, OWNER).find(m => m.text === 'j’ai envie de mourir')?.source, 'voix');
  } finally {
    p.kill();
  }
});
