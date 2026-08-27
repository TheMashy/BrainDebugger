/**
 * Tests des ouvertures et fermetures de fenetre.
 *
 * L'enjeu n'est pas la mecanique, c'est le ton : un compagnon qui croit qu'on
 * revient apres trois semaines alors qu'on a juste rouvert un onglet redit
 * bonjour au milieu d'une phrase. On teste donc les seuils, et surtout le cas
 * ou la fermeture ne nous est jamais parvenue -- il est frequent, et le traiter
 * comme une presence continue transformerait toute absence en presence.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-sessions-')), 'test.db');
const { open, close, presence, presenceNote } = await import('../server/sessions.js');

const U = 'testeur';
const H = h => new Date(Date.parse('2026-08-27T12:00:00Z') - h * 3600000).toISOString();
const MAINTENANT = '2026-08-27T12:00:00Z';

test('presence : la toute premiere visite n\'a pas de precedente', () => {
  open('u-neuf', H(0));
  const p = presence('u-neuf', MAINTENANT);
  assert.equal(p.kind, 'first');
  assert.equal(presenceNote(p), null, 'rien a dire au modele la premiere fois');
});

test('presence : rouvrir dans la demi-heure reste la meme visite', () => {
  open(U, H(2));
  close(U, H(2));
  open(U, MAINTENANT);
  // La derniere ouverture est celle en cours ; la precedente s'est fermee il y
  // a 2 h... on refait donc le scenario au bon ecart.
  const p = presence(U, new Date(Date.parse(H(2)) + 10 * 60000).toISOString());
  assert.equal(p.kind, 'continue');
  assert.match(presenceNote(p), /même visite/);
});

test('presence : le retour apres plusieurs jours est compte en jours', () => {
  const u = 'u-jours';
  open(u, H(72)); close(u, H(71));
  open(u, MAINTENANT);
  const p = presence(u, MAINTENANT);
  assert.equal(p.kind, 'jours');
  assert.equal(p.days, 3);
});

test('presence : au-dela d\'un mois, on ne compte plus les jours', () => {
  const u = 'u-loin';
  open(u, H(24 * 45)); close(u, H(24 * 45 - 1));
  open(u, MAINTENANT);
  assert.equal(presence(u, MAINTENANT).kind, 'longtemps');
});

test('presence : une fermeture jamais recue ne compte pas comme presence', () => {
  // Navigateur tue, onglet perdu : la balise de fermeture n'arrive jamais. Si
  // on refermait la session a l'instant present, une absence de trois jours
  // serait lue comme une visite continue.
  const u = 'u-perdu';
  open(u, H(72));                 // aucune fermeture
  open(u, MAINTENANT);            // la suivante doit refermer l'orpheline a son ouverture
  const p = presence(u, MAINTENANT);
  assert.equal(p.kind, 'jours');
  assert.equal(p.days, 3, 'la session orpheline doit etre refermee a sa propre ouverture');
});

test('presence : le modele recoit toujours l\'interdiction d\'en parler', () => {
  // Le fait nuance le ton ; il ne devient jamais un sujet. Sans cette garde,
  // « ça faisait longtemps » est exactement ce que le produit ne fait pas.
  for (const kind of ['continue', 'meme-jour', 'jours', 'semaines', 'longtemps']) {
    const note = presenceNote({ kind, days: 3 });
    assert.match(note, /jamais/, `garde absente pour ${kind}`);
  }
});

test('close : sans session ouverte, c\'est un non-evenement', () => {
  assert.equal(close('u-jamais-vu', MAINTENANT), false);
});
