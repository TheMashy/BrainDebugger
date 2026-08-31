/* Rendu sans dependance : echelle de couleur + SVG inline. */

export const SATURATION = 4;   // SPEC 6 — l'echelle sature a +/-4

/* Palette reprise du tableur : rouge -> orange -> jaune (centre) -> vert -> bleu */
const STOPS = [
  [-4.0, [160, 18, 24]],
  [-2.5, [214, 74, 34]],
  [-1.2, [232, 154, 34]],
  [-0.3, [214, 200, 60]],
  [ 0.3, [201, 210, 70]],
  [ 1.2, [150, 201, 63]],
  [ 2.5, [ 47, 158, 79]],
  [ 4.0, [ 61, 134, 198]]
];

export function deltaColor(delta) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return null;
  const d = Math.max(-SATURATION, Math.min(SATURATION, delta));
  if (d <= STOPS[0][0]) return rgb(STOPS[0][1]);
  for (let i = 1; i < STOPS.length; i++) {
    if (d <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
      const t = (d - a) / (b - a);
      return rgb(ca.map((v, k) => Math.round(v + (cb[k] - v) * t)));
    }
  }
  return rgb(STOPS[STOPS.length - 1][1]);
}
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Couleur d'une note pour la notation : meme rampe, centree sur la reference. */
export function noteColor(note, reference = 6) {
  return deltaColor(note - reference) ?? 'var(--line)';
}

/**
 * Echelle ABSOLUE de la notation : 0 rouge -> 5 jaune -> 10 bleu.
 *
 * Volontairement differente de `deltaColor`. Au moment de noter, on se cale sur
 * ses ancres (0, 5, 8...), pas sur sa moyenne glissante : avec l'echelle d'ecart,
 * un 0 et un 2 sortent tous les deux en rouge sature et le 10 n'est jamais bleu.
 * La grille, elle, garde l'ecart -- c'est une vue analytique, pas un choix.
 */
const NOTE_STOPS = [
  [ 0, [165, 18, 24]], [ 2, [206, 62, 32]], [ 3.5, [223, 122, 36]],
  [ 5, [212, 200, 62]], [ 6.5, [150, 199, 66]], [ 8, [ 46, 163, 88]],
  [ 9, [ 44, 143, 140]], [10, [ 55, 128, 200]]
];

/** @returns {[number,number,number]} composantes RGB de la note 0..10 */
export function noteScaleRGB(note) {
  const n = Math.max(0, Math.min(10, Number(note)));
  if (n <= NOTE_STOPS[0][0]) return NOTE_STOPS[0][1];
  for (let i = 1; i < NOTE_STOPS.length; i++) {
    if (n <= NOTE_STOPS[i][0]) {
      const [a, ca] = NOTE_STOPS[i - 1], [b, cb] = NOTE_STOPS[i], t = (n - a) / (b - a);
      return ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
    }
  }
  return NOTE_STOPS[NOTE_STOPS.length - 1][1];
}

export const noteScaleColor = n => rgb(noteScaleRGB(n));
export const noteScaleTint = (n, a = 0.18) => { const c = noteScaleRGB(n); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Courbe cumulative. `values` et `dates` paralleles.
 * Marqueurs d'evenements optionnels (SPEC 5, table events).
 */
/**
 * Le degrade d'un jour a l'autre.
 *
 * La courbe de cumul monte quand la journee est au-dessus de l'etalon et
 * descend quand elle est en dessous : sa pente EST l'ecart du jour. Une ligne
 * verte uniforme cachait donc l'information la plus simple du graphe -- on
 * voyait que ca montait, jamais avec quelle sorte de journees.
 *
 * Un seul <path> et un degrade, pas mille segments. Sur 1700 jours, un segment
 * par jour ferait 1700 noeuds dans le DOM pour 0,6 pixel chacun ; le degrade en
 * fait un seul, et les arrets identiques consecutifs sont fusionnes -- une
 * periode calme de trois mois ne coute qu'un arret.
 */
function degradeParJour(values, id) {
  const n = values.length;
  if (n < 2) return { def: '', ref: null };

  const arrets = [];
  let derniere = null;
  for (let i = 1; i < n; i++) {
    const c = deltaColor(values[i] - values[i - 1]) ?? 'rgb(120,130,124)';
    if (c === derniere) continue;                 // meme couleur : rien a poser
    arrets.push({ o: (i - 0.5) / (n - 1), c });
    derniere = c;
  }
  if (!arrets.length) return { def: '', ref: null };
  // Les bords : sans eux le degrade demarre a la premiere couleur posee et la
  // premiere semaine du graphe n'a pas de teinte.
  if (arrets[0].o > 0) arrets.unshift({ o: 0, c: arrets[0].c });
  if (arrets[arrets.length - 1].o < 1) arrets.push({ o: 1, c: arrets[arrets.length - 1].c });

  const def = `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">
    ${arrets.map(a => `<stop offset="${(a.o * 100).toFixed(3)}%" stop-color="${a.c}"/>`).join('')}
  </linearGradient>`;
  return { def, ref: `url(#${id})`, arrets: arrets.length };
}

/** Un identifiant unique par graphe : deux <defs> homonymes se marchent dessus. */
let _gradN = 0;

/* --------------------------------------------------------------------------
   UN SEUL CADRE, ET UN AXE QUI EST DU TEMPS.

   Les deux graphes plaçaient leurs points PAR INDICE : le i-ème jour écrit à la
   i-ème position. Tant qu'on écrit tous les jours, ça ressemble à un axe de
   temps ; dès qu'il manque une semaine, ce n'en est plus un — et la frise, elle,
   a toujours été en temps réel. Un repère du 1er juin tombait donc à côté de
   l'inflexion qu'il explique, d'autant plus loin qu'il y avait de trous avant.
   Personne ne pouvait le voir : les deux dessins avaient l'air justes.

   L'axe est maintenant une DATE, dans les deux graphes et dans la frise, sur le
   même domaine et avec les mêmes marges. L'alignement n'est plus une
   coïncidence à surveiller : c'est la même transformation appliquée trois fois.

   Les marges viennent d'ici pour la même raison. Elles valaient 46/12 d'un côté
   et 34/10 de l'autre — douze pixels d'écart sur mille, soit trois jours de
   décalage sur une fenêtre d'un an, invisibles à l'œil et faux quand même.
   -------------------------------------------------------------------------- */
export const CADRE = { W: 1000, PL: 46, PR: 12 };

/** Une date ISO en jours depuis l'époque. Midi UTC : aucun fuseau ne la fait basculer. */
export const enJours = d => Math.round(Date.parse(String(d).slice(0, 10) + 'T12:00:00Z') / 86400000);

/**
 * Le domaine d'un graphe : ce qu'on lui demande de couvrir, ou ce qu'il contient.
 *
 * Explicite, il couvre la FENÊTRE DEMANDÉE — « 30 j » fait trente jours même si
 * l'on n'en a écrit douze, et les trois dessins montrent alors le même mois.
 * Implicite, il se replie sur les données, ce qui reste juste pour un appel
 * isolé.
 */
export function domaineDe(dates, domaine) {
  const debut = enJours(domaine?.debut ?? dates[0]);
  const fin = enJours(domaine?.fin ?? dates[dates.length - 1]);
  return { debut, fin, largeur: Math.max(1, fin - debut) };
}

export function lineChart(dates, values, { height = 210, events = [], color = '#4ade80', colore = false, domaine = null } = {}) {
  const n = values.length;
  if (!n) return '<div class="empty">Pas encore de donnees.</div>';

  const { W, PL, PR } = CADRE, H = height, PT = 12, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB;
  const dom = domaineDe(dates, domaine);

  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  if (min > 0) min = 0;
  if (max < 0) max = 0;

  // Par la DATE, pas par le rang : c'est ce qui met ce graphe, celui du dessus
  // et la frise du dessous sur le même axe.
  const X = d => PL + ((enJours(d) - dom.debut) / dom.largeur) * iw;
  const Y = v => PT + ih - ((v - min) / (max - min)) * ih;

  // ticks y "ronds"
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4))) * ([1, 2, 5, 10].find(m => span / (Math.pow(10, Math.floor(Math.log10(span / 4))) * m) <= 6) ?? 1);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);

  const path = values.map((v, i) => `${i ? 'L' : 'M'}${X(dates[i]).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const area = `${path}L${X(dates[n - 1]).toFixed(1)} ${Y(0).toFixed(1)}L${X(dates[0]).toFixed(1)} ${Y(0).toFixed(1)}Z`;

  // etiquettes x : un par changement d'annee, sinon debut/fin
  const xl = [];
  let lastYear = null;
  for (let i = 0; i < n; i++) {
    const y = dates[i].slice(0, 4);
    if (y !== lastYear) { xl.push({ d: dates[i], label: y }); lastYear = y; }
  }

  /*
   * Un repère se place à SA date, qu'elle soit écrite ou non. `dates.indexOf`
   * le faisait disparaître dès que la journée n'avait pas de note — or c'est
   * souvent le cas des jours qui comptent le plus.
   */
  const evMarks = events
    .filter(e => enJours(e.date) >= dom.debut && enJours(e.date) <= dom.fin)
    .map(e => `<line x1="${X(e.date).toFixed(1)}" y1="${PT}" x2="${X(e.date).toFixed(1)}" y2="${PT + ih}"
                 stroke="#ffffff" stroke-opacity=".18" stroke-dasharray="2 3"/>
               <title>${esc(e.date)} — ${esc(e.label)}</title>`).join('');

  const g = colore ? degradeParJour(values, `cg${++_gradN}`) : { def: '', ref: null };
  const trait = g.ref ?? color;

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">
    ${g.def ? `<defs>${g.def}</defs>` : ''}
    ${ticks.map(v => `<line class="grid-l" x1="${PL}" y1="${Y(v).toFixed(1)}" x2="${W - PR}" y2="${Y(v).toFixed(1)}"/>
       <text x="${PL - 7}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`).join('')}
    <line class="axis" x1="${PL}" y1="${Y(0).toFixed(1)}" x2="${W - PR}" y2="${Y(0).toFixed(1)}"/>
    ${evMarks}
    <!-- L'aire garde une teinte unie. Remplie du meme degrade, elle devenait mille
         raies verticales : la couleur cessait d'etre une lecture pour devenir du
         bruit, et la courbe elle-meme se perdait dedans. C'est la LIGNE qui porte
         l'information, l'aire ne fait que lui donner du poids. -->
    <path d="${area}" fill="${color}" fill-opacity=".07"/>
    <path d="${path}" fill="none" stroke="${trait}" stroke-width="${colore ? 1.8 : 1.4}" stroke-linejoin="round"/>
    ${xl.map(t => `<text x="${X(t.d).toFixed(1)}" y="${H - 8}" text-anchor="middle">${t.label}</text>`).join('')}
  </svg>`;
}

/**
 * La bande des 14 jours suivants — SPEC 8, etape 4.
 * Le premier jour repassant au-dessus de la reference est cercle : sans ce
 * repere, l'oeil ne sait pas ou lire la remontee dans un dégradé de couleurs.
 */
export function bandMarkup(band) {
  let returned = false;
  return `<div class="band">${band.map(d => {
    if (d.note === null || d.note === undefined) return `<i data-tip="${esc(d.date)} — rien"></i>`;
    const back = d.reference !== null && d.reference !== undefined && d.note >= d.reference;
    const mark = back && !returned;
    if (back) returned = true;
    return `<i class="${mark ? 'ret' : ''}" style="background:${deltaColor(d.delta ?? 0)}"
      data-tip="${esc(`${d.date} — ${d.note}/10${mark ? '\nretour à la référence' : ''}`)}"></i>`;
  }).join('')}</div>`;
}

/**
 * Le mood adjust, jour par jour -- la vue d'origine du tableur.
 *
 * Pas de cumul ici : chaque jour porte sa propre valeur `signe(x)·x²/2,5`.
 * C'est l'expansion quadratique qui fait le travail : une journee proche du
 * centre reste ecrasee contre la ligne, une journee extreme part en pointe.
 *
 * Trace en escalier (un palier par jour) plutot qu'en ligne lissee : chaque
 * journee est une valeur discrete, l'interpolation entre deux jours n'existe pas.
 */
export function dailyChart(dates, values, { height = 240, events = [], domaine = null } = {}) {
  const n = values.length;
  if (!n) return '<div class="empty">Pas encore de données.</div>';

  const { W, PL, PR } = CADRE, H = height, PT = 14, PB = 24;
  const iw = W - PL - PR, ih = H - PT - PB;
  const lim = Math.max(10, Math.ceil(Math.max(...values.map(Math.abs))));
  const dom = domaineDe(dates, domaine);

  /*
   * UNE PLACE PAR JOUR CALENDAIRE, PAS PAR JOURNÉE ÉCRITE.
   *
   * Les barres se serraient les unes contre les autres quel que soit le
   * calendrier : trois notes en juin et douze en août donnaient quinze barres
   * jointives, et un mois de silence ne se voyait pas. Il se voit maintenant,
   * parce que c'est une information — et parce que c'est ce qui permet à la
   * courbe du dessous et à la frise de tomber au même endroit.
   */
  const cases = dom.largeur + 1;
  const step = iw / cases;
  const X = d => PL + ((enJours(d) - dom.debut) / cases) * iw;
  const Y = v => PT + ih / 2 - (v / lim) * (ih / 2);
  const y0 = Y(0);

  // Une barre fine avec un filet de fond entre deux jours tant qu'il y a la
  // place ; collees des qu'on affiche plusieurs annees, sinon le graphe devient
  // un peigne et la forme disparait derriere les interstices.
  const gap = step > 2.6 ? Math.min(1, step * 0.22) : 0;
  const bw = Math.max(0.6, step - gap);
  const rx = bw >= 3 ? 1.2 : 0;

  const ticks = [-lim, -lim / 2, 0, lim / 2, lim];
  const singleYear = dates[0].slice(0, 4) === dates[n - 1].slice(0, 4);
  const MO = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
  const xl = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const key = singleYear ? dates[i].slice(5, 7) : dates[i].slice(0, 4);
    if (key !== last) { xl.push({ d: dates[i], label: singleYear ? MO[Number(key) - 1] : key }); last = key; }
  }

  // Comme dans la courbe : un repère se place à sa date, notée ou non.
  const evMarks = events
    .filter(e => enJours(e.date) >= dom.debut && enJours(e.date) <= dom.fin)
    .map(e => `<line x1="${(X(e.date) + step / 2).toFixed(1)}" y1="${PT}" x2="${(X(e.date) + step / 2).toFixed(1)}" y2="${PT + ih}"
                 stroke="#ffffff" stroke-opacity=".18" stroke-dasharray="2 3"><title>${esc(e.date)} — ${esc(e.label)}</title></line>`).join('');

  const bars = values.map((v, i) => {
    if (v === null || v === undefined || Number.isNaN(v)) return '';
    const y = Y(v);
    const h = Math.max(0.9, Math.abs(y - y0));            // un jour a zero reste visible
    const top = v >= 0 ? y : y0;
    const c = deltaColor(deltaDuContraste(v)) ?? 'var(--line)';
    return `<rect x="${(X(dates[i]) + gap / 2).toFixed(2)}" y="${top.toFixed(2)}" width="${bw.toFixed(2)}"`
         + ` height="${h.toFixed(2)}"${rx ? ` rx="${rx}"` : ''} fill="${c}">`
         + `<title>${esc(dates[i])} · ${v > 0 ? '+' : ''}${v.toFixed(1)}</title></rect>`;
  }).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px"
      role="img" aria-label="Écart d'humeur jour par jour">
    ${ticks.map(v => `<line class="grid-l" x1="${PL}" y1="${Y(v).toFixed(1)}" x2="${W - PR}" y2="${Y(v).toFixed(1)}"/>
       <text x="${PL - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${v > 0 ? '+' : ''}${Math.round(v)}</text>`).join('')}
    ${evMarks}
    ${bars}
    <line class="axis" x1="${PL}" y1="${y0.toFixed(1)}" x2="${W - PR}" y2="${y0.toFixed(1)}"/>
    ${xl.map(t => `<text x="${(X(t.d) + step / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${t.label}</text>`).join('')}
  </svg>`;
}

/**
 * Ecart brut d'ou vient un contraste. `c = signe(x)*x^2/2,5` s'inverse en
 * `x = signe(c)*racine(2,5*|c|)`.
 *
 * Sans cette inversion, colorer les barres avec l'echelle de la grille les
 * peindrait toutes trop fort : un contraste de 6,4 n'est pas un ecart de 6,4,
 * c'est un ecart de 4. Le meme jour doit porter exactement la meme couleur dans
 * la grille juste au-dessus et dans ce graphe -- deux teintes pour une seule
 * journee sur un meme ecran, et l'echelle ne veut plus rien dire.
 */
const deltaDuContraste = c => Math.sign(c) * Math.sqrt(2.5 * Math.abs(c));
