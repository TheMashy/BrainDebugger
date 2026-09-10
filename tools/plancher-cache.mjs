#!/usr/bin/env node
/**
 * LE PLANCHER DE CACHE, VERIFIE AVANT DE CHANGER DE MODELE.
 *
 * Un prefixe plus court que le minimum du modele NE SE MET PAS EN CACHE, et
 * rien ne le dit : pas d'erreur, pas d'avertissement, juste
 * `cache_creation_input_tokens: 0` et une facture au plein tarif. Sur
 * Haiku 4.5 ce minimum est de 4 096 jetons -- quatre fois celui de Sonnet 5.
 * Un prompt qu'on raccourcit pour economiser peut donc devenir plus cher que
 * celui qu'on remplace.
 *
 *   node tools/plancher-cache.mjs
 *   node tools/plancher-cache.mjs --modele claude-haiku-4-5 --fil 2000
 *
 * Les jetons sont ESTIMES (3,3 caracteres par jeton, comme la sonde de cout) :
 * ce script dit ou on se situe par rapport au plancher, il ne remplace pas un
 * `count_tokens` le jour ou une cle existe.
 */
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ICI = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const MODELE = opt('--modele', 'claude-haiku-4-5');
const FIL = Number(opt('--fil', 2600));   // memoire + fil + echos, en jetons

/* Le minimum cacheable, par modele. Il n'est PAS monotone d'une generation a
   l'autre : 512 sur Opus 5, 4 096 sur Haiku 4.5. */
const PLANCHER = {
  'claude-opus-5': 512, 'claude-fable-5': 512,
  'claude-opus-4-8': 1024, 'claude-sonnet-5': 1024, 'claude-sonnet-4-6': 1024,
  'claude-opus-4-7': 2048,
  'claude-opus-4-6': 4096, 'claude-haiku-4-5': 4096
};
const TARIF = { 'claude-opus-5': 5, 'claude-sonnet-5': 2, 'claude-haiku-4-5': 1 };

const { OUTILS, SYSTEM_PROMPT } = await import(pathToFileURL(join(ICI, 'server/chat.js')).href);

const jetons = car => Math.round(car / 3.3);
const outils = jetons(Object.entries(OUTILS)
  .map(([n, d]) => JSON.stringify({ name: n, ...d }).length).reduce((a, b) => a + b, 0));
const systeme = jetons(SYSTEM_PROMPT.length);
const plancher = PLANCHER[MODELE] ?? 1024;
const prix = TARIF[MODELE] ?? 2;

const points = [
  ['outils',                          outils],
  ['+ systeme  (point de reprise 1)', outils + systeme],
  ['+ fil      (reprise automatique)', outils + systeme + FIL]
];

console.log(`modele ${MODELE} — plancher de cache ${plancher} jetons\n`);
for (const [nom, n] of points) {
  const ok = n >= plancher;
  console.log(`${ok ? 'OK  ' : 'MUET'}  ${nom.padEnd(34)} ${String(n).padStart(6)} jetons`
    + (ok ? '' : `   (${plancher - n} de moins que le plancher)`));
}

const total = outils + systeme + FIL;
const cache = total >= plancher;
const relu = cache ? total * 0.97 * prix * 0.1 / 1e6 : 0;
const plein = (cache ? total * 0.03 : total) * prix / 1e6;
console.log(`\nentree par echange : ${(relu + plein).toFixed(6)} $`
  + (cache ? '  (97 % relu du cache)' : '  — RIEN N’EST MIS EN CACHE, plein tarif a chaque echange'));
if (!cache) {
  const cible = plancher;
  console.log(`a ${cible} jetons de prefixe, la meme entree couterait `
    + `${(cible * 0.97 * prix * 0.1 / 1e6 + cible * 0.03 * prix / 1e6).toFixed(6)} $ :`
    + ` un prompt PLUS LONG serait moins cher.`);
}
