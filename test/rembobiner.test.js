/**
 * Rembobiner le fil.
 *
 * Ce qui est testé n'est pas la suppression — c'est le RECALCUL. Le texte
 * d'une journée est la concaténation de ses messages : un message retiré du
 * fil mais laissé dans la journée resterait dans la carte, dans les échos et
 * dans toutes les statistiques. On aurait retiré une phrase de l'écran en la
 * laissant dans tout ce que l'application en déduit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-remb-')), 'test.db');

const { addMessage, recentMessages, rembobiner, getEntry, setNote, rebuildEntryText, OWNER } =
  await import('../server/db.js');

const J = '2026-08-28';
let horloge = 0;
const poser = (role, text, date = J, extra = {}) => addMessage({
  ts: new Date(Date.UTC(2026, 7, 28, 20, 0, ++horloge)).toISOString(),
  date, role, text, ...extra
});

test('le message visé revient, ce qui suit disparaît', () => {
  const a = poser('user', 'première phrase');
  poser('pet', 'une réponse');
  const b = poser('user', 'la phrase à reprendre');
  poser('pet', 'une réponse de trop');

  const r = rembobiner(b);
  assert.equal(r.texte, 'la phrase à reprendre', 'le texte doit revenir pour être réécrit');
  assert.equal(r.supprimes, 2, 'le message visé et tout ce qui suit');

  const fil = recentMessages(80).map(m => m.text);
  assert.deepEqual(fil, ['première phrase', 'une réponse']);
  void a;
});

test('le texte de la journée est recalculé, pas seulement le fil', () => {
  // Le cas qui compte. Sans ce recalcul, la journée garderait la phrase
  // effacée jusqu'au prochain message, et personne ne saurait pourquoi.
  assert.equal(getEntry(J).text, 'première phrase');
});

test('une journée vidée disparaît, sauf si elle porte une note', () => {
  const j2 = '2026-08-27';
  const m = poser('user', 'la seule phrase du jour', j2);
  assert.ok(getEntry(j2));
  rembobiner(m);
  assert.equal(getEntry(j2), null, 'plus rien à garder : la journée part');

  const j3 = '2026-08-26';
  const m3 = poser('user', 'écrit puis repris', j3);
  setNote(j3, 7);
  rembobiner(m3);
  const e = getEntry(j3);
  assert.ok(e, 'une note saisie à la main ne s’efface pas avec le fil');
  assert.equal(e.note, 7);
  assert.equal(e.text, '');
});

test('rembobiner sur plusieurs journées les recalcule toutes', () => {
  const gardee = poser('user', 'lundi, gardé', '2026-09-01');
  const debut = poser('user', 'mardi, repris', '2026-09-02');
  poser('user', 'mercredi, repris', '2026-09-03');
  const r = rembobiner(debut);
  assert.equal(r.supprimes, 2);
  assert.equal(getEntry('2026-09-01').text, 'lundi, gardé');
  assert.equal(getEntry('2026-09-02'), null);
  assert.equal(getEntry('2026-09-03'), null);
  void gardee;
});

test('l’ordre est celui du temps, pas celui des identifiants', () => {
  // Un message importé ou venu de Discord peut porter un identifiant plus grand
  // qu'un message antérieur. C'est l'ordre du fil qui décide de ce qui « suit ».
  const tard = addMessage({ ts: '2026-10-02T10:00:00Z', date: '2026-10-02', role: 'user', text: 'plus tard' });
  const tot  = addMessage({ ts: '2026-10-01T10:00:00Z', date: '2026-10-01', role: 'user', text: 'plus tôt' });
  assert.ok(tot > tard, 'le décor du test suppose des identifiants à contre-temps');
  const r = rembobiner(tard);
  assert.equal(r.supprimes, 1, 'seul le message visé part : rien ne le suit dans le temps');
  assert.equal(getEntry('2026-10-01').text, 'plus tôt');
});

test('un identifiant inconnu ne fait rien du tout', () => {
  const avant = recentMessages(80).length;
  assert.equal(rembobiner(999999), null);
  assert.equal(recentMessages(80).length, avant);
});

test('la réflexion voyage avec la réponse, jamais avec la journée', () => {
  const jour = '2026-11-05';
  poser('user', 'ce que j’ai écrit', jour);
  poser('pet', 'ce qu’il a répondu', jour, { reflexion: 'ce qu’il s’est dit' });
  const pet = recentMessages(80).find(m => m.text === 'ce qu’il a répondu');
  assert.equal(pet.reflexion, 'ce qu’il s’est dit');
  // L'invariant : le texte d'une journée ne contient QUE ce que la personne a
  // écrit. Ce que la machine s'est dit n'entre nulle part dans le corpus.
  assert.equal(rebuildEntryText(jour), 'ce que j’ai écrit');
});
