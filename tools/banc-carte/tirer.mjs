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
import { chromium } from 'playwright';
import path from 'node:path';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const PAGE = process.argv[2] ?? 'http://127.0.0.1:4289/planche.html';
const VERS = process.argv[3] ?? path.join(ICI, 'planches');

const nav = await chromium.launch({ executablePath: process.env.CHROMIUM
  ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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
