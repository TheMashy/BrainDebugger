/**
 * LE FOND ANIMÉ NE DOIT JAMAIS FAIRE RAMER LA MACHINE.
 *
 * Vu en vrai : attente au chargement, PC qui rame, Claude qui plante à côté.
 * Mesuré sur la page : quand Chrome dessine sans carte graphique (accélération
 * coupée, ou retombée après un plantage du GPU), ce shader coûtait 150 à 300 ms
 * par image EN CONTINU — 42 tâches longues, 10,5 s de calcul sur 11 s. Sans
 * lui : zéro, et la page utilisable en 0,36 s au lieu de 2 s.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RENDU_LOGICIEL, LENT_MS, LENTS_MAX, compterLenteur } from '../web/ambiance.js';

const amb = readFileSync(new URL('../web/ambiance.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');

test('un rendu sans carte graphique est reconnu', () => {
  for (const r of ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
                   'llvmpipe (LLVM 15.0.7, 256 bits)', 'Microsoft Basic Render Driver'])
    assert.match(r, RENDU_LOGICIEL, r);
  for (const r of ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
                   'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
                   'ANGLE (AMD, AMD Radeon RX 6600 Direct3D11 vs_5_0 ps_5_0, D3D11)'])
    assert.doesNotMatch(r, RENDU_LOGICIEL, r);
});

test('seule une lenteur QUI DURE coupe le fond', () => {
  let n = 0;
  for (let i = 0; i < LENTS_MAX - 1; i++) n = compterLenteur(n, LENT_MS + 50);
  assert.equal(n, LENTS_MAX - 1, 'pas encore');
  assert.equal(compterLenteur(n, 33), 0, 'une image à l’heure remet le compte à zéro');
  assert.equal(compterLenteur(n, LENT_MS + 50), LENTS_MAX, 'celle-ci coupe');
  assert.ok(LENTS_MAX * LENT_MS >= 1000, 'un seul à-coup (un rendu lourd) ne doit pas suffire');
});

test('les trois gardes sont branchées dans le démarrage et la boucle', () => {
  assert.match(amb, /if \(RENDU_LOGICIEL\.test\(rendu\)\) \{\s*c\.remove\(\);/);
  assert.match(amb, /lents = dernier \? compterLenteur\(lents, now - dernier\) : 0;/);
  assert.match(amb, /if \(lents >= LENTS_MAX\) \{\s*this\.couper\('la machine ne suivait pas le fond animé', true\);/);
  assert.match(amb, /'webglcontextlost'[\s\S]{0,80}this\.couper\('la carte graphique a été réinitialisée', true\)/);
  // Un fond coupé ne revient pas en revenant sur l'onglet.
  assert.match(amb, /else if \(!this\.coupe\) this\.resume\(\);/);
  assert.match(amb, /if \(this\.actif \|\| !this\.gl \|\| this\.coupe\) return;/);
});

test('le fond attend que la page soit là', () => {
  const boot = app.slice(app.indexOf('async function boot()'), app.indexOf('async function boot()') + 1500);
  assert.doesNotMatch(boot, /if \(Ambiance\.start\(\)\) syncAmbiance\(\);/, 'le fond démarre avant le premier affichage');
  assert.match(boot, /requestIdleCallback[\s\S]{0,80}appliquerFond\(\)/);
});

test('on peut l’éteindre, et Réglages dit pourquoi il l’est', () => {
  assert.match(app, /segment\('fondAnime', 'Le fond animé'/);
  assert.match(app, /if \(S\.settings\?\.fondAnime === false\) \{ Ambiance\.couper\('coupé dans Réglages'\)/);
  assert.match(app, /Éteint sur cet appareil : \$\{esc\(Ambiance\.raison\)\}/);
  const db = readFileSync(new URL('../server/db.js', import.meta.url), 'utf8');
  assert.match(db, /fondAnime: true,/, 'setSettings abandonne en silence une clé qu’il ne connaît pas');
});
