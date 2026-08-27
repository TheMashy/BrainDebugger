/**
 * La lecture. Ce qui est testé n'est pas ce que le modèle trouve — c'est ce que
 * le serveur refuse de laisser passer.
 *
 * Un modèle invente des dates. Une preuve datée du 12 mars qui n'existe pas
 * envoie quelqu'un sur une journée vide en lui disant qu'il y a écrit quelque
 * chose : c'est pire que pas de preuve du tout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { valider, corpusPour, choisirJours, HORIZONS } from '../server/lecture.js';

const DATES = new Set(['2024-03-12', '2024-04-02', '2024-05-20']);

/* ----------------------------- la validation ----------------------------- */

test('une date absente du corpus est retirée', () => {
  const r = valider({
    synthese: 'x',
    themes: [{
      nom: 'instabilité', quoi: 'y', intensite: 2, serie: [],
      preuves: [{ date: '2024-03-12', extrait: 'vrai' }, { date: '1999-01-01', extrait: 'inventé' }]
    }]
  }, DATES);
  assert.equal(r.themes[0].preuves.length, 1);
  assert.equal(r.themes[0].preuves[0].date, '2024-03-12');
});

test('un thème dont toutes les preuves sont inventées disparaît', () => {
  // La consigne dit qu'un thème sans ancrage ne tient pas. Une consigne qui
  // n'est pas appliquée n'est pas une règle.
  const r = valider({
    synthese: 'x',
    themes: [
      { nom: 'fantôme', quoi: 'y', intensite: 3, serie: [], preuves: [{ date: '1999-01-01', extrait: 'z' }] },
      { nom: 'réel', quoi: 'y', intensite: 1, serie: [], preuves: [{ date: '2024-04-02', extrait: 'z' }] }
    ]
  }, DATES);
  assert.deepEqual(r.themes.map(t => t.nom), ['réel']);
});

test('un lien vers un thème retiré ne trace pas d’arête dans le vide', () => {
  const r = valider({
    synthese: 'x',
    themes: [
      { nom: 'réel', quoi: 'y', intensite: 1, serie: [], liens: ['fantôme', 'autre'],
        preuves: [{ date: '2024-04-02', extrait: 'z' }] },
      { nom: 'autre', quoi: 'y', intensite: 1, serie: [], liens: ['réel'],
        preuves: [{ date: '2024-05-20', extrait: 'z' }] },
      { nom: 'fantôme', quoi: 'y', intensite: 3, serie: [], preuves: [{ date: '1999-01-01', extrait: 'z' }] }
    ]
  }, DATES);
  assert.deepEqual(r.themes.find(t => t.nom === 'réel').liens, ['autre']);
});

test('un thème ne se lie pas à lui-même', () => {
  const r = valider({
    synthese: 'x',
    themes: [{ nom: 'boucle', quoi: 'y', intensite: 1, serie: [], liens: ['boucle', 'BOUCLE'],
               preuves: [{ date: '2024-04-02', extrait: 'z' }] }]
  }, DATES);
  assert.deepEqual(r.themes[0].liens, []);
});

test('les intensités hors échelle sont ramenées dedans', () => {
  const r = valider({
    synthese: 'x',
    themes: [{ nom: 'a', quoi: 'y', intensite: 97, preuves: [{ date: '2024-03-12', extrait: 'z' }],
               serie: [{ periode: '2024-03', valeur: -4 }, { periode: '2024-04', valeur: 12 },
                       { periode: '', valeur: 2 }] }]
  }, DATES);
  assert.equal(r.themes[0].intensite, 3);
  assert.deepEqual(r.themes[0].serie.map(p => p.valeur), [0, 3]);   // la période vide saute
});

test('rien d’exploitable rend une lecture vide, pas une exception', () => {
  assert.deepEqual(valider(null, DATES), { synthese: '', themes: [] });
  assert.deepEqual(valider({ themes: 'pas un tableau' }, DATES).themes, []);
  assert.deepEqual(valider({ themes: [{}] }, DATES).themes, []);
});

/* ------------------------------- le corpus ------------------------------- */

const jour = n => `2024-${String(Math.floor(n / 28) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`;
const ROWS = Array.from({ length: 200 }, (_, i) => ({
  date: jour(i), note: (i % 11),
  text: i % 3 === 0 ? 'x'.repeat(50 + (i % 7) * 300) : ''
}));

test('les journées transmises sont les plus fournies, remises dans l’ordre', () => {
  // Pas les N dernières : sur cinq ans elles ne disent rien de ce qui revient.
  // Pas un tirage uniforme non plus : les journées denses sont celles où il
  // s'est passé quelque chose. Mais le modèle doit lire une chronologie.
  const g = choisirJours(ROWS, 6000);
  assert.ok(g.length > 1);
  const dates = g.map(r => r.date);
  assert.deepEqual(dates, [...dates].sort(), 'les journées ne sont pas chronologiques');
  const moyenneGardee = g.reduce((a, r) => a + r.text.length, 0) / g.length;
  const ecrites = ROWS.filter(r => r.text);
  const moyenneToutes = ecrites.reduce((a, r) => a + r.text.length, 0) / ecrites.length;
  assert.ok(moyenneGardee > moyenneToutes, 'le tri par densité ne sert à rien');
});

test('le budget est respecté et une journée courte passe encore après une longue', () => {
  // `continue` et pas `break` : sinon une seule journée trop grosse ferme la
  // porte à tout ce qui suit, et le corpus s'arrête au premier pavé.
  const g = choisirJours(ROWS, 3000);
  const total = g.reduce((a, r) => a + Math.min(r.text.length, 900) + 24, 0);
  assert.ok(total <= 3000, `budget dépassé : ${total}`);
  assert.ok(g.length >= 2, 'le budget s’est arrêté au premier pavé');
});

test('la fenêtre borne le corpus, et « long » ne borne rien', () => {
  const opts = { rows: ROWS, events: [], carnet: [], motifs: [], objectifs: [] };
  const court = corpusPour('court', opts, '2024-07-20');
  for (const d of court.dates) assert.ok(d >= '2024-06-21', d);
  const long = corpusPour('long', opts, '2024-07-20');
  assert.ok(long.dates.size > court.dates.size);
  // Un horizon inconnu ne casse pas : il retombe sur le plus large.
  assert.equal(corpusPour('nimportequoi', opts, '2024-07-20').depuis, null);
});

test('le corpus dit l’écart-type des mois, pas seulement la moyenne', () => {
  // Deux mois à 6 de moyenne, l'un plat et l'autre entre 1 et 10, ne racontent
  // pas la même chose — et c'est exactement le signal d'une instabilité.
  const plat = Array.from({ length: 20 }, (_, i) => ({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, note: 6, text: 'a' }));
  const agite = Array.from({ length: 20 }, (_, i) => ({ date: `2024-02-${String(i + 1).padStart(2, '0')}`, note: i % 2 ? 10 : 2, text: 'a' }));
  const c = corpusPour('long', { rows: [...plat, ...agite] }, '2024-03-01');
  const l1 = c.texte.split('\n').find(l => l.startsWith('2024-01'));
  const l2 = c.texte.split('\n').find(l => l.startsWith('2024-02'));
  assert.equal(Number(l1.split(' | ')[4]), 0);
  assert.ok(Number(l2.split(' | ')[4]) > 3, l2);
});

test('chaque horizon déclare un grain de découpe', () => {
  for (const [nom, h] of Object.entries(HORIZONS)) {
    assert.ok(h.nom && h.grain, nom);
  }
});

/* --------------------- quand faut-il relire --------------------- */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-lect-')), 'test.db');

const { setLecture, addMessage, OWNER } = await import('../server/db.js');
const api = await import('../server/api.js');

// invalidate() comme le fait streamMessage : la série est mémoïsée, et sans ça
// l'état se lit sur un corpus figé au premier appel.
const ecrire = (date, texte) => {
  addMessage({ ts: `${date}T20:00:00Z`, date, role: 'user', text: texte });
  api.invalidate(OWNER);
};
const etat = h => api.routes['GET /api/lecture']({ query: { horizon: h }, userId: OWNER });

test('sans assez de journées, la lecture n’est pas possible', () => {
  for (let i = 1; i <= 5; i++) ecrire(`2026-01-0${i}`, 'une journée');
  const r = etat('moyen');
  assert.equal(r.possible, false);
  assert.equal(r.ecrites, 5);
});

test('sans lecture, il faut la lancer ; avec, le retard décide', () => {
  for (let i = 6; i <= 25; i++) ecrire(`2026-01-${String(i).padStart(2, '0')}`, 'une journée');
  assert.equal(etat('moyen').possible, true);
  assert.equal(etat('moyen').arelire, true, 'aucune lecture : il faut la faire');

  setLecture({ horizon: 'moyen', contenu: { synthese: 'x', themes: [] },
               jusqu_au: '2026-01-25', jours: 25, modele: 'm', userId: OWNER });
  const a = etat('moyen');
  assert.deepEqual([a.retard, a.perime, a.arelire], [0, false, false]);

  // Écrire tous les soirs ne doit PAS relancer une relecture complète du corpus
  // tous les soirs, pour un thème qui n'aura pas bougé d'un cheveu.
  ecrire('2026-01-26', 'une journée');
  ecrire('2026-01-27', 'une journée');
  const b = etat('moyen');
  assert.deepEqual([b.retard, b.perime, b.arelire], [2, true, false]);

  // Passé le seuil de la fenêtre, elle se relance seule.
  for (let i = 1; i <= 14; i++) ecrire(`2026-02-${String(i).padStart(2, '0')}`, 'une journée');
  assert.equal(etat('moyen').arelire, true);
});

test('le seuil suit la fenêtre : trois journées suffisent sur trente jours', () => {
  setLecture({ horizon: 'court', contenu: { synthese: 'x', themes: [] },
               jusqu_au: '2026-01-25', jours: 25, modele: 'm', userId: OWNER });
  // Sur trente jours, une poignée de journées est déjà une part du corpus ;
  // sur quatre ans, elle ne change rien.
  assert.equal(etat('court').arelire, true);
  assert.equal(etat('long').arelire, true);   // aucune lecture longue enregistrée
});

test('un horizon inconnu retombe sur « moyen » plutôt que d’échouer', () => {
  assert.equal(etat('nimportequoi').horizon, 'moyen');
});
