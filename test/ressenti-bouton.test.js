import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * LE GESTE NE DOIT PAS DÉPENDRE DE LA FAÇON DONT QUELQU'UN D'AUTRE TOURNE SA
 * PHRASE.
 *
 * L'échelle n'apparaissait que sous une question reconnue par une liste de
 * tournures. Mesuré sur quatre ans de journal réel : 8 des 486 messages du
 * compagnon étaient reconnus — 1,6 %. Le bouton du champ de saisie ouvre la
 * même échelle à n'importe quel moment, sans rien attendre de personne.
 *
 * Ces tests relisent la page : la régression serait SILENCIEUSE. Un bouton
 * débranché s'affiche normalement, et on ne s'en aperçoit que le soir où l'on
 * voulait s'en servir.
 */

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
const sansCommentaires = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const page = sansCommentaires(app);

test('le bouton et son échelle existent, dans le composeur', () => {
  assert.match(page, /id="ressentiNow"/, 'le bouton a disparu du champ de saisie');
  assert.match(page, /id="ressnow"[^>]*hidden/, 'l’échelle n’est plus posée repliée');
  assert.match(page, /data-ressenti-now="\$\{v\}"/, 'les onze crans ne sont plus rendus');
});

test('LES DEUX SONT BRANCHÉS SUR LE COMPOSEUR, PAS SUR LE FIL', () => {
  /*
   * `bindGestes` écoute `#thread`. Ni le bouton ni l'échelle n'y sont : posés
   * là, leur clic n'avait aucun écouteur — c'est la panne qu'on a eue, et elle
   * ne se voit sur aucun écran.
   */
  assert.match(page, /\$\('#ressentiNow'\)\.onclick/, 'le bouton n’est plus branché');
  assert.match(page, /\$\('#ressnow'\)\.onclick/, 'l’échelle n’est plus branchée');
  const gestes = page.slice(page.indexOf('function bindGestes('), page.indexOf('function bindGestes(') + 4000);
  assert.equal(gestes.includes('ressenti-now'), false,
    'le branchement est reparti dans le fil, où le clic n’arrive jamais');
});

test('ouvrir l’échelle CACHE et MONTRE — ça ne re-peint pas la vue', () => {
  // Re-rendre viderait le champ de saisie à moitié écrit. On ne fait pas ça à
  // quelqu'un au milieu d'une phrase.
  const f = page.slice(page.indexOf('function basculerRessentiNow('),
                       page.indexOf('async function poserRessentiMaintenant('));
  assert.match(f, /el\.hidden = !on/, 'l’ouverture ne passe plus par `hidden`');
  assert.equal(/renderTonight\(|drawThread\(/.test(f), false,
    'la bascule re-peint la vue : le message en cours d’écriture serait perdu');
});

test('la pastille se pose sur le message QUE LE SERVEUR NOMME', () => {
  /*
   * Si la page rejouait le calcul de son côté, le chiffre s'afficherait sous
   * une bulle et serait enregistré sous une autre le jour où le fil a bougé
   * entre l'envoi et la réponse.
   */
  const f = page.slice(page.indexOf('async function poserRessentiMaintenant('),
                       page.indexOf('async function poserRessenti('));
  assert.match(f, /r\?\.messageId != null/, 'la page ne lit plus le message rendu par la route');
  assert.equal(/RESSENTIS\.set\(Number\(FIL|at\(-1\)/.test(f), false,
    'la page redevine à quel message accrocher : elle doit croire le serveur');
  assert.match(f, /basculerRessentiNow\(false\)/, 'l’échelle reste ouverte après le geste : c’est un formulaire');
});

test('l’échelle qu’on ouvre soi-même a de quoi se voir', () => {
  assert.match(css, /\.ressnow \{[^}]*border: 1px solid var\(--line\)[^}]*\}/,
    'elle n’a plus de cadre : elle se confond avec le fil au-dessus');
  assert.match(css, /#ressentiNow\[aria-expanded="true"\]/,
    'rien ne montre que l’échelle est ouverte');
});
