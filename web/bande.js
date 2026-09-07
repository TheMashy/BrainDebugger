/**
 * =====================================================================
 *  LA BANDE DES JOURS.
 *
 * La carte montre CE QUI EST RELIÉ, sans jamais dire quand. Rien, sur cet
 * écran, ne reliait « la boule » aux jours où elle apparaît — un rond sur une
 * toile, et le journal juste à côté, sans passerelle entre les deux.
 *
 * Or un rond de la carte n'est rien d'autre qu'une LISTE DE JOURS : c'est
 * littéralement ce que le modèle rend (`noeuds[].jours`), et c'est sur ces
 * dates que le serveur compte les flèches. La bande le montre tel quel — un
 * carré par jour écrit, et au-dessus les jours de chaque chose.
 *
 * DEUX LECTURES, UNE SEULE BANDE.
 *   `bandeLiee`   — sous la carte, en permanence : survoler un rond allume ses
 *                   jours, survoler des jours allume son rond.
 *   `bandeCouches` — le mode lecture : les mêmes jours, avec par-dessus ce qui
 *                   vient après quoi, ce qui se répète, le jour où ça change,
 *                   et les jours à surveiller. Chaque couche s'isole.
 *
 * Aucune des deux n'ajoute un fait. Elles marquent des jours déjà écrits.
 * =====================================================================
 */

/* Les symboles : chacun DESSINE ce qu'il nomme. Un pictogramme qu'il faut
   apprendre n'est qu'une puce de plus. */
export const SYMBOLES = {
  jours:   '<rect x="1.4" y="5" width="3.6" height="6" rx="1.1"/><rect x="6.2" y="5" width="3.6" height="6" rx="1.1"/><rect x="11" y="5" width="3.6" height="6" rx="1.1"/>',
  revient: '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2.4 4.2v7.6"/><path d="M7.2 4.2v7.6"/><path d="M13.6 4.2v7.6"/></g>',
  apres:   '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="2.6" cy="8" r="1.7" fill="currentColor" stroke="none"/><path d="M5.6 8h7.2"/><path d="M10.6 5.4 13.2 8l-2.6 2.6"/></g>',
  repete:  '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.2 8a5.2 5.2 0 1 1-2.1-4.2"/><path d="M8.1 2.2h3.4v3.3"/></g>',
  change:  '<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1.4 11.6h5.1V4.9h8.1"/></g>',
  prise:   '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 2.6h7.6l-3.8 5.9z"/><path d="M8 8.6v4.4M5.4 13.2h5.2"/></g>',
  surv:    '<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M8 2.4 15 13.6H1z"/><path d="M8 6.6v3.1" stroke-linecap="round"/><circle cx="8" cy="11.6" r=".95" fill="currentColor" stroke="none"/></g>'
};
export const symbole = (nom, taille = 13) =>
  `<svg viewBox="0 0 16 16" width="${taille}" height="${taille}" fill="currentColor" aria-hidden="true">${SYMBOLES[nom] ?? ''}</svg>`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Les jours d'un nœud, en dates simples — `decorerCarte` les rend en {d, e}. */
export const joursDe = n => (n?.jours ?? []).map(j => (typeof j === 'string' ? j : j?.d)).filter(Boolean);

/**
 * CE QUI VIENT APRÈS QUOI, en paires de jours.
 *
 * Le serveur compte déjà ce lien (`sens.js`) et rend son verdict ; ici on
 * refait le seul geste qui se dessine : pour chaque jour de A, le jour ÉCRIT
 * suivant — celui d'après dans le journal, pas le lendemain civil, parce que
 * quelqu'un qui écrit un jour sur douze n'a presque aucun lendemain écrit.
 */
export function pairesDuLien(joursA, joursB, dates, ecartMax = 30) {
  const idx = new Map(dates.map((d, i) => [d, i]));
  const B = new Set(joursB);
  const out = [];
  for (const d of joursA) {
    const i = idx.get(d);
    if (i == null || i + 1 >= dates.length) continue;
    const s = dates[i + 1];
    const j = Math.round((Date.parse(s + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) / 864e5);
    if (j > ecartMax || !B.has(s)) continue;
    out.push([d, s]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* La géométrie, partagée par les deux lectures                        */
/* ------------------------------------------------------------------ */
function cadre(dates, largeur, marge = 8) {
  const n = Math.max(1, dates.length);
  const pas = (largeur - marge * 2) / n;
  return { n, pas, X: i => marge + i * pas + pas / 2, marge, largeur };
}

/* La rampe des notes du produit : 0 rouge → 5 jaune → 8 vert → 10 bleu. */
const STOPS = [[0, [165, 18, 24]], [2, [206, 62, 32]], [3.5, [223, 122, 36]], [5, [212, 200, 62]],
               [6.5, [150, 199, 66]], [8, [46, 163, 88]], [9, [44, 143, 140]], [10, [55, 128, 200]]];
export function teinteNote(v) {
  if (v == null || Number.isNaN(v)) return 'var(--line)';
  const n = Math.max(0, Math.min(10, v));
  if (n <= 0) return `rgb(${STOPS[0][1]})`;
  for (let i = 1; i < STOPS.length; i++) {
    if (n <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], t = (n - a) / (b - a);
      return `rgb(${ca.map((x, k) => Math.round(x + (cb[k] - x) * t))})`;
    }
  }
  return `rgb(${STOPS.at(-1)[1]})`;
}

/**
 * LA BANDE LIÉE À LA CARTE.
 *
 * Une piste par chose, au-dessus des jours. Chaque marque porte `data-noeud`
 * pour que le survol d'un rond de la carte allume ses jours, et l'inverse.
 * Au-delà de six pistes on n'en montre plus : dix rangées de points au-dessus
 * d'une bande ne se lisent plus, elles se comptent.
 */
export function bandeLiee(carte, fonct, { max = 6, largeur = 760 } = {}) {
  const dates = fonct?.series?.dates ?? [];
  const notes = fonct?.series?.note ?? [];
  if (dates.length < 8) return '';
  const noeuds = (carte?.noeuds ?? [])
    .map((n, i) => ({ i, nom: n.nom, genre: n.genre, jours: joursDe(n) }))
    .filter(n => n.jours.length)
    .sort((a, b) => b.jours.length - a.jours.length)
    .slice(0, max);
  if (!noeuds.length) return '';

  const { pas, X } = cadre(dates, largeur);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const H_PISTE = 9, Y_JOURS = 14 + noeuds.length * H_PISTE, H_JOURS = 18;
  const H = Y_JOURS + H_JOURS + 24;

  const pistes = noeuds.map((n, k) => {
    const y = 10 + (noeuds.length - 1 - k) * H_PISTE;
    const pts = n.jours.map(d => idx.get(d)).filter(i => i != null)
      .map(i => `<circle cx="${X(i).toFixed(1)}" cy="${y}" r="2.5"/>`).join('');
    return `<g class="bjn" data-noeud="${n.i}" role="button" tabindex="0"
      aria-label="${esc(n.nom)} — ${n.jours.length} jours"><title>${esc(n.nom)} — ${n.jours.length} jours</title>${pts}</g>`;
  }).join('');

  const jours = dates.map((d, i) => `<rect class="bjj" x="${(X(i) - pas * .42).toFixed(1)}" y="${Y_JOURS}"
    width="${Math.max(1, pas * .84).toFixed(1)}" height="${H_JOURS}" rx="1.4"
    fill="${teinteNote(notes[i])}" opacity=".88"/>`).join('');

  const mois = d => new Date(d + 'T00:00:00Z').toLocaleDateString('fr-FR', { month: 'short', timeZone: 'UTC' });
  return `<figure class="bande">
    <svg viewBox="0 0 ${largeur} ${H}" class="bsvg" role="img"
         aria-label="Les jours du journal, et au-dessus les jours de chaque chose de la carte">
      ${pistes}${jours}
      <text x="8" y="${Y_JOURS + H_JOURS + 15}" class="bax">${esc(mois(dates[0]))}</text>
      <text x="${largeur - 8}" y="${Y_JOURS + H_JOURS + 15}" text-anchor="end" class="bax">${esc(mois(dates.at(-1)))}</text>
    </svg>
    <figcaption class="bleg">${symbole('jours', 12)}<span>la carte dit <b>quoi va avec quoi</b> — la bande dit <b>quand</b></span></figcaption>
  </figure>`;
}

/* ==================================================================
 * LE MODE LECTURE : les mêmes jours, et ce qu'on y lit.
 *
 * Six couches, une par manière de lire la bande. Elles ne se lisent pas
 * ensemble — on en isole une, et la légende dit ce qu'elle marque. C'est
 * le seul endroit du produit où l'on explique comment il compte, et il
 * vaut mieux le faire une fois, bien, que par petites notes partout.
 * ================================================================== */

export const COUCHES = [
  { id: 'jours',   nom: 'tes jours',            sym: 'jours',
    dit: 'Un carré par jour écrit, coloré par ta note. <b>C’est le seul fait.</b> Tout le reste est une façon de le lire.' },
  { id: 'revient', nom: 'ce qui revient',       sym: 'revient',
    dit: 'Les jours où chaque chose de la carte est là. Un rond sur la carte, c’est exactement ça&nbsp;: une liste de jours.' },
  { id: 'apres',   nom: 'ce qui vient après',   sym: 'apres',
    dit: 'Un trait d’un jour vers le jour d’écriture suivant, quand la suite s’y trouve. <b>C’est ce comptage qui donne le droit de poser une flèche</b> sur la carte.' },
  { id: 'repete',  nom: 'ce qui se répète',     sym: 'repete',
    dit: 'Les jours où un cycle se rejoue. Un cycle n’est pas une histoire&nbsp;: c’est une forme qui revient, et on la voit revenir.' },
  { id: 'change',  nom: 'le jour où ça change', sym: 'change',
    dit: 'Le jour où ta note passe d’un niveau à l’autre. <b>La date n’est pas choisie</b>&nbsp;: c’est celle qui reste quand on compare les deux périodes.' },
  { id: 'prise',   nom: 'ce qui a de la prise', sym: 'prise',
    dit: 'Les jours où une consommation est écrite. Posés sur la bande, on voit les séries sans — et qu’un écart n’efface pas les semaines d’avant.' },
  { id: 'surv',    nom: 'à surveiller',         sym: 'surv',
    dit: 'Les jours marqués par la veille. Posés sur la bande, on voit tout de suite <b>s’ils se suivent</b>.' }
];

/**
 * @param {object} carte    la carte de la lecture (nœuds + liens comptés)
 * @param {object} fonct    les fonctionnements (séries, bascules, jours à surveiller)
 * @param {object} schemas  les cycles lus par le modèle
 * @param {string|null} isole  la couche à montrer seule, ou null pour tout
 */
export function bandeCouches(carte, fonct, schemas, isole = null, { largeur = 860, prises = null } = {}) {
  const dates = fonct?.series?.dates ?? [];
  const notes = fonct?.series?.note ?? [];
  if (dates.length < 8) return '';
  const { pas, X } = cadre(dates, largeur);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const pos = d => { const i = idx.get(d); return i == null ? null : X(i); };

  const Y = 86, HB = 22;                        // la bande, au milieu
  const couches = [];                           // {id, marques, sym, texte, couleur}

  /* — tes jours — */
  couches.push({ id: 'jours', sym: 'jours', couleur: 'var(--muted)',
    texte: `${dates.length} jours écrits — la couleur, c’est ta note`,
    marques: dates.map((d, i) => `<rect x="${(X(i) - pas * .42).toFixed(1)}" y="${Y}"
      width="${Math.max(1, pas * .84).toFixed(1)}" height="${HB}" rx="1.4"
      fill="${teinteNote(notes[i])}" opacity=".88"/>`).join('') });

  /* — ce qui revient : le nœud le plus fourni, en points au-dessus — */
  const noeuds = (carte?.noeuds ?? []).map(n => ({ nom: n.nom, jours: joursDe(n) }))
    .filter(n => n.jours.length).sort((a, b) => b.jours.length - a.jours.length);
  const tete = noeuds[0];
  if (tete) couches.push({ id: 'revient', sym: 'revient', couleur: 'var(--accent)',
    texte: `« ${tete.nom} » revient ${tete.jours.length} jours`,
    marques: tete.jours.map(pos).filter(x => x != null)
      .map(x => `<rect x="${(x - 1.5).toFixed(1)}" y="${Y - 18}" width="3" height="11" rx="1.5" fill="var(--accent)"/>`).join('') });

  /* — ce qui vient après : les paires, en arcs — */
  const lien = (carte?.liens ?? []).find(l => l.appui?.sens === 'de' || l.appui?.sens === 'vers');
  if (lien) {
    const av = lien.appui.sens === 'de' ? lien.de : lien.vers;
    const ap = lien.appui.sens === 'de' ? lien.vers : lien.de;
    const jA = joursDe((carte.noeuds ?? []).find(n => n.nom === av));
    const jB = joursDe((carte.noeuds ?? []).find(n => n.nom === ap));
    const x = lien.appui.sens === 'de' ? lien.appui.de : lien.appui.vers;
    const arcs = pairesDuLien(jA, jB, dates).map(([a, b]) => {
      const x1 = pos(a), x2 = pos(b); if (x1 == null || x2 == null) return '';
      const h = 20 + Math.min(30, (x2 - x1) * 1.4);
      return `<path d="M${x1.toFixed(1)} ${Y - 22} Q${((x1 + x2) / 2).toFixed(1)} ${(Y - 22 - h).toFixed(1)} ${x2.toFixed(1)} ${Y - 22}"
        fill="none" stroke="var(--warn)" stroke-width="1.4" opacity=".85"/>`;
    }).join('');
    if (arcs) couches.push({ id: 'apres', sym: 'apres', couleur: 'var(--warn)',
      texte: `« ${av} », puis « ${ap} » — ${x.apres} fois sur ${x.sur}`, marques: arcs });
  }

  /* — ce qui se répète : un peigne sous la bande — */
  const cycle = (schemas ?? []).map(sc => ({ nom: sc.nom, jours: (sc.jours ?? []).map(pos).filter(x => x != null) }))
    .filter(c => c.jours.length >= 2).sort((a, b) => b.jours.length - a.jours.length)[0];
  if (cycle) couches.push({ id: 'repete', sym: 'repete', couleur: 'var(--m-prune, #a78bfa)',
    texte: `« ${cycle.nom} » se rejoue ${cycle.jours.length} fois`,
    marques: cycle.jours.map(x =>
      `<rect x="${(x - 1.5).toFixed(1)}" y="${Y + HB + 5}" width="3" height="9" rx="1.5" fill="var(--m-prune, #a78bfa)"/>`).join('') });

  /* — ce qui a de la prise : la plus fournie, sous les cycles —
     Elle a sa place ICI et pas dans un écran à part : une consommation est une
     chose datée comme les autres, et c'est en la voyant sur la même règle que
     les bascules et les cycles qu'on voit après quoi elle tombe. */
  const prise = (prises?.prises ?? [])[0];
  if (prise) {
    const xs = prise.jours.map(pos).filter(x => x != null);
    if (xs.length) couches.push({ id: 'prise', sym: 'prise', couleur: 'var(--m-brique, #e07a5f)',
      texte: `${prise.nom} — ${xs.length} jours écrits`,
      marques: xs.map(x =>
        `<rect x="${(x - 1.5).toFixed(1)}" y="${Y + HB + 31}" width="3" height="9" rx="1.5" fill="var(--m-brique, #e07a5f)"/>`).join('') });
  }

  /* — le jour où ça change — */
  const basc = (fonct?.items ?? []).filter(i => i.type === 'bascule').map(i => ({ d: i.date, x: pos(i.date) }))
    .filter(b => b.x != null);
  if (basc.length) couches.push({ id: 'change', sym: 'change', couleur: 'currentColor',
    texte: `${fmtCourt(basc[0].d)} — ta note passe à un autre niveau`,
    marques: basc.map(b =>
      `<line x1="${b.x.toFixed(1)}" y1="6" x2="${b.x.toFixed(1)}" y2="${Y + HB + 18}"
        stroke="currentColor" stroke-width="1.3" stroke-dasharray="3 3" opacity=".7"/>`).join('') });

  /* — à surveiller — */
  const surv = (fonct?.surveilles?.jours ?? []).map(j => pos(j.date)).filter(x => x != null);
  if (surv.length) couches.push({ id: 'surv', sym: 'surv', couleur: 'var(--danger)',
    texte: `${surv.length} jours à surveiller`,
    marques: surv.map(x =>
      `<rect x="${(x - 1.6).toFixed(1)}" y="${Y + HB + 18}" width="3.2" height="10" rx="1.6" fill="var(--danger)"/>`).join('') });

  /* Les étiquettes ne se cherchent pas une place : elles descendent en pile,
     une ligne chacune, dans l'ordre des couches. Rien ne peut plus se croiser. */
  const Y_PILE = Y + HB + 52, PAS_PILE = 19;
  const vif = id => !isole || isole === id;
  const dessin = couches.map((c, k) =>
    `<g class="bco${vif(c.id) ? '' : ' eteint'}" data-couche="${c.id}">${c.marques}
       ${etiq(8, Y_PILE + k * PAS_PILE, c.sym, c.texte, c.couleur)}</g>`).join('');

  const H = Y_PILE + couches.length * PAS_PILE + 4;
  return `<svg viewBox="0 0 ${largeur} ${H}" class="bsvg bcouches" role="img"
    aria-label="Les jours du journal, et les couches qui s’y lisent">${dessin}</svg>`;
}

/* Une étiquette : son symbole, puis sa phrase. Le même symbole que sur le
   bouton de la couche — c'est lui qui rattache l'étiquette à ce qu'on a cliqué. */
function etiq(x, y, sym, texte, couleur) {
  return `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)})" fill="${couleur}" color="${couleur}">
    <svg x="0" y="-10" width="13" height="13" viewBox="0 0 16 16">${SYMBOLES[sym]}</svg>
    <text x="19" y="0" class="bax" fill="${couleur}">${esc(texte)}</text></g>`;
}
const fmtCourt = d => new Date(d + 'T00:00:00Z')
  .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
