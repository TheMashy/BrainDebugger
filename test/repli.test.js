/**
 * LE COMPAGNON PARLE-T-IL VRAIMENT ?
 *
 * Ce fichier existe parce qu'une panne est passée en production sans qu'aucun
 * test ne bronche : le chantier sur le coût a basculé le compagnon d'Opus 5 à
 * Sonnet 5 pour économiser, en laissant derrière lui `fallbacks: 'default'` —
 * une fonction de la famille Opus. L'API répondait 400, le compagnon retombait
 * en relances scriptées, et l'écran affichait un message tronqué avant sa
 * partie utile.
 *
 * AUCUN TEST N'A PU LE VOIR, parce qu'aucun test n'appelait le chemin distant.
 * Le faux serveur qui servait à la main acceptait n'importe quel corps — il
 * répondait donc « oui » à une requête que la vraie API refuse, ce qui est la
 * seule chose qu'un faux serveur ne doit jamais faire.
 *
 * Celui d'ici VALIDE : il refuse ce que l'API refuse, avec la même forme
 * d'erreur. C'est ce qui rend le test capable d'échouer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const chat = await import('../server/chat.js');

/* ============ LA GARDE, PRISE SEULE ============ */

test('le repli serveur n’est demandé qu’aux modèles qui le portent', () => {
  assert.deepEqual(chat.repliServeur('claude-sonnet-5'), {});
  assert.deepEqual(chat.repliServeur('claude-haiku-4-5'), {});
  const opus = chat.repliServeur('claude-opus-5');
  assert.equal(opus.fallbacks, 'default');
  assert.deepEqual(opus.betas, ['server-side-fallback-2026-07-01']);
});

test('un modèle inconnu n’a PAS de repli — les deux échecs ne se valent pas', () => {
  /*
   * Ne pas envoyer le repli coûte un filet de sécurité sur un refus, qui est
   * rare. L'envoyer où il n'est pas compris coûte toutes les conversations.
   * Le défaut doit donc être « ne rien envoyer », y compris pour un modèle
   * qu'on ne connaît pas encore.
   */
  assert.deepEqual(chat.repliServeur('claude-modele-de-2029'), {});
  assert.deepEqual(chat.repliServeur(''), {});
  assert.deepEqual(chat.repliServeur(null), {});
  assert.deepEqual(chat.repliServeur(undefined), {});
});

test('la paire beta/forme reste celle que l’API attend', () => {
  // `fallbacks: "default"` va avec l'en-tête -07-01 ; la forme tableau va avec
  // -06-01. Les croiser rend 400, et c'est le genre de détail qu'on ne revoit
  // jamais une fois écrit.
  const r = chat.repliServeur('claude-fable-5');
  assert.equal(r.fallbacks, 'default');
  assert.match(r.betas[0], /2026-07-01$/);
});

/* ============ LA PHRASE DE L'API ARRIVE-T-ELLE JUSQU'EN HAUT ? ============ */

test('un 400 rend la phrase de l’API, pas son enveloppe JSON', () => {
  const err = new Error('400 {"type":"error","error":{"type":"invalid_request_error",'
    + '"message":"fallbacks: Extra inputs are not permitted"}}');
  err.status = 400;
  const dit = chat.explainApiError(err, 'stored');
  assert.match(dit, /fallbacks/, 'le champ fautif n’est pas nommé');
  assert.match(dit, /400/);
  assert.equal(dit.includes('{"type"'), false, 'l’enveloppe JSON est ressortie telle quelle');
});

test('le message se lit aussi quand le SDK donne l’objet plutôt que le texte', () => {
  const err = { status: 400, message: 'Bad Request',
                error: { error: { message: 'thinking.budget_tokens: Extra inputs are not permitted' } } };
  assert.match(chat.explainApiError(err, 'env'), /budget_tokens/);
});

test('les erreurs qui ont déjà une explication la gardent', () => {
  assert.match(chat.explainApiError({ status: 401 }, 'stored'), /401/);
  assert.match(chat.explainApiError({ status: 429 }, 'stored'), /débit/);
  assert.match(chat.explainApiError({ status: 503 }, 'stored'), /indisponible/);
});

test('LA PAGE NE TRONQUE PLUS LE MESSAGE', () => {
  /*
   * Elle coupait à soixante signes, c'est-à-dire pile avant la phrase utile :
   * on lisait l'ouverture du JSON et pas un mot de ce que l'API reprochait.
   * Le test relit la ligne qui l'affiche, parce que c'est une régression qui
   * ne casse rien — elle rend seulement la panne indéchiffrable.
   */
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const i = app.indexOf('repli hors-ligne');
  assert.ok(i > 0, 'le message de repli a disparu de la page');
  const ligne = app.slice(i - 200, i + 200);
  assert.equal(/slice\(0,\s*\d+\)/.test(ligne), false,
               'le message de repli est de nouveau tronqué');
});

/* ============ BOUT EN BOUT, CONTRE UN FAUX SERVEUR QUI VALIDE ============ */

/**
 * Le faux serveur. Il refuse ce que la vraie API refuse — c'est tout ce qui le
 * distingue d'un serveur complaisant, et c'est tout ce qui compte ici.
 */
function fausseApi(port) {
  const vues = [];
  const serveur = createServer(async (req, res) => {
    const bouts = [];
    for await (const c of req) bouts.push(c);
    const corps = JSON.parse(Buffer.concat(bouts).toString() || '{}');
    vues.push(corps);

    if ('fallbacks' in corps && !chat.MODELES_AVEC_REPLI.includes(corps.model)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        type: 'error',
        error: { type: 'invalid_request_error', message: 'fallbacks: Extra inputs are not permitted' }
      }));
    }

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const env = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
    env('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant',
      model: corps.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    env('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
    env('content_block_delta', { type: 'content_block_delta', index: 0,
      delta: { type: 'text_delta', text: 'Et ensuite, il s’est passé quoi ?' } });
    env('content_block_stop', { type: 'content_block_stop', index: 0 });
    env('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } });
    env('message_stop', { type: 'message_stop' });
    res.end();
  });
  return new Promise(resolve => serveur.listen(port, '127.0.0.1', () => resolve({ serveur, vues })));
}

const PORT = 4300 + Math.floor(Math.random() * 600);
const { serveur, vues } = await fausseApi(PORT);
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}`;
test.after(() => serveur.close());

const reglages = modele => ({
  chatBackend: 'anthropic', apiKey: 'sk-test',
  anthropicModelChat: modele, anthropicEffort: 'low', memoryDays: 0, petName: 'Chaton'
});
const fil = [{ role: 'user', text: 'je suis encore coincé sur l’ordi', ts: new Date().toISOString() }];

test('AVEC LES RÉGLAGES PAR DÉFAUT, LE COMPAGNON RÉPOND VRAIMENT', async () => {
  // C'est LE test de non-régression. Sur le code d'avant, le compagnon partait
  // sur Sonnet 5 en envoyant `fallbacks`, l'API rendait 400, et cette
  // assertion tombait sur `backend: 'scripted'`.
  const r = await chat.reply(fil, reglages('claude-sonnet-5'));
  assert.equal(r.degraded, undefined, `le compagnon est tombé en repli : ${r.degraded}`);
  assert.equal(r.backend, 'anthropic');
  assert.ok(r.text.length > 0);
  assert.equal('fallbacks' in vues.at(-1), false, 'le repli est parti vers un modèle qui ne le porte pas');
});

test('sur un modèle qui le porte, le repli part bien', async () => {
  const r = await chat.reply(fil, reglages('claude-opus-5'));
  assert.equal(r.backend, 'anthropic');
  assert.equal(vues.at(-1).fallbacks, 'default');
});

test('LE FAUX SERVEUR REFUSE VRAIMENT — sinon ce fichier ne prouve rien', async () => {
  /*
   * Un faux serveur complaisant répond « oui » à une requête que la vraie API
   * rejette : il rend le test vert quoi qu'il arrive, ce qui est exactement la
   * façon dont la panne est passée. On vérifie donc que celui-ci sait refuser,
   * en lui envoyant à la main la requête d'avant la correction.
   */
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-5', fallbacks: 'default', messages: [] })
  });
  assert.equal(res.status, 400, 'le faux serveur accepte ce que l’API refuse');
  const j = await res.json();
  assert.match(j.error.message, /fallbacks/);
});
