/**
 * La frise de vie, dessinee.
 *
 * Une bande horizontale de la naissance a aujourd'hui, ou se posent les
 * reperes : des instants (une icone) et des periodes (une barre). Elle repond a
 * une question qu'aucune autre vue ne pose -- ou tombe ce journal dans une vie,
 * et qu'est-ce qui durait pendant que je l'ecrivais.
 *
 * TROIS REGLES QUI DECIDENT DE TOUT ICI
 *
 * 1. L'AXE NE MENT PAS. L'echelle est lineaire : dix ans font dix fois un an.
 *    Comprimer l'avant-journal donnerait plus de place au texte, et ferait
 *    perdre la seule chose qu'une frise sait dire -- combien de temps.
 *
 * 2. LA COULEUR VIENT DES JOURS. Un repere prend la couleur des journees qu'il
 *    couvre, sur la meme echelle que partout ailleurs. La ou il n'y a pas de
 *    journees -- l'enfance, avant le journal -- il n'y a pas de couleur, et
 *    c'est une information : on ne colorie pas ce qu'on ne sait pas.
 *
 * 3. LA FRISE N'EST PAS UNE STATISTIQUE. Elle ne calcule rien sur personne :
 *    elle place des faits que la personne a elle-meme poses. C'est pourquoi
 *    elle traverse le plancher de la SPEC 4.1 quand la carte, elle, s'arrete.
 */

/*
 * POURQUOI LA GEOMETRIE EST ICI ET PAS DANS server/
 * Le serveur importe ce fichier. L'affectation en voies doit etre faite une
 * seule fois, au meme endroit, sinon le serveur annonce une hauteur et le
 * navigateur en dessine une autre. Meme raison que web/reperes.js : une seule
 * source, aucune divergence possible. Rien ici ne touche au DOM au chargement.
 */

import { icone, themeDe } from './reperes.js';

const jour = d => Date.parse(d + 'T00:00:00Z');
export const JOUR_MS = 86400000;

/**
 * Affectation en voies, par balayage.
 *
 * Trie par debut, puis pose chaque periode sur la PREMIERE voie dont la
 * derniere periode est finie. C'est l'algorithme glouton du partitionnement
 * d'intervalles : il est optimal, il utilise exactement autant de voies qu'il y
 * a de periodes simultanees au pire moment, et on peut le prouver -- au moment
 * ou il ouvre une voie de plus, toutes les precedentes sont occupees, donc ce
 * nombre est atteint quoi qu'il arrive.
 *
 * Le tri secondaire sur la duree n'est pas cosmetique : a debut egal, poser
 * d'abord la plus longue met les periodes de fond (une addiction de quatre ans)
 * sur les voies du haut et les courtes en dessous, ce qui se lit dans le bon
 * ordre. Sans lui, l'ordre depend de l'ordre d'insertion en base, c'est-a-dire
 * de rien.
 *
 * @param {Array<{date: string, fin: string}>} periodes
 * @param {number} margeJours  espace minimal entre deux periodes d'une meme voie,
 *   en jours. Sans marge, deux periodes qui se touchent bout a bout se collent a
 *   l'ecran et se lisent comme une seule.
 * @returns {Array<{voie: number}>}  dans l'ordre d'entree
 */
/** Une periode en cours n'a pas de fin en base : elle en a une a l'ecran. */
export const estPeriode = e => e.fin != null || e.ouvert === 1;
export const finEffective = (e, aujourdhui) => e.ouvert === 1 ? aujourdhui : e.fin;

export function voies(periodes, margeJours = 0) {
  const marge = margeJours * JOUR_MS;
  const ordre = periodes
    .map((p, i) => ({ i, debut: jour(p.date), fin: jour(p.fin ?? p.date) }))
    .sort((a, b) => (a.debut - b.debut) || ((b.fin - b.debut) - (a.fin - a.debut)));

  const finDeVoie = [];                 // finDeVoie[v] = fin de la derniere posee
  const sortie = new Array(periodes.length).fill(0);

  for (const p of ordre) {
    let v = finDeVoie.findIndex(f => f + marge <= p.debut);
    if (v === -1) { v = finDeVoie.length; finDeVoie.push(-Infinity); }
    finDeVoie[v] = Math.max(finDeVoie[v], p.fin);
    sortie[p.i] = v;
  }
  return sortie.map(voie => ({ voie }));
}

/**
 * L'etendue de la frise.
 *
 * Elle part du plus ancien des trois : la naissance, le premier repere, la
 * premiere journee notee. Un repere d'enfance doit avoir ou se poser, sinon
 * « remonter dans l'enfance » n'a pas de sens -- et si la personne n'a rien
 * renseigne avant son journal, la frise se contente du journal plutot que
 * d'inventer une origine.
 *
 * Elle rend aussi les bornes du journal lui-meme : c'est ce qui permet de
 * montrer qu'une vie est plus longue que ce qu'on en a ecrit, sans le dire.
 */
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/*
 * Une borne ou rien.
 *
 * Cette fonction est importee par le serveur ET par le navigateur, et elle ne
 * doit JAMAIS rendre NaN. Un champ date accepte une annee a quatre chiffres :
 * « 0202-04-12 », faute de frappe banale, donne un domaine de six cent mille
 * jours ou le journal fait deux pixels de large ; « lol » donne NaN et une
 * frise entierement blanche, sans erreur nulle part. On filtre donc AVANT de
 * trier, et pas apres.
 */
const borne = d => (typeof d === 'string' && ISO.test(d) && d >= '1900-01-01') ? d : null;

export function etendue({ naissance = null, events = [], premierJour = null, dernierJour = null, aujourdhui }) {
  const bornes = [];
  bornes.push(borne(naissance));
  for (const e of events) { bornes.push(borne(e.date)); bornes.push(borne(e.fin)); }
  bornes.push(borne(premierJour));

  const valides = bornes.filter(Boolean);
  const fin = [borne(dernierJour), borne(aujourdhui), ...valides].filter(Boolean).sort().at(-1)
            ?? aujourdhui;
  const debut = valides.length ? valides.slice().sort()[0] : (borne(premierJour) ?? fin);

  return {
    debut, fin,
    journal: borne(premierJour) && borne(dernierJour) ? { debut: premierJour, fin: dernierJour } : null,
    jours: Math.max(1, Math.round((jour(fin) - jour(debut)) / JOUR_MS))
  };
}

/**
 * Position d'une date sur la frise, entre 0 et 1.
 *
 * L'echelle est LINEAIRE, et c'est un choix, pas une facilite. Comprimer les
 * annees d'avant le journal donnerait plus de place aux quatre annees ecrites,
 * mais une frise dont l'axe ment n'est plus une frise : deux reperes distants
 * de dix ans se retrouveraient a la meme distance que deux reperes distants
 * d'un an, et toute la lecture des durees -- qui est exactement ce qu'on
 * demande a une frise -- serait fausse.
 *
 * C'est le ZOOM qui resout le probleme d'echelle, pas la deformation.
 */
export function situer(date, { debut, fin }) {
  const a = jour(debut), b = jour(fin), d = jour(date);
  if (b === a) return 0;
  return Math.max(0, Math.min(1, (d - a) / (b - a)));
}

/* ======================= le dessin ======================= */

import { deltaColor } from './charts.js';
import { teinteDe } from './reperes.js';

/* Ce qui n'a pas de journees derriere lui n'a pas de couleur, et c'est une
   information : on ne colorie pas ce qu'on ne sait pas. */
const SANS_DONNEES = 'rgba(147,160,153,.42)';

/** Les annees a graduer : toutes si la frise est courte, sinon espacees. */
function graduations(et) {
  const a0 = Number(et.debut.slice(0, 4)), a1 = Number(et.fin.slice(0, 4));
  const span = a1 - a0;
  const pas = span <= 8 ? 1 : span <= 20 ? 2 : span <= 45 ? 5 : 10;
  const out = [];
  for (let a = Math.ceil(a0 / pas) * pas; a <= a1; a += pas) out.push(a);
  return out;
}

/**
 * Le degrade des jours couverts par une periode.
 *
 * Une periode prend le DEGRADE des journees qu'elle recouvre, jamais leur
 * moyenne. Mesure sur mille sept cents journees reelles : la moyenne des ecarts
 * sur trois ans tient entre −0,08 et +0,12, soit deux jaunes indiscernables --
 * six barres de la meme couleur, et aucune information. Le degrade, lui, montre
 * une relation verte puis rouge, ce qu'aucune autre vue de l'application ne
 * sait dire.
 */
function degradeDeriode(id, jours, x1, x2) {
  if (!jours?.length) return { def: '', ref: SANS_DONNEES };

  /*
   * On regroupe avant de peindre.
   *
   * Un arret par jour sur une barre de quatre ans large de trois cents pixels
   * fait un code-barre : mille cinq cents raies verticales de deux dixiemes de
   * pixel, ou l'oeil ne lit plus qu'un gris sale. La couleur cesse d'etre une
   * lecture et devient du bruit -- exactement le defaut qu'on venait de
   * corriger sur l'aire du cumul.
   *
   * Quarante paquets, et la MEDIANE de chacun. La mediane et non la moyenne :
   * sur une periode, deux journees a 1 et 10 ne font pas une periode moyenne,
   * elles font une periode instable, et c'est la valeur centrale qui dit ce que
   * ces semaines-la ont ete la plupart du temps.
   */
  const PAQUETS = 40;
  const n = Math.min(PAQUETS, jours.length);
  const arrets = [];
  let derniere = null;
  for (let k = 0; k < n; k++) {
    const a = Math.floor(k * jours.length / n);
    const b = Math.max(a + 1, Math.floor((k + 1) * jours.length / n));
    const ds = jours.slice(a, b).map(x => x.delta).filter(d => d !== null).sort((p, q) => p - q);
    const c = ds.length ? deltaColor(ds[Math.floor(ds.length / 2)]) : SANS_DONNEES;
    if (c === derniere) continue;
    arrets.push({ o: n === 1 ? 0 : k / (n - 1), c });
    derniere = c;
  }
  if (arrets.length < 2) return { def: '', ref: arrets[0]?.c ?? SANS_DONNEES };
  if (arrets[0].o > 0) arrets.unshift({ o: 0, c: arrets[0].c });
  if (arrets.at(-1).o < 1) arrets.push({ o: 1, c: arrets.at(-1).c });

  return {
    def: `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1.toFixed(1)}" y1="0" x2="${x2.toFixed(1)}" y2="0">
      ${arrets.map(a => `<stop offset="${(a.o * 100).toFixed(2)}%" stop-color="${a.c}"/>`).join('')}
    </linearGradient>`,
    ref: `url(#${id})`
  };
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * @param {object} F  { etendue, points, periodes } — deja situes et voies par le serveur
 * @param {(theme:string, taille:number) => string} icone
 * @returns {string} le SVG complet
 */
export function friseMarkup(F, icone, { hauteurVoie = 26, survol = null, cadre = 'vie',
                                        mg = 12, md = 12, domaine = null } = {}) {
  /*
   * LE ZOOM, ET PAS UNE DEFORMATION DE L'AXE.
   *
   * Trente ans de vie dont quatre de journal sur une seule bande : tout se
   * tasse a droite. La tentation est de comprimer l'avant-journal pour donner
   * de la place au reste -- et une frise dont l'axe ment n'est plus une frise.
   * Deux reperes distants de dix ans se retrouveraient a la meme distance que
   * deux reperes distants d'un an, et toute la lecture des durees, qui est
   * exactement ce qu'on demande a une frise, deviendrait fausse.
   *
   * On change donc de CADRE, pas d'echelle. Chaque cadre reste lineaire ; ce
   * qui deborde est ramene au bord et son infobulle garde les vraies dates.
   */
  // `domaine` permet de coller EXACTEMENT a l'axe d'un graphe : la frise se pose
  // alors sous la courbe et un repere tombe sur le moment qu'il explique. C'est
  // toute la raison d'etre de cette option -- lire un fait et une inflexion
  // ensemble, sans avoir a chercher la correspondance des yeux.
  const et = domaine ? { ...domaine, journal: F?.etendue?.journal ?? null }
           : cadre === 'journal' && F?.etendue?.journal
             ? { ...F.etendue.journal, journal: F.etendue.journal }
             : F?.etendue;
  if (!et) return '';

  /*
   * SOUS UN GRAPHE ON FILTRE ; DANS UN CADRE ON RAMENE AU BORD.
   *
   * situer() borne a [0,1] : ce qui precede le debut se pose sur le bord
   * gauche, et son infobulle garde les vraies dates. C'est le bon geste pour
   * les cadres « vie » et « journal », qui montrent tout ce qui existe.
   *
   * Sous une courbe, c'est un mensonge. La frise ne sert la qu'a une chose --
   * faire tomber un fait sur l'inflexion qu'il explique -- et une rupture de
   * 2020 collee au bord d'une fenetre de sept jours designe le mauvais jour. Le
   * lecteur n'a aucun moyen de savoir qu'elle a ete deplacee. Sur « 7 j », six
   * reperes s'empilaient d'ailleurs sur le meme pixel.
   *
   * Une periode qui CHEVAUCHE la fenetre reste : sa barre est coupee aux
   * bornes, ce qui est vrai -- cette periode couvrait bien ce moment-la.
   */
  let PTS = F.points ?? [], PER = F.periodes ?? [];
  if (domaine) {
    PTS = PTS.filter(p => p.date >= et.debut && p.date <= et.fin);
    PER = PER.filter(p => p.fin >= et.debut && p.date <= et.fin);
    // Les voies viennent du serveur, calculees sur TOUTES les periodes. Apres
    // filtrage la voie 3 peut etre la seule occupee : trois rangees vides
    // au-dessus de l'unique barre, et une frise trois fois trop haute.
    const rang = new Map([...new Set(PER.map(p => p.voie))].sort((a, b) => a - b)
      .map((v, i) => [v, i]));
    PER = PER.map(p => ({ ...p, voie: rang.get(p.voie) }));
    // Rien dans la fenetre : pas de bande vide sous la courbe. Le fond, l'axe
    // et les guides se dessineraient quand meme, et une bande grise de
    // cinquante pixels sans un seul repere se lit comme un defaut d'affichage.
    if (!PTS.length && !PER.length) return '';
  }

  const W = 1000, MG = mg, MD = md;
  const iw = W - MG - MD;
  const X = d => MG + situer(d, et) * iw;

  const nbVoies = PER.length ? Math.max(...PER.map(p => p.voie)) + 1 : 0;
  const HAUT = domaine ? 6 : 20;                     // la rangee des annees, inutile sous un graphe
  const VOIES = nbVoies * hauteurVoie;
  const POINTS = 52;                                 // la rangee des instants
  const H = HAUT + VOIES + (VOIES ? 12 : 0) + POINTS;
  const yVoie = v => HAUT + v * hauteurVoie;
  const yAxe = H - 16;

  const defs = [];

  /* --- le fond : ou le journal existe reellement ---
     Une vie est plus longue que ce qu'on en a ecrit. La bande le montre sans
     le dire, et sans jamais colorier ce qui la precede. */
  const j = et.journal;
  const fond = j ? `
    <rect x="${X(j.debut).toFixed(1)}" y="${HAUT - 5}"
          width="${Math.max(1, X(j.fin) - X(j.debut)).toFixed(1)}" height="${(yAxe - HAUT + 5).toFixed(1)}"
          fill="var(--accent)" fill-opacity=".04"/>
    <line x1="${X(j.debut).toFixed(1)}" y1="${HAUT - 5}" x2="${X(j.debut).toFixed(1)}" y2="${yAxe}"
          stroke="var(--accent)" stroke-opacity=".28" stroke-dasharray="2 4"/>
    ${cadre === 'vie' && !domaine ? `<text x="${(X(j.debut) + 5).toFixed(1)}" y="${HAUT - 9}" class="frisejournal">ton journal</text>` : ''}` : '';

  const ans = graduations(et).map(a => {
    const d = `${a}-01-01`;
    // situer() borne : un 1er janvier hors domaine se poserait pile sur le bord
    // et dessinerait un guide qui ne gradue rien.
    if (d < et.debut || d > et.fin) return '';
    const x = X(d);
    if (x < MG - 1 || x > W - MD + 1) return '';
    // Sous un graphe, les annees sont deja ecrites juste au-dessus : on ne garde
    // que les guides, qui font le lien entre les deux figures.
    return `<line x1="${x.toFixed(1)}" y1="${HAUT - 5}" x2="${x.toFixed(1)}" y2="${yAxe}" stroke="var(--line-soft)"/>
            ${domaine ? '' : `<text x="${x.toFixed(1)}" y="11" text-anchor="middle" class="frisean">${a}</text>`}`;
  }).join('');

  /* --- les periodes : une barre par voie --- */
  /*
   * L'etiquette d'une periode courte deborde a droite, et tombe sur la barre
   * suivante de la MEME voie. On calcule donc, par voie, ou commence la
   * suivante : au-dela, on n'ecrit pas.
   */
  const suivanteSurLaVoie = new Map();
  for (const v of new Set(PER.map(p => p.voie))) {
    const surV = PER.filter(p => p.voie === v).sort((a, b) => a.date.localeCompare(b.date));
    surV.forEach((p, i) => suivanteSurLaVoie.set(p.id, surV[i + 1] ? X(surV[i + 1].date) : W - MD));
  }

  const barres = PER.map(p => {
    const x1 = X(p.date), x2 = Math.max(X(p.fin), x1 + 4);
    const y = yVoie(p.voie);
    // Le degrade ne couvre que la portion DESSINEE : passer les journees de
    // toute la periode a une barre coupee comprimerait quatre ans de couleur
    // dans la largeur d'une semaine.
    const vus = domaine
      ? (p.jours ?? []).filter(j => j.date >= et.debut && j.date <= et.fin)
      : p.jours;
    const g = degradeDeriode(`fp${p.id}`, vus, x1, x2);
    if (g.def) defs.push(g.def);
    const actif = survol === p.id;
    const h = p.fort ? 20 : 15;
    /*
     * CONTOURE = DECLARE : la teinte ne touche jamais le remplissage, qui reste
     * le degrade des notes de la periode -- une mesure.
     *
     * Elle vient maintenant du THEME quand personne n'en a choisi une. Sans ca,
     * trois bandes cote a cote -- une ecole, un studio, une histoire -- etaient
     * trois arcs-en-ciel a trait gris : rien ne disait de quoi ces annees
     * etaient faites avant d'avoir lu les trois etiquettes. Un choix a la main
     * l'emporte toujours : c'est une declaration plus forte qu'une deduction.
     */
    const teinte = teinteDe(p);
    const contour = teinte != null ? `hsl(${teinte} 62% 62%)` : 'var(--line)';
    const large = x2 - x1 > 96;
    // Combien de place a droite avant la barre suivante de cette voie.
    const place = (suivanteSurLaVoie.get(p.id) ?? W - MD) - x2 - 8;
    const etiquette = large || place > 60;
    return `<g class="fperiode${actif ? ' on' : ''}${p.fort ? ' fort' : ''}"
      data-ev="${p.id}" data-date="${p.date}" data-fin="${p.fin}" data-label="${esc(p.label)}"
      data-theme="${p.theme}" data-duree="${p.jours?.length ?? 0}">
      ${/* LE FOND DE LA BANDE, sous le degrade. Une periode sans une seule
             journee notee etait une barre grise : maintenant elle a la couleur
             de ce qu'elle est, meme quand on n'a rien mesure dedans. */''}
      ${teinte != null ? `<rect x="${x1.toFixed(1)}" y="${y}" width="${(x2 - x1).toFixed(1)}" height="${h}"
            rx="3" fill="hsl(${teinte} 45% 42%)" fill-opacity="${actif ? .5 : .34}"/>` : ''}
      <rect x="${x1.toFixed(1)}" y="${y}" width="${(x2 - x1).toFixed(1)}" height="${h}" rx="3"
            fill="${g.ref}" fill-opacity="${actif ? .8 : .55}"
            stroke="${contour}" stroke-opacity="${actif ? 1 : teinte != null ? .85 : .5}"
            stroke-width="${p.fort ? 1.5 : 1}"/>
      <g transform="translate(${(x1 + 3).toFixed(1)} ${y + (h - 12) / 2}) scale(.5)"
         color="${teinte != null ? contour : 'var(--ink-dim)'}">${icone(p.theme, 24)}</g>
      ${etiquette ? `<text x="${(large ? x1 + 18 : x2 + 6).toFixed(1)}" y="${(y + h / 2 + 3.5).toFixed(1)}"
            class="fetiq${large ? ' dedans' : ''}">${esc(p.label)}</text>` : ''}
    </g>`;
  }).join('');

  /* --- les instants : une icone sur l'axe --- */
  const marques = PTS.map(p => {
    const x = X(p.date);
    // REMPLI = MESURE : la couleur de sa case dans la grille, exactement.
    const remplissage = p.ecart === null ? SANS_DONNEES : deltaColor(p.ecart);
    // Meme regle que pour les bandes : la teinte declaree d'abord, celle du
    // theme ensuite. Un point de « rupture » et un point de « travail » ne se
    // distinguaient que par leur icone, a douze pixels de haut.
    const teinte = teinteDe(p);
    const contour = teinte != null ? `hsl(${teinte} 62% 62%)` : 'transparent';
    const actif = survol === p.id;
    const r = p.fort ? 3.6 : 2.6;
    const t = p.fort ? 26 : 22;
    return `<g class="fpoint${actif ? ' on' : ''}${p.fort ? ' fort' : ''}"
      data-ev="${p.id}" data-date="${p.date}" data-label="${esc(p.label)}"
      data-theme="${p.theme}" data-note="${p.note ?? ''}">
      <line x1="${x.toFixed(1)}" y1="${(yAxe - 18).toFixed(1)}" x2="${x.toFixed(1)}" y2="${yAxe}"
            stroke="${remplissage}" stroke-opacity=".55"/>
      <circle cx="${x.toFixed(1)}" cy="${yAxe}" r="${actif ? r + 1 : r}"
              fill="${remplissage}" stroke="${contour}" stroke-width="1.4"/>
      <g transform="translate(${(x - t / 2).toFixed(1)} ${(yAxe - 18 - t).toFixed(1)}) scale(${(t / 24).toFixed(3)})"
         color="${remplissage}">${icone(p.theme, 24)}</g>
      <rect class="fcapte" x="${(x - 9).toFixed(1)}" y="${(yAxe - 46).toFixed(1)}" width="18" height="52"/>
    </g>`;
  }).join('');

  /*
   * PAS DE HAUTEUR FIXE, ET C'EST CE QUI FAIT TOMBER LES REPÈRES AU BON ENDROIT.
   *
   * Le SVG faisait `width:100%` avec `height:58px` et un viewBox de 1000×58 :
   * deux formes différentes, donc `preserveAspectRatio` par défaut — « meet » —
   * qui rentre le dessin dans la boîte SANS le déformer et le CENTRE. Sur un
   * écran large, la frise se retrouvait dessinée sur mille pixels au milieu de
   * mille-deux-cents, avec cent pixels de vide de chaque côté. Les graphes,
   * eux, s'étirent (`preserveAspectRatio="none"`). Un repère du 1er juin tombait
   * donc cent pixels à gauche de l'inflexion qu'il explique — sur les fenêtres
   * larges seulement, ce qui rendait le décalage insaisissable.
   *
   * On laisse la hauteur suivre la largeur. Le dessin garde ses proportions —
   * les icônes restent rondes, ce qu'un « none » leur retirerait — et il occupe
   * toute la largeur, exactement comme les deux graphes au-dessus.
   */
  return `<svg class="frisesvg" viewBox="0 0 ${W} ${H}"
               role="img" aria-label="Frise de tes repères">
    ${defs.length ? `<defs>${defs.join('')}</defs>` : ''}
    ${fond}
    ${ans}
    <line x1="${MG}" y1="${yAxe}" x2="${W - MD}" y2="${yAxe}" stroke="var(--line)"/>
    ${barres}
    ${marques}
  </svg>`;
}
