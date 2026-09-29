/*
 * LES FONCTIONNEMENTS, ÉPROUVÉS SUR LES PATIENTS DU BANC.
 *
 * Le banc (tools/banc-approches) fabrique des journaux synthétiques aux
 * fonctionnements plantés et connus. On les passe dans le moteur de la carte
 * comme s'ils étaient une vraie base, et on vérifie trois choses : ce qui est
 * planté et retrouvable est retrouvé ; le témoin ne se voit pas inventer une
 * vie ; et AUCUNE phrase ne nomme un trouble -- jamais, quel que soit le profil.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generer } from '../tools/banc-approches/generateur.mjs';
import { analyserTable, absolusDe, MOTS_INTERDITS, SEUILS, laMachineDit } from '../server/fonctionnements.js';

const dateDe = t => { const d = new Date(Date.UTC(2026, 0, 5 + t)); return d.toISOString().slice(0, 10); };   // 2026-01-05 est un lundi
const enTable = s => ({
  de: dateDe(0), a: dateDe(s.T - 1), variables: ['note', 'sommeil_h', 'coucher', 'lever', 'ecran_min', 'absolus'],
  jours: s.jours.map((j, t) => ({ date: dateDe(t), note: j.humeur, sommeil_h: j.sommeil_h, coucher: j.coucher, lever: null, ecran_min: j.ecran_min,
    absolus: j.absolus, absolus_mots: j.absolus != null ? ['toujours', 'rien'] : [], dow: t % 7, we: t % 7 >= 5 ? 1 : 0, sortie: (t % 7 === 4 || t % 7 === 5) ? 1 : 0 })),
});
const patient = (profil, index = 0) => analyserTable(enTable(generer({ profil, famille: 'test-1', T: 180, manquants: 0.15, index })));
const PROFILS = ['temoin', 'depression', 'anxiete', 'bipolarite', 'tdah', 'autisme', 'derealisation'];

test('aucune phrase ne nomme un trouble, sur aucun profil, sur trois patients chacun', () => {
  for (const p of PROFILS) for (let i = 0; i < 3; i++) {
    const r = patient(p, i);
    for (const it of r.items) assert.ok(!MOTS_INTERDITS.test(laMachineDit(it.phrase)), `${p}#${i} : ${it.phrase}`);
    for (const e of r.exclus) assert.ok(!MOTS_INTERDITS.test(laMachineDit(e.raison)), e.raison);
    for (const m of r.manques) assert.ok(!MOTS_INTERDITS.test(laMachineDit(m)), m);
  }
});

test('les bascules de sommeil d’un profil à régimes sont retrouvées, datées à moins de 6 jours', () => {
  let trouves = 0, plantes = 0;
  for (let i = 0; i < 3; i++) {
    const s = generer({ profil: 'bipolarite', famille: 'test-1', T: 180, manquants: 0.15, index: i });
    const r = analyserTable(enTable(s));
    const debuts = s.episodes.map(e => e.t0);
    plantes += debuts.length;
    for (const t0 of debuts) if (r.items.some(it => it.type === 'bascule' && it.variable === 'sommeil_h' && Math.abs(new Date(it.date) - new Date(dateDe(t0))) / 864e5 <= 6)) trouves++;
  }
  assert.ok(trouves >= plantes * 0.6, `${trouves}/${plantes} débuts retrouvés par le sommeil`);
});

test('la régularité du coucher classe le profil irrégulier et le profil régulier dans le bon sens', () => {
  const tdah = patient('tdah').items.find(i => i.type === 'regularite');
  const autisme = patient('autisme').items.find(i => i.type === 'regularite');
  assert.equal(tdah?.classe, 'variable');
  assert.equal(autisme?.classe, 'stable');
});

test('l’inertie de la note : haute chez le profil inerte, basse chez le profil qui repart de zéro', () => {
  assert.equal(patient('depression').items.find(i => i.type === 'inertie')?.classe, 'haute');
  assert.equal(patient('tdah').items.find(i => i.type === 'inertie')?.classe, 'basse');
});

test('les mots absolus suivent la note là où c’est planté, et pas ailleurs', () => {
  assert.ok(patient('depression').items.some(i => i.type === 'mots'), 'planté : doit se voir');
  assert.ok(!patient('temoin').items.some(i => i.type === 'mots'), 'témoin : rien à voir');
  assert.ok(!patient('tdah').items.some(i => i.type === 'mots'), 'non planté : rien à voir');
});

test('le témoin ne se voit pas inventer une vie : au plus deux items, et jamais un lien ni une inertie', () => {
  for (let i = 0; i < 3; i++) {
    const r = patient('temoin', i);
    const graves = r.items.filter(it => ['lien', 'inertie'].includes(it.type));
    assert.equal(graves.length, 0, `témoin#${i} : ${graves.map(g => g.phrase).join(' | ')}`);
    assert.ok(r.items.filter(it => it.type === 'bascule').length <= 1, `témoin#${i} : trop de bascules`);
  }
});

test('un lien se dit par un comptage vérifiable, avec les journées qui l’appuient', () => {
  const r = patient('tdah');
  const l = r.items.find(i => i.type === 'lien');
  assert.ok(l, 'le profil TDAH plante coucher → sommeil');
  assert.match(l.phrase, /\d+ fois sur \d+ — contre \d+ sur \d+/);
  assert.ok(Array.isArray(l.jours) && l.jours.length >= 3);
  assert.ok(l.appui.bas.n / l.appui.bas.sur - l.appui.haut.n / l.appui.haut.sur >= 0.15);
});

test('trop peu de données : rien n’est affirmé, et les manques se disent', () => {
  const s = generer({ profil: 'depression', famille: 'test-1', T: 60, manquants: 0.35, index: 0 });
  const T = enTable(s); T.jours = T.jours.slice(0, 20);
  const r = analyserTable(T);
  assert.equal(r.assez, false);
  assert.ok(r.manques.length >= 2);
  assert.equal(r.items.filter(i => ['lien', 'inertie', 'mots'].includes(i.type)).length, 0);
});

test('la part de mots absolus se compte sur le texte, pas sur les mots creux', () => {
  assert.equal(absolusDe('trop court'), null);
  const long = 'je crois que rien ne change et que tout est toujours pareil, ' + 'mais bon je continue et je fais ce que je peux chaque jour '.repeat(6);
  const a = absolusDe(long);
  assert.ok(a && a.mots >= SEUILS.mots.min_mots && a.taux > 0);
  assert.ok(a.vus.includes('toujours') || a.vus.includes('chaque'));
});

/* ------------------------------------------------------------------ */
/* L'écran vide ne dit que ce qui a été compté                            */
/* ------------------------------------------------------------------ */
/* `rienTenu` est une fonction de la vue (web/app.js) : on l'extrait telle
   quelle, avec la table qui la précède, pour tester le texte qui part à l'écran. */
const rienTenu = (() => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const i = app.indexOf('const RIEN_DIT = ['), j = app.indexOf('\nfunction fonctionnementsMarkup(', i);
  assert.ok(i > 0 && j > i, 'rienTenu a été déplacée ou renommée');
  return new Function(`${app.slice(i, j)}; return rienTenu;`)();
})();

test('180 notes et aucun coucher : la régularité n’est pas « calculée », et la ligne vide n’affirme rien du coucher', () => {
  const r0 = mulberry(4242);
  const T = enTable({ T: 180, jours: Array.from({ length: 180 }, () => ({ humeur: Math.max(1, Math.min(10, Math.round(6 + 1.1 * (r0() + r0() + r0() - 1.5) * 2))), sommeil_h: null, coucher: null, ecran_min: null, absolus: null })) });
  const R = analyserTable(T);
  assert.equal(R.periode.couchers, 0);
  assert.equal(R.cherche.regularite.calcule, false);
  assert.match(R.cherche.regularite.raison, /0 coucher sur 30/);
  assert.equal(R.cherche.bascule_sommeil.calcule, false);
  assert.equal(R.cherche.bascule_note.calcule, true);
  assert.equal(R.cherche.inertie.calcule, true);
  const texte = rienTenu(R.cherche);
  const [affirme, pasVu] = texte.split('Pas encore regardé');
  assert.doesNotMatch(affirme, /coucher|sommeil/, 'ce qui est dit « sans rien de net » ne parle que de ce qui a été compté');
  assert.match(pasVu ?? '', /la régularité du coucher \(0 coucher sur 30\)/);
  assert.doesNotMatch(texte, /six comptes/);
  assert.doesNotMatch(texte, MOTS_INTERDITS);
});

test('tout calculé : la ligne vide dit que tous les comptes ont été faits, sans « pas encore regardé »', () => {
  const R = patient('temoin');
  for (const k of Object.keys(R.cherche)) assert.equal(R.cherche[k].calcule, true, k);
  const texte = rienTenu(R.cherche);
  assert.match(texte, /Tous les comptes ont été faits/);
  assert.doesNotMatch(texte, /Pas encore regardé/);
});

test('la phrase des mots absolus porte son unité des deux côtés : « pour 100 mots » deux fois', () => {
  const r0 = mulberry(77);
  const jours = Array.from({ length: 60 }, () => { const n = 2 + Math.floor(r0() * 8); return { humeur: n, sommeil_h: null, coucher: null, ecran_min: null, absolus: Math.round((14 - n + r0()) * 10) / 10 }; });
  const it = analyserTable(enTable({ T: 60, jours })).items.find(i => i.type === 'mots');
  assert.ok(it, 'des mots absolus plantés contre la note se voient');
  assert.equal((it.phrase.match(/pour 100 mots/g) ?? []).length, 2, it.phrase);
});
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
