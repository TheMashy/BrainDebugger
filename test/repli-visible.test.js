/**
 * UNE RELANCE DE SECOURS NE SE FAIT PAS PASSER POUR LE COMPAGNON.
 *
 * Vu en vrai : « Raconte. » en réponse, sans coût sous la bulle. C'était une
 * relance hors-ligne — la raison (enveloppe, refus, API) partait dans un toast
 * de deux secondes, effacé par le toast suivant. Personne ne pouvait savoir.
 * La raison reste maintenant ENREGISTRÉE avec le message, et dite sous la bulle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-repli-')), 'test.db');
process.env.ANTHROPIC_API_KEY = '';
const { OWNER, recentMessages, setSettings } = await import('../server/db.js');
const { streamMessage, raisonDuRepli } = await import('../server/api.js');

test('chaque cause a sa phrase, et une vraie réponse n’en a aucune', () => {
  assert.equal(raisonDuRepli({ backend: 'anthropic', text: 'Salut.' }), null);
  assert.equal(raisonDuRepli({ backend: 'scripted', text: 'Raconte.' }), null,
    'le mode hors-ligne CHOISI n’est pas un repli');
  assert.match(raisonDuRepli({ backend: 'scripted', exhausted: true }), /enveloppe/);
  assert.match(raisonDuRepli({ backend: 'scripted', refused: true }), /décliné/);
  assert.equal(raisonDuRepli({ backend: 'scripted', degraded: 'clé API refusée' }), 'clé API refusée');
});

test('la raison est enregistrée avec la bulle, et revient avec le fil', async () => {
  // Le backend Anthropic sans clé : l'appel échoue, le repli prend la main.
  setSettings({ chatBackend: 'anthropic' }, OWNER);
  const evs = [];
  await streamMessage({ text: 'le truc c’est que ce on s’en fout quoi' }, (ev, data) => evs.push({ ev, data }), OWNER);
  const pet = recentMessages(80, OWNER).findLast(m => m.role === 'pet');
  assert.ok(pet.repli, 'la bulle de secours ne dit pas pourquoi');
  const done = evs.find(e => e.ev === 'done').data;
  assert.equal(done.messages.findLast(m => m.role === 'pet').repli, pet.repli, 'l’écran ne reçoit pas la raison');
});

test('l’écran la montre sous la bulle', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(app, /\$\{repliMarkup\(m\)\}/);
  assert.match(app, /réponse hors-ligne — \$\{esc\(m\.repli\)\}/);
});
