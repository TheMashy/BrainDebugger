/*
 * LA PROMOTION, DE BOUT EN BOUT.
 *
 * Le moteur est pur ; ces tests vérifient ce qui l'entoure : que la route
 * refuse de monter ce qui ne remplit pas les conditions même si un client le
 * demande, que le nœud apparaît sur la carte RENDUE sans jamais toucher la
 * lecture STOCKÉE, et que le retour en arrière le fait disparaître.
 *
 * Ce dernier point est le cœur de l'affaire : si la promotion écrivait dans la
 * lecture, une relecture l'effacerait et une promotion salirait ce que le
 * modèle a écrit. Les deux objets doivent garder leur nature — c'est la seule
 * raison pour laquelle cette fonctionnalité n'est pas « tous les motifs
 * deviennent des nœuds » avec des étapes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-promo-')), 'test.db');

const { upsertUser, addMessage, addMotif, marquerMotif, setLecture, getLecture } =
  await import('../server/db.js');
const { routes, etatDesMotifs } = await import('../server/api.js');

const U = 'promo';
upsertUser({ id: U, username: U });

const jour = n => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
// Un journal quotidien : chaque journée écrite a un lendemain écrit.
for (let i = 0; i < 180; i++) {
  addMessage({ ts: `${jour(i)}T20:00:00.000Z`, date: jour(i), role: 'user', text: 'écrit', userId: U });
}
// Douze journées isolées, en quatre retours.
const PORTE = [0, 10, 20, 40, 50, 60, 80, 90, 100, 120, 130, 140].map(jour);
const APRES = [1, 11, 21, 41, 51, 61, 81, 91, 101, 121, 131, 141].map(jour);

const m = addMotif({ nom: 'bon bref c’était rien', mecanisme: 'minimiser après coup', userId: U });
const petit = addMotif({ nom: 'le silence du dimanche', mecanisme: 'ne rien dire', userId: U });
for (const d of PORTE) {
  const id = addMessage({ ts: `${d}T21:00:00.000Z`, date: d, role: 'user', text: 'bon bref', userId: U });
  marquerMotif(m.id, id, U);
}
for (const d of PORTE.slice(0, 3)) {
  const id = addMessage({ ts: `${d}T22:00:00.000Z`, date: d, role: 'user', text: 'rien dit', userId: U });
  marquerMotif(petit.id, id, U);
}

const CARTE = {
  noeuds: [{ nom: 'le vin le soir', quoi: 'le verre du soir', genre: 'activite', poids: 2, jours: APRES },
           { nom: 'le sport', quoi: 'courir', genre: 'activite', poids: 1, jours: [5, 55, 105].map(jour) }],
  liens: [{ de: 'le vin le soir', vers: 'le sport', quoi: 'remplace', force: 1 }],
};
setLecture({ contenu: { synthese: 'x', themes: [], carte: CARTE }, jusqu_au: jour(179),
             jours: 180, modele: 'test', userId: U });

test('un motif qui tient est proposable ; un motif rare ne l’est pas', () => {
  const r = routes['GET /api/promotion']({ userId: U });
  const par = Object.fromEntries(r.motifs.map(x => [x.nom, x]));
  assert.equal(par['bon bref c’était rien'].etat, 'proposable');
  /*
   * TROIS JOURNÉES SUFFISENT À S'ANCRER, PAS À MONTER — et c'est exactement la
   * distinction qu'on cherchait. L'ancrage suit la règle de la carte (trois
   * fois, sous 5 %) parce qu'un ancrage plus exigeant que les liens que la
   * carte pose déjà serait deux poids deux mesures. La montée, elle, demande
   * en plus dix journées réparties en trois retours.
   */
  assert.equal(par['le silence du dimanche'].etat, 'ancre');
  assert.equal(par['le silence du dimanche'].ancrages.length, 1);
  assert.deepEqual(par['le silence du dimanche'].manque.map(x => x.quoi), ['journees', 'reprises'],
    'ce qui manque part avec l’état : un seuil qu’on ne peut pas voir ne peut pas être contesté');
});

test('la route refuse de monter ce qui ne remplit pas les conditions', () => {
  const r = routes['POST /api/promotion']({ body: { id: petit.id, oui: true }, userId: U });
  assert.ok(r.error, 'un client qui demande quand même ne doit pas y arriver');
  assert.ok(r.manque?.length);
});

test('accepter pose le nœud sur la carte RENDUE, pas dans la lecture stockée', async () => {
  routes['POST /api/promotion']({ body: { id: m.id, oui: true }, userId: U });

  const stockee = getLecture(U).contenu.carte;
  assert.equal(stockee.noeuds.length, 2,
    'la lecture en base reste exactement ce que le modèle a écrit');
  assert.ok(!stockee.noeuds.some(n => n.promu));

  const rendue = (await routes['GET /api/lecture']({ userId: U })).lecture.carte;
  const n = rendue.noeuds.find(x => x.promu);
  assert.ok(n, 'le nœud promu apparaît au rendu');
  assert.equal(n.nom, 'bon bref c’était rien');
  assert.equal(n.genre, 'mecanisme');
  const l = rendue.liens.find(x => x.compte);
  assert.equal(l.de, 'bon bref c’était rien');
  assert.equal(l.vers, 'le vin le soir');
  assert.ok(l.appui, 'la flèche promue est recomptée comme celles du modèle, pas traitée à part');
});

test('revenir en arrière le fait disparaître de la carte, sans le supprimer', async () => {
  routes['POST /api/promotion']({ body: { id: m.id, oui: null }, userId: U });
  const rendue = (await routes['GET /api/lecture']({ userId: U })).lecture.carte;
  assert.ok(!rendue.noeuds.some(x => x.promu));
  const e = etatDesMotifs(U).find(x => x.id === m.id);
  assert.equal(e.etat, 'proposable', 'il retourne d’où il vient, et sera reproposé');
});

test('écarter le retire des propositions sans l’effacer de la liste', () => {
  routes['POST /api/promotion']({ body: { id: m.id, oui: false }, userId: U });
  const r = routes['GET /api/promotion']({ userId: U });
  const e = r.motifs.find(x => x.id === m.id);
  assert.equal(e.etat, 'ecarte');
  assert.equal(r.motifs.filter(x => x.etat === 'proposable').length, 0,
    'on ne repose pas la question à chaque ouverture');
});

test('la route dit combien de nœuds porte la carte — sans carte, rien ne peut s’ancrer', () => {
  const r = routes['GET /api/promotion']({ userId: U });
  assert.equal(r.carte, 2);
  assert.equal(r.seuils.min_journees, 10);
});
