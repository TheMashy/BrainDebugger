/**
 * =====================================================================
 *  IL AVAIT LA RÉPONSE À L'ÉCRAN, ET IL L'A DEMANDÉE QUAND MÊME.
 *
 *     — je me suis levé en retard à cause de ma montre
 *     — Tu t'es levé à quelle heure du coup ?
 *     — normalement tu peux le savoir
 *     — Ah non, t'as raison, si tu me l'as pas dit direct je l'ai pas.
 *
 * Au même instant, dans le même produit, le panneau « Ce qui a été mesuré »
 * affichait « 15:38 ». Les neuf blocs de mémoire portent le journal, la
 * grille, la carte, les prises — et rien de ce que Machi Tool mesure.
 *
 * Redemander ce qu'on mesure déjà fait passer un outil de mesure pour un
 * questionnaire, et pose la question « à quoi servent les mesures, alors ».
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posteBlock } from '../server/chat.js';

const POSTE = (o = {}) => ({ lever: { heure: '15:38', source: 'mesure' },
                             coucher: { heure: null, source: null },
                             sommeil_h: 13.1, ecran: { minutes: 211 }, ...o });

/* ================= ce qu'on n'affirme pas ================= */

test('UNE PREMIÈRE ACTIVITÉ MACHINE N’EST PAS UNE HEURE DE RÉVEIL', () => {
  /*
   * LA GARDE LA PLUS IMPORTANTE DU FICHIER, et elle vient de `jour-vecu.js`,
   * qui le dit en toutes lettres : « ce n'est pas une heure de reveil et on ne
   * la fera jamais passer pour telle ».
   *
   * Elle protège aussi le garde-fou que la personne a proposé elle-même — « si
   * c'est faux je dis que c'est faux ». Une contradiction ne vaut que si
   * l'affirmation était honnête au départ ; sinon on lui fait corriger une
   * invention, et c'est ELLE qui a l'air de se tromper.
   */
  const b = posteBlock(POSTE({ lever: { heure: '15:38', source: 'estime' } }));
  assert.match(b, /PAS une heure de réveil/);
  assert.match(b, /tu ne dis PAS qu’il s’est levé à cette heure/);
});

test('MESURÉ ET DIT NE PORTENT PAS CET AVERTISSEMENT — sinon il ne veut plus rien dire', () => {
  // La moitié discriminante : un avertissement présent partout s'ignore, et
  // c'est comme ça qu'on rate celui qui compte.
  for (const source of ['mesure', 'dit']) {
    const b = posteBlock(POSTE({ lever: { heure: '15:38', source } }));
    assert.equal(/PAS une heure de réveil/.test(b), false, `« ${source} » porte l’avertissement`);
  }
});

test('CHAQUE LIGNE DIT SA SOURCE — trois sources, trois phrases différentes', () => {
  const vus = new Set();
  for (const source of ['dit', 'mesure', 'estime']) {
    const ligne = posteBlock(POSTE({ lever: { heure: '08:00', source } }))
      .split('\n').find(l => l.startsWith('· levé'));
    assert.ok(ligne, `pas de ligne « levé » pour « ${source} »`);
    assert.equal(vus.has(ligne), false, `« ${source} » se dit comme une autre source`);
    vus.add(ligne);
  }
});

/* ================= ce qu'il doit faire ================= */

test('LA CONSIGNE EST DE LE DIRE, PAS DE LE DEMANDER', () => {
  const b = posteBlock(POSTE());
  assert.match(b, /tu ne le redemandes pas/);
  assert.match(b, /TU NE POSES PAS LA QUESTION/);
  // Et l'heure est reprise dans l'exemple : une consigne sans le chiffre
  // laisserait le modèle inventer une formulation qui redemande.
  assert.match(b, /levé à 15:38/);
});

test('LA CONTRADICTION DE LA PERSONNE L’EMPORTE, SANS DISCUSSION', () => {
  const b = posteBlock(POSTE());
  assert.match(b, /IL A RAISON/);
  assert.match(b, /sans discuter/);
  assert.match(b, /SON heure/);
});

test('ON NE COMMENTE PAS L’HEURE', () => {
  // Se lever à 15 h 38 n'appelle aucune remarque. Sans cette ligne, le fait
  // devient un sujet — et un sujet sur lequel on se sent jugé.
  assert.match(posteBlock(POSTE()), /RIEN SUR L’HEURE ELLE-MÊME/);
});

/* ================= les creux ================= */

test('SANS RIEN DE MESURÉ, PAS DE BLOC DU TOUT', () => {
  /*
   * Un bloc vide dirait au compagnon « voici ce qui a été mesuré : rien », et
   * il en tirerait que rien n'a été mesuré — alors que le pont peut
   * simplement être coupé ce jour-là. Un trou, pas un zéro.
   */
  assert.equal(posteBlock(null), null);
  assert.equal(posteBlock({ lever: {}, coucher: {} }), null);
  assert.equal(posteBlock({ lever: { heure: null }, coucher: { heure: null },
                            sommeil_h: null, ecran: null }), null);
});

test('CE QUI MANQUE NE SE DIT PAS — seules les lignes connues sont écrites', () => {
  /*
   * ON NE LIT QUE LES PUCES, PAS TOUT LE BLOC. La consigne contient « tu as
   * bien dormi au moins » comme exemple de ce qu'il ne faut PAS dire : chercher
   * « dormi » dans le bloc entier rendait vrai un test censé vérifier qu'aucune
   * durée n'est affichée. C'est le même piège qu'ailleurs dans cette suite —
   * un mot du décor qui répond à la place de la donnée.
   */
  const puces = posteBlock({ lever: { heure: '09:12', source: 'dit' }, coucher: { heure: null },
                             sommeil_h: null, ecran: null })
    .split('\n').filter(l => l.startsWith('· '));
  assert.deepEqual(puces.length, 1, `${puces.length} puces : ${puces.join(' | ')}`);
  assert.match(puces[0], /levé 09:12/);
});

test('la durée s’écrit à la française, comme partout ailleurs', () => {
  assert.match(posteBlock(POSTE()), /dormi 13,1 h/);
});

/* ================= le branchement ================= */

test('LE BLOC PART DU CÔTÉ VOLATIL, PAS DU CÔTÉ MIS EN CACHE', async () => {
  /*
   * Les minutes d'écran grandissent toute la journée et le coucher n'apparaît
   * qu'en fin de soirée. Posé du côté stable, ce bloc invaliderait le préfixe
   * en cache à CHAQUE message — c'est-à-dire qu'il ferait relire tout le
   * prompt plein tarif pour afficher un compteur qui bouge.
   */
  const src = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  const i = src.indexOf('posteBlock(posteDuJour(');
  assert.ok(i > 0, 'le pont n’est plus branché');
  // `volatil.push`, pas `poser(` : les deux existent dans cette fonction, et
  // se tromper de côté ne casse rien de visible.
  const autour = src.slice(i - 400, i + 200);
  assert.match(autour, /volatil\.push\(bloc\)/, 'le bloc est posé du côté stable');
});

test('LE JOUR VÉCU, PAS LA DATE CIVILE', () => {
  /*
   * Quelqu'un qui écrit à 3 h du matin finit la journée ouverte la veille à
   * 15 h. `today()` lui rendrait le poste d'une journée qui n'a pas encore
   * commencé pour lui : un lever vide, un instant après lui avoir dit à quelle
   * heure il s'est levé.
   */
  const src = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  const i = src.indexOf('posteBlock(posteDuJour(');
  assert.match(src.slice(i, i + 80), /posteDuJour\(jourVecu\(userId\), userId\)/);
});

test('UN PONT QUI TOMBE N’EMPORTE PAS LA CONVERSATION', () => {
  // `posteDuJour` lit des digests, des nuits, des mesures. Une donnée mal
  // formée ne doit pas faire échouer le message — la conversation vaut plus
  // que la ligne « levé à ».
  const src = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  const i = src.indexOf('posteBlock(posteDuJour(');
  assert.match(src.slice(i - 200, i + 300), /try \{[\s\S]*?\} catch/);
});
