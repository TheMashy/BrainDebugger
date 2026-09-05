/*
 * LES JOURS À SURVEILLER, CE QUI REVIENT AUTOUR : des comptes contre les autres
 * jours, jamais des causes, et « net » seulement quand Fisher le permet.
 * La veille est remplacée par une fonction à nous : ce qu'on teste, c'est le
 * comptage, pas la détection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-surv-')), 'test.db');
const { joursSurveilles, MOTS_INTERDITS } = await import('../server/fonctionnements.js');

const dateDe = t => new Date(Date.UTC(2026, 0, 5 + t)).toISOString().slice(0, 10);   // lundi
const table = (T, f) => {
  const jours = [];
  for (let t = 0; t < T; t++) { const dow = t % 7; jours.push({ date: dateDe(t), note: null, sommeil_h: null, coucher: null, lever: null, ecran_min: null, absolus: null, dow, we: dow >= 5 ? 1 : 0, ...f(t) }); }
  return { de: dateDe(0), a: dateDe(T - 1), variables: ['note', 'sommeil_h', 'coucher', 'lever', 'ecran_min', 'absolus'], jours };
};
const veilleDe = (rouges, genre = 'blessure') => (date) => rouges.has(date) ? { niveau: 'rouge', motifs: [{ genre }] } : null;
const messagesDe = (h) => (date) => [{ role: 'user', text: 'x', ts: `${date}T${String(h).padStart(2, '0')}:10:00Z` }];
const niveauOui = () => ({ niveau: 'rouge', motifs: [{ genre: 'blessure' }] });

test('moins de trois jours : rien à compter, et on le dit', () => {
  const T = table(60, t => ({ note: 6 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(new Set([dateDe(10), dateDe(30)])), messages: messagesDe(23), niveau: niveauOui });
  assert.equal(r.n, 2); assert.equal(r.phrases.length, 0); assert.match(r.manque, /il en faut 3/);
});

test('la nuit courte qui revient avant les jours à surveiller est comptée, et nette quand le hasard ne l’explique pas', () => {
  const rouges = new Set([10, 25, 40, 55, 70, 85].map(dateDe));
  // nuit courte (5 h) les jours rouges, 7,5 h les autres — sauf dix nuits courtes ailleurs
  const T = table(120, t => ({ note: 6, sommeil_h: rouges.has(dateDe(t)) || t % 11 === 3 ? 5 : 7.5 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: messagesDe(23), niveau: niveauOui });
  const p = r.phrases.find(x => x.cle === 'nuit_courte');
  assert.ok(p, 'la phrase existe');
  assert.equal(p.appui.n, 6); assert.equal(p.appui.sur, 6);
  assert.equal(p.appui.net, true);
  assert.doesNotMatch(p.phrase, /Trop peu/);
  assert.match(p.phrase, /6 fois sur 6/);
});

test('un compte que le hasard explique n’est pas « net » et le dit', () => {
  const rouges = new Set([10, 25, 40].map(dateDe));
  const T = table(60, t => ({ note: 6, sommeil_h: t % 2 ? 5 : 7.5 }));   // une nuit sur deux courte, partout
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: messagesDe(14), niveau: niveauOui });
  const p = r.phrases.find(x => x.cle === 'nuit_courte');
  assert.ok(p); assert.equal(p.appui.net, false); assert.match(p.phrase, /Trop peu pour trancher/);
});

test('l’heure, le rythme et les grappes se comptent ; un souvenir évoqué n’est pas un jour à surveiller', () => {
  const rouges = new Set([10, 11, 12, 40, 70].map(dateDe));
  const T = table(90, t => ({ note: 6 }));
  const veille = d => rouges.has(d) ? { niveau: 'rouge', motifs: [{ genre: 'blessure' }] } : d === dateDe(50) ? { niveau: 'jaune', motifs: [{ genre: 'evoque_passe' }] } : null;
  const r = joursSurveilles(T, 'u', { veille, messages: messagesDe(23), niveau: niveauOui });
  assert.equal(r.n, 5, 'le souvenir évoqué du jour 50 ne compte pas');
  assert.equal(r.grappes, 1);
  const h = r.phrases.find(x => x.cle === 'heure');
  assert.ok(h); assert.equal(h.appui.n, 5);
  assert.match(r.rythme, /5 jours à surveiller sur 90 jours/);
});

test('le lendemain : la note qui remonte est dite en médiane', () => {
  const rouges = new Set([10, 25, 40, 55].map(dateDe));
  const T = table(70, t => ({ note: rouges.has(dateDe(t)) ? 2 : 6 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: messagesDe(23), niveau: niveauOui });
  const l = r.phrases.find(x => x.cle === 'lendemain');
  assert.ok(l); assert.equal(l.appui.mediane, 4); assert.match(l.phrase, /\+4/);
});

test('aucune phrase de la machine ne porte un mot interdit', () => {
  const rouges = new Set([10, 25, 40, 55, 70, 85].map(dateDe));
  const T = table(120, t => ({ note: rouges.has(dateDe(t)) ? 2 : 6, sommeil_h: rouges.has(dateDe(t)) ? 5 : 7.5, coucher: 23.5, absolus: rouges.has(dateDe(t)) ? 12 : 3 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: messagesDe(23), niveau: niveauOui });
  for (const p of r.phrases) assert.doesNotMatch(p.phrase, MOTS_INTERDITS, p.phrase);
  assert.doesNotMatch(r.rythme, MOTS_INTERDITS);
});
