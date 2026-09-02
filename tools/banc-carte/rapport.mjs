/*
 * LE RAPPORT DU TESTEUR : une ligne par journal, puis les cinq conditions.
 * Il ecrit aussi `lectures.json`, que la planche lit pour dessiner les vingt.
 */
import fs from 'node:fs';
import path from 'node:path';
import { toutMesurer } from './mesurer.mjs';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const p = (s, n) => String(s).padEnd(n);
const pc = x => x == null ? '—' : Math.round(x * 100) + '%';

const tout = toutMesurer();
const bonnes = tout.filter(j => j.vues.some(v => v.G));

console.log('\n═══ LES VINGT JOURNAUX, PREMIERE LECTURE ═══\n');
console.log(p('journal', 17), p('nœuds', 6), p('liens', 6), p('îlots', 6), p('dépend.', 8),
            p('recouvr.', 9), p('ponts', 6), p('jetés par valider()', 20), 'pistes nommées');
for (const j of tout) {
  const v = j.vues.find(x => x.G);
  if (!v) { console.log(p(j.id, 17), '— aucune lecture lisible'); continue; }
  const noms = v.lu.pistes.map(x => x.nom).join(', ') || '(aucune)';
  console.log(p(j.id, 17), p(v.G.noeuds.length, 6), p(v.G.liens.length, 6),
              p(v.G.ilots.length, 6), p(v.dependances, 8),
              p(`${v.recouvrement.n}/${v.recouvrement.surTotal}`, 9),
              p(v.ponts.liens, 6),
              p(`${v.perdus.noeuds}n ${v.perdus.liens}l ${v.perdus.pistes}p`, 20), noms);
}

console.log('\n═══ 1. STABILITE — trois lectures independantes du meme corpus ═══\n');
console.log('  « strict » = le même nom aux accents près ; « mou » = les mêmes mots pleins.');
console.log('  « paires tenues » ne porte que sur les paires de nœuds revues dans ≥2 lectures.\n');
console.log(p('journal', 17), p('lect.', 6), p('pistes strict/mou', 18), p('nœuds strict/mou', 17),
            p('paires tenues >80%', 20), p('paires comparables', 19), 'les jeux de noms');
for (const j of tout) {
  const s = j.stab;
  if (!s) { console.log(p(j.id, 17), '— moins de deux lectures'); continue; }
  console.log(p(j.id, 17), p(s.lectures, 6), p(`${pc(s.pistesJ)} / ${pc(s.pistesMou)}`, 18),
              p(`${pc(s.noeudsJ)} / ${pc(s.noeudsMou)}`, 17),
              p(`${s.pairesTenues}/${s.pairesAffichees} (${pc(s.partTenue)})`, 20),
              p(s.revues, 19),
              s.nomsPistes.map(n => '[' + (n.join(' · ') || '∅') + ']').join(' '));
}

console.log('\n═══ 4. RECOUVREMENT — ce que le modele met dans deux pistes, et que le serveur retire ═══\n');
let totalDoubles = 0, totalNoeuds = 0;
for (const j of tout) for (const v of j.vues) {
  if (!v.G) continue;
  totalDoubles += v.recouvrement.n; totalNoeuds += v.recouvrement.surTotal;
  if (v.recouvrement.n) console.log(p(v.fichier, 24),
    v.recouvrement.noeuds.map(x => `« ${x.nom} » ∈ ${x.pistes.map(y => '« ' + y + ' »').join(' + ')}`).join(' | '));
}
console.log(`\n→ ${totalDoubles} nœuds sur ${totalNoeuds} placés dans plus d'une piste par le modèle,`
  + ` sur les ${tout.reduce((s, j) => s + j.vues.filter(v => v.G).length, 0)} lectures.`
  + `\n  validerPistes() en retire un à chaque piste qui le réclame en second (« pris »),`
  + `\n  puis ilotDesNoeuds() applique la même règle une deuxième fois côté client.`);

console.log('\n═══ 3. PONTS — les liens qui traversent deux ilots ═══\n');
for (const j of tout) {
  const v = j.vues.find(x => x.G);
  if (!v?.ponts.liens) continue;
  console.log(p(j.id, 17), `${v.ponts.liens} liens, ${v.ponts.noeuds} nœuds`);
  for (const t of v.ponts.verbes.slice(0, 4)) console.log(' '.repeat(19) + t);
}

console.log('\n═══ LES BOUCLES — les deux sens ecrits par le modele, dont un seul survit ═══\n');
let boucl = 0, pairesTot = 0;
for (const j of tout) for (const v of j.vues) {
  if (!v.G) continue;
  boucl += v.boucles.n; pairesTot += v.boucles.surPaires;
  for (const b of v.boucles.exemples) console.log(p(v.fichier, 24), b.join('  ⇄  '));
}
console.log(`\n→ ${boucl} cercles ecrits sur ${pairesTot} paires. validerCarte() n'en garde qu'un sens :`
  + `\n  le mecanisme « ce qui soulage aggrave » est ecrit par le modele et efface par la validation.`);

console.log('\n═══ 5. ILOT ≠ PATTERN — ce qui appuie chaque ilot dessine ═══\n');
console.log(p('journal', 17), p('îlot', 26), p('n', 4), p('dedans', 7), p('dehors', 7), p('densité', 8), 'appui');
const faibles = [];
for (const j of tout) {
  const v = j.vues.find(x => x.G);
  if (!v) continue;
  for (const a of v.appui) {
    console.log(p(j.id, 17), p(a.nom ?? '(sans nom)', 26), p(a.n, 4), p(a.dedans, 7),
                p(a.dehors, 7), p(a.densite.toFixed(2), 8), a.appui.toFixed(2));
    if (a.densite < 0.34) faibles.push({ j: j.id, ...a });
  }
}
console.log(`\n→ ${faibles.length} îlots dessinés à pleine enveloppe avec une densité interne < 0,34.`);

console.log('\n═══ TEMOINS — une conversation neutre fait-elle pousser une dependance ? ═══\n');
for (const j of tout.filter(x => x.source === 'Topical-Chat')) {
  const v = j.vues.find(x => x.G);
  if (!v) continue;
  console.log(p(j.id, 17), `${v.dependances} nœud(s) « dependance », ${v.lu.pistes.length} piste(s) :`,
              v.lu.pistes.map(x => x.nom).join(', ') || '(aucune)');
}

/* la planche */
fs.writeFileSync(path.join(ICI, 'lectures.json'), JSON.stringify(tout.map(j => {
  const v = j.vues.find(x => x.G);
  return { id: j.id, sujet: j.sujet, source: j.source, jours: j.jours, mots: j.mots,
           lu: v ? v.lu : null, erreur: v ? null : (j.vues[0]?.casse ?? 'aucune lecture') };
}), null, 1));
console.log('\nplanche : lectures.json écrit ·', bonnes.length, 'journaux dessinables');
