/*
 * LA LISTE DE PRÉCHARGEMENT SUIT LE GRAPHE D'IMPORTS.
 *
 * `web/index.html` déclare d'avance chaque module que `app.js` importe
 * statiquement, directement ou non : sans ça le navigateur les découvre un
 * niveau à la fois, et l'ouverture paie un aller-retour réseau par niveau.
 * Une liste écrite à la main vieillit en silence — un module ajouté sans sa
 * ligne retombe dans la cascade, et rien ne casse visiblement. Ce test la
 * recalcule depuis les sources et exige l'égalité.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';

const WEB = new URL('../web/', import.meta.url);
const lire = f => readFileSync(new URL(f, WEB), 'utf8');

function graphe(depart) {
  const vus = new Set();
  const marche = f => {
    if (vus.has(f)) return;
    vus.add(f);
    for (const m of lire(f).matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"](\.\/[^'"]+)['"]/gms))
      marche(posix.normalize(m[1]));
    for (const m of lire(f).matchAll(/^\s*import\s+['"](\.\/[^'"]+)['"]/gm))
      marche(posix.normalize(m[1]));
  };
  marche(depart);
  return vus;
}

test('index.html précharge exactement le graphe statique de app.js', () => {
  const attendus = [...graphe('app.js')].sort();
  const declares = [...lire('index.html').matchAll(/<link rel="modulepreload" href="\/([^"]+)">/g)]
    .map(m => m[1]).sort();
  assert.deepEqual(declares, attendus);
});

test('les imports dynamiques ne sont pas préchargés', () => {
  // pdf.js et consorts ne servent qu'à l'export : les précharger ferait payer
  // à chaque ouverture ce qu'une personne sur cent utilise.
  const html = lire('index.html');
  for (const f of ['pdf.js', 'rapport-seance.js', 'document-rdv.js'])
    assert.ok(!html.includes(`href="/${f}"`), f);
});
