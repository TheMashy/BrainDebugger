/**
 * Dessine les vingt toiles et en fait des images.
 *
 *   node tools/banc-carte/serveur.mjs &        # sert web/ et ce dossier
 *   node tools/banc-carte/tirer.mjs            # une image par journal
 *
 * Le rendu passe par `dessinerRelations` -- la vraie fonction de la carte, dans
 * un vrai navigateur. Une reimplementation du dessin ne prouverait rien : c'est
 * precisement le dessin qu'on met en cause.
 */
/*
 * PLAYWRIGHT N'EST PAS UNE DEPENDANCE DE CE PROJET, et ne doit pas le devenir :
 * le produit n'en a aucune, et il tient a ca. On va donc le chercher la ou il
 * se trouve, en essayant l'installation locale puis la globale, et on dit quoi
 * faire si aucune ne repond -- plutot qu'un ERR_MODULE_NOT_FOUND brut.
 */
import path from 'node:path';
import { createRequire } from 'node:module';

async function playwright() {
  /* Un chemin de DOSSIER ne s'importe pas en ESM : il faut viser le fichier que
     le paquet declare. `createRequire().resolve` le fait pour nous, et c'est
     aussi lui qui trouve une installation globale que `import 'playwright'`
     ignore. */
  const req = createRequire(import.meta.url);
  const essais = [process.env.PLAYWRIGHT, 'playwright',
                  '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const ou of essais) {
    try { return await import(req.resolve(ou)); } catch { /* suivant */ }
    try { return await import(ou); } catch { /* suivant */ }
  }
  throw new Error('Playwright introuvable. Installe-le (npm i -g playwright) '
    + 'ou donne son chemin : PLAYWRIGHT=/chemin/vers/playwright node tools/banc-carte/tirer.mjs');
}
/* Resolu par `require`, le paquet arrive en CommonJS : ses exports sont sous
   `.default`. Resolu par son nom, ils sont a plat. On accepte les deux. */
const pw = await playwright();
const chromium = pw.chromium ?? pw.default?.chromium;
if (!chromium) throw new Error('Playwright chargé, mais sans `chromium`.');

const ICI = path.dirname(new URL(import.meta.url).pathname);
const PAGE = process.argv[2] ?? 'http://127.0.0.1:4289/planche.html';
const VERS = process.argv[3] ?? path.join(ICI, 'planches');

import fs from 'node:fs';
/* Le navigateur : celui qu'on nous designe, sinon celui que Playwright a
   installe sous PLAYWRIGHT_BROWSERS_PATH, sinon celui qu'il trouve tout seul. */
const dossier = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
const trouve = () => {
  if (process.env.CHROMIUM) return process.env.CHROMIUM;
  try {
    const d = fs.readdirSync(dossier).filter(n => n.startsWith('chromium')).sort().at(-1);
    const c = d && path.join(dossier, d, 'chrome-linux', 'chrome');
    if (c && fs.existsSync(c)) return c;
  } catch { /* Playwright se debrouillera */ }
  return undefined;
};
const nav = await chromium.launch({ executablePath: trouve() });
const p = await nav.newPage({ viewport: { width: 1220, height: 900 } });
const erreurs = [];
p.on('pageerror', e => erreurs.push(e.message));
p.on('console', m => { if (m.type() === 'error') erreurs.push(m.text()); });
await p.goto(PAGE, { waitUntil: 'networkidle' });
await p.waitForFunction('window.pret === true', { timeout: 30000 });
await p.waitForTimeout(600);

const figs = await p.$$('figure');
for (let i = 0; i < figs.length; i++) {
  const id = await figs[i].evaluate(f => f.querySelector('b').textContent);
  await figs[i].screenshot({ path: path.join(VERS, `${String(i).padStart(2, '0')}-${id}.png`) });
}
console.log(`${figs.length} planches → ${VERS}`);
if (erreurs.length) console.log('erreurs :', erreurs);
await nav.close();
