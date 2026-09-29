/**
 * LES RELEVÉS QUE L'ÉCRAN N'AFFICHE PAS ENCORE.
 *
 * /api/moi (resume.serie), /api/remarque (bouge) et la carte (faits) ne sont
 * lus par aucun écran aujourd'hui. Le jour où un écran ou Jarvis les rebranche,
 * ils ne doivent afficher ni une série à 0 sur quatre ans de notes, ni un
 * « mouvement » entre deux ensembles qui sont presque les mêmes, ni un mot
 * choisi par le hasard.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-latents-')), 'test.db');

const { upsertUser, setNote, addMessage } = await import('../server/db.js');
const { addDays } = await import('../server/stats.js');
const { buildGraph } = await import('../server/graph.js');
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

const MOTS = ['jardin', 'piano', 'cuisine', 'voisin', 'musique', 'bureau', 'train',
              'lecture', 'marche', 'peinture', 'riviere', 'atelier'];
const phrase = r => Array.from({ length: 3 }, () => MOTS[Math.floor(r() * MOTS.length)]).join(' et ');

test('la série de /api/moi est celle de /api/state', () => {
  const t = api.today();
  const A = 'serie-a', B = 'serie-b';
  upsertUser({ id: A, username: A });
  upsertUser({ id: B, username: B });
  for (let k = 0; k < 10; k++) setNote(addDays(t, -k), 6, A);
  // La dernière note date de trois jours : les deux valent 0.
  for (let k = 3; k < 13; k++) setNote(addDays(t, -k), 6, B);
  for (const U of [A, B]) {
    const moi = api.routes['GET /api/moi']({ userId: U });
    const st = api.routes['GET /api/state']({ userId: U, query: {} });
    assert.equal(moi.resume.serie, st.stats.streak, U);
  }
  assert.equal(api.routes['GET /api/moi']({ userId: A }).resume.serie, 10);
  assert.equal(api.routes['GET /api/moi']({ userId: B }).resume.serie, 0);
});

test('« ce qui bouge » ne compare pas les 90 derniers jours à un tout qui les contient', () => {
  const t = api.today();
  const U = 'bouge-emboite';
  upsertUser({ id: U, username: U });
  const r = alea(2);
  // 44 journées écrites, dont 41 dans les 90 derniers jours.
  const jours = [...[400, 300, 200].map(k => addDays(t, -k)),
                 ...Array.from({ length: 41 }, (_, k) => addDays(t, -(2 + 2 * k)))];
  for (const d of jours) {
    setNote(d, 6, U);
    addMessage({ ts: `${d}T10:00:00.000Z`, date: d, role: 'user', text: phrase(r), userId: U });
  }
  const rem = api.routes['GET /api/remarque']({ query: {}, userId: U });
  assert.equal(rem.assez, true);
  assert.deepEqual(rem.bouge, []);
});

test('« ce qui bouge » rend quelque chose quand les deux périodes ont de quoi parler', () => {
  const t = api.today();
  const U = 'bouge-disjoint';
  upsertUser({ id: U, username: U });
  const r = alea(3);
  const avant = Array.from({ length: 20 }, (_, k) => addDays(t, -(120 + 3 * k)));
  const recent = Array.from({ length: 20 }, (_, k) => addDays(t, -(1 + 3 * k)));
  for (const d of [...avant, ...recent]) {
    setNote(d, 6, U);
    addMessage({ ts: `${d}T10:00:00.000Z`, date: d, role: 'user', text: phrase(r), userId: U });
  }
  const rem = api.routes['GET /api/remarque']({ query: {}, userId: U });
  assert.ok(rem.bouge.length > 0);
  for (const b of rem.bouge) {
    assert.equal(b.recentSur, 20);
    assert.equal(b.avantSur, 20);
  }
});

/* ------------------------------ la carte ------------------------------ */

const jour = i => addDays('2025-01-01', i);

test('sur des notes sans lien avec les mots, la carte ne met aucun mot en avant', () => {
  // Le maximum de douze moyennes s'écarte toujours de quelque chose : ce n'est
  // pas un fait. Sur plusieurs graines, aucun écart ne doit sortir.
  let publies = 0;
  for (let g = 1; g <= 10; g++) {
    const r = alea(100 + g);
    const rows = Array.from({ length: 44 }, (_, i) => ({
      date: jour(i), note: 3 + Math.floor(r() * 6), text: phrase(r)
    }));
    publies += buildGraph(rows, []).faits.filter(f => f.type.startsWith('ecart')).length;
  }
  assert.ok(publies <= 1, `${publies} mots mis en avant sur du hasard`);
});

test('un mot qui revient vraiment sur les journées hautes est encore relevé', () => {
  const r = alea(7);
  const rows = Array.from({ length: 44 }, (_, i) => {
    const haut = i % 4 === 0;
    return { date: jour(i), note: haut ? 9 : 4 + Math.floor(r() * 3),
             text: `${phrase(r)}${haut ? ' et violoncelle' : ''}` };
  });
  const G = buildGraph(rows, []);
  const f = G.faits.find(x => x.type === 'ecart-haut');
  assert.ok(f, 'le mot des journées hautes n’est pas ressorti');
  assert.equal(f.mot, 'violoncelle');
});

test('la moyenne d’un groupe est celle de ses journées, chacune comptée une fois', () => {
  const r = alea(9);
  const rows = Array.from({ length: 44 }, (_, i) => ({
    date: jour(i), note: 2 + Math.floor(r() * 8), text: phrase(r)
  }));
  const G = buildGraph(rows, []);
  for (const g of G.amas) {
    const mots = new Set(G.noeuds.filter(n => n.amas === g.id).map(n => n.mot));
    const dedans = rows.filter(x => MOTS.some(m => mots.has(m) && x.text.includes(m)));
    const attendu = Math.round(dedans.reduce((a, x) => a + x.note, 0) / dedans.length * 100) / 100;
    assert.equal(g.note, attendu, g.nom);
  }
});
