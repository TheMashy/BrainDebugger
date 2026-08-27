/**
 * Le chaton. Ce qui est testé n'est pas le dessin — c'est ce qui l'empêche de
 * dire le contraire de ce qu'il devrait.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chaton, humeurDe, HUMEURS, DEFAUT } from '../web/chaton.js';

test('chaque humeur produit un SVG au trait, sans remplissage de masse', () => {
  for (const nom of Object.keys(HUMEURS)) {
    const svg = chaton(nom);
    assert.match(svg, /^<svg /, nom);
    assert.match(svg, /stroke="currentColor"/, nom);
    assert.match(svg, /viewBox="0 0 100 100"/, nom);
    assert.doesNotMatch(svg, /<script/i, nom);
    // `fill` n'apparaît que sur les yeux pleins, jamais sur une masse.
    assert.doesNotMatch(svg, /<path[^>]*fill="(?!none)/, nom);
  }
});

test('les vingt-et-une humeurs ne se ressemblent pas deux à deux', () => {
  // Trois pièces échangeables peuvent silencieusement produire deux humeurs
  // identiques : « triste » et « calme » l'étaient, aux yeux fermés partagés.
  const vus = new Map();
  for (const nom of Object.keys(HUMEURS)) {
    const svg = chaton(nom);
    assert.ok(!vus.has(svg), `${nom} est le sosie de ${vus.get(svg)}`);
    vus.set(svg, nom);
  }
  assert.equal(vus.size, 21);
});

test('une humeur inconnue retombe sur le neutre, jamais sur un sourire', () => {
  assert.equal(chaton('nimportequoi'), chaton(DEFAUT));
  assert.equal(chaton(), chaton('neutre'));
});

test('l’humeur vient du décor, et le sans-note ne bascule pas en fatigué', () => {
  // readEnergy() rend 0.35 quand il n'y a pas de note du jour. Un seuil posé
  // au-dessus ferait bâiller le compagnon tous les matins avant qu'on ait noté.
  assert.equal(humeurDe('drift', 0.35), 'neutre');
  assert.equal(humeurDe('grain', 0.35), 'curieux');
  // Énergie réellement basse : la version en creux de la même scène.
  assert.equal(humeurDe('drift', 0.1), 'pensif');
  assert.equal(humeurDe('voidwell', 0.1), 'endormi');
  // Scène inconnue : neutre, pas d'exception.
  assert.equal(humeurDe('nimportequoi'), 'neutre');
});

test('toute humeur nommée par une scène existe vraiment', () => {
  for (const s of ['drift', 'brume', 'abyss', 'eclipse', 'voidwell', 'monolith', 'grain', 'mandel']) {
    for (const e of [0.9, 0.05]) {
      assert.ok(HUMEURS[humeurDe(s, e)], `${s} @ ${e} → ${humeurDe(s, e)}`);
    }
  }
});
