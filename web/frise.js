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

const NEUTRE = 'rgba(147,160,153,.55)';

/** Les annees a graduer : toutes si la frise est courte, sinon une sur cinq. */
function graduations(et) {
  const a0 = Number(et.debut.slice(0, 4)), a1 = Number(et.fin.slice(0, 4));
  const span = a1 - a0;
  const pas = span <= 8 ? 1 : span <= 20 ? 2 : span <= 40 ? 5 : 10;
  const out = [];
  for (let a = Math.ceil(a0 / pas) * pas; a <= a1; a += pas) out.push(a);
  return out;
}

/**
 * @param {object} F  { etendue, points, periodes } -- deja situes et voies par le serveur
 * @param {object} opts
 * @returns {string} le SVG complet
 */
export function friseMarkup(F, { hauteurVoie = 26, survol = null } = {}) {
  const et = F.etendue;
  if (!et) return '';

  const W = 1000;
  const MG = 10, MD = 10;
  const iw = W - MG - MD;
  const X = d => MG + situer(d, et) * iw;

  const nbVoies = F.periodes.length ? Math.max(...F.periodes.map(p => p.voie)) + 1 : 0;
  const HAUT = 22;                                   // les graduations d'annees
  const VOIES = nbVoies * hauteurVoie;
  const POINTS = 46;                                 // la rangee des instants
  const H = HAUT + VOIES + (VOIES ? 10 : 0) + POINTS;
  const yVoie = v => HAUT + v * hauteurVoie;
  const yAxe = H - 18;

  /* --- le fond : ou le journal existe reellement --- */
  const j = et.journal;
  const fondJournal = j
    ? `<rect x="${X(j.debut).toFixed(1)}" y="${HAUT - 6}"
             width="${(X(j.fin) - X(j.debut)).toFixed(1)}" height="${(yAxe - HAUT + 6).toFixed(1)}"
             fill="var(--accent)" fill-opacity=".035"/>
       <line x1="${X(j.debut).toFixed(1)}" y1="${HAUT - 6}" x2="${X(j.debut).toFixed(1)}" y2="${yAxe}"
             stroke="var(--accent)" stroke-opacity=".3" stroke-dasharray="2 4"/>`
    : '';

  const ans = graduations(et).map(a => {
    const x = X(`${a}-01-01`);
    if (x < MG - 1 || x > W - MD + 1) return '';
    return `<line x1="${x.toFixed(1)}" y1="${HAUT - 8}" x2="${x.toFixed(1)}" y2="${yAxe}"
                  stroke="var(--line-soft)"/>
            <text x="${x.toFixed(1)}" y="12" text-anchor="middle" class="frisean">${a}</text>`;
  }).join('');

  /* --- les periodes : une barre par voie --- */
  const barres = F.periodes.map(p => {
    const x1 = X(p.date), x2 = Math.max(X(p.fin), x1 + 3);
    const y = yVoie(p.voie);
    const c = p.couleur ?? NEUTRE;
    const actif = survol === p.id;
    const th = p.theme ?? themeDe(p.label);
    // Le libelle se pose DANS la barre si elle est assez large, sinon apres.
    const large = x2 - x1 > 92;
    return `<g class="fperiode${actif ? ' on' : ''}" data-ev="${p.id}" style="--c:${c}">
      <rect x="${x1.toFixed(1)}" y="${y}" width="${(x2 - x1).toFixed(1)}" height="16" rx="3"
            fill="${c}" fill-opacity="${actif ? .34 : .18}"
            stroke="${c}" stroke-opacity="${actif ? .9 : .5}"/>
      <g transform="translate(${(x1 + 4).toFixed(1)} ${y + 2}) scale(.5)" color="${c}">${icone(th, 24)}</g>
      <text x="${(large ? x1 + 19 : x2 + 6).toFixed(1)}" y="${y + 11.5}"
            class="fetiq${large ? ' dedans' : ''}">${esc(p.label)}</text>
      <title>${esc(p.label)} — ${esc(p.date)} → ${esc(p.fin)}${p.jours ? ` (${p.jours} jours)` : ''}</title>
    </g>`;
  }).join('');

  /* --- les instants : une icone sur l'axe --- */
  const marques = F.points.map(p => {
    const x = X(p.date);
    const c = p.couleur ?? NEUTRE;
    const actif = survol === p.id;
    const th = p.theme ?? themeDe(p.label);
    return `<g class="fpoint${actif ? ' on' : ''}" data-ev="${p.id}" style="--c:${c}">
      <line x1="${x.toFixed(1)}" y1="${(yAxe - 20).toFixed(1)}" x2="${x.toFixed(1)}" y2="${yAxe}"
            stroke="${c}" stroke-opacity=".5"/>
      <circle cx="${x.toFixed(1)}" cy="${yAxe}" r="${actif ? 3.4 : 2.4}" fill="${c}"/>
      <g transform="translate(${(x - 7).toFixed(1)} ${(yAxe - 34).toFixed(1)}) scale(.58)" color="${c}">${icone(th, 24)}</g>
      <title>${esc(p.label)} — ${esc(p.date)}</title>
    </g>`;
  }).join('');

  return `<svg class="frisesvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
               style="height:${H}px" role="img" aria-label="Frise de tes repères">
    ${fondJournal}
    ${ans}
    <line x1="${MG}" y1="${yAxe}" x2="${W - MD}" y2="${yAxe}" stroke="var(--line)"/>
    ${barres}
    ${marques}
  </svg>`;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Le repère sous le curseur, ou null. Le SVG est en unites viewBox, pas en pixels. */
export function auPointFrise(svg, clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const g = el?.closest?.('[data-ev]');
  return g ? Number(g.dataset.ev) : null;
}
