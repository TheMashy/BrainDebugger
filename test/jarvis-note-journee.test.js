/**
 * « Fais en sorte qu'on puisse noter les journées passées directement à
 * travers Jarvis en disant « note la journée » avec la note qui suit ; si
 * Jarvis comprend une note sur une journée, il la rajoutera à cet instant T. »
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-note-journee-')), 'test.db');

const { OWNER, getEntry } = await import('../server/db.js');
const { noterJournee, jourVecu } = await import('../server/api.js');
const J = await import('../server/jarvis.js');

test('noter la journée : tout de suite, aujourd’hui par défaut, un jour passé aussi', () => {
  const auj = jourVecu(OWNER);
  assert.equal(noterJournee({ note: 7 }, OWNER), 'La journée est notée 7/10.');
  assert.equal(getEntry(auj, OWNER).note, 7);
  assert.match(noterJournee({ note: 6.5 }, OWNER), /notée 6,5\/10 \(elle était à 7\)/);
  assert.match(noterJournee({ note: 4, jour: '2026-03-02' }, OWNER), /^La journée du lundi 2 mars est notée 4\/10\.$/);
  assert.equal(getEntry('2026-03-02', OWNER).note, 4);
  assert.throws(() => noterJournee({ note: 11 }, OWNER), /0 à 10/);
  assert.throws(() => noterJournee({ note: 'beaucoup' }, OWNER), /0 à 10/);
  assert.throws(() => noterJournee({ note: 5, jour: '2999-01-01' }, OWNER), /pas encore eu lieu/);
  assert.throws(() => noterJournee({ note: 5, jour: 'hier' }, OWNER), /Jour illisible/);
});

function fauxClient(reponses) {
  const appels = [];
  const file = [...reponses];
  return { appels, messages: { create: async req => {
    appels.push({ ...req, messages: structuredClone(req.messages) });
    const r = file.length > 1 ? file.shift() : file[0];
    return { model: req.model, usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn', ...r };
  } } };
}

test('« note la journée d’hier 6 » : Jarvis appelle l’outil, exécuté ici', async () => {
  const notes = [];
  const c = fauxClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'n1', name: 'noter_journee',
                                           input: { note: 6, jour: '2026-03-01' } }] },
    { content: [{ type: 'text', text: 'C’est noté : 6 pour hier.' }] }]);
  const r = await J.repondreJarvis({ texte: 'note la journée d’hier 6' }, {
    client: async () => c, versLeCompagnon: async () => '',
    journee: { noter: e => { notes.push(e); return noterJournee(e, OWNER); } } });
  assert.ok(c.appels[0].tools.some(t => t.name === 'noter_journee'));
  assert.deepEqual(notes, [{ note: 6, jour: '2026-03-01' }]);
  assert.match(JSON.stringify(c.appels[1].messages.at(-1)), /dimanche 1 mars est notée 6\/10/);
  assert.equal(getEntry('2026-03-01', OWNER).note, 6);
  assert.ok(!r.outils, 'rien ne part au PC');
});
