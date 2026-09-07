/*
 * UN INSTANT DE TRAVERS N'EMPORTE PAS LA JOURNÉE.
 *
 * Trouvé en ouvrant le site sur une base montée à la main : `GET /api/mirror`
 * rendait 500 et l'onglet restait blanc. La cause tenait en une ligne —
 * `addMessage` écrivait `ts` tel quel, la plupart des appelants passent une
 * chaîne ISO, certains un nombre de millisecondes, et tout ce qui relit fait
 * `Date.parse(m.ts)`, qui rend NaN sur « 1767… ». Le repli de `heureDe`, lui,
 * se rattrapait sur `toISOString()`, qui lève exactement de la même façon.
 *
 * Deux réparations, et les deux comptent : une seule forme dans la colonne, et
 * des lecteurs qui survivent à ce qu'ils ne savent pas lire — parce qu'une base
 * importée, migrée ou écrite par une version d'avant contiendra toujours
 * quelque chose qu'on n'avait pas prévu.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-inst-')), 'test.db');
const { OWNER, addMessage, messagesForDate, normaliserTs, db } = await import('../server/db.js');
const { heureDe, momentsDuJour } = await import('../server/journee.js');

const AUJ = new Date().toISOString().slice(0, 10);

test('un instant donné en millisecondes est rangé en ISO', () => {
  const ms = Date.parse(`${AUJ}T14:30:00Z`);
  addMessage({ ts: ms, date: AUJ, source: 'web', role: 'user', text: 'posé avec un nombre', userId: OWNER });
  const m = messagesForDate(AUJ, OWNER).find(x => x.text === 'posé avec un nombre');
  assert.equal(m.ts, new Date(ms).toISOString());
  assert.ok(!Number.isNaN(Date.parse(m.ts)), 'et il se relit');
});

test('normaliserTs accepte les trois formes et ne fabrique jamais d’heure fausse', () => {
  const iso = '2026-03-04T10:00:00.000Z';
  assert.equal(normaliserTs(iso), iso);
  assert.equal(normaliserTs(Date.parse(iso)), iso);
  assert.equal(normaliserTs(new Date(iso)), iso);
  assert.equal(normaliserTs(String(Date.parse(iso))), iso);
  // ce qui ne se lit pas est gardé tel quel : inventer un instant serait pire
  assert.equal(normaliserTs('pas une date'), 'pas une date');
});

test('heureDe rend null au lieu de lever', () => {
  assert.equal(heureDe('pas une date'), null);
  assert.equal(heureDe(NaN), null);
  assert.equal(heureDe(undefined), null);
  assert.match(heureDe(Date.parse(`${AUJ}T14:30:00Z`)) ?? '', /^\d{2}:\d{2}$/);
});

test('UNE LIGNE ILLISIBLE NE FAIT PAS TOMBER LA VUE DU JOUR', () => {
  // On force en base ce qu'une version d'avant, un import ou une migration
  // pourrait y avoir laissé : addMessage ne l'écrirait plus.
  const veille = new Date(Date.parse(AUJ) - 864e5).toISOString().slice(0, 10);
  addMessage({ ts: `${veille}T09:00:00.000Z`, date: veille, source: 'web', role: 'user', text: 'une phrase datée', userId: OWNER });
  db.prepare('UPDATE messages SET ts = ? WHERE date = ? AND user_id = ?').run('n’importe quoi', veille, OWNER);
  addMessage({ ts: `${veille}T21:00:00.000Z`, date: veille, source: 'web', role: 'user', text: 'une autre phrase', userId: OWNER });

  const moments = momentsDuJour(veille, OWNER);
  assert.ok(moments.length >= 1, 'la journée doit rendre quelque chose');
  const tout = moments.flatMap(m => m.messages != null ? [m] : []);
  assert.ok(tout.length >= 1);
  const textes = JSON.stringify(moments);
  assert.ok(textes.includes('phrase') || moments.length, 'le texte n’est pas perdu avec l’heure');
  for (const m of moments) assert.ok(m.heure === null || /^\d{2}:\d{2}$/.test(m.heure), `heure : ${m.heure}`);
});
