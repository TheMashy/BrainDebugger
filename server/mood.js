/**
 * L'ambiance : quelle scene le fond doit porter.
 *
 * Le fond de l'application change lentement selon ce dont on parle et selon la
 * note du jour. Ce n'est pas une analyse -- l'application ne qualifie jamais une
 * journee, c'est la regle du produit. C'est un choix de decor : on ne dit rien a
 * l'utilisateur de ce qu'on a « detecte », on change la lumiere derriere lui.
 *
 * Trois raisons de le faire ici plutot que dans le navigateur ou dans le modele :
 *
 *   1. C'est du lexique, pas du sens. Un modele appele a chaque frappe couterait
 *      des jetons pour choisir entre sept images.
 *   2. Le compagnon ne doit surtout pas savoir qu'un decor existe. S'il l'apprend,
 *      il en parlera -- et commenter le decor revient a commenter l'humeur, ce que
 *      le produit refuse.
 *   3. Le navigateur n'a pas l'historique des notes.
 *
 * Le decompte est volontairement grossier. Se tromper de scene est sans
 * consequence : le fond redevient neutre en quelques minutes, et personne n'a ete
 * etiquete. C'est tout l'interet de mettre l'inference ici et non dans un texte.
 */

/** Sans accents ni casse -- « déprimé », « deprime » et « DÉPRIMÉ » sont le meme mot. */
const norm = s => String(s ?? '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase();

/*
 * Les lexiques. Chaque entree est une RACINE : on cherche le mot entier ou le
 * mot suivi d'une terminaison, pas la sous-chaine -- sinon « mort » se declenche
 * sur « amortir » et « vide » sur « evider ».
 *
 * Les poids ne sont pas uniformes : un mot qui ne peut vouloir dire qu'une chose
 * pese plus qu'un mot ambigu. « enterrement » vaut trois fois « fin ».
 */
const LEXIQUES = {
  abyss: {   // ce qui est grave et ancien : la mort, la perte, l'irreversible
    3: ['mort', 'morte', 'morts', 'deces', 'enterrement', 'funerailles', 'cimetiere',
        'suicide', 'suicidaire', 'mourir', 'disparu', 'disparue', 'tombe', 'cercueil',
        'veuve', 'veuf', 'endeuille'],
    2: ['deuil', 'perdu', 'perdue', 'perte', 'jamais plus', 'plus jamais', 'irreversible',
        'definitif', 'adieu', 'derniere fois'],
    1: ['fin', 'finir', 'partir', 'absence', 'manque']
  },
  mandel: {  // la recursion sans fond : le sens, l'existence, l'infini
    3: ['existentiel', 'existentielle', 'absurde', 'absurdite', 'nihilisme', 'infini',
        'univers', 'cosmos', 'neant', 'metaphysique'],
    2: ['sens de la vie', 'a quoi bon', 'pourquoi vivre', 'pourquoi je', 'ca sert a rien',
        'aucun sens', 'quel interet', 'boucle', 'tourne en rond', 'ressasse', 'rumine'],
    1: ['pourquoi', 'sens', 'raison', 'comprendre', 'philosophie']
  },
  eclipse: { // la melancolie : la lumiere est la, elle est cachee
    3: ['melancolie', 'melancolique', 'nostalgie', 'nostalgique', 'chagrin'],
    2: ['triste', 'tristesse', 'pleure', 'pleurer', 'pleure', 'larmes', 'cafard',
        'sombre', 'lourd', 'peine', 'coeur lourd', 'seul', 'seule', 'solitude'],
    1: ['gris', 'fatigue', 'las', 'lasse', 'pesant']
  },
  voidwell: { // le vide : quand il n'y a rien a dire
    3: ['vide', 'anhedonie', 'engourdi', 'anesthesie', 'dissocie', 'dissociation'],
    2: ['rien ne', 'plus rien', 'aucune envie', 'plus envie', 'indifferent', 'detache',
        'vide interieur', 'creux', 'absent', 'plat'],
    1: ['rien', 'neutre', 'normal', 'pareil']
  },
  monolith: { // le serieux : une decision, quelque chose qu'on affronte
    3: ['decision', 'decider', 'choix', 'ultimatum', 'demission', 'rupture', 'divorce',
        'proces', 'diagnostic'],
    2: ['affronter', 'confronter', 'assumer', 'responsabilite', 'engagement', 'trancher',
        'important', 'grave', 'serieux', 'entretien', 'rendez-vous'],
    1: ['travail', 'boulot', 'projet', 'deadline', 'examen']
  },
  grain: {   // l'instabilite : quand rien ne tient en place
    3: ['angoisse', 'angoisses', 'anxiete', 'anxieux', 'anxieuse', 'panique',
        'crise d angoisse', 'tremble', 'tremblements'],
    2: ['stresse', 'stressee', 'stress', 'nerveux', 'nerveuse', 'agite', 'agitee',
        'insomnie', 'insomnies', 'nuit blanche', 'palpitations', 'oppresse',
        'cage thoracique', 'boule au ventre'],
    1: ['inquiet', 'inquiete', 'peur', 'tendu', 'tendue', 'fatigue']
  },
  brume: {   // le calme : la scene par defaut quand ca va
    3: ['apaise', 'apaisee', 'serein', 'sereine', 'paisible'],
    2: ['calme', 'tranquille', 'repose', 'reposee', 'bien', 'mieux', 'content',
        'contente', 'heureux', 'heureuse', 'soulage', 'soulagee', 'doux', 'douce'],
    1: ['ok', 'correct', 'agreable', 'sympa', 'chouette']
  }
};

/** La scene quand rien ne ressort. */
export const DEFAUT = 'drift';

/** Toutes les scenes connues du shader, dans l'ordre ou il les compile. */
export const SCENES = ['drift', 'brume', 'abyss', 'eclipse', 'voidwell', 'monolith', 'grain', 'mandel'];

/**
 * Sous ce nombre de mots ecrits, on ne change rien.
 *
 * Le decor doit s'installer, pas sursauter. Quelqu'un qui tape « mort de rire »
 * en arrivant ne merite pas une pyramide, et un fond qui saute a chaque phrase
 * transforme une ambiance en jouet.
 */
export const MOTS_MINIMUM = 25;

const compte = (texte, mot) => {
  // Racine + terminaison possible, jamais la sous-chaine : « mort » ne doit pas
  // se declencher sur « amortir », ni « vide » sur « evider ».
  const r = new RegExp(`(^|[^a-z0-9])${mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(e?s?)($|[^a-z0-9])`, 'g');
  let n = 0;
  while (r.exec(texte) !== null) n++;
  return n;
};

/**
 * @param {string} texte  ce que la personne a ecrit dans le fil courant
 * @param {number|null} note  sa note du jour, si elle l'a posee
 * @returns {{scene: string, force: number, mots: number, scores: object}}
 */
export function readMood(texte, note = null) {
  const t = ' ' + norm(texte).replace(/[’']/g, ' ') + ' ';
  const mots = (t.match(/[a-z0-9]+/g) ?? []).length;

  const scores = {};
  for (const [scene, lex] of Object.entries(LEXIQUES)) {
    let s = 0;
    for (const [poids, liste] of Object.entries(lex)) {
      for (const mot of liste) s += compte(t, norm(mot)) * Number(poids);
    }
    if (s) scores[scene] = s;
  }

  // La note infléchit, elle ne décide pas. Quelqu'un qui parle de la mort de son
  // père un jour noté 7 parle quand même de la mort.
  if (note !== null && note !== undefined) {
    if (note <= 2) { scores.voidwell = (scores.voidwell ?? 0) + 2; scores.eclipse = (scores.eclipse ?? 0) + 1; }
    else if (note <= 4) scores.eclipse = (scores.eclipse ?? 0) + 1;
    else if (note >= 8) scores.brume = (scores.brume ?? 0) + 2;
  }

  if (mots < MOTS_MINIMUM) return { scene: DEFAUT, force: 0, mots, scores };

  const classe = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!classe.length || classe[0][1] < 3) return { scene: DEFAUT, force: 0, mots, scores };

  const [scene, brut] = classe[0];
  // Une scene qui ne devance pas la suivante n'est pas un signal : on reste neutre
  // plutot que de choisir a pile ou face entre deux decors.
  const second = classe[1]?.[1] ?? 0;
  if (brut - second < 2 && second > 0) return { scene: DEFAUT, force: 0, mots, scores };

  return { scene, force: Math.min(1, brut / 9), mots, scores };
}

/**
 * L'energie du fond : combien la scene respire. Vient de l'ecart a la reference,
 * pas de la note brute -- une journee a 5 ne veut pas la meme chose pour quelqu'un
 * qui vit a 4 et pour quelqu'un qui vit a 8.
 */
export function readEnergy(note, reference) {
  if (note === null || note === undefined) return 0.35;
  const ref = reference ?? 5;
  const ecart = Math.max(-4, Math.min(4, note - ref));
  return Math.max(0.05, Math.min(1, 0.4 + ecart * 0.12));
}
