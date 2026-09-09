/*
 * LE NOM DE L'ONGLET D'ABORD, ET DANS UN SUJET DE QUOI IL S'AGIT.
 *
 * La légende de l'écran disait « youtube · 34 % » : l'endroit, jamais la page.
 * Personne ne se demande combien de temps il a passé « sur youtube » — la
 * question est ce qu'il y regardait, et Machi Tool envoyait déjà les titres
 * d'onglets, au fond du digest brut, derrière deux replis.
 *
 * Et « 40 min de guerre » compte pareil une soirée de cartes du front et une
 * nuit de bodycams. Les sous-catégories affinent — sans jamais prétendre
 * découper le sujet en entier : ce que rien n'affine reste dans son sujet,
 * compté une seule fois, et l'écran doit pouvoir le dire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-onglets-')), 'test.db');

const { upsertUser, poserActiviteJour } = await import('../server/db.js');
const { posteDuJour } = await import('../server/api.js');

const U = 'onglets';
const JOUR = '2026-04-14';
upsertUser({ id: U, username: U });

const DIGEST = {
  date: JOUR,
  plage: { de: '09:00', a: '23:30' },
  temps_par_contexte_s: { 'web:youtube': 4200, 'web:autre': 900, code: 3000 },
  titres: {
    'web:youtube': {
      'carte du front en ukraine': 2400,
      'hopital abandonne en normandie': 1200,
      'trois secondes': 20,
    },
    // Une catégorie sans titres reste sans titres : on ne fabrique pas.
    'web:autre': {},
  },
  temps_par_theme_web_s: { guerre: 2400, urbex: 1200 },
  temps_par_sous_theme_web_s: { guerre: { ukraine: 1500, analyse: 300 } },
  titres_par_theme: { guerre: { 'carte du front en ukraine': 2400 } },
};

poserActiviteJour(U, JOUR, DIGEST);
const p = posteDuJour(JOUR, U);

test("le titre de l'onglet remonte avec le site, pas à sa place", () => {
  const yt = p.ecran.top_web.find(x => x.nom === 'youtube');
  assert.equal(yt.min, 70, 'le compte reste celui du site');
  assert.ok(yt.titres?.length, "les titres du site remontent jusqu'à l'écran");
  assert.equal(yt.titres[0].titre, 'carte du front en ukraine',
    'le plus long en tête : c’est lui qui tiendra la ligne');
  assert.equal(yt.titres[0].min, 40);
  assert.equal(yt.titres.length, 2,
    'un titre effleuré trois secondes ne dit rien de ce qui a été regardé');
});

test('un site sans titres collectés reste un site seul', () => {
  const autre = p.ecran.top_web.find(x => x.nom === 'autre');
  assert.equal(autre.min, 15);
  assert.equal(autre.titres, undefined,
    "on ne fait pas semblant d'avoir une donnée qu'on n'a pas");
});

test('les applications ne prennent pas les titres des sites', () => {
  const code = p.ecran.top_app.find(x => x.nom === 'code');
  assert.equal(code.min, 50);
  assert.equal(code.titres, undefined,
    "le préfixe « web: » ne s'applique qu'aux sites : sans lui, `top_app` " +
    "irait chercher la clé « code » et prendrait des titres qui ne sont pas les siens");
});

test('les sous-catégories arrivent sous leur sujet', () => {
  const g = p.ecran.themes.find(x => x.nom === 'guerre');
  assert.equal(g.min, 40);
  assert.deepEqual(g.sous, [{ nom: 'ukraine', min: 25 }, { nom: 'analyse', min: 5 }]);
});

test('ce que rien n’affine reste dans son sujet, compté une seule fois', () => {
  const g = p.ecran.themes.find(x => x.nom === 'guerre');
  const affine = g.sous.reduce((n, o) => n + o.min, 0);
  assert.ok(affine < g.min,
    'le total des sous-catégories est toujours inférieur au sujet — ' +
    "sinon la barre mentirait par construction");
  assert.equal(g.min - affine, 10);
});

test("un sujet qu'aucune sous-catégorie ne touche n'en invente pas", () => {
  const u = p.ecran.themes.find(x => x.nom === 'urbex');
  assert.equal(u.min, 20);
  assert.equal(u.sous, undefined);
});
