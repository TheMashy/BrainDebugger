/**
 * LA ROUTE D'ENTRÉE, POUR DE VRAI — en HTTP, avec un serveur qui écoute.
 *
 * Le reste des tests appelle les fonctions ; celui-ci appelle le SITE. C'est le
 * seul moyen de vérifier ce qui n'existe que dans le routage : que la route est
 * bien DEVANT le verrou (une application de suivi n'a pas de session et n'en
 * aura jamais), que la clé est exigée, et qu'un envoi refusé laisse quand même
 * une trace dans le journal.
 *
 * Une intégration extérieure qui casse ne se voit pas en développement : elle
 * se voit trois semaines plus tard, quand quelqu'un remarque que sa montre
 * n'envoie plus rien depuis un déploiement.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const DB = join(mkdtempSync(join(tmpdir(), 'bd-qsroute-')), 'test.db');
process.env.BD_DB = DB;

const { poserCle } = await import('../server/passerelle.js');
const { OWNER, journalQS, inventaireMesures, mesuresDuJour } = await import('../server/db.js');

const CLE = poserCle(OWNER);
const PORT = 4000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;

// Le mot de passe est là pour que le verrou soit ACTIF : sans lui, le serveur
// refuse de démarrer sur une écoute ouverte, et surtout la route ne prouverait
// rien — passer devant un verrou absent n'est pas passer devant un verrou.
const serveur = spawn(process.execPath, [join(import.meta.dirname, '..', 'server', 'index.js')], {
  env: { ...process.env, BD_DB: DB, PORT: String(PORT), BD_PASSWORD: 'motdepasse-de-test', HOST: '127.0.0.1' },
  stdio: 'ignore'
});

const pret = async () => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/healthz`)).ok) return true; } catch { /* pas encore là */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('le serveur n’a pas démarré');
};
await pret();

test.after(() => serveur.kill());

const envoyer = (charge, entetes = { Authorization: `Bearer ${CLE}` }) =>
  fetch(`${BASE}/api/qs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Fuseau': 'Europe/Paris', ...entetes },
    body: typeof charge === 'string' ? charge : JSON.stringify(charge)
  });

test('sans clé : 401, et la raison dit quoi faire', async () => {
  const r = await envoyer({ pas: 1 }, {});
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.match(j.indice, /Réglages/, 'un 401 sans indice se cherche du côté du chemin');
});

test('avec une clé fausse : 401', async () => {
  assert.equal((await envoyer({ pas: 1 }, { Authorization: 'Bearer nawak' })).status, 401);
});

test('la clé passe par l’en-tête maison et par ?cle= aussi', async () => {
  assert.equal((await envoyer({ pas: 1, source: 'entete' }, { 'X-Machitool-Cle': CLE })).status, 200);
  const r = await fetch(`${BASE}/api/qs?cle=${encodeURIComponent(CLE)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pas: 1, source: 'url' })
  });
  assert.equal(r.status, 200);
});

test('un envoi valide est rangé et compté', async () => {
  const r = await envoyer({ source: 'montre', date: '2026-04-04', mesures: { pas: 8410, sommeil_h: 6.2 } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { gardees: 2, laissees: 0, detail: [] });
  const rangees = mesuresDuJour('2026-04-04').map(m => m.cle).sort();
  assert.deepEqual(rangees, ['pas', 'sommeil_h']);
});

test('la réponse dit ce qui a été laissé — l’app qui envoie est la seule à pouvoir corriger', async () => {
  const r = await envoyer({ source: 'montre', date: '2026-04-05', mesures: { pas: 1, vide: '' } });
  const j = await r.json();
  assert.equal(j.gardees, 1);
  assert.equal(j.laissees, 1);
  assert.match(j.detail[0].pourquoi, /vide ou illisible/);
});

test('un JSON cassé rend 400 et laisse quand même une trace', async () => {
  const r = await envoyer('{"pas": ');
  assert.equal(r.status, 400);
  const ligne = journalQS(OWNER)[0];
  assert.equal(ligne.statut, 400);
  assert.match(ligne.refus, /JSON invalide/);
});

test('tout envoi accepté laisse une ligne au journal, avec l’aperçu des séries', async () => {
  await envoyer({ source: 'balance', date: '2026-04-06', mesures: { poids: 72.4 } });
  const ligne = journalQS(OWNER).find(l => l.source === 'balance');
  assert.ok(ligne, 'aucune trace de l’envoi');
  assert.equal(ligne.gardees, 1);
  assert.match(ligne.apercu, /poids/);
});

test('renvoyer le même jour ne double pas la série', async () => {
  await envoyer({ source: 'resync', date: '2026-04-07', mesures: { pas: 100 } });
  await envoyer({ source: 'resync', date: '2026-04-07', mesures: { pas: 100 } });
  await envoyer({ source: 'resync', date: '2026-04-07', mesures: { pas: 100 } });
  const inv = inventaireMesures(OWNER).find(x => x.source === 'resync' && x.cle === 'pas');
  assert.equal(inv.n, 1, 'trois synchronisations ont fait trois lignes');
});

test('la lecture de la passerelle marche toujours — les deux sens coexistent', async () => {
  const r = await fetch(`${BASE}/api/machitool/attente`, { headers: { Authorization: `Bearer ${CLE}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(Object.keys(j).sort(), ['humeur', 'jours', 'lecture', 'rappels', 'reperes']);
});

test('LE JOURNAL NE SORT PAS PAR LA PASSERELLE', async () => {
  // La règle du produit ne change pas parce qu'on ajoute un tuyau : ce qui est
  // écrit dans le journal ne quitte jamais le site par cette route.
  const brut = await (await fetch(`${BASE}/api/machitool/attente`, {
    headers: { Authorization: `Bearer ${CLE}` } })).text();
  for (const interdit of ['text', 'message', 'synthese', 'contenu']) {
    assert.equal(brut.includes(`"${interdit}"`), false, `« ${interdit} » est sorti par la passerelle`);
  }
});
