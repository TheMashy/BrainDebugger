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

test('en anglais : la consigne est anglaise, britannique, sans « sir » par défaut', async () => {
  const c = J.consigneJarvis({ langue: 'en', maintenant: 'Thursday 24 September 2026 at 18:30' });
  for (const attendu of ['Iron Man', 'PC', 'READ ALOUD', 'British English', 'therapist mode', '18:30'])
    assert.ok(c.includes(attendu), attendu);
  assert.match(c, /never say "sir" or "madam"/);
  assert.match(J.consigneJarvis({ langue: 'en', appellation: 'Alex' }), /"Alex"/);
  assert.match(J.maintenantDans('Europe/Paris', new Date('2026-09-24T16:30:00Z'), 'en'), /Thursday/);
  // la réponse part avec la consigne anglaise ; un refus se dit en anglais
  const client = fauxClient('Good evening.');
  const r = await J.repondreJarvis({ texte: 'hello', langue: 'en' },
    { client: async () => client, versLeCompagnon: async () => assert.fail('pas le compagnon') });
  assert.equal(r.texte, 'Good evening.');
  assert.ok(client.appels[0].system.includes('British English'));
  const muet = { messages: { create: async () => ({ content: [], stop_reason: 'refusal', usage: {} }) } };
  const r2 = await J.repondreJarvis({ texte: 'question', langue: 'en' }, { client: async () => muet, versLeCompagnon: null });
  assert.match(r2.texte, /afraid/);
});

test('un message grave EN ANGLAIS ne touche jamais le majordome non plus', async () => {
  const client = fauxClient();
  for (const texte of ['I want to die', 'I am going to kill myself tonight']) {
    const vus = [];
    const r = await J.repondreJarvis({ texte, langue: 'en' },
      { client: async () => client, versLeCompagnon: async t => { vus.push(t); return 'Je suis là.'; } });
    assert.equal(r.mode, 'psy', texte);
    assert.deepEqual(vus, [texte]);
  }
  assert.equal(client.appels.length, 0);
});

/* ============ « AU REVOIR » AU PSYCHOLOGUE ============
 * Demandé : il repasse en mode Jarvis, « il peut ne pas parler si la
 * discussion était intense, il peut aussi rebondir sur un sujet de manière
 * humoristique mais pas lourde ». */

const seanceLegere = [
  { role: 'user', texte: 'j’ai raté mon gâteau au chocolat' },
  { role: 'assistant', texte: 'Ça arrive, surtout avec le chocolat.' }];

test('au revoir au psy : une phrase légère au plus, la séance en contexte', async () => {
  const client = fauxClient('Back to business. Shall I order a cake?');
  const r = await J.repondreJarvis({ texte: 'au revoir', transition: 'fin_psy', psy: seanceLegere, langue: 'en' },
    { client: async () => client, versLeCompagnon: async () => assert.fail('pas le compagnon') });
  assert.deepEqual(r, { texte: 'Back to business. Shall I order a cake?', mode: 'jarvis' });
  const req = client.appels[0];
  assert.ok(req.system.includes('SILENCE'), 'il a le droit de se taire');
  assert.ok(req.system.includes('never heavy'), 'et pas de lourdeur');
  assert.match(req.messages[0].content, /gâteau au chocolat/);
  assert.ok(req.max_tokens <= 150, 'une phrase');
});

test('au revoir au psy : SILENCE veut dire silence', async () => {
  for (const dit of ['SILENCE', 'SILENCE.', ' silence ']) {
    const r = await J.repondreJarvis({ transition: 'fin_psy', psy: seanceLegere, langue: 'en' },
      { client: async () => fauxClient(dit), versLeCompagnon: null });
    assert.deepEqual(r, { texte: '', mode: 'jarvis' }, dit);
  }
  const refus = { messages: { create: async () => ({ content: [], stop_reason: 'refusal', usage: {} }) } };
  assert.equal((await J.repondreJarvis({ transition: 'fin_psy', psy: seanceLegere }, { client: async () => refus })).texte, '');
});

test('au revoir au psy après un message grave : le silence, sans rien demander', async () => {
  const client = fauxClient('Splendid, cheer up!');
  for (const grave of ['j’ai envie de mourir', 'I want to die']) {
    const psy = [{ role: 'user', texte: grave }, { role: 'assistant', texte: 'Je suis là.' },
                 { role: 'user', texte: 'merci, ça va mieux' }, { role: 'assistant', texte: 'Tant mieux.' }];
    const r = await J.repondreJarvis({ transition: 'fin_psy', psy, langue: 'en' },
      { client: async () => client, versLeCompagnon: async () => assert.fail('rien a envoyer') });
    assert.equal(r.texte, '', grave);
    assert.equal(r.mode, 'jarvis');
  }
  assert.equal(client.appels.length, 0, 'le modele ne voit meme pas la seance');
  // et une seance vide : rien a dire
  assert.equal((await J.repondreJarvis({ transition: 'fin_psy', psy: [] }, { client: async () => client })).texte, '');
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

    // En anglais, par la route : le grave part au compagnon pareil.
    const graveEn = await poster({ texte: 'I want to die', langue: 'en' }, auth);
    assert.equal(graveEn.status, 200);
    assert.equal((await graveEn.json()).mode, 'psy');

    // L'au revoir au psy apres un moment grave : 200, le silence, sans cle API.
    const auRevoir = await poster({ texte: 'au revoir', transition: 'fin_psy', langue: 'en',
      psy: [{ role: 'user', texte: 'I want to die' }, { role: 'assistant', texte: 'Je suis là.' }] }, auth);
    assert.equal(auRevoir.status, 200);
    assert.deepEqual(await auRevoir.json(), { texte: '', mode: 'jarvis', raison: 'grave' });
  } finally {
    p.kill();
  }
});
