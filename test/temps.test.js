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

test('le compagnon ne se voit jamais horodater lui-même', () => {
  /*
   * LE DÉFAUT : le marqueur allait sur TOUS les messages, réponses comprises.
   * Le modèle voyait donc, dans son propre rôle, une centaine de répliques
   * commençant par « [sam. 29/08 07:07] » — et un modèle imite ce qu'il voit
   * de lui-même bien plus sûrement qu'il n'obéit à une consigne. Il s'est mis à
   * poser le crochet en tête de réponse, où il s'affichait tel quel dans la
   * bulle, en double avec l'horodatage que la bulle porte déjà.
   *
   * La consigne le lui interdisait, et ne suffisait pas : ce n'était pas une
   * question de compréhension, c'était un exemple répété à chaque tour.
   */
  const out = toChatMessages([
    { ts: new Date(2026, 7, 12, 3, 14).toISOString(), role: 'user', text: 'coucou' },
    { ts: new Date(2026, 7, 12, 3, 15).toISOString(), role: 'pet',  text: 'Depuis quand ?' }
  ]);
  assert.match(out[0].content, /^\[/, 'ce que la personne écrit garde son heure');
  assert.equal(out[1].content, 'Depuis quand ?');
});

test('un marqueur déjà enregistré est retiré de l’historique relu', async () => {
  // Les tours où il l'a recopié sont dans la base pour toujours. Les relire tels
  // quels ferait repartir l'imitation au tour suivant.
  const out = toChatMessages([
    { ts: null, role: 'pet', text: '[sam. 29/08 07:08]Pas de souci, laisse tomber.' }
  ]);
  assert.equal(out[0].content, 'Pas de souci, laisse tomber.');

  const { sansMarqueur } = await import('../server/chat.js');
  // Un crochet que la personne aurait écrit elle-même n'est pas un marqueur.
  assert.equal(sansMarqueur('[note] un truc'), '[note] un truc');
  assert.equal(sansMarqueur('rien à retirer'), 'rien à retirer');
});

test('une réponse ne s’enregistre jamais avec un marqueur en tête', async () => {
  // Le nettoyage est dans `reply()`, pas dans chaque appelant : il y a deux
  // routes qui enregistrent une réponse, et quatre backends qui en produisent.
  const { reply } = await import('../server/chat.js');
  const r = await reply([{ ts: new Date().toISOString(), role: 'user', text: 'salut' }],
                        { chatBackend: 'scripted' });
  assert.doesNotMatch(r.text, /^\[\p{L}{2,4}\.?\s+\d{2}\/\d{2}/u);
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
