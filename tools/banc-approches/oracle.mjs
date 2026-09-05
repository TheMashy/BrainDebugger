/*
 * L'ORACLE D'IDENTIFIABILITÉ : le banc doit mesurer les méthodes, pas le générateur.
 *
 * Pour chaque fonctionnement planté, un estimateur qui CONNAÎT la forme (la bonne
 * variable, le bon lag, la bonne date) est appliqué à la série OBSERVÉE. S'il ne
 * retrouve pas l'item, aucune méthode aveugle ne le pouvait : l'item est marqué
 * `neutre` — ni récompensé ni pénalisé — et sort du dénominateur. Les seuils de
 * classes (autocorr, regularity) viennent de calibration.json (quantiles du témoin).
 */
import { spearman, seuilR, ar1, ecartType, welch, moyenne, colonne } from './stats.mjs';
import { etatsDe, compterChaine } from './etats.mjs';

export function identifiable(item, serie, calib) {
  const J = serie.jours, T = J.length;
  const col = k => colonne(J, k);
  switch (item.type) {
    case 'edge': {
      const { r, n } = spearman(col(item.a), col(item.b), item.lag);
      if (r == null) return false;
      const bonSigne = item.signe === '-' ? r < 0 : r > 0;
      return bonSigne && Math.abs(r) > seuilR(n);
    }
    case 'chain': return item.realise === true;   // déjà compté sur l'observé (≥ 3 occurrences)
    case 'episode': {
      const v = item.genre === 'manie' ? col('humeur') : col('humeur');
      const avant = [], apres = [];
      for (let t = Math.max(0, item.t0 - 14); t < item.t0; t++) if (v[t] != null) avant.push(v[t]);
      for (let t = item.t0; t < Math.min(T, item.t0 + 14); t++) if (v[t] != null) apres.push(v[t]);
      if (avant.length < 6 || apres.length < 6) return false;
      const d = moyenne(apres) - moyenne(avant);
      return item.genre === 'manie' ? d >= 1 : d <= -1;
    }
    case 'ews': {
      const v = col(item.var);
      const a = v.slice(Math.max(0, item.t0 - 28), item.t0 - 14), b = v.slice(item.t0 - 14, item.t0);
      const na = a.filter(x => x != null).length, nb = b.filter(x => x != null).length;
      if (na < 8 || nb < 8) return false;
      if (item.var === 'sommeil_h') { const t = welch(b, a); return t != null && t < -1.5; }   // la nuit raccourcit
      const ra = ar1(a), rb = ar1(b), sa = ecartType(a), sb = ecartType(b);
      return (ra != null && rb != null && rb > ra + 0.1) || (sa != null && sb != null && sb > sa * 1.25);
    }
    case 'rhythm': {
      const t1 = welch(J.filter(j => j.t % 7 >= 5).map(j => j.humeur), J.filter(j => j.t % 7 < 5).map(j => j.humeur));
      const t2 = welch(J.filter(j => j.t % 7 === 4 || j.t % 7 === 5).map(j => j.coucher), J.filter(j => !(j.t % 7 === 4 || j.t % 7 === 5)).map(j => j.coucher));
      const t3 = welch(J.filter(j => j.t % 7 >= 5).map(j => j.sommeil_h), J.filter(j => j.t % 7 < 5).map(j => j.sommeil_h));
      return [t1, t2, t3].some(t => t != null && Math.abs(t) > 2.3);
    }
    case 'regularity': {
      const sd = ecartType(col('coucher')); if (sd == null) return false;
      return item.classe === 'haute' ? sd > calib.regularity.haute : sd < calib.regularity.basse;
    }
    case 'autocorr': {
      const phi = ar1(col('humeur')); if (phi == null) return false;
      return item.classe === 'high' ? phi > calib.autocorr.high : phi < calib.autocorr.low;
    }
    case 'coupling_sign': {
      const s = [], h = [];
      for (let t = item.de; t < item.a_jour; t++) if (J[t]?.sommeil_h != null && J[t]?.humeur != null) { s.push(J[t].sommeil_h); h.push(J[t].humeur); }
      const { r, n } = spearman(s, h); return r != null && r < 0 && Math.abs(r) > seuilR(n, 1.64);
    }
    case 'language': {
      if (item.avec === 'humeur') { const { r, n } = spearman(col('absolus'), col('humeur')); return r != null && r <= -0.3 && Math.abs(r) > seuilR(n); }
      const a = J.filter(j => j.dereel === 1).map(j => j.absolus).filter(x => x != null), b = J.filter(j => j.dereel === 0).map(j => j.absolus).filter(x => x != null);
      if (a.length < 4) return false; const t = welch(a, b); return t != null && t > 2;
    }
  }
  return false;
}

/** Marque chaque item de la vérité : identifiable ou neutre. Rend le compte. */
export function marquer(serie, calib) {
  let n = 0, k = 0;
  for (const v of serie.verite) { v.neutre = !identifiable(v, serie, calib); n++; if (!v.neutre) k++; }
  return { plantes: n, identifiables: k };
}
