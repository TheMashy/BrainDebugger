/*
 * LE SOMMEIL : UN SEUL JUGE, ET IL PASSE DEVANT.
 *
 * Deux choses réparées ici, sur une journée réelle — le 18 septembre.
 *
 * 1. DEUX JUGES, DEUX RÉPONSES. La liste de l'onglet Année appliquait les
 *    bornes écrites (« jme suis couché a minuit trente ») et en tirait une
 *    durée ; la vue d'une journée appelait `nuitDuJour` toute nue et ne les
 *    voyait jamais. Le même code, en double, dont un chemin ignorait le
 *    témoignage de la personne.
 *
 * 2. LE CHIFFRE ÉTAIT UNE PASTILLE PARMI LES AUTRES, de la taille du lever.
 *    C'est pourtant la mesure qu'on vient chercher.
 *
 * ET IL NE SE QUALIFIE PAS. Le repère est SA médiane, jamais une
 * recommandation : une étiquette posée par un écran sur le sommeil de
 * quelqu'un est exactement ce que ce produit refuse de faire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-somd-')), 'test.db');

const { upsertUser, addMessage, poserMesure, poserActiviteJour } = await import('../server/db.js');
const api = await import('../server/api.js');
const { sommeilHabituel, oublierRythme } = await import('../server/nuits.js');

const U = 'le18';
upsertUser({ id: U, username: U });

test('LA PHRASE DU 18 DONNE SA DURÉE À LA VUE DU JOUR', () => {
  addMessage({ ts: '2026-09-18T07:58:00', date: '2026-09-18', role: 'user',
    text: "jme suis levé tôt aujourd'hui 6/10 jme suis couché a minuit trente", userId: U });
  poserMesure({ date: '2026-09-18', source: 'dit', cle: 'lever_dit', texte: '07:50', userId: U });
  api.relireLesBornesDites(U);
  const p = api.posteDuJour('2026-09-18', U);
  assert.equal(p.sommeil_h, 7.3,
    'la vue du jour doit voir ce que la personne a écrit, comme la liste des nuits');
});

const V = 'habitudes';
upsertUser({ id: V, username: V });
const jour = n => new Date(Date.parse('2026-09-21') - n * 86400000).toISOString().slice(0, 10);
const nuitDe = (d, leve, couche) => {
  poserActiviteJour(V, d, { date: d, plage: { de: leve, a: '23:59' }, trous: [],
                            temps_par_contexte_s: { code: 3600 } });
  poserMesure({ date: d, source: 'dit', cle: 'lever_dit', texte: leve, userId: V });
  poserMesure({ date: d, source: 'dit', cle: 'coucher_dit', texte: couche, userId: V });
};

test('SOUS SEPT NUITS, ON NE PRÉTEND PAS CONNAÎTRE UNE HABITUDE', () => {
  for (let n = 5; n >= 1; n--) nuitDe(jour(n), '08:00', '23:00');
  oublierRythme(V);
  assert.equal(sommeilHabituel(V), null,
    'cinq nuits ne font pas une habitude, et un repère fondé dessus se lirait comme un fait');
});

test('LA MÉDIANE, ET PAS LA MOYENNE', () => {
  /*
   * Une nuit de quinze heures après une semaine blanche tirerait la moyenne,
   * et le repère bougerait pour une exception.
   */
  for (let n = 20; n >= 1; n--) nuitDe(jour(n), '08:00', '23:00');   // 9 h
  nuitDe(jour(30), '18:00', '23:00');                                // 19 h : hors bornes, écartée
  nuitDe(jour(31), '15:00', '02:00');                                // 13 h
  oublierRythme(V);
  const h = sommeilHabituel(V);
  assert.ok(h && h.nuits >= 7);
  assert.equal(h.mediane, 9, 'une longue nuit isolée ne doit pas déplacer le repère');
});

test('LE CÔTÉ SE DIT PAR RAPPORT À SA SÉRIE', () => {
  nuitDe('2026-09-21', '11:00', '23:00');   // 12 h, bien au-dessus de 9
  oublierRythme(V);
  const p = api.posteDuJour('2026-09-21', V);
  assert.equal(p.sommeil_h, 12);
  assert.equal(p.sommeil_mediane, 9);
  assert.equal(p.sommeil_cote, 'haut');
});

/* ------------------------- et à l'écran ------------------------- */

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

test('LE CHIFFRE PASSE DEVANT', () => {
  assert.match(app, /class="jpdgros"/);
  const regle = css.slice(css.indexOf('.jpdgros b {'), css.indexOf('.jpdgros b {') + 160);
  const px = /font-size:\s*(\d+)px/.exec(regle);
  assert.ok(px && Number(px[1]) >= 20,
    `le chiffre du sommeil fait ${px?.[1]}px : ce n’est plus « devant »`);
});

test('AUCUNE NORME DE SOMMEIL N’EST ÉCRITE NULLE PART', () => {
  /*
   * LA GARDE LA PLUS IMPORTANTE DE CE FICHIER. Le repère est SA médiane.
   * « 8 h recommandées », « tu ne dors pas assez », « sommeil insuffisant »
   * n'ont rien à faire dans le journal de quelqu'un — et la tentation est
   * grande, justement quand la personne dit qu'elle dort beaucoup.
   */
  const nuits = readFileSync(new URL('../server/nuits.js', import.meta.url), 'utf8');
  for (const source of [app, nuits]) {
    assert.equal(/recommand[ée]|devrais dormir|pas assez de sommeil|trop dormi|sommeil insuffisant/i.test(source),
      false, 'une norme de sommeil s’est glissée dans le code');
  }
  /*
   * ET SUR LE BLOC DU SOMMEIL, PAS SUR LE FICHIER. « ta médiane » apparaît
   * ailleurs dans la page ; cherchée partout, l'assertion passait au vert même
   * quand ce bloc-ci disait « la normale ». Un mutant l'a dit.
   */
  const bloc = app.slice(app.indexOf('const ecartSommeil ='), app.indexOf('const dormi = aDormi'));
  assert.match(bloc, /ta médiane/, 'le repère doit être nommé comme étant le sien');
  assert.equal(/normale|recommand/i.test(bloc), false);
});
