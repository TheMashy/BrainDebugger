/*
 * =====================================================================
 * LIRE UN DIGEST DONT ON NE CONNAIT PAS LA FORME.
 *
 * L'application qui envoie ecrit ce qu'elle veut, et elle a raison : sa forme
 * lui appartient et elle bougera. Le site l'affichait donc tel quel, en arbre,
 * ligne par ligne. Sur un vrai digest ca donne ceci :
 *
 *     web:summer          412
 *     web:(7)             389
 *     web:we're           301
 *     web:reddit          288
 *     ... trente autres titres de pages ...
 *
 * Trente-cinq lignes, toutes vraies, aucune lisible. Ce ne sont pas
 * trente-cinq mesures : c'est UNE mesure -- « le navigateur » -- decoupee par
 * titre de page. Ce qu'on veut lire, c'est la mesure ; les titres sont un
 * detail de la mesure.
 *
 * ---------------------------------------------------------------------
 * ON NE REECRIT RIEN, ON REGROUPE.
 *
 * Aucun nom n'est traduit, aucune valeur n'est convertie ici : ce fichier ne
 * fait que reconnaitre qu'un paquet de cles vont ENSEMBLE, et dire lesquelles
 * portent le poids. Tout ce qu'il retire est compte et annonce (« + 29
 * autres ») -- jamais efface en silence, parce qu'une donnee arrivee a le droit
 * d'etre vue et que cacher sans le dire ferait croire qu'elle n'est pas
 * arrivee.
 *
 * LE SEUIL EST RELATIF, PAS ABSOLU. On ne sait pas si 412 est des secondes,
 * des minutes ou des clics : un seuil en « au moins cinq minutes » serait une
 * supposition sur l'unite. On nomme donc les plus grosses jusqu'a couvrir
 * l'essentiel du total, et le reste se compte. C'est vrai quelle que soit
 * l'unite.
 * =====================================================================
 */

/** Combien de lignes on nomme au maximum dans une famille. */
export const TETES = 5;
/** Jusqu'ou on nomme : les plus grosses, jusqu'a couvrir cette part du total. */
export const COUVERTURE = 0.75;
/** En dessous, ce n'est pas une famille, ce sont des lignes. */
export const MIN_FAMILLE = 4;

/** Les separateurs qu'une application utilise pour dire « sous-partie de ». */
const SEPARATEURS = [':', '/', ' — ', ' - ', '|'];

/** Le prefixe d'une cle composee : `web:summer` -> `web`. Sinon null. */
export function prefixeDe(cle) {
  const k = String(cle ?? '');
  for (const sep of SEPARATEURS) {
    const i = k.indexOf(sep);
    // Un separateur en tete (`:x`) ou en queue (`x:`) ne separe rien.
    if (i > 0 && i < k.length - sep.length) return k.slice(0, i).trim();
  }
  return null;
}

/** Ce qui reste apres le prefixe : `web:summer` -> `summer`. */
export function suffixeDe(cle) {
  const k = String(cle ?? '');
  for (const sep of SEPARATEURS) {
    const i = k.indexOf(sep);
    if (i > 0 && i < k.length - sep.length) return k.slice(i + sep.length).trim();
  }
  return k;
}

/**
 * L'OBJET, MIS A PLAT, EN GARDANT QUI EST LE PARENT DE QUI.
 *
 * Le parent compte autant que la cle : `apps: { chrome: 400, code: 900 }` et
 * `chrome: 400` au premier niveau ne se regroupent pas pareil. On garde donc
 * le chemin, pas seulement le nom.
 */
export function aplatir(obj, chemin = [], sortie = []) {
  if (obj == null || typeof obj !== 'object') return sortie;
  for (const [k, v] of Object.entries(obj)) {
    const ici = [...chemin, k];
    if (v != null && typeof v === 'object' && !Array.isArray(v)) aplatir(v, ici, sortie);
    else sortie.push({ chemin: ici, parent: chemin.join('.'), cle: k, valeur: v });
  }
  return sortie;
}

/** Un nombre, ou null. Une chaine numerique en est un ; « 08:23 » n'en est pas. */
const nombre = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * REGROUPER CE QUI VA ENSEMBLE.
 *
 * Deux appartenances possibles, dans cet ordre : le PREFIXE de la cle
 * (`web:summer`), puis le PARENT (`temps_par_contexte.chrome`). Le prefixe
 * passe devant parce qu'il est explicite -- l'application a elle-meme ecrit
 * que ces cles vont ensemble.
 *
 * Une famille n'existe qu'a partir de MIN_FAMILLE membres NUMERIQUES : trois
 * lignes se lisent tres bien, les replier ne gagne rien et perd le detail.
 */
export function familles(entrees) {
  const par = new Map();
  for (const e of entrees) {
    const n = nombre(e.valeur);
    if (n == null) continue;
    const p = prefixeDe(e.cle);
    const nom = p != null ? p : e.parent;
    if (!nom) continue;                     // au premier niveau, sans prefixe : pas une famille
    if (!par.has(nom)) par.set(nom, { nom, parPrefixe: p != null, membres: [] });
    par.get(nom).membres.push({ cle: e.cle, nom: p != null ? suffixeDe(e.cle) : e.cle, valeur: n, chemin: e.chemin });
  }

  const out = [];
  for (const f of par.values()) {
    if (f.membres.length < MIN_FAMILLE) continue;
    const membres = f.membres.slice().sort((a, b) => b.valeur - a.valeur);
    const total = membres.reduce((a, m) => a + m.valeur, 0);

    /*
     * ON NOMME LES PLUS GROSSES JUSQU'A COUVRIR L'ESSENTIEL.
     *
     * Pas « les cinq premieres » : sur une journee ou tout est passe sur une
     * seule page, une seule ligne dit tout et quatre autres font du bruit. Pas
     * « tout ce qui depasse X » non plus : X supposerait une unite. On cumule
     * donc jusqu'a COUVERTURE, et on s'arrete la, sans depasser TETES.
     */
    const tetes = [];
    let cumul = 0;
    for (const m of membres) {
      if (tetes.length >= TETES) break;
      if (total > 0 && cumul / total >= COUVERTURE) break;
      tetes.push(m);
      cumul += m.valeur;
    }
    // Toujours au moins une tete : une famille sans rien de nomme n'apprend rien.
    if (!tetes.length && membres.length) { tetes.push(membres[0]); cumul = membres[0].valeur; }

    out.push({
      nom: f.nom,
      parPrefixe: f.parPrefixe,
      n: membres.length,
      total,
      tetes,
      // Les chemins de TOUS les membres, tetes comprises : c'est ce qui permet
      // a l'appelant de ne pas reafficher en ligne ce qui est deja dans une
      // famille, sans avoir a refaire le regroupement.
      chemins: membres.map(m => m.chemin.join('.')),
      // Ce qu'on ne nomme pas est COMPTE, et son poids aussi : « + 29 autres »
      // sans le poids laisserait croire qu'on a cache l'essentiel.
      reste: membres.length - tetes.length,
      resteTotal: total - cumul
    });
  }
  return out.sort((a, b) => b.total - a.total || a.nom.localeCompare(b.nom));
}

/**
 * LE DIGEST, LU.
 *
 * @returns {{familles: Array, lignes: Array, champs: number}}
 *   `familles` : les paquets regroupes, les plus lourds d'abord.
 *   `lignes`   : tout le reste, tel quel, dans l'ordre d'arrivee.
 *   `champs`   : combien de feuilles il y avait en tout, avant regroupement.
 */
export function lireDigest(digest) {
  if (!digest || typeof digest !== 'object') return { familles: [], lignes: [], champs: 0 };
  const entrees = aplatir(digest);
  const fams = familles(entrees);

  // Ce qui est parti dans une famille ne se reaffiche pas en ligne : ce serait
  // la meme donnee deux fois, et le regroupement n'aurait rien gagne.
  const prises = new Set(fams.flatMap(f => f.chemins));

  const lignes = entrees
    .filter(e => !prises.has(e.chemin.join('.')))
    .map(e => ({ chemin: e.chemin, cle: e.cle, valeur: e.valeur }));

  return { familles: fams, lignes, champs: entrees.length };
}
