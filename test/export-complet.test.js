/**
 * L'EXPORT EMPORTE TOUT CE QUI EST À LUI.
 *
 * « Les données appartiennent à l'utilisateur, et il doit pouvoir partir
 * avec » -- mais l'export ne portait ni le carnet, ni les relevés, ni les
 * suivis, ni les objectifs, et il perdait le drapeau des messages rangés : un
 * export rechargé aurait recompté un courrier rangé comme une journée racontée.
 * Les phrases sont synthétiques.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-export-')), 'test.db');

const { OWNER, addMessage, rangerMessage, addReleve, poserSuivi, addObjectif, addCarnet, setNote } =
  await import('../server/db.js');
const { routes } = await import('../server/api.js');

test('l’export garde ses champs d’avant et ajoute ce qui manquait', () => {
  setNote('2026-03-02', 6);
  const idGarde = addMessage({ ts: '2026-03-02T20:00:00Z', date: '2026-03-02', role: 'user', text: 'une soirée au calme' });
  const idRange = addMessage({ ts: '2026-03-02T21:00:00Z', date: '2026-03-02', role: 'user', text: 'un courrier recopié' });
  assert.ok(!rangerMessage(idRange, {}, OWNER).erreur);
  addCarnet({ texte: 'une note prise ailleurs', jour: null, userId: OWNER });
  addReleve({ messageId: idGarde, date: '2026-03-02', valeur: 6, quoi: 'plutôt posé', userId: OWNER,
              quand: '2026-03-02T20:05:00Z' });
  poserSuivi({ cle: 'sien:the', nom: 'le thé du soir', mots: 'thé', genre: 'reduire', userId: OWNER });
  addObjectif({ quoi: 'marcher le matin', depuis: '2026-03-01', userId: OWNER });

  const ex = routes['GET /api/export']({ userId: OWNER });
  for (const k of ['exportedAt', 'entries', 'events', 'anchors', 'messages', 'images'])
    assert.ok(k in ex, `le champ « ${k} » a disparu de l’export`);

  const parId = Object.fromEntries(ex.messages.map(m => [m.id, m]));
  assert.equal(parId[idRange].rangee, 1, 'le message rangé ne le dit plus');
  assert.equal(parId[idGarde].rangee, 0);
  assert.ok(ex.carnet.some(c => c.texte === 'un courrier recopié'), 'le carnet ne porte pas le message rangé');
  assert.ok(ex.carnet.some(c => c.texte === 'une note prise ailleurs'));
  assert.deepEqual(ex.releves.map(r => [r.message_id, r.valeur, r.quoi, r.ts]),
                   [[idGarde, 6, 'plutôt posé', '2026-03-02T20:05:00Z']]);
  assert.ok(ex.suivis.some(s => s.cle === 'sien:the' && s.nom === 'le thé du soir'));
  assert.ok(ex.objectifs.some(o => o.quoi === 'marcher le matin'));
});
