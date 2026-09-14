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

/*
 * UN DÉCOR À DEUX FAMILLES.
 *
 * `compte()` n'en rend qu'une, et les tests du verrou ont besoin d'au moins
 * deux lignes : tout leur objet est de vérifier que la mention se pose sur la
 * ligne cochée ET PAS sur l'autre. Sur une seule ligne, ils passeraient avec
 * une mention collée partout.
 */
function compteDeux() {
  const rows = [], solitude = [];
  for (let i = 0; i < 200; i += 2) {
    const seul = i % 16 === 0, boit = i % 16 === 2, fume = i % 16 === 6;
    if (seul) solitude.push(J(i));
    rows.push({ date: J(i), note: (boit || fume) ? 3 : 6,
      text: boit ? "j'ai bu quatre bières. je veux arrêter, sérieusement cette fois."
          : fume ? "j'ai fumé un joint avant de dormir."
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

test('SANS CASE COCHÉE, IL DIT EXPLICITEMENT DE NE PAS OUVRIR LE SUJET', () => {
  /*
   * LA RÈGLE N'A PAS CHANGÉ POUR QUI N'A RIEN DEMANDÉ, et ce test est ce qui
   * le garantit. Le mécanisme de relance a desserré la consigne — mais
   * seulement derrière un verrou : la personne coche, chose par chose, « tu as
   * le droit de m'en parler ». Rien de coché, silence complet.
   *
   * Sans cette consigne, le compagnon pose « tu as bu combien de fois ce
   * mois-ci ? » à quelqu'un venu parler d'autre chose, et on cesse d'ouvrir un
   * outil qui contrôle — les mauvais soirs d'abord.
   */
  const b = prisesBlock(compte());
  assert.match(b, /n[’']ouvres pas le sujet/i);
  // Et surtout : aucune permission ne traîne dans le bloc.
  assert.equal(/QUAND, SUR CE QU|COMMENT\./.test(b), false,
    'le mode « tu peux demander » est écrit alors que rien n’est coché');
});

test('AVEC UNE CASE COCHÉE, LA PERMISSION EST BORNÉE À CETTE LIGNE-LÀ', () => {
  const p = compteDeux();
  assert.ok(p.prises.length >= 2, `décor à une seule famille : ${p.prises.map(x => x.cle)}`);
  const ouvert = { ...p, prises: p.prises.map((x, i) => ({ ...x, parle: i === 0 })) };
  const b = prisesBlock(ouvert);
  assert.match(b, /QUE SUR CE QU[’']IL A COCHÉ/);
  /*
   * L'ÉTAT SE LIT SUR LA LIGNE. Un modèle qui doit recouper une liste de noms
   * avec une consigne trois paragraphes plus haut se trompera un soir sur dix
   * — et le soir où il se trompe, il pose la question sur ce que la personne
   * n'a PAS ouvert.
   */
  const lignes = b.split('\n').filter(l => /— \d+ journées/.test(l));
  assert.ok(lignes.length >= 2, `une seule ligne dans le décor : ${lignes.length}`);
  assert.equal(lignes.filter(l => /ouvert le sujet/.test(l)).length, 1,
    'la mention n’est pas portée par exactement la ligne cochée');
});

test('CE QUI EST COCHÉ PASSE DEVANT — sinon il a le droit sans avoir les nombres', () => {
  /*
   * Le tri met les signes puis la pente en tête et ne garde que trois lignes :
   * une chose dont la personne a ouvert le sujet pouvait tomber quatrième.
   * Le compagnon avait alors la permission d'en parler, et pas les nombres.
   */
  const p = compteDeux();
  assert.ok(p.prises.length >= 2, `décor à une seule famille : ${p.prises.map(x => x.cle)}`);
  const dernier = p.prises.at(-1).cle;
  const b = prisesBlock({ ...p, prises: p.prises.map(x => ({ ...x, parle: x.cle === dernier })) });
  const premiere = b.split('\n').find(l => /— \d+ journées/.test(l));
  assert.match(premiere, /ouvert le sujet/, 'la ligne cochée n’est pas remontée en tête');
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
