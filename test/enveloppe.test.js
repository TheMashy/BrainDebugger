/**
 * L'enveloppe retirée. Ce qui est testé, c'est la confusion qu'on évite :
 * « aucune enveloppe » et « enveloppe épuisée » donnent tous les deux zéro
 * restant, et sans distinction explicite lever le plafond reviendrait à
 * l'atteindre instantanément.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Une base a soi, comme partout ailleurs : ce fichier ECRIT de la consommation,
// et l'ecrire dans la vraie base fausserait la jauge de celui qui developpe.
process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-env-')), 'test.db');

const { setSettings, OWNER } = await import('../server/db.js');
const { usageFor, allowanceFor, record, DEFAULT_ALLOWANCE } = await import('../server/usage.js');

const U = 'test-enveloppe';

test('sans le réglage, l’enveloppe est celle par défaut', () => {
  setSettings({ sansEnveloppe: false }, U);
  assert.equal(allowanceFor(U), DEFAULT_ALLOWANCE);
  const u = usageFor(U);
  assert.equal(u.illimitee, false);
  assert.equal(u.remaining, DEFAULT_ALLOWANCE - u.used);
});

test('retirée, elle ne se lit jamais comme épuisée', () => {
  // Le cas qui compte : on brûle bien plus que l'enveloppe par défaut, et le
  // compagnon ne doit PAS retomber hors-ligne.
  record(U, 'claude-opus-5', DEFAULT_ALLOWANCE * 3, 0);
  const avant = usageFor(U);
  assert.equal(avant.exhausted, true, 'le décor du test ne dépasse pas l’enveloppe');

  setSettings({ sansEnveloppe: true }, U);
  const apres = usageFor(U);
  assert.equal(apres.illimitee, true);
  assert.equal(apres.exhausted, false);
  assert.equal(apres.remaining, null, 'un « restant » chiffré n’a pas de sens sans plafond');
  assert.equal(apres.level, 'green');
});

test('le compte des jetons, lui, ne s’arrête pas', () => {
  setSettings({ sansEnveloppe: true }, U);
  const avant = usageFor(U).used;
  record(U, 'claude-opus-5', 1000, 500);
  const apres = usageFor(U);
  assert.equal(apres.used, avant + 1500);
  assert.ok(apres.costUsd > 0, 'le coût reste calculé : c’est tout ce qui reste pour savoir');
});

test('le réglage est propre à une personne', () => {
  setSettings({ sansEnveloppe: true }, U);
  assert.equal(usageFor(U).illimitee, true);
  assert.equal(usageFor(OWNER).illimitee, false);
});
