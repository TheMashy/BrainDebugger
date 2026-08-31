/**
 * LE COMPAGNON CORRIGE, ET N'EFFACE PAS.
 *
 * « En fait c'était le 3 mai, pas le 3 mars. » Sans chemin de correction, la
 * seule réponse était de poser un DEUXIÈME repère — et la frise finissait avec
 * les deux, alors que c'est elle qui date tout le reste.
 *
 * La limite est délibérée : déplacer une date et réécrire un libellé, oui ;
 * faire disparaître un fait de la vie de quelqu'un sur le jugement d'un modèle,
 * non. La personne a un bouton pour ça dans « Année ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-corr-')), 'test.db');

const { OWNER, allEvents, allMotifs, addMessage, updateEvent } = await import('../server/db.js');
const { outilsPour } = await import('../server/api.js');
const { OUTILS } = await import('../server/chat.js');
const { themeDe } = await import('../web/reperes.js');

const gestes = [];
const O = outilsPour(OWNER, 1, (t, f) => gestes.push([t, f]));
const hier = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const demain = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); };

/* ============ LES REPÈRES ============ */

test('une date rectifiée déplace le repère, elle n’en crée pas un deuxième', () => {
  O.poser_repere({ date: '2026-03-03', label: 'rupture avec Léa' });
  const ev = allEvents(OWNER).at(-1);
  const r = O.corriger_repere({ id: ev.id, date: '2026-05-03' });
  assert.equal(r.erreur, undefined, r.erreur);
  assert.match(r.message, /2026-03-03.*2026-05-03/);
  const apres = allEvents(OWNER).filter(e => e.label === 'rupture avec Léa');
  assert.equal(apres.length, 1, 'un deuxième repère a été créé au lieu de corriger le premier');
  assert.equal(apres[0].date, '2026-05-03');
});

test('un libellé rectifié refait suivre l’icône, sans rien stocker', () => {
  /*
   * Un repère posé sans thème n'en stocke aucun : il est DÉDUIT du libellé à
   * l'affichage, partout. Corriger le libellé suffit donc à corriger l'icône —
   * « rupture » devient « déménagement » et le cœur brisé s'en va tout seul.
   * Écrire un thème ici le figerait, et le prochain changement de libellé
   * laisserait l'icône du mot d'avant.
   */
  const ev = allEvents(OWNER).find(e => e.label === 'rupture avec Léa');
  assert.equal(ev.theme, null, 'un repère posé par le compagnon ne fige pas son thème');
  O.corriger_repere({ id: ev.id, label: 'déménagement à Lyon' });
  const apres = allEvents(OWNER).find(e => e.id === ev.id);
  assert.equal(apres.label, 'déménagement à Lyon');
  assert.equal(apres.theme, null, 'la correction a figé un thème');
  assert.equal(themeDe(apres.label), 'maison', `déduit : « ${themeDe(apres.label)} »`);
});

test('UNE ICÔNE CHOISIE À LA MAIN N’EST PAS ÉCRASÉE PAR UNE DÉDUCTION', () => {
  /*
   * Une teinte posée dans « Année » est une DÉCLARATION ; le thème déduit du
   * libellé est une DÉDUCTION. La règle du produit dit laquelle gagne, et elle
   * vaut aussi quand la déduction vient du compagnon.
   */
  O.poser_repere({ date: '2026-02-10', label: 'rupture avec Camille' });
  const ev = allEvents(OWNER).find(e => e.label === 'rupture avec Camille');
  assert.equal(themeDe(ev.label), 'rupture');

  // Le choix à la main : une teinte déclarée, et un thème choisi avec elle.
  updateEvent(ev.id, { teinte: 258, theme: 'famille' }, OWNER);
  O.corriger_repere({ id: ev.id, label: 'pause avec Camille' });

  const apres = allEvents(OWNER).find(e => e.id === ev.id);
  assert.equal(apres.label, 'pause avec Camille', 'le libellé n’a pas été corrigé');
  assert.equal(apres.theme, 'famille', 'la déduction a écrasé un choix fait à la main');
  assert.equal(apres.teinte, 258);
});

test('les mêmes verrous qu’à la pose, aux mêmes valeurs', () => {
  const ev = allEvents(OWNER).at(-1);
  // Une correction qui accepterait ce que la pose refuse ouvrirait par la porte
  // de derrière ce qui est fermé par la grande.
  assert.match(O.corriger_repere({ id: ev.id, date: '3 mai' }).erreur, /AAAA-MM-JJ/);
  assert.match(O.corriger_repere({ id: ev.id, date: demain() }).erreur, /futur/);
  assert.match(O.corriger_repere({ id: ev.id, label: 'ok' }).erreur, /court/);
  assert.match(O.corriger_repere({ id: ev.id, label: 'x'.repeat(80) }).erreur, /long/);
  assert.match(O.corriger_repere({ id: ev.id }).erreur, /Rien à corriger/);
  assert.match(O.corriger_repere({ id: 99999, date: hier() }).erreur, /Aucun repère/);
  assert.match(O.corriger_repere({ date: hier() }).erreur, /Identifiant/);
});

test('IL NE PEUT PAS EFFACER UN REPÈRE', () => {
  /*
   * La limite du produit, pas une omission. Faire disparaître un fait de la vie
   * de quelqu'un sur le jugement d'un modèle n'est pas la même chose que
   * corriger une faute de frappe.
   */
  const noms = Object.keys(OUTILS);
  assert.equal(noms.some(n => /supprim|effac|retir/i.test(n)), false,
               'un outil de suppression est apparu dans la boîte');
  // Et la description le dit, pour qu'il ne cherche pas : un modèle qui ne
  // trouve pas l'outil essaie de contourner.
  assert.match(OUTILS.corriger_repere.description, /effacer/i);
});

test('la correction se voit à l’écran, avec ce qu’il y avait avant', () => {
  gestes.length = 0;
  const ev = allEvents(OWNER).at(-1);
  O.corriger_repere({ id: ev.id, label: 'arrivée à Lyon' });
  const [type, fait] = gestes.at(-1);
  assert.equal(type, 'geste');
  assert.equal(fait.corrige, true);
  assert.ok(fait.avant?.label, 'sans l’état d’avant, la correction est indistinguable d’une pose');
});

/* ============ LES MOTIFS ============ */

test('renommer un motif garde ses occurrences — c’est tout l’intérêt', () => {
  addMessage({ ts: new Date().toISOString(), date: '2026-05-01', source: 'web',
               role: 'user', text: 'un message', userId: OWNER });
  O.suivre_motif({ nom: 'humour de défense', mecanisme: 'il blague sur sa propre vie quand ça va mal' });
  const m = allMotifs(OWNER).at(-1);
  const vues = m.vues, teinte = m.teinte;

  const r = O.renommer_motif({ id: m.id, nom: 'minimisation' });
  assert.equal(r.erreur, undefined, r.erreur);
  const apres = allMotifs(OWNER).find(x => x.id === m.id);
  assert.equal(apres.nom, 'minimisation');
  assert.equal(apres.vues, vues, 'les occurrences ont été perdues');
  // La teinte non plus ne bouge pas : un motif qui changerait de couleur en
  // changeant de nom se lirait comme un motif neuf partout où sa pastille est.
  assert.equal(apres.teinte, teinte);
  assert.equal(apres.id, m.id);
});

test('deux motifs ne peuvent pas porter le même nom', () => {
  // C'est le nom qui les distingue partout ailleurs : le doublon en rendrait un
  // des deux inatteignable.
  O.suivre_motif({ nom: 'évitement du soir', mecanisme: 'il repousse tout ce qui demande de sortir' });
  const a = allMotifs(OWNER).find(x => x.nom === 'minimisation');
  const b = allMotifs(OWNER).find(x => x.nom === 'évitement du soir');
  assert.match(O.renommer_motif({ id: b.id, nom: 'minimisation' }).erreur, /déjà pris/);
  assert.equal(allMotifs(OWNER).find(x => x.id === b.id).nom, 'évitement du soir');
});

test('la description seule peut être réécrite', () => {
  const m = allMotifs(OWNER).find(x => x.nom === 'minimisation');
  const r = O.renommer_motif({ id: m.id, mecanisme: 'il raconte une journée dure comme une journée ordinaire' });
  assert.equal(r.erreur, undefined, r.erreur);
  assert.match(allMotifs(OWNER).find(x => x.id === m.id).mecanisme, /journée ordinaire/);
  assert.equal(allMotifs(OWNER).find(x => x.id === m.id).nom, 'minimisation', 'le nom a bougé tout seul');
});

test('les verrous du renommage', () => {
  const m = allMotifs(OWNER).find(x => x.nom === 'minimisation');
  assert.match(O.renommer_motif({ id: m.id }).erreur, /Rien à changer/);
  assert.match(O.renommer_motif({ id: m.id, nom: 'ab' }).erreur, /deux à quatre mots/);
  assert.match(O.renommer_motif({ id: m.id, mecanisme: 'court' }).erreur, /une phrase/);
  assert.match(O.renommer_motif({ id: 99999, nom: 'quelque chose' }).erreur, /Aucun motif/);
  assert.match(O.renommer_motif({ nom: 'quelque chose' }).erreur, /Identifiant/);
});
