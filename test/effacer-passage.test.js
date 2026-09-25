/**
 * « Une petite fonctionnalité pour pouvoir supprimer des conversations d'une
 * journée (avec validation), pour supprimer les conversations hors du contexte
 * psychologique. »
 *
 * Tenu ici : un passage part avec les réponses du compagnon qui lui
 * répondaient, et ce qui s'y rattache (relevés) ; le reste du fil ne bouge
 * pas ; le texte de la journée se recalcule ; une réponse du compagnon seule
 * ne s'efface pas ; les messages d'une autre personne non plus ; la page
 * demande avant d'effacer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-eff-')), 'test.db');
process.env.ANTHROPIC_API_KEY = '';
const D = await import('../server/db.js');
const { routes } = await import('../server/api.js');
const { OWNER, addMessage, addReleve, messagesForDate, getEntry, effacerPassage, rebuildEntryText } = D;

const jour = '2026-09-20';
const dit = (role, text, min, userId = OWNER) => addMessage({
  ts: `${jour}T15:${String(min).padStart(2, '0')}:00.000Z`, date: jour, role, text, userId });

test('un passage part avec ses réponses, le reste du fil ne bouge pas', () => {
  const u1 = dit('user', 'Ça va, je me sens plutôt bien en vrai.', 1);
  const p1 = dit('pet', 'Content de l’entendre.', 2);
  const u2 = dit('user', 'Test du mode vocal, quitte le mode psychologue.', 3);
  const p2 = dit('pet', 'Je repasse en mode Jarvis.', 4);
  const p3 = dit('pet', 'Autre chose ?', 5);
  const u3 = dit('user', 'Je voulais revenir à des trucs de psy.', 6);
  const p4 = dit('pet', 'Je t’écoute.', 7);
  rebuildEntryText(jour, OWNER);
  addReleve({ messageId: u2, date: jour, valeur: 5, quoi: 'test', source: 'toi' });
  addReleve({ messageId: u3, date: jour, valeur: 4, quoi: 'psy', source: 'toi' });
  assert.match(getEntry(jour, OWNER).text, /mode vocal/);

  assert.deepEqual(effacerPassage([p1], OWNER), { supprimes: 0, dates: [] },
    'une réponse du compagnon seule ne s’efface pas');

  const r = effacerPassage([u2], OWNER);
  assert.deepEqual(r, { supprimes: 3, dates: [jour] });
  const restent = messagesForDate(jour, OWNER).map(m => m.id);
  assert.deepEqual(restent.sort((a, b) => a - b), [u1, p1, u3, p4].sort((a, b) => a - b));
  const texte = getEntry(jour, OWNER).text;
  assert.doesNotMatch(texte, /mode vocal/, 'la journée ne garde pas la phrase effacée');
  assert.match(texte, /plutôt bien/);
  assert.match(texte, /trucs de psy/);
  const releves = D.db.prepare('SELECT message_id FROM releves WHERE user_id = ?').all(OWNER).map(x => x.message_id);
  assert.ok(!releves.includes(u2) && releves.includes(u3), 'le relevé du passage part, les autres restent');
  assert.ok(![p2, p3].some(id => restent.includes(id)));
});

test('la route : rien à désigner, un passage déjà effacé, les messages d’une autre personne', () => {
  assert.match(routes['POST /api/passage/effacer']({ body: { ids: [] }, userId: OWNER }).error, /aucun message/);
  assert.match(routes['POST /api/passage/effacer']({ body: { ids: [999999] }, userId: OWNER }).error, /n’existe plus/);
  const autre = dit('user', 'Le message de quelqu’un d’autre.', 30, 'autre');
  assert.match(routes['POST /api/passage/effacer']({ body: { ids: [autre] }, userId: OWNER }).error, /n’existe plus/);
  assert.equal(messagesForDate(jour, 'autre').length, 1, 'rien n’est touché chez quelqu’un d’autre');
});

test('la page demande avant d’effacer un passage', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'app.js'), 'utf8');
  assert.match(app, /class="jseff" data-effacer=/);
  const i = app.indexOf("e.target.closest('[data-effacer]')");
  const bloc = app.slice(i, app.indexOf("const del = e.target.closest('[data-erase]')", i));
  assert.ok(bloc.indexOf('confirm(') > 0 && bloc.indexOf('confirm(') < bloc.indexOf("api('/api/passage/effacer'"),
    'la confirmation vient avant l’effacement');
  assert.match(bloc, /Sans retour/);
});
