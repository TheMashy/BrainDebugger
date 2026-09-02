/*
 * LE BANC D'ESSAI DE LA CARTE.
 *
 * On ne juge pas sur une belle carte : on la lance sur des formes differentes
 * et on regarde CE QU'ELLE PERD. Quatre choses se mesurent sans oeil :
 *   - le RECOUVREMENT perdu : les noeuds que deux pistes nomment, dont une
 *     seule gagne (`ilotDesNoeuds`, premier arrive).
 *   - les PONTS : les liens qui traversent deux ilots, et les noeuds qui les
 *     portent -- ce que le screen demande de mettre devant les halos.
 *   - la STABILITE des grappes sans nom : on retire une part des liens, on
 *     recalcule, on compte combien de paires restent ensemble.
 *   - la DISPOSITION : les enveloppes se traversent-elles, les noeuds se
 *     superposent-ils, en combien de temps.
 */
import { versGraphe, ilotDesNoeuds, LIBRE, contour, cadrer, siensDe } from '../../web/relations.js';
import { disposer } from '../../web/carte.js';
import { CAS, fabriquer, rng } from './echantillons.mjs';

const L = 1200, H = 760;

/** Les noeuds qu'une deuxieme piste reclame et qui lui sont retires. */
function recouvrementPerdu(carte, pistes) {
  const sur = new Set(carte.noeuds.map(n => String(n.nom).toLowerCase()));
  const par = new Map();
  pistes.forEach((p, i) => {
    for (const nm of p.noeuds ?? []) {
      const k = String(nm).toLowerCase();
      if (!sur.has(k)) continue;
      if (!par.has(k)) par.set(k, []);
      if (!par.get(k).includes(i)) par.get(k).push(i);
    }
  });
  return [...par].filter(([, is]) => is.length > 1).map(([k, is]) => ({ nom: k, pistes: is }));
}

/** Les liens qui traversent deux ilots, et les noeuds qui les portent. */
function ponts(G) {
  const cr = G.liens.filter(l => {
    const a = siensDe(G.noeuds[l.s]), b = siensDe(G.noeuds[l.t]);
    return a.length && b.length && !a.some(k => b.includes(k));
  });
  const porteurs = new Set();
  for (const l of cr) { porteurs.add(l.s); porteurs.add(l.t); }
  return { liens: cr.length, noeuds: [...porteurs] };
}

/** Les grappes sans nom tiennent-elles quand on retire des liens ? */
function stabiliteGrappes(carte, pistes, { tirages = 100, retire = 0.2, graine = 3 } = {}) {
  const r = rng(graine);
  const base = versGraphe(carte, pistes);
  const orph = base.noeuds.filter(n => n.ilot != null && n.ilot >= LIBRE).map(n => n.nom);
  if (orph.length < 2) return { paires: 0, survivantes: 0, part: null, orphelins: orph.length };
  const ensemble = new Map();   // "a|b" -> combien de fois dans la meme grappe
  for (let t = 0; t < tirages; t++) {
    const liens = carte.liens.filter(() => r() >= retire);
    const g = versGraphe({ noeuds: carte.noeuds, liens }, pistes);
    const ilotDe = new Map(g.noeuds.map(n => [n.nom, n.ilot]));
    for (let i = 0; i < orph.length; i++)
      for (let j = i + 1; j < orph.length; j++) {
        const a = ilotDe.get(orph[i]), b = ilotDe.get(orph[j]);
        const cle = orph[i] + '|' + orph[j];
        const meme = a != null && a >= LIBRE && a === b;
        ensemble.set(cle, (ensemble.get(cle) ?? 0) + (meme ? 1 : 0));
      }
  }
  // Les paires QUE LA CARTE AFFICHE ensemble aujourd'hui.
  const ilotBase = new Map(base.noeuds.map(n => [n.nom, n.ilot]));
  const affichees = [...ensemble].filter(([cle]) => {
    const [a, b] = cle.split('|');
    const x = ilotBase.get(a);
    return x != null && x >= LIBRE && x === ilotBase.get(b);
  });
  const survivantes = affichees.filter(([, c]) => c / tirages > 0.8).length;
  return { paires: affichees.length, survivantes,
           part: affichees.length ? survivantes / affichees.length : null,
           orphelins: orph.length };
}

/** Les enveloppes se traversent-elles ? Aire d'intersection approchee (grille). */
function croisementEnveloppes(G, pts) {
  const parIlot = new Map();
  G.noeuds.forEach((n, i) => {
    // Un noeud dans deux ilots est dans les DEUX enveloppes : c'est le
    // recouvrement, et c'est precisement ce que cette mesure doit voir.
    for (const k of siensDe(n)) {
      if (!parIlot.has(k)) parIlot.set(k, []);
      parIlot.get(k).push(pts[i]);
    }
  });
  const formes = [...parIlot].map(([i, p]) => ({ i, bord: contour(p, 30) })).filter(f => f.bord?.length >= 3);
  const dedans = (bord, x, y) => {
    let ok = false;
    for (let i = 0, j = bord.length - 1; i < bord.length; j = i++) {
      const xi = bord[i].x, yi = bord[i].y, xj = bord[j].x, yj = bord[j].y;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ok = !ok;
    }
    return ok;
  };
  let croisees = 0, aires = new Map(), inter = 0;
  const PAS = 6;
  for (let x = 0; x < L; x += PAS) for (let y = 0; y < H; y += PAS) {
    let n = 0;
    for (const f of formes) if (dedans(f.bord, x, y)) { n++; aires.set(f.i, (aires.get(f.i) ?? 0) + 1); }
    if (n > 1) inter++;
  }
  const total = [...aires.values()].reduce((a, b) => a + b, 0);
  for (let a = 0; a < formes.length; a++) for (let b = a + 1; b < formes.length; b++) {
    let touche = false;
    for (const q of formes[b].bord) if (dedans(formes[a].bord, q.x, q.y)) { touche = true; break; }
    if (touche) croisees++;
  }
  return { formes: formes.length, pairesCroisees: croisees,
           partRecouverte: total ? inter / total : 0 };
}

/** Deux noeuds trop proches pour etre distingues. */
function superpositions(G, pts) {
  const rayon = n => 5 + Math.sqrt(n.jours || 1) * 1.4;
  let n = 0, mind = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
    mind = Math.min(mind, d);
    if (d < rayon(G.noeuds[i]) + rayon(G.noeuds[j])) n++;
  }
  return { collisions: n, plusProche: Math.round(mind) };
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('cas', 12), pad('nœuds', 6), pad('liens', 6), pad('îlots', 6),
            pad('recouvr.', 9), pad('ponts', 6), pad('nœuds-pont', 11),
            pad('grappes>80%', 12), pad('env. croisées', 14), pad('% recouvert', 12),
            pad('collisions', 11), 'ms');
for (const c of CAS) {
  const { carte, pistes } = fabriquer(c.o);
  const G = versGraphe(carte, pistes);
  const t0 = performance.now();
  const { pts } = disposer(G, L, H);
  const ms = Math.round(performance.now() - t0);
  cadrer(pts, L, H);
  const perdu = recouvrementPerdu(carte, pistes);
  const p = ponts(G);
  const st = stabiliteGrappes(carte, pistes);
  const cr = croisementEnveloppes(G, pts);
  const sp = superpositions(G, pts);
  console.log(pad(c.id, 12), pad(G.noeuds.length, 6), pad(G.liens.length, 6),
              pad(G.ilots.length, 6), pad(perdu.length, 9), pad(p.liens, 6),
              pad(p.noeuds.length, 11),
              pad(st.part == null ? '—' : `${st.survivantes}/${st.paires}`, 12),
              pad(`${cr.pairesCroisees}/${cr.formes}`, 14),
              pad((cr.partRecouverte * 100).toFixed(1) + '%', 12),
              pad(sp.collisions, 11), ms);
}
