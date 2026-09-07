/**
 * LA BANDE DES JOURS. Un rond de la carte n'est rien d'autre qu'une liste de
 * dates ; la bande le montre. Ce qui est testé ici, c'est le seul calcul
 * qu'elle fait elle-même — « le jour d'écriture suivant » — parce que c'est
 * exactement celui qui s'était trompé sur les flèches (le lendemain civil
 * n'existe presque pas dans un journal écrit un jour sur douze).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pairesDuLien, joursDe, teinteNote, COUCHES, SYMBOLES, symbole, bandeCouches } from '../web/bande.js';

const jour = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

test('« après » suit le journal, pas le calendrier', () => {
  // Écrit les jours 0, 4, 5, 12 : après le 0 vient le 4, pas le 1.
  const dates = [0, 4, 5, 12].map(jour);
  const paires = pairesDuLien([jour(0), jour(4)], [jour(4), jour(5)], dates);
  assert.deepEqual(paires, [[jour(0), jour(4)], [jour(4), jour(5)]]);
});

test('un trou de plus d’un mois n’est pas « la fois d’après »', () => {
  const dates = [0, 45].map(jour);
  assert.deepEqual(pairesDuLien([jour(0)], [jour(45)], dates), []);
  assert.equal(pairesDuLien([jour(0)], [jour(45)], dates, 60).length, 1, 'la borne est un réglage');
});

test('le dernier jour n’a pas de suite, et ça ne plante pas', () => {
  const dates = [0, 3].map(jour);
  assert.deepEqual(pairesDuLien([jour(3)], [jour(0)], dates), []);
});

test('une date hors de la fenêtre est ignorée, pas devinée', () => {
  const dates = [10, 11].map(jour);
  assert.deepEqual(pairesDuLien([jour(2)], [jour(11)], dates), []);
});

test('les jours d’un nœud se lisent décorés ou bruts', () => {
  assert.deepEqual(joursDe({ jours: ['2026-01-01', '2026-01-05'] }), ['2026-01-01', '2026-01-05']);
  assert.deepEqual(joursDe({ jours: [{ d: '2026-01-01', e: 2 }, { d: '2026-01-05', e: null }] }),
                   ['2026-01-01', '2026-01-05']);
  assert.deepEqual(joursDe({ jours: [null, { e: 1 }] }), [], 'rien d’inventé sur une entrée vide');
  assert.deepEqual(joursDe(null), []);
});

test('la teinte suit l’échelle du produit, et une note absente n’en prend aucune', () => {
  assert.match(teinteNote(0), /^rgb\(165,18,24\)$/);
  assert.match(teinteNote(10), /^rgb\(55,128,200\)$/);
  assert.equal(teinteNote(null), 'var(--line)');
  assert.equal(teinteNote(undefined), 'var(--line)');
  assert.equal(teinteNote(NaN), 'var(--line)');
  assert.match(teinteNote(-3), /^rgb\(165,18,24\)$/, 'hors échelle, on borne');
});

test('chaque couche a son symbole, et chaque symbole est dessiné', () => {
  for (const c of COUCHES) {
    assert.ok(SYMBOLES[c.sym], `${c.id} : symbole « ${c.sym} » introuvable`);
    assert.match(symbole(c.sym), /^<svg[\s\S]+<\/svg>$/);
  }
  assert.equal(symbole('inconnu').includes('undefined'), false, 'un symbole absent ne rend pas « undefined »');
});

/* Le mode lecture pose ses étiquettes en pile, une ligne chacune. C'est ce qui
   remplace le placement « au mieux » d'avant, où quatre phrases finissaient par
   se croiser sur la bande dès que les quatre couches avaient quelque chose à
   dire. Une seule règle à tenir : deux étiquettes ne partagent jamais leur ligne. */
const bancCouches = () => {
  const dates = Array.from({ length: 40 }, (_, i) => jour(i * 2));
  const carte = {
    noeuds: [{ nom: 'la boule', jours: dates.filter((_, i) => i % 3 === 0) },
             { nom: 'sortir', jours: dates.filter((_, i) => i % 3 === 2) }],
    liens: [{ de: 'sortir', vers: 'la boule',
              appui: { sens: 'de', de: { apres: 12, sur: 13 }, vers: { apres: 0, sur: 13 } } }]
  };
  const fonct = { series: { dates, note: dates.map((_, i) => i % 11) },
                  items: [{ type: 'bascule', date: dates[20] }],
                  surveilles: { jours: dates.filter((_, i) => i % 9 === 1).map(d => ({ date: d })) } };
  return { carte, fonct, schemas: [{ nom: 'la porte', jours: dates.filter((_, i) => i % 7 === 3) }] };
};

test('les étiquettes du mode lecture ne se croisent jamais', () => {
  const { carte, fonct, schemas } = bancCouches();
  const svg = bandeCouches(carte, fonct, schemas);
  const y = [...svg.matchAll(/translate\([\d.]+ ([\d.]+)\)/g)].map(m => Number(m[1]));
  assert.equal(y.length, 6, 'les six couches ont de quoi dire sur ce banc');
  assert.equal(new Set(y).size, y.length, 'deux étiquettes partagent une ligne');
  const trie = [...y].sort((a, b) => a - b);
  for (let i = 1; i < trie.length; i++)
    assert.ok(trie[i] - trie[i - 1] >= 16, `lignes trop serrées : ${trie[i - 1]} et ${trie[i]}`);
  const haut = Number(svg.match(/viewBox="0 0 \d+ ([\d.]+)"/)[1]);
  assert.ok(haut > trie.at(-1), 'la dernière étiquette dépasse du cadre');
});

test('une couche sans rien à marquer ne s’annonce pas', () => {
  const { carte, fonct } = bancCouches();
  const svg = bandeCouches(carte, { ...fonct, items: [], surveilles: { jours: [] } }, []);
  const ids = [...svg.matchAll(/data-couche="([a-z]+)"/g)].map(m => m[1]);
  assert.deepEqual(ids, ['jours', 'revient', 'apres'],
                   'sans cycle, sans bascule et sans veille, ces trois couches restent muettes');
});

test('isoler une couche éteint les autres, sans en retirer aucune', () => {
  const { carte, fonct, schemas } = bancCouches();
  const svg = bandeCouches(carte, fonct, schemas, 'apres');
  assert.match(svg, /class="bco" data-couche="apres"/);
  assert.match(svg, /class="bco eteint" data-couche="jours"/);
  assert.equal((svg.match(/data-couche=/g) ?? []).length, 6, 'rien ne disparaît, tout se tait');
});
