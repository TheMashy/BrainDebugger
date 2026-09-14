/**
 * =====================================================================
 *  CE FICHIER TIENT SURTOUT LES CAS OÙ LE COMPAGNON DOIT SE TAIRE.
 *
 * La règle était « tu n'ouvres PAS le sujet », et son argument tient : une
 * conversation qui contrôle cesse d'être ouverte les mauvais soirs,
 * c'est-à-dire ceux qui comptent. Ce qui l'a desserrée, c'est un verrou — la
 * personne coche, chose par chose, « tu as le droit de m'en parler ».
 *
 * Un frein manqué ici ne coûte pas une occasion : il coûte la confiance de
 * quelqu'un qui écrit ce qu'il consomme dans un carnet. Les tests de silence
 * sont donc les premiers, et ils sont les plus nombreux.
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { occasionDeDemanderConso, FREINS_CONSO } from '../server/demander-conso.js';
import { familleDuSuivi, FAMILLES } from '../server/prises.js';

const SOIR = '2026-03-10T21:30:00.000Z';
const q = (n, min = 0) => new Date(Date.parse(SOIR) - (n * 60 - min) * 60000).toISOString();
const lui = (text, ts) => ({ role: 'user', text, ts });
const elle = (text, ts) => ({ role: 'pet', text, ts });

/* Un fil ordinaire du soir : trois prises de parole, la dernière à 21:30. */
const FIL = (dernier) => [
  lui('salut, journée longue', q(2)),
  elle('raconte', q(2, 1)),
  lui('j’ai fini tard et je suis rentré crevé', q(1)),
  elle('ça a donné quoi ?', q(1, 1)),
  lui(dernier, SOIR),
];
const CANNABIS = FAMILLES.find(f => f.cle === 'cannabis');
const prise = (o = {}) => ({ cle: 'cannabis', nom: 'le cannabis', n: 8, parle: true,
                             genre: 'reduire', avant_ca: [], ...o });
const juger = (o = {}) => occasionDeDemanderConso({
  fil: FIL('j’ai craqué ce soir, je sais pas trop quoi en penser'),
  prises: [prise()], familles: [CANNABIS], veille: null,
  maintenant: Date.parse(SOIR), zone: 'UTC', ...o });

/* ================= LE VERROU ================= */

test('SANS LA CASE COCHÉE, LE SILENCE — c’est tout le dispositif', () => {
  const r = juger({ prises: [prise({ parle: false })] });
  assert.equal(r.demander, false, 'le compagnon ouvre le sujet sans y avoir été autorisé');
  assert.match(r.pourquoi, /aucun sujet/);
});

test('avec la case cochée et un doute, il peut demander', () => {
  // La moitié discriminante : sans elle, tous les tests de silence passeraient
  // avec un mécanisme qui ne dit jamais oui.
  const r = juger();
  assert.equal(r.demander, true, `il se tait même quand tout est réuni : ${r.pourquoi}`);
  assert.equal(r.cle, 'cannabis');
});

/* ================= LA VEILLE ================= */

test('LA VEILLE EN ROUGE ÉTEINT TOUT, POUR LA JOURNÉE', () => {
  /*
   * Le soir où quelqu'un écrit qu'il s'est fait du mal, « tu en as pris
   * combien ? » est le moment exact où un compagnon devient un surveillant.
   * Et ça se lit sur la JOURNÉE : un rouge écrit à 20 h doit encore faire
   * taire à 23 h.
   */
  assert.equal(juger({ veille: 'rouge' }).demander, false);
});

test('LE JAUNE AUSSI — « le suicide a été évoqué » n’est pas le moment de compter des verres', () => {
  assert.equal(juger({ veille: 'jaune' }).demander, false);
});

/* ================= LES FREINS ================= */

test('ON NE DEMANDE PAS À QUELQU’UN QUI VIENT DE DIRE BONSOIR', () => {
  // Ouvrir un fil par « pas trop de cannabis aujourd'hui ? » fait de la
  // première phrase du compagnon un contrôle.
  const r = juger({ fil: [lui('j’ai craqué ce soir, je sais pas trop quoi en penser', SOIR)] });
  assert.equal(r.demander, false);
  assert.match(r.pourquoi, /commence à peine/);
});

test('CE N’EST PAS L’HEURE : LA SOIRÉE N’A PAS EU LIEU', () => {
  const matin = '2026-03-10T09:00:00.000Z';
  const fil = FIL('j’ai craqué ce matin, je sais pas trop quoi en penser')
    .map(m => ({ ...m, ts: matin }));
  const r = occasionDeDemanderConso({ fil, prises: [prise()], familles: [CANNABIS],
    maintenant: Date.parse(matin), zone: 'UTC' });
  assert.equal(r.demander, false);
  assert.match(r.pourquoi, /l’heure/);
});

test('IL VIENT D’EN PARLER LUI-MÊME : PLUS DE DOUTE, DONC PLUS DE QUESTION', () => {
  /*
   * S'il a écrit « j'ai fumé deux joints » à 21 h, demander à 23 h n'est plus
   * une question, c'est un recoupement — et se faire recouper est ce qui fait
   * qu'on cesse d'écrire la vérité.
   */
  const fil = [
    lui('salut', q(3)), elle('hello', q(3, 1)),
    lui('j’ai fumé deux joints tout à l’heure en rentrant', q(2)),
    elle('ok', q(2, 1)),
    lui('j’ai craqué ce soir, je sais pas trop quoi en penser', SOIR),
  ];
  const r = juger({ fil });
  assert.equal(r.demander, false, 'il redemande ce qui vient d’être dit');
});

test('PAS DEUX FOIS LE MÊME JOUR', () => {
  const fil = [...FIL('j’ai craqué ce soir, je sais pas trop quoi en penser')];
  fil.splice(2, 0, elle('pas trop de cannabis aujourd’hui ?', q(2, 30)));
  assert.equal(juger({ fil }).demander, false);
});

test('PAS DEUX FOIS LA MÊME CHOSE DANS LA SEMAINE', () => {
  // Le frein qui distingue quelqu'un qui remarque d'une check-list du soir.
  const ilya3j = new Date(Date.parse(SOIR) - 3 * 864e5).toISOString();
  const fil = [elle('tu en as pris combien de cannabis ce soir ?', ilya3j),
               ...FIL('j’ai craqué ce soir, je sais pas trop quoi en penser')];
  assert.equal(juger({ fil }).demander, false);
  // Huit jours plus tard, le frein est levé : sinon on n'aurait rien freiné,
  // on aurait tout éteint.
  const ilya8j = new Date(Date.parse(SOIR) - 8 * 864e5).toISOString();
  const vieux = [elle('tu en as pris combien de cannabis ce soir ?', ilya8j),
                 ...FIL('j’ai craqué ce soir, je sais pas trop quoi en penser')];
  assert.equal(juger({ fil: vieux }).demander, true);
});

test('SOUS LE SEUIL DE TROIS JOURNÉES, RIEN N’EXISTE ENCORE', () => {
  // « ce n'est pas une prise, c'est une soirée » — poser la question
  // fabriquerait le problème qu'elle prétend décrire.
  assert.equal(juger({ prises: [prise({ n: 2 })] }).demander, false);
});

/* ================= LE DOUTE ================= */

test('UN SIGNE SANS NOM EST UN DOUTE — c’est la forme exacte', () => {
  const r = juger();
  assert.equal(r.demander, true);
  assert.match(r.pourquoi, /sans dire laquelle/);
});

test('DEUX CHOSES OUVERTES ET UN SIGNE SANS NOM : ON SE TAIT', () => {
  // On ne sait pas quoi demander, et deviner reviendrait à suggérer une
  // réponse — c'est-à-dire à mettre un mot dans sa bouche.
  const alcool = FAMILLES.find(f => f.cle === 'alcool');
  const r = juger({ prises: [prise(), prise({ cle: 'alcool', nom: 'l’alcool' })],
                    familles: [CANNABIS, alcool] });
  assert.equal(r.demander, false);
});

test('UNE SOIRÉE ORDINAIRE NE DÉCLENCHE RIEN', () => {
  /*
   * LA GARDE LA PLUS IMPORTANTE DU FICHIER. Sans elle, le mécanisme
   * demanderait chaque soir — c'est-à-dire exactement le questionnaire que la
   * règle d'origine refusait.
   */
  const r = juger({ fil: FIL('soirée tranquille, j’ai regardé un film et je vais me coucher') });
  assert.equal(r.demander, false, 'il demande un soir où rien ne s’est passé');
  assert.match(r.pourquoi, /curiosité/);
});

test('CE QUI VIENT D’HABITUDE JUSTE AVANT, ÉCRIT NOIR SUR BLANC', () => {
  const avec = prise({ avant_ca: [{ nom: 'la solitude', apres: 9, sur: 11 }] });
  const r = juger({ fil: FIL('encore une soirée de solitude, personne à qui parler'),
                    prises: [avec] });
  assert.equal(r.demander, true, 'le déclencheur daté est là et il ne demande pas');
  assert.match(r.pourquoi, /juste avant/);
});

test('ET CE QUE CE SIGNAL RATE, ÉCRIT NOIR SUR BLANC AUSSI', () => {
  /*
   * IL EXIGE LES MOTS DU NŒUD, PAS LE SENS. « je me sens vraiment seul » ne
   * contient pas « solitude », et le signal reste muet. C'est assumé : le seul
   * moyen de faire autrement serait une lecture sémantique inventée ici, dans
   * un produit où elle déciderait quand interroger quelqu'un sur sa
   * consommation. On préfère rater — c'est la même règle que `proposer-note.js`
   * applique à `readMood`, pour la même raison.
   *
   * Ce test existe pour que la limite soit un CHOIX visible et pas un bug
   * découvert plus tard : s'il se met à passer, quelqu'un a élargi le signal,
   * et il faut que ce soit délibéré.
   */
  const avec = prise({ avant_ca: [{ nom: 'la solitude', apres: 9, sur: 11 }] });
  const r = juger({ fil: FIL('encore une soirée où je me sens vraiment seul, personne à qui parler'),
                    prises: [avec] });
  assert.equal(r.demander, false, 'le signal s’est élargi au sens : était-ce voulu ?');
});

/* ================= le traitement ================= */

test('UN TRAITEMENT PEUT ÊTRE DEMANDÉ — c’est l’exemple même du besoin', () => {
  // « combien d'anxio tu as pris ce soir ? » : le genre ne ferme pas la porte,
  // il ferme une FORME (le bloc du prompt impose le compte, jamais « pas trop »).
  const f = familleDuSuivi({ cle: 'sien:anxio', nom: 'mon anxio', mots: 'anxio', genre: 'traitement' });
  const r = juger({ prises: [prise({ cle: 'sien:anxio', nom: 'mon anxio', genre: 'traitement' })],
                    familles: [f] });
  assert.equal(r.demander, true);
  assert.equal(r.genre, 'traitement', 'le genre ne remonte pas : le bloc ne saura pas quelle forme imposer');
});
