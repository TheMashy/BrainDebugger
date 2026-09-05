/*
 * LE MOTEUR DES FONCTIONNEMENTS, RELU PAR UN SCEPTIQUE STATISTIQUE.
 *
 * Le moteur (server/fonctionnements.js) hérite ses seuils du banc ; ce fichier
 * demande, doute par doute, si ce qu'il affirme tient encore là où le banc n'a
 * pas regardé : vingt jours de journal, trente notes qui ne font que dix paires
 * consécutives, une note entière qui vaut 6 six jours sur dix, un seul jour de
 * texte aberrant, une locution avec « tout ».
 *
 * DEUX SORTES DE TESTS, ET LA CONVENTION QUI LES DISTINGUE.
 *
 *   - Un test ORDINAIRE réfute un doute : la propriété tient, il passe.
 *   - Un test marqué `todo` DÉMONTRE un défaut : il affirme la propriété qu'on
 *     voudrait, elle ne tient pas, il échoue -- et node le rend « not ok # TODO »
 *     sans casser la suite. Son message d'échec porte le chiffre. Le jour où le
 *     moteur est corrigé, il passe, et le `todo` s'enlève.
 *
 * Tout est à graine : un test statistique qui change de verdict d'une exécution
 * à l'autre n'est pas un test, c'est un tirage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// La base jetable AVANT d'importer quoi que ce soit qui ouvre db.js (tableDe passe par la base).
process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-fx-')), 'test.db');
const db = await import('../server/db.js');
const { addDays } = await import('../server/stats.js');
const { analyserTable, absolusDe, tableDe, SEUILS } = await import('../server/fonctionnements.js');

/* ------------------------------------------------------------------ */
/* Outils : aléa à graine, tables synthétiques, test exact de Fisher     */
/* ------------------------------------------------------------------ */
const mulberry32 = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const normale = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const clipRound = (x, a, b) => Math.max(a, Math.min(b, Math.round(x)));
const dateDe = t => new Date(Date.UTC(2026, 0, 5 + t)).toISOString().slice(0, 10);   // 2026-01-05 est un lundi
/** Une table comme celle que tableDe rend : T jours civils consécutifs, tout à null sauf ce que `f(t)` donne. */
const table = (T, f) => {
  const jours = [];
  for (let t = 0; t < T; t++) { const dow = t % 7; jours.push({ date: dateDe(t), note: null, sommeil_h: null, coucher: null, lever: null, ecran_min: null, absolus: null, absolus_mots: [], dow, we: dow >= 5 ? 1 : 0, sortie: dow === 4 || dow === 5 ? 1 : 0, ...f(t) }); }
  return { de: dateDe(0), a: dateDe(T - 1), variables: ['note', 'sommeil_h', 'coucher', 'lever', 'ecran_min', 'absolus'], jours };
};
/** Un AR(1) stationnaire de moyenne m et d'écart-type marginal sd. */
const ar1 = (r, T, phi, m, sd) => { const v = []; let x = 0; for (let t = 0; t < T; t++) { x = phi * x + normale(r) * sd * Math.sqrt(1 - phi * phi); v.push(m + x); } return v; };
/** Le bruit d'un ordinaire sans aucune forme de semaine : c'est le nul du rythme. */
const bruitSansSemaine = (r, phi = 0) => { const n = ar1(r, 200, phi, 6.5, 1.1); return t => ({ note: clipRound(n[t], 1, 10), sommeil_h: 7.4 + 0.8 * normale(r), coucher: 23.3 + 0.9 * normale(r), ecran_min: Math.round(240 + 80 * normale(r)) }); };
const paires = v => { let n = 0; for (let t = 1; t < v.length; t++) if (v[t - 1] != null && v[t] != null) n++; return n; };
const lnf = n => { let s = 0; for (let i = 2; i <= n; i++) s += Math.log(i); return s; };
/** Fisher exact unilatéral : P(au moins n1 « défavorables » dans le groupe bas) sous l'hypothèse que les deux groupes se valent. */
const fisher = (n1, d1, n2, d2) => { const K = n1 + n2, N = d1 + d2; let p = 0; for (let x = n1; x <= Math.min(K, d1); x++) { const y = K - x; if (y < 0 || y > d2) continue; p += Math.exp(lnf(K) - lnf(x) - lnf(K - x) + lnf(N - K) - lnf(d1 - x) - lnf(d2 - y) - (lnf(N) - lnf(d1) - lnf(d2))); } return p; };
const items = (R, type) => R.items.filter(i => i.type === type);

/* ================================================================== */
/* LE RYTHME : Welch sur petits effectifs, quatre tests jamais calibrés  */
/* ================================================================== */

test('RYTHME — vingt jours de bruit suffisent à « trouver » une forme de la semaine : aucun minimum d’effectif, alors que la même réponse dit « pas assez »', () => {
  const N = 300; let touches = 0, pasAssez = 0;
  for (let s = 0; s < N; s++) {
    const R = analyserTable(table(20, bruitSansSemaine(mulberry32(1000 + s))));
    if (items(R, 'rythme').length) { touches++; if (!R.assez) pasAssez++; }
  }
  assert.ok(touches / N <= 0.05, `un rythme est affirmé sur ${(100 * touches / N).toFixed(0)} % des journaux de 20 jours sans aucune forme de semaine (${pasAssez} fois avec assez=false dans la même réponse) ; le banc n’a calibré qu’à 60 et 180 jours`);
});

test('RYTHME — sur 180 jours de bruit pur, la cible du banc (≤ 1 faux item / 100 j) tient — mais un ordinaire sur neuf se voit tout de même attribuer une forme de la semaine', () => {
  const N = 200; let touches = 0, nb = 0;
  for (let s = 0; s < N; s++) { const R = analyserTable(table(180, bruitSansSemaine(mulberry32(2000 + s)))); const it = items(R, 'rythme'); nb += it.length; if (it.length) touches++; }
  const par100j = nb / (N * 180) * 100;
  assert.ok(par100j <= 1, `${par100j.toFixed(2)} faux rythmes / 100 j`);
  // Corrigé depuis : quatre tests à |t| ≥ 2,9 (Bonferroni) et des effectifs minimaux — une personne sur neuf devient au plus une sur seize.
  assert.ok(touches / N <= 0.06, `taux par personne : ${(100 * touches / N).toFixed(0)} %`);
});

test('RYTHME — une note très inerte (φ = 0,75) n’aggrave pas le faux rythme : Welch sur des groupes entrelacés est robuste à l’autocorrélation (réfuté)', () => {
  const taux = phi => { const N = 150; let t = 0; for (let s = 0; s < N; s++) if (items(analyserTable(table(180, bruitSansSemaine(mulberry32(2500 + s), phi))), 'rythme').length) t++; return t / N; };
  const t0 = taux(0), t75 = taux(0.75);
  assert.ok(t75 <= t0 + 0.06, `φ=0 : ${t0.toFixed(2)}, φ=0,75 : ${t75.toFixed(2)}`);
});

/* ================================================================== */
/* L'INERTIE : le nombre de notes n'est pas le nombre de lendemains      */
/* ================================================================== */

test('INERTIE — trente notes groupées qui ne font que quinze paires consécutives : un ordinaire (φ = 0,3) sur quatre est classé, alors que les classes sont les quantiles 5/95 du témoin', () => {
  const N = 400; let classes = 0, retenus = 0; const nbPaires = [];
  for (let s = 0; s < N; s++) {
    const r = mulberry32(3000 + s), n = ar1(r, 180, 0.3, 6.5, 1.0);
    const T = table(180, t => ({ note: (t >= 70 && t < 110 && r() < 0.8) ? clipRound(n[t], 1, 10) : null }));   // ~32 notes sur 40 jours
    const R = analyserTable(T); if (R.periode.notes < SEUILS.min_notes) continue;
    retenus++; nbPaires.push(paires(T.jours.map(j => j.note)));
    if (items(R, 'inertie').length) classes++;
  }
  nbPaires.sort((a, b) => a - b);
  assert.ok(classes / retenus <= 0.10, `${(100 * classes / retenus).toFixed(0)} % des ordinaires classés (haute ou basse) avec ${nbPaires[Math.floor(nbPaires.length / 2)]} paires médianes ; la calibration promet 10 %`);
});

test('INERTIE — des notes un jour sur deux ne sont jamais appariées à travers le trou : l’AR(1) ne se calcule que sur des lendemains (réfuté)', () => {
  const r = mulberry32(9000), n = ar1(r, 180, 0.9, 6, 1);
  const R = analyserTable(table(180, t => ({ note: t % 2 === 0 ? clipRound(n[t], 1, 10) : null })));
  assert.equal(R.periode.notes, 90);
  assert.equal(items(R, 'inertie').length, 0, 'φ = 0,9 planté, mais aucune paire consécutive : rien ne doit se dire');
});

test('INERTIE — … mais la personne n’apprend pas pourquoi : 90 notes, zéro lendemain noté, et les manques se taisent', () => {
  const r = mulberry32(9001), n = ar1(r, 180, 0.9, 6, 1);
  const R = analyserTable(table(180, t => ({ note: t % 2 === 0 ? clipRound(n[t], 1, 10) : null })));
  assert.ok(R.manques.some(m => /lendemain|consécuti|de suite|paires/i.test(m)), `manques : ${JSON.stringify(R.manques)}`);
});

/* ================================================================== */
/* LES LIENS : le comptage qui « décide » ne décide de rien             */
/* ================================================================== */

test('LIEN — un compte que le hasard explique une fois sur deux (« 3 fois sur 6 — contre 2 sur 6 ») ne passe plus : plancher de 10 par groupe, écart de 15 points ET Fisher à 5 %', () => {
  const { min_groupe, effet_min, fisher_p } = SEUILS.lien;
  const regle = (n1, d1, n2, d2) => d1 >= min_groupe && d2 >= min_groupe && (n1 / d1 - n2 / d2) >= effet_min && fisher(n1, d1, n2, d2) <= fisher_p;
  for (const [n1, d1, n2, d2] of [[3, 6, 2, 6], [5, 8, 3, 8], [2, 12, 0, 10], [6, 10, 4, 10]]) assert.ok(!regle(n1, d1, n2, d2), `« ${n1} fois sur ${d1} — contre ${n2} sur ${d2} » passe encore (Fisher p = ${fisher(n1, d1, n2, d2).toFixed(2)})`);
  assert.ok(regle(9, 12, 2, 12), 'un compte net (9/12 contre 2/12, p < 0,01) passe');
});

test('LIEN — une cause vue 48 jours sur 180 : ce qui se montre l’est par un compte que le hasard n’explique pas (Fisher ≤ 0,05, dix jours par groupe)', () => {
  const N = 120; const faibles = [], tous = [];
  for (let s = 0; s < N; s++) {
    const r = mulberry32(12000 + s);
    const ecrits = new Set(); while (ecrits.size < 48) ecrits.add(Math.floor(r() * 179));   // 48 journées écrites d'au moins 30 mots
    const levier = new Set([...ecrits].slice(0, 16));                                       // seize textes très absolus, suivis d'une note très basse : le lien est VRAI
    const T = table(180, t => ({ absolus: ecrits.has(t) ? (levier.has(t) ? 12 + 3 * r() : 1 + 2 * r()) : null }));
    for (let t = 1; t < 180; t++) { const a = T.jours[t - 1].absolus; const fort = a != null && a > 10; if (!fort && r() < 0.35) continue; T.jours[t].note = fort ? clipRound(2 + 0.6 * normale(r), 1, 10) : clipRound(6 + 1.3 * normale(r), 1, 10); }
    for (const l of items(analyserTable(T), 'lien').filter(i => i.de === 'absolus')) {
      const { bas, haut } = l.appui, p = fisher(bas.n, bas.sur, haut.n, haut.sur);
      tous.push(l); if (p > SEUILS.lien.fisher_p || bas.sur < SEUILS.lien.min_groupe || haut.sur < SEUILS.lien.min_groupe) faibles.push(`${bas.n}/${bas.sur} contre ${haut.n}/${haut.sur} (p=${p.toFixed(2)})`);
    }
  }
  assert.ok(tous.length >= 20, `le scénario doit produire des liens (${tous.length})`);
  assert.equal(faibles.length, 0, `${faibles.length} liens sur ${tous.length} sont MONTRÉS par un compte que le hasard explique — par ex. ${faibles.slice(0, 3).join(' ; ')}`);
});

test('LIEN — quand les tiers d’une note entière tombent sur la même valeur (6 six jours sur dix), le moteur se TAIT plutôt que d’écrire « basse (≤ 6) contre haute (≥ 6) »', () => {
  const r = mulberry32(6000); const notes = [];
  for (let t = 0; t < 180; t++) { const u = r(); notes.push(u < 0.2 ? 5 : u < 0.8 ? 6 : 7); }   // 6 six jours sur dix : la note de beaucoup de gens
  const T = table(180, t => ({ note: notes[t], sommeil_h: t > 0 ? 7 + 1.5 * (notes[t - 1] - 6) + 0.4 * normale(r) : 7 }));
  const liens = items(analyserTable(T), 'lien').filter(l => l.de === 'note');
  for (const l of liens) assert.ok(l.appui.q1 < l.appui.q3, `tiers confondus (q1 = q3 = ${l.appui.q1}) : « ${l.phrase} »`);
  assert.equal(liens.length, 0, 'sans deux groupes disjoints, pas de phrase : le silence est le choix (voir EXCLUS)');
  // … et la même note, étalée sur 3–9, retrouve son lien : ce n'est pas le lien qui manque, ce sont les groupes
  const r2 = mulberry32(6001); const n2 = [];
  for (let t = 0; t < 180; t++) n2.push(clipRound(6 + 1.6 * normale(r2), 3, 9));
  const T2 = table(180, t => ({ note: n2[t], sommeil_h: t > 0 ? 7 + 0.8 * (n2[t - 1] - 6) + 0.4 * normale(r2) : 7 }));
  const l2 = items(analyserTable(T2), 'lien').filter(l => l.de === 'note');
  assert.ok(l2.length, 'la note étalée donne deux tiers disjoints et un lien');
  for (const l of l2) assert.ok(l.appui.q1 < l.appui.q3);
});

test('LIEN — un nul MNAR à trous (on n’écrit pas quand ça va mal, deux semaines de vacances) n’invente aucun lien : l’imputation à la moyenne et le bootstrap par blocs ne fabriquent pas de signe (réfuté)', () => {
  const N = 50; let nb = 0;
  for (let s = 0; s < N; s++) {
    const r = mulberry32(11000 + s), vac = 40 + Math.floor(r() * 100);
    const T = table(180, t => { if (t >= vac && t < vac + 14) return {}; const n = 6 + 1.5 * normale(r); return { note: n < 5 && r() < 0.8 ? null : clipRound(n, 1, 10), sommeil_h: 7.4 + 0.9 * normale(r), coucher: 23.3 + 0.9 * normale(r), ecran_min: Math.round(240 + 80 * normale(r)) }; });
    nb += items(analyserTable(T), 'lien').length;
  }
  assert.equal(nb, 0, `${nb} liens inventés sur ${N} nuls`);
});

/* ================================================================== */
/* LES BASCULES : dérive lente, inertie forte                           */
/* ================================================================== */

test('BASCULE — une dérive lente ne reçoit PAS de date : une note qui monte de 3 points en six mois, un sommeil qui gagne 1 h en six mois, restent sous 3 % de personnes datées (droite + saut, z ≥ 3,5)', () => {
  const N = 100;
  const taux = f => { let pers = 0; for (let s = 0; s < N; s++) { const r = mulberry32(20000 + s); if (items(analyserTable(table(180, t => f(r, t))), 'bascule').length) pers++; } return pers / N; };
  const temoinSommeil = taux((r, t) => ({ sommeil_h: 7 + 0.8 * normale(r) }));
  const temoinNote = taux((r, t) => ({ note: clipRound(5.5 + 1.2 * normale(r), 1, 10) }));
  assert.ok(temoinSommeil <= 0.03 && temoinNote <= 0.03, `contrôle sans dérive : ${temoinSommeil} / ${temoinNote}`);
  const sommeil1h = taux((r, t) => ({ sommeil_h: 7 + 1.0 * t / 179 + 0.8 * normale(r) }));
  const note3pts = taux((r, t) => ({ note: clipRound(4 + 3 * t / 179 + 1.2 * normale(r), 1, 10) }));
  assert.ok(sommeil1h <= 0.03 && note3pts <= 0.03, `une pente n’a pas de date, pourtant : sommeil +1 h / 180 j → ${(100 * sommeil1h).toFixed(0)} % des personnes datées ; note +3 points / 180 j → ${(100 * note3pts).toFixed(0)} % (contrôles sans dérive : ${(100 * temoinSommeil).toFixed(0)} % / ${(100 * temoinNote).toFixed(0)} %)`);
});

test('BASCULE — une rampe de 30 jours de 2,5 h EST datée, avec deux moyennes vraies de part et d’autre : c’est un compte vérifiable, on l’accepte en le notant', () => {
  const r = mulberry32(5002);
  const rampe = table(180, t => ({ sommeil_h: 6 + Math.min(1, Math.max(0, (t - 75) / 30)) * 2.5 + 0.5 * normale(r) }));
  const b = items(analyserTable(rampe), 'bascule');
  assert.equal(b.length, 1); assert.ok(Math.abs(b[0].appui.ecart) >= 1);
});

test('BASCULE — une note très inerte sans rupture (φ = 0,7, le haut du profil dépressif du banc) reste sous la cible du banc : ≤ 0,5 fausse bascule / 100 jours', () => {
  const N = 150; let nb = 0;
  for (let s = 0; s < N; s++) { const r = mulberry32(4000 + s), n = ar1(r, 180, 0.7, 5, 1.2); nb += items(analyserTable(table(180, t => ({ note: r() < 0.85 ? clipRound(n[t] + 0.4 * normale(r), 1, 10) : null }))), 'bascule').length; }
  const par100j = nb / (N * 180) * 100;
  assert.ok(par100j <= 0.5, `${par100j.toFixed(2)} bascules / 100 j sur un nul à φ = 0,7`);
});

/* ================================================================== */
/* LES MOTS ABSOLUS : robuste à trouver, fragile à montrer              */
/* ================================================================== */

test('MOTS — Spearman tient (r = −0,90), mais les moyennes affichées se retournent sur un seul jour aberrant : la phrase dit « montent » et montre l’inverse', () => {
  const r = mulberry32(8000);
  const T = table(60, t => { const note = 1 + (t % 10); return { note, absolus: 4 - 0.25 * note + 0.05 * normale(r), absolus_mots: ['tout'] }; });
  T.jours[59].note = 10; T.jours[59].absolus = 40;   // un texte de 30 mots avec 12 « tout » : ça arrive
  const m = items(analyserTable(T), 'mots');
  assert.equal(m.length, 1); assert.ok(m[0].appui.r < -0.8);
  assert.ok(m[0].appui.bas > m[0].appui.haut, `« ${m[0].phrase} »`);
});

test('MOTS — « pas du tout », « tout à l’heure », « tout le monde », « une personne », « plein de choses » comptent comme des absolus', () => {
  const texte = 'pas du tout, tout à l’heure je vais tout de suite voir tout le monde, en tout cas c’est une personne bien, plein de choses à faire, '
    + 'et je continue de faire ce que je peux comme je peux sans en dire plus long ce soir. '.repeat(3);
  const a = absolusDe(texte);
  assert.ok(a && a.mots >= SEUILS.mots.min_mots);
  assert.ok(a.taux < 1, `${a.taux} absolus / 100 mots sur un texte qui n’en contient aucun (vus : ${a.vus.join(', ')})`);
});

test('MOTS — les mots cités sont les plus fréquents en tout, pas ceux qui montent les jours bas : « tout » (chaque jour) passe devant « jamais » (les jours bas seulement)', () => {
  const r = mulberry32(8100);
  const T = table(60, t => { const note = 1 + (t % 10); return { note, absolus: 4 - 0.25 * note + 0.05 * normale(r), absolus_mots: note <= 4 ? ['tout', 'jamais'] : ['tout'] }; });
  const m = items(analyserTable(T), 'mots');
  assert.equal(m.length, 1);
  assert.equal(m[0].appui.mots[0], 'jamais', `cités dans l’ordre : ${m[0].appui.mots.join(', ')} — « ${m[0].phrase} »`);
});

/* ================================================================== */
/* LE COUCHER APRÈS MINUIT ET LA FENÊTRE DES DIGESTS, sur une vraie base */
/* ================================================================== */
const U = db.OWNER;

test('COUCHER — après minuit, le coucher se range sur le soir qu’il ferme, qu’il vienne du digest du lendemain (« 01:15 » → 25,25 la veille) ou d’un « je me couche » dit au petit matin (réfuté)', () => {
  db.setNote('2026-03-09', 6, U); db.setNote('2026-03-10', 7, U); db.setNote('2026-03-11', 5, U); db.setNote('2026-03-12', 6, U);
  db.poserActiviteJour(U, '2026-03-10', { poste: { reveil: '07:30', coucher: '23:40', sommeil_h: 7.8 }, temps_par_contexte_s: { chrome: 3600, 'web:x': 600 } });
  db.poserActiviteJour(U, '2026-03-11', { poste: { reveil: '08:10', coucher: '01:15', sommeil_h: 6.9 } });
  db.poserActiviteJour(U, '2026-03-12', { poste: { reveil: '07:00' } });
  db.poserMesure({ date: '2026-03-12', source: 'dit', cle: 'coucher_dit', texte: '00:30', userId: U });   // dit le 12 au matin : ferme le 11
  const j = Object.fromEntries(tableDe(U, { jours: 4, jusquA: '2026-03-12' }).jours.map(l => [l.date, l]));
  assert.equal(j['2026-03-09'].coucher, 23 + 40 / 60);          // digest du 10 → soir du 9
  assert.equal(j['2026-03-10'].coucher, 25.25);                 // digest du 11 : « 01:15 » → soir du 10, compté après minuit
  assert.equal(j['2026-03-10'].sommeil_h, 7.8); assert.equal(j['2026-03-10'].lever, 7.5); assert.equal(j['2026-03-10'].ecran_min, 70);
  assert.equal(j['2026-03-11'].coucher, 24.5);                  // le dit du 12 au petit matin → soir du 11
  assert.equal(j['2026-03-12'].coucher, null);
});

test('COUCHER — quand le digest et un « je me couche » parlent du même soir, le moteur garde le mesuré ; posteDuJour, lui, fait passer le dit d’abord', () => {
  db.poserMesure({ date: '2026-03-11', source: 'dit', cle: 'coucher_dit', texte: '01:30', userId: U });   // dit le 11 au petit matin : ferme le 10, que le digest du 11 donnait à 01:15
  const j = Object.fromEntries(tableDe(U, { jours: 4, jusquA: '2026-03-12' }).jours.map(l => [l.date, l]));
  assert.equal(j['2026-03-10'].coucher, 25.5, `le moteur garde ${j['2026-03-10'].coucher} (le digest) ; la personne a dit 01:30`);
});

test('FENÊTRE — les digests se lisent par nombre (les jours + 2 plus récents), pas par dates : quarante digests reçus APRÈS la fenêtre effacent ses nuits', () => {
  for (let k = 0; k < 40; k++) db.poserActiviteJour(U, addDays('2026-03-13', k), { poste: { reveil: '07:00', coucher: '23:00', sommeil_h: 7.5 } });
  const j = Object.fromEntries(tableDe(U, { jours: 4, jusquA: '2026-03-12' }).jours.map(l => [l.date, l]));
  assert.equal(j['2026-03-10'].sommeil_h, 7.8, `la nuit du 10 vaut ${j['2026-03-10'].sommeil_h} : le digest existe toujours en base, mais activiteJours(userId, jours + 2) ne remonte que les 6 plus récents`);
});
