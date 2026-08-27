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

/* Une teinte par genre, prise dans la bande DECLAREE (229-337) partagee avec les
   reperes et les motifs. Elle ne peut donc pas se confondre avec la rampe des
   notes, qui occupe le reste du cercle. */
export const TEINTE_GENRE = {
  personne:  336,
  lieu:      258,
  travail:   232,
  corps:     310,
  mecanisme: 284,
  periode:   246,
  activite:  272
};

export const NOM_GENRE = {
  personne: 'quelqu\'un', lieu: 'un lieu', travail: 'le travail', corps: 'le corps',
  mecanisme: 'un mécanisme', periode: 'un moment', activite: 'quelque chose que tu fais'
};

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
export function versGraphe(carte) {
  const noeuds = carte?.noeuds ?? [];
  const index = new Map(noeuds.map((n, i) => [n.nom, i]));
  return {
    noeuds: noeuds.map(n => ({ ...n, jours: n.poids, amas: n.genre })),
    liens: (carte?.liens ?? []).map(l => ({
      s: index.get(l.de), t: index.get(l.vers),
      quoi: l.quoi, force: l.force / 3
    })).filter(l => l.s !== undefined && l.t !== undefined)
  };
}

const RAYON = n => 4 + n.poids * 2.6;

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
  const k = Math.min(1.6, (largeur - mx * 2) / l, (hauteur - my * 2) / h);
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
export function dessinerRelations(ctx, G, dispo, { largeur, hauteur, survol = -1, dpr = 1 }) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, largeur, hauteur);
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
      // Le point milieu d'une quadratique est en t=0.5, pas au milieu du segment.
      const tx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
      const ty = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
      ctx.globalAlpha = 1;
      ctx.font = '500 10.5px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const w = ctx.measureText(l.quoi).width;
      ctx.fillStyle = 'rgba(10,12,11,.88)';
      ctx.beginPath();
      ctx.roundRect(tx - w / 2 - 5, ty - 8, w + 10, 16, 4);
      ctx.fill();
      ctx.fillStyle = couleur(G.noeuds[l.s].genre, 72);
      ctx.fillText(l.quoi, tx, ty);
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

    // Le centre est le fond, pas la couleur : c'est ce qui fait l'anneau.
    ctx.fillStyle = '#0a0c0b';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineWidth = i === survol ? 2.4 : 1.6;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 7); ctx.stroke();

    ctx.globalAlpha = actif ? 1 : 0.2;
    ctx.fillStyle = actif ? '#e9efeb' : '#93a099';
    ctx.font = `${i === survol ? '600' : '400'} 12px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    // Le libelle est borne au cadre : le recadrage laisse de la marge autour des
    // NOEUDS, pas autour de leur texte, et un nom long au bord sortait quand meme.
    const lw = ctx.measureText(n.nom).width;
    ctx.fillText(n.nom, Math.max(lw / 2 + 4, Math.min(largeur - lw / 2 - 4, p.x)), p.y - r - 6);
  }
  ctx.globalAlpha = 1;
}

/** Le noeud sous le curseur, ou -1. Rayon de capture large : on vise mal. */
export function noeudAu(pts, G, x, y) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - x, pts[i].y - y);
    const seuil = RAYON(G.noeuds[i]) + 16;
    if (d < seuil && d < bd) { bd = d; best = i; }
  }
  return best;
}
