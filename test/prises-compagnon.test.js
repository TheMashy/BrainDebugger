/*
 * CE QUE LE COMPAGNON APPREND, ET CE QU'IL NE DOIT PAS EN FAIRE.
 *
 * Le comptage servait à un onglet ; celui qui parle à la personne tous les
 * soirs ne le connaissait pas. Le bloc comble ce trou, et c'est exactement là
 * qu'un outil de ce genre peut faire du mal : un compagnon qui reformule
 * « 12 jours sur 30 » en « tu bois trop » est un compagnon qu'on cesse
 * d'ouvrir les mauvais soirs, c'est-à-dire ceux qui comptent.
 *
 * On vérifie donc trois choses : qu'il porte les nombres, qu'il ne porte
 * aucun jugement, et qu'il ne bouge pas d'un message à l'autre — il est dans
 * la partie mise en cache du prompt, et un octet qui change y coûte la
 * relecture de toute la conversation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisesBlock } from '../server/chat.js';
import { analyserPrises } from '../server/prises.js';

const J = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

function compte() {
  const rows = [], solitude = [];
  for (let i = 0; i < 200; i += 2) {
    const seul = i % 16 === 0, boit = i % 16 === 2;
    if (seul) solitude.push(J(i));
    rows.push({ date: J(i), note: boit ? 3 : 6,
      text: boit ? "j'ai bu quatre bières. je veux arrêter, sérieusement cette fois."
          : seul ? 'personne de la journée.' : 'journée ordinaire.' });
  }
  return analyserPrises(rows, { carte: { noeuds: [{ nom: 'la solitude', jours: solitude }] },
                                aujourdhui: J(199) });
}

test('sans rien de compté, il n’y a pas de bloc du tout', () => {
  assert.equal(prisesBlock(null), null);
  assert.equal(prisesBlock({ prises: [] }), null);
});

test('le bloc porte les nombres, et ce qui vient avant', () => {
  const b = prisesBlock(compte());
  assert.match(b, /l’alcool — \d+ journées/);
  assert.match(b, /« la solitude » — \d+ fois sur \d+/);
  assert.match(b, /il a écrit : « .*arrêter/);
});

test('LE BLOC NE QUALIFIE PERSONNE ET NE CONSEILLE RIEN', () => {
  const b = prisesBlock(compte());
  const interdit = /addict|alcooliqu|alcoolo|toxico|dépendan|drogué|accro|malade|trouble|tu devrais|il devrait|conseille|arrête de|réduis/i;
  const m = interdit.exec(b);
  assert.equal(m, null, `le bloc dit « ${m?.[0]} » : ${b.split('\n').find(l => interdit.test(l))}`);
});

test('il dit explicitement de ne pas ouvrir le sujet', () => {
  const b = prisesBlock(compte());
  assert.match(b, /n’ouvres pas le sujet|n'ouvres pas le sujet/,
    'sans cette consigne, il pose « tu as bu combien de fois ce mois-ci ? » à quelqu’un venu parler d’autre chose');
});

test('le bloc ne bouge pas d’un message à l’autre', () => {
  /* Il est dans la partie mise en cache, avant tout le fil : un « depuis
     3 jours » qui devient « depuis 4 jours » à minuit ferait relire toute la
     conversation plein tarif au message suivant. */
  const p = compte();
  assert.equal(prisesBlock(p), prisesBlock(structuredClone(p)));
  assert.ok(!/depuis \d+ jour/.test(prisesBlock(p)), 'aucun compteur qui tourne tout seul');
});

test('trois choses au plus, pour que ça reste court', () => {
  const faux = { prises: Array.from({ length: 6 }, (_, i) => ({
    cle: `x${i}`, nom: `la chose ${i}`, n: 10, compare: false, signes: [], avant_ca: [], apres_ca: null })) };
  const b = prisesBlock(faux);
  assert.equal((b.match(/la chose \d/g) ?? []).length, 3);
});
