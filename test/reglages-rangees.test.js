import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * LES CHOIX DU MODÈLE NE PASSENT PLUS PAR UN MENU DÉROULANT.
 *
 * Sur la machine de quelqu'un, le menu natif du compagnon s'ouvrait et se
 * refermait sans qu'on puisse cliquer dedans. Le menu natif est un objet du
 * système : ce qu'il fait ne se décide pas dans cette page. La seule sortie
 * était de ne plus s'en servir -- trois options fermées, trois boutons.
 *
 * Ces tests relisent la page parce que c'est une régression SILENCIEUSE :
 * un `<select>` qui revient s'affiche parfaitement, et ne se remarque que
 * le jour où quelqu'un n'arrive plus à changer son modèle.
 */

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
const sansCommentaires = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const debut = app.indexOf('async function renderSettings()');
assert.ok(debut > 0, 'renderSettings est introuvable');
const fin = app.indexOf('\nasync function montrerFuseau()', debut);
assert.ok(fin > debut, 'la fin du panneau des réglages est introuvable');
const reglages = sansCommentaires(app.slice(debut, fin));

const CLES = ['chatBackend', 'anthropicModelChat', 'anthropicModel', 'anthropicEffort', 'chatPensee'];

test('les cinq réglages du modèle sont des rangées de boutons', () => {
  for (const cle of CLES) {
    assert.match(reglages, new RegExp(`segment\\('${cle}'`),
      `« ${cle} » n'est plus rendu en rangée`);
  }
});

test('plus aucun <select> dans le panneau du modèle', () => {
  for (const cle of CLES) {
    assert.equal(reglages.includes(`<select id="${cle}"`), false,
      `« ${cle} » est redevenu un menu déroulant — c'est exactement la panne qu'on a retirée`);
  }
});

test('un clic sur une rangée écrit le réglage, et relit ce que le serveur a gardé', () => {
  const m = reglages.match(/\$\('\.reglages'\)\?\.addEventListener\('click',[\s\S]*?\n  \}\);/);
  assert.ok(m, 'la délégation des rangées a disparu');
  const h = sansCommentaires(m[0]);
  assert.match(h, /saveSettings\(\{ \[cle\]: versBase\(b\.dataset\.val\) \}\)/, 'le clic n’enregistre plus');
  // Un réglage booléen doit arriver en base comme un booléen : « non » est vrai.
  assert.match(h, /versBase = v => bool \? v === 'oui' : v/,
    'la conversion vers la base a sauté : la chaîne « non » serait enregistrée, et elle est vraie');
  assert.match(h, /versBouton = v => bool \? \(v \? 'oui' : 'non'\) : v/,
    'la conversion vers le bouton a sauté : une rangée booléenne n’aurait plus de choix marqué');
  assert.match(h, /x\.dataset\.val === versBouton\(s2\[cle\]\)/,
    'l’état des boutons ne vient plus de la réponse du serveur : un enregistrement raté mentirait');
  assert.match(h, /catch[\s\S]*setAttribute\('aria-pressed', avant\[i\]\)/,
    'un échec ne remet plus la rangée dans son état d’avant');
});

test('changer de backend refait le bloc du dessous, et lui seul', () => {
  assert.match(reglages, /if \(cle === 'chatBackend'\) return renderBackendCfg\(\)/,
    'le passage Claude ⇄ hors-ligne ne redessine plus les réglages du modèle');
});

test('la liste des modèles est lue UNE fois, pas à chaque peinture', () => {
  const bloc = sansCommentaires(app.slice(app.indexOf('async function lireModeles()'),
                                          app.indexOf('async function renderBackendCfg()')));
  assert.match(bloc, /if \(MODELES_CONNUS\) return MODELES_CONNUS/, 'le cache a sauté');
  assert.equal(/MODELES_CONNUS = \{ models: \[\]/.test(bloc), false,
    'un échec réseau serait mémorisé : la liste resterait vide jusqu’au rechargement');
  // C'est cet aller-retour qui vidait le bloc le temps du réseau.
  const cfg = sansCommentaires(app.slice(app.indexOf('async function renderBackendCfg()'),
                                         app.indexOf('async function montrerFuseau()')));
  assert.equal(cfg.includes("api('/api/models')"), false,
    'le panneau redemande la liste au serveur à chaque rendu : les réglages disparaissent le temps de la réponse');
});

test('la rangée a de quoi se dessiner et se piloter au clavier', () => {
  // On vise la RÈGLE qui dessine la marque, pas la simple présence du
  // sélecteur : il apparaît aussi dans `:hover:not(...)` et dans la règle de
  // la note, et un test qui les attrape passe même quand la marque a disparu.
  assert.match(css, /\.segm button\[aria-pressed="true"\] \{[^}]*border-color: var\(--accent\)[^}]*\}/,
    'le choix courant n’a plus de marque visible');
  assert.match(css, /\.segm button:focus-visible/, 'la rangée n’est plus visible au clavier');
  assert.match(css, /\.segm button:disabled/, 'rien ne montre l’enregistrement en cours');
});

test('la façon de répondre est une rangée BOOLÉENNE, et elle est là', () => {
  // Sans `bool`, « oui » et « non » partiraient en base comme des chaînes --
  // et `if (s.chatPensee)` serait vrai dans les deux cas.
  assert.match(reglages, /segment\('chatPensee', 'Sa façon de répondre', PENSEES, s\.chatPensee, \{ bool: true \}\)/,
    'le réglage de la réflexion a disparu du panneau, ou n’est plus déclaré booléen');
});
