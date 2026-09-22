/*
 * RELIRE UNE JOURNÉE QUI A ÉTÉ ÉCRITE AVANT QU'ON SACHE LA LIRE.
 *
 * Un digest est écrit UNE FOIS, avec ce que l'application savait ce soir-là.
 * Les journées d'avant `temps_par_site_seul_s` affichaient donc « 87 % qui n'a
 * même pas de nom » — et c'était faux : leurs noms sont dans la barre juste
 * au-dessus, puisque le digest porte ses titres rangés par site.
 *
 * On les déduit sans aucune table et sans rien redemander à la machine :
 * `titres` donne, par site, les secondes de chaque page ; `titres_par_theme`
 * celles qu'un sujet a déjà prises. La soustraction est ce qu'aucun sujet n'a
 * su nommer, et on sait sur quel site c'était.
 *
 * Ce qui se teste ici est surtout ce qui ne doit JAMAIS arriver : une barre
 * qui dépasse la journée, et une bonne mesure remplacée par une déduction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-relus-')), 'test.db');

const { upsertUser, poserActiviteJour } = await import('../server/db.js');
const { posteDuJour } = await import('../server/api.js');

const U = 'relus';
upsertUser({ id: U, username: U });
const poser = (jour, digest) => {
  poserActiviteJour(U, jour, { date: jour, plage: { de: '09:00', a: '23:00' }, ...digest });
  return posteDuJour(jour, U).ecran;
};
const somme = xs => (xs ?? []).reduce((n, x) => n + x.min, 0);

test('UNE JOURNÉE D’AVANT RETROUVE SES NOMS', () => {
  const e = poser('2026-07-01', {
    temps_par_contexte_s: { 'web:youtube': 3600, 'web:irontide': 1200 },
    titres: {
      'web:youtube': { 'une vidéo qu’aucun mot-clef ne reconnaît': 3600 },
      'web:irontide': { irontide: 1200 },
    },
  });
  assert.equal(e.sites_deduits, true, 'la journée doit se dire relue');
  assert.deepEqual(e.sites, [{ nom: 'youtube', min: 60 }, { nom: 'irontide', min: 20 }]);
});

test('CE QU’UN SUJET A DÉJÀ PRIS N’EST PAS RECOMPTÉ', () => {
  const e = poser('2026-07-02', {
    temps_par_contexte_s: { 'web:youtube': 2400, 'web:reddit': 1200 },
    temps_par_theme_web_s: { guerre: 2400 },
    titres: {
      'web:youtube': { 'un titre de guerre': 2400 },
      'web:reddit': { 'un fil sans sujet': 1200 },
    },
    titres_par_theme: { guerre: { 'un titre de guerre': 2400 } },
  });
  /*
   * DEUX SITES, ET LA SOUSTRACTION DÉCIDE DU NOM. Avec un seul, le plafond dur
   * ramenait le total au bon chiffre même sans soustraire — le test passait et
   * ne prouvait rien. Ici, sans la soustraction, c'est « youtube » qui sort,
   * et ses 40 minutes sont déjà comptées dans « guerre ».
   */
  assert.deepEqual(e.sites, [{ nom: 'reddit', min: 20 }],
    'les 40 min déjà rangées dans « guerre » ne doivent pas revenir sous leur site');
});

test('LA BARRE NE DÉPASSE JAMAIS LA JOURNÉE', () => {
  /*
   * LE DÉFAUT MESURÉ : `titres_par_theme` ne garde que les DIX plus longs
   * titres par sujet, au-dessus de trente secondes. Ce qu'un sujet a pris est
   * donc sous-compté, la soustraction recompte ces minutes-là, et une journée
   * rendait 112 % — 240 minutes nommées sur 214 de navigateur. Une barre qui
   * dépasse la journée est pire que la barre vide qu'elle remplace.
   */
  const e = poser('2026-07-03', {
    temps_par_contexte_s: { 'web:youtube': 3600 },
    temps_par_theme_web_s: { guerre: 3000 },
    // Le digest sait que 50 min sont de la guerre, mais n'en nomme qu'une part.
    titres: { 'web:youtube': { a: 1800, b: 1800 } },
    titres_par_theme: { guerre: { a: 1200 } },
  });
  assert.ok(somme(e.themes) + somme(e.lieux) + somme(e.sites) <= e.web_min,
    `${somme(e.themes)} + ${somme(e.lieux)} + ${somme(e.sites)} dépassent ${e.web_min} min`);
});

test('UNE MESURE VRAIE N’EST PAS REMPLACÉE PAR UNE DÉDUCTION', () => {
  const e = poser('2026-07-04', {
    temps_par_contexte_s: { 'web:youtube': 3600 },
    temps_par_lieu_web_s: { video: 3600 },
    titres: { 'web:youtube': { 'une vidéo': 3600 } },
  });
  assert.equal(e.sites_deduits, null, 'la journée est déjà classée, rien à relire');
  assert.deepEqual(e.lieux, [{ nom: 'video', min: 60 }], 'le TYPE du lieu doit survivre');
});

test('UNE MESURE EN RETARD, ELLE, CÈDE LA PLACE', () => {
  /*
   * LE CAS RÉEL. Machi Tool s'est mis à jour à 18 h : la journée porte un
   * `temps_par_lieu_web_s` VRAI mais partiel — 10 min là où ses propres titres
   * en nomment 60. La traiter comme « déjà classée » la laissait à 17 %.
   */
  const e = poser('2026-07-05', {
    temps_par_contexte_s: { 'web:youtube': 3600 },
    temps_par_lieu_web_s: { video: 600 },
    titres: { 'web:youtube': { 'une vidéo': 3600 } },
  });
  assert.equal(e.sites_deduits, true);
  assert.equal(e.lieux, null, 'les deux ensemble compteraient deux fois les mêmes minutes');
  assert.deepEqual(e.sites, [{ nom: 'youtube', min: 60 }]);
});

test('« autre » N’EST PAS UN NOM, MÊME EN RELISANT', () => {
  const e = poser('2026-07-06', {
    temps_par_contexte_s: { 'web:autre': 3600 },
    titres: { 'web:autre': { 'i think they are wrong about this': 3600 } },
  });
  assert.equal(e.sites, null);
});

test('SANS TITRES, ON NE DÉDUIT RIEN', () => {
  /*
   * Les titres ne sont gardés que si la personne l'a demandé. Sans eux on n'a
   * pas jeté l'information — on ne l'a jamais eue, et on ne la fabrique pas.
   */
  const e = poser('2026-07-07', {
    temps_par_contexte_s: { 'web:youtube': 3600 },
    temps_par_theme_web_s: { guerre: 3600 },
  });
  assert.equal(e.sites, null);
  assert.equal(e.sites_deduits, null);
});
