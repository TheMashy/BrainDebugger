/**
 * Comparer à la normale.
 *
 * LE MODELE CHOISIT LE FAIT, LE SERVEUR POSSEDE LE NOMBRE.
 *
 * Un modele a qui on demande « donne un chiffre » en invente un, et il le
 * formule si bien qu'on ne peut pas le distinguer d'un vrai. Sur une
 * application qui rend a quelqu'un sa propre vie, un chiffre faux est pire
 * qu'aucun chiffre : il se retient, il se repete, et il oriente ce que la
 * personne croit savoir d'elle.
 *
 * Alors ce fichier calcule TOUTES les comparaisons possibles, les etiquette
 * (c1, c2...), et le modele ne rend qu'une etiquette. La phrase affichee est
 * celle d'ici. Il n'y a aucun chemin par lequel un nombre invente puisse
 * arriver a l'ecran.
 *
 * CE QU'ON NE COMPARE PAS
 * Rien qui puisse se lire comme un verdict. Ces lignes disent « les dimanches
 * sont plus bas que les autres jours », un fait sur des jours ; jamais « tu vas
 * moins bien le dimanche », un fait sur quelqu'un. La difference n'est pas
 * cosmetique : la premiere se verifie, la seconde s'encaisse.
 */

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
              'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/*
 * DEUX GARDE-FOUS DE TAILLE…
 *
 * MIN_COTE : huit journees de chaque cote. En dessous, la moyenne d'un cote
 * bouge d'un demi-point quand une seule journee change, et on aurait publie du
 * bruit avec la meme assurance qu'un fait.
 *
 * MIN_ECART : quatre dixiemes. En dessous, l'ecart tient dans l'arrondi de la
 * note elle-meme -- quelqu'un qui hesite entre 6 et 7 produit cet ecart-la sans
 * que rien n'ait change dans sa vie.
 *
 * … ET UN TEST, PARCE QU'ILS NE SUFFISAIENT PAS.
 *
 * Les journées ne sont pas indépendantes : une note ressemble à celle de la
 * veille, et le niveau change d'une année à l'autre. Sur des notes décalées au
 * hasard par rapport au calendrier, ces deux seuls garde-fous laissaient passer
 * presque autant de comparaisons que sur le vrai journal — « les mois d'août »,
 * « les journées où tu écris » — c'est-à-dire du bruit, affiché comme un fait
 * sur ses propres saisons. Chaque comparaison reçoit donc une p-valeur contre
 * un hasard qui garde ce que la série a de collant, puis Benjamini-Hochberg à
 * Q_BH sur TOUTES les comparaisons calculables, pas seulement sur celles qu'on
 * montrerait.
 */
export const MIN_COTE = 8;
export const MIN_ECART = 0.4;
export const Q_BH = 0.10;
/** Le lendemain se teste à part (contre un mélange des jours), et plus sévèrement. */
export const SEUIL_LENDEMAIN = 0.01;
/** Décalage minimal : en deçà, la série décalée ressemble encore à elle-même. */
export const MARGE_DECALAGE = 30;
/** Tirages des deux tests qui ne s'énumèrent pas (blocs de semaines, mélange). */
const TIRAGES = 999;
/** Les strates d'« écrire » : au moins 3 jours de chaque côté, au moins 4 mois. */
const MIN_STRATE = 3;
const MIN_STRATES = 4;
/** Les journées les plus écrites doivent s'étaler sur au moins 4 mois. */
const MIN_MOIS_LONGUES = 4;

const arrondi = n => Math.round(n * 10) / 10;
const moyenne = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const jourSemaine = d => (new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7;
const jourMs = d => Date.parse(d + 'T00:00:00Z');
const deMois = m => (/^[aeiouéè]/.test(m) ? `d'${m}` : `de ${m}`);
const jourFr = d => `${Number(d.slice(8, 10))} ${MOIS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** Générateur à graine fixe (mulberry32) : deux appels rendent la même liste. */
function alea(graine) {
  let s = graine >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * LE DÉCALAGE CIRCULAIRE, ÉNUMÉRÉ.
 *
 * On fait tourner les notes par rapport aux étiquettes (jour, mois, repère,
 * écrit) de s positions, pour tous les s de MARGE_DECALAGE à N − MARGE_DECALAGE.
 * Ce qui colle d'un jour à l'autre, et les changements de niveau, voyagent
 * avec les notes ; seul le lien avec l'étiquette est cassé. Énuméré et non
 * tiré : un tirage à 499 donnait « août » à 0,008 ou à 0,016 selon la graine,
 * pile au seuil. `garder(s)` écarte les décalages qui ne cassent rien (pour un
 * jour de la semaine, un multiple de 7 le remet sur lui-même).
 *
 * @param {number[]} x        les notes, dans l'ordre
 * @param {number} obs        l'écart observé
 * @param {(get:(i:number)=>number) => number|null} stat
 * @param {(s:number) => boolean} garder
 */
function pDecalage(x, obs, stat, garder = () => true) {
  const N = x.length;
  let ge = 0, n = 0;
  for (let s = MARGE_DECALAGE; s <= N - MARGE_DECALAGE; s++) {
    if (!garder(s)) continue;
    const v = stat(i => x[(i + s) % N]);
    if (v === null) continue;
    n++;
    if (Math.abs(v) >= Math.abs(obs) - 1e-12) ge++;
  }
  return n ? (1 + ge) / (1 + n) : 1;
}

/** Écart moyen dedans − dehors, les indices « dedans » fixés. */
function ecartIndices(idx, N, total) {
  const nIn = idx.length, nOut = N - nIn;
  return get => {
    let s = 0;
    for (const i of idx) s += get(i);
    return s / nIn - (total - s) / nOut;
  };
}

/** Benjamini-Hochberg : les identifiants qui passent au niveau q. */
function bh(tests, q) {
  const tri = tests.slice().sort((a, b) => a.p - b.p);
  const m = tri.length;
  let k = 0;
  tri.forEach((t, i) => { if (t.p <= q * (i + 1) / m) k = i + 1; });
  return new Set(tri.slice(0, k).map(t => t.id));
}

/**
 * @param {{date:string, note:number|null, text:string|null}[]} rows
 * @param {{date:string, fin:string|null, label:string}[]} events
 * @returns {{id:string, phrase:string, ecart:number, n:number, p:number}[]}
 */
export function comparaisons(rows, events = []) {
  const notees = (rows ?? []).filter(r => r.note !== null && r.note !== undefined)
    .slice().sort((a, b) => a.date.localeCompare(b.date));
  if (notees.length < MIN_COTE * 2) return [];

  const N = notees.length;
  const x = notees.map(r => r.note);
  const ecrit = notees.map(r => !!(r.text && r.text.trim()));
  // La somme de toutes les notes ne dépend pas du décalage : on la calcule une fois.
  const T = x.reduce((a, b) => a + b, 0);

  /*
   * Chaque candidate : sa statistique, sa p-valeur, et ce qu'il faut EN PLUS
   * pour la publier (`publiable`). Une candidate qui échoue à ce « en plus »
   * reste dans la famille de Benjamini-Hochberg : elle a été regardée, elle
   * compte.
   */
  const candidates = [];
  let n = 0;
  const id = () => `c${++n}`;

  /** Une comparaison « dedans / dehors » à étiquettes fixes, testée par décalage. */
  const parEtiquette = (cid, dedansIdx, phrase, { garder, publiable = true } = {}) => {
    const nIn = dedansIdx.length, nOut = N - nIn;
    if (nIn < MIN_COTE || nOut < MIN_COTE) return;
    const stat = ecartIndices(dedansIdx, N, T);
    const obs = stat(i => x[i]);
    const a = moyenne(dedansIdx.map(i => x[i]));
    candidates.push({
      id: cid, ecart: obs, n: nIn, publiable,
      phrase: () => phrase(arrondi(a), arrondi(a - obs), nIn),
      p: pDecalage(x, obs, stat, garder)
    });
  };

  /* --- les jours de la semaine --- */
  for (let j = 0; j < 7; j++) {
    const idx = [];
    notees.forEach((r, i) => { if (jourSemaine(r.date) === j) idx.push(i); });
    parEtiquette(id(), idx, (a, b, k) =>
      `les ${JOURS[j]}s sont à ${a} de moyenne, contre ${b} les autres jours (${k} ${JOURS[j]}s)`,
      // Un décalage de 7, 14, 21… jours remet chaque jour sur lui-même : ce n'est
      // pas un tirage du hasard, c'est la comparaison observée une deuxième fois.
      // Les garder, c'est interdire à tout rythme de la semaine d'être jamais vu.
      { garder: s => s % 7 !== 0 });
  }

  /* --- les mois de l'année ---
     « (155 journées) » faisait paraître solide ce qui repose sur 5 mois d'août.
     La phrase compte donc en MOIS, et l'écart doit aller dans le même sens à
     l'intérieur de CHAQUE année où le mois est assez noté (au moins 3 années) :
     un seul bon été ne fait pas « les mois d'août ».

     Pourquoi chaque année, et pas N − 1 sur N : mesuré sur une série qui colle
     et change de niveau deux fois, sans aucune saison, « N − 1 sur N » ne
     retenait presque rien — quand l'écart global sort, les années suivent — et
     un mois sortait dans une graine sur dix. Les décalages d'environ un an
     sont gardés, eux : ils remettent août sur août et rendent le test sévère ;
     un vrai creux de saison, répété chaque année, passe quand même. */
  for (let m = 1; m <= 12; m++) {
    const cle = String(m).padStart(2, '0');
    const idx = [];
    notees.forEach((r, i) => { if (r.date.slice(5, 7) === cle) idx.push(i); });
    const nbMois = new Set(idx.map(i => notees[i].date.slice(0, 7))).size;
    const signe = idx.length && idx.length < N
      ? Math.sign(moyenne(idx.map(i => x[i])) - (T - idx.reduce((s, i) => s + x[i], 0)) / (N - idx.length))
      : 0;
    // Le même écart, année par année : le mois contre le reste de SON année.
    // Une année où le mois (ou le reste) a moins de MIN_COTE journées ne vote pas.
    const parAn = new Map();
    notees.forEach((r, i) => {
      const an = r.date.slice(0, 4);
      if (!parAn.has(an)) parAn.set(an, { dedans: [], dehors: [] });
      parAn.get(an)[r.date.slice(5, 7) === cle ? 'dedans' : 'dehors'].push(x[i]);
    });
    const annees = [...parAn.values()].filter(a => a.dedans.length >= MIN_COTE && a.dehors.length >= MIN_COTE);
    const memeSens = annees.filter(a => Math.sign(moyenne(a.dedans) - moyenne(a.dehors)) === signe).length;
    const nom = MOIS[m - 1];
    parEtiquette(id(), idx, (a, b) =>
      `les mois ${deMois(nom)} sont à ${a}, contre ${b} le reste de l'année (sur ${nbMois} mois ${deMois(nom)})`,
      { publiable: annees.length >= 3 && memeSens === annees.length });
  }

  /* --- écrire, ou ne pas écrire ---
     Une corrélation, jamais une cause : on ne sait pas si écrire fait remonter
     ou si remonter donne envie d'écrire, et la phrase ne le suppose pas.

     Et surtout, à période égale. Comparées à tout l'historique, les journées
     écrites mesuraient surtout QUAND on a écrit (des semaines plutôt bonnes)
     contre des années importées où écrire n'existait pas. On ne regarde donc
     qu'à partir de la première journée écrite, et on compare mois par mois :
     un mois compte s'il a au moins 3 journées de chaque côté, pondéré par ses
     journées écrites, et il en faut au moins 4. */
  {
    const cid = id();
    const debut = ecrit.indexOf(true);
    if (debut >= 0) {
      const D = [];
      for (let i = debut; i < N; i++) D.push(i);
      const M = D.length;
      const y = D.map(i => x[i]);
      const cles = D.map(i => notees[i].date.slice(0, 7));
      const parStrate = new Map();
      D.forEach((i, j) => {
        if (!parStrate.has(cles[j])) parStrate.set(cles[j], { e: [], u: [] });
        parStrate.get(cles[j])[ecrit[i] ? 'e' : 'u'].push(j);
      });
      const strates = [...parStrate.values()].filter(s => s.e.length >= MIN_STRATE && s.u.length >= MIN_STRATE);
      const nE = strates.reduce((a, s) => a + s.e.length, 0);
      const nU = strates.reduce((a, s) => a + s.u.length, 0);
      if (strates.length && nE >= MIN_COTE && nU >= MIN_COTE) {
        const stat = get => {
          let num = 0;
          for (const s of strates) {
            let se = 0, su = 0;
            for (const j of s.e) se += get(j);
            for (const j of s.u) su += get(j);
            num += s.e.length * (se / s.e.length - su / s.u.length);
          }
          return num / nE;
        };
        const obs = stat(j => y[j]);
        let se = 0;
        for (const s of strates) for (const j of s.e) se += y[j];
        const a = se / nE;
        const jours = strates.flatMap(s => s.e).map(j => notees[D[j]].date).sort();
        candidates.push({
          id: cid, ecart: obs, n: nE, publiable: strates.length >= MIN_STRATES,
          phrase: () => `les journées où tu écris sont à ${arrondi(a)}, celles où tu ne notes qu'un chiffre à ${arrondi(a - obs)}, à mois égal (${nE} journées écrites sur ${strates.length} mois, du ${jourFr(jours[0])} au ${jourFr(jours.at(-1))})`,
          p: pDecalage(y, obs, stat)
        });
      }
    }
  }

  /* --- les journées longues ---
     Le cinquieme le plus fourni contre le reste. Le seuil est un QUANTILE et
     pas un nombre de signes : « long » ne veut pas dire la meme chose chez
     quelqu'un qui ecrit trois lignes et chez quelqu'un qui en ecrit trente.

     Neuf journées longues dont six d'affilée ne sont pas neuf observations :
     elles doivent s'étaler sur au moins 4 mois, et le hasard qu'on leur
     oppose mélange des SEMAINES entières, pas des jours. */
  {
    const cid = id();
    const E = [];
    notees.forEach((r, i) => { if (ecrit[i]) E.push(i); });
    if (E.length >= MIN_COTE * 2) {
      const tailles = E.map(i => notees[i].text.length).sort((a, b) => a - b);
      const seuil = tailles[Math.floor(tailles.length * 0.8)];
      const long = E.map(i => notees[i].text.length >= seuil);
      const nIn = long.filter(Boolean).length, nOut = E.length - nIn;
      if (nIn >= MIN_COTE && nOut >= MIN_COTE) {
        const v = E.map(i => x[i]);
        const stat = vs => {
          let si = 0, so = 0;
          vs.forEach((val, k) => { if (long[k]) si += val; else so += val; });
          return si / nIn - so / nOut;
        };
        const obs = stat(v);
        // Les blocs : une semaine (du lundi au dimanche) de journées écrites.
        const blocs = [];
        let cle = null;
        E.forEach((i, k) => {
          const lundi = jourMs(notees[i].date) - jourSemaine(notees[i].date) * 86400000;
          if (lundi !== cle) { blocs.push([]); cle = lundi; }
          blocs.at(-1).push(v[k]);
        });
        const r = alea(21);
        let ge = 0;
        for (let b = 0; b < TIRAGES; b++) {
          const ordre = blocs.slice();
          for (let k = ordre.length - 1; k > 0; k--) {
            const j = Math.floor(r() * (k + 1));
            [ordre[k], ordre[j]] = [ordre[j], ordre[k]];
          }
          if (Math.abs(stat(ordre.flat())) >= Math.abs(obs) - 1e-12) ge++;
        }
        const mois = new Set(E.filter((i, k) => long[k]).map(i => notees[i].date.slice(0, 7))).size;
        const a = v.filter((_, k) => long[k]).reduce((s, q) => s + q, 0) / nIn;
        candidates.push({
          id: cid, ecart: obs, n: nIn, publiable: mois >= MIN_MOIS_LONGUES,
          phrase: () => `tes journées les plus écrites sont à ${arrondi(a)}, les autres à ${arrondi(a - obs)} (${nIn} journées)`,
          p: (1 + ge) / (1 + TIRAGES)
        });
      }
    }
  }

  /* --- le lendemain d'une journée basse ---
     « le lendemain d'une journée à 3 ou moins, tu es à 5.1 » était une phrase
     sur quelqu'un, et elle taisait l'essentiel : la veille était à 2 ou 3, et
     le lendemain remonte le plus souvent. La phrase dit donc la veille, et,
     parce qu'on ne montre jamais seulement les issues favorables, combien
     remontent ET combien restent bas.

     Ici c'est justement ce qui colle d'un jour à l'autre qu'on mesure : le
     décalage le garderait. Le hasard qu'on oppose est un mélange des jours,
     et ce test vit à part, à SEUIL_LENDEMAIN. */
  let lendemain = null;
  {
    const cid = id();
    const indice = new Map(notees.map((r, i) => [r.date, i]));
    const paires = [];
    notees.forEach((r, i) => {
      const v = indice.get(new Date(jourMs(r.date) - 86400000).toISOString().slice(0, 10));
      if (v !== undefined) paires.push([v, i]);
    });
    const stat = get => {
      let sa = 0, na = 0, sr = 0, nr = 0;
      for (const [v, i] of paires) {
        if (get(v) <= 3) { sa += get(i); na++; } else { sr += get(i); nr++; }
      }
      return na >= MIN_COTE && nr >= MIN_COTE ? sa / na - sr / nr : null;
    };
    const obs = stat(i => x[i]);
    if (obs !== null) {
      const basses = paires.filter(([v]) => x[v] <= 3);
      const k = basses.length;
      const a = moyenne(basses.map(([, i]) => x[i]));
      const veille = moyenne(basses.map(([v]) => x[v]));
      const up = basses.filter(([v, i]) => x[i] >= x[v] + 2).length;
      const bas = basses.filter(([, i]) => x[i] <= 3).length;
      const r = alea(22);
      const perm = x.slice();
      let ge = 0, nb = 0;
      for (let b = 0; b < TIRAGES; b++) {
        for (let q = perm.length - 1; q > 0; q--) {
          const j = Math.floor(r() * (q + 1));
          [perm[q], perm[j]] = [perm[j], perm[q]];
        }
        const vb = stat(i => perm[i]);
        if (vb === null) continue;
        nb++;
        if (Math.abs(vb) >= Math.abs(obs) - 1e-12) ge++;
      }
      lendemain = {
        id: cid, ecart: obs, n: k, publiable: true,
        phrase: () => `les lendemains d'une journée à 3 ou moins sont à ${arrondi(a)} en moyenne (la veille : ${arrondi(veille)}) ; les autres lendemains, à ${arrondi(a - obs)} (${k} fois) ; ${up} sur ${k} remontent d'au moins 2 points, ${bas} restent à 3 ou moins`,
        p: (1 + ge) / (1 + nb)
      };
    }
  }

  /* --- les deux semaines qui suivent un repère ---
     Les repères restent où ils sont ; ce sont les notes qu'on fait tourner
     sous eux, comme pour le calendrier. */
  {
    const bornes = (events ?? []).map(e => e?.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d ?? ''));
    if (bornes.length) {
      const proche = d => bornes.some(b => {
        const k = (jourMs(d) - jourMs(b)) / 86400000;
        return k >= 0 && k < 14;
      });
      const idx = [];
      notees.forEach((r, i) => { if (proche(r.date)) idx.push(i); });
      parEtiquette(id(), idx, (a, b, k) =>
        `les deux semaines qui suivent un repère sont à ${a}, le reste à ${b} (${k} journées)`);
    }
  }

  const passe = bh(candidates, Q_BH);
  const retenues = candidates.filter(c => passe.has(c.id) && c.publiable && Math.abs(c.ecart) >= MIN_ECART);
  if (lendemain && lendemain.p <= SEUIL_LENDEMAIN && Math.abs(lendemain.ecart) >= MIN_ECART) {
    retenues.push(lendemain);
  }

  // Les mieux établies d'abord, pas les plus grosses : trier par |écart|
  // mettait en tête le plus petit groupe, parce qu'une moyenne sur neuf
  // journées est la plus extrême (malédiction du vainqueur). Douze, parce
  // qu'au-delà on demande au modèle de choisir dans un catalogue au lieu de lire.
  return retenues
    .sort((a, b) => (a.p - b.p) || (Math.abs(b.ecart) - Math.abs(a.ecart)))
    .slice(0, 12)
    .map(c => ({
      id: c.id, phrase: c.phrase(), ecart: arrondi(c.ecart), n: c.n,
      p: Math.round(c.p * 10000) / 10000
    }));
}

/** Le bloc transmis au modèle. Les identifiants sont ce qu'il rendra. */
export function comparaisonBlock(liste) {
  if (!liste?.length) return null;
  return `DES COMPARAISONS DÉJÀ CALCULÉES. Le calcul est exact ; ce sont des écarts observés, pas des causes — elles sortent de ses notes,
pas de toi. Chacune porte un identifiant.

Quand un thème repose sur l'une d'elles, mets son identifiant dans « chiffre ». Tu ne
recopies PAS le nombre et tu n'en écris aucun autre : l'application affichera la phrase
exacte à la place. Un chiffre inventé se retient, se répète, et oriente ce qu'elle croit
savoir d'elle.

Si aucune ne correspond au thème, laisse « chiffre » vide. Un thème sans chiffre est un
thème normal ; un thème avec le mauvais chiffre est un thème faux.

${liste.map(c => `[${c.id}] ${c.phrase}`).join('\n')}`;
}
