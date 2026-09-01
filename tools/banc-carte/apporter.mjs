/**
 * Va chercher les corpus. Rien de tout ca n'est versionne.
 *
 *   node tools/banc-carte/apporter.mjs
 *
 * Deux corpus publics, telecharges dans `tools/banc-carte/corpus/` :
 *
 *   AnnoMI    133 entretiens motivationnels reels, transcrits et annotes par
 *             des experts (uccollab/AnnoMI). Des gens qui parlent de ce qu'ils
 *             n'arrivent pas a arreter. Mediane 50 tours, 916 mots.
 *   Topical   539 echanges ouverts entre deux inconnus (alexa/Topical-Chat).
 *             Mediane 21 tours. Le TEMOIN : une conversation sur le football
 *             ne doit pas faire pousser un ilot « dependance ».
 *
 * SUR LES LICENCES : aucun des deux depots ne porte de fichier de licence, et
 * aucun de leurs README n'en nomme une (verifie). Les deux sont diffuses
 * publiquement pour la recherche, et rien de plus ne peut etre affirme. C'est
 * la raison pour laquelle ce script TELECHARGE au lieu que le depot EMBARQUE :
 * on ne redistribue pas ce dont on ne connait pas les termes.
 */
import fs from 'node:fs';
import path from 'node:path';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const DOSSIER = path.join(ICI, 'corpus');

const SOURCES = [
  { nom: 'annomi.csv',
    url: 'https://raw.githubusercontent.com/uccollab/AnnoMI/main/AnnoMI-full.csv' },
  { nom: 'topical.json',
    url: 'https://raw.githubusercontent.com/alexa/Topical-Chat/master/conversations/valid_freq.json' }
];

fs.mkdirSync(DOSSIER, { recursive: true });
for (const s of SOURCES) {
  const vers = path.join(DOSSIER, s.nom);
  if (fs.existsSync(vers)) { console.log(`${s.nom} — déjà là (${fs.statSync(vers).size} o)`); continue; }
  process.stdout.write(`${s.nom} … `);
  const r = await fetch(s.url);
  if (!r.ok) { console.log(`échec HTTP ${r.status}`); process.exitCode = 1; continue; }
  const buf = Buffer.from(await r.arrayBuffer());
  fs.writeFileSync(vers, buf);
  console.log(`${buf.length} o`);
}
