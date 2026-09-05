/*
 * LA CALIBRATION : fixer les seuils UNE FOIS, hors du jeu de test.
 *
 * Deux règles. Les CLASSES (autocorr, régularité) viennent des quantiles du
 * témoin — rien n'est appris. Les SEUILS DE DÉTECTION (arêtes, chaînes,
 * ruptures, alertes) sont réglés à une cible commune de fausses découvertes sur
 * le témoin : ≤ 1 item faux pour 100 jours (0,5 pour les chaînes et les
 * épisodes). C'est ce qui égalise l'axe précision entre méthodes et rend leurs
 * rappels comparables. Le profil `calib_mixte` (jamais testé) sert seulement à
 * vérifier que les seuils laissent passer quelque chose. Famille de graines
 * `calib`, jamais réutilisée au test.
 */
import fs from 'node:fs';
import { generer } from './generateur.mjs';
import { noter } from './scorer.mjs';
import { ar1, ecartType, quantile } from './stats.mjs';
import { hacher } from './rng.mjs';
import * as cooccurrence from './methodes/cooccurrence.mjs';
import * as varm from './methodes/var.mjs';
import * as ews from './methodes/ews.mjs';
import * as chaine from './methodes/chaine.mjs';
import * as frise from './methodes/frise.mjs';
import * as pheno from './methodes/pheno.mjs';
import * as langage from './methodes/langage.mjs';

const ICI = new URL('.', import.meta.url).pathname;
const CIBLE = { edge: 1, chain: 0.5, episode: 0.5, ews: 1 };   // faux / 100 jours
const rapide = process.argv.includes('--rapide');
const N = rapide ? 8 : 24;
const cellules = [];
for (const T of [60, 180]) for (const manquants of [0, 0.15, 0.35]) cellules.push({ T, manquants });

const temoins = [], mixtes = [];
for (const c of cellules) for (let i = 0; i < N; i++) temoins.push(generer({ profil: 'temoin', famille: 'calib', ...c, index: i }));
for (const c of cellules) for (let i = 0; i < Math.ceil(N / 2); i++) mixtes.push(generer({ profil: 'calib_mixte', famille: 'calib', ...c, index: i }));
const joursTotal = temoins.reduce((a, s) => a + s.T, 0);
const joursCalib = joursTotal + mixtes.reduce((a, s) => a + s.T, 0);

/* 1. les classes, par quantiles du témoin */
const phis = temoins.map(s => ar1(s.jours.map(j => j.humeur))).filter(x => x != null);
const sds = temoins.map(s => ecartType(s.jours.map(j => j.coucher))).filter(x => x != null);
const classes = {
  autocorr: { high: quantile(phis, 0.95), low: quantile(phis, 0.05) },
  regularity: { haute: quantile(sds, 0.95), basse: quantile(sds, 0.05) },
};
console.log('classes (quantiles du témoin) :', JSON.stringify(classes));

/* 2. les seuils de détection, à la cible de fausses découvertes */
function fpPar100(module, opts, type, filtre = null) {
  let fp = 0;
  // faux positifs sur le témoin ET sur le profil de calibration mixte (riche en événements) : un seuil réglé
  // sur un témoin trop calme laisserait passer des chaînes de hasard dès qu'il y a des événements
  for (const s of [...temoins, ...mixtes]) { const tr = module.analyser(s, opts); if (filtre) filtre(tr); fp += noter(tr, s.verite, s.T).parType[type].fp; }
  return fp / joursCalib * 100;
}
function chercher(nom, module, param, grille, type, base = {}, filtre = null) {
  // la grille va du plus permissif au plus strict : on garde le premier qui tient
  let choix = grille[grille.length - 1], courbe = [];
  for (const v of grille) { const fp = fpPar100(module, { ...base, [param]: v }, type, filtre); courbe.push([v, +fp.toFixed(2)]); if (fp <= CIBLE[type]) { choix = v; break; } }
  console.log(`${nom}.${param} = ${choix}   (faux/100 j par valeur : ${courbe.map(([v, f]) => v + '→' + f).join(' ')})`);
  return choix;
}
// les items neutres : sur le témoin, ses propres items plantés sont marqués identifiables (l'oracle n'est pas encore calibré) — on ne compte que les FP
for (const s of [...temoins, ...mixtes]) for (const v of s.verite) v.neutre = false;
const seuils = {};
seuils.cooccurrence = { seuil_phi: chercher('cooccurrence', cooccurrence, 'seuil_phi', [0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6], 'edge') };
const seulLag = lag => tr => { tr.edges = tr.edges.filter(e => e.lag === lag); };
const sv = chercher('var', varm, 'seuil_var', [0.05, 0.08, 0.1, 0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5], 'edge', { boots: rapide ? 20 : 40 }, seulLag(1));
const sc = chercher('var', varm, 'seuil_cont', [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6], 'edge', { seuil_var: sv, boots: rapide ? 20 : 40 }, seulLag(0));
seuils.var = { seuil_var: sv, seuil_cont: sc, autocorr: classes.autocorr };
seuils.ews = { seuil_tau: chercher('ews', ews, 'seuil_tau', [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], 'ews'), autocorr: classes.autocorr };
seuils.chaine = { seuil_lift: chercher('chaine', chaine, 'seuil_lift', [1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 3.0], 'chain') };
seuils.frise = { penalite: chercher('frise', frise, 'penalite', [3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 10], 'episode'), regularity: classes.regularity, autocorr: classes.autocorr };
const pp = chercher('pheno', pheno, 'penalite', [3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 10], 'episode');
seuils.pheno = { penalite: pp, seuil_r: chercher('pheno', pheno, 'seuil_r', [0.15, 0.2, 0.25, 0.3, 0.35, 0.4], 'edge', { penalite: pp }), regularity: classes.regularity };
seuils.langage = { seuil_tau: chercher('langage', langage, 'seuil_tau', [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9], 'ews') };

/* 3. vérification : les seuils laissent-ils passer quelque chose sur calib_mixte ? */
const modules = { cooccurrence, var: varm, ews, chaine, frise, pheno, langage };
console.log('\nrappel sur calib_mixte (contrôle, pas un réglage) :');
for (const [nom, mod] of Object.entries(modules)) {
  let credit = 0, plantes = 0;
  for (const s of mixtes) { const n = noter(mod.analyser(s, seuils[nom]), s.verite, s.T); credit += n.total.credit; plantes += n.total.plantes; }
  console.log(`  ${nom.padEnd(13)} ${(credit / plantes * 100).toFixed(0)} % des items plantés (toutes cellules)`);
}
const empreinte = hacher(fs.readFileSync(ICI + 'generateur.mjs', 'utf-8') + fs.readFileSync(ICI + 'etats.mjs', 'utf-8'));
fs.writeFileSync(ICI + 'calibration.json', JSON.stringify({ famille: 'calib', N, cible: CIBLE, classes, seuils, empreinte }, null, 1));
console.log('\ncalibration.json écrit (empreinte du générateur ' + empreinte + ')');
