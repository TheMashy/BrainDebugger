import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median, contrast, buildSeries, episodes, followUp, yearGrid, streak,
  addDays, daysBetween, REFERENCE_WINDOW_DAYS, MIN_REFERENCE_POINTS
} from '../server/stats.js';

/* ---------------- helpers ---------------- */

/** Serie synthetique : notes consecutives a partir de `start`. */
const seq = (start, notes) => notes.map((note, i) => ({ date: addDays(start, i), note }));

/** Serie deja "buildee" a la main : on fixe la reference pour tester episodes() seul. */
const withRef = (start, notes, reference) =>
  notes.map((note, i) => ({ date: addDays(start, i), note, reference }));

/* ---------------- dates ---------------- */

test('addDays / daysBetween traversent les mois et les annees bissextiles', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');   // 2024 est bissextile
  assert.equal(addDays('2023-02-28', 1), '2023-03-01');
  assert.equal(addDays('2024-12-31', 1), '2025-01-01');
  assert.equal(addDays('2025-01-01', -1), '2024-12-31');
  assert.equal(daysBetween('2024-01-01', '2024-12-31'), 365);
  assert.equal(daysBetween('2023-01-01', '2023-12-31'), 364);
  assert.equal(daysBetween('2025-03-10', '2025-03-10'), 0);
});

/* ---------------- mediane ---------------- */

test('median : impair, pair, vide', () => {
  assert.equal(median([1, 2, 3]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([7]), 7);
});

/* ---------------- contraste ---------------- */

test('contrast reproduit exactement les valeurs du tableur d\'origine', () => {
  // =(RACINE((n-5)^2)*(n-5))/2,5  ->  signe(n-5)*(n-5)^2/2,5
  const attendu = {
    0: -10, 1: -6.4, 2: -3.6, 3: -1.6, 4: -0.4, 5: 0,
    6: 0.4, 7: 1.6, 8: 3.6, 9: 6.4, 10: 10
  };
  for (const [note, v] of Object.entries(attendu)) {
    assert.equal(contrast(Number(note) - 5), v, `note ${note}`);
  }
});

test('contrast est impair et borne a +/-10', () => {
  assert.equal(contrast(2), -contrast(-2));
  assert.equal(contrast(50), 10);
  assert.equal(contrast(-50), -10);
});

/* ---------------- reference glissante ---------------- */

test('reference : repli sur la mediane globale sous le minimum de points', () => {
  const s = buildSeries(seq('2024-01-01', [4, 8, 6]));
  // 3 points seulement : les trois lignes doivent utiliser la mediane globale (6)
  assert.ok(s.every(x => x.referenceIsFallback), 'toutes en repli');
  assert.ok(s.every(x => x.reference === 6), 'mediane globale = 6');
});

test('reference : exclut le jour courant', () => {
  // 25 jours a 5, puis un 10. La reference du 10 doit rester 5, pas etre tiree vers le haut.
  const s = buildSeries(seq('2024-01-01', [...Array(25).fill(5), 10]));
  const dernier = s[s.length - 1];
  assert.equal(dernier.referenceIsFallback, false);
  assert.equal(dernier.reference, 5);
  assert.equal(dernier.delta, 5);
});

test('reference : la fenetre ne retient que les 365 jours precedents', () => {
  // 400 jours a 2, puis 30 jours a 8. Au 30e jour a 8, les vieux 2 sortent peu a peu.
  const s = buildSeries(seq('2023-01-01', [...Array(400).fill(2), ...Array(30).fill(8)]));
  const dernier = s[s.length - 1];
  assert.equal(dernier.referencePoints, REFERENCE_WINDOW_DAYS, 'fenetre pleine a 365 points');
  assert.ok(dernier.reference === 2, 'encore majoritairement des 2 dans la fenetre');
});

test('reference : au moins MIN_REFERENCE_POINTS avant de sortir du repli', () => {
  const s = buildSeries(seq('2024-01-01', Array(40).fill(6)));
  assert.equal(s[MIN_REFERENCE_POINTS - 1].referenceIsFallback, true);
  assert.equal(s[MIN_REFERENCE_POINTS].referenceIsFallback, false);
});

/* ---------------- cumuls ---------------- */

test('cumuls : la derive du centre fixe est mecanique, celle du centre glissant non', () => {
  // 500 jours a 6 exactement. Centre 5 -> +0,4/jour a l'infini. Centre glissant -> 0.
  const s = buildSeries(seq('2024-01-01', Array(500).fill(6)));
  const d = s[s.length - 1];
  assert.equal(d.cumFixed, 0.4 * 500, 'centre 5 : derive constante');
  assert.equal(d.cumRelative, 0, 'centre glissant : aucune derive sur une serie plate');
  assert.equal(d.cumGlobal, 0, 'centre mediane globale : aucune derive non plus ici');
});

test('cumul : la pente ne monte que si la periode bat la reference recente', () => {
  const s = buildSeries(seq('2024-01-01', [...Array(200).fill(5), ...Array(60).fill(8)]));
  const avant = s[199].cumRelative;
  const apres = s[s.length - 1].cumRelative;
  assert.ok(apres > avant, 'une periode meilleure fait monter le cumul glissant');
});

/* ---------------- episodes ---------------- */

test('episodes : non applicable au niveau ou au-dessus de la reference', () => {
  const s = withRef('2024-01-01', [6, 6, 6], 6);
  const e = episodes(s, 6);
  assert.equal(e.applicable, false);
  assert.equal(e.reason, 'at_or_above_reference');
});

test('episodes : cas simple, duree = jours jusqu\'au retour', () => {
  //           j0 j1 j2 j3 j4
  const s = withRef('2024-01-01', [2, 3, 4, 6, 6], 6);
  const e = episodes(s, 3, { sustain: 1 });
  assert.equal(e.applicable, true);
  assert.equal(e.count, 1, 'un seul episode');
  assert.equal(e.episodes[0].start, '2024-01-01');
  assert.equal(e.episodes[0].end, '2024-01-04');
  assert.equal(e.medianDays, 3);
  assert.equal(e.unresolvedCount, 0);
});

test('episodes : les jours bas consecutifs n\'ouvrent pas plusieurs episodes', () => {
  // 5 jours bas d'affilee = 1 episode, pas 5.
  const s = withRef('2024-01-01', [1, 1, 1, 1, 1, 7, 7], 6);
  const e = episodes(s, 2, { sustain: 1 });
  assert.equal(e.count, 1, 'chevauchement evite');
  assert.equal(e.episodes[0].days, 5);
});

test('episodes : sustain=2 refuse un rebond d\'un seul jour', () => {
  //        j0 j1 j2 j3 j4 j5 j6
  //         2  7  2  2  7  7  7   <- le 7 de j1 est un faux retour
  const notes = [2, 7, 2, 2, 7, 7, 7];
  const s = withRef('2024-01-01', notes, 6);

  const un = episodes(s, 2, { sustain: 1 });
  assert.equal(un.episodes[0].days, 1, 'sustain=1 : resolu des j1');

  const deux = episodes(s, 2, { sustain: 2 });
  assert.equal(deux.episodes[0].days, 4, 'sustain=2 : resolu seulement a j4');
});

test('episodes : compte les episodes non resolus dans l\'horizon', () => {
  // 40 jours bas sans jamais remonter, horizon 30
  const s = withRef('2024-01-01', Array(40).fill(1), 6);
  const e = episodes(s, 2, { horizon: 30 });
  assert.equal(e.count, 1, 'une periode basse continue = UN episode, pas un par horizon');
  assert.equal(e.unresolvedCount, 1);
  assert.equal(e.resolvedCount, 0);
  assert.equal(e.medianDays, null, 'aucune mediane a donner');
  assert.equal(e.episodes[0].resolved, false);
  assert.equal(e.neverReturnedCount, 1, 'jamais remonte avant la fin des donnees');
});

test('episodes : shareUnder4 ne porte que sur les episodes resolus', () => {
  // 3 episodes : 2j, 3j, 9j -> 2 sur 3 sous 4 jours
  const notes = [
    2, 7, 7,                    // ep 1 : 1 jour bas, retour a j1  -> 1j
    2, 2, 2, 7, 7,              // ep 2 : retour a j+3             -> 3j
    ...Array(9).fill(2), 7, 7   // ep 3 : retour a j+9             -> 9j
  ];
  const s = withRef('2024-01-01', notes, 6);
  const e = episodes(s, 2, { sustain: 1 });
  assert.equal(e.count, 3);
  assert.deepEqual(e.episodes.map(x => x.days), [1, 3, 9]);
  assert.equal(e.medianDays, 3);
  assert.equal(Math.round(e.shareUnder4 * 100), 67);
  assert.equal(e.maxDays, 9);
});

test('episodes : un jour bas mais >= reference n\'ouvre pas d\'episode', () => {
  // reference basse : une note de 3 avec reference 2 n'est pas un episode
  const s = withRef('2024-01-01', [3, 3, 3], 2);
  const e = episodes(s, 3);
  assert.equal(e.applicable, false, 'N >= reference');
});

/* ---------------- bande de suivi ---------------- */

test('followUp : 14 jours, trous a null, jour courant exclu', () => {
  const s = buildSeries(seq('2024-01-01', [3, 4, 5, 6]));
  const band = followUp(s, '2024-01-01', 14);
  assert.equal(band.length, 14);
  assert.equal(band[0].date, '2024-01-02', 'commence le lendemain');
  assert.equal(band[0].note, 4);
  assert.equal(band[2].note, 6);
  assert.equal(band[3].note, null, 'apres la fin des donnees');
});

/* ---------------- grille annuelle ---------------- */

test('yearGrid : longueurs de mois correctes, fevrier bissextile', () => {
  const g2024 = yearGrid(buildSeries(seq('2024-01-01', Array(366).fill(6))), 2024);
  assert.equal(g2024.count, 366, '2024 bissextile');
  assert.equal(g2024.months[1].days.filter(Boolean).length, 29, 'fevrier 2024 = 29 jours');
  assert.equal(g2024.months[1].days[29], null, 'pas de 30 fevrier');

  const g2023 = yearGrid(buildSeries(seq('2023-01-01', Array(365).fill(6))), 2023);
  assert.equal(g2023.months[1].days.filter(Boolean).length, 28, 'fevrier 2023 = 28 jours');
});

test('yearGrid : moyennes mensuelles et annuelle', () => {
  const g = yearGrid(buildSeries(seq('2024-01-01', [...Array(31).fill(4), ...Array(335).fill(7)])), 2024);
  assert.equal(g.months[0].avg, 4, 'janvier');
  assert.equal(g.months[1].avg, 7, 'fevrier');
  assert.ok(g.avg > 6.7 && g.avg < 6.8, `annuelle ~6.75, obtenu ${g.avg}`);
});

/* ---------------- serie de jours ---------------- */

test('streak : compte les jours consecutifs, s\'arrete au premier trou', () => {
  const s = buildSeries([
    ...seq('2024-01-01', [5, 5, 5]),
    ...seq('2024-01-10', [5, 5])          // trou du 4 au 9
  ]);
  assert.equal(streak(s, '2024-01-11'), 2);
  assert.equal(streak(s, '2024-01-03'), 3);
  assert.equal(streak(s, '2024-01-05'), 0, 'jour non note');
});


test('episodes : un retour au-dela de l\'horizon est non resolu mais sa duree est connue', () => {
  // 40 jours bas, puis retour. Horizon 30 -> non resolu, mais on sait que ca a pris 40 jours.
  const s = withRef('2024-01-01', [...Array(40).fill(1), 7, 7], 6);
  const e = episodes(s, 2, { horizon: 30, sustain: 1 });
  assert.equal(e.count, 1);
  assert.equal(e.unresolvedCount, 1);
  assert.equal(e.neverReturnedCount, 0, 'il est bien remonte, juste trop tard');
  assert.deepEqual(e.beyondHorizonDays, [40]);
});

test('episodes : deux periodes basses separees par un vrai retour = deux episodes', () => {
  const notes = [1, 1, 7, 7, 7, 7, 1, 1, 7, 7];
  const s = withRef('2024-01-01', notes, 6);
  const e = episodes(s, 2, { sustain: 2 });
  assert.equal(e.count, 2);
  assert.deepEqual(e.episodes.map(x => x.days), [2, 2]);
});

test('episodes : l\'episode en cours est censure, pas "jamais remonte"', () => {
  // La serie s'arrete sur une journee basse : impossible de savoir si ca remonte.
  // C'est exactement la situation d'un mauvais soir devant l'app.
  const s = withRef('2024-01-01', [7, 7, 7, 7, 7, 2], 6);
  const e = episodes(s, 2, { horizon: 60, sustain: 1 });
  assert.equal(e.count, 1);
  assert.equal(e.censoredCount, 1, 'censure');
  assert.equal(e.unresolvedCount, 0, 'surtout PAS compte comme non resolu');
  assert.equal(e.neverReturnedCount, 0);
  assert.equal(e.comparableCount, 0, 'rien de jugeable');
});

test('episodes : un episode ancien sans retour reste bien non resolu', () => {
  // 100 jours bas puis 10 jours hauts : l'episode a eu tout l'horizon, il est non resolu.
  const s = withRef('2024-01-01', [...Array(100).fill(2), ...Array(10).fill(7)], 6);
  const e = episodes(s, 2, { horizon: 60, sustain: 1 });
  assert.equal(e.censoredCount, 0, 'pas censure : il y avait du recul');
  assert.equal(e.unresolvedCount, 1);
  assert.deepEqual(e.beyondHorizonDays, [100], 'remonte, mais bien au-dela de 60 jours');
});
