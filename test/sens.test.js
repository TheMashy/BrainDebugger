/**
 * Le sens d'un lien de la toile, compté sur les journées : une flèche ne se
 * pose que si « ceci, et cela la fois d'après » tient contre le reste, et pas
 * dans l'autre sens.
 *
 * LE PIÈGE QUE CES TESTS TIENNENT : « la fois d'après » n'est pas le lendemain.
 * Quelqu'un qui écrit un jour sur douze n'a presque aucune paire de journées
 * civilement consécutives — la première version comptait sur le lendemain et
 * ne posait jamais une flèche, sur aucun journal réel.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-sens-')), 'test.db');
const { sensDuLien, sensDesLiens, suiteDe, lendemain, SEUILS_SENS } = await import('../server/sens.js');

const jour = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const quotidien = Array.from({ length: 120 }, (_, i) => jour(i));
/** Un journal comme le vrai : cent quarante journées éparses sur quatre ans. */
const epars = (() => {
  let g = 12345; const rnd = () => ((g = (g * 1103515245 + 12345) >>> 0) / 4294967296);
  const out = []; for (let i = 0; i < 1709; i++) if (rnd() < 144 / 1709) out.push(jour(i));
  return out;
})();

test('le lendemain passe le mois, l’année et le 29 février', () => {
  assert.equal(lendemain('2026-01-31'), '2026-02-01');
  assert.equal(lendemain('2026-12-31'), '2027-01-01');
  assert.equal(lendemain('2028-02-28'), '2028-02-29');
});

test('sur un journal quotidien, « la fois d’après » EST le lendemain', () => {
  const s = suiteDe(quotidien);
  assert.equal(s.size, quotidien.length - 1);
  for (const [d, apres] of s) assert.equal(apres, lendemain(d));
});

test('sur un journal épars, la suite garde presque toutes les journées', () => {
  /*
   * C'EST LE TEST QUI DIT POURQUOI LA PREMIÈRE VERSION NE MARCHAIT PAS.
   * Le lendemain civil ne donne qu'une dizaine de paires sur cent quarante
   * journées : il n'y a rien à compter. La fois d'après en donne plus de cent.
   */
  const ecrits = new Set(epars);
  const lendemains = epars.filter(d => ecrits.has(lendemain(d))).length;
  const suite = suiteDe(epars);
  assert.ok(lendemains < 20, `${lendemains} lendemains civils — l'hypothèse de départ`);
  assert.ok(suite.size > epars.length * 0.8,
            `${suite.size} paires sur ${epars.length} journées : la suite doit rester exploitable`);
});

test('un écart de plus d’un mois n’est pas une suite', () => {
  const trous = ['2026-01-01', '2026-01-05', '2026-04-20', '2026-04-21'];
  const s = suiteDe(trous);
  assert.deepEqual([...s.keys()], ['2026-01-01', '2026-04-20']);
  assert.equal(s.get('2026-01-05'), undefined, 'trois mois plus tard, ce n’est plus « la fois d’après »');
  assert.equal(suiteDe(trous, 200).size, 3, 'la borne est un réglage, pas une loi');
});

test('B qui suit toujours A, jamais les autres fois : flèche de A vers B', () => {
  const suite = suiteDe(epars);
  const A = epars.filter((_, i) => i % 8 === 0);
  const B = [...suite].filter(([d]) => A.includes(d)).map(([, s]) => s);
  const s = sensDuLien(A, B, epars);
  assert.equal(s.sens, 'de');
  assert.equal(s.de.apres, s.de.sur, 'chaque journée de A est suivie de B');
  assert.ok(s.de.apres >= SEUILS_SENS.min_apres);
  assert.ok(s.de.p < 0.01, `p de ${s.de.p}`);
});

test('le même compte, à l’envers : flèche vers A', () => {
  const suite = suiteDe(epars);
  const B = epars.filter((_, i) => i % 8 === 0);
  const A = [...suite].filter(([d]) => B.includes(d)).map(([, s]) => s);
  assert.equal(sensDuLien(A, B, epars).sens, 'vers');
});

test('deux choses qui s’enchaînent dans les deux sens ne prennent pas de pointe', () => {
  const A = quotidien.filter((_, i) => i % 2 === 0), B = quotidien.filter((_, i) => i % 2 === 1);
  assert.equal(sensDuLien(A, B, quotidien).sens, 'deux');
});

test('deux choses indépendantes : pas de sens, quoi qu’en dise le verbe', () => {
  const C = epars.filter((_, i) => i % 9 === 4), D = epars.filter((_, i) => i % 7 === 2);
  const s = sensDuLien(C, D, epars);
  assert.equal(s.sens, null, `sens ${s.sens} trouvé sur du hasard (p ${s.de.p.toFixed(3)} / ${s.vers.p.toFixed(3)})`);
});

test('sous le plancher de fois, rien ne se pose — même parfait', () => {
  // Deux enchaînements parfaits restent deux enchaînements : au-dessous de
  // `min_apres`, on ne pose pas de pointe, quel que soit le p.
  const suite = suiteDe(epars);
  const A = epars.filter((_, i) => i % 90 === 0);
  const B = [...suite].filter(([d]) => A.includes(d)).map(([, s]) => s);
  assert.ok(A.length < SEUILS_SENS.min_apres, `${A.length} journées`);
  const s = sensDuLien(A, B, epars);
  assert.equal(s.de.apres, s.de.sur, 'l’enchaînement est pourtant parfait');
  assert.equal(s.sens, null);
});

test('un nœud sans journée ne fait pas planter le compte', () => {
  const s = sensDuLien([], epars.slice(0, 10), epars);
  assert.equal(s.sens, null);
  assert.equal(s.de.sur, 0);
});

test('les liens de la carte reçoivent leur appui, et un nom inconnu reste sans', () => {
  const suite = suiteDe(epars);
  const A = epars.filter((_, i) => i % 8 === 0);
  const B = [...suite].filter(([d]) => A.includes(d)).map(([, s]) => s);
  const carte = {
    noeuds: [{ nom: 'la porte', jours: A },
             { nom: 'la chute', jours: B.map(d => ({ d, e: null })) }],   // déjà décoré : {d, e}
    liens: [{ de: 'la porte', vers: 'la chute', quoi: 'précède', force: 2 },
            { de: 'la chute', vers: 'fantôme', quoi: 'x', force: 1 }]
  };
  const liens = sensDesLiens(carte, epars);
  assert.equal(liens[0].appui.sens, 'de');
  assert.equal(liens[0].quoi, 'précède', 'le verbe du modèle reste');
  assert.equal(liens[1].appui, null);
});

test('sans corpus, aucun lien ne prend de pointe', () => {
  const carte = { noeuds: [{ nom: 'a', jours: ['2026-01-01'] }, { nom: 'b', jours: ['2026-01-02'] }],
                  liens: [{ de: 'a', vers: 'b', quoi: 'précède', force: 3 }] };
  assert.equal(sensDesLiens(carte, []).appui, undefined);
  assert.equal(sensDesLiens(carte, [])[0].appui.sens, null);
});
