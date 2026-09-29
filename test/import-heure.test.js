/*
 * UNE NOTE IMPORTÉE EST POSÉE À 21 H LOCALES, PAS À 21 H UTC.
 *
 * Le code écrivait `T21:00:00.000Z` : 23 h à Paris l'été, 22 h l'hiver — toute
 * note importée tombait « la nuit », et la page des jours à surveiller en
 * tirait « ça s'écrit la nuit ». L'heure reste une convention (source
 * 'import'), mais au moins celle que le commentaire annonçait.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-import-heure-')), 'test.db');
const { applyNotes, vingtEtUneHeures } = await import('../server/import-notes.js');
const { messagesForDate, OWNER } = await import('../server/db.js');
const { dansLaZone, heureLocale, jourLocal } = await import('../server/temps.js');

test('21 h locales à Paris, l’été comme l’hiver, et le même jour à Sydney', () => {
  assert.equal(vingtEtUneHeures('2026-07-15', 'Europe/Paris'), '2026-07-15T19:00:00.000Z');
  assert.equal(vingtEtUneHeures('2026-01-15', 'Europe/Paris'), '2026-01-15T20:00:00.000Z');
  // les jours de changement d'heure
  for (const d of ['2026-03-29', '2026-10-25']) assert.equal(heureLocale(vingtEtUneHeures(d, 'Europe/Paris'), 'Europe/Paris'), '21:00', d);
  const syd = vingtEtUneHeures('2026-07-15', 'Australia/Sydney');
  assert.equal(jourLocal(syd, 'Australia/Sydney'), '2026-07-15');
  assert.equal(heureLocale(syd, 'Australia/Sydney'), '21:00');
});

test('applyNotes pose ses messages à 21:00 dans la zone de la personne, source « import »', () => {
  dansLaZone('Europe/Paris', () => applyNotes([{ date: '2025-08-10', text: 'une note du soir, synthétique' }], OWNER));
  const m = messagesForDate('2025-08-10', OWNER).find(x => x.text === 'une note du soir, synthétique');
  assert.ok(m);
  assert.equal(m.source, 'import');
  assert.equal(heureLocale(m.ts, 'Europe/Paris'), '21:00');
});
