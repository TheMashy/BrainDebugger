import test from 'node:test';
import assert from 'node:assert/strict';
import { themeDe, icone, ICONES, NOMS, THEMES, DEFAUT } from '../web/reperes.js';

test('les thèmes les plus fréquents dans un journal sont reconnus', () => {
  const attendu = {
    'changement de boulot': 'travail',
    'démission': 'travail',
    'déménagement à Montpellier': 'maison',
    'début des anxiolytiques': 'soin',
    'arrêt des benzos': 'soin',
    'reprise de la thérapie': 'soin',
    'rupture avec Léa': 'rupture',
    'décès de mon grand-père': 'deuil',
    'départ pour Londres': 'voyage',
    'soutenance de master': 'etudes',
    'semi-marathon de Montpellier': 'sport',
    'sortie du jeu': 'creation',
    'naissance de ma nièce': 'famille',
    'augmentation de salaire': 'argent'
  };
  for (const [label, theme] of Object.entries(attendu)) {
    assert.equal(themeDe(label), theme, `« ${label} »`);
  }
});

test('les accents et la casse ne changent rien', () => {
  assert.equal(themeDe('DÉCÈS de ma tante'), themeDe('deces de ma tante'));
  assert.equal(themeDe('Déménagement'), 'maison');
});

test('la racine ne se déclenche pas sur une sous-chaîne', () => {
  // « mort » ne doit pas attraper « amortissement », ni « pret » « pretendre »
  assert.equal(themeDe('amortissement du prêt immobilier'), 'argent');   // par pret/credit, pas par mort
  assert.notEqual(themeDe('amortissement du crédit'), 'deuil');
});

test('les thèmes spécifiques passent devant les généraux', () => {
  // « rupture avec Léa » contient « avec » : c'est une rupture, pas une rencontre
  assert.equal(themeDe('rupture avec Léa'), 'rupture');
  assert.equal(themeDe('soirée avec les amis'), 'ami');
});

test('sans thème reconnu, on retombe sur le jalon', () => {
  assert.equal(themeDe('quelque chose'), DEFAUT);
  assert.equal(themeDe(''), DEFAUT);
  assert.equal(themeDe(null), DEFAUT);
});

test('chaque thème déclaré a une icône et un nom lisible', () => {
  for (const [nom] of THEMES) {
    assert.ok(ICONES[nom], `icône manquante pour ${nom}`);
    assert.ok(NOMS[nom], `nom manquant pour ${nom}`);
  }
  assert.ok(ICONES[DEFAUT] && NOMS[DEFAUT]);
});

test('le SVG rendu est autonome et sans remplissage', () => {
  const svg = icone('travail', 20);
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 24 24"/);
  assert.match(svg, /fill="none"/);
  assert.match(svg, /stroke="currentColor"/);
  assert.match(svg, /width="20"/);
  assert.doesNotMatch(svg, /<script/i);
});

test('un thème inconnu ne casse pas le rendu', () => {
  assert.equal(icone('nimportequoi', 18), icone(DEFAUT, 18));
});
