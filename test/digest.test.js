import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireDigest, familles, aplatir, prefixeDe, suffixeDe,
         TETES, MIN_FAMILLE } from '../server/digest.js';

/*
 * LE DIGEST DE REFERENCE est calque sur un vrai : des cles de tete lisibles,
 * puis trente-cinq titres de pages prefixes `web:`. C'est exactement le cas
 * qui rendait l'ecran illisible.
 */
function digestReel() {
  const web = {};
  const titres = ['summer', '(7)', "we're", 'reddit', 'youtube', 'github', 'docs',
                  'mail', 'discord', 'twitter', 'wiki', 'stack', 'news', 'shop'];
  // Deux grosses, puis une longue queue de miettes.
  web['web:summer'] = 4200;
  web['web:(7)'] = 3100;
  titres.slice(2).forEach((t, i) => { web[`web:${t}`] = 120 - i * 6; });
  return {
    plage: '01:00 → 01:54',
    reveil: '00:58',
    actif_min: 54,
    bascules_fenetre: 77,
    trous: 3,
    poste: 'maison',
    ...web
  };
}

test('un prefixe se lit, et seulement quand il separe vraiment', () => {
  assert.equal(prefixeDe('web:summer'), 'web');
  assert.equal(suffixeDe('web:summer'), 'summer');
  assert.equal(prefixeDe('bascules_fenetre'), null);
  assert.equal(prefixeDe(':orphelin'), null, 'un separateur en tete ne separe rien');
  assert.equal(prefixeDe('fini:'), null, 'un separateur en queue non plus');
});

test('aplatir garde le parent, pas seulement le nom', () => {
  const e = aplatir({ temps: { chrome: 400, code: 900 }, trous: 3 });
  const chrome = e.find(x => x.cle === 'chrome');
  assert.equal(chrome.parent, 'temps');
  assert.deepEqual(chrome.chemin, ['temps', 'chrome']);
  assert.equal(e.find(x => x.cle === 'trous').parent, '', 'au premier niveau, pas de parent');
});

test('les titres de pages se regroupent en UNE famille', () => {
  const { familles: f } = lireDigest(digestReel());
  assert.equal(f.length, 1);
  assert.equal(f[0].nom, 'web');
  assert.equal(f[0].n, 14, 'les quatorze titres sont comptes');
  assert.ok(f[0].parPrefixe);
});

test('les grosses sont nommees, la queue est comptee — et rien ne disparait', () => {
  const { familles: [web] } = lireDigest(digestReel());
  assert.ok(web.tetes.length <= TETES);
  assert.equal(web.tetes[0].nom, 'summer');
  assert.equal(web.tetes[0].valeur, 4200);
  assert.equal(web.tetes.length + web.reste, web.n,
    'tout membre est soit nomme, soit compte dans le reste');
  const somme = web.tetes.reduce((a, t) => a + t.valeur, 0) + web.resteTotal;
  assert.equal(somme, web.total, 'le poids du reste est annonce, pas perdu');
});

test('deux grosses suffisent : on ne remplit pas jusqu’a cinq pour remplir', () => {
  // 4200 + 3100 = 7300 sur 7 ~ 800, soit plus de 75 % : on s'arrete a deux.
  const { familles: [web] } = lireDigest(digestReel());
  assert.equal(web.tetes.length, 2);
  assert.equal(web.reste, 12);
});

test('les cles de tete restent des lignes, telles quelles', () => {
  const { lignes } = lireDigest(digestReel());
  const noms = lignes.map(l => l.cle);
  for (const k of ['plage', 'reveil', 'actif_min', 'bascules_fenetre', 'trous', 'poste'])
    assert.ok(noms.includes(k), `${k} doit rester visible`);
  assert.equal(noms.filter(k => k.startsWith('web:')).length, 0,
    'aucun titre ne se reaffiche en ligne apres regroupement');
});

test('trois cles ne font pas une famille : on ne replie pas ce qui se lit', () => {
  const d = {}; for (let i = 0; i < MIN_FAMILLE - 1; i++) d[`app:${i}`] = 10;
  const { familles: f, lignes } = lireDigest(d);
  assert.equal(f.length, 0);
  assert.equal(lignes.length, MIN_FAMILLE - 1);
});

test('un objet imbriqué se regroupe par son parent', () => {
  const d = { temps_par_contexte_s: { chrome: 900, code: 800, slack: 300, spotify: 100, zoom: 50 } };
  const { familles: [f] } = lireDigest(d);
  assert.equal(f.nom, 'temps_par_contexte_s');
  assert.equal(f.parPrefixe, false);
  assert.equal(f.n, 5);
  assert.equal(f.total, 2150);
});

test('le texte ne compte pas dans une famille : on n’additionne pas des heures', () => {
  const d = { 'web:a': 10, 'web:b': 20, 'web:c': 30, 'web:d': 40, 'web:e': 'coucou' };
  const { familles: [f], lignes } = lireDigest(d);
  assert.equal(f.n, 4, 'la valeur texte n’entre pas dans la somme');
  assert.ok(lignes.some(l => l.cle === 'web:e'), 'elle reste visible, en ligne');
});

test('un digest vide, absent ou scalaire ne casse rien', () => {
  for (const x of [null, undefined, 42, 'texte', {}]) {
    const r = lireDigest(x);
    assert.deepEqual(r.familles, []);
    assert.deepEqual(r.lignes, []);
  }
});

test('champs compte les feuilles AVANT regroupement', () => {
  const { champs } = lireDigest(digestReel());
  assert.equal(champs, 6 + 14, 'six cles de tete et quatorze titres');
});

test('une famille toute plate garde au moins une tete nommee', () => {
  const d = {}; for (let i = 0; i < 40; i++) d[`web:p${i}`] = 10;
  const { familles: [f] } = lireDigest(d);
  assert.ok(f.tetes.length >= 1);
  assert.equal(f.tetes.length + f.reste, 40);
});

test('les familles sortent les plus lourdes d’abord', () => {
  const d = {};
  for (let i = 0; i < 5; i++) { d[`petit:${i}`] = 1; d[`gros:${i}`] = 1000; }
  const { familles: f } = lireDigest(d);
  assert.deepEqual(f.map(x => x.nom), ['gros', 'petit']);
});
