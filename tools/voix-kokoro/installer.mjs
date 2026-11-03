/**
 * INSTALLE LA VOIX KOKORO : le modèle et les voix, une fois.
 *
 *   npm install              # les paquets optionnels (espeak-ng, onnxruntime-node)
 *   npm run voix:installer   # ce script : ~350 Mo dans data/kokoro/
 *
 * Les fichiers viennent des publications du projet kokoro-onnx sur GitHub
 * (licence Apache 2.0, comme le modèle Kokoro). Ce sont les seuls
 * téléchargements : une fois là, la voix tourne sans réseau.
 */

import { createWriteStream, existsSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DOSSIER, FICHIER_MODELE, FICHIER_VOIX, manque } from '../../server/kokoro.js';

const SOURCE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0';
// Les tailles exactes : un téléchargement coupé ne doit pas passer pour un modèle.
const FICHIERS = [
  { nom: FICHIER_MODELE, octets: 325532387 },
  { nom: FICHIER_VOIX, octets: 28214398 },
];

const mo = n => (n / 1048576).toFixed(0) + ' Mo';

async function telecharger({ nom, octets }) {
  const cible = join(DOSSIER, nom);
  if (existsSync(cible) && statSync(cible).size === octets) {
    console.log(`  ${nom} : déjà là`);
    return;
  }
  const rep = await fetch(`${SOURCE}/${nom}`);
  if (!rep.ok) throw new Error(`${nom} : HTTP ${rep.status}`);
  const partiel = cible + '.partiel';
  let recus = 0, dernier = 0;
  const flux = Readable.fromWeb(rep.body);
  flux.on('data', b => {
    recus += b.length;
    if (recus - dernier > 8 * 1048576 || recus === octets) {
      dernier = recus;
      process.stdout.write(`\r  ${nom} : ${mo(recus)} / ${mo(octets)}   `);
    }
  });
  await pipeline(flux, createWriteStream(partiel));
  process.stdout.write('\n');
  if (statSync(partiel).size !== octets) {
    rmSync(partiel, { force: true });
    throw new Error(`${nom} : taille inattendue, téléchargement incomplet — relance la commande.`);
  }
  renameSync(partiel, cible);
}

mkdirSync(DOSSIER, { recursive: true });
console.log(`Voix Kokoro → ${DOSSIER}`);
for (const f of FICHIERS) await telecharger(f);

const reste = manque();
if (reste.length) {
  console.log(`\nLe modèle est là, mais il manque encore : ${reste.join(', ')}.`);
  console.log('Lance « npm install » pour les paquets optionnels, puis redémarre l’application.');
  process.exitCode = 1;
} else {
  console.log('\nC’est prêt. Redémarre l’application, puis Réglages › La voix › Kokoro.');
}
