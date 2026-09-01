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
 * La disposition est déterministe, et elle l'est PAR NOM. Chaque nœud part de
 * la place que son propre nom lui donne — pas d'un Math.random, mais pas non
 * plus de son rang dans la liste. Deux ouvertures de la même carte donnent la
 * même image ; et une carte à qui on ajoute deux nœuds reste la même carte,
 * avec deux nœuds de plus. Un journal qui se réorganise entièrement à chaque
 * relecture ne se reconnaît pas, et c'est précisément la reconnaissance qu'on
 * cherche ici.
 */

import { deltaColor } from './charts.js';

const TOURS = 320;          // itérations calculées avant le premier affichage
const REPULSION = 5200;
const RESSORT = 0.028;
const AMAS_RAPPEL = 0.021;
const CENTRE_RAPPEL = 0.0016;
const FROTTEMENT = 0.86;

/*
 * LA REPULSION N'EST PAS LA MEME DEDANS ET DEHORS.
 *
 * Elle etait globale : chaque noeud repoussait tous les autres avec la meme
 * force, quel que soit leur groupe. Le rappel d'amas devait alors lutter contre
 * elle pour tenir un ilot ensemble -- et il perdait des que l'ilot depassait
 * quatre ou cinq noeuds. Resultat visible sur une vraie carte : les ilots
 * NOMMES, ceux qui portent une lecture, fondaient en une seule amibe, pendant
 * que les grappes anonymes de deux noeuds restaient nettes. L'inverse exact de
 * ce qu'on veut lire.
 *
 * Deux coefficients suffisent. Dedans, on repousse moins : les membres d'un
 * meme ilot ont le droit d'etre proches, c'est ce que « ilot » veut dire.
 * Dehors, on repousse plus : c'est le blanc entre deux groupes qui les rend
 * distincts, et sans lui aucune enveloppe ne sauve le dessin.
 */
const REPULSION_DEDANS = 0.55;
const REPULSION_DEHORS = 1.5;

/*
 * ET LES RESSORTS NON PLUS.
 *
 * La repulsion separee ne suffisait pas : deux ilots relies par trois traits
 * -- « les deadlines » vers « les nuits blanches », « les anxios » vers « les
 * deadlines » -- restaient collas l'un a l'autre, parce que le ressort, lui,
 * ignorait les groupes et tirait de toutes ses forces a travers la frontiere.
 *
 * Un lien entre deux ilots tire donc MOINS. Il tire quand meme -- c'est un vrai
 * lien, et deux ilots qui se parlent doivent rester voisins ; mais il ne doit
 * pas pouvoir les fondre en un seul. Ce que la carte doit montrer, c'est deux
 * choses reliees, pas une chose.
 */
const RESSORT_DEHORS = 0.4;

/**
 * Un flottant entre 0 et 1, tire d'une chaine. FNV-1a, puis normalisation.
 *
 * Le meme nom rend toujours le meme nombre, et deux noms proches rendent des
 * nombres sans rapport -- c'est exactement ce qu'on demande a une place de
 * depart : stable, et repartie.
 */
function hache(cle) {
  let h = 2166136261;
  for (let i = 0; i < cle.length; i++) { h ^= cle.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
}

/**
 * LA PLACE DE DEPART VIENT DU NOM, PLUS DE L'INDEX.
 *
 * Elle venait d'une spirale indexee : le premier noeud au centre, puis chacun
 * un cran plus loin. Deterministe, oui -- mais seulement a liste identique. Un
 * noeud insere en troisieme position decalait tous les suivants d'un cran, et
 * la simulation, partie d'ailleurs, arrivait ailleurs. D'une relecture a la
 * suivante, quelqu'un qui n'avait rien change de sa vie retrouvait une carte
 * entierement redisposee -- et c'est la reconnaissance qu'on venait chercher
 * ici, pas la nouveaute.
 *
 * Chaque noeud tire donc sa place de SON NOM. Ceux qui restent repartent d'ou
 * ils etaient ; ceux qui arrivent se posent ailleurs, sans pousser personne. Le
 * `sqrt` garde la repartition uniforme dans le disque : sans lui, tout
 * s'entasse au centre.
 */
export function disposer(G, largeur, hauteur) {
  const n = G.noeuds.length;
  if (!n) return { pts: [], centres: new Map() };

  const R = Math.min(largeur, hauteur);

  /*
   * LES POINTS D'ANCRAGE DES AMAS : d'ou part chaque groupe.
   *
   * L'angle vient du nom -- c'est ce qui rend la carte stable d'une relecture a
   * l'autre. Mais trois hachages tirés au hasard tombent volontiers dans le
   * meme quart de cercle, et les trois ilots se posent alors les uns sur les
   * autres, dans un coin d'un canvas aux trois quarts vide.
   *
   * On les ECARTE donc, sans les reordonner : quelques passes qui poussent
   * chaque voisin jusqu'a une separation minimale. L'ordre autour du cercle
   * reste celui des noms, et un amas de plus deplace ses voisins d'un cran au
   * lieu de tout redistribuer -- c'est exactement le compromis qu'on veut entre
   * « ca se reconnait » et « ca se lit ».
   */
  const cles = [...new Set(G.noeuds.map(nd => String(nd.amas ?? 'seul')))];
  const angles = new Map(cles.map(k => [k, hache(k) * Math.PI * 2]));
  const ecart = (Math.PI * 2 / cles.length) * 0.85;
  for (let t = 0; t < 60; t++) {
    const ordre = [...cles].sort((a, b) => angles.get(a) - angles.get(b));
    for (let i = 0; i < ordre.length; i++) {
      const a = ordre[i], b = ordre[(i + 1) % ordre.length];
      if (a === b) continue;
      let d = angles.get(b) - angles.get(a);
      if (d < 0) d += Math.PI * 2;
      if (d >= ecart) continue;
      const c = (ecart - d) / 2;
      angles.set(a, angles.get(a) - c);
      angles.set(b, angles.get(b) + c);
    }
  }

  const ancres = new Map();
  const ancre = cle => {
    if (!ancres.has(cle)) {
      const a = angles.get(cle) ?? hache(cle) * Math.PI * 2;
      // Une ELLIPSE, pas un cercle : les amas se repartissent dans la forme du
      // cadre. Sur un canvas large, un depart circulaire donne un graphe rond
      // que le recadrage ne peut qu'agrandir jusqu'a la hauteur -- et il reste
      // un tiers de largeur vide de chaque cote. Le recadrage ne deforme pas
      // (les angles mentiraient) : c'est ici que la forme se decide.
      // Les ancres partent PLUS LOIN du centre qu'avant (0,34 -> 0,40) : avec
      // une repulsion desormais plus forte entre groupes, des ancres serrees
      // faisaient commencer la simulation par une bousculade dont elle ne se
      // remettait pas dans les trois cents tours.
      const u = 0.72 + 0.28 * hache(cle + '·rayon');
      ancres.set(cle, {
        x: largeur / 2 + Math.cos(a) * 0.40 * largeur * u,
        y: hauteur / 2 + Math.sin(a) * 0.40 * hauteur * u
      });
    }
    return ancres.get(cle);
  };

  const pts = G.noeuds.map((nd, i) => {
    /*
     * DEUX HACHAGES, ET C'EST DELIBERE : celui de l'AMAS pose le groupe, celui
     * du NOM place le noeud dedans.
     *
     * Un seul -- le nom -- suffisait a la stabilite, mais pas au reste : les
     * quatre noeuds d'un meme ilot partaient alors aux quatre coins du cadre, et
     * le rappel d'amas passait la simulation entiere a les ramener. Les
     * enveloppes finissaient etirees et se traversaient toutes, ce qui efface
     * exactement ce qu'on venait chercher : des groupes qu'on distingue.
     *
     * Ancres par amas, donc : les ilots partent deja separes, la simulation n'a
     * plus qu'a les detendre. Et comme l'ancre vient du NOM de l'ilot, un noeud
     * de plus dans un groupe ne deplace ni le groupe ni ses voisins.
     */
    const cle = String(nd.nom ?? nd.mot ?? i);
    const c = ancre(String(nd.amas ?? 'seul'));
    const a = hache(cle) * Math.PI * 2;
    const d = 0.13 * R * Math.sqrt(hache(cle + '·rayon'));
    return {
      x: c.x + Math.cos(a) * d,
      y: c.y + Math.sin(a) * d,
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
        const meme = amasDe[i] === amasDe[j];
        const f = REPULSION * (meme ? REPULSION_DEDANS : REPULSION_DEHORS) / d2;
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
      const traverse = amasDe[l.s] !== amasDe[l.t];
      // Un lien entre deux ilots vise plus LOIN, en plus de tirer moins : sans
      // ca les deux enveloppes se touchent meme quand la force est faible.
      const cible = (120 - 60 * Math.min(1, l.force * 3)) * (traverse ? 1.9 : 1);
      const f = (d - cible) * RESSORT * (0.4 + l.force) * (traverse ? RESSORT_DEHORS : 1);
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
