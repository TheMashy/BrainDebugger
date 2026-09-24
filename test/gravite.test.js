/**
 * UN SOIR GRAVE, LE COMPAGNON RÉFLÉCHIT À FOND.
 *
 * Il répond à l'effort « bas » par défaut. Comparé à la même discussion menée
 * avec réflexion, l'écart de justesse était le plus net exactement là : quand
 * quelqu'un écrit qu'il aimerait « s'endormir pour toujours ». Et la veille,
 * qui ne lit que les mots explicites, ne voyait aucune de ces phrases.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messageGrave, conversationGrave, FENETRE_GRAVE } from '../server/gravite.js';
import { reglageDuTour, optionsDuModele, plafondDuCompagnon, PLAFOND_AVEC_REFLEXION } from '../server/chat.js';

const u = text => ({ role: 'user', text });
const p = text => ({ role: 'pet', text });

test('les phrases indirectes de la discussion de test sont vues', () => {
  for (const t of ["j'aimerais que ça s'arrête là maintenant",
                   "j'aimerais m'endormir pour toujours, et me dissoudre lentement",
                   "je n'ai pas envie de la voir",
                   'je pense à me tuer',
                   "j'ai plus envie de vivre",
                   'je voudrais disparaître'])
    assert.equal(messageGrave(t), true, t);
});

test('ce que la veille voit (un geste, un objet en main) compte aussi', () => {
  // Aucune de ces phrases ne parle de mourir : c'est la veille qui les lit.
  for (const t of ['je viens de me faire du mal', 'je me suis encore scarifié ce soir',
                   "j'ai avalé toute la boîte", 'j ai le couteau dans la main'])
    assert.equal(messageGrave(t), true, t);
});

test('l’ENVIE de tout prendre compte, pas seulement la prise faite', () => {
  for (const t of ["j'ai envie de prendre plein d'anxios",
                   "m'envoyer un joint et tout mes anxios avec du caravan palace",
                   'avaler toute la plaquette'])
    assert.equal(messageGrave(t), true, t);
  for (const t of ['je prends mon anxio du soir', 'tout mes amis sont là', 'on a pris tous les billets'])
    assert.equal(messageGrave(t), false, t);
});

test('une soirée ordinaire ne l’est pas', () => {
  for (const t of ['je fais une liste de courses', 'je suis mort de rire', 'on a fini le film',
                   'la négo il m a dit que 170 c était trop brutal', 'je vais dormir, bonne nuit'])
    assert.equal(messageGrave(t), false, t);
});

test('la gravité tient quelques messages : le « non » qui suit compte aussi', () => {
  const fil = [u("j'aimerais m'endormir pour toujours"), p('Est-ce que tu penses à te tuer ?'),
               u('non'), p('D’accord.'), u('bon')];
  assert.equal(conversationGrave(fil), true);
  const loin = [u("j'aimerais m'endormir pour toujours"),
                ...Array.from({ length: FENETRE_GRAVE }, (_, i) => u(`message ordinaire ${i}`))];
  assert.equal(conversationGrave(loin), false, 'la gravité ne doit pas coller à toute la soirée');
});

test('grave : effort élevé ET réflexion, quel que soit le réglage', () => {
  const s = { anthropicEffort: 'low', chatPensee: false };
  assert.deepEqual(reglageDuTour(s, false), { effort: 'low', pense: false });
  assert.deepEqual(reglageDuTour(s, true), { effort: 'high', pense: true });
  // Sur Opus 5 (réflexion éteignable), le soir grave la rallume vraiment…
  const o5 = optionsDuModele('claude-opus-5', reglageDuTour(s, true));
  assert.deepEqual(o5.thinking, { type: 'adaptive' });
  assert.deepEqual(o5.output_config, { effort: 'high' });
  // …et la réponse garde sa place sous le plafond.
  assert.equal(plafondDuCompagnon(o5), PLAFOND_AVEC_REFLEXION);
});

test('les deux routes du compagnon passent la gravité', () => {
  const api = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  assert.equal((api.match(/grave: conversationGrave\(history\)/g) ?? []).length, 2);
  const chat = readFileSync(new URL('../server/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /optionsDuModele\(s\.anthropicModelChat \|\| 'claude-sonnet-5', reglageDuTour\(s, grave\)\)/);
  assert.match(chat, /anthropicReply\(history, settings, memory, onText, outils, onPense, echos, blocsMemoire, grave\)/);
});
