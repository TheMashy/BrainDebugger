/**
 * LA RÉFÉRENCE DES COULEURS, ET CELLE DES ÉPISODES.
 *
 * La médiane de notes entières saute d'un point en un jour : un même 5 changeait
 * de couleur sans que rien n'ait changé dans la vie de personne, et la frise
 * comparait chaque période à l'année qui la précédait — une période dure posée
 * après une année basse sortait la plus claire de toutes.
 *
 * Les couleurs lisent désormais `ecart` (référence lissée) ; les épisodes, le
 * plancher, l'énergie et le compagnon gardent `reference` (médiane entière).
 * Ces tests tiennent les deux bouts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-reflisse-')), 'test.db');

const { upsertUser, setNote, addEvent } = await import('../server/db.js');
const { buildSeries, medianeLisse, median, episodes, addDays } = await import('../server/stats.js');
const api = await import('../server/api.js');

function alea(graine) {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const jour = i => addDays('2022-01-01', i);

test('la médiane lissée se place dans la classe médiane', () => {
  assert.equal(medianeLisse([5, 5, 6, 6]), 5.5);
  assert.equal(medianeLisse([6, 6, 6]), 6);
  assert.equal(medianeLisse([]), null);
  // 18 % sous 6, 40 % à 6, 42 % au-dessus : médiane entière 6, lissée 6,3.
  const xs = [...Array(18).fill(5), ...Array(40).fill(6), ...Array(42).fill(7)];
  assert.equal(median(xs), 6);
  assert.ok(Math.abs(medianeLisse(xs) - 6.3) < 1e-9);
});

test('moitié de 5, moitié de 6 : la référence des couleurs ne saute plus', () => {
  const r = alea(4);
  // Autour de 50/50, en glissant lentement de 45 % à 55 % de 5 : la part des
  // 6 passe sous la moitié en cours de route.
  const rows = Array.from({ length: 700 }, (_, i) => ({ date: jour(i), note: r() < 0.45 + 0.1 * i / 700 ? 5 : 6 }));
  const s = buildSeries(rows);
  let sautLisse = 0, sautEntier = 0;
  for (let i = 1; i < s.length; i++) {
    if (s[i].referencePoints < 60 || s[i - 1].referencePoints < 60) continue;
    sautLisse = Math.max(sautLisse, Math.abs(s[i].referenceLisse - s[i - 1].referenceLisse));
    sautEntier = Math.max(sautEntier, Math.abs(s[i].reference - s[i - 1].reference));
    assert.ok(Math.abs(s[i].ecart - (s[i].note - s[i].referenceLisse)) < 2e-3);
  }
  assert.ok(sautLisse <= 0.25, `la référence lissée a bougé de ${sautLisse} en un jour`);
  // Le décor produit bien le défaut qu'on corrige : la médiane entière saute.
  assert.ok(sautEntier >= 0.5, `le décor ne fait pas sauter la médiane entière (${sautEntier})`);
});

test('les épisodes et le plancher gardent la médiane entière', () => {
  // Médiane entière 6, lissée 6,3. Avec la lissée, « revenu à sa référence »
  // exigerait un 7 : des retours rallongés, affichés un soir bas.
  const base = [...Array(18).fill(5), ...Array(40).fill(6), ...Array(42).fill(7)];
  const r = alea(8);
  const melange = () => base.slice().sort(() => r() - 0.5);
  const notes = [...melange(), ...melange(), ...melange(), ...melange(), 2, 6, 6, 7];
  const s = buildSeries(notes.map((note, i) => ({ date: jour(i), note })));
  const fin = s.at(-1);
  assert.equal(fin.reference, 6);
  assert.ok(Math.abs(fin.referenceLisse - 6.3) < 0.05, `référence lissée ${fin.referenceLisse}`);
  const e = episodes(s, 2, { sustain: 2 });
  const dernier = e.episodes.at(-1);
  assert.equal(dernier.start, jour(notes.length - 4));
  assert.equal(dernier.days, 1, 'un 6 le lendemain doit compter comme un retour');
  // Plancher relatif : seuil = référence − 3, sur la médiane ENTIÈRE.
  const f = api.floorState(3, fin.reference, { floorMode: 'relative', floor: 2 });
  assert.equal(f.floored, true);
  assert.equal(f.threshold, 3);
});

test('la frise compare toutes les périodes à la même base', () => {
  // Une année basse (5), puis A : moyenne 6, dont 25 journées à 3 ou moins,
  // puis B : moyenne 6,5, dont 5 journées basses. Contre l'année précédente,
  // A sortait plus claire que B.
  const U = 'frise-base';
  upsertUser({ id: U, username: U });
  const r = alea(12);
  const tirer = (moy, bas, n) => {
    const xs = Array.from({ length: n }, (_, i) => (i < bas ? 2 + Math.floor(r() * 2) : null));
    const reste = n - bas;
    const cible = moy * n - xs.filter(x => x !== null).reduce((a, b) => a + b, 0);
    const haut = Math.round(cible / reste);
    return xs.map(x => x ?? haut).sort(() => r() - 0.5);
  };
  const annee = Array.from({ length: 365 }, () => (r() < 0.5 ? 5 : r() < 0.5 ? 4 : 6));
  const A = tirer(6, 25, 180), B = tirer(6.5, 5, 180);
  const notes = [...annee, ...A, ...B];
  notes.forEach((n, i) => setNote(jour(i), n, U));
  addEvent({ date: jour(365), fin: jour(365 + 179), label: 'période A', userId: U });
  addEvent({ date: jour(545), fin: jour(545 + 179), label: 'période B', userId: U });
  const fr = api.routes['GET /api/frise']({ userId: U });
  const med = p => {
    const ds = p.jours.map(x => x.delta).filter(d => d !== null).sort((a, b) => a - b);
    return ds[Math.floor(ds.length / 2)];
  };
  const pa = fr.periodes.find(p => p.label === 'période A');
  const pb = fr.periodes.find(p => p.label === 'période B');
  assert.ok(med(pa) <= med(pb), `A (${med(pa)}) plus claire que B (${med(pb)})`);
  // Et les points se lisent contre la même base que les barres.
  const base = medianeLisse(notes.slice().sort((a, b) => a - b));
  assert.ok(Math.abs(pa.jours[0].delta - (notes[365] - base)) < 1e-3);
});
