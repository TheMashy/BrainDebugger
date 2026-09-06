/**
 * Le sens d'un lien de la toile, compté sur les journées : une flèche ne se
 * pose que si « ceci un jour, cela le lendemain » tient contre le reste, et
 * pas dans l'autre sens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-sens-')), 'test.db');
const { sensDuLien, sensDesLiens, lendemain } = await import('../server/sens.js');

const jour = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const corpus = Array.from({ length: 120 }, (_, i) => jour(i));

test('le lendemain passe le mois et l’année', () => {
  assert.equal(lendemain('2026-01-31'), '2026-02-01');
  assert.equal(lendemain('2026-12-31'), '2027-01-01');
  assert.equal(lendemain('2028-02-28'), '2028-02-29');
});

test('B qui suit toujours A, et jamais les autres jours : flèche de A vers B', () => {
  const A = corpus.filter((_, i) => i % 6 === 0);
  const B = A.map(lendemain);
  const s = sensDuLien(A, B, corpus);
  assert.equal(s.sens, 'de');
  assert.equal(s.de.apres, s.de.sur, 'chaque jour de A a B le lendemain');
  assert.ok(s.de.apres >= 4);
  assert.ok(s.de.p < 0.01);
  assert.equal(s.vers.sens, undefined);
  assert.equal(s.meme, 0);
});

test('le même compte, à l’envers : flèche vers A', () => {
  const B = corpus.filter((_, i) => i % 6 === 0);
  const A = B.map(lendemain);
  assert.equal(sensDuLien(A, B, corpus).sens, 'vers');
});

test('deux choses qui s’enchaînent dans les deux sens ne prennent pas de pointe', () => {
  // A un jour sur deux, B l'autre : chacun suit l'autre à chaque fois.
  const A = corpus.filter((_, i) => i % 2 === 0), B = corpus.filter((_, i) => i % 2 === 1);
  assert.equal(sensDuLien(A, B, corpus).sens, 'deux');
});

test('deux choses indépendantes : pas de sens, quoi qu’en dise le verbe', () => {
  // Deux rythmes premiers entre eux : A un jour sur cinq, B un jour sur sept.
  // Le lendemain d'un A tombe sur un B aussi souvent que n'importe quel jour.
  const A = corpus.filter((_, i) => i % 5 === 0), B = corpus.filter((_, i) => i % 7 === 0);
  const s = sensDuLien(A, B, corpus);
  assert.equal(s.sens, null, `sens ${s.sens} trouvé sur du hasard (p de ${s.de.p.toFixed(3)}, p vers ${s.vers.p.toFixed(3)})`);
});

test('trois lendemains ne suffisent pas, même parfaits', () => {
  const A = corpus.filter((_, i) => i % 40 === 0);        // trois jours
  const B = A.map(lendemain);
  assert.equal(sensDuLien(A, B, corpus).sens, null);
});

test('un lendemain non écrit ne compte ni pour ni contre', () => {
  const A = corpus.filter((_, i) => i % 6 === 0);
  const B = A.map(lendemain);
  const troue = corpus.filter(d => !B.includes(d) || A.indexOf(lendemainInverse(d)) % 2 === 0);
  // La moitié des lendemains manquent au corpus : on compte sur ce qui reste, et ça tient encore.
  const s = sensDuLien(A, B, troue);
  assert.ok(s.de.sur < A.length);
  assert.equal(s.de.apres, s.de.sur);
  assert.equal(s.sens, 'de');
});
function lendemainInverse(d) { const t = new Date(`${d}T00:00:00Z`); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); }

test('les liens de la carte reçoivent leur appui, et un nom inconnu reste sans', () => {
  const A = corpus.filter((_, i) => i % 6 === 0), B = A.map(lendemain);
  const carte = {
    noeuds: [{ nom: 'la porte', jours: A }, { nom: 'la chute', jours: B.map(d => ({ d, e: null })) }],
    liens: [{ de: 'la porte', vers: 'la chute', quoi: 'précède', force: 2 },
            { de: 'la chute', vers: 'fantôme', quoi: 'x', force: 1 }]
  };
  const liens = sensDesLiens(carte, corpus);
  assert.equal(liens[0].appui.sens, 'de');
  assert.equal(liens[0].quoi, 'précède');
  assert.equal(liens[1].appui, null);
});
