/**
 * L'heure devant chaque message.
 *
 * Le compagnon ne pouvait pas savoir qu'on lui écrivait à trois heures du
 * matin, ni que sept heures s'étaient écoulées depuis la dernière phrase —
 * alors que c'est ce qu'on remarque en premier chez quelqu'un qu'on connaît.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { marqueTemps, SYSTEM_PROMPT } from '../server/chat.js';

test('le marqueur porte le jour et l’heure', () => {
  const t = marqueTemps(new Date(2026, 7, 12, 3, 14).toISOString());
  assert.match(t, /^mer\. 12\/08 03:14$/);
});

test('minuit et midi ne se confondent pas', () => {
  // Le cas qui compte : c'est précisément l'heure où l'on écrit ce qu'on
  // n'écrit pas en plein jour.
  assert.match(marqueTemps(new Date(2026, 0, 1, 0, 5).toISOString()), /00:05$/);
  assert.match(marqueTemps(new Date(2026, 0, 1, 12, 5).toISOString()), /12:05$/);
});

test('une date illisible ne produit pas de marqueur', () => {
  // Sans ça, un « [Invalid Date] » se retrouverait collé devant une phrase.
  assert.equal(marqueTemps('pas une date'), null);
  assert.equal(marqueTemps(''), null);
  assert.equal(marqueTemps(undefined), null);
});

test('la consigne interdit de recopier le marqueur', () => {
  // Un compagnon qui préfixe ses réponses de l'heure a l'air d'un journal
  // système, pas de quelqu'un.
  assert.match(SYSTEM_PROMPT, /ne le recopies jamais/);
  assert.match(SYSTEM_PROMPT, /tu ne sais pas s'il dormait/);
});

/* ------------------------------------------------------------------------
   Le marqueur, LÀ OÙ IL SERT.

   Ces tests-ci importaient `marqueTemps` depuis chat.js et le trouvaient : la
   forme `export { x } from './y.js'` re-exporte parfaitement. Ce qu'elle ne
   fait PAS, c'est créer une liaison locale — le nom traverse le module sans y
   exister. `toChatMessages`, à l'intérieur, levait donc « marqueTemps is not
   defined » à chaque message, et le compagnon retombait hors-ligne en pleine
   conversation. On teste maintenant l'USAGE, pas seulement l'export.        */

import { toChatMessages } from '../server/chat.js';

test('chaque message part vers le modèle avec son jour et son heure', () => {
  const out = toChatMessages([
    { ts: new Date(2026, 7, 12, 3, 14).toISOString(), role: 'user', text: "j'arrive pas à dormir" },
    { ts: new Date(2026, 7, 12, 3, 15).toISOString(), role: 'pet',  text: 'Depuis quand ?' }
  ]);
  assert.equal(out.length, 2);
  assert.match(out[0].content, /^\[mer\. 12\/08 03:14\] j'arrive pas à dormir$/);
  assert.equal(out[0].role, 'user');
  // « pet » devient « assistant » : c'est le vocabulaire de l'API, pas le nôtre.
  assert.equal(out[1].role, 'assistant');
});

test('un message sans horodatage part sans marqueur inventé', () => {
  // Et surtout : sans lever. C'est le chemin qui cassait.
  const out = toChatMessages([{ ts: null, role: 'user', text: 'salut' }]);
  assert.equal(out[0].content, 'salut');
});

test('le compagnon hors-ligne répond, marqueur ou pas', async () => {
  // Le bout en bout minimal : si un nom manque quelque part dans la chaîne,
  // c'est ici que ça se voit, sans clé ni réseau.
  const { reply } = await import('../server/chat.js');
  const r = await reply(
    [{ ts: new Date().toISOString(), role: 'user', text: "j'ai pas dormi" }],
    { chatBackend: 'scripted' });
  assert.equal(r.backend, 'scripted');
  assert.ok(r.text && r.text.length > 0);
});
