/**
 * « EST-CE QUE LE SITE EST À JOUR ? »
 *
 * La sonde de santé ne disait que `{ok: true}`. Un déploiement qui n'est pas
 * parti, un déploiement en échec et un cache de navigateur se ressemblent tous
 * les trois depuis un écran, et il fallait deviner. Elle dit maintenant le
 * commit déployé — sept caractères se comparent à l'œil avec la dernière ligne
 * de `git log`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { commitDeploye, versionDuPaquet, DEMARRE_LE } from '../server/version.js';

test('le commit est coupé à sept caractères, la longueur qu’on compare à l’œil', () => {
  assert.equal(commitDeploye({ RAILWAY_GIT_COMMIT_SHA: '1c42d4ed938cb43c4159e47acf19b48d3c903782' }),
               '1c42d4e');
});

test('chaque hébergeur a son nom pour la même chose', () => {
  assert.equal(commitDeploye({ SOURCE_COMMIT: 'abcdef1234' }), 'abcdef1');
  assert.equal(commitDeploye({ GIT_COMMIT: 'fedcba9876' }), 'fedcba9');
  assert.equal(commitDeploye({ VERCEL_GIT_COMMIT_SHA: '0123456789' }), '0123456');
});

test('« inconnu » quand personne ne le dit — plus honnête qu’un commit inventé', () => {
  assert.equal(commitDeploye({}), 'inconnu');
  assert.equal(commitDeploye({ RAILWAY_GIT_COMMIT_SHA: '' }), 'inconnu');
  assert.equal(commitDeploye({ RAILWAY_GIT_COMMIT_SHA: '   ' }), 'inconnu',
    'un espace n’est pas un commit');
});

test('la version vient du paquet, et son absence ne fait pas tomber le démarrage', async () => {
  assert.match(await versionDuPaquet(), /^\d+\.\d+\.\d+$/);
  assert.equal(await versionDuPaquet('/n/existe/pas'), '0.0.0',
    'un champ d’affichage ne doit jamais empêcher le serveur de démarrer');
});

test('l’heure de démarrage est celle du processus, pas celle de la lecture', async () => {
  const a = DEMARRE_LE;
  await new Promise(r => setTimeout(r, 20));
  const { DEMARRE_LE: b } = await import('../server/version.js');
  assert.equal(a, b,
    'un redéploiement remet la pendule à zéro : une date ancienne veut dire ' +
    '« rien n’est reparti », une date qui bouge à chaque appel ne dirait rien');
  assert.match(a, /^\d{4}-\d{2}-\d{2}T/);
});
