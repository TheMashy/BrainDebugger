/**
 * LA VOIX PARLÉE : ce qui se dit, quand, et avec quelle voix.
 *
 * Le découpage décide du moment où la voix commence : trop tard, et la
 * conversation retrouve son blanc ; trop tôt, et elle lit « 3. » au milieu de
 * « 3.5 ». On teste donc les coupures sur un flux réel, morceau par morceau.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { decouper, nettoyerPourVoix, classerVoix, voixParDefaut, PREMIER_MORCEAU } from '../web/parole.js';

/** Rejoue un flux en fragments, comme le modèle les livre. */
function rejouer(fragments) {
  let tampon = '', premier = true;
  const dits = [];
  for (const f of fragments) {
    tampon += f;
    const { morceaux, reste } = decouper(tampon, { premier });
    tampon = reste;
    if (morceaux.length) premier = false;
    dits.push(...morceaux);
  }
  dits.push(...decouper(tampon, { premier, fin: true }).morceaux);
  return dits;
}

test('une phrase part dès qu’elle est finie, sans attendre la suite', () => {
  const { morceaux, reste } = decouper('Ça a l’air lourd. Et ce soir');
  assert.deepEqual(morceaux, ['Ça a l’air lourd.']);
  assert.equal(reste, 'Et ce soir');
});

test('on ne coupe pas un nombre décimal en cours de flux', () => {
  const { morceaux } = decouper('Tu as dormi 6.5');
  assert.deepEqual(morceaux, [], '« 6. » n’est pas une fin de phrase');
  assert.deepEqual(rejouer(['Tu as dormi 6.', '5 heures. Pas mal.']), ['Tu as dormi 6.5 heures.', 'Pas mal.']);
});

test('la ponctuation française, espace avant le point d’interrogation', () => {
  assert.deepEqual(rejouer(['Et toi, ça va ', '? Raconte-moi.']), ['Et toi, ça va ?', 'Raconte-moi.']);
});

test('la première phrase longue part à la virgule, pour parler plus tôt', () => {
  const long = 'Quand tu dis que tout s’est effondré en fin de journée, tu parles du';
  assert.ok(long.length >= PREMIER_MORCEAU);
  const { morceaux } = decouper(long, { premier: true });
  assert.equal(morceaux[0], 'Quand tu dis que tout s’est effondré en fin de journée,');
  // Les suivantes, elles, attendent leur fin de phrase.
  assert.deepEqual(decouper(long, { premier: false }).morceaux, []);
});

test('rien ne se perd : tout le texte est dit, dans l’ordre', () => {
  const texte = 'Je vois. Tu dis que c’était lourd — et puis le concert a tout changé ? Ça arrive.\nEt maintenant';
  const frag = texte.match(/.{1,7}/gs);
  const dits = rejouer(frag);
  assert.equal(dits.join(' ').replace(/\s+/g, ' '), texte.replace(/\s+/g, ' '));
});

test('ce qui se lit mal à voix haute est retiré', () => {
  assert.equal(nettoyerPourVoix('**Vraiment** ? Va voir https://exemple.fr 🙂'), 'Vraiment ? Va voir');
  assert.equal(nettoyerPourVoix('lourd — et puis'), 'lourd, et puis');
  assert.equal(nettoyerPourVoix('- un point\n- un autre'), 'un point un autre');
});

const V = (name, lang, localService) => ({ name, lang, localService, voiceURI: name });
const VOIX = [
  V('Samantha', 'en-US', true),
  V('Thomas', 'fr-FR', true),
  V('Google français', 'fr-FR', false),
  V('Microsoft Denise Online (Natural) - French (France)', 'fr-FR', false),
  V('Amélie (Enhanced)', 'fr-CA', true),
];

test('seules les voix françaises, les plus belles d’abord', () => {
  const c = classerVoix(VOIX).map(v => v.name);
  assert.ok(!c.includes('Samantha'), 'une voix anglaise lisant du français est pire que des blips');
  assert.equal(c[0], 'Microsoft Denise Online (Natural) - French (France)');
});

test('par défaut, jamais une voix en ligne : le texte resterait sur la machine', () => {
  const v = voixParDefaut(VOIX);
  assert.equal(v.localService, true);
  assert.equal(v.name, 'Amélie (Enhanced)');
  assert.equal(voixParDefaut([V('Google français', 'fr-FR', false)]), null);
});
