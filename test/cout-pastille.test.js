import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * LA PASTILLE DE COÛT, ET CE QU'ELLE NE DOIT PAS DEVENIR.
 *
 * Un prix affiché en clair sous chaque réponse transforme chaque phrase en
 * dépense, ce qui est la dernière chose à avoir en tête quand on vient écrire
 * un mauvais soir — c'est déjà la raison pour laquelle la jauge du rail est un
 * point et pas un compteur. Ces tests gardent la discrétion autant que le
 * chiffre.
 */
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
const sansCommentaires = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const page = sansCommentaires(app);

test('la pastille ne se pose que sur les réponses du compagnon', () => {
  const f = page.slice(page.indexOf('function coutMarkup('), page.indexOf('function echelleMarkup('));
  assert.match(f, /m\.role !== 'pet'/, 'elle irait se poser sous ce que TU as écrit');
  assert.match(f, /if \(!c\) return ''/,
    'une réponse sans détail afficherait une pastille vide — ou pire, un zéro qui veut dire « gratuit »');
});

test('LE DÉTAIL SE FUSIONNE, IL NE REMPLACE PAS', () => {
  /*
   * Le fil complet arrive avec le détail de tous ses messages ; le flux d'une
   * réponse n'apporte que celui de CETTE réponse. Remplacer la carte à chaque
   * fin de message ferait disparaître les pastilles une à une à mesure qu'on
   * parle — le contraire exact de ce qu'on veut montrer.
   */
  const f = page.slice(page.indexOf('const majCouts ='), page.indexOf('const majCouts =') + 220);
  assert.match(f, /COUTS\.set\(Number\(id\), c\)/);
  assert.equal(/COUTS = new Map\(Object/.test(f), false, 'la carte est remplacée à chaque message');
});

test('le fil et ce qui l’accompagne arrivent ENSEMBLE, dès le démarrage', () => {
  /*
   * `GET /api/messages` rendait déjà tout ça — mais RIEN NE L'APPELAIT. Au
   * rechargement, la page ne savait plus à quelles questions on avait déjà
   * répondu : l'échelle réapparaissait sous une question déjà relevée, et le
   * serveur refusait un geste que l'écran venait de proposer.
   */
  const api = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  const etat = api.slice(api.indexOf("'GET /api/state'"), api.indexOf("'GET /api/state'") + 3000);
  assert.match(etat, /ressentis: relevesDeToi\(idsDuFil, userId\)/, 'l’état ne porte plus les ressentis');
  assert.match(etat, /couts: Object\.fromEntries\(coutsParMessage\(idsDuFil, userId\)\)/,
    'l’état ne porte plus le détail des dépenses');
  assert.match(page, /RESSENTIS = new Map\(\(S\.ressentis \?\? \[\]\)/, 'la page ne les lit plus au démarrage');
  assert.match(page, /majCouts\(S\.couts\)/, 'la page ne lit plus les coûts au démarrage');
});

/*
 * LE FORMAT DE L'ARGENT A DÉMÉNAGÉ dans `web/formats.js`, avec les trois
 * autres écritures de nombres — il servait ici ET dans le panneau des jetons,
 * et les deux ne disaient pas la même chose. La règle (des centimes sous dix
 * centimes, un prix inconnu qui n'est pas un prix nul) est vérifiée là-bas,
 * sur la fonction elle-même plutôt que sur le texte du fichier.
 */

test('elle reste discrète, et lisible quand on la cherche', () => {
  assert.match(css, /\.cout \{[^}]*opacity: \.45[^}]*\}/, 'la pastille est au premier plan');
  assert.match(css, /\.msg:hover \.cout[^{]*\{[^}]*opacity: 1/, 'elle ne se révèle plus au survol');
});
