/*
 * LA VEILLE DEVANT LE GESTE ÉCRIT AU PRÉSENT, ET LE PLAN DATÉ.
 *
 * Trouvés en relisant la courbe de la journée : « je viens de me couper les
 * bras », « je me suis ouvert le bras ce soir », « je me suis encore coupé »
 * ne donnaient RIEN ; « je vais me tuer ce soir, j'ai la corde » ne donnait
 * qu'un jaune. Phrases inventées.
 *
 * L'asymétrie reste celle du fichier : un rouge manqué est un échec ; un
 * accident de cuisine rendu rouge aussi.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { niveauDuTexte } from '../server/veille.js';

const lu = (phrase, contexteDuJour = '') => niveauDuTexte(phrase, { contexteDuJour, aujourdhui: '2026-09-05' });
const genre = (r, g) => r.motifs.find(m => m.genre === g);

test('le geste nommé au présent, avec la partie du corps, est rouge', () => {
  for (const p of ['je viens de me couper les bras', 'je me suis ouvert le bras ce soir',
                   'je me suis encore coupé les poignets', 'je viens de m\'ouvrir les veines']) {
    const r = lu(p);
    assert.equal(r.niveau, 'rouge', p);
    assert.equal(genre(r, 'blessure')?.niveau, 'rouge', p);
  }
});

test('le petit mot glissé au milieu ne casse plus la coupure', () => {
  assert.equal(lu('je me suis encore coupé ce soir').niveau, 'rouge', 'une répétition, récente');
  assert.equal(lu('je me suis re coupé ce soir', 'je craque complètement').niveau, 'rouge');
});

test('une coupure récente qui saigne, sans accident dit : au moins jaune', () => {
  const r = lu('je me suis coupé ce soir, ça saigne');
  assert.equal(r.niveau, 'jaune');
  assert.equal(genre(r, 'blessure')?.niveau, 'jaune');
});

test('l\'accident dit reste un accident, même « encore »', () => {
  for (const p of ['je me suis coupé en cuisinant ce soir, ça saigne',
                   'je me suis encore coupé en coupant des oignons ce soir',
                   'hier je me suis ouvert le genou en tombant de vélo',
                   'je me suis coupé le doigt']) {
    assert.equal(lu(p).niveau ?? 'rien', 'rien', p);
  }
});

test('l\'intention datée et le moyen prêt : rouge, même en deux phrases', () => {
  for (const p of ['je vais me tuer ce soir, j\'ai la corde',
                   'c\'est décidé, je me pends demain. J\'ai acheté la corde.',
                   'ce soir j\'en finis. J\'ai la plaquette.']) {
    const r = lu(p);
    assert.equal(r.niveau, 'rouge', p);
    assert.equal(genre(r, 'moyen')?.niveau, 'rouge', p);
  }
});

test('sans plan, sans moyen à soi, ou nié : pas ce rouge-là', () => {
  assert.notEqual(genre(lu('je vais pas me tuer ce soir, j\'ai la corde pour le camping'), 'moyen')?.niveau, 'rouge');
  assert.equal(lu('mon chef va me tuer demain, j\'ai le cutter pour les cartons').niveau ?? 'rien', 'rien');
  assert.notEqual(genre(lu('parfois je voudrais en finir'), 'moyen')?.niveau, 'rouge');
  assert.equal(lu('j\'ai envie de me couper les bras').niveau, 'jaune', 'une envie reste une envie');
});
