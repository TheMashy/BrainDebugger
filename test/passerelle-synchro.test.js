/*
 * LA DEMANDE DE SYNCHRO, DÉPOSÉE PUIS HONORÉE.
 *
 * Le site ne peut rien pousser vers la machine de Machi Tool : la demande
 * voyage donc dans la réponse au relevé, et s'efface quand le digest arrive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-syn-')), 'test.db');
const { OWNER, poserActiviteJour } = await import('../server/db.js');
const { attente, synchroDemandee, synchroHonoree } = await import('../server/passerelle.js');

test('sans demande, l’attente ne réclame rien', () => {
  const a = attente(OWNER);
  assert.equal(a.synchro.demande_le, null);
});

test('une demande déposée voyage dans l’attente, et s’efface une fois honorée', () => {
  const t = synchroDemandee(OWNER);
  assert.match(t, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(attente(OWNER).synchro.demande_le, t);
  synchroHonoree(OWNER);
  assert.equal(attente(OWNER).synchro.demande_le, null);
});

test('l’attente dit aussi ce que le site a reçu en dernier — de quoi repartir seul', () => {
  assert.equal(attente(OWNER).synchro.recu_le, null);
  poserActiviteJour(OWNER, '2026-09-05', { date: '2026-09-05', temps_par_contexte_s: { code: 60 } });
  const r = attente(OWNER).synchro.recu_le;
  assert.ok(r && /^\d{4}-\d{2}-\d{2}T/.test(r), `recu_le attendu, reçu ${r}`);
});
