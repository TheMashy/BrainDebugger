/**
 * =====================================================================
 *  L'AXE DES NUITS SE POSE SUR LES NUITS, PAS SUR UNE NORME.
 *
 * Le graphe allait de 20 h à 14 h, en dur : minuit au milieu, une nuit
 * « normale » bien centrée. Pour quelqu'un qui se couche à 5 h et se lève à
 * 16 h, tout tombait dehors — le lever de l'après-midi n'était même pas
 * représentable, il se repliait AVANT le coucher, et la barre se réduisait à
 * un trait de neuf minutes. C'est ce qu'on voyait : des tirets, pas des nuits.
 *
 * Une échelle qui ne peut pas contenir la donnée n'est pas une échelle stricte,
 * c'est une échelle fausse. Et pour un journal de sommeil, c'est le pire
 * endroit où poser une norme : quelqu'un qui dort le jour n'a pas besoin qu'un
 * graphique le lui reproche en refusant de le dessiner.
 *
 * L'origine vient donc des couchers eux-mêmes. Les heures sont circulaires : on
 * cherche le plus grand TROU dans le cercle des couchers, et l'axe commence
 * juste après. Un dormeur du soir obtient un axe qui part le soir, un dormeur
 * du matin un axe qui part le matin, et personne ne voit sa nuit coupée en deux.
 *
 * Et la barre fait la DURÉE, jamais « lever moins coucher » lu sur l'axe : elle
 * part du coucher et descend du temps dormi. Une nuit de neuf heures fait neuf
 * heures, où qu'elle tombe dans la journée.
 * =====================================================================
 */

/** « HH:MM » → heures décimales (6.17 pour 06:10), ou null. */
export const enHeures = hhmm => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m) return null;
  const h = +m[1], min = +m[2];
  return h > 23 || min > 59 ? null : h + min / 60;
};

/** Heures décimales → « HH:MM », en ramenant dans [0, 24). */
export const enHHMM = h => {
  const t = ((h % 24) + 24) % 24;
  let H = Math.floor(t), M = Math.round((t - H) * 60);
  if (M === 60) { M = 0; H = (H + 1) % 24; }
  return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`;
};

/** L'écart d'heure à heure dans le sens du temps : 23:00 → 07:00 vaut 8, pas −16. */
export const versLAvant = (de, a) => (((a - de) % 24) + 24) % 24;

/**
 * L'ORIGINE DE L'AXE : juste avant le premier coucher du groupe.
 *
 * Le plus grand trou du cercle sépare « la fin des couchers » de « leur
 * début » ; l'axe commence à ce début, moins une marge, pour que la première
 * barre ne soit pas collée au bord. Sans coucher du tout, on retombe sur 20 h
 * — un défaut, cette fois, et pas un jugement.
 */
export function origineDesNuits(couchers, marge = 1) {
  const h = couchers.filter(x => x != null).sort((a, b) => a - b);
  if (!h.length) return 20;
  if (h.length === 1) return Math.floor(h[0] - marge);
  let trou = -1, apres = h[0];
  for (let i = 0; i < h.length; i++) {
    const g = versLAvant(h[i], h[(i + 1) % h.length]);
    if (g > trou) { trou = g; apres = h[(i + 1) % h.length]; }
  }
  return Math.floor(apres - marge);
}

/**
 * La durée d'une nuit, en heures : celle qu'on a mesurée, sinon celle que le
 * coucher et le lever donnent en tournant dans le sens du temps.
 */
export function dureeDeLaNuit(n) {
  if (typeof n?.sommeil_h === 'number' && n.sommeil_h > 0) return n.sommeil_h;
  const c = enHeures(n?.coucher), l = enHeures(n?.lever);
  if (c == null || l == null) return null;
  const d = versLAvant(c, l);
  return d > 0 ? d : null;
}

/**
 * Chaque nuit placée sur l'axe : `de` (le coucher) et `a` (le coucher plus la
 * durée), en heures depuis l'origine. Une nuit sans coucher se pose sur son
 * lever, sans hauteur — c'est un point, et ça se voit comme tel.
 *
 * @returns {{origine:number, haut:number, posees:Array}}
 */
export function poserLesNuits(nuits, { marge = 1, minHaut = 12 } = {}) {
  const couchers = nuits.map(n => enHeures(n.coucher)).filter(x => x != null);
  const origine = origineDesNuits(couchers, marge);
  const posees = nuits.map(n => {
    const c = enHeures(n.coucher), l = enHeures(n.lever);
    const duree = dureeDeLaNuit(n);
    if (c == null) {
      return l == null ? { nuit: n, de: null, a: null, duree: null }
                       : { nuit: n, de: versLAvant(origine, l), a: null, duree: null };
    }
    const de = versLAvant(origine, c);
    return { nuit: n, de, a: duree == null ? null : de + duree, duree };
  });
  /*
   * LE HAUT DE L'AXE SUIT LA PLUS LONGUE NUIT, sans jamais dépasser un tour
   * d'horloge : au-delà de vingt-quatre heures on ne lit plus un sommeil, on
   * lit un compteur cassé, et l'échelle entière s'écraserait pour lui.
   */
  const bas = Math.max(...posees.map(p => Math.max(p.de ?? 0, p.a ?? 0)), 0);
  return { origine, haut: Math.min(24, Math.max(minHaut, Math.ceil(bas) + 1)), posees };
}

/** Les graduations : toutes les deux heures, étiquetées à l'heure vraie. */
export function graduations(origine, haut, pas = 2) {
  const out = [];
  for (let t = 0; t <= haut + 1e-9; t += pas) out.push({ t, texte: enHHMM(origine + t) });
  return out;
}

/**
 * LA MÉDIANE D'HEURES EST CIRCULAIRE.
 *
 * Prise à plat, la médiane de {23:30, 00:30} vaut midi — l'heure exactement
 * opposée à celle où dort la personne. On la calcule donc sur l'axe déplié,
 * puis on la remet sur l'horloge.
 */
export function medianeHoraire(heures, origine = null) {
  const h = heures.filter(x => x != null);
  if (!h.length) return null;
  const o = origine ?? origineDesNuits(h, 0);
  const rel = h.map(x => versLAvant(o, x)).sort((a, b) => a - b);
  const m = rel.length % 2 ? rel[(rel.length - 1) / 2]
                           : (rel[rel.length / 2 - 1] + rel[rel.length / 2]) / 2;
  return ((o + m) % 24 + 24) % 24;
}

/** La médiane simple d'une liste de nombres (les durées ne tournent pas). */
export function mediane(v) {
  const x = v.filter(n => typeof n === 'number' && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!x.length) return null;
  return x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2;
}
