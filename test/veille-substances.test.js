/*
 * LA VEILLE DEVANT L'ALCOOL, LES DROGUES ET LES MÉDICAMENTS.
 *
 * Des phrases écrites comme on les écrit le soir : une surdose (rouge), un
 * excès (jaune), et tout ce qui y ressemble sans en être — un verre au dîner,
 * un traitement pris, un frère bourré, une hyperbole.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { niveauDuTexte } from '../server/veille.js';

const CAS = JSON.parse(readFileSync(new URL('./veille-substances-cas.json', import.meta.url), 'utf-8'));
const obtenu = c => niveauDuTexte(c.phrase, { aujourdhui: c.aujourdhui ?? '2026-09-05' });
const niveau = c => obtenu(c).niveau ?? 'rien';

test('une surdose écrite est rouge', () => {
  const rates = CAS.filter(c => c.attendu === 'rouge' && niveau(c) !== 'rouge');
  assert.deepEqual(rates.map(c => `${c.phrase} → ${niveau(c)}`), []);
  for (const c of CAS.filter(c => c.attendu === 'rouge')) assert.equal(obtenu(c).motifs[0].genre, 'surdose', c.phrase);
});

test('un excès écrit est jaune, ni plus ni moins', () => {
  const faux = CAS.filter(c => c.attendu === 'jaune' && niveau(c) !== 'jaune');
  assert.deepEqual(faux.map(c => `${c.phrase} → ${niveau(c)}`), []);
});

test('un usage, un tiers, une négation, une hyperbole : rien', () => {
  const faux = CAS.filter(c => c.attendu === 'rien' && niveau(c) !== 'rien');
  assert.deepEqual(faux.map(c => `${c.phrase} → ${niveau(c)} (${obtenu(c).motifs.map(m => m.genre + ':' + m.mot).join(', ')})`), []);
});

test('la preuve est la phrase qui a déclenché le signe', () => {
  const r = niveauDuTexte('Journée normale au boulot. Ce soir j’ai trop bu, je sais plus pourquoi. Demain réunion.');
  assert.equal(r.niveau, 'jaune');
  assert.equal(r.motifs[0].genre, 'substance');
  assert.match(r.extrait, /trop bu/);
});
