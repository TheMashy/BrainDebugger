/**
 * Le rendu de la carte.
 *
 * Une disposition par forces sur canvas : répulsion entre tous les mots,
 * ressorts sur les liens, et un rappel vers le centre de leur amas. Trois
 * termes, rien de plus — une simulation plus riche demanderait des réglages
 * qu'on ne saurait pas justifier, pour une image qui ne serait pas plus juste.
 *
 * DEUX CHOSES QUI DÉCIDENT DU RÉSULTAT
 *
 * La couleur vient des notes, pas d'une palette. Un mot rouge est un mot des
 * journées basses — même échelle que la grille et que l'écart quotidien. Des
 * teintes décoratives feraient une image ; celles-ci font une lecture.
 *
 * La disposition est déterministe. Les positions de départ viennent d'un tirage
 * à graine fixe, pas de Math.random : deux ouvertures de la même carte donnent
 * la même image. Un journal qui se réorganise à chaque visite ne se reconnaît
 * pas, et c'est précisément la reconnaissance qu'on cherche ici.
 */

import { deltaColor } from './charts.js';

const TOURS = 320;          // itérations calculées avant le premier affichage
const REPULSION = 5200;
const RESSORT = 0.028;
const AMAS_RAPPEL = 0.010;
const CENTRE_RAPPEL = 0.0016;
const FROTTEMENT = 0.86;

/* Tirage a graine : la meme carte doit se redessiner identique. */
function graine(n) {
  let s = 20260827 ^ n;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function disposer(G, largeur, hauteur) {
  const n = G.noeuds.length;
  if (!n) return { pts: [], centres: new Map() };
  const r = graine(n);

  // Depart en spirale plutot qu'au hasard pur : la simulation converge plus
  // vite et surtout de facon reproductible.
  const pts = G.noeuds.map((nd, i) => {
    const a = i * 2.399963;                        // angle d'or
    const d = 0.42 * Math.min(largeur, hauteur) * Math.sqrt(i / n);
    return {
      x: largeur / 2 + Math.cos(a) * d + (r() - 0.5) * 8,
      y: hauteur / 2 + Math.sin(a) * d + (r() - 0.5) * 8,
      vx: 0, vy: 0,
      poids: 1 + Math.log2(1 + nd.jours)
    };
  });

  const voisins = pts.map(() => []);
  for (const l of G.liens) {
    voisins[l.s].push([l.t, l.force]);
    voisins[l.t].push([l.s, l.force]);
  }

  const amasDe = G.noeuds.map(nd => nd.amas);
  const centres = new Map();

  for (let t = 0; t < TOURS; t++) {
    // Centre de chaque amas, recalcule a chaque tour : c'est lui qui regroupe.
    centres.clear();
    for (let i = 0; i < n; i++) {
      const a = amasDe[i];
      if (!centres.has(a)) centres.set(a, { x: 0, y: 0, k: 0 });
      const c = centres.get(a);
      c.x += pts[i].x; c.y += pts[i].y; c.k++;
    }
    for (const c of centres.values()) { c.x /= c.k; c.y /= c.k; }

    // Repulsion, tous contre tous. Soixante noeuds : la boucle quadratique
    // coute deux mille paires par tour, c'est negligeable et exact.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = (i - j) || 1; dy = 1; d2 = 1; }
        const f = REPULSION / d2;
        const d = Math.sqrt(d2);
        const fx = dx / d * f, fy = dy / d * f;
        pts[i].vx -= fx; pts[i].vy -= fy;
        pts[j].vx += fx; pts[j].vy += fy;
      }
    }

    // Ressorts : plus le lien est fort, plus les deux mots se rapprochent.
    for (const l of G.liens) {
      const a = pts[l.s], b = pts[l.t];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      const cible = 120 - 60 * Math.min(1, l.force * 3);
      const f = (d - cible) * RESSORT * (0.4 + l.force);
      const fx = dx / d * f, fy = dy / d * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    for (let i = 0; i < n; i++) {
      const c = centres.get(amasDe[i]);
      pts[i].vx += (c.x - pts[i].x) * AMAS_RAPPEL;
      pts[i].vy += (c.y - pts[i].y) * AMAS_RAPPEL;
      pts[i].vx += (largeur / 2 - pts[i].x) * CENTRE_RAPPEL;
      pts[i].vy += (hauteur / 2 - pts[i].y) * CENTRE_RAPPEL;
      pts[i].vx *= FROTTEMENT; pts[i].vy *= FROTTEMENT;
      pts[i].x += pts[i].vx; pts[i].y += pts[i].vy;
    }
  }

  // On ramene dans le cadre plutot que de laisser des mots sortir : une carte
  // dont un amas est coupe par le bord se lit comme une carte incomplete.
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const marge = 74;
  const sx = (largeur - marge * 2) / Math.max(1, x1 - x0);
  const sy = (hauteur - marge * 2) / Math.max(1, y1 - y0);
  const s = Math.min(sx, sy, 1.6);
  for (const p of pts) {
    p.x = marge + (p.x - x0) * s + (largeur - marge * 2 - (x1 - x0) * s) / 2;
    p.y = marge + (p.y - y0) * s + (hauteur - marge * 2 - (y1 - y0) * s) / 2;
  }
  for (const c of centres.values()) {
    c.x = marge + (c.x - x0) * s + (largeur - marge * 2 - (x1 - x0) * s) / 2;
    c.y = marge + (c.y - y0) * s + (hauteur - marge * 2 - (y1 - y0) * s) / 2;
  }

  return { pts, centres };
}

const couleur = (note, moyenne) =>
  note === null || note === undefined ? 'rgb(120,128,124)' : deltaColor(note - (moyenne ?? 6));

export function dessiner(ctx, G, dispo, { largeur, hauteur, survol = -1, dpr = 1 }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largeur, hauteur);
  const { pts, centres } = dispo;
  if (!pts.length) return;

  const moy = G.moyenneGlobale;
  const voisinsDuSurvol = new Set();
  if (survol >= 0) {
    voisinsDuSurvol.add(survol);
    for (const l of G.liens) {
      if (l.s === survol) voisinsDuSurvol.add(l.t);
      if (l.t === survol) voisinsDuSurvol.add(l.s);
    }
  }

  /* --- les liens, en courbes --- */
  ctx.lineCap = 'round';
  for (const l of G.liens) {
    const a = pts[l.s], b = pts[l.t];
    const actif = survol < 0 || l.s === survol || l.t === survol;
    const c = couleur(G.noeuds[l.s].note, moy);
    // Une courbe plutot qu'un segment : deux droites qui se croisent font un
    // reseau, deux courbes font un tissu. C'est la difference entre un schema
    // et quelque chose qu'on a envie de regarder.
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const courbe = 0.14;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(mx - dy * courbe, my + dx * courbe, b.x, b.y);
    ctx.strokeStyle = c;
    ctx.globalAlpha = actif ? 0.10 + l.force * 0.85 : 0.035;
    ctx.lineWidth = 0.6 + l.force * 2.6;
    ctx.stroke();
  }

  /* --- les mots --- */
  ctx.globalAlpha = 1;
  for (let i = 0; i < G.noeuds.length; i++) {
    const nd = G.noeuds[i], p = pts[i];
    const actif = survol < 0 || voisinsDuSurvol.has(i);
    const rayon = 2.4 + Math.sqrt(nd.jours) * 1.05;
    const c = couleur(nd.note, moy);

    // Halo : c'est lui qui donne la matiere. Sans, on a des ronds sur du noir.
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rayon * 5.5);
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = actif ? 0.30 : 0.07;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, rayon * 5.5, 0, 7); ctx.fill();

    ctx.globalAlpha = actif ? 1 : 0.22;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(p.x, p.y, rayon, 0, 7); ctx.fill();

    // Un repere d'etalonnage porte un anneau : ce sont les seuls mots que
    // l'utilisateur a lui-meme designes.
    if (nd.repere) {
      ctx.strokeStyle = '#e9efeb';
      ctx.globalAlpha = actif ? 0.55 : 0.12;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(p.x, p.y, rayon + 3.5, 0, 7); ctx.stroke();
    }
  }

  /* --- les etiquettes ---
     Le point faible d'une carte de mots : cinquante etiquettes qui se
     chevauchent ne se lisent pas ET cachent la forme, donc on perd les deux.
     On place donc du plus important au moins important, et on saute celles qui
     mordraient sur une deja posee. Mieux vaut un mot lisible que trois
     illisibles empiles.

     Quatre positions sont essayees autour du point avant d'abandonner : au
     dessus d'abord, parce que c'est la que l'oeil relie l'etiquette a son
     point sans hesiter. */
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const poses = [];
  const chevauche = (x, y, w, h) => poses.some(r =>
    Math.abs(x - r.x) < (w + r.w) / 2 + 3 && Math.abs(y - r.y) < (h + r.h) / 2 + 2);

  /* Les noms d'amas reservent leur place AVANT les mots.
     Ils perdaient systematiquement la course : les etiquettes de mots se
     posaient d'abord, et sur sept groupes un seul finissait par s'afficher --
     ce qui se lit moins bien que zero, parce qu'un titre isole donne
     l'impression que les autres groupes n'en ont pas. Sept noms poses d'abord
     coutent sept mots deplaces d'un cran, et ce sont eux qui donnent a la
     carte sa lecture d'ensemble. */
  const titres = [];
  if (survol < 0) {
    ctx.letterSpacing = '0.12em';
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    for (const a of G.amas) {
      if (a.taille < 3) continue;
      const c = centres.get(a.id);
      if (!c) continue;
      const membres = G.noeuds.map((n, i) => n.amas === a.id ? pts[i] : null).filter(Boolean);
      const bas = Math.max(...membres.map(p => p.y));
      const texte = a.nom.toUpperCase();
      const w = ctx.measureText(texte).width;
      // Trois hauteurs sous le groupe : deux titres d'amas voisins ne doivent
      // pas se marcher dessus non plus.
      const y = [bas + 26, bas + 42, bas + 58].find(yy => !chevauche(c.x, yy, w, 14));
      if (y === undefined) continue;
      poses.push({ x: c.x, y, w, h: 14 });
      titres.push({ texte, x: c.x, y, note: a.note });
    }
    ctx.letterSpacing = '0px';
  }

  const ordre = G.noeuds
    .map((nd, i) => ({ i, nd, poids: nd.jours * (nd.repere ? 2 : 1) + (i === survol ? 1e6 : 0)
                                     + (voisinsDuSurvol.has(i) ? 1e3 : 0) }))
    .sort((a, b) => b.poids - a.poids);

  for (const { i, nd } of ordre) {
    const p = pts[i];
    const actif = survol >= 0 && voisinsDuSurvol.has(i);
    if (survol >= 0 && !actif) continue;          // au survol, on ne montre que le voisinage

    const taille = 10.5 + Math.min(4.5, Math.sqrt(nd.jours) * 0.75);
    ctx.font = `${i === survol ? 600 : 400} ${taille}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    const w = ctx.measureText(nd.mot).width;
    const h = taille * 1.15;
    const r = 2.4 + Math.sqrt(nd.jours) * 1.05;

    const essais = [
      [p.x, p.y - r - h * 0.72],
      [p.x, p.y + r + h * 0.72],
      [p.x + r + w / 2 + 5, p.y],
      [p.x - r - w / 2 - 5, p.y]
    ];
    const place = essais.find(([x, y]) => !chevauche(x, y, w, h));
    if (!place) continue;
    const [lx, ly] = place;
    poses.push({ x: lx, y: ly, w, h });

    // Contour sombre : sans lui, un mot pose sur un lien clair devient illisible.
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = 'rgba(10,12,11,0.9)';
    ctx.strokeText(nd.mot, lx, ly);
    ctx.globalAlpha = survol < 0 ? 0.92 : 1;
    ctx.fillStyle = '#e9efeb';
    ctx.fillText(nd.mot, lx, ly);
  }

  /* --- les noms d'amas, en filigrane derriere leur groupe --- */
  // Sous le groupe et non au milieu : au centre le titre tombe derriere les
  // points et ne se lit ni comme un titre ni comme un mot.
  ctx.font = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.letterSpacing = '0.12em';
  ctx.globalAlpha = 0.42;
  for (const t of titres) {
    ctx.fillStyle = couleur(t.note, moy);
    ctx.fillText(t.texte, t.x, t.y);
  }
  ctx.letterSpacing = '0px';
  ctx.globalAlpha = 1;
}

/** Le mot sous le curseur, ou -1. */
export function auPoint(pts, G, x, y) {
  let meilleur = -1, dmin = 26 * 26;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - x, dy = pts[i].y - y;
    const d2 = dx * dx + dy * dy;
    const r = 2.4 + Math.sqrt(G.noeuds[i].jours) * 1.05 + 9;
    if (d2 < Math.max(dmin, r * r) && d2 < r * r) { dmin = d2; meilleur = i; }
  }
  return meilleur;
}
