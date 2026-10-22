/**
 * LA BULLE DE CLAUDE CODE — « une bulle de statut quand Claude réfléchit :
 * rouge quand il attend une confirmation, jaune quand il travaille, vert
 * quand c'est fini ». Les sessions dans le cloud ne joignent pas le PC : leurs
 * crochets posent leur étape ici, Machi Tool vient la lire.
 *
 * Tenu ici :
 *   - la clé de la bulle se tire de celle de la passerelle (la même que
 *     Machi Tool calcule : un vecteur commun aux deux) et ne désigne qu'elle ;
 *   - on ne garde que la dernière étape de chaque session, réduite à ses
 *     champs (rien de ce que Claude lit ou écrit), trois heures au plus ;
 *   - une session qui se ferme s'efface ; pas plus de vingt sessions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-bulle-')), 'test.db');
process.env.ANTHROPIC_API_KEY = '';
const { OWNER } = await import('../server/db.js');
const P = await import('../server/passerelle.js');
const B = await import('../server/bulle-claude.js');

test('la clé de la bulle : tirée de la passerelle, la même que celle de Machi Tool', () => {
  assert.equal(P.cleDeLaBulle('cle-de-test'), 'bbb1f950f42614c413242a554340eaac');
  assert.equal(P.cleDeLaBulle(''), '');
  const passerelle = P.poserCle(OWNER);
  assert.equal(P.proprietaireDeLaCleBulle(P.cleDeLaBulle(passerelle)), OWNER);
  assert.equal(P.proprietaireDeLaCleBulle(passerelle), null, 'la clé de la passerelle ne pose pas de bulle');
  assert.equal(P.proprietaireDeLaCle(P.cleDeLaBulle(passerelle)), null, 'la clé de la bulle n’ouvre pas la passerelle');
  assert.equal(P.proprietaireDeLaCleBulle('pas-la-bonne'), null);
  assert.equal(P.proprietaireDeLaCleBulle(''), null);
});

test('la dernière étape de chaque session, réduite à ses champs', () => {
  B.oublierTout();
  const t = 1_800_000_000_000;
  assert.deepEqual(B.poserEtape(OWNER, { hook_event_name: 'UserPromptSubmit', session_id: 's1',
                                         prompt: 'ma demande', dossier: 'MachiToolkit' }, t), { ok: true });
  B.poserEtape(OWNER, { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash',
                        tool_input: { command: 'rm -rf secret' } }, t + 2000);
  const [s1] = B.lireEtapes(OWNER, t + 5000);
  assert.deepEqual(s1, { hook_event_name: 'PreToolUse', session_id: 's1', tool_name: 'Bash', age_s: 3 });
  assert.ok(!JSON.stringify(B.lireEtapes(OWNER, t)).includes('secret'));
  assert.ok(B.poserEtape(OWNER, { session_id: 's1' }).erreur, 'sans étape : refusé');
  // une deuxième session ; une session fermée s'efface ; trois heures au plus
  B.poserEtape(OWNER, { hook_event_name: 'Notification', session_id: 's2', notification_type: 'permission_prompt',
                        message: 'Claude needs your permission to use Bash' }, t + 6000);
  assert.equal(B.lireEtapes(OWNER, t + 7000).length, 2);
  B.poserEtape(OWNER, { hook_event_name: 'SessionEnd', session_id: 's1' }, t + 8000);
  assert.deepEqual(B.lireEtapes(OWNER, t + 9000).map(s => s.session_id), ['s2']);
  assert.deepEqual(B.lireEtapes(OWNER, t + 6000 + 3 * 3600 * 1000 + 1), []);
  assert.deepEqual(B.lireEtapes('quelqu-un-d-autre', t), []);
  for (let k = 0; k < 30; k++) B.poserEtape(OWNER, { hook_event_name: 'Stop', session_id: 'x' + k }, t + k);
  const restent = B.lireEtapes(OWNER, t + 100);
  assert.equal(restent.length, 20);
  assert.equal(restent.at(-1).session_id, 'x29', 'les plus récentes restent');
});
