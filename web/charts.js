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

/** La bande des 14 jours suivants — SPEC 8, etape 4. */
export function bandMarkup(band) {
  return `<div class="band">${band.map(d => {
    const c = d.note === null || d.note === undefined ? null : deltaColor(d.delta ?? 0);
    const t = d.note === null || d.note === undefined ? `${d.date} — rien` : `${d.date} — ${d.note}/10`;
    return `<i style="${c ? `background:${c}` : ''}" data-tip="${esc(t)}"></i>`;
  }).join('')}</div>`;
}
