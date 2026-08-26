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
export function lineChart(dates, values, { height = 210, events = [], color = '#4ade80' } = {}) {
  const n = values.length;
  if (!n) return '<div class="empty">Pas encore de donnees.</div>';

  const W = 1000, H = height, PL = 46, PR = 12, PT = 12, PB = 26;
  const iw = W - PL - PR, ih = H - PT - PB;

  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  if (min > 0) min = 0;
  if (max < 0) max = 0;

  const X = i => PL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const Y = v => PT + ih - ((v - min) / (max - min)) * ih;

  // ticks y "ronds"
  const span = max - min;
  const step = Math.pow(10, Math.floor(Math.log10(span / 4))) * ([1, 2, 5, 10].find(m => span / (Math.pow(10, Math.floor(Math.log10(span / 4))) * m) <= 6) ?? 1);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);

  const path = values.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const area = `${path}L${X(n - 1).toFixed(1)} ${Y(0).toFixed(1)}L${X(0).toFixed(1)} ${Y(0).toFixed(1)}Z`;

  // etiquettes x : un par changement d'annee, sinon debut/fin
  const xl = [];
  let lastYear = null;
  for (let i = 0; i < n; i++) {
    const y = dates[i].slice(0, 4);
    if (y !== lastYear) { xl.push({ i, label: y }); lastYear = y; }
  }

  const evMarks = events
    .map(e => ({ ...e, i: dates.indexOf(e.date) }))
    .filter(e => e.i >= 0)
    .map(e => `<line x1="${X(e.i).toFixed(1)}" y1="${PT}" x2="${X(e.i).toFixed(1)}" y2="${PT + ih}"
                 stroke="#ffffff" stroke-opacity=".18" stroke-dasharray="2 3"/>
               <title>${esc(e.date)} — ${esc(e.label)}</title>`).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">
    ${ticks.map(v => `<line class="grid-l" x1="${PL}" y1="${Y(v).toFixed(1)}" x2="${W - PR}" y2="${Y(v).toFixed(1)}"/>
       <text x="${PL - 7}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`).join('')}
    <line class="axis" x1="${PL}" y1="${Y(0).toFixed(1)}" x2="${W - PR}" y2="${Y(0).toFixed(1)}"/>
    ${evMarks}
    <path d="${area}" fill="${color}" fill-opacity=".10"/>
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linejoin="round"/>
    ${xl.map(t => `<text x="${X(t.i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${t.label}</text>`).join('')}
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
export function dailyChart(dates, values, { height = 240, events = [] } = {}) {
  const n = values.length;
  if (!n) return '<div class="empty">Pas encore de données.</div>';

  const W = 1000, H = height, PL = 34, PR = 10, PT = 10, PB = 24;
  const iw = W - PL - PR, ih = H - PT - PB;
  const lim = Math.max(10, Math.ceil(Math.max(...values.map(Math.abs))));

  const X = i => PL + (i / n) * iw;
  const Y = v => PT + ih / 2 - (v / lim) * (ih / 2);
  const step = iw / n;

  // escalier : palier horizontal par jour, saut vertical entre deux jours
  let d = `M${X(0).toFixed(2)} ${Y(0).toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const y = Y(values[i]).toFixed(2);
    d += `L${X(i).toFixed(2)} ${y}L${(X(i) + step).toFixed(2)} ${y}`;
  }
  d += `L${X(n).toFixed(2)} ${Y(0).toFixed(2)}Z`;

  const ticks = [-lim, -lim / 2, 0, lim / 2, lim];
  // une seule annee affichee -> reperes mensuels ; plusieurs -> reperes annuels
  const singleYear = n > 0 && dates[0].slice(0, 4) === dates[n - 1].slice(0, 4);
  const MO = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];
  const xl = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const key = singleYear ? dates[i].slice(5, 7) : dates[i].slice(0, 4);
    if (key !== last) { xl.push({ i, label: singleYear ? MO[Number(key) - 1] : key }); last = key; }
  }
  const evMarks = events
    .map(e => ({ ...e, i: dates.indexOf(e.date) }))
    .filter(e => e.i >= 0)
    .map(e => `<line x1="${X(e.i).toFixed(1)}" y1="${PT}" x2="${X(e.i).toFixed(1)}" y2="${PT + ih}"
                 stroke="#ffffff" stroke-opacity=".2" stroke-dasharray="2 3"><title>${esc(e.date)} — ${esc(e.label)}</title></line>`).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px"
      role="img" aria-label="Écart quotidien, échelle expansée">
    ${ticks.map(v => `<line class="grid-l" x1="${PL}" y1="${Y(v).toFixed(1)}" x2="${W - PR}" y2="${Y(v).toFixed(1)}"/>
       <text x="${PL - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${v > 0 ? '+' : ''}${Math.round(v)}</text>`).join('')}
    ${evMarks}
    <path d="${d}" fill="#4ade80" fill-opacity=".22" stroke="#4ade80" stroke-width="1" stroke-linejoin="miter"/>
    <line class="axis" x1="${PL}" y1="${Y(0).toFixed(1)}" x2="${W - PR}" y2="${Y(0).toFixed(1)}"/>
    ${xl.map(t => `<text x="${X(t.i).toFixed(1)}" y="${H - 7}" text-anchor="middle">${t.label}</text>`).join('')}
  </svg>`;
}
