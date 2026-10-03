/**
 * LE PRÉCHAUFFAGE N'A DE VALEUR QUE S'IL CHAUFFE LE BON CACHE.
 *
 * Un cache est un accord de préfixe : un préchauffage qui diffère du vrai
 * message d'un seul octet avant le point de reprise écrit un cache que
 * personne ne relira — et le paie. On compare donc, champ par champ, ce que
 * le préchauffage envoie et ce que le vrai message envoie, contre un faux
 * serveur qui refuse ce que l'API refuse avec `max_tokens: 0`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-pc-')), 'test.db');
const chat = await import('../server/chat.js');
const { setSettings, DEFAULT_SETTINGS } = await import('../server/db.js');
const { prechaufferCompagnon, PRECHAUFFE_APRES_MS } = await import('../server/api.js');

const vues = [];
const serveur = createServer(async (req, res) => {
  const bouts = [];
  for await (const c of req) bouts.push(c);
  const corps = JSON.parse(Buffer.concat(bouts).toString() || '{}');
  vues.push(corps);

  // Les combinaisons que l'API refuse avec max_tokens: 0.
  if (corps.max_tokens === 0 && (corps.stream || corps.output_config?.format
      || ['any', 'tool'].includes(corps.tool_choice?.type))) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error',
      message: 'max_tokens: 0 is not supported with this request' } }));
  }
  if (!corps.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ id: 'w', type: 'message', role: 'assistant', model: corps.model,
      content: [], stop_reason: 'max_tokens',
      usage: { input_tokens: 3, output_tokens: 0, cache_creation_input_tokens: 5200, cache_read_input_tokens: 0 } }));
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const env = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
  env('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant',
    model: corps.model, content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
  env('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  env('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Je t’écoute.' } });
  env('content_block_stop', { type: 'content_block_stop', index: 0 });
  env('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } });
  env('message_stop', { type: 'message_stop' });
  res.end();
});
const PORT = 5000 + Math.floor(Math.random() * 600);
await new Promise(r => serveur.listen(PORT, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${PORT}`;
test.after(() => serveur.close());

const reglages = { chatBackend: 'anthropic', apiKey: 'sk-test', anthropicModelChat: 'claude-sonnet-5-5',
                   anthropicEffort: 'low', memoryDays: 0, petName: 'Jarvis' };
const outils = { relever_humeur: () => ({}), demander_note: () => ({}), noter_moment: () => ({}) };
const MEMOIRE = 'SES JOURNÉES PASSÉES\n2026-09-30 · fatigué, mais content du concert.';

test('le préchauffage envoie le même préfixe que le vrai message', async () => {
  await chat.prechaufferAnthropic(reglages, { memory: MEMOIRE, outils });
  const chauffe = vues.at(-1);
  await chat.reply([{ role: 'user', text: 'salut', ts: new Date().toISOString() }], reglages,
                   { memory: MEMOIRE, outils });
  const vrai = vues.at(-1);

  for (const champ of ['model', 'system', 'tools', 'thinking', 'output_config', 'fallbacks']) {
    assert.deepEqual(chauffe[champ], vrai[champ], `« ${champ} » diffère : le cache chauffé ne sera pas relu`);
  }
  assert.equal(chauffe.max_tokens, 0);
  assert.ok(!chauffe.stream, 'max_tokens: 0 est refusé en streaming');
  assert.equal('cache_control' in chauffe, false,
    'le cache automatique poserait son point de reprise sur le message bidon');
  assert.ok(vrai.stream, 'le vrai message, lui, reste en streaming');
});

test('le compagnon par défaut est Sonnet 5.5, en réflexion adaptative à effort bas', () => {
  assert.equal(DEFAULT_SETTINGS.anthropicModelChat, 'claude-sonnet-5-5');
  assert.equal(DEFAULT_SETTINGS.anthropicEffort, 'low');
  const o = chat.optionsDuModele('claude-sonnet-5-5', { effort: 'low' });
  assert.deepEqual(o.thinking, { type: 'adaptive' });
  assert.deepEqual(o.output_config, { effort: 'low' });
});

test('relevé avant question, quel que soit l’ordre où le modèle les écrit', () => {
  const appels = [{ name: 'demander_note' }, { name: 'marquer_motif' }, { name: 'relever_humeur' }];
  assert.deepEqual(chat.ordonnerAppels(appels).map(a => a.name),
    ['relever_humeur', 'demander_note', 'marquer_motif']);
});

test('le serveur ne préchauffe ni hors modèle distant, ni un cache encore chaud', async () => {
  const U = 'local';
  setSettings({ chatBackend: 'scripted' }, U);
  assert.equal((await prechaufferCompagnon(U)).fait, false, 'sans modèle distant, rien à chauffer');

  setSettings({ chatBackend: 'anthropic', apiKey: 'sk-test' }, U);
  const t0 = Date.now() + 10 * 60_000;            // loin de tout appel précédent
  const avant = vues.length;
  const r1 = await prechaufferCompagnon(U, t0);
  assert.equal(r1.fait, true);
  assert.equal(r1.cacheEcrit, 5200);
  assert.equal(vues.at(-1).max_tokens, 0);

  const r2 = await prechaufferCompagnon(U, t0 + 60_000);
  assert.equal(r2.fait, false, 'une minute après, le cache est encore chaud');
  assert.equal(vues.length, avant + 1, 'aucune requête de plus');

  const r3 = await prechaufferCompagnon(U, t0 + PRECHAUFFE_APRES_MS + 1000);
  assert.equal(r3.fait, true, 'passé le délai, on rechauffe');
});
