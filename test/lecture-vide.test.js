/*
 * UNE LECTURE QUI NE DIT RIEN N'EN REMPLACE PAS UNE QUI DIT QUELQUE CHOSE.
 *
 * L'écran de tissage est allé jusqu'à 100 %, puis a affiché « 0 choses, 0
 * liens » au-dessus d'un bouton « voir ma carte » qui ouvrait le vide. Rien
 * n'avait planté : le modèle avait rendu un appel d'outil sans carte, et
 * `setLecture` l'avait écrit par-dessus des mois de travail — aux trois
 * endroits qui appellent, sans condition.
 *
 * Le coût des deux erreurs n'est pas comparable. Garder une carte d'hier
 * quelques minutes de trop ne coûte rien : on relance. Perdre celle qui
 * existait, sans avoir été prévenu, coûte tout ce qu'elle contenait — c'est la
 * seule chose du produit qui ne se recalcule pas depuis le journal, elle a été
 * payée, et sa continuité (les nœuds « repris », les renommages) meurt avec.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-lecture-vide-')), 'test.db');

const { upsertUser, setLecture, getLecture, lectureVide } = await import('../server/db.js');

const PLEINE = {
  synthese: 'ce que tu répètes',
  themes: [{ nom: 'les nuits courtes', quoi: '…', preuves: [{ date: '2026-01-02', extrait: 'x' }] }],
  carte: { noeuds: [{ nom: 'léa', genre: 'personne', jours: ['2026-01-02'] },
                    { nom: 'les nuits courtes', genre: 'corps', jours: ['2026-01-03'] }],
           liens: [{ de: 'léa', vers: 'les nuits courtes' }] },
  schemas: [],
};
const pose = (U, contenu) => setLecture({ contenu, jusqu_au: '2026-01-03', jours: 30, modele: 'm', userId: U });

test('ce qui compte comme vide', () => {
  assert.equal(lectureVide(null), true);
  assert.equal(lectureVide({}), true);
  assert.equal(lectureVide({ synthese: 'une phrase', carte: { noeuds: [] } }), true,
               'une synthèse sans rien à montrer ne fait pas une lecture');
  assert.equal(lectureVide(PLEINE), false);
  assert.equal(lectureVide({ themes: [{ nom: 'x' }] }), false, 'des thèmes sans carte restent une lecture');
  assert.equal(lectureVide({ schemas: [{ nom: 'x' }] }), false);
});

test('une carte pleine ne se fait pas écraser par une lecture vide', () => {
  const U = 'garde';
  upsertUser({ id: U, username: U });
  pose(U, PLEINE);
  assert.equal(getLecture(U).contenu.carte.noeuds.length, 2);

  const r = pose(U, { synthese: 'rien à dire', themes: [], carte: { noeuds: [], liens: [] }, schemas: [] });
  assert.equal(r.refusee, true, 'le refus doit remonter, sinon l’écran affiche un zéro sans rien expliquer');
  assert.equal(getLecture(U).contenu.carte.noeuds.length, 2, 'la carte a été perdue');
  assert.equal(getLecture(U).contenu.synthese, 'ce que tu répètes');
});

test('mais une PREMIÈRE lecture vide passe : il n’y a rien à protéger', () => {
  const U = 'premiere';
  upsertUser({ id: U, username: U });
  const r = pose(U, { synthese: 'pas encore de quoi', themes: [], carte: { noeuds: [] }, schemas: [] });
  assert.notEqual(r?.refusee, true);
  assert.equal(getLecture(U).contenu.synthese, 'pas encore de quoi');
  // Et elle se laisse remplacer par une vraie, dans ce sens-là.
  pose(U, PLEINE);
  assert.equal(getLecture(U).contenu.carte.noeuds.length, 2);
});

test('une lecture pleine en remplace une autre normalement', () => {
  const U = 'remplace';
  upsertUser({ id: U, username: U });
  pose(U, PLEINE);
  const neuve = { ...PLEINE, synthese: 'la suivante',
                  carte: { noeuds: [{ nom: 'le dimanche soir', genre: 'periode', jours: [] }], liens: [] } };
  const r = pose(U, neuve);
  assert.notEqual(r?.refusee, true);
  assert.equal(getLecture(U).contenu.synthese, 'la suivante');
  assert.equal(getLecture(U).contenu.carte.noeuds.length, 1);
});
