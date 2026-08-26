/**
 * SPEC 6 - Algorithmes.
 *
 * Toute la logique numerique du produit. Aucune dependance, aucun etat :
 * ces fonctions prennent des lignes {date, note} et rendent des nombres.
 */

const DAY_MS = 86400000;

export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
export function fmtDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
export function addDays(dateStr, n) {
  return fmtDate(parseDate(dateStr) + n * DAY_MS);
}
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

export function median(sorted) {
  const n = sorted.length;
  if (n === 0) return null;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Contraste facon tableur : signe(x) * x^2 / 2.5, borne a +/-10.
 * Formule d'origine de l'utilisateur, avec x = note - 5 (centre fixe).
 * Ecrase les journees proches du centre, fait ressortir les extremes.
 */
export function contrast(x) {
  const v = (Math.sign(x) * x * x) / 2.5;
  return Math.max(-10, Math.min(10, Math.round(v * 1000) / 1000));
}

export const REFERENCE_WINDOW_DAYS = 365;
export const MIN_REFERENCE_POINTS = 20;   // SPEC 6 - repli sous 20 points
export const CONTRAST_SATURATION = 4;     // SPEC 6 - echelle de couleur saturee a +/-4
export const DEFAULT_ETALON = 5.7;        // valeur calee a la main dans le tableur d'origine

/**
 * Serie complete. rows doit etre trie par date croissante.
 *
 * reference(d) = mediane des notes des 365 jours calendaires PRECEDANT d
 *                (d exclu : sinon la journee s'auto-influence).
 *                Repli sur la mediane globale sous 20 points -- SPEC 6.
 *
 * On calcule DEUX contrastes :
 *   contrastFixed    = signe(n-5) * (n-5)^2 / 2.5      <- formule tableur d'origine
 *   contrastRelative = signe(delta) * delta^2 / 2.5    <- meme courbe, centre glissant
 *
 * L'ecart entre les deux cumuls est exactement le biais decrit en SPEC 6 :
 * avec une moyenne reelle a ~6.1 et un centre fige a 5, le cumul derive
 * mecaniquement vers le haut et ne veut plus rien dire.
 */
export function buildSeries(rows, { etalon = null } = {}) {
  const withNote = rows.filter(r => r.note !== null && r.note !== undefined);
  const globalMedian = median(withNote.map(r => r.note).sort((a, b) => a - b)) ?? 5;

  // Etalon : constante de calage du cumul. Repli sur la mediane globale si non
  // fourni -- c'est ce qu'un utilisateur ferait a la main, en moins approximatif.
  const eta = etalon === null || etalon === undefined ? globalMedian : Number(etalon);

  const out = [];
  let lo = 0;                 // borne basse de la fenetre glissante
  let cumDelta = 0, cumFixed = 0, cumRelative = 0, cumGlobal = 0, cumEtalon = 0;

  for (let i = 0; i < withNote.length; i++) {
    const row = withNote[i];
    const cutoff = parseDate(row.date) - REFERENCE_WINDOW_DAYS * DAY_MS;
    while (lo < i && parseDate(withNote[lo].date) < cutoff) lo++;

    const window = [];
    for (let j = lo; j < i; j++) window.push(withNote[j].note);
    window.sort((a, b) => a - b);

    const reference = window.length >= MIN_REFERENCE_POINTS ? median(window) : globalMedian;
    const delta = reference === null ? 0 : row.note - reference;

    const cFixed = contrast(row.note - 5);
    const cRelative = contrast(delta);
    const cGlobal = contrast(row.note - globalMedian);

    cumDelta += delta;
    cumFixed += cFixed;
    cumRelative += cRelative;
    cumGlobal += cGlobal;
    cumEtalon += row.note - eta;

    out.push({
      date: row.date,
      note: row.note,
      reference: reference === null ? null : Math.round(reference * 1000) / 1000,
      referencePoints: window.length,
      referenceIsFallback: window.length < MIN_REFERENCE_POINTS,
      delta: Math.round(delta * 1000) / 1000,
      midValue: Math.round((row.note - eta) * 1000) / 1000,   // "MID-VALUE" du tableur
      contrastFixed: cFixed,
      contrastRelative: cRelative,
      contrastGlobal: cGlobal,
      cumDelta: Math.round(cumDelta * 1000) / 1000,
      cumFixed: Math.round(cumFixed * 1000) / 1000,
      cumRelative: Math.round(cumRelative * 1000) / 1000,
      cumGlobal: Math.round(cumGlobal * 1000) / 1000,
      cumEtalon: Math.round(cumEtalon * 1000) / 1000,        // "CUM" du tableur
      cumDeltaRef: Math.round(cumDelta * 1000) / 1000        // meme cumul, etalon glissant
    });
  }
  return out;
}

export function indexByDate(series) {
  const m = new Map();
  for (const s of series) m.set(s.date, s);
  return m;
}

/**
 * SPEC 6 - Episodes.
 *
 * Pour une note N : retrouver les jours <= N, puis compter les jours jusqu'au
 * retour >= reference. Les episodes sont NON CHEVAUCHANTS : un jour deja
 * compris dans un episode en cours n'en ouvre pas un nouveau. Compter les
 * chevauchements gonflerait artificiellement le nombre d'episodes et biaiserait
 * la mediane vers le bas.
 *
 * Rend aussi le nombre d'episodes non resolus a `horizon` jours -- SPEC 6.
 * C'est la moitie honnete du chiffre : sans elle, on ne montre que les issues
 * favorables, ce que SPEC 4.2 interdit.
 */
export function episodes(series, N, { horizon = 60, sustain = 1 } = {}) {
  const byDate = indexByDate(series);
  const today = series.length ? series[series.length - 1] : null;
  const ref = today ? today.reference : null;

  // Un episode n'a de sens que sous la reference. Au-dessus, "tous les jours <= N"
  // ratisse la quasi-totalite du corpus et la statistique ne veut plus rien dire.
  if (ref === null || N >= ref) {
    return { applicable: false, reason: 'at_or_above_reference', reference: ref, note: N };
  }

  const lastDate = series[series.length - 1].date;
  const eps = [];
  let i = 0;
  while (i < series.length) {
    const s0 = series[i];
    if (s0.note > N || s0.reference === null || s0.note >= s0.reference) { i++; continue; }

    // On cherche le retour reel, SANS borne : l'horizon sert a classer l'episode,
    // jamais a le decouper. Le decouper ferait passer une seule periode basse de
    // 40 jours pour deux episodes non resolus -- et ce compteur est le chiffre le
    // plus lourd de l'outil, le gonfler serait alarmiste.
    let j = i + 1, run = 0, resolvedAt = null, endIdx = series.length;
    while (j < series.length) {
      const t = series[j];
      if (t.reference !== null && t.note >= t.reference) {
        run++;
        if (run >= sustain) { resolvedAt = series[j - sustain + 1]; endIdx = j; break; }
      } else run = 0;
      j++;
    }

    if (resolvedAt) {
      const days = daysBetween(s0.date, resolvedAt.date);
      eps.push({ start: s0.date, end: resolvedAt.date, days, resolved: days <= horizon, censored: false });
    } else {
      // Pas de retour observe. Deux situations tres differentes :
      //  - l'episode a eu tout l'horizon pour remonter et ne l'a pas fait -> non resolu ;
      //  - il a commence trop pres de la fin des donnees pour etre jugeable -> CENSURE.
      // Confondre les deux est grave : l'episode en cours est toujours dans le
      // second cas, et c'est precisement celui qu'on regarde un mauvais soir.
      // L'afficher comme "jamais remonte" serait alarmiste et faux.
      const observable = daysBetween(s0.date, lastDate);
      eps.push({
        start: s0.date, end: null, days: null,
        resolved: false, censored: observable < horizon, observedDays: observable
      });
    }
    i = endIdx + 1;
  }

  const resolved = eps.filter(e => e.resolved);
  const censored = eps.filter(e => e.censored);
  const durations = resolved.map(e => e.days).sort((a, b) => a - b);
  // Les episodes censures ne comptent ni comme resolus ni comme non resolus :
  // on n'a simplement pas encore assez de recul pour trancher.
  const unresolved = eps.length - resolved.length - censored.length;
  // Pour les episodes hors horizon on connait quand meme la duree reelle :
  // "jamais remonte a 60 jours" se double alors d'un "remonte au bout de 87".
  const beyond = eps.filter(e => !e.resolved && e.days !== null).map(e => e.days).sort((a, b) => a - b);

  return {
    applicable: true,
    note: N,
    reference: ref,
    horizon,
    sustain,
    count: eps.length,
    comparableCount: eps.length - censored.length,   // ce sur quoi on peut se prononcer
    resolvedCount: resolved.length,
    unresolvedCount: unresolved,
    censoredCount: censored.length,
    medianDays: median(durations),
    maxDays: durations.length ? durations[durations.length - 1] : null,
    beyondHorizonDays: beyond,
    neverReturnedCount: eps.filter(e => e.days === null && !e.censored).length,
    shareUnder4: durations.length ? durations.filter(d => d < 4).length / durations.length : null,
    episodes: eps
  };
}

/**
 * La bande des N jours suivants -- SPEC 8, etape 4.
 * Ce qui s'est REELLEMENT passe apres. Y compris quand c'est reste mauvais.
 */
export function followUp(series, date, n = 14) {
  const byDate = indexByDate(series);
  const out = [];
  for (let k = 1; k <= n; k++) {
    const d = addDays(date, k);
    const s = byDate.get(d);
    out.push(s ? { date: d, note: s.note, delta: s.delta, reference: s.reference } : { date: d, note: null });
  }
  return out;
}

/** Grille annuelle : 12 mois x 31 jours, comme le tableur. */
export function yearGrid(series, year) {
  const byDate = indexByDate(series);
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const days = [];
    const inMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();
    for (let d = 1; d <= 31; d++) {
      if (d > inMonth) { days.push(null); continue; }
      const key = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const s = byDate.get(key);
      days.push(s ? { ...s, weekday: new Date(parseDate(key)).getUTCDay() }
                  : { date: key, note: null, weekday: new Date(parseDate(key)).getUTCDay() });
    }
    const notes = days.filter(x => x && x.note !== null && x.note !== undefined).map(x => x.note);
    months.push({
      month: m,
      days,
      avg: notes.length ? Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 100) / 100 : null,
      count: notes.length
    });
  }
  const all = months.flatMap(mo => mo.days).filter(x => x && x.note !== null && x.note !== undefined);
  return {
    year,
    months,
    avg: all.length ? Math.round((all.reduce((a, b) => a + b.note, 0) / all.length) * 1000) / 1000 : null,
    count: all.length
  };
}

/** Serie de jours consecutifs notes se terminant a `date` (inclus si note). */
export function streak(series, date) {
  const byDate = indexByDate(series);
  let n = 0, cur = date;
  while (byDate.has(cur)) { n++; cur = addDays(cur, -1); }
  return n;
}
