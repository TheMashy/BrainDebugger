/*
 * CE QU'ON MESURE SUR VINGT VRAIES TOILES.
 *
 * Chaque journal a ete lu TROIS FOIS, par trois lectures qui ne se voient pas.
 * C'est la seule facon de repondre a la premiere condition du screen : un
 * groupe qu'on affiche doit survivre a la relecture, sinon on montre un tirage.
 *
 * Le brut du modele passe par `valider()` -- la vraie fonction du serveur, pas
 * une imitation. Ce que le produit jette, le testeur le jette aussi ; et ce
 * qu'il jette est justement l'une des mesures : `validerPistes` retire un noeud
 * a toute piste qui le reclame en second (`pris`), donc le RECOUVREMENT se
 * mesure sur le brut, avant que le serveur ne l'efface.
 */
import fs from 'node:fs';
import path from 'node:path';
import { valider } from '../../server/lecture.js';
import { versGraphe, ilotDesNoeuds, LIBRE, contour, cadrer, siensDe } from '../../web/relations.js';
import { disposer } from '../../web/carte.js';

const ICI = path.dirname(new URL(import.meta.url).pathname);
/* `BANC_LECTURES` permet de mesurer un jeu de lectures range ailleurs -- deux
   tissages du meme corpus se comparent alors sans se marcher dessus. */
export const LECTURES = process.env.BANC_LECTURES || path.join(ICI, 'lectures');
const L = 1180, H = 640;

export function index() {
  return JSON.parse(fs.readFileSync(path.join(ICI, 'journaux', 'index.json'), 'utf8'));
}

/** Les lectures d'un journal, brutes puis validees par le serveur. */
export function lectures(id, dates) {
  const out = [];
  for (const f of fs.readdirSync(LECTURES).sort()) {
    if (!f.startsWith(id + '-r') || !f.endsWith('.json')) continue;
    let brut;
    try { brut = JSON.parse(fs.readFileSync(path.join(LECTURES, f), 'utf8')); }
    catch (e) { out.push({ fichier: f, casse: e.message }); continue; }
    out.push({ fichier: f, brut, lu: valider(brut, dates) });
  }
  return out;
}

/* ------------------------------ le recouvrement ------------------------------ */

/**
 * Les noeuds que le MODELE a mis dans plusieurs pistes, avant que le serveur
 * n'en retire un a chaque piste suivante.
 */
export function recouvrementBrut(brut) {
  const sur = new Set((brut?.carte?.noeuds ?? []).map(n => String(n.nom).trim().toLowerCase()));
  const par = new Map();
  for (const p of brut?.pistes ?? [])
    for (const n of p?.noeuds ?? []) {
      const k = String(n).trim().toLowerCase();
      if (!sur.has(k)) continue;
      if (!par.has(k)) par.set(k, new Set());
      par.get(k).add(String(p.nom).trim().toLowerCase());
    }
  const doubles = [...par].filter(([, s]) => s.size > 1);
  return { noeuds: doubles.map(([k, s]) => ({ nom: k, pistes: [...s] })),
           n: doubles.length, surTotal: par.size };
}

/* --------------------------------- les ponts --------------------------------- */

export function ponts(G) {
  const cr = G.liens.filter(l => {
    const a = siensDe(G.noeuds[l.s]), b = siensDe(G.noeuds[l.t]);
    return a.length && b.length && !a.some(k => b.includes(k));
  });
  const porteurs = new Set();
  for (const l of cr) { porteurs.add(l.s); porteurs.add(l.t); }
  return { liens: cr.length, noeuds: porteurs.size,
           verbes: cr.map(l => `${G.noeuds[l.s].nom} —${l.quoi}→ ${G.noeuds[l.t].nom}`) };
}

/* ------------------------------- LES BOUCLES -------------------------------
 *
 * Le modele ecrit parfois les DEUX SENS entre deux choses : « les moments a
 * plat — c'est la que tu sers → le vin le soir », et « le vin le soir — te les
 * rend plus lourds → les moments a plat ». C'est un cercle, et un cercle est le
 * mecanisme meme que cette application cherche : ce qui soulage aggrave, donc
 * il faut recommencer.
 *
 * `validerCarte` garde UN lien par paire (la cle est triee), donc le second
 * sens disparait -- et avec lui le seul endroit de la carte ou un mecanisme
 * s'explique tout seul. On compte ici ce que ca coute.
 */
export function boucles(brut) {
  const par = new Map();
  for (const l of brut?.carte?.liens ?? []) {
    const de = String(l?.de ?? '').trim().toLowerCase(), vers = String(l?.vers ?? '').trim().toLowerCase();
    if (!de || !vers || de === vers) continue;
    const cle = [de, vers].sort().join('|');
    if (!par.has(cle)) par.set(cle, []);
    par.get(cle).push(`${l.de} —${l.quoi}→ ${l.vers}`);
  }
  const doubles = [...par.values()].filter(v => v.length > 1);
  return { n: doubles.length, surPaires: par.size, exemples: doubles };
}

/* --------------------------------- l'appui --------------------------------- */

export function appuiDesIlots(G) {
  const par = new Map();
  G.noeuds.forEach((n, i) => {
    for (const k of siensDe(n)) {
      if (!par.has(k)) par.set(k, new Set());
      par.get(k).add(i);
    }
  });
  return [...par].map(([i, m]) => {
    let dedans = 0, dehors = 0;
    for (const l of G.liens) {
      const a = m.has(l.s), b = m.has(l.t);
      if (a && b) dedans++; else if (a || b) dehors++;
    }
    const paires = m.size * (m.size - 1) / 2;
    return { i, nom: G.ilots.find(x => x.i === i)?.nom ?? null, n: m.size, dedans, dehors,
             densite: paires ? dedans / paires : 0,
             appui: dedans + dehors ? dedans / (dedans + dehors) : 0 };
  }).sort((a, b) => a.i - b.i);
}

/* ------------------------------- la stabilite -------------------------------
 *
 * TROIS LECTURES DU MEME CORPUS. Ce qui se compare :
 *
 *   noms de pistes  — le modele rappelle-t-il les memes grandes directions ?
 *   noms de noeuds  — voit-il les memes choses ?
 *   PAIRES          — la mesure qui compte. Pour chaque paire de noeuds
 *                     presents dans au moins deux lectures : combien de fois
 *                     sont-ils dans le MEME ilot ? Une paire que la carte
 *                     affiche ensemble aujourd'hui et qui ne se retrouve
 *                     ensemble qu'une fois sur trois est un tirage, pas un
 *                     groupe -- et c'est exactement ce que le screen demande de
 *                     ne pas afficher.
 */
/*
 * DEUX MESURES, PARCE QU'UNE SEULE MENTIRAIT DANS UN SENS OU DANS L'AUTRE.
 *
 * STRICTE : la chaine, aux accents et a la casse pres. « dependance » et
 * « dépendance » sont le meme nom -- les compter pour deux ferait paraitre le
 * modele plus instable qu'il n'est, et une mesure qui charge son sujet ne vaut
 * rien.
 *
 * INDULGENTE : deux noms comptent pour un s'ils partagent la majorite de leurs
 * mots pleins. « le vin le soir » et « le vin du soir » designent la meme
 * chose ; les separer ferait paraitre le modele plus instable qu'il n'est, lui
 * aussi. Mais « les moments a plat » et « la depression » restent deux noms
 * differents -- et c'est bien la difference qui compte, parce que le second est
 * un mot de nosographie et le premier non.
 *
 * On rend les deux. L'ecart entre elles est lui-meme une information : quand
 * l'indulgente est haute et la stricte basse, le modele voit les memes choses
 * et les appelle autrement ; quand les deux sont basses, il ne voit pas les
 * memes choses.
 */
const PLEIN = new Set(['le','la','les','un','une','des','du','de','au','aux','a','à','et','ou',
                       'ton','ta','tes','son','sa','ses','ce','cette','ces','qui','que','en','dans']);
export const nu = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const motsPleins = s => new Set(nu(s).split(/[^a-z0-9']+/).filter(m => m && !PLEIN.has(m)));

const jaccard = (a, b) => {
  const A = new Set([...a].map(nu)), B = new Set([...b].map(nu));
  let c = 0;
  for (const x of A) if (B.has(x)) c++;
  const u = A.size + B.size - c;
  return u ? c / u : null;
};

/** Jaccard indulgent : deux noms se valent s'ils partagent la moitie de leurs mots pleins. */
const jaccardMou = (a, b) => {
  const A = [...new Set([...a].map(nu))], B = [...new Set([...b].map(nu))];
  if (!A.length && !B.length) return null;
  const pris = new Set();
  let c = 0;
  for (const x of A) {
    const mx = motsPleins(x);
    for (let i = 0; i < B.length; i++) {
      if (pris.has(i)) continue;
      const my = motsPleins(B[i]);
      let inter = 0;
      for (const m of mx) if (my.has(m)) inter++;
      const petit = Math.min(mx.size, my.size) || 1;
      if (x === B[i] || inter / petit >= 0.5) { pris.add(i); c++; break; }
    }
  }
  const u = A.length + B.length - c;
  return u ? c / u : null;
};

export function stabilite(vues) {
  const bonnes = vues.filter(v => v.G);
  if (bonnes.length < 2) return null;

  const nomsP = bonnes.map(v => v.lu.pistes.map(p => p.nom));
  const nomsN = bonnes.map(v => v.G.noeuds.map(n => String(n.nom)));

  const paires = (xs, f) => {
    const out = [];
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push(f(xs[i], xs[j]));
    return out.filter(x => x != null);
  };
  const moy = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

  // co-appartenance : nom|nom -> [vu ensemble, vu tous les deux]
  const co = new Map();
  for (const v of bonnes) {
    const ilotDe = new Map(v.G.noeuds.map(n => [nu(n.nom), n.ilot]));
    const noms = [...ilotDe.keys()].sort();
    for (let i = 0; i < noms.length; i++) for (let j = i + 1; j < noms.length; j++) {
      const cle = noms[i] + '|' + noms[j];
      if (!co.has(cle)) co.set(cle, { ens: 0, vus: 0 });
      const e = co.get(cle);
      e.vus++;
      const a = ilotDe.get(noms[i]), b = ilotDe.get(noms[j]);
      if (a != null && a === b) e.ens++;
    }
  }
  const revues = [...co.values()].filter(e => e.vus >= 2);
  // Les paires que la carte AFFICHE groupees dans la premiere lecture.
  const prem = bonnes[0];
  const ilot0 = new Map(prem.G.noeuds.map(n => [nu(n.nom), n.ilot]));
  const affichees = [...co].filter(([cle]) => {
    const [a, b] = cle.split('|');
    const x = ilot0.get(a);
    return x != null && x === ilot0.get(b);
  }).map(([, e]) => e).filter(e => e.vus >= 2);
  const tenues = affichees.filter(e => e.ens / e.vus > 0.8).length;

  return {
    lectures: bonnes.length,
    pistesJ: moy(paires(nomsP, jaccard)),
    pistesMou: moy(paires(nomsP, jaccardMou)),
    noeudsJ: moy(paires(nomsN, jaccard)),
    noeudsMou: moy(paires(nomsN, jaccardMou)),
    pairesAffichees: affichees.length,
    pairesTenues: tenues,
    partTenue: affichees.length ? tenues / affichees.length : null,
    revues: revues.length,
    nomsPistes: nomsP
  };
}

/* --------------------------------- le tout --------------------------------- */

export function toutMesurer() {
  const idx = index();
  const out = [];
  for (const j of idx) {
    const dates = new Set(j.dates);
    const vues = lectures(j.id, dates).map(v => {
      if (v.casse) return v;
      const G = versGraphe(v.lu.carte, v.lu.pistes);
      const { pts } = disposer(G, L, H);
      cadrer(pts, L, H);
      return { ...v, G, pts,
               recouvrement: recouvrementBrut(v.brut),
               boucles: boucles(v.brut),
               ponts: ponts(G),
               appui: appuiDesIlots(G),
               // ce que la validation du serveur a retire
               perdus: {
                 noeuds: (v.brut?.carte?.noeuds?.length ?? 0) - v.lu.carte.noeuds.length,
                 liens: (v.brut?.carte?.liens?.length ?? 0) - v.lu.carte.liens.length,
                 pistes: (v.brut?.pistes?.length ?? 0) - v.lu.pistes.length
               },
               dependances: v.lu.carte.noeuds.filter(n => n.genre === 'dependance').length };
    });
    out.push({ ...j, vues, stab: stabilite(vues) });
  }
  return out;
}
