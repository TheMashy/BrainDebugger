/*
 * UN ÉCRAN NOIR NE DIT RIEN, ET C'EST LE PIRE DES ÉTATS.
 *
 * Vu en vrai, sur une capture : le nom du produit à gauche, une ligne vide en
 * haut, et rien. Pas une barre de navigation, pas un message, rien à cliquer.
 * L'application avait l'air plantée ; elle attendait une réponse qui n'est
 * jamais venue.
 *
 * `boot()` est une suite d'`await` qui commence par `/api/state`. La première
 * qui lève saute tout le reste — les icônes de la barre sont vides dans le
 * HTML, c'est le démarrage qui les remplit, et `go()` n'est jamais appelé.
 * Une seule requête ratée, et l'application entière disparaît.
 *
 * Ces tests tiennent ce qui rend une panne LISIBLE. Ils ne l'empêchent pas :
 * ils font qu'on sache laquelle.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const sansCommentaires = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const code = sansCommentaires(app);

test('UN DÉMARRAGE QUI ÉCHOUE LE DIT', () => {
  assert.match(code, /boot\(\)\.catch\(/,
    'boot() sans filet : la première requête ratée laisse une page noire');
  const filet = code.slice(code.indexOf('boot().catch('));
  assert.match(filet, /monterNav\(\)/,
    'sans la barre, il ne reste même pas de quoi aller ailleurs');
  assert.match(filet, /err\?\.message/, 'le message d’erreur doit être montré');
  assert.match(filet, /location\.reload\(\)/, 'et il faut pouvoir réessayer');
});

test('UNE PAGE D’ERREUR N’EST PAS DU JSON', () => {
  /*
   * Un 502 de l'hébergeur pendant un redéploiement renvoie du HTML.
   * `res.json()` lève alors « Unexpected token '<' » — une erreur de syntaxe
   * là où la seule information utile est le code HTTP.
   */
  const f = code.slice(code.indexOf('async function api('), code.indexOf('async function api(') + 1400);
  assert.equal(/const j = await res\.json\(\)/.test(f), false,
    'res.json() sur une page d’erreur cache le code HTTP derrière une erreur de syntaxe');
  assert.match(f, /res\.text\(\)/);
  assert.match(f, /le serveur a répondu \$\{res\.status\}/);
});

test('le journal n’est jamais mis en cause par une panne d’écran', () => {
  /*
   * Ce qu'on lit devant une page en panne décide si on la recharge ou si on
   * croit avoir tout perdu. Ce sont deux soirées très différentes.
   */
  const filet = code.slice(code.indexOf('boot().catch('));
  assert.match(filet, /pas perdues/);
});
