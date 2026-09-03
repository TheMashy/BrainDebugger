/**
 * CHERCHER : toutes les instances d'un mot, par jour et par heure.
 *
 * Ce qu'ELLE a écrit, jamais les réponses du compagnon ; sans accent ni casse ;
 * une phrase par occurrence ; groupé par jour, le plus récent d'abord.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-ch-')), 'test.db');
const { addMessage } = await import('../server/db.js');
const { chercher } = await import('../server/api.js');
const U = 'local';

addMessage({ ts: '2026-08-01T09:00:00Z', date: '2026-08-01', role: 'user', text: 'Je suis fatigué ce matin. Le café aide un peu.', userId: U });
addMessage({ ts: '2026-08-01T22:00:00Z', date: '2026-08-01', role: 'user', text: 'Encore de la FATIGUE ce soir.', userId: U });
addMessage({ ts: '2026-08-05T12:00:00Z', date: '2026-08-05', role: 'user', text: 'Grosse forme, aucune fatigue.', userId: U });
addMessage({ ts: '2026-08-05T12:01:00Z', date: '2026-08-05', role: 'pet', text: 'tu parlais de fatigue', userId: U });

test('trouve chaque instance, sans accent ni casse, la phrase et l’heure', () => {
  const r = chercher('fatigue', U);
  assert.equal(r.total, 3, 'trois occasions écrites par la personne');
  assert.equal(r.jours.length, 2);
  assert.equal(r.jours[0].date, '2026-08-05', 'le plus récent d’abord');
  assert.equal(r.jours[1].hits.length, 2, 'deux fois le 1er août');
  assert.equal(r.jours[1].hits[0].extrait, 'Je suis fatigué ce matin.', 'la phrase, pas le message entier');
});

test('la réponse du compagnon ne compte pas', () => {
  const r = chercher('fatigue', U);
  // 3 (utilisateur) et pas 4 : le message role='pet' est ignoré.
  assert.equal(r.total, 3);
});

test('moins de deux lettres : on ne cherche pas', () => {
  assert.equal(chercher('a', U).court, true);
  assert.equal(chercher('', U).court, true);
  assert.equal(chercher('  ', U).court, true);
});

test('une phrase entière se cherche aussi', () => {
  const r = chercher('aide un peu', U);
  assert.equal(r.total, 1);
  assert.equal(r.jours[0].date, '2026-08-01');
});

test('rien trouvé se dit, sans planter', () => {
  const r = chercher('licorne', U);
  assert.equal(r.total, 0);
  assert.deepEqual(r.jours, []);
});
