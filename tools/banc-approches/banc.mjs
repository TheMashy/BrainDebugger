/*
 * LE BANC : chaque méthode sur chaque patient, et ce qu'elle en retrouve.
 *
 * Cellules = profil × manquants (0 / 15 % / 35 % MNAR / 35 % MCAR) × T (60 / 180),
 * trois familles de graines de test, N patients par cellule. Toutes les méthodes
 * tournent sur les MÊMES patients : la comparaison est appariée. Chaque patient
 * est aussi analysé sur sa série PROPRE (le latent, sans manquant ni bruit) :
 * c'est le plafond, et l'écart au plafond dit ce que coûte le réalisme.
 *
 * Contrôles : la composite (frise+chaîne+ews) est jugée contre la meilleure
 * méthode simple PAR TYPE (sélection oracle) et contre d'autres unions — si
 * n'importe quelle union gagne, le classement ne dit rien.
 */
import fs from 'node:fs';
import { generer, seriePropre } from './generateur.mjs';
import { PROFILS_TEST } from './profils.mjs';
import { marquer } from './oracle.mjs';
import { noter, f1De, TYPES } from './scorer.mjs';
import { etatsDe, compterChaine, liftsMaillons } from './etats.mjs';
import { rngDe, hacher } from './rng.mjs';
import { unir } from './methodes/composite.mjs';
import * as cooccurrence from './methodes/cooccurrence.mjs';
import * as varm from './methodes/var.mjs';
import * as ews from './methodes/ews.mjs';
import * as chaine from './methodes/chaine.mjs';
import * as frise from './methodes/frise.mjs';
import * as pheno from './methodes/pheno.mjs';
import * as langage from './methodes/langage.mjs';

const ICI = new URL('.', import.meta.url).pathname;
const rapide = process.argv.includes('--rapide');
const calib = JSON.parse(fs.readFileSync(ICI + 'calibration.json', 'utf-8'));
const empreinte = hacher(fs.readFileSync(ICI + 'generateur.mjs', 'utf-8') + fs.readFileSync(ICI + 'etats.mjs', 'utf-8'));
if (empreinte !== calib.empreinte) { console.error('Le générateur a changé depuis la calibration : relance node calibrer.mjs'); process.exit(1); }

const MODULES = { cooccurrence, var: varm, ews, chaine, frise, pheno, langage };
const SIMPLES = Object.keys(MODULES);
const UNIONS = {
  composite: ['frise', 'chaine', 'ews'],
  union_toutes: SIMPLES,
  var_pheno_langage: ['var', 'pheno', 'langage'],
  frise_chaine: ['frise', 'chaine'], frise_ews: ['frise', 'ews'], chaine_ews: ['chaine', 'ews'],
};
const METHODES = [...SIMPLES, ...Object.keys(UNIONS)];
const FAMILLES = rapide ? ['test-1', 'test-2'] : ['test-1', 'test-2', 'test-3'];
const N = rapide ? 8 : 30;
const NIVEAUX = [{ manquants: 0, mode: 'mnar' }, { manquants: 0.15, mode: 'mnar' }, { manquants: 0.35, mode: 'mnar' }, { manquants: 0.35, mode: 'mcar' }];
const TS = [60, 180];
const cle = (profil, nv, T) => `${profil}|${nv.manquants}|${nv.mode}|${T}`;

const vide = () => ({ credit: 0, rendus: 0, plantes: 0, fp: 0 });
const ajouter = (acc, c) => { acc.credit += c.credit; acc.rendus += c.rendus; acc.plantes += c.plantes; acc.fp += c.fp; };

/* --------------------------------------------------------------- */
const scores = [];          // une ligne par (patient, méthode, propre?) : comptes par type
const exemples = {};
const identif = {};         // par cellule × type : plantés / identifiables (l'oracle)
let compteur = 0;
const t0 = Date.now();
for (const famille of FAMILLES) for (const profil of PROFILS_TEST) for (const nv of NIVEAUX) for (const T of TS) {
  const k = cle(profil, nv, T);
  for (let index = 0; index < N; index++) {
    const s = generer({ profil, famille, T, manquants: nv.manquants, mode: nv.mode, index });
    marquer(s, calib.classes);
    const sp = seriePropre(s);
    sp.verite = s.verite.map(v => ({ ...v }));
    { const e = etatsDe(sp.jours); for (const v of sp.verite) if (v.type === 'chain') { v.occurrences = compterChaine(e, v.etats); v.lifts = liftsMaillons(e, v.etats); v.realise = v.occurrences >= 3 && Math.min(...v.lifts) >= 1.5; } }
    marquer(sp, calib.classes);
    identif[k] ??= {}; for (const v of s.verite) { identif[k][v.type] ??= { plantes: 0, identifiables: 0 }; identif[k][v.type].plantes++; if (!v.neutre) identif[k][v.type].identifiables++; }
    for (const [serie, propre] of [[s, false], [sp, true]]) {
      const out = {};
      for (const m of SIMPLES) out[m] = MODULES[m].analyser(serie, calib.seuils[m]);
      for (const [u, parts] of Object.entries(UNIONS)) out[u] = unir(parts.map(m => out[m]));
      for (const m of METHODES) {
        const n = noter(out[m], serie.verite, T);
        scores.push({ k, famille, index, m, propre, par: n.parType, fp100: n.fp100, fa100: n.fauxAlertes100 });
      }
      if (!propre && famille === 'test-1' && T === 180 && nv.manquants === 0.15 && nv.mode === 'mnar' && index === 0)
        exemples[profil] = { jours: s.jours, latent: s.latent.map(l => ({ t: l.t, humeur: +l.humeur.toFixed(2), sommeil_h: +l.sommeil_h.toFixed(2), regime: l.regime })), episodes: s.episodes, verite: s.verite, trouvailles: out };
    }
    compteur++;
  }
  if (compteur % 200 === 0) console.error(`… ${compteur} patients, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
console.error(`${compteur} patients × ${METHODES.length} méthodes × 2 (observé, propre) en ${((Date.now() - t0) / 1000).toFixed(0)} s`);

/* --------------------------------------------------------------- */
/* agrégation micro par cellule × méthode, IC bootstrap sur les patients */
function agreger(lignes) {
  const tot = vide(), par = {}; for (const t of TYPES) par[t] = vide();
  for (const l of lignes) for (const t of TYPES) { ajouter(par[t], l.par[t]); ajouter(tot, l.par[t]); }
  return { tot, par };
}
function bootstrap(lignes, B = rapide ? 100 : 300) {
  const r = rngDe('bootstrap', lignes[0]?.k ?? '', lignes[0]?.m ?? '');
  const f1s = [];
  for (let b = 0; b < B; b++) { const tot = vide(); for (let i = 0; i < lignes.length; i++) { const l = lignes[Math.floor(r() * lignes.length)]; for (const t of TYPES) ajouter(tot, l.par[t]); } f1s.push(f1De(tot).f1 ?? 0); }
  f1s.sort((a, b) => a - b);
  return [f1s[Math.floor(0.025 * B)], f1s[Math.floor(0.975 * B)]];
}
const cellules = {};
for (const propre of [false, true]) for (const k of Object.keys(identif)) for (const m of METHODES) {
  const lignes = scores.filter(l => l.k === k && l.m === m && l.propre === propre);
  const { tot, par } = agreger(lignes);
  const parType = {}; for (const t of TYPES) parType[t] = { ...par[t], ...f1De(par[t]) };
  const parFamille = FAMILLES.map(f => f1De(agreger(lignes.filter(l => l.famille === f)).tot).f1);
  const moy = parFamille.filter(x => x != null); const mf = moy.length ? moy.reduce((a, b) => a + b, 0) / moy.length : null;
  const sd = moy.length > 1 ? Math.sqrt(moy.reduce((a, b) => a + (b - mf) ** 2, 0) / (moy.length - 1)) : null;
  const fp100 = {}; for (const t of TYPES) fp100[t] = lignes.reduce((a, l) => a + l.fp100[t], 0) / Math.max(1, lignes.length);
  cellules[`${k}|${m}|${propre ? 'propre' : 'obs'}`] = { ...tot, ...f1De(tot), ic95: bootstrap(lignes), f1_familles: parFamille, f1_sd: sd, parType, fp100, fa100: lignes.reduce((a, l) => a + l.fa100, 0) / Math.max(1, lignes.length) };
}
/* la meilleure méthode simple PAR TYPE (sélection oracle), par cellule */
for (const propre of [false, true]) for (const k of Object.keys(identif)) {
  const tot = vide(), choix = {};
  for (const t of TYPES) {
    let best = null;
    for (const m of SIMPLES) { const c = cellules[`${k}|${m}|${propre ? 'propre' : 'obs'}`].parType[t]; if (c.plantes === 0 && c.rendus === 0) continue; if (!best || (c.f1 ?? -1) > (best.f1 ?? -1)) best = { m, ...c }; }
    if (best) { choix[t] = best.m; ajouter(tot, best); }
  }
  cellules[`${k}|meilleure_par_type|${propre ? 'propre' : 'obs'}`] = { ...tot, ...f1De(tot), choix, ic95: null, parType: null };
}

/* --------------------------------------------------------------- */
const pc = x => (x == null ? '   —' : String(Math.round(x * 100)).padStart(4));
const profilsJuges = PROFILS_TEST.filter(p => p !== 'temoin');
function tableau(titre, nv, T, propre = false) {
  const suffixe = propre ? 'propre' : 'obs';
  console.log(`\n═══ ${titre} ═══`);
  console.log('méthode'.padEnd(20) + profilsJuges.map(p => p.slice(0, 9).padStart(10)).join('') + '   moyenne');
  const lignes = [...METHODES, 'meilleure_par_type'].map(m => {
    const f = profilsJuges.map(p => cellules[`${cle(p, nv, T)}|${m}|${suffixe}`]?.f1 ?? null);
    const v = f.filter(x => x != null); const moy = v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    return { m, f, moy };
  }).sort((a, b) => (b.moy ?? -1) - (a.moy ?? -1));
  for (const l of lignes) console.log(l.m.padEnd(20) + l.f.map(pc).map(x => x.padStart(10)).join('') + pc(l.moy).padStart(10));
  return lignes;
}
const principal = tableau('F1 (×100) — T=180, 15 % manquants (MNAR)', NIVEAUX[1], 180);
tableau('F1 — T=60, 15 % manquants', NIVEAUX[1], 60);
tableau('F1 — T=180, 35 % manquants MNAR', NIVEAUX[2], 180);
tableau('F1 — T=180, 35 % manquants MCAR (contrôle du mécanisme)', NIVEAUX[3], 180);
tableau('PLAFOND : F1 sur la série propre — T=180', NIVEAUX[1], 180, true);

console.log('\n═══ Classement global (moyenne des F1 sur toutes les cellules, hors témoin) ± écart-type entre graines ═══');
const global = [...METHODES, 'meilleure_par_type'].map(m => {
  const vals = [], sds = [];
  for (const p of profilsJuges) for (const nv of NIVEAUX) for (const T of TS) { const c = cellules[`${cle(p, nv, T)}|${m}|obs`]; if (c?.f1 != null) vals.push(c.f1); if (c?.f1_sd != null) sds.push(c.f1_sd); }
  return { m, f1: vals.reduce((a, b) => a + b, 0) / vals.length, sd: sds.length ? sds.reduce((a, b) => a + b, 0) / sds.length : null };
}).sort((a, b) => b.f1 - a.f1);
for (const g of global) console.log(`  ${g.m.padEnd(20)} ${pc(g.f1)}  ± ${pc(g.sd)}`);

console.log('\n═══ Par TYPE de fonctionnement — T=180, 15 % : la meilleure méthode simple, son rappel, et combien d’items l’oracle jugeait identifiables ═══');
for (const t of TYPES) {
  let best = null, plantes = 0, ident = 0;
  for (const p of profilsJuges) { const k = cle(p, NIVEAUX[1], 180); plantes += identif[k][t]?.plantes ?? 0; ident += identif[k][t]?.identifiables ?? 0; }
  for (const m of SIMPLES) { const tot = vide(); for (const p of profilsJuges) ajouter(tot, cellules[`${cle(p, NIVEAUX[1], 180)}|${m}|obs`].parType[t]); const f = f1De(tot); if (tot.plantes && (!best || (f.f1 ?? -1) > (best.f1 ?? -1))) best = { m, ...f, ...tot }; }
  console.log(`  ${t.padEnd(14)} plantés ${String(plantes).padStart(4)}  identifiables ${String(ident).padStart(4)} (${plantes ? Math.round(ident / plantes * 100) : 0} %)   ` + (best ? `meilleure : ${best.m.padEnd(13)} rappel ${pc(best.rappel)}  précision ${pc(best.precision)}  F1 ${pc(best.f1)}` : 'aucune'));
}

console.log('\n═══ Fausses découvertes sur le TÉMOIN — items faux pour 100 jours (T=180, 15 %) ═══');
console.log('méthode'.padEnd(20) + TYPES.map(t => t.slice(0, 8).padStart(9)).join('') + '   fausses alertes /100 j hors épisode');
for (const m of METHODES) { const c = cellules[`${cle('temoin', NIVEAUX[1], 180)}|${m}|obs`]; console.log(m.padEnd(20) + TYPES.map(t => (c.fp100[t]).toFixed(2).padStart(9)).join('') + '   ' + c.fa100.toFixed(2)); }

/* la composite contre la meilleure simple et contre l'union de tout : différence appariée, IC bootstrap */
console.log('\n═══ La composite contre ses contrôles — T=180, 15 %, différence de F1 (IC 95 % bootstrap apparié sur les patients) ═══');
for (const [a, b] of [['composite', 'frise'], ['composite', 'meilleure_par_type'], ['composite', 'union_toutes'], ['composite', 'var_pheno_langage']]) {
  const diffs = [];
  for (const p of profilsJuges) {
    const k = cle(p, NIVEAUX[1], 180);
    const la = scores.filter(l => l.k === k && l.m === a && !l.propre), lb = b === 'meilleure_par_type' ? null : scores.filter(l => l.k === k && l.m === b && !l.propre);
    if (!lb) { diffs.push([p, cellules[`${k}|${a}|obs`].f1 - cellules[`${k}|${b}|obs`].f1, null]); continue; }
    const r = rngDe('paire', k, a, b); const ds = [];
    for (let bb = 0; bb < (rapide ? 100 : 300); bb++) { const ta = vide(), tb = vide(); for (let i = 0; i < la.length; i++) { const j = Math.floor(r() * la.length); for (const t of TYPES) { ajouter(ta, la[j].par[t]); ajouter(tb, lb[j].par[t]); } } ds.push((f1De(ta).f1 ?? 0) - (f1De(tb).f1 ?? 0)); }
    ds.sort((x, y) => x - y);
    diffs.push([p, cellules[`${k}|${a}|obs`].f1 - cellules[`${k}|${b}|obs`].f1, [ds[Math.floor(0.025 * ds.length)], ds[Math.floor(0.975 * ds.length)]]]);
  }
  console.log(`  ${a} − ${b} : ` + diffs.map(([p, d, ic]) => `${p.slice(0, 6)} ${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)}${ic ? ` [${(ic[0] * 100).toFixed(0)},${(ic[1] * 100).toFixed(0)}]` : ''}`).join(' · '));
}

fs.writeFileSync(ICI + 'resultats.json', JSON.stringify({ meta: { familles: FAMILLES, N, niveaux: NIVEAUX, T: TS, methodes: METHODES, types: TYPES, profils: PROFILS_TEST, calibration: calib, empreinte }, identifiabilite: identif, cellules, classement: global }, null, 1));
fs.writeFileSync(ICI + 'exemples.json', JSON.stringify(exemples));
fs.writeFileSync(ICI + 'scores_patients.json', JSON.stringify(scores.filter(l => !l.propre).map(l => ({ k: l.k, f: l.famille, i: l.index, m: l.m, par: Object.fromEntries(TYPES.map(t => [t, [l.par[t].credit, l.par[t].rendus, l.par[t].plantes, l.par[t].fp]])) }))));
console.log('\nécrit : resultats.json, exemples.json, scores_patients.json');
