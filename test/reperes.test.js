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

test('le jargon clinique a son thème, pas « jalon »', () => {
  const attendu = {
    'TS': 'crise',
    'tentative de suicide': 'crise',
    'scarification': 'crise',
    "crise d'angoisse": 'crise',
    'burnout': 'crise',
    'rechute alcool': 'conso',
    'arrêt de la cigarette': 'conso',
    'début du sevrage': 'conso',
    'crise de boulimie': 'manger',
    'purge': 'manger',
    'début des insomnies': 'dormir',
    'apnée du sommeil': 'dormir'
  };
  for (const [label, theme] of Object.entries(attendu)) {
    assert.equal(themeDe(label), theme, `« ${label} »`);
  }
});

test('les thèmes cliniques ne mangent pas les thèmes existants', () => {
  // « sevrage » vit dans conso ET dans soin ; c'est le SECOND mot qui tranche
  assert.equal(themeDe('arrêt des benzos'), 'soin');
  assert.equal(themeDe('reprise de la thérapie'), 'soin');
  assert.equal(themeDe('sortie du jeu'), 'creation');
  // « crise » seul n'est pas un fait : c'est un jugement sur une journée
  assert.equal(themeDe('crise'), DEFAUT);
});

test('« pensée » a une icône sans être un thème de repère', () => {
  // Elle sert aux objectifs, pas à la frise : themeDe ne doit jamais la rendre.
  assert.ok(ICONES.pensee && NOMS.pensee);
  assert.ok(!THEMES.some(([n]) => n === 'pensee'));
});
