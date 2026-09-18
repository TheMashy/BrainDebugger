/*
 * LE CONNECTEUR — CE QU'UN AUTRE MODÈLE PEUT DÉPOSER ICI.
 *
 * Une conversation tenue ailleurs (Claude, ChatGPT, ce qu'on veut) peut poser
 * une note dans le carnet. Une seule porte, un seul sens.
 *
 * Ces tests tiennent les quatre choses qui peuvent mal tourner : la clé
 * s'enregistre VRAIMENT, elle n'est pas celle de la passerelle, la note entre
 * par le carnet et pas par le fil, et il n'existe AUCUN outil de lecture.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-conn-')), 'test.db');
const db = await import('../server/db.js');
const { OWNER, allCarnet, recentMessages, getSettings } = db;
const C = await import('../server/connecteur.js');
const P = await import('../server/passerelle.js');

const JOUR = () => '2026-09-17';

test('la clé s’enregistre VRAIMENT', () => {
  /*
   * `setSettings` abandonne EN SILENCE toute clé absente de DEFAULT_SETTINGS.
   * Sans la déclaration, `poserCle` rendait une clé que rien n'avait écrite :
   * on la collait dans le connecteur, et le serveur la refusait. Aucune erreur
   * nulle part — ni à l'écriture, ni à la lecture.
   */
  const cle = C.poserCle(OWNER);
  assert.ok(cle && cle.length >= 24, 'une clé non vide');
  assert.equal(C.cleExiste(OWNER), true, 'rien n’a été écrit dans les réglages');
  assert.equal(C.proprietaireDeLaCle(cle), OWNER);
});

test('une clé inconnue n’ouvre rien', () => {
  C.poserCle(OWNER);
  assert.equal(C.proprietaireDeLaCle('pas-la-bonne-du-tout-x'), null);
  assert.equal(C.proprietaireDeLaCle(''), null);
  assert.equal(C.proprietaireDeLaCle(null), null);
});

test('la clé du connecteur n’est PAS celle de la passerelle', () => {
  /* L'une LIT (couleurs, notes, repères), l'autre ÉCRIT. Une seule clé pour
     les deux, c'est un secret collé chez un tiers qui ouvre aussi la lecture —
     et une révocation qui éteint la guirlande quand on voulait fermer la
     porte d'écriture. */
  const conn = C.poserCle(OWNER);
  const pass = P.poserCle(OWNER);
  assert.notEqual(conn, pass);
  assert.equal(P.proprietaireDeLaCle(conn), null, 'la clé du connecteur ouvre la passerelle');
  assert.equal(C.proprietaireDeLaCle(pass), null, 'la clé de la passerelle ouvre le connecteur');

  C.retirerCle(OWNER);
  assert.equal(P.proprietaireDeLaCle(pass), OWNER, 'fermer le connecteur a éteint la passerelle');
});

test('la clé se lit dans l’en-tête d’autorisation', () => {
  const req = { headers: { authorization: 'Bearer abc123' } };
  assert.equal(C.cleDeLaRequete(req, null), 'abc123');
  assert.equal(C.cleDeLaRequete({ headers: { 'x-connecteur-cle': 'def' } }, null), 'def');
  assert.equal(C.cleDeLaRequete({ headers: {} },
    { searchParams: new URLSearchParams('cle=ghi') }), 'ghi');
  assert.equal(C.cleDeLaRequete({ headers: {} }, null), null);
});

test('la note entre par le CARNET, jamais par le fil', () => {
  /*
   * C'est la règle du carnet depuis le début, et un connecteur n'est pas une
   * raison de l'assouplir : passer par les messages ferait DIRE ces mots à la
   * personne — ils repartiraient dans son fil comme sa parole de ce jour-là —
   * et transformerait une journée non écrite en journée écrite, ce qui déplace
   * tous les comptes de la carte.
   */
  const avantFil = recentMessages(80, OWNER).length;
  const r = C.poserNote({ texte: 'la peur avant de sortir est pire que la sortie' }, OWNER, JOUR);
  assert.equal(r.ok, true);
  assert.equal(recentMessages(80, OWNER).length, avantFil, 'un message a été écrit');
  const n = allCarnet(OWNER).at(-1);
  assert.match(n.texte, /pire que la sortie/);
  assert.equal(n.source, 'connecteur', 'la note doit dire d’où elle vient');
  assert.equal(n.jour, '2026-09-17');
});

test('une date bien formée est respectée, une date approchée jamais', () => {
  /* Un modèle qui écrit une date à deux heures du matin ne sait pas qu'une
     journée commence au lever. On n'accepte donc QUE AAAA-MM-JJ, et sinon on
     prend la journée vécue — jamais une date devinée, qui rangerait la note
     dans la mauvaise soirée sans que personne ne le voie après coup. */
  assert.equal(C.jourDeLaNote('2026-09-14', JOUR), '2026-09-14');
  assert.equal(C.jourDeLaNote('hier', JOUR), '2026-09-17');
  assert.equal(C.jourDeLaNote('14/09/2026', JOUR), '2026-09-17');
  assert.equal(C.jourDeLaNote('2026-13-45', JOUR), '2026-09-17', 'un mois 13 n’existe pas');
  assert.equal(C.jourDeLaNote(null, JOUR), '2026-09-17');
});

test('rien à noter, ou trop à noter', () => {
  assert.match(C.poserNote({ texte: '   ' }, OWNER, JOUR).erreur, /rien à noter/);
  const trop = 'a'.repeat(C.TEXTE_MAX + 1);
  assert.match(C.poserNote({ texte: trop }, OWNER, JOUR).erreur, /trop long/);
  const avant = allCarnet(OWNER).length;
  C.poserNote({ texte: trop }, OWNER, JOUR);
  assert.equal(allCarnet(OWNER).length, avant, 'un refus ne doit rien écrire');
});

test('ÇA ÉCRIT, ÇA NE LIT PAS — et c’est une décision, pas une étape', async () => {
  /*
   * Le garde-fou du produit. Un outil de lecture enverrait le journal de
   * quelqu'un au serveur du modèle à qui il parle ; ça se défend, mais ça se
   * décide pour soi-même, un jour où on la regarde. Tant que ce n'est pas fait,
   * ce test doit tomber si quelqu'un en ajoute un.
   */
  let outils;
  try {
    const s = await C.serveurPour(OWNER, JOUR);
    outils = Object.keys(s._registeredTools ?? {});
  } catch (e) {
    if (/Cannot find package/.test(String(e.message))) return;   // SDK absent : rien à tenir
    throw e;
  }
  assert.deepEqual(outils, ['noter'], `un outil de plus est apparu : ${outils.join(', ')}`);
});

/* ---------------------------------------------------------------------
 * 401 EST LE MOT QUI DÉCLENCHE L'OAUTH.
 *
 * Dans le contrat MCP, un 401 ne veut pas dire « ta clé est fausse », il veut
 * dire « va chercher de quoi t'authentifier ». Claude.ai l'a pris au mot : il
 * est parti en découverte OAuth, a tenté de s'inscrire auprès d'un service qui
 * n'existe pas, et a rendu « Impossible de s'inscrire auprès du service de
 * connexion ». Le message parlait d'OAuth ; le vrai défaut était une clé qui
 * n'était jamais arrivée.
 *
 * La clé voyage donc DANS L'ADRESSE — c'est ce que ces réglages appellent
 * « pas de connexion : quiconque a l'adresse peut s'en servir » — et une
 * adresse sans clé valable rend 404 : elle n'existe pas, ce qui est vrai et
 * n'invite personne à s'inscrire.
 * --------------------------------------------------------------------- */

test('l’adresse porte la clé', () => {
  const cle = 'abcdefghijklmnop0123';
  assert.equal(C.CHEMIN.exec('/mcp/' + cle)?.[1], cle);
  assert.equal(C.CHEMIN.exec('/api/mcp/' + cle)?.[1], cle);
  assert.equal(C.cleDeLaRequete({ headers: {} }, { pathname: '/mcp/' + cle }), cle);
});

test('le chemin reconnaît ce qu’il doit, et rien d’autre', () => {
  for (const bon of ['/mcp', '/mcp/', '/api/mcp', '/mcp/abcdefghijklmnop0123'])
    assert.ok(C.CHEMIN.test(bon), `« ${bon} » devrait être une adresse du connecteur`);
  for (const mauvais of ['/mcpx', '/mcp/a/b', '/mcp/court', '/api/mcpx', '/mcp/avec espace'])
    assert.ok(!C.CHEMIN.test(mauvais), `« ${mauvais} » ne devrait pas en être une`);
});

test('le chemin l’emporte sur l’en-tête', () => {
  /* Si les deux sont là et se contredisent, c'est l'adresse qui a été collée
     dans le connecteur : c'est elle qui dit de qui il s'agit. */
  const cle = 'zzzzzzzzzzzzzzzz9999';
  assert.equal(
    C.cleDeLaRequete({ headers: { authorization: 'Bearer autre-chose-encore' } },
                     { pathname: '/mcp/' + cle }), cle);
});

test('l’en-tête marche encore, pour les clients qui savent en poser un', () => {
  assert.equal(C.cleDeLaRequete({ headers: { authorization: 'Bearer xyz' } },
                                { pathname: '/mcp' }), 'xyz');
});

test('JAMAIS 401 sur une adresse sans clé — c’est ce qui a cassé la connexion', () => {
  /*
   * Ce test lit le CODE de la route, pas une réponse : le statut se décide là,
   * et c'est la seule ligne qui empêche un client MCP de partir en OAuth.
   * Si quelqu'un la repasse à 401 un jour, le connecteur cessera de se
   * connecter sans qu'aucune requête n'échoue — le symptôme sera un message
   * d'inscription, à trois écrans de la cause.
   */
  const index = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const debut = index.indexOf('connecteur.CHEMIN.test(url.pathname)');
  assert.ok(debut > 0, 'la route du connecteur est introuvable');
  const bloc = index.slice(debut, index.indexOf('la passerelle vers une application locale', debut));
  assert.ok(bloc.includes('return json(res, 404,'), 'le refus doit être un 404');
  assert.ok(!/return json\(res, 401,/.test(bloc),
    '401 veut dire « va t’authentifier » dans le contrat MCP, pas « clé fausse »');
});
