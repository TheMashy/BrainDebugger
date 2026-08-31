/*
 * =====================================================================
 * CE QUI VA ENSEMBLE — ET LE PIÈGE QUI REND CE FICHIER DIFFICILE.
 *
 * Une montre envoie le sommeil, les pas, la fréquence au repos, le temps
 * d'écran. Le journal, lui, porte une note par journée. Croiser les deux est
 * exactement ce qu'un cerveau ne sait pas faire : personne ne se souvient de
 * quarante nuits assez précisément pour dire si les courtes tombent avec les
 * mauvaises journées. C'est la promesse du produit.
 *
 * ---------------------------------------------------------------------
 * LE PIEGE : AVEC ASSEZ DE SERIES, ON TROUVE TOUJOURS QUELQUE CHOSE.
 *
 * Vingt séries testées à deux décalages font quarante tests. À p < 0,05, on
 * attend DEUX résultats « significatifs » par pur hasard, sur des données
 * entièrement aléatoires. Une application qui les affiche dit à quelqu'un que
 * son café explique son anxiété alors qu'elle a tiré à pile ou face quarante
 * fois — et cette personne va réorganiser sa vie autour.
 *
 * C'est le défaut central du quantified self, et ce n'est pas un détail
 * d'implémentation : c'est la raison pour laquelle ce fichier existe plutôt
 * qu'une boucle de dix lignes qui calcule des corrélations.
 *
 * La correction est celle de Benjamini-Hochberg, qui contrôle la PROPORTION de
 * fausses découvertes parmi ce qu'on montre. Bonferroni, l'autre choix
 * classique, exigerait ici p < 0,00125 : sur soixante journées, plus rien ne
 * passerait jamais, et le produit aurait l'air cassé alors qu'il serait
 * seulement muet. Benjamini-Hochberg garde un taux d'erreur annoncé (5 % de ce
 * qui est montré, en espérance) tout en laissant passer les liens réels.
 *
 * ---------------------------------------------------------------------
 * ON NE DIT JAMAIS QUE L'UN PRODUIT L'AUTRE.
 *
 * Un lien entre le sommeil et l'humeur ne dit pas lequel des deux mène. Dormir
 * peu peut abîmer la journée ; une journée qui s'annonce mal peut aussi tenir
 * éveillé la nuit d'avant. Le vocabulaire de ce module est donc « va avec »,
 * « arrive avec », « tombe avec » — et un test relit le fichier pour s'assurer
 * qu'aucun verbe de causalité n'y est entré.
 *
 * Le DECALAGE est ce qui s'en approche le plus : une mesure du jour J contre la
 * note du jour J+1 a au moins la flèche du temps dans le bon sens. On le
 * calcule, on l'affiche à part, et on n'en conclut toujours rien.
 * =====================================================================
 */

/** Sous ce nombre de journées appariées, un coefficient est du bruit décoré. */
export const MIN_POINTS = 20;

/**
 * Le jour même, et le lendemain.
 *
 * Deux décalages et pas dix : chacun multiplie le nombre de tests, donc
 * durcit le seuil pour tous les autres. Un décalage de sept jours n'a pas
 * d'histoire plausible derrière lui, et le payer en puissance statistique
 * reviendrait à cacher les liens réels pour garder une case vide.
 */
export const DECALAGES = [0, 1];

/** En dessous, le lien est réel mais trop faible pour qu'on en fasse quelque chose. */
export const R_MINIMAL = 0.3;

/** Le taux de fausses découvertes qu'on accepte parmi ce qui est montré. */
export const FDR = 0.05;

/* ------------------------------------------------------------------ */
/* La statistique, sans dépendance : le produit n'en a aucune.         */
/* ------------------------------------------------------------------ */

/** Lanczos. Sert uniquement à la fonction bêta ci-dessous. */
function lnGamma(x) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091,
             -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j++) ser += c[j] / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

/** Fraction continue de la bêta incomplète (méthode de Lentz). */
function betacf(a, b, x) {
  const TINY = 1e-30;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - qab * x / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d; h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-7) break;
  }
  return h;
}

/** Bêta incomplète régularisée I_x(a, b). */
export function betai(a, b, x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b)
                      + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2)
    ? bt * betacf(a, b, x) / a
    : 1 - bt * betacf(b, a, 1 - x) / b;
}

/** Pearson. `null` si l'une des deux séries ne varie pas : r y est indéfini. */
export function correlation(xs, ys) {
  const n = xs.length;
  if (n < 3 || ys.length !== n) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * La valeur p bilatérale d'un coefficient de Pearson.
 *
 * `t = r * sqrt((n-2)/(1-r*r))`, puis la queue de Student par la bêta
 * incomplète. On l'écrit à la main parce que le produit n'a aucune dépendance,
 * et qu'une table approchée se tromperait exactement là où ça compte : près du
 * seuil, qui est le seul endroit où la valeur sert.
 */
export function valeurP(r, n) {
  if (r == null || n < 3) return 1;
  const df = n - 2;
  const rr = Math.min(Math.abs(r), 0.999999);
  const t2 = (rr * rr * df) / (1 - rr * rr);
  return betai(df / 2, 0.5, df / (df + t2));
}

/**
 * BENJAMINI-HOCHBERG.
 *
 * Les p triées croissantes ; on garde les k premières telles que
 * p(k) <= k/m * FDR, en prenant le plus GRAND k qui vérifie l'inégalité. Tout
 * ce qui est sous ce rang passe, y compris une p isolée qui échouerait au test
 * prise seule : c'est la propriété qui distingue cette correction d'un seuil
 * appliqué ligne à ligne, et elle est volontaire.
 */
export function retenir(tests, fdr = FDR) {
  const m = tests.length;
  if (!m) return [];
  const tries = [...tests].sort((a, b) => a.p - b.p);
  let rang = 0;
  for (let k = 1; k <= m; k++) if (tries[k - 1].p <= (k / m) * fdr) rang = k;
  return tries.slice(0, rang);
}

/* ------------------------------------------------------------------ */

const jour = d => String(d).slice(0, 10);
const decale = (d, n) => new Date(Date.parse(`${jour(d)}T12:00:00Z`) + n * 86400000)
  .toISOString().slice(0, 10);

/**
 * APPARIER UNE SERIE ET LES NOTES, A UN DECALAGE DONNE.
 *
 * Décalage 0 : la mesure du jour J contre la note du jour J.
 * Décalage 1 : la mesure du jour J contre la note du jour J+1, la seule des
 * deux qui ait la flèche du temps dans le bon sens.
 *
 * Une journée sans mesure ou sans note ne produit pas de paire : on ne comble
 * pas un trou par une moyenne, qui ajouterait des points au centre du nuage et
 * gonflerait la confiance sans ajouter la moindre observation.
 */
export function apparier(serie, notes, decalage = 0) {
  const xs = [], ys = [], jours = [];
  for (const m of serie) {
    if (m.valeur == null) continue;
    const n = notes.get(decale(m.date, decalage));
    if (n == null) continue;
    xs.push(m.valeur); ys.push(n); jours.push(jour(m.date));
  }
  return { xs, ys, jours };
}

/**
 * L'ECART EN POINTS, QUI EST LA SEULE CHOSE LISIBLE.
 *
 * « r = 0,42 » ne veut rien dire pour personne. « les journées où tu as dormi
 * moins de 6 h sont notées 1,8 point plus bas » se comprend d'un coup, et se
 * vérifie contre son propre souvenir — ce qui est exactement ce qu'on veut que
 * la personne fasse d'un lien statistique.
 *
 * On coupe la série à sa médiane et on compare les deux moyennes de notes. La
 * médiane et non la moyenne : une série de pas avec trois journées de randonnée
 * a une moyenne que quatre jours sur cinq ne dépassent jamais, et la coupure
 * tomberait alors sur un groupe minuscule.
 */
export function ecartDeMoitie(xs, ys) {
  const tri = [...xs].sort((a, b) => a - b);
  const med = tri.length % 2 ? tri[(tri.length - 1) / 2]
    : (tri[tri.length / 2 - 1] + tri[tri.length / 2]) / 2;
  const bas = [], haut = [];
  for (let i = 0; i < xs.length; i++) (xs[i] <= med ? bas : haut).push(ys[i]);
  if (bas.length < 3 || haut.length < 3) return null;
  const moy = a => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    seuil: Math.round(med * 100) / 100,
    sous: Math.round(moy(bas) * 10) / 10,
    sur: Math.round(moy(haut) * 10) / 10,
    ecart: Math.round((moy(haut) - moy(bas)) * 10) / 10
  };
}

/**
 * TOUS LES LIENS, TESTES ENSEMBLE ET CORRIGES ENSEMBLE.
 *
 * `mesures` : les lignes brutes {date, source, cle, valeur}.
 * `entries` : les journées {date, note}.
 *
 * La correction se fait sur L'ENSEMBLE des tests, pas série par série : c'est
 * le nombre total de fois qu'on a interrogé le hasard qui décide du seuil, et
 * corriger par paquets reviendrait à ne pas corriger du tout.
 */
export function liens(mesures, entries, { minPoints = MIN_POINTS, fdr = FDR } = {}) {
  const notes = new Map();
  for (const e of entries ?? []) if (e.note != null) notes.set(jour(e.date), e.note);

  const series = new Map();
  for (const m of mesures ?? []) {
    if (m.valeur == null) continue;
    const k = `${m.source} ${m.cle}`;
    if (!series.has(k)) {
      series.set(k, { source: m.source, cle: m.cle, unite: m.unite ?? null, points: [] });
    }
    series.get(k).points.push(m);
  }

  const tests = [];
  for (const s of series.values()) {
    for (const d of DECALAGES) {
      const { xs, ys } = apparier(s.points, notes, d);
      if (xs.length < minPoints) continue;
      const r = correlation(xs, ys);
      if (r == null) continue;
      tests.push({
        source: s.source, cle: s.cle, unite: s.unite, decalage: d,
        n: xs.length, r: Math.round(r * 1000) / 1000, p: valeurP(r, xs.length),
        sens: r > 0 ? 'haut' : 'bas',
        moitie: ecartDeMoitie(xs, ys)
      });
    }
  }

  const retenus = retenir(tests, fdr)
    /*
     * Un lien réel mais minuscule n'appelle aucune décision, et occupe la place
     * d'un lien qui en appelle une. Le filtre passe APRES la correction :
     * retirer des tests avant fausserait le compte `m`, et rendrait la
     * correction plus permissive que ce qu'elle annonce.
     */
    .filter(t => Math.abs(t.r) >= R_MINIMAL)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r));

  return {
    liens: retenus,
    testes: tests.length,
    series: series.size,
    /*
     * De quoi dire « rien pour l'instant, et voici pourquoi » plutôt que de
     * laisser une page vide. Aucune mesure, pas assez de journées appariées, ou
     * rien qui survive à la correction : ce sont trois histoires différentes, et
     * la deuxième se répare en attendant deux semaines.
     */
    assezDePoints: tests.length > 0
  };
}
