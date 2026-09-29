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
  // Cinq jours au moins : en dessous, on ne compare plus du tout (voir plus bas).
  const rouges = new Set([10, 25, 40, 51, 58].map(dateDe));
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
  assert.match(r.rythme, /5 jours à surveiller sur 90 journées écrites \(90 jours\)/);
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

test('« 1 jour d’écart », pas « 1 jours d’écart »', () => {
  /*
   * Ce défaut d'accord était invisible tant que la phrase vivait au fond d'un
   * repli. Elle porte maintenant tout le résumé de la ligne fermée — c'est ce
   * qui l'a rendu visible, et c'est la raison de le corriger ici : une
   * compaction rend load-bearing ce qui traînait.
   */
  // Des jours rouges CONSÉCUTIFS : l'écart médian vaut alors 1, et c'est le
  // seul cas où le défaut se voit. Espacés de deux, la phrase est juste dans
  // les deux versions et le test ne prouverait rien.
  const rouges = new Set([10, 11, 12, 13, 14, 15].map(dateDe));
  const T = table(60, () => ({ note: 6 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: messagesDe(23), niveau: niveauOui });
  assert.ok(r.rythme, `pas de rythme rendu par ce décor (n=${r.n})`);
  assert.equal(/\b1 jours d’écart/.test(r.rythme), false, r.rythme);
});

/* ------------------------------------------------------------------ */
/* Des jours comparables, une heure vécue, un « net » qui tient          */
/* ------------------------------------------------------------------ */
const messagesSur = (ecrits, h = 14) => date => ecrits.has(date) ? [{ role: 'user', text: 'une phrase ordinaire', ts: `${date}T${String(h).padStart(2, '0')}:10:00Z` }] : [];

test('les jours à surveiller se comparent aux AUTRES JOURNÉES ÉCRITES, pas au calendrier', () => {
  // Une période sans texte à 5, puis une période écrite à 7 : comparer aux jours
  // vides mesurait la période où l'on écrit, pas les jours à surveiller.
  const ecrits = new Set(); for (let t = 90; t < 120; t++) ecrits.add(dateDe(t));
  const rouges = new Set([91, 94, 97, 100, 103, 106, 109, 112, 115, 118].map(dateDe));
  const T = table(120, t => ({ note: t < 90 ? 5 : 7 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: messagesSur(ecrits), niveau: niveauOui });
  const nv = r.phrases.find(x => x.cle === 'note_veille');
  assert.ok(nv, 'la note de la veille est comptée');
  assert.equal(nv.appui.hors_sur, 20, 'les 20 autres journées écrites, pas les 110 autres jours');
  assert.equal(nv.appui.net, false);
  assert.match(nv.phrase, /les autres veilles de journées écrites/);
  const we = r.phrases.find(x => x.cle === 'week_end');
  assert.equal(we.appui.hors_sur, 20);
  assert.match(r.rythme, /10 jours à surveiller sur 30 journées écrites \(120 jours\)/);
  assert.equal(r.ecrites, 30);
  for (const p of r.phrases) assert.doesNotMatch(p.phrase, /deux sur sept/);
  assert.doesNotMatch(r.rythme, /deux sur sept/);
});

test('les grappes se disent avec leur compte : « dont X dans Y grappes (écarts ≤ 3 j) »', () => {
  const rouges = new Set([10, 11, 13, 40, 42, 70].map(dateDe));
  const T = table(90, () => ({ note: 6 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: messagesDe(14), niveau: niveauOui });
  assert.match(r.rythme, /dont 5 dans 2 grappes \(écarts ≤ 3 j\)/);
  assert.equal(r.grappes, 2); assert.equal(r.dans_grappes, 5);
});

test('une note importée (heure de convention) ne donne pas d’heure ; le message reste lu par la veille', () => {
  const rouges = new Set([10, 20, 30, 40, 50].map(dateDe));
  const importe = dateDe(20);
  const messages = date => date === importe
    ? [{ role: 'user', source: 'import', text: 'x', ts: `${date}T21:00:00.000Z` }]
    : [{ role: 'user', source: 'web', text: 'x', ts: `${date}T13:10:00Z` }];
  const T = table(60, () => ({ note: 6 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages, niveau: niveauOui });
  assert.equal(r.n, 5, 'le jour importé reste un jour à surveiller');
  assert.equal(r.jours.find(j => j.date === importe).heure, null);
  assert.ok(r.jours.filter(j => j.date !== importe).every(j => j.heure != null));
});

test('un message rangé au carnet ne donne pas d’heure, et sort du contexte passé à la veille', () => {
  const rouges = new Set([10, 20, 30, 40, 50].map(dateDe));
  const vus = [];
  const niveau = (texte, opts) => { vus.push(opts.contexteDuJour); return { niveau: 'rouge', motifs: [{ genre: 'blessure', niveau: 'rouge' }] }; };
  const messages = date => [
    { role: 'user', source: 'web', rangee: 1, text: 'un courrier recopié', ts: `${date}T04:00:00Z` },
    ...(date === dateDe(30) ? [] : [{ role: 'user', source: 'web', text: 'ma journée', ts: `${date}T13:00:00Z` }])
  ];
  const T = table(60, () => ({ note: 6 }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages, niveau });
  assert.equal(r.jours.find(j => j.date === dateDe(30)).heure, null, 'seul le message rangé porte le signe : heure inconnue');
  assert.ok(vus.length && vus.every(c => !/courrier/.test(c)), 'le texte rangé n’entre pas dans le contexte de la journée');
});

test('l’heure retenue est celle du passage le plus grave : un rouge à l’aube passe devant un jaune de l’après-midi', () => {
  const rouges = new Set([10, 20, 30, 40, 50].map(dateDe));
  const niveau = texte => texte === 'R' ? { niveau: 'rouge', motifs: [{ genre: 'blessure', niveau: 'rouge' }] }
                        : texte === 'J' ? { niveau: 'jaune', motifs: [{ genre: 'suicide', niveau: 'jaune' }] } : { niveau: null, motifs: [] };
  // Le cas du plan : un jaune à 16:00, un rouge à 05:55 → 05:55.
  const avant = date => [{ role: 'user', text: 'R', ts: `${date}T05:55:00+01:00` }, { role: 'user', text: 'J', ts: `${date}T16:00:00+01:00` }];
  // Et celui qui départage vraiment : le jaune vient D'ABORD (04:30), le rouge après (16:30).
  const apres = date => [{ role: 'user', text: 'J', ts: `${date}T04:30:00+01:00` }, { role: 'user', text: 'R', ts: `${date}T16:30:00+01:00` }];
  const T = table(60, () => ({ note: 6 }));
  const a = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: avant, niveau });
  assert.ok(a.jours.every(j => Math.abs(j.heure - (5 + 55 / 60)) < 1e-9), JSON.stringify(a.jours.map(j => j.heure)));
  const b = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: apres, niveau });
  assert.ok(b.jours.every(j => Math.abs(j.heure - 16.5) < 1e-9), JSON.stringify(b.jours.map(j => j.heure)));
});

test('l’heure se compare à l’heure où l’on écrit d’habitude : qui écrit la nuit partout n’a rien de « net » la nuit', () => {
  const rouges = new Set([10, 20, 30, 40, 50, 60].map(dateDe));
  const T = table(80, () => ({ note: 6 }));
  // six messages par jour, dont quatre la nuit, tous les jours
  const partout = date => [1, 3, 4, 10, 15, 23].map(h => ({ role: 'user', text: 'x', ts: `${date}T${String(h).padStart(2, '0')}:00:00+01:00` }));
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: partout, niveau: niveauOui });
  const h = r.phrases.find(x => x.cle === 'heure');
  assert.ok(h, 'la phrase de l’heure existe, avec son point de comparaison');
  assert.match(h.phrase, /sur 6 jours dont l’heure est connue — contre \d+ sur \d+ de tes messages des autres journées écrites/);
  assert.equal(h.appui.net, false);
  // Et quand la nuit est vraiment à part : six jours marqués écrits à 2 h, le reste à 14 h.
  const aPart = date => [{ role: 'user', text: 'x', ts: `${date}T${rouges.has(date) ? '02' : '14'}:00:00+01:00` }];
  const n = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: aPart, niveau: niveauOui }).phrases.find(x => x.cle === 'heure');
  assert.equal(n.appui.net, true, n.phrase);
  assert.match(n.phrase, /comptes regardés/);
});

test('sans heure de comparaison, l’heure se tait', () => {
  const rouges = new Set([10, 20, 30, 40, 50].map(dateDe));
  const T = table(60, () => ({ note: 6 }));
  // Seuls les jours marqués ont un message daté ; les autres journées écrites sont importées.
  const messages = date => [{ role: 'user', source: rouges.has(date) ? 'web' : 'import', text: 'x', ts: `${date}T01:00:00Z` }];
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages, niveau: niveauOui });
  assert.equal(r.phrases.find(x => x.cle === 'heure'), undefined);
});

test('trois comptes à p ≈ 0,035 : aucun n’est « net » une fois les comptes corrigés (Holm)', () => {
  // 42 journées écrites, une tous les quatre jours (pas de grappe) ; 19 marquées.
  // Pour trois comptes, 12 sur 19 contre 7 sur 23 : p ≈ 0,035 chacun, sous 5 %
  // pris seul, au-dessus du seuil une fois qu'on sait qu'on en a fait cinq.
  const ecrits = new Set(), rouges = new Set(), oui = new Set();
  for (let i = 0; i < 42; i++) { const d = dateDe(4 * i + 1); ecrits.add(d); if (i < 19) rouges.add(d); if (i < 12 || (i >= 19 && i < 26)) oui.add(4 * i + 1); }
  const T = table(170, t => ecrits.has(dateDe(t))
    ? { note: 6, sommeil_h: oui.has(t) ? 5 : 7.5, absolus: oui.has(t) ? 10 : 2 }
    : { note: oui.has(t + 1) ? 3 : 6 });
  const r = joursSurveilles(T, 'u', { veille: veilleDe(rouges), messages: messagesSur(ecrits), niveau: niveauOui });
  for (const cle of ['nuit_courte', 'note_veille', 'absolus']) {
    const p = r.phrases.find(x => x.cle === cle);
    assert.ok(p, cle);
    assert.equal(p.appui.n, 12); assert.equal(p.appui.sur, 19); assert.equal(p.appui.hors_n, 7); assert.equal(p.appui.hors_sur, 23);
    assert.ok(p.appui.p < 0.05, `${cle} : p = ${p.appui.p} (seul, il serait passé)`);
    assert.equal(p.appui.net, false, p.phrase);
    assert.ok(p.appui.comptes >= 3);
  }
});

test('dix-neuf jours en deux grappes ne font pas un « net » ; les mêmes jours éparpillés, si', () => {
  const court = rouges => (t => ({ note: 6, sommeil_h: rouges.has(dateDe(t)) || t % 10 === 5 ? 5 : 7.5 }));
  const grappes = new Set([...Array(10).keys()].map(k => dateDe(20 + k)).concat([...Array(9).keys()].map(k => dateDe(60 + k))));
  const rg = joursSurveilles(table(120, court(grappes)), 'u', { veille: veilleDe(grappes), messages: messagesDe(14), niveau: niveauOui });
  const pg = rg.phrases.find(x => x.cle === 'nuit_courte');
  assert.equal(pg.appui.n, 19); assert.equal(pg.appui.sur, 19);
  assert.equal(pg.appui.grappes.sur, 2);
  assert.equal(pg.appui.net, false, 'deux grappes, deux unités : trop peu pour trancher');
  const eparpilles = new Set([...Array(19).keys()].map(k => dateDe(2 + 6 * k)));
  const re = joursSurveilles(table(120, court(eparpilles)), 'u', { veille: veilleDe(eparpilles), messages: messagesDe(14), niveau: niveauOui });
  assert.equal(re.phrases.find(x => x.cle === 'nuit_courte').appui.net, true);
});

test('moins de cinq jours marqués, ou toutes les journées écrites marquées : aucune comparaison', () => {
  const T = table(60, () => ({ note: 6, sommeil_h: 7 }));
  const trois = new Set([10, 20, 30].map(dateDe));
  const r3 = joursSurveilles(T, 'u', { veille: veilleDe(trois), messages: messagesDe(14), niveau: niveauOui });
  assert.equal(r3.n, 3);
  assert.deepEqual(r3.phrases.filter(p => p.appui.hors_sur != null), []);
  // trois journées écrites sur trois marquées : il n'y a pas d'« autres journées écrites »
  const r33 = joursSurveilles(T, 'u', { veille: veilleDe(trois), messages: messagesSur(trois), niveau: niveauOui });
  assert.deepEqual(r33.phrases.filter(p => p.appui.hors_sur != null), []);
  assert.match(r33.rythme, /3 jours à surveiller sur 3 journées écrites/);
});
