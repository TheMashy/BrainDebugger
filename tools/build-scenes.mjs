/**
 * Assemble les fichiers .glsl des scenes en un module JS importable.
 *
 * Le navigateur ne sait pas importer du GLSL, et on n'a pas d'etape de build :
 * ce script produit `web/scenes.js`, qui est versionne. Le relancer apres avoir
 * touche un .glsl.
 *
 *   node tools/build-scenes.mjs [dossier-des-glsl]
 *
 * Il verifie au passage ce qui casse le plus souvent : une aide commune
 * redefinie, une boucle a borne variable, un `<style>`... enfin, ses equivalents
 * GLSL. Un shader qui ne compile pas donne un fond noir sans message, donc
 * autant echouer ici, bruyamment.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.argv[2] ?? join(ROOT, 'web', 'scenes');
const OUT = join(ROOT, 'web', 'scenes.js');

/* L'ordre compte : c'est l'index numerique passe au shader, et `mood.js` doit
   nommer exactement les memes. La premiere est la scene par defaut. */
const ORDRE = ['drift', 'brume', 'abyss', 'eclipse', 'voidwell', 'monolith', 'grain', 'mandel'];

const AIDES = ['hash11', 'hash21', 'noise2', 'fbm', 'rot', 'sdBox', 'sdSphere', 'smin'];

const fichiers = readdirSync(SRC).filter(f => f.endsWith('.glsl')).sort();
if (!fichiers.length) { console.error(`Aucun .glsl dans ${SRC}`); process.exit(1); }

let glsl = '';
const trouvees = new Map();
const soucis = [];

for (const f of fichiers) {
  const texte = readFileSync(join(SRC, f), 'utf8');

  for (const m of texte.matchAll(/vec3\s+scene_([a-z0-9]+)\s*\(/g)) {
    if (trouvees.has(m[1])) soucis.push(`${m[1]} definie deux fois (${trouvees.get(m[1])} et ${f})`);
    trouvees.set(m[1], f);
  }
  for (const a of AIDES) {
    const re = new RegExp(`^\\s*(float|vec2|vec3|vec4|mat2)\\s+${a}\\s*\\(`, 'm');
    if (re.test(texte)) soucis.push(`${f} redefinit l'aide commune ${a}`);
  }
  // Une borne de boucle non constante ne compile pas en GLSL ES 1.00.
  for (const m of texte.matchAll(/for\s*\([^;]*;[^;]*<\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (!/^\d/.test(m[1])) soucis.push(`${f} : boucle bornee par '${m[1]}', il faut une constante`);
  }
  glsl += `\n// ===== ${f} =====\n${texte.trim()}\n`;
}

const manquantes = ORDRE.filter(id => !trouvees.has(id));
const surplus = [...trouvees.keys()].filter(id => !ORDRE.includes(id));
if (surplus.length) soucis.push(`scenes non declarees dans ORDRE : ${surplus.join(', ')}`);

if (soucis.length) {
  console.error('Problemes :');
  for (const s of soucis) console.error('  -', s);
  process.exit(1);
}

// On n'ecrit que les scenes reellement presentes : le repartiteur et mood.js
// travaillent sur cette liste, donc une scene absente n'est jamais choisie.
const ids = ORDRE.filter(id => trouvees.has(id));

writeFileSync(OUT, `/* Genere par tools/build-scenes.mjs — ne pas editer a la main.
   Source : web/scenes/*.glsl */

export const SCENE_IDS = ${JSON.stringify(ids)};

export const SCENES_GLSL = ${JSON.stringify(glsl)};
`);

console.log(`${ids.length} scenes : ${ids.join(', ')}`);
if (manquantes.length) console.log(`en attente : ${manquantes.join(', ')}`);
console.log(`${OUT} — ${(glsl.length / 1024).toFixed(1)} ko de GLSL`);
