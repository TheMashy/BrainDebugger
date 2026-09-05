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
 *   - l'INERTIE de la note              (58)
 *   - les LIENS DIRIGÉS d'un jour sur le lendemain (précision 47, peu mais justes)
 *
 * Et ce qu'il REFUSE de rendre, parce que le banc l'a vu inventer plus qu'il ne
 * retrouve : les chaînes fouillées automatiquement (précision 7 %), les alertes
 * de « signal précoce » (4 %), le signe d'un couplage par régime (11 % identifiable).
 * Ces refus sont rendus tels quels, avec leur raison : ne pas montrer se dit.
 *
 * TROIS RÈGLES, LES MÊMES QUE PARTOUT DANS CE PRODUIT
 *
 * 1. ON COMPTE, ON N'INTERPRÈTE PAS. Un lien « nuit courte → note basse le
 *    lendemain » est TROUVÉ par une régression (elle sait tenir compte du
 *    week-end et des autres variables), mais il n'est MONTRÉ que par un
 *    comptage que la personne peut vérifier : « 14 fois sur 18 ». La régression
 *    propose, le comptage décide.
 * 2. AUCUN DIAGNOSTIC, AUCUN NOM DE TROUBLE. Une bascule dit « autour du 12 août,
 *    tes nuits sont passées de 7,4 h à 5,1 h ». Jamais ce que ça « serait ».
 *    Une inertie haute dit « tes journées se ressemblent ». C'est tout.
 * 3. LES SEUILS SONT FIXÉS AILLEURS. Ils viennent de la calibration du banc
 *    (tools/banc-approches/calibration.json), réglée pour au plus un faux item
 *    par 100 jours sur un témoin. Ils ne s'ajustent pas ici pour faire joli.
 */
import { allEntries, activiteJours, mesuresEntre, OWNER } from './db.js';
import { jourLocal } from './temps.js';
import { addDays } from './stats.js';
import { normaliserCle } from './mesures.js';

/* ------------------------------------------------------------------ */
/* Les seuils, recopiés de la calibration du banc                       */
/* ------------------------------------------------------------------ */
export const SEUILS = {
  jours_defaut: 180,
  min_notes: 30,          // en dessous, une inertie ou un lien n'est qu'une anecdote
  min_nuits: 30,
  rythme_t: 2.3,          // contraste week-end / semaine (t de Welch)
  regularite: { haute: 1.30, basse: 0.95 },   // écart-type du coucher (h), quantiles du témoin calibré
  inertie: { haute: 0.44, basse: -0.02 },     // AR(1) de la note
  rupture: { note: 4.5, sommeil: 3.0, min_seg: 14, ecart_min: { note: 1.0, sommeil_h: 1.0 } },   // pénalité de segmentation (frise / phéno) ; la note plus stricte : une fausse bascule coûte cher
  lien: { seuil: 0.35, stabilite: 0.6, boots: 40, lambda: 2, min_lignes: 40 },   // ridge lag-1 bootstrap
  mots: { r: 0.3, min_jours: 25, min_mots: 30 },
};

/* Les mots absolus, adaptés d'Al-Mosaiwi & Johnstone (2018). Un mot n'est pas
   un verdict : c'est leur PART pour cent mots, jour après jour, qui se compare
   à la note. */
export const MOTS_ABSOLUS = new Set(`
toujours jamais rien tout tous toute toutes chaque chacun chacune personne aucun aucune nul nulle
absolument complètement completement totalement entièrement entierement définitivement definitivement
constamment parfaitement forcément forcement obligatoirement impossible plein pleinement entier entière entiere
`.trim().split(/\s+/));

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
function ar1(v) { const x = [], y = []; for (let t = 1; t < v.length; t++) if (fini(v[t - 1]) && fini(v[t])) { x.push(v[t - 1]); y.push(v[t]); } return x.length < 8 ? null : pearson(x, y); }
function welch(a, b) { const x = a.filter(fini), y = b.filter(fini); if (x.length < 4 || y.length < 4) return null; const se = Math.sqrt(ecartType(x) ** 2 / x.length + ecartType(y) ** 2 / y.length); return se > 0 ? (moyenne(x) - moyenne(y)) / se : null; }
function interpoler(v, max = 2) { const out = v.slice(); let t = 0; while (t < out.length) { if (fini(out[t])) { t++; continue; } let e = t; while (e < out.length && !fini(out[e])) e++; const a = t - 1, b = e; if (a >= 0 && b < out.length && e - t <= max) for (let k = t; k < e; k++) out[k] = out[a] + (out[b] - out[a]) * (k - a) / (b - a); t = e; } return out; }
function resoudre(A, b) { const n = b.length; const M = A.map((row, i) => [...row, b[i]]); for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r; [M[c], M[p]] = [M[p], M[c]]; if (Math.abs(M[c][c]) < 1e-12) return null; for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; } } return M.map((row, i) => row[n] / row[i]); }
function ridge(X, y, lambda) { const p = X[0].length; const A = Array.from({ length: p }, () => new Array(p).fill(0)), b = new Array(p).fill(0); for (let i = 0; i < X.length; i++) for (let j = 0; j < p; j++) { b[j] += X[i][j] * y[i]; for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k]; } for (let j = 0; j < p; j++) A[j][j] += lambda; return resoudre(A, b); }
/* un aléa à graine : le même journal doit donner la même carte à chaque ouverture */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/** Segmentation binaire : là où la moyenne change le plus, tant que ça dépasse la pénalité. */
export function ruptures(v, { penalite, min_seg }) {
  const x = interpoler(v, 2), out = [];
  const rec = (a, b) => {
    const vals = [], idx = []; for (let t = a; t < b; t++) if (fini(x[t])) { vals.push(x[t]); idx.push(t); }
    const n = vals.length; if (n < 2 * min_seg) return;
    const tot = vals.reduce((p, q) => p + q, 0), sd = ecartType(vals) || 1;
    const pref = [0]; for (const u of vals) pref.push(pref[pref.length - 1] + u);
    let best = null;
    for (let i = min_seg; i <= n - min_seg; i++) { const m1 = pref[i] / i, m2 = (tot - pref[i]) / (n - i); const stat = Math.abs(m1 - m2) / sd * Math.sqrt(i * (n - i) / n); if (!best || stat > best.stat) best = { stat, t: idx[i] }; }
    if (best && best.stat > penalite) { out.push(best.t); rec(a, best.t); rec(best.t, b); }
  };
  rec(0, v.length);
  return out.sort((p, q) => p - q);
}

/* ------------------------------------------------------------------ */
/* Le texte : la part de mots absolus                                    */
/* ------------------------------------------------------------------ */
export function absolusDe(texte) {
  const mots = String(texte ?? '').toLowerCase().match(/[a-zà-ÿ]+(?:['’][a-zà-ÿ]+)?/g) ?? [];
  if (mots.length < SEUILS.mots.min_mots) return null;
  let n = 0; const vus = new Map();
  for (const m of mots) { const w = m.replace(/^[a-zà-ÿ]+['’]/, ''); if (MOTS_ABSOLUS.has(w)) { n++; vus.set(w, (vus.get(w) ?? 0) + 1); } }
  return { taux: Math.round(1000 * n / mots.length) / 10, mots: mots.length, vus: [...vus].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w) };
}

/* ------------------------------------------------------------------ */
/* La table quotidienne, à partir de ce que la base tient vraiment       */
/* ------------------------------------------------------------------ */
const enHeures = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '')); if (!m) return null; const h = +m[1] + +m[2] / 60; return h; };
/** Un coucher lu « 01:30 » est 25,5 : après minuit, on continue de compter. */
const coucherContinu = hhmm => { const h = enHeures(hhmm); return h == null ? null : h < 12 ? h + 24 : h; };

/**
 * @returns {{ jours: Array<object>, variables: string[], de, a }}
 *   jours[t] = { date, note, sommeil_h, coucher, lever, ecran_min, absolus, texte_mots, we, ...mesures }
 */
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
  // Le digest de Machi Tool : la nuit qui ouvre D (sommeil_h, lever), le coucher du SOIR de D est dans le digest de D+1.
  for (const j of activiteJours(userId, jours + 2)) {
    const dig = j.digest; if (!dig) continue;
    if (j.date >= debut && j.date <= fin) {
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
  // Les mesures apportées (montre, balance, ou dites) : une série par clé, si elle est assez fournie.
  const series = new Map();
  for (const m of mesuresEntre(debut, fin, userId)) {
    const cle = normaliserCle(m.cle); if (!cle) continue;
    if (cle === 'lever_dit') { const l = ligne(m.date); if (l.lever == null) l.lever = enHeures(m.texte ?? m.valeur); continue; }
    if (cle === 'coucher_dit') { const h = coucherContinu(m.texte ?? m.valeur); if (h == null) continue; const l = h >= 24 ? ligne(addDays(m.date, -1)) : ligne(m.date); if (l && l.coucher == null) l.coucher = h; continue; }
    if (!fini(+m.valeur)) continue;
    if (!series.has(cle)) series.set(cle, new Map());
    series.get(cle).set(m.date, +m.valeur);
  }
  const extras = [];
  for (const [cle, valeurs] of series) {
    if (valeurs.size < 20 || ['note', 'humeur'].includes(cle)) continue;
    // sommeil mesuré par une montre : il prend la place du sommeil du poste s'il manque
    if (cle === 'sommeil_h') { for (const [d, v] of valeurs) { const l = ligne(d); if (l.sommeil_h == null) l.sommeil_h = v; } continue; }
    extras.push(cle);
    for (const [d, v] of valeurs) ligne(d)[cle] = v;
  }
  const lignes = [...parDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const l of lignes) { const dow = (new Date(l.date + 'T12:00:00Z').getUTCDay() + 6) % 7; l.dow = dow; l.we = dow >= 5 ? 1 : 0; l.sortie = dow === 4 || dow === 5 ? 1 : 0; }
  return { jours: lignes, variables: ['note', 'sommeil_h', 'coucher', 'lever', 'ecran_min', 'absolus', ...extras], de: debut, a: fin };
}

/* ------------------------------------------------------------------ */
/* Les noms qu'on montre                                                 */
/* ------------------------------------------------------------------ */
const NOM = { note: 'ta note', sommeil_h: 'ton sommeil', coucher: 'ton heure de coucher', lever: 'ton heure de lever', ecran_min: 'ton temps d’écran', absolus: 'tes mots absolus' };
const nomDe = k => NOM[k] ?? k.replace(/_/g, ' ');
/* La condition d'un lien, dans les mots de la variable : « une nuit courte », pas « ton sommeil est bas ». */
const COND = { note: ['une note basse', 'une note haute'], sommeil_h: ['une nuit courte', 'une nuit longue'], coucher: ['un coucher tôt', 'un coucher tard'], lever: ['un lever tôt', 'un lever tard'], ecran_min: ['peu d’écran', 'beaucoup d’écran'], absolus: ['peu de mots absolus', 'beaucoup de mots absolus'] };
const condDe = (k, haut) => (COND[k] ?? [`${nomDe(k)} bas`, `${nomDe(k)} haut`])[haut ? 1 : 0];
const UNITE = { note: '', sommeil_h: ' h', coucher: '', lever: '', ecran_min: ' min', absolus: ' / 100 mots' };
const fmt = (k, v) => {
  if (!fini(v)) return '—';
  if (k === 'coucher' || k === 'lever') { const h = ((v % 24) + 24) % 24; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`; }
  if (k === 'ecran_min') return `${Math.round(v)} min`;
  const s = Math.abs(v) >= 10 ? Math.round(v).toString() : (Math.round(v * 10) / 10).toString().replace('.', ',');
  return s + (UNITE[k] ?? '');
};
const fmtDelta = (k, d) => (d >= 0 ? '+' : '−') + fmt(k, Math.abs(d)).replace(/^-/, '');

/* ------------------------------------------------------------------ */
/* Les mécanismes                                                       */
/* ------------------------------------------------------------------ */

/** LA FORME DE LA SEMAINE : ce qui change le week-end (ou les soirs de sortie pour le coucher). */
function rythme(T) {
  const items = [];
  for (const k of ['note', 'sommeil_h', 'coucher', 'ecran_min']) {
    const enWe = j => (k === 'coucher' ? j.sortie : j.we);
    const a = T.jours.filter(j => enWe(j)).map(j => j[k]), b = T.jours.filter(j => !enWe(j)).map(j => j[k]);
    const t = welch(a, b); if (t == null || Math.abs(t) < SEUILS.rythme_t) continue;
    const ma = moyenne(a), mb = moyenne(b), d = ma - mb;
    const quand = k === 'coucher' ? 'les vendredis et samedis soirs' : 'le week-end';
    items.push({
      type: 'rythme', cle: `rythme:${k}`, variable: k,
      phrase: `${quand[0].toUpperCase() + quand.slice(1)}, ${nomDe(k)} est ${k === 'coucher' ? (d > 0 ? 'plus tardive' : 'plus tôt') : (d > 0 ? 'plus haut' : 'plus bas')} : ${fmt(k, ma)} contre ${fmt(k, mb)} en semaine.`,
      appui: { quand, n_dedans: a.filter(fini).length, n_dehors: b.filter(fini).length, dedans: ma, dehors: mb, ecart: d, t },
      force: Math.min(1, Math.abs(t) / 6),
    });
  }
  return items;
}

/** LA RÉGULARITÉ DU COUCHER : à combien d'heures près on se couche. On se tait entre les deux. */
function regularite(T) {
  const c = T.jours.map(j => j.coucher).filter(fini);
  if (c.length < SEUILS.min_nuits) return [];
  const sd = ecartType(c), med = mediane(c);
  if (sd == null) return [];
  if (sd > SEUILS.regularite.haute) return [{ type: 'regularite', cle: 'regularite:coucher', variable: 'coucher', classe: 'variable', phrase: `Ton heure de coucher varie beaucoup : à ± ${fmt('sommeil_h', sd).replace(' h', '')} h autour de ${fmt('coucher', med)}, sur ${c.length} nuits.`, appui: { n: c.length, sd, mediane: med }, force: Math.min(1, (sd - SEUILS.regularite.haute) / 1.5 + 0.4) }];
  if (sd < SEUILS.regularite.basse) return [{ type: 'regularite', cle: 'regularite:coucher', variable: 'coucher', classe: 'stable', phrase: `Ton heure de coucher est très régulière : ${fmt('coucher', med)} à ± ${Math.round(sd * 60)} min près, sur ${c.length} nuits.`, appui: { n: c.length, sd, mediane: med }, force: Math.min(1, (SEUILS.regularite.basse - sd) / 0.6 + 0.4) }];
  return [];
}

/** L'INERTIE DE LA NOTE : une journée tire-t-elle la suivante ? On se tait entre les deux. */
function inertie(T) {
  const v = T.jours.map(j => j.note);
  if (v.filter(fini).length < SEUILS.min_notes) return [];
  const phi = ar1(v); if (phi == null) return [];
  const n = v.filter(fini).length;
  if (phi > SEUILS.inertie.haute) return [{ type: 'inertie', cle: 'inertie:note', variable: 'note', classe: 'haute', phrase: `Tes journées se ressemblent : la note d’un jour tire celle du lendemain (${n} journées notées).`, appui: { n, phi }, force: Math.min(1, (phi - SEUILS.inertie.haute) / 0.4 + 0.4) }];
  if (phi < SEUILS.inertie.basse) return [{ type: 'inertie', cle: 'inertie:note', variable: 'note', classe: 'basse', phrase: `Chaque journée repart de zéro : la note de la veille ne dit rien de celle du jour (${n} journées notées).`, appui: { n, phi }, force: 0.5 }];
  return [];
}

/** LES BASCULES : là où le sommeil ou la note ont changé de niveau, avec l'avant et l'après. */
function bascules(T) {
  const items = [];
  const N = T.jours.length;
  for (const [k, pen] of [['sommeil_h', SEUILS.rupture.sommeil], ['note', SEUILS.rupture.note]]) {
    const v = T.jours.map(j => j[k]);
    if (v.filter(fini).length < SEUILS.min_nuits) continue;
    for (const t of ruptures(v, { penalite: pen, min_seg: SEUILS.rupture.min_seg })) {
      const avant = v.slice(Math.max(0, t - 14), t), apres = v.slice(t, Math.min(N, t + 14));
      const ma = moyenne(avant), mb = moyenne(apres); if (ma == null || mb == null) continue;
      const d = mb - ma;
      if (Math.abs(d) < SEUILS.rupture.ecart_min[k]) continue;   // un changement qu'on ne peut pas voir à l'œil ne se dit pas
      const sens = k === 'sommeil_h' ? (d < 0 ? 'nuits plus courtes' : 'nuits plus longues') : (d < 0 ? 'note plus basse' : 'note plus haute');
      items.push({
        type: 'bascule', cle: `bascule:${k}:${T.jours[t].date}`, variable: k, date: T.jours[t].date, sens,
        phrase: `Autour du ${jourLisible(T.jours[t].date)}, ${nomDe(k)} a changé de niveau : ${fmt(k, ma)} avant, ${fmt(k, mb)} après (deux semaines de chaque côté).`,
        appui: { avant: ma, apres: mb, ecart: d, n_avant: avant.filter(fini).length, n_apres: apres.filter(fini).length },
        jours: [T.jours[t].date], force: Math.min(1, Math.abs(d) / (k === 'sommeil_h' ? 2.5 : 2.5)),
      });
    }
  }
  return items;
}
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const jourLisible = d => { const [y, m, j] = d.split('-'); return `${+j} ${MOIS[+m - 1]} ${y}`; };

/**
 * LES LIENS D'UN JOUR SUR LE LENDEMAIN.
 *
 * Trouvés par une régression ridge de chaque variable sur toutes les autres au
 * jour précédent (le week-end en covariable, pour qu'un dimanche n'ait pas
 * l'air d'une cause), gardés seulement si le signe tient dans ≥ 60 % des
 * tirages d'un bootstrap par blocs. Puis MONTRÉS par un comptage : les jours
 * où la cause était dans son tiers bas / haut, combien de fois l'effet du
 * lendemain était sous / au-dessus de la médiane. C'est le comptage qu'on lit.
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
    /* LE COMPTAGE, celui qu'on montre. Tiers bas et tiers haut de la cause ; effet du lendemain sous / au-dessus de sa médiane. */
    const va = T.jours.map(j => j[a]).filter(fini).sort((x, y) => x - y);
    const q1 = va[Math.floor(va.length / 3)], q3 = va[Math.floor(2 * va.length / 3)];
    const medB = mediane(T.jours.map(j => j[b]));
    const bas = [], haut = [];
    for (let t = 1; t < N; t++) { const x = T.jours[t - 1][a], y = T.jours[t][b]; if (!fini(x) || !fini(y)) continue; if (x <= q1) bas.push({ date: T.jours[t].date, y }); else if (x >= q3) haut.push({ date: T.jours[t].date, y }); }
    if (bas.length < 6 || haut.length < 6) continue;
    // l'effet « défavorable » selon le signe : cause basse → effet bas si signe +, effet haut si signe −
    const sousMed = g => g.filter(p => p.y < medB).length, surMed = g => g.filter(p => p.y > medB).length;
    const cote = signe === '+' ? { n1: sousMed(bas), d1: bas.length, n2: sousMed(haut), d2: haut.length, mot: 'sous' } : { n1: surMed(bas), d1: bas.length, n2: surMed(haut), d2: haut.length, mot: 'au-dessus de' };
    const p1 = cote.n1 / cote.d1, p2 = cote.n2 / cote.d2;
    if (p1 - p2 < 0.15) continue;   // la régression le voyait, le comptage ne le confirme pas : on se tait
    items.push({
      type: 'lien', cle: `lien:${a}>${b}`, de: a, vers: b, signe, lag: 1,
      phrase: `Après ${condDe(a, false)} (≤ ${fmt(a, q1)}), ${nomDe(b)} du lendemain est ${cote.mot} ta médiane (${fmt(b, medB)}) ${cote.n1} fois sur ${cote.d1} — contre ${cote.n2} sur ${cote.d2} après ${condDe(a, true)} (≥ ${fmt(a, q3)}).`,
      appui: { q1, q3, mediane: medB, bas: { n: cote.n1, sur: cote.d1 }, haut: { n: cote.n2, sur: cote.d2 }, stabilite: Math.max(vt.pos, vt.neg) / B },
      jours: bas.filter(p => (signe === '+' ? p.y < medB : p.y > medB)).map(p => p.date),
      force: Math.min(1, (p1 - p2) / 0.5),
    });
  }
  return items.sort((x, y) => y.force - x.force).slice(0, 6);
}
function hachage(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** LES MOTS ABSOLUS : suivent-ils la note ? (Spearman, les jours aberrants ne décident pas.) */
function mots(T) {
  const A = T.jours.map(j => j.absolus), Nn = T.jours.map(j => j.note);
  const { r, n } = spearman(A, Nn);
  if (r == null || n < SEUILS.mots.min_jours) return [];
  if (!(r <= -SEUILS.mots.r && Math.abs(r) > seuilR(n))) return [];
  const vus = new Map(); for (const j of T.jours) for (const m of j.absolus_mots ?? []) vus.set(m, (vus.get(m) ?? 0) + 1);
  const tops = [...vus].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w);
  const basses = T.jours.filter(j => fini(j.absolus) && fini(j.note)).sort((a, b) => a.note - b.note);
  const k = Math.max(3, Math.floor(basses.length / 3));
  const tauxBas = moyenne(basses.slice(0, k).map(j => j.absolus)), tauxHaut = moyenne(basses.slice(-k).map(j => j.absolus));
  return [{ type: 'mots', cle: 'mots:absolus', phrase: `Quand ta note baisse, tes mots absolus montent (${tops.map(w => `« ${w} »`).join(', ')}) : ${fmt('absolus', tauxBas)} les jours les plus bas, contre ${fmt('absolus', tauxHaut)} les jours les plus hauts, sur ${n} journées écrites.`, appui: { r, n, bas: tauxBas, haut: tauxHaut, mots: tops }, jours: basses.slice(0, k).map(j => j.date), force: Math.min(1, Math.abs(r) / 0.6) }];
}

/* ------------------------------------------------------------------ */
/* Ce qu'on refuse de rendre, et pourquoi                               */
/* ------------------------------------------------------------------ */
export const EXCLUS = [
  { type: 'chaines', raison: 'Les enchaînements fouillés automatiquement (« X, puis Y, puis Z ») ont rendu 7 % de vrai au banc : le reste était du hasard qui avait l’air d’une histoire. Une chaîne, ça se raconte avec quelqu’un, sur un épisode précis — pas ici.' },
  { type: 'alertes', raison: 'Les « signaux précoces » (l’humeur qui devient plus collante et plus agitée avant une bascule) existent dans la littérature, mais avec une note par jour ils ont rendu 4 % de vrai au banc. On ne te fera pas peur pour rien.' },
  { type: 'couplage', raison: 'Le signe d’un lien pendant une période donnée (par exemple sommeil et note pendant une phase haute) n’était identifiable que 11 % du temps. Trop peu pour l’écrire.' },
];

/* ------------------------------------------------------------------ */
/* L'entrée                                                             */
/* ------------------------------------------------------------------ */
export function analyserTable(T) {
  const notes = T.jours.filter(j => fini(j.note)).length, nuits = T.jours.filter(j => fini(j.sommeil_h)).length, ecrans = T.jours.filter(j => fini(j.ecran_min)).length, textes = T.jours.filter(j => fini(j.absolus)).length;
  const items = [...bascules(T), ...liens(T), ...rythme(T), ...regularite(T), ...inertie(T), ...mots(T)];
  const manques = [];
  if (notes < SEUILS.min_notes) manques.push(`${notes} journée${notes > 1 ? 's' : ''} notée${notes > 1 ? 's' : ''} sur ${T.jours.length} : il en faut ${SEUILS.min_notes} pour lire l’inertie et les liens.`);
  if (nuits < SEUILS.min_nuits) manques.push(nuits ? `${nuits} nuits mesurées : il en faut ${SEUILS.min_nuits} pour les bascules et la régularité.` : 'Aucune nuit mesurée : Machi Tool n’a rien envoyé (ou une montre, via la passerelle).');
  if (textes < SEUILS.mots.min_jours) manques.push(`${textes} journées écrites d’au moins ${SEUILS.mots.min_mots} mots : il en faut ${SEUILS.mots.min_jours} pour lire les mots absolus.`);
  return {
    periode: { de: T.de, a: T.a, jours: T.jours.length, notes, nuits, ecrans, textes },
    assez: notes >= SEUILS.min_notes || nuits >= SEUILS.min_nuits,
    items, manques, exclus: EXCLUS,
    // De quoi dessiner : les séries elles-mêmes, légères.
    series: { dates: T.jours.map(j => j.date), note: T.jours.map(j => j.note), sommeil_h: T.jours.map(j => j.sommeil_h), coucher: T.jours.map(j => j.coucher), we: T.jours.map(j => j.we) },
  };
}
export function fonctionnements(userId = OWNER, opts = {}) { return analyserTable(tableDe(userId, opts)); }

/* Aucune phrase de ce module ne doit jamais nommer un trouble. Le test le vérifie ;
   cette liste est là pour que la règle se lise ici aussi. */
export const MOTS_INTERDITS = /d[ée]press|bipol|mani(e|aque)|tdah|adhd|autis|trouble|diagnos|pathol|maladie|syndrome|d[ée]r[ée]alis|crise|épisode dépressif/i;
