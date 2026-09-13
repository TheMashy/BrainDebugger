/**
 * LES NOMBRES S'ÉCRIVENT PAREIL PARTOUT.
 *
 * Ils ne l'étaient pas : le même montant s'écrivait « 0,140 $ » dans le
 * panneau des jetons et « 14,00 ¢ » sur la pastille d'un message, la part de
 * cache sortait « 74.4 % » avec un point décimal anglais, et `fmtTok` rendait
 * « 1.2 k ». On ne pouvait donc plus comparer ce que dit un message à ce que
 * dit la courbe au-dessus — le geste même qu'on fait devant ces chiffres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { virgule, fmtNb, dollars, fmtTok } from '../web/formats.js';

test('AUCUN POINT DÉCIMAL NE SORT D’ICI', () => {
  for (const t of [fmtNb(74.4), fmtNb(1.5), fmtTok(1200), fmtTok(1_250_000),
                   dollars(0.14), dollars(0.017), dollars(109.5), virgule('3.7')]) {
    assert.equal(t.includes('.'), false, `« ${t} » garde un point décimal`);
  }
});

test('sous dix centimes, on affiche des centimes', () => {
  assert.equal(dollars(0.01704), '1,70 ¢');
  assert.equal(dollars(0.0004), '0,04 ¢');
  assert.equal(dollars(0.0999), '9,99 ¢');
  // Au-dessus, des dollars : « 1095,4 ¢ » ne se lit pas.
  assert.equal(dollars(0.1), '0,10 $');
  assert.equal(dollars(109.54), '109,54 $');
});

test('UN PRIX INCONNU N’EST PAS UN PRIX NUL', () => {
  // Zéro voudrait dire « gratuit », et c'est le mensonge qui ne se remarque
  // qu'en comparant à une vraie facture.
  assert.equal(dollars(null), null);
  assert.equal(dollars(undefined), null);
  assert.equal(dollars('bof'), null);
  assert.equal(dollars(0), '0,00 ¢', 'zéro MESURÉ reste un chiffre, lui');
});

test('les jetons gardent une décimale tant qu’elle dit quelque chose', () => {
  assert.equal(fmtTok(56), '56');
  assert.equal(fmtTok(1200), '1,2 k');       // « 1 k » perdrait 200 jetons
  assert.equal(fmtTok(2000), '2 k');         // pas de « 2,0 k »
  assert.equal(fmtTok(11473), '11 k');
  assert.equal(fmtTok(65617), '66 k');
  assert.equal(fmtTok(1_250_000), '1,3 M');
});

test('un nombre sans décimale reste sans décimale', () => {
  assert.equal(fmtNb(2), '2');
  assert.equal(fmtNb(1.5), '1,5');
  assert.equal(fmtNb(74.44), '74,4');
  assert.equal(fmtNb(null), '—');
  assert.equal(fmtNb(undefined), '—');
});

test('IL N’Y A QU’UN ENDROIT QUI SAIT ÉCRIRE UNE DÉCIMALE', () => {
  /*
   * Neuf copies manuelles de `.replace('.', ',')` traînaient dans la page.
   * Elles rendaient le bon résultat — c'est justement pour ça qu'elles
   * survivaient, et qu'une dixième serait repartie avec un point.
   */
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.equal(app.includes(`replace('.', ',')`), false,
    'un remplacement décimal fait à la main est revenu dans app.js');
  assert.match(app, /import \{ virgule, fmtNb, dollars, fmtTok \} from '\.\/formats\.js'/);
});

test('la pastille d’un message porte le PRIX et les JETONS', () => {
  /*
   * Le prix dit ce que ça a coûté, les jetons disent pourquoi : deux lignes à
   * 0,14 $ n'ont rien d'étonnant quand on voit les 66 k traversés — et c'est
   * ce rapprochement, fait d'un coup d'œil, qui a fait trouver que 98 % de la
   * note était de l'écriture de cache.
   */
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const f = app.slice(app.indexOf('function coutMarkup('), app.indexOf('function echelleMarkup('));
  assert.match(f, /\[prix, `\$\{fmtTok\(c\.jetons\)\} jetons`\]/,
    'la pastille ne montre plus qu’un seul des deux chiffres');
});
