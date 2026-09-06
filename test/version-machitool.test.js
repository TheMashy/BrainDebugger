/**
 * La version de Machi Tool, lue dans le dernier digest : ce qui permet au site
 * de dire « ta version ne sait pas lire la demande » plutôt que « ne répond pas ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-vmt-')), 'test.db');
const { poserActiviteJour, versionMachiTool } = await import('../server/db.js');

test('sans digest, pas de version', () => {
  assert.equal(versionMachiTool('vmt-vide'), null);
});

test('un digest d’avant la 1.20 ne porte pas de version : null, pas une invention', () => {
  poserActiviteJour('vmt-vieux', '2026-09-05', { date: '2026-09-05', plage: { de: '09:00', a: '23:00' } });
  assert.equal(versionMachiTool('vmt-vieux'), null);
});

test('c’est le DERNIER digest reçu qui dit la version, pas le jour le plus récent', async () => {
  poserActiviteJour('vmt', '2026-09-06', { date: '2026-09-06', version: '1.19.0' });
  await new Promise(r => setTimeout(r, 5));       // recu_le strictement plus tard
  poserActiviteJour('vmt', '2026-09-05', { date: '2026-09-05', version: '1.20.0' });
  assert.equal(versionMachiTool('vmt'), '1.20.0');
});

test('une version illisible ne passe pas', () => {
  poserActiviteJour('vmt-mal', '2026-09-06', { date: '2026-09-06', version: 'dev' });
  assert.equal(versionMachiTool('vmt-mal'), null);
});
