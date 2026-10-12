/**
 * LES MODÈLES PROPOSÉS.
 *
 * « Remplace Sonnet et Opus 5 dans BrainDebugger, enlève Opus 5 car 5.5 existe
 * déjà, et mets Sonnet 5.5. » Ce qui doit tenir : le menu n'offre plus que la
 * génération courante, un réglage enregistré sur un modèle retiré passe à son
 * successeur, et Sonnet 5.5 reçoit une requête qu'il accepte — `disabled` et
 * l'outil forcé lui rendent 400.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-modeles-')), 'test.db');

const { OWNER, setSettings, getSettings } = await import('../server/db.js');
const { ANTHROPIC_MODELS, optionsDuModele, demanderOutil } = await import('../server/chat.js');
const { PRICES } = await import('../server/usage.js');
const { JARVIS_MODELE } = await import('../server/jarvis.js');

test('le menu : Opus 5.5, Sonnet 5.5, Haiku 5.5 — plus d’Opus 5 ni de Sonnet 5', () => {
  const ids = ANTHROPIC_MODELS.map(m => m.id);
  assert.ok(ids.includes('claude-opus-5-5'));
  assert.ok(ids.includes('claude-sonnet-5-5'));
  assert.ok(ids.includes('claude-haiku-5-5'));
  assert.ok(!ids.includes('claude-opus-5'));
  assert.ok(!ids.includes('claude-sonnet-5'));
  assert.equal(JARVIS_MODELE, 'claude-sonnet-5-5');
});

test('un réglage sur Opus 5 ou Sonnet 5 passe à son successeur', () => {
  setSettings({ anthropicModel: 'claude-opus-5', anthropicModelChat: 'claude-sonnet-5' }, OWNER);
  const s = getSettings(OWNER);
  assert.equal(s.anthropicModel, 'claude-opus-5-5');
  assert.equal(s.anthropicModelChat, 'claude-sonnet-5-5');
  setSettings({ anthropicModelChat: 'claude-haiku-4-5' }, OWNER);
  assert.equal(getSettings(OWNER).anthropicModelChat, 'claude-haiku-4-5', 'un autre choix reste le sien');
});

test('Sonnet 5.5 : la réflexion s’éteint par `between_tools`, jamais par `disabled`', () => {
  const eteinte = optionsDuModele('claude-sonnet-5-5', { effort: 'low', pense: false, repli: false });
  assert.deepEqual(eteinte.thinking, { type: 'between_tools' });
  assert.equal(eteinte.output_config.effort, 'low');
  // au-dessus de `high`, `between_tools` rend 400 : elle reste allumée
  assert.deepEqual(optionsDuModele('claude-sonnet-5-5', { effort: 'max', pense: false }).thinking,
                   { type: 'adaptive' });
  assert.deepEqual(optionsDuModele('claude-sonnet-5-5', { effort: 'low' }).thinking, { type: 'adaptive' });
  const repli = optionsDuModele('claude-sonnet-5-5', { effort: 'low' });
  assert.equal(repli.fallbacks, 'default');
  // l'outil forcé rend 400 : on demande `auto`
  assert.notDeepEqual(demanderOutil('claude-sonnet-5-5', 'rendre_verdict').tool_choice,
                      { type: 'tool', name: 'rendre_verdict' });
});

test('les tarifs : Sonnet 5.5 au prix de Sonnet 5, Haiku 5.5 à 0,10 / 0,50', () => {
  assert.deepEqual(PRICES['claude-sonnet-5-5'], { in: 2, out: 10 });
  assert.deepEqual(PRICES['claude-haiku-5-5'], { in: 0.1, out: 0.5 });
  assert.ok(PRICES['claude-opus-5'] && PRICES['claude-sonnet-5'], 'les dépenses passées gardent leur prix');
});
