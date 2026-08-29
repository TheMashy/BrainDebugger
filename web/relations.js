/**
 * La carte organique : les choses d'une vie, et ce qui les relie.
 *
 * CE QU'ELLE N'EST PAS
 * Ce n'est pas la carte des mots. Celle-là comptait des co-occurrences : deux
 * mots dans la meme journee, un trait. Elle savait dire que « fatigue » et
 * « boulot » tombent la meme semaine, et rien de plus -- parce qu'un trait sans
 * verbe ne dit pas ce qui se passe entre deux choses.
 *
 * Ici chaque trait porte un VERBE, ecrit par le compagnon : « precede », « fait
 * retomber », « le seul moment ou ca tient ». C'est le verbe qui fait la carte ;
 * les noeuds ne sont que ce qu'il relie. Un lien qui dirait « lie a » aurait ete
 * jete cote serveur.
 *
 * LA REGLE DE COULEUR TIENT ENCORE ICI
 * « Ce qui est REMPLI est MESURE, ce qui est CONTOURE est DECLARE. » Cette carte
 * est entierement declaree -- c'est une lecture, pas un calcul. Les noeuds sont
 * donc des ANNEAUX, jamais des disques, et la carte des mots reste la seule a
 * avoir des pastilles pleines. On peut poser les deux cote a cote sans qu'un
 * lecteur puisse les confondre.
 *
 * Canvas et pas SVG : sur seize noeuds et trente aretes avec halos, le SVG
 * demande cent noeuds de DOM qu'on redessine a chaque survol.
 */

import { TEINTES_DECLAREES, ICONES } from './reperes.js';

/* Une teinte par genre, prise dans la bande DECLAREE (229-337) partagee avec les
   reperes et les motifs. Elle ne peut donc pas se confondre avec la rampe des
   notes, qui occupe le reste du cercle. */
export const TEINTE_GENRE = {
  personne:   336,
  lieu:       258,
  travail:    232,
  corps:      310,
  mecanisme:  284,
  periode:    246,
  activite:   272,
  dependance: 296
};

export const NOM_GENRE = {
  personne: 'quelqu\'un', lieu: 'un lieu', travail: 'le travail', corps: 'le corps',
  mecanisme: 'un mécanisme', periode: 'un moment', activite: 'quelque chose que tu fais',
  dependance: 'une dépendance'
};

/*
 * L'icone de consommation, en Path2D.
 *
 * Le meme trace SVG que la frise et les reperes : deux dessins differents pour
 * la meme idee, c'est deux choses a l'oeil. `Path2D` accepte la chaine de path
 * telle quelle -- la seule facon de partager un dessin entre du SVG et une
 * toile sans le redessiner a la main.
 */
const ICONE_CONSO = (() => {
  try { return new Path2D(ICONES.conso); } catch { return null; }
})();

const teinte = g => TEINTE_GENRE[g] ?? TEINTE_GENRE.activite;
const couleur = (g, l = 62, a = 1) => `hsl(${teinte(g)} 58% ${l}% / ${a})`;

/**
 * Du format serveur vers le format de `disposer()`.
 *
 * `disposer` attend { noeuds: [{ jours, amas }], liens: [{ s, t, force }] }.
 * On lui donne `poids` comme `jours` -- c'est ce qui fixe la masse d'un noeud
 * dans la simulation -- et le genre comme amas, de sorte que les personnes se
 * regroupent, les lieux aussi. Le regroupement par genre n'est pas cosmetique :
 * sans lui, seize noeuds relies dans tous les sens forment une pelote.
 */
/**
 * Du format serveur vers celui de `disposer()`, avec les ILOTS.
 *
 * Une piste nomme des noeuds ; ces noeuds deviennent un AMAS, et `disposer` les
 * range cote a cote sans rien savoir de plus -- le regroupement spatial tombe
 * tout seul. Sans piste, on retombe sur le regroupement par genre, qui reste le
 * bon defaut : seize noeuds relies dans tous les sens forment une pelote.
 */
export function versGraphe(carte, pistes = []) {
  const noeuds = carte?.noeuds ?? [];
  const index = new Map(noeuds.map((n, i) => [n.nom, i]));
  // Quel ilot pour quel noeud. Le serveur garantit deja l'exclusivite ; on la
  // retient ici aussi, parce que deux enveloppes qui se traversent effacent
  // exactement ce qu'on venait chercher.
  const parCasse = new Map(noeuds.map((n, i) => [String(n.nom).toLowerCase(), i]));
  const ilotDe = new Map();
  pistes.forEach((p, i) => {
    for (const nom of p?.noeuds ?? []) {
      const k = String(nom).toLowerCase();
      // Un nom qui n'est PAS sur la carte est ignore ici aussi, meme si le
      // serveur le filtre deja : une lecture enregistree avant un changement de
      // carte peut nommer un noeud disparu, et l'ilot dessinerait alors une
      // enveloppe autour de rien, avec un titre flottant au-dessus.
      if (parCasse.has(k) && !ilotDe.has(k)) ilotDe.set(k, i);
    }
  });
  const utilises = new Set([...ilotDe.values()]);
  return {
    /*
     * LA TEINTE VIENT DE LA PISTE, PLUS DE SON RANG.
     *
     * Elle etait prise a l'index : premiere piste en bleu, deuxieme en violet.
     * Une piste inseree en tete repeignait donc toutes les autres, et sur la
     * carte la couleur est ce qu'on reconnait avant le titre -- tout repeindre,
     * c'est presenter une carte inconnue alors que pas un nom n'a bouge.
     *
     * Le serveur l'attribue maintenant a la validation et la fait suivre d'une
     * lecture a la suivante. Le repli sur l'index reste pour les lectures
     * enregistrees avant ce changement : elles n'ont pas de teinte, et un ilot
     * sans couleur ne se dessine pas du tout.
     */
    ilots: pistes.map((p, i) => ({
      i, nom: p.nom,
      teinte: TEINTES_DECLAREES.includes(p.teinte)
        ? p.teinte : TEINTES_DECLAREES[i % TEINTES_DECLAREES.length]
    })).filter(a => utilises.has(a.i)),
    /*
     * `jours` est le nom que `disposer()` donne a la MASSE d'un noeud, et c'est
     * aussi le nom que le serveur donne a la LISTE de ses journees. Les deux se
     * sont rencontres ici, et la liste ecrasait silencieusement la masse.
     *
     * Les dates passent donc sous `occurrences`, et la masse devient leur
     * nombre reel plutot que le poids declare : une chose vue quarante fois
     * pousse plus fort ses voisines qu'une chose vue six fois, et c'est
     * exactement ce qu'on veut voir dans la disposition. Sans dates, on retombe
     * sur le poids.
     */
    noeuds: noeuds.map(n => {
      const pi = ilotDe.get(String(n.nom).toLowerCase());
      return {
        ...n,
        occurrences: n.jours ?? [],
        jours: n.jours?.length || n.poids,
        ilot: pi ?? null,
        /*
         * L'AMAS EST NOMME, PAS NUMEROTE.
         *
         * C'etait `p${pi}` -- l'index de la piste. Or `disposer()` pose chaque
         * amas a l'endroit que son nom lui donne : avec un numero, une piste
         * qui passe de la deuxieme a la premiere place emmene tout son groupe
         * a l'autre bout du cadre, sans qu'un seul noeud ait change. Le nom,
         * lui, ne bouge pas tant que la piste s'appelle pareil.
         */
        amas: pi != null ? `piste:${pistes[pi]?.nom ?? pi}` : n.genre
      };
    }),
    liens: (carte?.liens ?? []).map(l => ({
      s: index.get(l.de), t: index.get(l.vers),
      quoi: l.quoi, force: l.force / 3
    })).filter(l => l.s !== undefined && l.t !== undefined)
  };
}

/**
 * L'ENVELOPPE D'UN ILOT : une forme qui EPOUSE ses noeuds.
 *
 * Un cercle englobant paraissait plus simple, et il l'etait -- mais des qu'un
 * ilot s'etire, son cercle recouvre la moitie de la carte et les enveloppes se
 * traversent toutes. Ce qu'on veut n'est pas « la zone qui contient », c'est
 * « la forme de ce groupe-la ».
 *
 * Enveloppe convexe (chaine monotone), puis dilatation depuis le centre, puis
 * lissage par les milieux. Le lissage est ce qui la rend organique : sans lui
 * on obtient un polygone, et un polygone se lit comme un schema.
 */
export function contour(points, marge = 30) {
  const pts = points.map(p => ({ x: p.x, y: p.y }))
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) {
    // Deux noeuds : pas de polygone possible, on rend un losange autour d'eux.
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const d = Math.max(marge, ...pts.map(p => Math.hypot(p.x - cx, p.y - cy) + marge));
    return [0, 1, 2, 3, 4, 5].map(i => {
      const a = (i / 6) * Math.PI * 2;
      return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d };
    });
  }
  const gauche = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const bas = [], haut = [];
  for (const p of pts) {
    while (bas.length >= 2 && gauche(bas.at(-2), bas.at(-1), p) <= 0) bas.pop();
    bas.push(p);
  }
  for (const p of [...pts].reverse()) {
    while (haut.length >= 2 && gauche(haut.at(-2), haut.at(-1), p) <= 0) haut.pop();
    haut.push(p);
  }
  const hull = [...bas.slice(0, -1), ...haut.slice(0, -1)];
  const cx = hull.reduce((s, p) => s + p.x, 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p.y, 0) / hull.length;
  return hull.map(p => {
    const d = Math.hypot(p.x - cx, p.y - cy) || 1;
    return { x: p.x + (p.x - cx) / d * marge, y: p.y + (p.y - cy) / d * marge };
  });
}

/** Le trace lisse d'une enveloppe fermee : chaque sommet devient une courbe. */
function tracer(ctx, bord) {
  ctx.beginPath();
  const n = bord.length;
  const mi = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let m = mi(bord[n - 1], bord[0]);
  ctx.moveTo(m.x, m.y);
  for (let i = 0; i < n; i++) {
    const suiv = mi(bord[i], bord[(i + 1) % n]);
    ctx.quadraticCurveTo(bord[i].x, bord[i].y, suiv.x, suiv.y);
  }
  ctx.closePath();
}

const RAYON = n => 4 + n.poids * 2.6;

/*
 * LA VUE : UN DEPLACEMENT ET UNE ECHELLE, RIEN DE PLUS.
 *
 * La carte tenait dans son cadre et n'en bougeait pas. Sur seize noeuds
 * regroupes par genre, l'amas le plus dense est justement celui qu'on veut
 * regarder de pres -- et c'est celui ou tout se chevauche. Pouvoir s'approcher
 * ne rend pas la carte plus jolie, ca la rend LISIBLE la ou elle ne l'etait pas.
 *
 * Les bornes ne sont pas cosmetiques non plus. En dessous de 0,4 la carte
 * devient un nuage de points sans nom ; au-dela de 4, on ne voit plus qu'un
 * noeud et on a perdu ce qui fait une carte, c'est-a-dire le reste.
 */
export const K_MIN = 0.4, K_MAX = 4;
export const vueNeutre = () => ({ x: 0, y: 0, k: 1 });

/** Ecran vers carte. Toute detection de clic passe par la. */
export const versCarte = (vue, sx, sy) => ({ x: (sx - vue.x) / vue.k, y: (sy - vue.y) / vue.k });

/**
 * Zoome en gardant fixe le point sous le curseur.
 *
 * C'est la seule facon de zoomer qui ne desoriente pas : on grossit ce qu'on
 * vise, pas le centre du cadre. Zoomer vers le centre oblige a rattraper au
 * glisse a chaque cran de molette.
 */
export function zoomer(vue, sx, sy, facteur) {
  const k = Math.max(K_MIN, Math.min(K_MAX, vue.k * facteur));
  if (k === vue.k) return vue;
  return { k, x: sx - (sx - vue.x) * (k / vue.k), y: sy - (sy - vue.y) * (k / vue.k) };
}

/*
 * LES JOURNEES D'UN NOEUD, EN COURONNE.
 *
 * Un noeud n'est pas une idee : c'est un tas de journees. Chacune de celles que
 * le compagnon a vues devient un point autour de l'anneau, et c'est ce qui
 * donne a la carte sa texture -- on voit qu'une chose pese non pas parce qu'un
 * cercle est gros, mais parce qu'il y a trente jours autour.
 *
 * LA REGLE DE COULEUR TIENT, ET C'EST ELLE QUI DICTE LE DESSIN.
 * « Ce qui est REMPLI est MESURE, ce qui est CONTOURE est DECLARE. » Le noeud
 * est declare par le compagnon : il reste un anneau. Chaque point, lui, est une
 * journee reelle du corpus, avec son ecart a la reference : il est PLEIN, et
 * teinte de la rampe des notes. Des points mesures dans un anneau declare --
 * l'oeil lit la difference sans qu'on la lui explique.
 *
 * Une journee dont l'ecart manque (jamais notee) est un point creux : elle
 * existe, elle ne dit rien.
 */
const MAX_POINTS = 96;

/** La rampe des notes : rouge en dessous de la reference, vert au-dessus. */
function couleurEcart(e) {
  if (e === null || e === undefined) return null;
  const t = Math.max(-1, Math.min(1, e / 3));
  return `hsl(${18 + (t + 1) * 55} 62% ${46 + Math.abs(t) * 12}%)`;
}

/**
 * Les points d'un noeud : une spirale serree autour de l'anneau.
 *
 * Une seule couronne sature a une quinzaine de points et les suivants se
 * couvrent ; l'angle d'or repartit chaque nouveau point la ou il reste de la
 * place, et le rayon croit en racine pour que la densite reste constante --
 * c'est le meme placement que les graines d'un tournesol, et c'est le seul qui
 * tienne quatre-vingts journees sans amas ni trou.
 */
export function couronne(n, r, ech = 1) {
  // Sur un telephone, dix couronnes a taille pleine se recouvrent et la carte
  // redevient la pelote qu'on avait evitee. On resserre ET on echantillonne :
  // trente points disent « beaucoup » aussi bien que quatre-vingts, et on ne
  // pretend rien de plus -- le compte exact est au survol, en toutes lettres.
  const src = n.occurrences ?? [];
  const max = Math.max(12, Math.round(MAX_POINTS * ech));
  const pas = Math.max(1, Math.ceil(src.length / max));
  const js = src.filter((_, i) => i % pas === 0).slice(0, max);
  const OR = Math.PI * (3 - Math.sqrt(5));
  return js.map((j, i) => {
    const a = i * OR;
    const d = r + (5.5 + Math.sqrt(i / Math.max(1, js.length)) * (7 + js.length * 0.16)) * ech;
    return { x: Math.cos(a) * d, y: Math.sin(a) * d, e: j?.e ?? null, date: j?.d ?? null };
  });
}

/** Le facteur de resserrement, du cadre disponible. */
export const echelle = (largeur, hauteur) =>
  Math.max(0.5, Math.min(1, Math.min(largeur / 780, hauteur / 420)));

/**
 * Recadre le graphe pour qu'il occupe le cadre.
 *
 * `disposer()` part d'une spirale a rayon fixe et la simulation ne s'etale pas
 * au-dela : sur un canvas large, neuf noeuds tiennent dans une bande centrale
 * et laissent un tiers de vide en haut et en bas. On ne touche pas au
 * placement -- les distances relatives portent l'information -- on met juste le
 * resultat a l'echelle du cadre, sans deformer : un seul facteur pour les deux
 * axes, sinon les angles mentent.
 *
 * Mute `pts` sur place : c'est l'objet que dessinerRelations et noeudAu lisent,
 * et deux jeux de coordonnees pour le meme graphe finiraient par diverger sur
 * le survol.
 */
export function cadrer(pts, largeur, hauteur, mx = 62, my = 38) {
  if (pts.length < 2) {
    for (const p of pts) { p.x = largeur / 2; p.y = hauteur / 2; }
    return pts;
  }
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const l = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  // Jamais au-dela de 1.6 : etirer un petit graphe jusqu'aux bords l'etale en
  // constellation et perd le regroupement par genre qu'on venait de calculer.
  // Deux marges, pas une : un libelle s'etale LATERALEMENT bien au-dela de son
  // noeud (« l'appart de Lyon » fait cent pixels pour un anneau de dix), et
  // c'est en largeur qu'il sort du cadre. En hauteur il ne prend qu'une ligne.
  // Les marges sont un PLAFOND, pas une constante. Sur un cadre de 330 px, deux
  // marges de 62 en mangeaient 38 % et le graphe se retrouvait tasse au centre
  // d'un canvas aux trois quarts vide -- le defaut se voyait sur telephone, et
  // seulement la. On ne prend jamais plus du huitieme du cadre.
  const mh = Math.min(mx, largeur / 8);
  const mv = Math.min(my, hauteur / 8);
  const k = Math.min(1.6, (largeur - mh * 2) / l, (hauteur - mv * 2) / h);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  for (const p of pts) {
    p.x = largeur / 2 + (p.x - cx) * k;
    p.y = hauteur / 2 + (p.y - cy) * k;
  }
  return pts;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} G      la sortie de versGraphe()
 * @param {object} dispo  la sortie de disposer()
 */
/*
 * MODE PUDIQUE, COTE TOILE.
 *
 * Le reste de l'interface eteint ses lettres en CSS ; une toile n'a pas de CSS.
 * On remplace donc le mot avant de l'ecrire. La substitution garde le NOMBRE de
 * signes -- donc la largeur du libelle, donc la forme de la carte -- et ne rend
 * rien du mot lui-meme. Les dates, elles, ne passent pas par ici : une date ne
 * raconte pas ce qu'on a vecu ce jour-la.
 */
const masquer = t => String(t).replace(/[^\s]/gu, '\u2022');

export function dessinerRelations(ctx, G, dispo,
    { largeur, hauteur, survol = -1, dpr = 1, vue = null, jourSurvol = null, pudique = false }) {
  const mot = t => (pudique ? masquer(t) : t);
  const v = vue ?? vueNeutre();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largeur, hauteur);
  // Tout ce qui suit est dessine dans les coordonnees de la CARTE : la
  // transformation porte le deplacement et l'echelle une fois pour toutes,
  // plutot que chaque appel de dessin les recalcule.
  ctx.setTransform(dpr * v.k, 0, 0, dpr * v.k, dpr * v.x, dpr * v.y);
  const { pts } = dispo;
  if (!pts.length) return;

  const proches = new Set();
  if (survol >= 0) {
    proches.add(survol);
    for (const l of G.liens) {
      if (l.s === survol) proches.add(l.t);
      if (l.t === survol) proches.add(l.s);
    }
  }

  ctx.lineCap = 'round';
  const ech = echelle(largeur, hauteur);
  // Les bords du cadre, exprimes dans les coordonnees de la carte.
  const g0 = -v.x / v.k, g1 = (largeur - v.x) / v.k;
  let survolLib = null, etiquette = null;

  /* ===================== LES ILOTS, ET LE ZOOM SEMANTIQUE =====================
   *
   * De loin, une carte de seize noms est illisible : on lit seize mots et on
   * n'en retient aucun. De pres, un nom d'ilot est une generalite qui recouvre
   * ce qu'on est venu regarder. Les deux ne se disputent donc pas la place --
   * ils se relaient, et c'est le ZOOM qui decide lequel parle.
   *
   * Dezoome, on voit les grandes directions et ou elles se touchent. En
   * approchant, elles s'effacent et les motifs qui les composent apparaissent.
   * C'est exactement le geste qu'on fait sur une carte routiere : les regions
   * d'abord, les rues ensuite -- jamais les deux a pleine encre.
   */
  const fondu = (a, b, x) => Math.max(0, Math.min(1, (x - a) / (b - a)));
  const aIlot  = 1 - 0.85 * fondu(1.4, 2.6, v.k);   // les pistes s'effacent en approchant
  const aNoeud = 0.28 + 0.72 * fondu(0.9, 1.8, v.k); // les noms de noeuds montent

  const ilots = [];
  for (const a of G.ilots ?? []) {
    const membres = [];
    G.noeuds.forEach((n, i) => { if (n.ilot === a.i && pts[i]) membres.push(pts[i]); });
    if (membres.length < 2) continue;   // un ilot d'un seul noeud est ce noeud
    const bord = contour(membres, 34 * Math.max(0.7, ech));
    const cx = bord.reduce((s, p) => s + p.x, 0) / bord.length;
    const haut = bord.reduce((m, p) => Math.min(m, p.y), Infinity);
    ilots.push({ ...a, bord, cx, haut });
  }

  /* --- l'enveloppe des ilots, sous tout le reste --- */
  if (aIlot > 0.02) {
    for (const a of ilots) {
      tracer(ctx, a.bord);
      ctx.fillStyle = `hsl(${a.teinte} 60% 58% / ${(0.085 * aIlot).toFixed(3)})`;
      ctx.fill();
      // CONTOUR POINTILLE, jamais plein : un ilot est DECLARE par le modele,
      // et la regle de couleur du produit tient jusqu'ici.
      ctx.globalAlpha = 0.45 * aIlot;
      ctx.strokeStyle = `hsl(${a.teinte} 60% 62%)`;
      ctx.lineWidth = 1 / v.k;
      ctx.setLineDash([5 / v.k, 7 / v.k]);
      tracer(ctx, a.bord);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
  }

  /* --- les liens --- */
  for (const l of G.liens) {
    const a = pts[l.s], b = pts[l.t];
    const actif = survol < 0 || l.s === survol || l.t === survol;
    // Une courbe et pas un segment : deux droites qui se croisent font un
    // schema, deux courbes font un tissu.
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const dx = b.x - a.x, dy = b.y - a.y;
    const cx = mx - dy * 0.13, cy = my + dx * 0.13;

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.strokeStyle = couleur(G.noeuds[l.s].genre, 55);
    ctx.globalAlpha = actif ? 0.16 + l.force * 0.5 : 0.05;
    ctx.lineWidth = 0.7 + l.force * 2;
    ctx.stroke();

    /*
     * LE VERBE, ET SEULEMENT AU SURVOL.
     *
     * Trente verbes affiches en permanence se chevauchent et rendent la carte
     * illisible ; c'est le defaut classique d'un graphe etiquete. Au survol
     * d'un noeud, on lit d'un coup TOUT ce qui le relie au reste -- ce qui est
     * exactement la question qu'on se pose en pointant quelque chose.
     */
    if (survol >= 0 && (l.s === survol || l.t === survol)) {
      /*
       * Le verbe se pose aux DEUX TIERS de la courbe, du cote de l'autre noeud,
       * et pas au milieu. Quatre liens qui partent du meme noeud ont quatre
       * milieux a la meme distance de lui : les quatre chips se chevauchaient en
       * eventail, et le survol -- qui existe pour rendre lisible -- rendait
       * illisible. Repoussees vers leur extremite, elles s'ecartent d'elles-memes.
       */
      const t = l.s === survol ? 0.66 : 0.34;
      const u = 1 - t;
      const tx = u * u * a.x + 2 * t * u * cx + t * t * b.x;
      const ty = u * u * a.y + 2 * t * u * cy + t * t * b.y;
      ctx.globalAlpha = 1;
      ctx.font = `500 ${(10.5 / v.k).toFixed(2)}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const quoi = mot(l.quoi);
      const w = ctx.measureText(quoi).width;
      ctx.fillStyle = 'rgba(10,12,11,.88)';
      ctx.beginPath();
      ctx.roundRect(tx - w / 2 - 5 / v.k, ty - 8 / v.k, w + 10 / v.k, 16 / v.k, 4 / v.k);
      ctx.fill();
      ctx.fillStyle = couleur(G.noeuds[l.s].genre, 72);
      ctx.fillText(quoi, tx, ty);
    }
  }

  /* --- les noeuds : des anneaux, parce que tout ceci est declare --- */
  for (let i = 0; i < G.noeuds.length; i++) {
    const n = G.noeuds[i], p = pts[i];
    const actif = survol < 0 || proches.has(i);
    const r = RAYON(n);
    const c = couleur(n.genre, actif ? 66 : 52);

    const g = ctx.createRadialGradient(p.x, p.y, r * 0.6, p.x, p.y, r * 4.5);
    g.addColorStop(0, couleur(n.genre, 60, 0.34));
    g.addColorStop(1, couleur(n.genre, 60, 0));
    ctx.globalAlpha = actif ? 1 : 0.22;
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 4.5, 0, 7); ctx.fill();

    // Les journees, sous l'anneau : il doit rester net par-dessus, sinon on ne
    // distingue plus le contour du grain.
    for (const pt of couronne(n, r, ech)) {
      const c2 = couleurEcart(pt.e);
      const vise = jourSurvol && jourSurvol.noeud === i && jourSurvol.date === pt.date;
      const rp = (vise ? 3.2 : 1.5) * Math.max(0.75, ech);
      ctx.beginPath();
      ctx.arc(p.x + pt.x, p.y + pt.y, rp, 0, 7);
      if (c2) {
        ctx.globalAlpha = vise ? 1 : (actif ? 0.82 : 0.16);
        ctx.fillStyle = c2;
        ctx.fill();
      } else {
        ctx.globalAlpha = vise ? 0.9 : (actif ? 0.4 : 0.1);
        ctx.strokeStyle = couleur(n.genre, 58);
        ctx.lineWidth = 1 / v.k;
        ctx.stroke();
      }
      if (vise) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#e9efeb';
        ctx.lineWidth = 1.2 / v.k;
        ctx.beginPath();
        ctx.arc(p.x + pt.x, p.y + pt.y, rp + 2.5 / v.k, 0, 7);
        ctx.stroke();
        etiquette = { texte: pt.date, x: p.x + pt.x, y: p.y + pt.y - rp - 7 / v.k };
      }
    }
    ctx.globalAlpha = actif ? 1 : 0.22;

    // Le centre est le fond, pas la couleur : c'est ce qui fait l'anneau.
    ctx.fillStyle = '#0a0c0b';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineWidth = i === survol ? 2.4 : 1.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();

    /*
     * UNE DEPENDANCE SE VOIT SANS QU'ON LISE SON NOM.
     *
     * Double anneau et l'icone de consommation au centre -- la meme que sur la
     * frise, pour que les deux vues parlent de la meme chose. Ce n'est pas un
     * suivi : rien n'est compte, rien n'est felicite. C'est une PRESENCE sur la
     * carte, qui se relie au reste comme n'importe quel noeud -- et c'est
     * justement l'interet de la nommer, voir a quoi elle tient.
     */
    if (n.genre === 'dependance') {
      ctx.lineWidth = 1 / v.k;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 3.2 / v.k, 0, 7); ctx.stroke();
      if (ICONE_CONSO) {
        const t = (r * 1.5) / 24;
        ctx.save();
        ctx.translate(p.x - r * 0.75, p.y - r * 0.75);
        ctx.scale(t, t);
        ctx.lineWidth = 1.6 / t / v.k * 0.9;
        ctx.strokeStyle = c;
        ctx.stroke(ICONE_CONSO);
        ctx.restore();
      }
    }

    ctx.globalAlpha = actif ? 1 : 0.2;
    ctx.fillStyle = actif ? '#e9efeb' : '#93a099';
    // Un libelle de 12 px sur un cadre de telephone occupe le tiers de sa
    // largeur : dix d'entre eux se croisent forcement.
    /* LA GEOMETRIE ZOOME, PAS LE TEXTE. Un libelle de 11 px devient 44 px a
       l'echelle 4 : la carte se transforme en affiche. En divisant par
       l'echelle, il garde exactement la meme taille A L'ECRAN, et zoomer
       revient a ecarter les noeuds -- ce qu'on veut vraiment quand un amas se
       chevauche. */
    ctx.font = `${i === survol ? '600' : '400'} ${(11 * Math.max(0.82, ech) / v.k).toFixed(2)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // Le libelle est borne au cadre : le recadrage laisse de la marge autour des
    // NOEUDS, pas autour de leur texte, et un nom long au bord sortait quand meme.
    // Au survol, le nombre de journees derriere le noeud : c'est la question
    // qu'on se pose en pointant quelque chose, et la couronne la montre sans la
    // chiffrer.
    const k = n.occurrences?.length ?? 0;
    const ry = r + 6 + (k ? (12 + Math.min(24, 7 + k * 0.16)) * ech : 0);
    const ly = p.y - ry;
    if (i === survol) {
      // Peint en dernier, apres les verbes : c'est le seul libelle qui doit
      // gagner toutes les superpositions, puisque c'est celui qu'on vise.
      survolLib = { texte: k ? `${mot(n.nom)} · ${k} jour${k > 1 ? 's' : ''}` : mot(n.nom), x: p.x, y: ly };
      continue;
    }
    // Un noeud DANS un ilot laisse la parole a l'ilot quand on est loin ; un
    // noeud seul garde son nom, il n'a personne pour parler a sa place.
    const opa = (actif ? 1 : 0.2) * (n.ilot != null ? aNoeud : 1);
    if (opa < 0.06) continue;
    ctx.globalAlpha = opa;
    const nom = mot(n.nom);
    const lw = ctx.measureText(nom).width;
    // Le bornage suit le CADRE VISIBLE, pas le canvas : sous zoom, « largeur »
    // n'est plus la limite droite de ce qu'on voit, et les libelles se
    // seraient tasses contre un bord invisible.
    ctx.fillText(nom, Math.max(g0 + lw / 2 + 4, Math.min(g1 - lw / 2 - 4, p.x)), ly);
  }

  // La date de la journee visee. Sans elle, un point qui grossit sous le curseur
  // est un point qui grossit : on ne sait pas qu'il porte une date, donc on ne
  // pense pas a cliquer.
  if (etiquette) {
    ctx.globalAlpha = 1;
    ctx.font = `500 ${(10.5 / v.k).toFixed(2)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(etiquette.texte).width;
    ctx.fillStyle = 'rgba(10,12,11,.92)';
    ctx.beginPath();
    ctx.roundRect(etiquette.x - w / 2 - 5 / v.k, etiquette.y - 14 / v.k, w + 10 / v.k, 16 / v.k, 4 / v.k);
    ctx.fill();
    ctx.fillStyle = '#e9efeb';
    ctx.fillText(etiquette.texte, etiquette.x, etiquette.y);
  }

  /* --- LE NOM DES ILOTS, par-dessus tout le reste ---
     Peints en dernier et non bornes au cadre : ce sont les seuls libelles qu'on
     doit pouvoir lire de loin, et de loin, le cadre EST la carte entiere. */
  if (aIlot > 0.06) {
    const corps = 13 * Math.max(0.85, ech) / v.k;
    const police = t => `600 ${t.toFixed(2)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.font = police(corps);
    ctx.letterSpacing = `${(1.4 / v.k).toFixed(2)}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    /*
     * LES TITRES NE SE SUPERPOSENT PAS.
     *
     * Chacun se posait au sommet de son enveloppe. Trois ilots dont les hauts
     * arrivent a la meme latitude -- le cas normal, puisqu'ils partagent le
     * meme cadre -- ecrivaient donc leurs trois noms l'un sur l'autre, et on
     * ne lisait aucun des trois. C'est le pire endroit ou perdre du texte :
     * ces titres sont ce qui se lit EN PREMIER, avant meme les noeuds.
     *
     * On les empile donc vers le haut. Du plus haut au plus bas, chaque titre
     * qui heurte un deja pose remonte d'une ligne, jusqu'a etre libre. Le
     * garde-fou borne la boucle : sur des ilots parfaitement empiles, mieux
     * vaut deux titres proches qu'une page figee.
     */
    const ligne = 22 / v.k;
    /*
     * ET ILS RESTENT DANS LE CADRE. Le titre se centre sur son ilot ; un ilot
     * colle au bord gauche faisait donc commencer son nom hors du canvas, et on
     * lisait « NCE CHIMIQUE DU FONCTIONNEMENT SOCIAL ». Un titre decale de
     * quelques dizaines de pixels reste juste au-dessus de sa forme -- un titre
     * coupe ne veut plus rien dire.
     */
    const marge = 14 / v.k;
    const hautVu = -v.y / v.k;
    const dispo = Math.max(1, g1 - g0 - 2 * marge);
    const poses = [];
    for (const a of [...ilots].sort((p, q) => p.haut - q.haut)) {
      const t = mot(a.nom).toUpperCase();
      /*
       * Sur telephone, « instabilite emotionnelle et autodestruction » est plus
       * large que le canvas entier : le centrer ne suffit pas, il deborde des
       * deux cotes. Le titre RETRECIT donc jusqu'a tenir, avec un plancher --
       * en dessous il ne se lirait plus, et un titre illisible ne vaut pas
       * mieux qu'un titre coupe.
       */
      const brut = ctx.measureText(t).width;
      const k = Math.max(0.62, Math.min(1, dispo / brut));
      const w = brut * k;
      const lo = g0 + w / 2 + marge, hi = g1 - w / 2 - marge;
      const cx = lo > hi ? (g0 + g1) / 2 : Math.max(lo, Math.min(hi, a.cx));
      let y = a.haut - 12 / v.k;
      for (let garde = 0; garde < 12; garde++) {
        const heurte = poses.find(o => Math.abs(y - o.y) < ligne
          && Math.abs(cx - o.cx) < (w + o.w) / 2 + 12 / v.k);
        if (!heurte) break;
        y = heurte.y - ligne;
      }
      poses.push({ t, w, k, y: Math.max(y, hautVu + ligne / 2 + marge), cx, teinte: a.teinte });
    }

    ctx.globalAlpha = aIlot;
    for (const o of poses) {
      ctx.font = police(corps * o.k);
      ctx.letterSpacing = `${(1.4 * o.k / v.k).toFixed(2)}px`;
      // Une pastille sous le mot : sans elle, un nom d'ilot pose sur un lien
      // devient illisible des que deux ilots se touchent.
      ctx.fillStyle = 'rgba(10,12,11,.82)';
      ctx.beginPath();
      ctx.roundRect(o.cx - o.w / 2 - 9 / v.k, o.y - 10 / v.k, o.w + 18 / v.k, 20 / v.k, 10 / v.k);
      ctx.fill();
      ctx.fillStyle = `hsl(${o.teinte} 62% 74%)`;
      ctx.fillText(o.t, o.cx, o.y);
    }
    ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
  }

  if (survolLib) {
    ctx.globalAlpha = 1;
    ctx.font = `600 ${(12 / v.k).toFixed(2)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    const w = ctx.measureText(survolLib.texte).width;
    const x = Math.max(g0 + w / 2 + 4, Math.min(g1 - w / 2 - 4, survolLib.x));
    ctx.fillStyle = 'rgba(10,12,11,.9)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2 - 7 / v.k, survolLib.y - 14 / v.k, w + 14 / v.k, 18 / v.k, 5 / v.k);
    ctx.fill();
    ctx.fillStyle = '#e9efeb';
    ctx.fillText(survolLib.texte, x, survolLib.y);
  }
  ctx.globalAlpha = 1;
}

/**
 * Le noeud sous le curseur, ou -1. Rayon de capture large : on vise mal.
 * `sx, sy` sont des coordonnees ECRAN ; la vue les ramene sur la carte.
 */
export function noeudAu(pts, G, sx, sy, ech = 1, vue = null) {
  const { x, y } = versCarte(vue ?? vueNeutre(), sx, sy);
  let best = -1, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - x, pts[i].y - y);
    // La couronne fait partie du noeud : viser un de ses points, c'est viser le
    // noeud. Sans ca, on survole un nuage de journees et rien ne s'allume.
    const n = G.noeuds[i];
    const k = n.occurrences?.length ?? 0;
    const seuil = RAYON(n) + (k ? (12 + Math.min(24, 7 + k * 0.16)) * ech : 16);
    if (d < seuil && d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * LA JOURNEE SOUS LE CURSEUR.
 *
 * Une carte dont les points sont des journees et qu'on ne peut pas ouvrir
 * s'arrete a mi-chemin : elle dit « ces trente-quatre fois » sans jamais dire
 * lesquelles. Chaque point porte donc sa date, et un clic l'ouvre.
 *
 * Le rayon de capture est en pixels ECRAN, converti a la fin : sous zoom fort,
 * un rayon en coordonnees carte deviendrait minuscule a viser, et sous zoom
 * faible il attraperait le point d'a cote. Ce qui doit rester constant est la
 * tolerance de la main, qui, elle, ne zoome pas.
 */
export function journeeAu(pts, G, sx, sy, ech = 1, vue = null) {
  const v = vue ?? vueNeutre();
  const { x, y } = versCarte(v, sx, sy);
  const seuil = 7 / v.k;
  let best = null, bd = seuil;
  for (let i = 0; i < pts.length; i++) {
    const n = G.noeuds[i], p = pts[i];
    if (!n.occurrences?.length) continue;
    // Un filtre grossier avant la couronne : recalculer trente points pour un
    // noeud a l'autre bout du cadre, seize fois par mouvement de souris, se
    // sent sur un portable.
    const large = RAYON(n) + (12 + Math.min(24, 7 + n.occurrences.length * 0.16)) * ech + seuil;
    if (Math.abs(p.x - x) > large || Math.abs(p.y - y) > large) continue;
    for (const pt of couronne(n, RAYON(n), ech)) {
      if (!pt.date) continue;
      const d = Math.hypot(p.x + pt.x - x, p.y + pt.y - y);
      if (d < bd) { bd = d; best = { noeud: i, date: pt.date, ecart: pt.e }; }
    }
  }
  return best;
}

/**
 * Le cadrage qui remet tout dans le cadre : le geste « je me suis perdu ».
 * Il ne recentre pas sur le milieu du canvas, il recentre sur le GRAPHE --
 * apres trois glissades, ce sont deux choses tres differentes.
 *
 * La marge est large parce qu'un noeud n'est pas un point : il porte sa
 * couronne de journees et son libelle au-dessus. Calee sur les centres, elle
 * laissait les noeuds du bord entiers et leurs libelles coupes.
 *
 * Elle ne grossit jamais (k plafonne a 1) : « revenir au centre » doit rendre
 * la vue de depart, pas une vue plus serree que celle qu'on n'a jamais
 * demandee.
 */
export function recadrer(pts, largeur, hauteur, marge = 74) {
  if (!pts.length) return vueNeutre();
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  const l = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const k = Math.max(K_MIN, Math.min(K_MAX, 1,
    (largeur - marge * 2) / l, (hauteur - marge * 2) / h));
  return {
    k,
    x: largeur / 2 - ((x0 + x1) / 2) * k,
    y: hauteur / 2 - ((y0 + y1) / 2) * k
  };
}
