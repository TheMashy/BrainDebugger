/*
 * =====================================================================
 * LE COMPTE RENDU POUR LE PRATICIEN.
 *
 * Une seance commence presque toujours pareil : « alors, comment ca s'est
 * passe depuis la derniere fois ? ». La personne repond de memoire, et sa
 * memoire est exactement ce que la periode a abime -- on se souvient de la
 * semaine qu'on vient de vivre, pas des six. Le praticien reconstruit alors
 * par questions ce qui est deja ecrit quelque part, et cette reconstruction
 * mange le tiers du rendez-vous.
 *
 * Ce module produit la page qui remplace ce tiers.
 *
 * ---------------------------------------------------------------------
 * IL EST CALCULE, PAS REDIGE.
 *
 * Aucun appel a un modele. C'est la decision de fond du chantier, et elle
 * tient en trois raisons :
 *
 *   1. Une date inventee dans un document qu'on tend a un soignant est pire
 *      qu'un document absent. Un modele qui resume quarante journees se
 *      trompera un jour d'une semaine, et personne dans la piece n'aura de
 *      quoi le verifier.
 *   2. Le meme intervalle doit donner le meme compte rendu, aujourd'hui et
 *      dans six mois. Une page qui change entre deux impressions n'est pas un
 *      document, c'est une opinion.
 *   3. Ce qu'un modele a compris est DEJA dans les donnees : les reperes qu'il
 *      a poses, les motifs qu'il a nommes avec leur mecanisme. Le compte rendu
 *      les CITE. Il ne les reecrit pas, et il ne rajoute rien par-dessus.
 *
 * Ce que la machine affirme ici, ce sont des dates, des comptes et des ecarts.
 * Tout le reste est entre guillemets, et vient soit de la personne, soit du
 * compagnon -- jamais de ce fichier.
 *
 * ---------------------------------------------------------------------
 * IL NE DIAGNOSTIQUE PAS.
 *
 * L'application reconnait des motifs ; elle ne nomme pas de trouble. « Ca,
 * c'est typique d'un borderline » ne doit jamais sortir de la machine -- ce
 * qui en sort, c'est « la weed arrive au moment exact ou », et c'est au
 * praticien de nommer. La frontiere n'est pas une intention, c'est une
 * verification : `SANS_DIAGNOSTIC` liste les etiquettes cliniques, et un test
 * relit tout ce que ce module ecrit de lui-meme pour s'assurer qu'aucune n'y
 * figure.
 * =====================================================================
 */

import { median, daysBetween, addDays } from './stats.js';

/** L'intervalle minimum qui vaut la peine d'etre raconte. */
export const MIN_JOURS_INTERVALLE = 3;

/** Au-dela, une liste de faits devient un mur qu'on ne lit pas en consultation. */
export const MAX_FAITS = 12;

/**
 * Les mots que ce module n'ecrit jamais.
 *
 * Ce ne sont pas des mots interdits dans l'application : la personne a le droit
 * de dire « ma depression » dans son journal, et le compte rendu la citera mot
 * pour mot -- c'est SA phrase. Ce qui est interdit, c'est que la MACHINE les
 * emploie a son compte, dans une de ses propres tournures. Poser un mot
 * clinique sur quelqu'un est un acte medical, et il se fait dans la piece.
 */
export const SANS_DIAGNOSTIC = [
  'dépression', 'depressif', 'dépressif', 'bipolaire', 'borderline', 'trouble',
  'pathologi', 'syndrome', 'psychose', 'névrose', 'nevrose', 'tdah', 'autiste',
  'schizo', 'anxieux généralisé', 'symptôme', 'symptome', 'diagnostic',
  'rechute', 'crise suicidaire', 'comorbid'
];

/**
 * LA PHRASE QUI DELIMITE, ET LE SEUL ENDROIT OU ELLE EST ECRITE.
 *
 * Le document quitte l'application : imprime, il arrive dans les mains de
 * quelqu'un qui ne sait pas ce que ce produit fait ni ne fait pas. Il doit donc
 * porter lui-meme ce qu'il n'est pas.
 *
 * Elle vit ici, en constante, et pas dans la page -- pour deux raisons. La
 * page peut etre refaite ; cette phrase ne doit pas partir avec la refonte. Et
 * les tests qui verifient qu'aucune etiquette clinique ne sort d'ici ont besoin
 * d'UNE exception nommee : nier un diagnostic n'est pas en poser un, et sans
 * repere unique la seule facon de laisser passer la negation serait de retirer
 * le mot de la liste des interdits.
 */
export const AVERTISSEMENT =
  "Document produit par l'application, à partir de journées notées à la main et de repères " +
  "posés en conversation. Ce n'est pas un diagnostic : rien ici n'est un avis clinique, et " +
  "aucune de ces lignes n'a été rédigée par un modèle — ce sont des dates, des comptes, et " +
  "des phrases citées telles qu'écrites.";

/* ------------------------------------------------------------------ */

const jour = d => String(d).slice(0, 10);
const dans = (d, a, b) => d >= a && d <= b;

/**
 * L'intervalle a raconter : de la seance precedente a celle qu'on prepare.
 *
 * Sans seance precedente -- la premiere fois -- on prend tout ce qu'il y a.
 * C'est voulu : le premier compte rendu est un etat des lieux, et le couper
 * arbitrairement a trente jours ferait disparaitre justement ce qui a amene la
 * personne a consulter.
 */
export function intervalle(seances, jusquAu, premiereJournee = null) {
  const fin = jour(jusquAu);
  const passees = (seances ?? []).map(s => jour(s.date)).filter(d => d < fin).sort();
  const precedente = passees.at(-1) ?? null;
  const debut = precedente ?? (premiereJournee ? jour(premiereJournee) : fin);
  return { debut, fin, precedente, jours: daysBetween(debut, fin) + 1 };
}

/**
 * L'amplitude de la periode, dans les mots de la personne.
 *
 * La mediane et non la moyenne : une seule journee a 1 tire une moyenne de
 * quarante journees vers le bas et fait mentir la ligne. La mediane dit ou la
 * periode s'est TENUE ; les extremes sont listes a part, dates, ou ils ont un
 * sens.
 *
 * Les ancres sont la legende que la personne a ecrite elle-meme (« Bas -- je
 * tiens, mais je compte les heures »). Sans elles, « mediane 4,5 » ne veut rien
 * dire pour quelqu'un qui n'a pas etalonne cette echelle-la.
 */
export function amplitudeDe(notes, ancres = []) {
  const v = notes.map(n => n.note).filter(n => typeof n === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const bas = [...notes].filter(n => typeof n.note === 'number').sort((a, b) => a.note - b.note || (a.date < b.date ? -1 : 1));
  const seuil = [...(ancres ?? [])].sort((a, b) => a.note - b.note);
  const plancher = seuil[0]?.note ?? null;
  const plafond = seuil.at(-1)?.note ?? null;
  return {
    n: v.length,
    min: v[0], max: v.at(-1), mediane: Math.round(median(v) * 10) / 10,
    creux: bas.slice(0, 3),
    pics: bas.slice(-3).reverse(),
    // Combien de journees sous l'ancre basse, au-dessus de l'ancre haute.
    sousPlancher: plancher == null ? null : v.filter(x => x <= plancher).length,
    surPlafond: plafond == null ? null : v.filter(x => x >= plafond).length,
    ancres: seuil
  };
}

/**
 * Ce qui a change depuis l'intervalle d'avant.
 *
 * On compare a l'intervalle PRECEDENT, pas a une moyenne de tout le journal.
 * « depuis la derniere fois » est la question qui se pose vraiment en seance,
 * et l'intervalle precedent est la seule reponse honnete : il a la meme forme,
 * la meme saison approximative, et il a ete raconte au meme praticien.
 *
 * Rendu null s'il n'y a pas de quoi comparer -- une comparaison sur trois
 * journees ecrites se lirait comme une tendance et n'en est pas une.
 */
export const MIN_COMPARABLE = 5;

export function evolution(courant, precedent) {
  if (!courant || !precedent) return null;
  if (courant.n < MIN_COMPARABLE || precedent.n < MIN_COMPARABLE) return null;
  const d = Math.round((courant.mediane - precedent.mediane) * 10) / 10;
  return {
    mediane: d,
    avant: precedent.mediane,
    apres: courant.mediane,
    sens: d > 0.3 ? 'haut' : d < -0.3 ? 'bas' : 'stable',
    // Le nombre de journees ecrites bouge aussi, et c'est une information :
    // arreter d'ecrire est souvent le premier signe, avant que les notes ne
    // baissent. Il se lit a cote de la mediane, jamais a sa place.
    ecrites: courant.n - precedent.n
  };
}

/**
 * Les reperes tombes dans l'intervalle -- y compris les periodes qui l'ouvrent
 * ou le ferment.
 *
 * Une periode commencee il y a deux ans et toujours en cours EST un fait de
 * cette periode-ci : c'est meme souvent le fait principal. La filtrer sur sa
 * seule date de debut l'aurait fait disparaitre de tous les comptes rendus sauf
 * le premier.
 */
export function faitsDe(events, debut, fin) {
  const dedans = (events ?? []).filter(e => {
    const d = jour(e.date);
    if (dans(d, debut, fin)) return true;
    if (!e.fin && !e.ouvert) return false;
    const f = e.ouvert ? fin : jour(e.fin);
    return d <= fin && f >= debut;           // la periode recouvre l'intervalle
  });
  return dedans
    .map(e => ({
      ...e,
      // « en cours » distingue ce qui a commence dans l'intervalle de ce qui le
      // traverse. Les deux comptent, ils ne se racontent pas pareil.
      nouveau: dans(jour(e.date), debut, fin),
      termine: e.fin ? dans(jour(e.fin), debut, fin) : false
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id))
    .slice(0, MAX_FAITS);
}

/**
 * Les journees ou la personne a ecrit, dans l'intervalle.
 *
 * Le denominateur de tout le reste. « quatre journees sous l'ancre basse » ne
 * veut pas dire la meme chose sur huit journees ecrites que sur quarante, et
 * un compte rendu qui donne le numerateur sans le denominateur laisse le
 * praticien conclure a partir d'une fraction qu'il n'a pas.
 */
export function ecritesEntre(entries, debut, fin) {
  return (entries ?? [])
    .filter(e => dans(jour(e.date), debut, fin))
    .map(e => ({ date: jour(e.date), note: e.note ?? null, texte: e.text ?? '' }));
}

/**
 * Le compte rendu complet.
 *
 * @param {object} src  tout ce que la base sait, deja lu par l'appelant
 * @param {string} date la date de la seance a preparer ('AAAA-MM-JJ')
 */
export function compteRendu(src, date) {
  const { entries = [], events = [], seances = [], ancres = [],
          motifs = [], motifsAvant = [], amplitudes = [] } = src ?? {};
  const premiere = entries.length ? jour(entries[0].date) : null;
  const iv = intervalle(seances, date, premiere);

  const ecrites = ecritesEntre(entries, iv.debut, iv.fin);
  const amp = amplitudeDe(ecrites, ancres);

  // L'intervalle d'avant, de meme longueur, pour la comparaison.
  const avantFin = iv.precedente ? addDays(iv.debut, -1) : null;
  const avantDebut = avantFin ? addDays(avantFin, -(iv.jours - 1)) : null;
  const ecritesAvant = avantDebut ? ecritesEntre(entries, avantDebut, avantFin) : [];
  const ampAvant = ecritesAvant.length ? amplitudeDe(ecritesAvant, ancres) : null;

  const bouges = amplitudes.filter(a => dans(jour(a.date), iv.debut, iv.fin));

  return {
    periode: iv,
    seance: (seances ?? []).find(s => jour(s.date) === jour(date)) ?? null,
    precedente: iv.precedente
      ? (seances ?? []).find(s => jour(s.date) === iv.precedente) ?? { date: iv.precedente }
      : null,
    ecrites: ecrites.length,
    // Le taux de remplissage est un fait sur la periode, pas une note de
    // conduite : quelqu'un qui n'a rien ecrit pendant trois semaines a vecu
    // quelque chose, et c'est ca qui se lit.
    couverture: iv.jours ? Math.round((ecrites.length / iv.jours) * 100) : 0,
    amplitude: amp,
    evolution: evolution(amp, ampAvant),
    faits: faitsDe(events, iv.debut, iv.fin),
    motifs: (motifs ?? []).map(m => {
      const avant = (motifsAvant ?? []).find(x => x.id === m.id);
      return { ...m, n: m.jours.length, avant: avant ? avant.jours.length : 0 };
    }),
    // Les journees a plusieurs relevés : celles qui ont bouge DANS la journee.
    // Une journee notee 5 le soir peut avoir fait 2 puis 8, et c'est une
    // information qu'aucune note quotidienne ne porte.
    bascules: bouges.sort((a, b) => b.ecart - a.ecart).slice(0, 3),
    // Le mot que la personne s'est laisse pour cette seance-la.
    apporter: (seances ?? []).find(s => jour(s.date) === iv.precedente)?.apporter ?? null,
    assezDeMatiere: iv.jours >= MIN_JOURS_INTERVALLE && ecrites.length > 0,
    avertissement: AVERTISSEMENT
  };
}
