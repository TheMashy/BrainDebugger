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

test('chaque thème a sa teinte, sauf celui qui veut dire « je ne sais pas »', async () => {
  const { THEMES, TEINTE_THEME, teinteDe, DEFAUT } = await import('../web/reperes.js');
  /*
   * Les bandes de la frise portent le dégradé des notes de leur période — une
   * mesure, et c'est juste — mais trois bandes côte à côte étaient trois
   * arcs-en-ciel à trait gris : rien ne disait de quoi ces années étaient
   * faites. La teinte du thème sert au TRAIT et au fond, jamais au
   * remplissage : « ce qui est rempli est mesuré, ce qui est contouré est
   * déclaré ».
   */
  for (const [id] of THEMES) {
    assert.equal(typeof TEINTE_THEME[id], 'number', `le thème « ${id} » n'a pas de teinte`);
    assert.ok(TEINTE_THEME[id] >= 0 && TEINTE_THEME[id] < 360);
  }
  // `jalon` est le thème par DÉFAUT — celui de ce qui n'a pas été reconnu. Lui
  // donner une couleur annoncerait une lecture qui n'a pas eu lieu.
  assert.equal(TEINTE_THEME[DEFAUT], undefined);
  assert.equal(teinteDe({ theme: DEFAUT }), null);

  // Un choix à la main l'emporte : c'est une déclaration plus forte qu'une déduction.
  assert.equal(teinteDe({ theme: 'travail' }), TEINTE_THEME.travail);
  assert.equal(teinteDe({ theme: 'travail', teinte: 336 }), 336);
  assert.equal(teinteDe(null), null);
});

test('deux thèmes voisins ne portent pas la même teinte', async () => {
  const { TEINTE_THEME } = await import('../web/reperes.js');
  const vues = new Map();
  for (const [id, t] of Object.entries(TEINTE_THEME)) {
    const proche = [...vues.entries()].find(([, v]) => Math.abs(v - t) < 8);
    assert.equal(proche, undefined,
                 `« ${id} » (${t}) et « ${proche?.[0]} » (${proche?.[1]}) se confondent`);
    vues.set(id, t);
  }
});
