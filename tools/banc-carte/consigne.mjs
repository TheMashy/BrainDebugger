/**
 * Prepare le tissage : les vingt journaux, et la consigne exacte a donner au
 * modele de lecture.
 *
 *   node tools/banc-carte/consigne.mjs
 *
 * Il ecrit `journaux/*.txt` (le corpus, au format que `corpusPour()` produit),
 * `journaux/index.json`, et `systeme.txt` -- le prompt systeme EXTRAIT DE
 * server/lecture.js a l'instant meme.
 *
 * Extrait, et pas recopie : une copie du prompt vieillit en silence, et le banc
 * se mettrait a mesurer un produit qui n'existe plus. Si l'extraction casse
 * parce que la constante a bouge, le script s'arrete -- ce qui est le bon
 * comportement : mieux vaut un banc qui refuse de tourner qu'un banc qui ment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { choisir, corpusTexte } from './corpus.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const LECT = path.join(ICI, '..', '..', 'server', 'lecture.js');

/* le prompt systeme, tel qu'il est en ce moment */
const src = fs.readFileSync(LECT, 'utf8');
const OUVRE = 'const SYSTEME = `';
const d = src.indexOf(OUVRE);
if (d < 0) throw new Error(`SYSTEME introuvable dans ${LECT} — la constante a changé de forme.`);
const f = src.indexOf('`;', d + OUVRE.length);
if (f < 0) throw new Error('SYSTEME non terminé — le gabarit ne se ferme pas.');
const systeme = src.slice(d + OUVRE.length, f);
if (/\$\{/.test(systeme)) throw new Error('SYSTEME contient une interpolation : elle serait rendue littéralement.');
fs.writeFileSync(path.join(ICI, 'systeme.txt'), systeme);

/* les vingt journaux */
const dossier = path.join(ICI, 'journaux');
fs.mkdirSync(dossier, { recursive: true });
const index = [];
for (const j of choisir()) {
  const t = corpusTexte(j);
  fs.writeFileSync(path.join(dossier, j.id + '.txt'), t);
  index.push({ id: j.id, source: j.source, sujet: j.sujet, tours: j.tours, mots: j.mots,
               jours: j.jours.length, dates: j.jours.map(x => x.date), octets: t.length });
}
fs.writeFileSync(path.join(dossier, 'index.json'), JSON.stringify(index, null, 2));

console.log(`systeme.txt : ${systeme.length} o`);
console.log(`journaux    : ${index.length}, ${index.reduce((s, x) => s + x.octets, 0)} o`);
const courts = index.filter(x => x.jours < 12);
if (courts.length) console.log(`⚠ sous MIN_JOURS (12) : ${courts.map(x => x.id).join(', ')}`);
console.log(index.map(x => `${x.id} ${x.jours}j`).join(' · '));
