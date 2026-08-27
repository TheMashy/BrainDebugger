/**
 * Les échos : ce qu'il a déjà écrit de très proche de ce qu'il vient de dire.
 *
 * Ils s'affichaient sous le composeur de « Parler ». C'était juste, et c'était
 * au mauvais endroit : on raconte sa soirée, et l'application répond « tu as
 * déjà écrit ça » avec les dates. La même recherche part maintenant vers le
 * compagnon, et c'est lui qui décide s'il la rend.
 *
 * Ce qui est testé ici est le SEUIL et la FRONTIÈRE, pas ce qu'il en fait.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-echos-')), 'test.db');

const { addMessage, setNote, setSettings, OWNER } = await import('../server/db.js');
const { echoBlock } = await import('../server/chat.js');
const api = await import('../server/api.js');

const ecrire = (date, texte, note = 6) => {
  addMessage({ ts: `${date}T20:00:00Z`, date, role: 'user', text: texte });
  setNote(date, note, OWNER);
  api.invalidate(OWNER);
};

// Un corpus où une chose se répète, et une autre non.
ecrire('2026-01-05', "crise d'angoisse avant la réunion, boule au ventre toute la matinée", 3);
ecrire('2026-01-12', "randonnée au bord du lac, il faisait beau, rien à signaler", 8);
ecrire('2026-01-19', "encore une crise d'angoisse avant de partir au boulot, la même boule au ventre", 3);
ecrire('2026-02-02', "j'ai repeint la cuisine, ça m'a occupé tout le week-end", 7);

test('un écho remonte quand c’est la même chose, pas quand ça se ressemble vaguement', () => {
  const proche = api.recentMemory('2026-03-01', OWNER,
    "crise d'angoisse ce matin, la boule au ventre est revenue avant le boulot");
  assert.match(proche, /déjà écrit ceci/);
  assert.match(proche, /2026-01-05|2026-01-19/);

  // Un message sans rapport ne doit rien déclencher : présent à chaque tour, le
  // bloc deviendrait du bruit et le compagnon le citerait pour meubler.
  const loin = api.recentMemory('2026-03-01', OWNER,
    "je me demande quel film regarder ce soir, peut-être un vieux western");
  assert.doesNotMatch(loin ?? '', /déjà écrit ceci/);
});

test('un message trop court ne déclenche rien', () => {
  const r = api.recentMemory('2026-03-01', OWNER, 'crise');
  assert.doesNotMatch(r ?? '', /déjà écrit ceci/);
});

test('à mémoire zéro, aucun écho ne passe par une autre porte', () => {
  // L'interface promet qu'à 0 il ne connaît que la conversation du jour. Lui
  // glisser trois journées de 2026 par un autre chemin ferait de cette
  // promesse un mensonge.
  setSettings({ memoryDays: 0 }, OWNER);
  const r = api.recentMemory('2026-03-01', OWNER,
    "crise d'angoisse ce matin, la boule au ventre est revenue avant le boulot");
  assert.doesNotMatch(r ?? '', /déjà écrit ceci/);
  setSettings({ memoryDays: 14 }, OWNER);
});

test('le bloc dit au compagnon de ne pas s’en servir comme d’un reproche', () => {
  const b = echoBlock([{ date: '2026-01-05', note: 3, text: 'la boule au ventre' }]);
  assert.match(b, /Tu ne les récites pas/);
  assert.match(b, /reproche/);
  assert.match(b, /\[le 2026-01-05 · 3\/10\] la boule au ventre/);
  assert.equal(echoBlock([]), null);
  assert.equal(echoBlock(null), null);
});

test('une journée très longue est coupée, pas transmise entière', () => {
  const b = echoBlock([{ date: '2026-01-05', note: null, text: 'x'.repeat(2000) }]);
  assert.ok(b.length < 1400, `bloc de ${b.length} caractères`);
  assert.match(b, /coupée/);
  assert.doesNotMatch(b, /· null/);
});

test('chercher_journees rend ses mots avec la date, ou rien', () => {
  const o = api.outilsPour(OWNER, null);
  const r = o.chercher_journees({ mot: 'angoisse' });
  assert.match(r.message, /2026-01-05|2026-01-19/);
  assert.match(o.chercher_journees({ mot: 'zzzzzz' }).message, /Rien dans ses journées/);
  assert.ok(o.chercher_journees({ mot: 'a' }).erreur);
});
