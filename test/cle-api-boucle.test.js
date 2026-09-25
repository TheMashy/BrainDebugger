/**
 * « JE NE PEUX PAS CLIQUER, ÇA S'OUVRE ET ÇA S'ÉTEINT EN PERMANENCE (L'ONGLET
 * CLÉ API EST DANS UN FEEDBACK LOOP). »
 *
 * Le navigateur remplissait tout seul le champ de la clé (un champ mot de
 * passe) avec un mot de passe enregistré ; il était enregistré comme clé, la
 * page entière se redessinait, le champ se remplissait encore. Tenu ici :
 *   - le serveur refuse ce qui n'a pas la forme d'une clé Anthropic ;
 *   - le champ n'est plus un champ mot de passe ;
 *   - enregistrer une clé ne redessine pas la page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-cle-')), 'test.db');
process.env.ANTHROPIC_API_KEY = '';
const { routes, cleAnthropicPlausible } = await import('../server/api.js');
const { OWNER, getSettings } = await import('../server/db.js');

test('le serveur n\'enregistre pas un mot de passe comme clé', () => {
  for (const faux of ['MonMotDePasse2024!', 'alex@gmail.com', 'sk-test', 'sk-ant-', 'sk-ant-trop court'])
    assert.equal(cleAnthropicPlausible(faux), false, faux);
  const r = routes['POST /api/settings']({ body: { apiKey: 'MonMotDePasse2024!' }, userId: OWNER });
  assert.match(r.error, /sk-ant-/);
  assert.notEqual(getSettings(OWNER).apiKey, 'MonMotDePasse2024!');
  const bonne = 'sk-ant-api03-' + 'a'.repeat(40);
  assert.ok(cleAnthropicPlausible(bonne));
  const ok = routes['POST /api/settings']({ body: { apiKey: bonne }, userId: OWNER });
  assert.equal(ok.error, undefined);
  assert.equal(getSettings(OWNER).apiKey, bonne);
  const vide = routes['POST /api/settings']({ body: { apiKey: '', clearKey: true }, userId: OWNER });
  assert.equal(vide.error, undefined, 'effacer reste possible');
});

test('la page : pas un champ mot de passe, et pas de page entière redessinée pour une clé', () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'app.js'), 'utf8');
  const champ = app.slice(app.indexOf('id="apiKey"') - 40, app.indexOf('id="apiKey"') + 400);
  assert.doesNotMatch(champ, /type="password"/);
  assert.match(champ, /autocomplete="off"/);
  const i = app.indexOf("$('#apiKey')?.addEventListener('change'");
  const handler = app.slice(i, app.indexOf('});', i));
  assert.doesNotMatch(handler, /renderSettings\(\)/, 'enregistrer une clé repeint le cadre, pas la page');
  assert.match(handler, /sk-ant-/, 'on n\'envoie que ce qui a la forme d\'une clé');
  assert.match(handler, /derniereCleEssayee/, 'une même valeur n\'est essayée qu\'une fois');
});
