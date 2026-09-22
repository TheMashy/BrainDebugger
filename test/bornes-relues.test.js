/*
 * RELIRE LE JOURNAL QUAND LES OREILLES CHANGENT.
 *
 * Un extracteur qui apprend une tournure ne dira jamais rien des messages
 * déjà écrits : ils ont été lus une fois, par la version d'avant. « jme suis
 * couché a minuit trente » était dans le journal depuis des jours, personne
 * ne l'avait entendu, et la journée du 18 n'avait pas de durée de sommeil.
 *
 * La relecture existait — `rangerToutLeJournal` — et RIEN NE L'APPELAIT : une
 * route que personne ne déclenche. Ces tests tiennent son déclenchement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-bornes-')), 'test.db');

const { OWNER, getSettings, setSettings, addMessage, mesuresDuJour } = await import('../server/db.js');
const { relireSiLesOreillesOntChange } = await import('../server/api.js');

const AUJ = new Date().toISOString().slice(0, 10);
const attendre = () => new Promise(r => setImmediate(() => setImmediate(r)));

test('LA PHRASE DU 18 RETROUVE SON HEURE DE COUCHER', async () => {
  addMessage({ ts: `${AUJ}T07:58:00`, date: AUJ, role: 'user',
    text: "jme suis levé tôt aujourd'hui 6/10 jme suis couché a minuit trente", userId: OWNER });
  setSettings({ bornesLues: 0 }, OWNER);
  assert.equal(relireSiLesOreillesOntChange(OWNER), true);
  await attendre();
  const dites = mesuresDuJour(AUJ, OWNER).filter(m => m.source === 'dit');
  const couche = dites.find(m => m.cle === 'coucher_dit');
  assert.ok(couche, 'le coucher écrit n’a pas été retrouvé');
  assert.equal(couche.texte, '00:30');
  assert.ok(dites.find(m => m.cle === 'lever_dit'), 'le lever écrit non plus');
});

test('ELLE NE SE RELIT PAS À CHAQUE OUVERTURE DE PAGE', () => {
  /*
   * Une demi-seconde sur mille sept cents journées, à chaque chargement, c'est
   * exactement l'attente devant un écran vide dont on se plaint.
   */
  assert.equal(relireSiLesOreillesOntChange(OWNER), false);
  assert.ok(Number(getSettings(OWNER).bornesLues) >= 1);
});

test('LE DRAPEAU MONTE AVANT DE LANCER', () => {
  /*
   * Deux onglets ouverts en même temps la lanceraient deux fois si le drapeau
   * ne montait qu'à la fin.
   */
  setSettings({ bornesLues: 0 }, OWNER);
  assert.equal(relireSiLesOreillesOntChange(OWNER), true);
  assert.equal(relireSiLesOreillesOntChange(OWNER), false,
    'le second appel doit repartir tout de suite, sans relancer');
});

test('ET C’EST L’OUVERTURE DE LA PAGE QUI LA DÉCLENCHE', () => {
  /*
   * `rangerToutLeJournal` existait déjà, exposé en route — et RIEN NE
   * L'APPELAIT. Une relecture que personne ne déclenche ne relit rien, et
   * c'est exactement pour ça que la phrase du 18 est restée muette pendant
   * des jours. Ces trois tests-là appellent la fonction directement : sans
   * celui-ci, on pourrait débrancher la ligne de `/api/state` sans que la
   * suite bronche.
   */
  const api = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  const route = api.slice(api.indexOf("'GET /api/state':"), api.indexOf("'GET /api/state':") + 400);
  assert.match(route, /relireSiLesOreillesOntChange\(userId\)/,
    'la relecture n’est branchée nulle part : elle ne se fera jamais');
});
