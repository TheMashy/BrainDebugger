/**
 * LES FONCTIONNEMENTS : comment ça marche chez cette personne, en comptant.
 *
 * Ce module remplace la carte de co-occurrence comme réponse à « qu'est-ce qui
 * bouge avec quoi ». Il vient d'un banc d'essai (tools/banc-approches) : sept
 * profils synthétiques aux fonctionnements plantés, six façons de cartographier,
 * un score qui paie l'invention. Ce qu'il en reste ici, c'est UNIQUEMENT ce que
 * le banc a montré retrouvable avec une précision honnête :
 *
 *   - la FORME DE LA SEMAINE            (F1 94 au banc)
 *   - les MOTS ABSOLUS qui suivent la note (83)
 *   - la RÉGULARITÉ DU COUCHER          (64)
 *   - les BASCULES : ruptures du sommeil et de la note (62, le sommeil d'abord)
 *   - la NOTE D'UN JOUR À L'AUTRE       (58)
 *   - les LIENS D'UN JOUR SUR LE LENDEMAIN (précision 47 : peu, mais justes)
 *
 * Et ce qu'il REFUSE de rendre, parce que le banc l'a vu inventer plus qu'il ne
 * retrouve : les chaînes fouillées automatiquement (précision 7 %), les alertes
 * de « signal précoce » (4 %), le sens d'un lien sur une période courte (11 %
 * identifiable). Ces refus sont rendus tels quels, avec leur raison.
 *
 * TROIS RÈGLES, LES MÊMES QUE PARTOUT DANS CE PRODUIT
 *
 * 1. ON COMPTE, ON N'INTERPRÈTE PAS. Un lien « nuit courte → note basse le
 *    lendemain » est TROUVÉ par une régression (elle sait tenir compte du
 *    week-end et des autres variables), mais il n'est MONTRÉ que par un
 *    comptage que la personne peut refaire : « 14 fois sur 18 » — et ce
 *    comptage passe lui-même un test exact (Fisher) avant d'être dit. La
 *    régression propose, le comptage décide. Même chose pour la note d'un jour
 *    à l'autre : un coefficient décide, un comptage se lit.
 * 2. AUCUN DIAGNOSTIC, AUCUN NOM DE TROUBLE, AUCUNE CAUSE. Une bascule dit
 *    « autour du 12 août, tes nuits sont passées de 7,4 h à 5,1 h ». Jamais ce
 *    que ça « serait », jamais « parce que ». Les « … » sont les mots de la
 *    personne ; la machine les cite, elle ne les commente pas.
 * 3. LES SEUILS SONT FIXÉS AILLEURS. Chaque nombre de SEUILS dit d'où il vient :
 *    « banc » = calibration.json du banc (réglé pour au plus un faux item par
 *    100 jours sur un témoin), « local » = un choix fait ici, dit comme tel, à
 *    recalibrer dans tools/banc-approches/calibrer.mjs — pas ici.
 */
import { allEntries, activiteEntre, mesuresEntre, OWNER } from './db.js';
import { jourLocal } from './temps.js';
import { addDays } from './stats.js';
import { normaliserCle } from './mesures.js';

/* ------------------------------------------------------------------ */
/* Les seuils, et d'où vient chacun                                     */
/* ------------------------------------------------------------------ */
export const SEUILS = {
  jours_defaut: 180,
  min_notes: 30,                                // local : en dessous, une inertie ou un lien n'est qu'une anecdote
  min_nuits: 30,                                // local
  min_paires: 30,                               // local : lendemains notés (t−1, t) pour lire la note d'un jour à l'autre
  rythme: { t: 2.9, min_dedans: 12, min_dehors: 24 },   // local : 2,9 = Bonferroni sur quatre variables (frise calibrée à 2,3 pour UN item) ; effectifs = un journal de 60 j à 30 % de trous
  regularite: { haute: 1.30, basse: 0.95 },     // banc : classes.regularity (quantiles 95/5 du témoin, écart-type du coucher observé)
  inertie: { haute: 0.44, basse: -0.02 },       // banc : classes.autocorr (quantiles 95/5 du témoin, AR(1) de la note)
  rupture: { note: 4.5, sommeil: 3.0, min_seg: 14, ecart_min: { note: 1.0, sommeil_h: 1.0 }, z_saut: 3.5, fenetre_pente: 90 },   // sommeil = banc (pheno.penalite) ; note = local, DURCI après le banc (frise calibrée à 3,5) parce qu'une fausse bascule de note coûte cher ; ecart_min = local
  lien: { seuil: 0.35, stabilite: 0.6, boots: 40, lambda: 2, min_lignes: 40,   // banc : var.seuil_var, stabilité et bootstrap de la méthode var
          min_groupe: 10, effet_min: 0.15, fisher_p: 0.05 },                     // local : le comptage montré n'existe pas au banc — à y ajouter
  mots: { r: 0.3, min_jours: 25, min_mots: 30 },   // local : r = CALIBRAGE par défaut de la méthode langage
};

/* Les mots absolus, adaptés d'Al-Mosaiwi & Johnstone (2018) : all/whole/full/
   always/never/nothing/every… deviennent tout/entier/plein/toujours/jamais/
   rien/chaque. « tout », « personne » et « plein » vivent aussi dans des
   locutions qui n'ont rien d'absolu (« pas du tout », « tout à l'heure », « une
   personne ») : on les neutralise avant de compter. Un mot n'est pas un verdict :
   c'est leur PART pour cent mots, jour après jour, qui se compare à la note. */
export const MOTS_ABSOLUS = new Set(`
toujours jamais rien tout tous toute toutes chaque chacun chacune personne aucun aucune nul nulle
absolument complètement completement totalement entièrement entierement définitivement definitivement
constamment parfaitement forcément forcement obligatoirement impossible plein pleinement entier entière entiere
`.trim().split(/\s+/));
const LOCUTIONS = /\b(pas du tout|tout à fait|tout à l['’]heure|tout de suite|tout le monde|en tout cas|tout à coup|tout de même|tout d['’]abord|plein de|(une|la|cette|des|les|quelle|quelques|chaque) personnes?)\b/gi;

/* ------------------------------------------------------------------ */
/* Petite statistique, tolérante aux trous                              */
/* ------------------------------------------------------------------ */
const fini = x => x != null && Number.isFinite(x);
const moyenne = v => { const x = v.filter(fini); return x.length ? x.reduce((a, b) => a + b, 0) / x.length : null; };
const ecartType = v => { const x = v.filter(fini); if (x.length < 2) return null; const m = moyenne(x); return Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)); };
const mediane = v => { const x = v.filter(fini).sort((a, b) => a - b); return x.length ? x[Math.floor((x.length - 1) / 2)] : null; };
function pearson(x, y) { const n = x.length; if (n < 3) return null; const mx = moyenne(x), my = moyenne(y); let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null; }
const rangs = v => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = new Array(v.length); let i = 0; while (i < idx.length) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; const m = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = m; i = j + 1; } return r; };
function spearman(a, b, lag = 0) { const x = [], y = []; for (let t = lag; t < b.length; t++) if (fini(a[t - lag]) && fini(b[t])) { x.push(a[t - lag]); y.push(b[t]); } if (x.length < 8) return { r: null, n: x.length }; return { r: pearson(rangs(x), rangs(y)), n: x.length }; }
const seuilR = (n, z = 1.96) => (n > 3 ? z / Math.sqrt(n - 2) : Infinity);
/** AR(1) sur les seules paires (t−1, t) consécutives et notées ; rend aussi combien. */
function ar1(v) { const x = [], y = []; for (let t = 1; t < v.length; t++) if (fini(v[t - 1]) && fini(v[t])) { x.push(v[t - 1]); y.push(v[t]); } return { phi: x.length < 8 ? null : pearson(x, y), paires: x.length }; }
function welch(a, b) { const x = a.filter(fini), y = b.filter(fini); if (x.length < 4 || y.length < 4) return null; const se = Math.sqrt(ecartType(x) ** 2 / x.length + ecartType(y) ** 2 / y.length); return se > 0 ? (moyenne(x) - moyenne(y)) / se : null; }
function interpoler(v, max = 2) { const out = v.slice(); let t = 0; while (t < out.length) { if (fini(out[t])) { t++; continue; } let e = t; while (e < out.length && !fini(out[e])) e++; const a = t - 1, b = e; if (a >= 0 && b < out.length && e - t <= max) for (let k = t; k < e; k++) out[k] = out[a] + (out[b] - out[a]) * (k - a) / (b - a); t = e; } return out; }
function resoudre(A, b) { const n = b.length; const M = A.map((row, i) => [...row, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((row, i) => row[n] / row[i]); }
function ridge(X, y, lambda) { const p = X[0].length; const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0); for (let i = 0; i < X.length; i++) for (let j = 0; j < p; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k]; } for (let j = 0; j < p; j++) A[j][j] += lambda; return resoudre(A, b); }
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hachage(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
/** Test exact de Fisher, unilatéral : P(au moins a succès dans le groupe 1 | marges). */
const lnFact = (() => { const c = [0]; return n => { while (c.length <= n) c.push(c[c.length - 1] + Math.log(c.length)); return c[n]; }; })();
export function fisher(a, n1, c, n2) {
  const K = a + c, N = n1 + n2, lo = Math.max(0, K - n2), hi = Math.min(K, n1);
  const lnP = x => lnFact(n1) - lnFact(x) - lnFact(n1 - x) + lnFact(n2) - lnFact(K - x) - lnFact(n2 - K + x) - (lnFact(N) - lnFact(K) - lnFact(N - K));
  let p = 0; for (let x = a; x <= hi; x++) p += Math.exp(lnP(x));
  return Math.min(1, p);
}

/**
 * Segmentation binaire : là où la moyenne change le plus, tant que ça dépasse
 * la pénalité. Et UNE PENTE N'EST PAS UNE BASCULE : autour de la coupure, on
 * ajuste « une droite + un saut » ; si le saut ne tient pas une fois la pente
 * retirée, on ne date rien — une note qui monte doucement sur six mois n'a pas
 * de « jour où ça a changé » (palierPlutotQuePente ; sur 100 dérives synthétiques
 * de 3 points / 180 j, 3 reçoivent encore une date ; une marche de 2 points en
 * garde une 99 fois sur 100).
 */
export function ruptures(v, { penalite, min_seg }) {
  const x = interpoler(v, 2), out = [];
  const rec = (a, b) => {
    const vals = [], idx = []; for (let t = a; t < b; t++) if (fini(x[t])) { vals.push(x[t]); idx.push(t); }
    const n = vals.length, minPts = 8; if (n < 2 * minPts) return;
    const tot = vals.reduce((p, q) => p + q, 0), sd = ecartType(vals) || 1;
    const pref = [0]; for (const u of vals) pref.push(pref[pref.length - 1] + u);
    let best = null;
    // un segment vaut par sa durée (min_seg jours de chaque côté) et par ses points (au moins 8) :
    // une nuit mesurée sur cinq avant une bascule nette ne doit pas la faire disparaître
    for (let i = minPts; i <= n - minPts; i++) {
      if (idx[i] - idx[0] < min_seg || idx[n - 1] - idx[i - 1] < min_seg) continue;
      const m1 = pref[i] / i, m2 = (tot - pref[i]) / (n - i); const stat = Math.abs(m1 - m2) / sd * Math.sqrt(i * (n - i) / n); if (!best || stat > best.stat) best = { stat, t: idx[i] }; }
    if (best && best.stat > penalite) { out.push(best.t); rec(a, best.t); rec(best.t, b); }
  };
  rec(0, v.length);
  return out.sort((p, q) => p - q).filter(t => palierPlutotQuePente(x, t));
}
function palierPlutotQuePente(x, t, { z = SEUILS.rupture.z_saut, fenetre = SEUILS.rupture.fenetre_pente } = {}) {
  // Sur ± `fenetre` jours, le modèle « une droite + un saut en t » (y = a + b·u + c·[u ≥ t]).
  // Une dérive lente est toute dans b : son saut c est nul. Une vraie bascule garde son
  // saut une fois la pente retirée. On date si c va dans le sens de l'écart brut, en
  // garde au moins la moitié, et se tient à z écarts-types de zéro — la coupure ayant
  // été CHOISIE là où le bruit fait le plus d'effet, un z ordinaire ne suffirait pas.
  const pts = []; for (let u = Math.max(0, t - fenetre); u < Math.min(x.length, t + fenetre); u++) if (fini(x[u])) pts.push([u - t, x[u]]);
  const g = pts.filter(p => p[0] < 0), d = pts.filter(p => p[0] >= 0);
  if (g.length < 6 || d.length < 6) return true;
  const brut = moyenne(d.map(p => p[1])) - moyenne(g.map(p => p[1]));
  // moindres carrés à trois paramètres, équations normales 3 × 3
  const n = pts.length; let su = 0, suu = 0, sy = 0, suy = 0, sm = 0, smu = 0, smy = 0;
  for (const [u, y] of pts) { const m = u >= 0 ? 1 : 0; su += u; suu += u * u; sy += y; suy += u * y; sm += m; smu += m * u; smy += m * y; }
  const A = [[n, su, sm], [su, suu, smu], [sm, smu, sm]], B = [sy, suy, smy];
  const inv = inverse3(A); if (!inv) return true;
  const [a, b, c] = [0, 1, 2].map(i => inv[i][0] * B[0] + inv[i][1] * B[1] + inv[i][2] * B[2]);
  let ss = 0; for (const [u, y] of pts) ss += (y - a - b * u - c * (u >= 0 ? 1 : 0)) ** 2;
  const se = Math.sqrt(Math.max(ss / Math.max(1, n - 3), 1e-9) * inv[2][2]);
  return Math.sign(c) === Math.sign(brut) && Math.abs(c) >= 0.5 * Math.abs(brut) && Math.abs(c) / se >= z;
}
function inverse3(M) {
  const [[a, b, c], [d, e, f], [g, h, i]] = M;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (!det || !Number.isFinite(det)) return null;
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

/* ------------------------------------------------------------------ */
/* Le texte : la part de mots absolus                                    */
/* ------------------------------------------------------------------ */
export function absolusDe(texte) {
  const brut = String(texte ?? '').toLowerCase().replace(LOCUTIONS, 'x');
  const mots = brut.match(/[a-zà-ÿ]+(?:['’][a-zà-ÿ]+)?/g) ?? [];
  if (mots.length < SEUILS.mots.min_mots) return null;
  let n = 0; const vus = new Map();
  for (const m of mots) { const w = m.replace(/^[a-zà-ÿ]+['’]/, ''); if (MOTS_ABSOLUS.has(w)) { n++; vus.set(w, (vus.get(w) ?? 0) + 1); } }
  return { taux: Math.round(1000 * n / mots.length) / 10, mots: mots.length, vus: [...vus].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w) };
}

/* ------------------------------------------------------------------ */
/* La table quotidienne, à partir de ce que la base tient vraiment       */
/* ------------------------------------------------------------------ */
const enHeures = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '')); if (!m) return null; return +m[1] + +m[2] / 60; };
/** Un coucher lu « 01:30 » est 25,5 : après minuit, on continue de compter. */
const coucherContinu = hhmm => { const h = enHeures(hhmm); return h == null ? null : h < 12 ? h + 24 : h; };

export function tableDe(userId = OWNER, { jours = SEUILS.jours_defaut, jusquA = null } = {}) {
  const entrees = allEntries(userId);
  const fin = jusquA ?? entrees.at(-1)?.date ?? jourLocal(Date.now());
  const debut = addDays(fin, -(jours - 1));
  const parDate = new Map();
  const ligne = d => { if (!parDate.has(d)) parDate.set(d, { date: d, note: null, sommeil_h: null, coucher: null, lever: null, ecran_min: null, absolus: null }); return parDate.get(d); };
  for (let d = debut; d <= fin; d = addDays(d, 1)) ligne(d);

  for (const e of entrees) {
    if (e.date < debut || e.date > fin) continue;
    const l = ligne(e.date);
    if (e.note != null) l.note = +e.note;
    const a = absolusDe(e.text); if (a) { l.absolus = a.taux; l.absolus_mots = a.vus; }
  }
  // Le digest de Machi Tool, par DATES : la nuit qui ouvre D (sommeil_h, lever) ; le coucher du SOIR de D est dans le digest de D+1.
  for (const j of activiteEntre(debut, addDays(fin, 1), userId)) {
    const dig = j.digest; if (!dig) continue;
    if (j.date <= fin) {
      const l = ligne(j.date);
      if (fini(dig.poste?.sommeil_h)) l.sommeil_h = dig.poste.sommeil_h;
      if (dig.poste?.reveil) l.lever = enHeures(dig.poste.reveil);
      const tp = dig.temps_par_contexte_s ?? {};
      let s = 0, vu = false; for (const v of Object.values(tp)) if (fini(v)) { s += v; vu = true; }
      if (vu) l.ecran_min = Math.round(s / 60);
    }
    const veille = addDays(j.date, -1);
    if (veille >= debut && veille <= fin && dig.poste?.coucher) ligne(veille).coucher = coucherContinu(dig.poste.coucher);
  }
  // Les mesures apportées (montre, balance, ou dites). Ce qui est DIT passe devant ce qui est mesuré,
  // comme dans posteDuJour : « je me couche » est une phrase de la personne, l'extinction du poste une déduction.
  const series = new Map();
  for (const m of mesuresEntre(debut, fin, userId)) {
    const cle = normaliserCle(m.cle); if (!cle) continue;
    if (cle === 'lever_dit') { const h = enHeures(m.texte ?? m.valeur); if (h != null) ligne(m.date).lever = h; continue; }
    if (cle === 'coucher_dit') { const h = coucherContinu(m.texte ?? m.valeur); if (h == null) continue; const d = h >= 24 ? addDays(m.date, -1) : m.date; if (d >= debut && d <= fin) ligne(d).coucher = h; continue; }
    if (!fini(+m.valeur)) continue;
    if (!series.has(cle)) series.set(cle, new Map());
    series.get(cle).set(m.date, +m.valeur);
  }
  const extras = [];
  for (const [cle, valeurs] of series) {
    if (valeurs.size < 20 || ['note', 'humeur'].includes(cle)) continue;
    if (cle === 'sommeil_h') { for (const [d, v] of valeurs) { const l = ligne(d); if (l.sommeil_h == null) l.sommeil_h = v; } continue; }
    extras.push(cle);
    for (const [d, v] of valeurs) ligne(d)[cle] = v;
  }
  const lignes = [...parDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const l of lignes) { const dow = (new Date(l.date + 'T12:00:00Z').getUTCDay() + 6) % 7; l.dow = dow; l.we = dow >= 5 ? 1 : 0; l.sortie = dow === 4 || dow === 5 ? 1 : 0; }
  return { jours: lignes, variables: ['note', 'sommeil_h', 'coucher', 'lever', 'ecran_min', 'absolus', ...extras], de: debut, a: fin };
}

/* ------------------------------------------------------------------ */
/* Les mots qu'on montre                                                 */
/* ------------------------------------------------------------------ */
const NOM = { note: 'ta note', sommeil_h: 'ton sommeil', coucher: 'ton heure de coucher', lever: 'ton heure de lever', ecran_min: 'ton temps d’écran', absolus: 'tes mots absolus' };
const nomDe = k => NOM[k] ?? `« ${k.replace(/_/g, ' ')} »`;
/* La condition d'un lien, dans les mots de la variable : « une nuit courte », pas « ton sommeil est bas ». */
const COND = { note: ['une note basse', 'une note haute'], sommeil_h: ['une nuit courte', 'une nuit longue'], coucher: ['un coucher tôt', 'un coucher tard'], lever: ['un lever tôt', 'un lever tard'], ecran_min: ['peu d’écran', 'beaucoup d’écran'], absolus: ['peu de mots absolus', 'beaucoup de mots absolus'] };
const condDe = (k, haut) => (COND[k] ?? [`${nomDe(k)} bas`, `${nomDe(k)} haut`])[haut ? 1 : 0];
/* L'effet, lui aussi dans les mots de la variable. sommeil_h(t) est la nuit t−1 → t : après un soir, c'est la nuit QUI SUIT. */
const EFFET = { note: ['ta note du lendemain est sous ta médiane', 'ta note du lendemain est au-dessus de ta médiane'], sommeil_h: ['la nuit qui suit est plus courte que ta nuit médiane', 'la nuit qui suit est plus longue que ta nuit médiane'], coucher: ['le lendemain, tu te couches plus tôt que ton heure médiane', 'le lendemain, tu te couches plus tard que ton heure médiane'], lever: ['le lendemain, tu te lèves plus tôt que ton heure médiane', 'le lendemain, tu te lèves plus tard que ton heure médiane'], ecran_min: ['ton temps d’écran du lendemain est sous ta médiane', 'ton temps d’écran du lendemain est au-dessus de ta médiane'], absolus: ['tes mots absolus du lendemain sont sous ta médiane', 'tes mots absolus du lendemain sont au-dessus de ta médiane'] };
const effetDe = (k, haut) => (EFFET[k] ?? [`${nomDe(k)} du lendemain est sous ta médiane`, `${nomDe(k)} du lendemain est au-dessus de ta médiane`])[haut ? 1 : 0];
const UNITE = { note: '', sommeil_h: ' h', coucher: '', lever: '', ecran_min: '', absolus: ' pour 100 mots' };
export const fmt = (k, v) => {
  if (!fini(v)) return '—';
  if (k === 'coucher' || k === 'lever') { const min = ((Math.round(v * 60) % 1440) + 1440) % 1440; return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; }
  if (k === 'ecran_min') { const m = Math.round(v); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; }
  const s = Math.abs(v) >= 10 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString().replace('.', ',');
  return s + (UNITE[k] ?? '');
};
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const jourLisible = d => { const [y, m, j] = d.split('-'); return `${+j === 1 ? '1er' : +j} ${MOIS[+m - 1]} ${y}`; };
const pl = (n, un, des) => `${n} ${n > 1 ? des : un}`;

/* ------------------------------------------------------------------ */
/* Les mécanismes                                                       */
/* ------------------------------------------------------------------ */

/** LA FORME DE LA SEMAINE : ce qui change le week-end (ou les vendredis et samedis soirs pour le coucher). */
const SENS = { note: ['ta note est plus basse', 'ta note est plus haute'], sommeil_h: ['tes nuits sont plus courtes', 'tes nuits sont plus longues'], coucher: ['tu te couches plus tôt', 'tu te couches plus tard'], ecran_min: ['ton temps d’écran est plus court', 'ton temps d’écran est plus long'] };
function rythme(T) {
  const items = [];
  for (const k of ['note', 'sommeil_h', 'coucher', 'ecran_min']) {
    const enWe = j => (k === 'coucher' ? j.sortie : j.we);
    const a = T.jours.filter(j => enWe(j)).map(j => j[k]).filter(fini), b = T.jours.filter(j => !enWe(j)).map(j => j[k]).filter(fini);
    if (a.length < SEUILS.rythme.min_dedans || b.length < SEUILS.rythme.min_dehors) continue;
    const t = welch(a, b); if (t == null || Math.abs(t) < SEUILS.rythme.t) continue;
    const ma = moyenne(a), mb = moyenne(b), d = ma - mb;
    const quand = k === 'coucher' ? 'les vendredis et samedis soirs' : 'le week-end';
    items.push({
      type: 'rythme', cle: `rythme:${k}`, variable: k,
      phrase: `${quand[0].toUpperCase() + quand.slice(1)}, ${SENS[k][d > 0 ? 1 : 0]} : ${fmt(k, ma)} contre ${fmt(k, mb)} ${k === 'coucher' ? 'les autres soirs' : 'en semaine'} (${pl(a.length, 'journée', 'journées')} contre ${b.length}).`,
      appui: { quand, n_dedans: a.length, n_dehors: b.length, dedans: ma, dehors: mb, dedans_txt: fmt(k, ma), dehors_txt: fmt(k, mb), ecart: d, t },
      force: Math.min(1, Math.abs(t) / 6),
    });
  }
  return items;
}

/** LA RÉGULARITÉ DU COUCHER. L'écart-type DÉCIDE (seuils du banc) ; ce qu'on montre est l'intervalle qui tient deux nuits sur trois. */
function regularite(T) {
  const c = T.jours.map(j => j.coucher).filter(fini);
  if (c.length < SEUILS.min_nuits) return [];
  const sd = ecartType(c); if (sd == null) return [];
  const tri = c.slice().sort((a, b) => a - b), lo = tri[Math.floor(tri.length / 6)], hi = tri[Math.floor(5 * tri.length / 6)], med = mediane(c);
  const appui = { n: c.length, sd, mediane: med, de: lo, a: hi };
  if (sd > SEUILS.regularite.haute) return [{ type: 'regularite', cle: 'regularite:coucher', variable: 'coucher', classe: 'variable', phrase: `Ton heure de coucher varie beaucoup : deux nuits sur trois entre ${fmt('coucher', lo)} et ${fmt('coucher', hi)}, les autres plus loin encore (${c.length} nuits).`, appui, force: Math.min(1, (sd - SEUILS.regularite.haute) / 1.5 + 0.4) }];
  if (sd < SEUILS.regularite.basse) {
    const phrase = hi - lo < 1 / 60 ? `Ton heure de coucher ne bouge presque pas : ${fmt('coucher', med)}, ${c.length} nuits.` : `Ton heure de coucher est régulière : deux nuits sur trois entre ${fmt('coucher', lo)} et ${fmt('coucher', hi)} (${c.length} nuits).`;
    return [{ type: 'regularite', cle: 'regularite:coucher', variable: 'coucher', classe: 'stable', phrase, appui, force: Math.min(1, (SEUILS.regularite.basse - sd) / 0.6 + 0.4) }];
  }
  return [];
}

/** LA NOTE D'UN JOUR À L'AUTRE. L'AR(1) DÉCIDE (classes du banc) ; ce qu'on montre est un comptage : combien de lendemains restent du même côté de la médiane. */
function inertie(T) {
  const v = T.jours.map(j => j.note);
  const n = v.filter(fini).length; if (n < SEUILS.min_notes) return [];
  const { phi, paires } = ar1(v); if (phi == null || paires < SEUILS.min_paires) return [];
  const med = mediane(v); let meme = 0, tot = 0;
  for (let t = 1; t < v.length; t++) { const a = v[t - 1], b = v[t]; if (!fini(a) || !fini(b) || a === med || b === med) continue; tot++; if ((a < med) === (b < med)) meme++; }
  if (tot < 10) return [];
  const appui = { n, paires, phi, mediane: med, meme, tot };
  if (phi > SEUILS.inertie.haute) return [{ type: 'inertie', cle: 'inertie:note', variable: 'note', classe: 'haute', phrase: `D’un jour au lendemain, ta note reste du même côté de ta médiane (${fmt('note', med)}) ${meme} fois sur ${tot} : elle bouge lentement (${paires} lendemains notés).`, appui, force: Math.min(1, (phi - SEUILS.inertie.haute) / 0.4 + 0.4) }];
  if (phi < SEUILS.inertie.basse) return [{ type: 'inertie', cle: 'inertie:note', variable: 'note', classe: 'basse', phrase: `D’un jour au lendemain, ta note change de côté de ta médiane (${fmt('note', med)}) ${tot - meme} fois sur ${tot} : la veille ne dit rien du jour (${paires} lendemains notés).`, appui, force: 0.5 }];
  return [];
}

/** LES BASCULES : là où le sommeil ou la note ont changé de niveau, avec l'avant, l'après, et combien de jours on compare. */
function bascules(T) {
  const items = [], N = T.jours.length;
  for (const [k, pen] of [['sommeil_h', SEUILS.rupture.sommeil], ['note', SEUILS.rupture.note]]) {
    const v = T.jours.map(j => j[k]);
    if (v.filter(fini).length < SEUILS.min_nuits) continue;
    for (const t of ruptures(v, { penalite: pen, min_seg: SEUILS.rupture.min_seg })) {
      const avant = v.slice(Math.max(0, t - 14), t), apres = v.slice(t, Math.min(N, t + 14));
      const ma = moyenne(avant), mb = moyenne(apres); if (ma == null || mb == null) continue;
      const d = mb - ma;
      if (Math.abs(d) < SEUILS.rupture.ecart_min[k]) continue;   // un changement qu'on ne voit pas à l'œil ne se dit pas
      const nA = avant.filter(fini).length, nB = apres.filter(fini).length;
      const unite = k === 'sommeil_h' ? ['nuit', 'nuits'] : ['journée notée', 'journées notées'];
      const proche = items.find(it => it.variable === k && Math.abs(it.t - t) <= 7);
      if (proche) { if (Math.abs(d) <= Math.abs(proche.appui.ecart)) continue; items.splice(items.indexOf(proche), 1); }
      items.push({
        type: 'bascule', cle: `bascule:${k}:${T.jours[t].date}`, variable: k, date: T.jours[t].date, t,
        sens: k === 'sommeil_h' ? (d < 0 ? 'nuits plus courtes' : 'nuits plus longues') : (d < 0 ? 'note plus basse' : 'note plus haute'),
        phrase: `Autour du ${jourLisible(T.jours[t].date)}, ${nomDe(k)} a changé de niveau : ${fmt(k, ma)} avant, ${fmt(k, mb)} après (${pl(nA, unite[0], unite[1])} dans les deux semaines d’avant, ${nB} dans les deux semaines d’après).`,
        appui: { avant: ma, apres: mb, ecart: d, n_avant: nA, n_apres: nB },
        jours: [T.jours[t].date], force: Math.min(1, Math.abs(d) / 2.5),
      });
    }
  }
  return items;
}

/**
 * LES LIENS D'UN JOUR SUR LE LENDEMAIN.
 *
 * Trouvés par une régression ridge de chaque variable sur toutes les autres au
 * jour précédent (le week-end en covariable, pour qu'un dimanche n'ait pas
 * l'air d'une cause), gardés si le signe tient dans ≥ 60 % des tirages d'un
 * bootstrap par blocs. Puis MONTRÉS par un comptage — et c'est le comptage qui
 * décide : deux groupes disjoints (le tiers bas et le tiers haut de la cause,
 * jamais la même valeur des deux côtés), au moins dix jours chacun, un écart
 * d'au moins quinze points, et un test exact de Fisher à 5 %. La phrase est
 * écrite depuis les mêmes bornes que le comptage : ce qu'on lit, on peut le refaire.
 */
function liens(T) {
  const V = T.variables.filter(k => T.jours.filter(j => fini(j[k])).length >= SEUILS.min_notes);
  if (V.length < 2) return [];
  const N = T.jours.length;
  const Z = V.map(k => { const v = T.jours.map(j => j[k]); const m = moyenne(v), s = ecartType(v); return v.map(x => (fini(x) && s ? (x - m) / s : 0)); });
  const WE = T.jours.map(j => j.we - 0.2857);
  const lignes = []; for (let t = 1; t < N; t++) lignes.push(t);
  if (lignes.length < SEUILS.lien.min_lignes) return [];
  const coefs = idx => V.map((k, b) => { const X = idx.map(t => [...Z.map(z => z[t - 1]), WE[t]]); const y = idx.map(t => Z[b][t]); return ridge(X, y, SEUILS.lien.lambda); });
  const r = mulberry32(hachage(T.de + T.a + N));
  const B = SEUILS.lien.boots, bloc = 7, votes = V.map(() => V.map(() => ({ pos: 0, neg: 0 })));
  for (let b = 0; b < B; b++) {
    const idx = []; while (idx.length < lignes.length) { const s = 1 + Math.floor(r() * (N - bloc)); for (let k = 0; k < bloc && idx.length < lignes.length; k++) idx.push(Math.min(N - 1, s + k)); }
    const c = coefs(idx);
    for (let tgt = 0; tgt < V.length; tgt++) { if (!c[tgt]) continue; for (let src = 0; src < V.length; src++) { const v = c[tgt][src]; if (v > SEUILS.lien.seuil) votes[src][tgt].pos++; else if (v < -SEUILS.lien.seuil) votes[src][tgt].neg++; } }
  }
  const items = [];
  for (let src = 0; src < V.length; src++) for (let tgt = 0; tgt < V.length; tgt++) {
    if (src === tgt) continue;
    const vt = votes[src][tgt]; const signe = vt.pos / B >= SEUILS.lien.stabilite ? '+' : vt.neg / B >= SEUILS.lien.stabilite ? '-' : null;
    if (!signe) continue;
    const a = V[src], b = V[tgt];
    /* LE COMPTAGE, celui qu'on montre et qui décide. */
    const va = T.jours.map(j => j[a]).filter(fini).sort((x, y) => x - y);
    const q1 = va[Math.floor(va.length / 3)], q3 = va[Math.floor(2 * va.length / 3)];
    if (!(q1 < q3)) continue;   // une variable plate n'a ni tiers bas ni tiers haut : rien à compter, on se tait
    const medB = mediane(T.jours.map(j => j[b]));
    const bas = [], haut = []; let apparies = 0;
    for (let t = 1; t < N; t++) { const x = T.jours[t - 1][a], y = T.jours[t][b]; if (!fini(x) || !fini(y)) continue; apparies++; if (x <= q1) bas.push({ date: T.jours[t].date, y }); else if (x >= q3) haut.push({ date: T.jours[t].date, y }); }
    if (bas.length < SEUILS.lien.min_groupe || haut.length < SEUILS.lien.min_groupe) continue;
    if (bas.length > apparies / 2 || haut.length > apparies / 2) continue;
    // l'effet « dans le sens du lien » : cause basse → effet bas si signe +, effet haut si signe −
    const dans = signe === '+' ? (p => p.y < medB) : (p => p.y > medB);
    const n1 = bas.filter(dans).length, n2 = haut.filter(dans).length;
    const p1 = n1 / bas.length, p2 = n2 / haut.length;
    if (p1 - p2 < SEUILS.lien.effet_min) continue;
    const p = fisher(n1, bas.length, n2, haut.length);
    if (p > SEUILS.lien.fisher_p) continue;   // la régression le voyait, le comptage ne le confirme pas : on se tait
    items.push({
      type: 'lien', cle: `lien:${a}>${b}`, de: a, vers: b, signe, lag: 1,
      phrase: `Après ${condDe(a, false)} (≤ ${fmt(a, q1)}), ${effetDe(b, signe === '-')} (${fmt(b, medB)}) ${n1} fois sur ${bas.length} — contre ${n2} sur ${haut.length} après ${condDe(a, true)} (≥ ${fmt(a, q3)}).`,
      appui: { q1, q3, mediane: medB, bas: { n: n1, sur: bas.length, cond: condDe(a, false), pred: `≤ ${fmt(a, q1)}` }, haut: { n: n2, sur: haut.length, cond: condDe(a, true), pred: `≥ ${fmt(a, q3)}` }, p, stabilite: Math.max(vt.pos, vt.neg) / B },
      jours: bas.filter(dans).map(x => x.date),
      force: Math.min(1, (p1 - p2) / 0.5),
    });
  }
  return items.sort((x, y) => y.force - x.force).slice(0, 6);
}

/** LES MOTS ABSOLUS. Spearman DÉCIDE ; ce qu'on montre sont les médianes des deux tiers, et elles doivent aller dans le sens dit — sinon on se tait. */
function mots(T) {
  const A = T.jours.map(j => j.absolus), Nn = T.jours.map(j => j.note);
  const { r, n } = spearman(A, Nn);
  if (r == null || n < SEUILS.mots.min_jours) return [];
  if (!(r <= -SEUILS.mots.r && Math.abs(r) > seuilR(n))) return [];
  const ecrits = T.jours.filter(j => fini(j.absolus) && fini(j.note)).sort((a, b) => a.note - b.note);
  const k = Math.max(3, Math.floor(ecrits.length / 3));
  const basses = ecrits.slice(0, k), hautes = ecrits.slice(-k);
  const tauxBas = mediane(basses.map(j => j.absolus)), tauxHaut = mediane(hautes.map(j => j.absolus));
  if (!(tauxBas > tauxHaut)) return [];
  // les mots cités : ceux qui reviennent PLUS les jours bas que les jours hauts
  const exces = new Map();
  for (const j of basses) for (const m of j.absolus_mots ?? []) exces.set(m, (exces.get(m) ?? 0) + 1);
  for (const j of hautes) for (const m of j.absolus_mots ?? []) exces.set(m, (exces.get(m) ?? 0) - 1);
  const tops = [...exces].filter(([, e]) => e > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
  const cite = tops.length ? ` (${tops.map(w => `« ${w} »`).join(', ')})` : '';
  return [{ type: 'mots', cle: 'mots:absolus', phrase: `Tes mots absolus${cite} sont plus nombreux les jours où ta note est la plus basse : ${fmt('absolus', tauxBas)}, contre ${fmt('note', tauxHaut)} les jours où elle est la plus haute (${n} journées écrites).`, appui: { r, n, bas: tauxBas, haut: tauxHaut, mots: tops }, jours: basses.map(j => j.date), force: Math.min(1, Math.abs(r) / 0.6) }];
}

/* ------------------------------------------------------------------ */
/* Ce qu'on refuse de rendre, et pourquoi — dans les mots de tout le monde */
/* ------------------------------------------------------------------ */
export const EXCLUS = [
  { type: 'chaines', raison: 'Les enchaînements fouillés automatiquement (« X, puis Y, puis Z ») n’étaient justes que 7 fois sur 100 à l’essai : le reste était du hasard qui avait l’air d’une histoire. Un enchaînement, ça se raconte sur un moment précis — ça ne se fouille pas.' },
  { type: 'alertes', raison: 'Deviner une bascule avant qu’elle arrive n’était juste que 4 fois sur 100 à l’essai, avec une note par jour. Une alerte fausse 96 fois sur 100 n’est pas une alerte : on n’en montre pas.' },
  { type: 'couplage', raison: 'Le sens d’un lien sur une période courte (par exemple sommeil et note pendant les deux semaines qui suivent une bascule) n’était lisible que 11 fois sur 100 à l’essai. Trop peu pour l’écrire.' },
];

/* ------------------------------------------------------------------ */
/* L'entrée                                                             */
/* ------------------------------------------------------------------ */
export function analyserTable(T) {
  const notes = T.jours.filter(j => fini(j.note)).length, nuits = T.jours.filter(j => fini(j.sommeil_h)).length, ecrans = T.jours.filter(j => fini(j.ecran_min)).length, textes = T.jours.filter(j => fini(j.absolus)).length;
  const couchers = T.jours.filter(j => fini(j.coucher)).length;
  const assez = notes >= SEUILS.min_notes || nuits >= SEUILS.min_nuits || couchers >= SEUILS.min_nuits;
  const items = assez ? [...bascules(T), ...liens(T), ...rythme(T), ...regularite(T), ...inertie(T), ...mots(T)] : [];
  const manques = [];
  if (notes < SEUILS.min_notes) manques.push(`${pl(notes, 'journée notée', 'journées notées')} sur ${T.jours.length} : il en faut ${SEUILS.min_notes} pour lire la note d’un jour à l’autre et les liens.`);
  else { const { paires } = ar1(T.jours.map(j => j.note)); if (paires < SEUILS.min_paires) manques.push(`${pl(notes, 'journée notée', 'journées notées')} mais ${pl(paires, 'lendemain noté', 'lendemains notés')} : la note d’un jour à l’autre se lit sur deux jours de suite.`); }
  if (nuits < SEUILS.min_nuits) manques.push(nuits ? `${pl(nuits, 'nuit mesurée', 'nuits mesurées')} : il en faut ${SEUILS.min_nuits} pour les bascules et la régularité.` : 'Aucune nuit mesurée : rien n’est arrivé de Machi Tool, ni d’une montre par la passerelle.');
  if (textes < SEUILS.mots.min_jours) manques.push(textes ? `${pl(textes, 'journée écrite', 'journées écrites')} d’au moins ${SEUILS.mots.min_mots} mots : il en faut ${SEUILS.mots.min_jours} pour lire les mots absolus.` : `Aucune journée écrite d’au moins ${SEUILS.mots.min_mots} mots : il en faut ${SEUILS.mots.min_jours} pour lire les mots absolus.`);
  return {
    periode: { de: T.de, a: T.a, jours: T.jours.length, notes, nuits, ecrans, textes },
    assez, items, manques, exclus: EXCLUS,
    series: { dates: T.jours.map(j => j.date), note: T.jours.map(j => j.note), sommeil_h: T.jours.map(j => j.sommeil_h), coucher: T.jours.map(j => j.coucher), we: T.jours.map(j => j.we) },
  };
}
export function fonctionnements(userId = OWNER, opts = {}) { return analyserTable(tableDe(userId, opts)); }

/* Ce que la machine dit À SON COMPTE ne nomme jamais un trouble, une cause, un
   état clinique. Les « … » sont les mots de la personne : elle a le droit de les
   écrire, la machine a le droit de les citer — la règle ne s'applique qu'au reste. */
export const laMachineDit = s => String(s ?? '').replace(/«[^»]*»/g, '');
export const MOTS_INTERDITS = /d[ée]pr[eé]ss|d[ée]prim|bipol|\bhypoman|\bmani(e|es|aque|aques)\b|tdah|adhd|autis|\btroubles?\b|diagnos|pathol|maladie|syndrome|d[ée]r[ée]alis|dissoci|anxi|angoiss|panique|insomni|hypersomni|burn.?out|borderline|schizo|psycho|n[ée]vros|sympt[ôo]m|rechute|suicid|euthym|prodrom|phase (haute|basse)|[ée]pisode|\bcrises?\b/i;
