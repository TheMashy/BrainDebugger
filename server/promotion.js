/**
 * UN MOTIF MONTE S'IL TIENT.
 *
 * ================================================================
 * CE QUE CE FICHIER RÉSOUT, ET POURQUOI IL EXISTE.
 *
 * Le produit a cinq façons de dire « voilà ce qui revient chez toi » — les
 * motifs, les thèmes, la carte, les schémas, les fonctionnements — et elles ne
 * se parlaient pas. La liste des motifs vivait SOUS la carte sans jamais la
 * toucher, alors que les deux sont faites de la même matière : un motif est une
 * liste de dates portant un nom, un nœud de la carte aussi (`n.jours`).
 *
 * Trois façons de les réunir se présentaient. Faire de chaque motif un nœud :
 * seize nœuds deviennent vingt-cinq, la carte cesse d'être lisible, et surtout
 * une interprétation prend le statut d'un fait. Les laisser côte à côte : c'est
 * l'état actuel, et une liste exhaustive et permanente est précisément la forme
 * qui nourrit le ressassement plutôt que la réflexion (Treynor &
 * Nolen-Hoeksema : la même matière nourrit l'un ou l'autre selon sa forme).
 *
 * La troisième est celle-ci. Le motif RESTE dans sa liste. Il s'ancre à un nœud
 * par une flèche COMPTÉE dès qu'un lien tient — le même test exact de Fisher
 * sur la journée écrite suivante qui décide déjà du sens des liens de la carte
 * (voir sens.js). Et il ne devient un NŒUD que s'il franchit un seuil ET que la
 * personne dit oui. La plupart ne monteront jamais, et c'est le but : ce qui
 * monte trop facilement ne veut plus rien dire.
 * ================================================================
 *
 * CE FICHIER NE DÉCIDE RIEN TOUT SEUL. Il compte, il classe, il dit pourquoi.
 * La montée est un geste de la personne — jamais un effet de bord d'un calcul.
 * `etats()` est pure : mêmes entrées, mêmes sorties, aucune écriture.
 */
import { sensDuLien, suiteDe, SEUILS_SENS } from './sens.js';
import { MOTS_INTERDITS } from './fonctionnements.js';

/*
 * LES SEUILS, ET D'OÙ VIENT CHAQUE CHIFFRE.
 *
 * `min_journees` : dix journées distinctes. C'est le seuil que le produit
 * s'impose déjà ailleurs (`SEUILS.lien.min_groupe` vaut 10), et c'est la
 * réserve de la littérature sur les réseaux individuels — un réseau tiré de
 * vingt observations est instable, en dessous on dessine du bruit avec l'aplomb
 * d'une mesure.
 *
 * `min_reprises` : et RÉPARTIES, pas une salve d'une semaine. Dix journées
 * d'affilée en février puis plus rien, ce n'est pas un mécanisme qui revient :
 * c'est une période. On coupe la suite des journées partout où l'écart dépasse
 * `ecart_reprise`, et on compte les morceaux. Une salve fait UN morceau et ne
 * passe pas. Trois retours espacés en font trois.
 *
 * L'ANCRAGE, LUI, N'A PAS DE SEUIL À LUI. C'est exactement celui de la carte
 * (`SEUILS_SENS` : au moins trois fois, sous 5 %). Un ancrage plus exigeant que
 * les liens que la carte pose déjà serait deux poids deux mesures ; un ancrage
 * plus laxiste ferait entrer par la bande ce que la carte refuse.
 */
export const SEUILS_PROMOTION = {
  min_journees: 10,
  min_reprises: 3,
  ecart_reprise: 14,
  // Le plafond de `validerCarte`. Il ne REFUSE rien ici — ce qui a été accepté
  // reste accepté — mais la proposition le dit quand on s'en approche, parce
  // qu'une carte de vingt-cinq nœuds est le défaut qu'on cherchait à éviter.
  carte_confortable: 16,
};

/** Les états possibles, du plus froid au plus chaud. */
export const ETATS = ['reconnu', 'ancre', 'proposable', 'promu', 'ecarte'];

/**
 * LES REPRISES : en combien de fois ces journées sont-elles arrivées.
 *
 * On coupe partout où l'écart entre deux journées consécutives dépasse
 * `ecart` : chaque morceau est un retour. C'est la seule chose qui distingue
 * « ça revient » de « ça a duré », et les deux n'ont pas du tout le même sens
 * sur une carte.
 */
export function reprises(jours, ecart = SEUILS_PROMOTION.ecart_reprise) {
  const d = [...new Set(jours ?? [])].sort();
  if (!d.length) return [];
  const jour = s => Date.parse(`${s}T00:00:00Z`) / 86400000;
  const groupes = [[d[0]]];
  for (let i = 1; i < d.length; i++) {
    if (jour(d[i]) - jour(d[i - 1]) > ecart) groupes.push([]);
    groupes[groupes.length - 1].push(d[i]);
  }
  return groupes;
}

/**
 * LES ANCRAGES : à quels nœuds de la carte ce motif se rattache, et dans quel
 * sens. C'est `sens.js` qui décide, pas nous — même test, mêmes seuils, même
 * « journée écrite suivante » que les liens de la carte.
 *
 * Un ancrage n'est PAS une promotion. Il vit tant que le motif est un motif :
 * c'est une flèche entre la liste et la carte, pas un nœud de plus.
 */
export function ancragesDe(joursMotif, noeuds, suite, seuils = SEUILS_SENS) {
  const out = [];
  for (const n of noeuds ?? []) {
    const joursN = (n.jours ?? []).map(j => (typeof j === 'string' ? j : j?.d)).filter(Boolean);
    if (!joursN.length) continue;
    const a = sensDuLien(joursMotif, joursN, suite, seuils);
    if (!a.sens) continue;
    // La force du plus petit p des deux sens : c'est ce qui a fait tenir le
    // lien, et l'écrire permet de trier sans inventer une échelle.
    const p = Math.min(a.de.p, a.vers.p);
    out.push({ noeud: n.nom, sens: a.sens, meme: a.meme, p,
               apres: a.sens === 'vers' ? a.vers.apres : a.de.apres,
               sur: a.sens === 'vers' ? a.vers.sur : a.de.sur });
  }
  return out.sort((x, y) => x.p - y.p || y.apres - x.apres);
}

/*
 * LE VERBE D'UNE FLÈCHE ANCRÉE DÉCRIT LE COMPTE, PAS UN MÉCANISME.
 *
 * Les liens de la carte portent un verbe écrit par le modèle (« fait
 * retomber », « précède ») ; une flèche posée par un comptage n'a pas ce
 * droit-là. Elle dit ce qu'elle a compté, et rien de plus : c'est la
 * différence entre un relevé et une explication, et c'est toute la différence.
 */
export const VERBE = { de: 'revient avant', vers: 'revient après', deux: 'va avec' };

/**
 * L'ÉTAT DE CHAQUE MOTIF, ET CE QUI LUI MANQUE POUR MONTER.
 *
 * `manque` n'est pas décoratif : un seuil qu'on ne peut pas voir est un seuil
 * qu'on ne peut pas contester, et celui-ci sera contesté — c'est un chiffre
 * choisi, pas une loi.
 *
 * @param {object[]} motifs   {id, nom, mecanisme, teinte, vues, promu, ecarte_le}
 * @param {Map}      series   id -> [{periode: 'AAAA-MM-JJ', n}]  (motifSeries)
 * @param {object}   carte    {noeuds, liens}
 * @param {Iterable} corpus   les journées écrites
 */
export function etats(motifs, series, carte, corpus, seuils = SEUILS_PROMOTION) {
  const ecrites = new Set(corpus ?? []);
  const suite = suiteDe([...ecrites], SEUILS_SENS.ecart_max);
  const noeuds = carte?.noeuds ?? [];
  const dejaSurLaCarte = new Set(noeuds.map(n => String(n.nom).toLowerCase()));
  return (motifs ?? []).map(m => {
    /*
     * LES JOURNÉES D'UN MOTIF NE SONT PAS TOUTES DES JOURNÉES ÉCRITES.
     *
     * Un motif est marqué sur un MESSAGE ; `sensDuLien`, lui, ne voit que les
     * journées à texte du journal. Compter les premières et tester sur les
     * secondes ferait afficher « douze journées » à quelqu'un dont neuf
     * seulement peuvent porter un lien — et l'écart serait invisible et
     * inexplicable. On ne garde donc que les journées que le test peut voir :
     * le chiffre montré est celui sur lequel tout le reste est calculé.
     */
    const jours = [...new Set((series?.get(m.id) ?? []).map(x => x.periode))]
      .filter(d => ecrites.has(d)).sort();
    const reps = reprises(jours, seuils.ecart_reprise);
    const ancres = noeuds.length ? ancragesDe(jours, noeuds, suite) : [];
    const assezDeJours = jours.length >= seuils.min_journees;
    const assezReparti = reps.length >= seuils.min_reprises;
    /*
     * LE NOM QUI EMPRUNTE AU VOCABULAIRE DU DIAGNOSTIC NE MONTE PAS TEL QUEL.
     *
     * Un mécanisme nommé dans tes mots est une observation ; le même nommé dans
     * le vocabulaire du DSM est une identité, et une identité se cherche
     * ensuite des confirmations. Sur la carte — qui dure, et qu'on relit — la
     * différence compte plus qu'ailleurs.
     *
     * Ce n'est PAS un refus : c'est une demande de renommer, et le motif garde
     * son nom dans sa liste. Refuser sec effacerait justement le mécanisme le
     * plus repéré de quelqu'un pour une question de vocabulaire.
     */
    const nomARevoir = MOTS_INTERDITS.test(String(m.nom ?? ''));

    /*
     * DEUX EMPÊCHEMENTS QUI NE SONT PAS DES MANQUES DE MESURE.
     *
     * `collision` : un nœud du modèle porte déjà ce nom. `injecterPromus` le
     * sauterait — deux nœuds du même nom en rendraient un inatteignable — et il
     * le sauterait EN SILENCE : la personne cliquerait « le mettre sur ma
     * carte » et rien n'apparaîtrait. Il ne monte donc pas, et l'écran dit
     * pourquoi.
     *
     * `nom_a_revoir` : le nom emprunte au vocabulaire du diagnostic. Le motif
     * garde ce nom dans sa liste — refuser sec effacerait le mécanisme le plus
     * repéré de quelqu'un pour une question de mots. Mais la carte dure et se
     * relit : un mécanisme nommé dans tes mots y est une observation, le même
     * nommé dans celui du DSM y devient une identité, et une identité se
     * cherche ensuite des confirmations. Il faut donc le renommer d'abord —
     * c'est un geste de plus, pas une porte fermée.
     */
    const collision = dejaSurLaCarte.has(String(m.nom ?? '').toLowerCase());
    const bloque = collision || nomARevoir;

    let etat;
    if (m.promu) etat = 'promu';
    else if (m.ecarte_le) etat = 'ecarte';
    else if (assezDeJours && assezReparti && ancres.length && !bloque) etat = 'proposable';
    else if (ancres.length) etat = 'ancre';
    else etat = 'reconnu';

    const manque = [];
    if (!assezDeJours) manque.push({ quoi: 'journees', a: jours.length, faut: seuils.min_journees });
    if (!assezReparti) manque.push({ quoi: 'reprises', a: reps.length, faut: seuils.min_reprises });
    if (!ancres.length) manque.push({ quoi: 'ancrage', a: 0, faut: 1 });
    if (collision) manque.push({ quoi: 'collision', a: 0, faut: 1 });
    if (nomARevoir) manque.push({ quoi: 'nom', a: 0, faut: 1 });

    return {
      id: m.id, nom: m.nom, mecanisme: m.mecanisme, teinte: m.teinte, vues: m.vues,
      etat, jours, mesure: jours.length, reprises: reps.length,
      ancrages: ancres.slice(0, 4), manque,
      ...(nomARevoir ? { nom_a_revoir: true } : {}),
      ...(collision && !m.promu ? { collision: true } : {}),
      // Ce qui l'empêche de monter alors que les comptes y sont : l'écran doit
      // pouvoir distinguer « pas encore assez » de « il y a autre chose ».
      ...(bloque && assezDeJours && assezReparti && ancres.length ? { retenu: true } : {}),
    };
  }).sort((a, b) =>
    ETATS.indexOf(b.etat) - ETATS.indexOf(a.etat) || b.mesure - a.mesure || a.id - b.id);
}

/**
 * LES MOTIFS PROMUS, POSÉS SUR LA CARTE — AU RENDU, PAS EN BASE.
 *
 * La lecture du modèle reste ce que le modèle a écrit. Un nœud promu est
 * ajouté au moment où la carte part vers l'écran, et disparaît si la personne
 * revient en arrière : une relecture ne l'efface donc pas, et une promotion ne
 * salit pas la lecture. Les deux objets gardent leur nature, ce qui est la
 * seule raison pour laquelle cette fonctionnalité n'est pas l'option A avec des
 * étapes.
 *
 * UN NŒUD PROMU N'EST PAS PLUS GROS PARCE QU'IL REVIENT PLUS. `poids` fait la
 * taille du rond ; le faire suivre la fréquence dessinerait « voilà ton plus
 * gros problème » — un score de gravité déguisé en géométrie. Tous les motifs
 * promus ont le même poids, et leur fréquence s'écrit en toutes lettres.
 */
export function injecterPromus(carte, etatsMotifs) {
  const promus = (etatsMotifs ?? []).filter(e => e.etat === 'promu' && e.jours?.length);
  if (!carte?.noeuds?.length || !promus.length) return carte;
  const pris = new Set(carte.noeuds.map(n => String(n.nom).toLowerCase()));
  const noeuds = [], liens = [];
  for (const e of promus) {
    // Un nom déjà porté par un nœud du modèle rendrait l'un des deux
    // inatteignable — c'est la même règle que `validerCarte` sur ses doublons.
    if (pris.has(String(e.nom).toLowerCase())) continue;
    pris.add(String(e.nom).toLowerCase());
    noeuds.push({
      nom: e.nom, quoi: e.mecanisme ?? '', genre: 'mecanisme', poids: 1,
      jours: e.jours, promu: true, motif_id: e.id, vues: e.vues ?? 0,
    });
    for (const a of e.ancrages ?? []) {
      const quoi = VERBE[a.sens] ?? 'va avec';
      if (a.sens === 'vers') liens.push({ de: a.noeud, vers: e.nom, quoi, force: 1, compte: true });
      else liens.push({ de: e.nom, vers: a.noeud, quoi, force: 1, compte: true });
      if (a.sens === 'deux') liens.push({ de: a.noeud, vers: e.nom, quoi, force: 1, compte: true });
    }
  }
  if (!noeuds.length) return carte;
  return { ...carte, noeuds: [...carte.noeuds, ...noeuds], liens: [...(carte.liens ?? []), ...liens] };
}
