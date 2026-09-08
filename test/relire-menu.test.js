import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * UN SEUL BOUTON DANS L'EN-TÊTE DE MA CARTE.
 *
 * Il y en avait quatre : « relire », et derrière un « + » « relire tout »,
 * « retisser » et « ranger sur les journées vécues ». Quatre portes pour une
 * seule lecture — relire et retisser étaient le même appel au même prix,
 * relire tout ne servait qu'à une refonte qui part toute seule, ranger n'est
 * pas une lecture. Ces tests relisent la page, parce que c'est une régression
 * qui ne casse rien : elle remet seulement trois décisions devant le lecteur.
 */

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const sansCommentaires = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const debutCarte = app.indexOf('async function renderLecture()');
const finCarte = app.indexOf('async function lancerLecture(', debutCarte);
assert.ok(debutCarte > 0 && finCarte > debutCarte, 'le rendu de Ma carte est introuvable — repères déplacés ?');
const carte = sansCommentaires(app.slice(debutCarte, finCarte));

const debutReglages = app.indexOf('async function renderSettings()');
assert.ok(debutReglages > 0, 'renderSettings est introuvable');
const reglages = sansCommentaires(app.slice(debutReglages, debutReglages + 60000));

test('Ma carte ne propose qu’une action : « relire »', () => {
  assert.equal(carte.includes('lecplus'), false, 'le repli « + » est revenu dans l’en-tête');
  for (const porte of ['data-lire-tout', 'id="retisser"', 'data-ranger-nuits']) {
    assert.equal(carte.includes(porte), false, `« ${porte} » est de nouveau proposé dans Ma carte`);
  }
  assert.match(carte, /data-lire[^>]*>\$\{ico\('refaire'\)\}relire</, 'le bouton « relire » a disparu');
});

test('la branche morte du refroidissement — « deux fois par jour » — n’est plus affichée', () => {
  // RETISSAGE_ATTENTE vaut 0 côté serveur : ce texte ne pouvait jamais s'afficher, et il était faux.
  assert.equal(app.includes('deux fois par jour, pas plus'), false);
  assert.equal(carte.includes('L.retissage'), false);
});

test('le clic « relire » joue le tissage, et part en fond pendant une refonte', () => {
  /*
   * Deux lectures pour un clic, c'était la même requête au même prix : l'une
   * muette, l'autre montrée. Un clic attend, donc il regarde. Et pendant une
   * refonte, le serveur relit TOUT — dix fois plus de texte — : ce clic-là
   * ne doit pas partir en direct au plein tarif sans le dire, il part en lot.
   */
  const i = app.indexOf('async function relire()');
  assert.ok(i > 0, 'relire() n’existe pas : le clic ne décide plus rien');
  const corps = sansCommentaires(app.slice(i, app.indexOf('\n}\n', i)));
  assert.match(corps, /refonte[\s\S]*lancerLecture\(\{\s*fond:\s*true/, 'la refonte ne part pas en fond');
  assert.match(corps, /return retisser\(\)/, 'le clic ne passe pas par le tissage');
  assert.match(sansCommentaires(app), /closest\('\[data-lire\]'\)\)\s*return relire\(\)/, 'le bouton n’appelle pas relire()');
});

test('ce qui sort du menu vit dans Réglages, avec sa raison d’être', () => {
  for (const porte of ['data-lire-tout', 'data-ranger-nuits']) {
    assert.ok(reglages.includes(porte), `« ${porte} » n’est plus proposé nulle part`);
  }
  assert.match(reglages, /Quand s'en servir/, 'le bouton rare ne dit pas quand s’en servir');
  // Et le sous-texte de la lecture de fond ne raconte plus un calendrier qui n'existe pas.
  assert.equal(reglages.includes('une fois par semaine'), false);
  assert.match(reglages, /sept journées ou notes/);
});

test('le retissage refuse de partir pendant qu’un lot est en vol', () => {
  // La route en flux ne le vérifie pas ; l'écran doit le faire, sinon deux
  // lectures payantes partent sur le même corpus.
  const i = app.indexOf('async function retisser()');
  const corps = sansCommentaires(app.slice(i, i + 600));
  assert.match(corps, /LECTURE\?\.enLot\)\s*return/);
});

test('ces boutons-là ne sont pas enfermés dans le mode « Claude »', () => {
  /*
   * LA RÉGRESSION QUE LE TEST D'AU-DESSUS NE VOYAIT PAS. Il cherchait les deux
   * portes quelque part dans renderSettings ; elles y étaient — dans la branche
   * `chatBackend === 'anthropic'`. Or le backend par défaut est `scripted` :
   * quelqu'un qui n'a jamais mis de clé, c'est-à-dire le cas normal à
   * l'installation, ne les voyait ni l'une ni l'autre. « Ranger les soirées sur
   * les journées vécues » est gratuit et n'appelle aucun modèle : le mode du
   * compagnon n'a rien à dire sur sa disponibilité.
   *
   * On vérifie donc la POSITION, pas la présence : hors de la branche.
   */
  const i = app.indexOf('async function renderBackendCfg()');
  assert.ok(i > 0, 'renderBackendCfg est introuvable');
  const fin = app.indexOf('\n}\n', app.indexOf("$('#apiKey')", i));
  const fonction = app.slice(i, fin > i ? fin : i + 20000);
  const deb = fonction.indexOf("if (s.chatBackend === 'anthropic') {");
  const finBranche = fonction.indexOf("} else if (s.chatBackend === 'ollama')", deb);
  assert.ok(deb > 0 && finBranche > deb, 'la branche Anthropic est introuvable — repères déplacés ?');
  const brancheAnthropic = fonction.slice(deb, finBranche);
  for (const porte of ['data-lire-tout', 'data-ranger-nuits']) {
    assert.equal(brancheAnthropic.includes(porte), false, `« ${porte} » est de nouveau réservé au mode Claude`);
    assert.ok(fonction.includes(porte), `« ${porte} » a disparu de renderBackendCfg`);
  }
  // Et la sortie commune est bien posée après TOUTES les branches.
  assert.match(fonction, /el\.innerHTML = '';\s*\}\s*\n\s*el\.innerHTML \+= OUTILS_JOURNAL;/,
               'les outils du journal ne sont pas ajoutés après la chaîne de branches');
});
