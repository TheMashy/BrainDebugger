/*
 * =====================================================================
 * CE QUE LE MODÈLE ÉCRIT, PENDANT QU'IL L'ÉCRIT.
 *
 * Le retissage affichait « 14 208 signes écrits ». Honnête, et vide : personne
 * ne se demande combien de signes. On veut voir ARRIVER les choses — « pensée
 * de fin de nuit », « comparaison aux autres », « le dimanche soir » — au
 * moment où elles sont trouvées.
 *
 * Et c'est possible sans rien inventer. La lecture revient par un appel
 * d'outil, dont le JSON arrive par tranches. Le JSON n'est utilisable qu'ENTIER
 * — mais un `"nom": "…"` refermé est définitif : le modèle ne le réécrira pas.
 * On peut donc les cueillir un par un, dans l'ordre où ils sont écrits.
 *
 * ---------------------------------------------------------------------
 * ON NE PARSE PAS DU JSON INCOMPLET, ON Y CHERCHE DES PAIRES CLOSES.
 *
 * `JSON.parse` sur un fragment échoue, et un parseur tolérant écrit à la main
 * se tromperait sur les échappements. On cherche donc uniquement des motifs
 * dont la fermeture est visible : `"nom": "quelque chose"` suivi d'un
 * guillemet. Ce qui est à moitié écrit est ignoré et reviendra à la tranche
 * suivante — c'est la seule façon de ne jamais annoncer un nom tronqué.
 *
 * ---------------------------------------------------------------------
 * LE POURCENTAGE EST UNE FRACTION DE STRUCTURE, PAS UNE MINUTERIE.
 *
 * Il ne compte pas le temps — on ne sait pas combien le modèle va prendre. Il
 * compte CE QUI EST ARRIVÉ sur ce qu'on attend : le schéma plafonne à six
 * thèmes, trois pistes, vingt nœuds. Un pourcentage tiré d'une horloge avance
 * quand rien ne se passe, et ment donc exactement au moment où l'on doute.
 * =====================================================================
 */

/** Les plafonds du schéma de lecture. Ils fixent le dénominateur. */
export const ATTENDU = { theme: 6, piste: 3, noeud: 20 };

/**
 * Où en est le JSON : dans les thèmes, les pistes, la carte ?
 *
 * On se repère aux clés de section, qui n'apparaissent qu'une fois et dans
 * l'ordre du schéma. Le dernier repère franchi donne la section courante — un
 * `"nom"` qui suit `"carte"` est un nœud, le même avant est un thème.
 */
const SECTIONS = [
  { cle: '"themes"', genre: 'theme' },
  { cle: '"pistes"', genre: 'piste' },
  { cle: '"carte"', genre: 'noeud' }
];

const sectionA = (brut, position) => {
  let genre = null;
  for (const s of SECTIONS) {
    const i = brut.indexOf(s.cle);
    if (i >= 0 && i < position) genre = s.genre;
  }
  return genre;
};

/**
 * UN CUEILLEUR, qui se souvient de ce qu'il a déjà rendu.
 *
 * Il est appelé à chaque tranche avec le JSON accumulé depuis le début : il
 * doit donc pouvoir relire ce qu'il a déjà vu sans le réannoncer.
 */
export function cueilleur() {
  const vus = new Set();
  const comptes = { theme: 0, piste: 0, noeud: 0 };

  return {
    comptes,
    /**
     * @param {string} brut  le JSON accumulé, possiblement incomplet
     * @returns {Array<{genre, nom}>}  ce qui vient d'apparaître
     */
    cueillir(brut) {
      const neufs = [];
      // Le guillemet fermant est OBLIGATOIRE dans le motif : c'est lui qui
      // garantit qu'on ne rend pas « pensée de fin de nu ».
      const re = /"nom"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let m;
      while ((m = re.exec(brut)) !== null) {
        const nom = m[1].replace(/\\(.)/g, '$1').trim();
        if (!nom) continue;
        const genre = sectionA(brut, m.index);
        if (!genre) continue;
        const cle = `${genre}:${nom.toLowerCase()}`;
        if (vus.has(cle)) continue;
        vus.add(cle);
        comptes[genre]++;
        neufs.push({ genre, nom });
      }
      return neufs;
    },

    /**
     * OÙ ÇA EN EST, de 0 à 100.
     *
     * Les poids disent ce que chaque partie coûte à produire : les thèmes sont
     * le gros du travail (le modèle relit tout pour les écrire), la carte suit,
     * les pistes sont courtes. Le tissage à l'écran prend les trente derniers.
     */
    pourcent() {
      const p = g => Math.min(1, comptes[g] / ATTENDU[g]);
      // 5 % pour être parti, 65 % pour ce que le modèle écrit.
      return Math.round(5 + 65 * (0.45 * p('theme') + 0.15 * p('piste') + 0.40 * p('noeud')));
    }
  };
}
