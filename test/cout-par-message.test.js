/**
 * CE QUE CETTE RÉPONSE-LÀ A COÛTÉ.
 *
 * Le compteur disait ce que le MOIS coûte — le seul chiffre sur lequel on ne
 * peut rien. On ne change pas « 0,44 $ ce mois-ci » ; on change une façon
 * d'écrire ou un réglage, et pour voir l'effet il faut le voir à côté de la
 * phrase qui l'a produit.
 *
 * Deux choses seraient faciles à rater et coûteraient leur sens au chiffre :
 * un modèle dont on ignore le tarif ne vaut pas ZÉRO, et une réponse qui a
 * demandé plusieurs appels (un tour d'outil relance le modèle) coûte leur
 * SOMME, pas le dernier.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-cout-')), 'test.db');
const { upsertUser } = await import('../server/db.js');
const { record, coutsParMessage, PRICES, LECTURE_CACHE, ECRITURE_CACHE } = await import('../server/usage.js');

const U = 'cout';
upsertUser({ id: U, username: U });

test('le prix suit le tarif du modèle ET le traitement du cache', () => {
  record(U, 'claude-sonnet-5', 1000, 500, 0, 0, 'chat', 11);
  const c = coutsParMessage([11], U).get(11);
  const p = PRICES['claude-sonnet-5'];
  assert.equal(c.dollars, (1000 * p.in + 500 * p.out) / 1e6);
  assert.equal(c.jetons, 1500);
});

test('UN JETON RELU DU CACHE NE COÛTE PAS UN JETON D’ENTRÉE', () => {
  /*
   * Il coûte un dixième, et l'écrire un quart de plus. Les compter tous
   * pareil ferait mentir le seul chiffre qui dit ce que ce produit coûte :
   * sur une conversation où 85 % de l'entrée est relue, le total afficherait
   * presque dix fois la dépense réelle — et on conclurait que le cache n'a
   * rien changé.
   */
  record(U, 'claude-sonnet-5', 100, 0, 10000, 400, 'chat', 12);
  const c = coutsParMessage([12], U).get(12);
  const p = PRICES['claude-sonnet-5'];
  assert.equal(c.dollars, (100 + 10000 * LECTURE_CACHE + 400 * ECRITURE_CACHE) * p.in / 1e6);
  assert.ok(c.dollars < 100 * 10100 * p.in / 1e6);
});

test('PLUSIEURS APPELS SUR UNE MÊME RÉPONSE S’ADDITIONNENT', () => {
  // Un tour d'outil relance le modèle : la réponse a coûté les deux.
  record(U, 'claude-sonnet-5', 200, 100, 0, 0, 'chat', 13);
  record(U, 'claude-sonnet-5', 300, 250, 0, 0, 'chat', 13);
  const c = coutsParMessage([13], U).get(13);
  assert.equal(c.input, 500);
  assert.equal(c.output, 350);
  const p = PRICES['claude-sonnet-5'];
  assert.equal(c.dollars, (500 * p.in + 350 * p.out) / 1e6);
});

test('UN TARIF INCONNU REND `null`, JAMAIS ZÉRO', () => {
  /*
   * Zéro voudrait dire « gratuit », et c'est le genre de mensonge qui ne se
   * remarque qu'en comparant à une vraie facture. Les jetons, eux, se comptent
   * quoi qu'il arrive : ils ne dépendent d'aucun tarif.
   */
  record(U, 'claude-modele-de-2029', 1000, 1000, 0, 0, 'chat', 14);
  const c = coutsParMessage([14], U).get(14);
  assert.equal(c.dollars, null);
  assert.equal(c.jetons, 2000);
});

test('un prix inconnu contamine le total plutôt que d’y disparaître', () => {
  record(U, 'claude-sonnet-5', 100, 100, 0, 0, 'chat', 15);
  record(U, 'claude-modele-de-2029', 100, 100, 0, 0, 'chat', 15);
  const c = coutsParMessage([15], U).get(15);
  assert.equal(c.dollars, null, 'une somme partielle aurait l’air complète, et serait fausse');
  assert.equal(c.jetons, 400);
});

test('les réponses d’avant cette version n’ont pas d’entrée du tout', () => {
  // Le lien n'existait pas ; aucune heuristique ne le retrouvera message par
  // message. L'écran n'affiche alors pas de pastille — pas une pastille à zéro.
  record(U, 'claude-sonnet-5', 900, 900, 0, 0, 'chat', null);
  assert.equal(coutsParMessage([16], U).size, 0);
  assert.equal(coutsParMessage([], U).size, 0);
});

test('LE MESSAGE EST ÉCRIT AVANT SA DÉPENSE, SUR LES DEUX ROUTES', () => {
  /*
   * Une dépense ne peut pas nommer une réponse qui n'existe pas encore. Les
   * deux routes enregistraient l'usage AVANT `addMessage` : dans cet ordre,
   * `message_id` serait NULL sur toutes les lignes, et la pastille
   * n'apparaîtrait jamais — sans que rien ne casse.
   */
  const api = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  const appels = [...api.matchAll(/recordUsage\(userId, r\.model,[\s\S]{0,220}?\);/g)].map(m => m[0]);
  assert.equal(appels.length, 2, 'les deux routes du compagnon ne sont plus reconnaissables');
  for (const a of appels) {
    assert.match(a, /'chat', idPet, r\.composition \?\? null\)/,
      'un appel du compagnon n’attache plus sa dépense à sa réponse, ou n’enregistre plus de quoi était fait son prompt');
  }
  // Pour chacun des deux appels : la réponse doit être écrite JUSTE AVANT, dans
  // la même poignée de lignes. Chercher « quelque part avant dans le fichier »
  // passerait au vert sur l'autre route.
  let i = -1;
  for (let n = 0; n < 2; n++) {
    i = api.indexOf('recordUsage(userId, r.model,', i + 1);
    assert.ok(i > 0);
    const avant = api.slice(Math.max(0, i - 400), i);
    assert.match(avant, /const idPet = addMessage\(/,
      'la dépense est de nouveau enregistrée avant la réponse qu’elle nomme');
  }
});

/* =====================================================================
 *  DE QUOI ÉTAIT FAIT LE PROMPT.
 *
 * Une réponse coûtait 0,14 $ dont 98 % en ÉCRITURE de cache : un bloc réécrit
 * à chaque message au lieu d'être relu à un dixième. Le total ne dit pas QUEL
 * bloc, et les gros blocs viennent du journal de la personne — ils ne se
 * reproduisent sur aucune autre machine. La mesure doit venir d'où la requête
 * part.
 * ===================================================================== */

const { assemblerPrompt } = await import('../server/chat.js');
const tour = (memory, echos, texte) => assemblerPrompt({
  memory, echos, history: [{ role: 'user', text: texte, ts: new Date().toISOString() }] });

test('le prompt dit sa composition, bloc par bloc', () => {
  const c = tour('MEM'.repeat(200), 'ÉCHO'.repeat(50), 'salut').composition;
  assert.equal(c.memoire, 600);
  assert.equal(c.echos, 'ÉCHO'.repeat(50).length);
  assert.ok(c.systeme > 1000, 'le prompt système n’est plus compté');
  assert.ok(c.fil > 0 && c.fil < 200, `le fil compte les échos avec lui : ${c.fil}`);
});

test('LA TÊTE NE BOUGE PAS QUAND SEUL LE VOLATIL BOUGE', () => {
  /*
   * C'est l'invariant qui tient tout le cache : le système et la mémoire
   * portent les deux points de reprise explicites. Si leur empreinte change
   * d'un message à l'autre, le cache ne PEUT pas être relu — et l'écriture
   * coûte un quart de plus que de ne rien cacher du tout.
   */
  const a = tour('MEM', 'échos du tour A', 'première phrase').composition;
  const b = tour('MEM', 'échos du tour B, tout autres', 'deuxième phrase').composition;
  assert.equal(a.tete, b.tete, 'les échos ou le fil ont contaminé la tête du prompt');
});

test('…et elle bouge dès que la mémoire bouge — sinon la mesure ne sert à rien', () => {
  const a = tour('MEM', 'é', 'x').composition;
  const b = tour('MEM ET UN MOT DE PLUS', 'é', 'x').composition;
  assert.notEqual(a.tete, b.tete, 'une mémoire qui change ne se voit pas : l’instrument est aveugle');
});
