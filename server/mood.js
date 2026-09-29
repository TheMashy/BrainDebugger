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
  abyss: {   // LA PYRAMIDE. Ce qui est grave et irreversible : la mort, la perte.
    3: ['mort', 'morte', 'morts', 'deces', 'enterrement', 'funerailles', 'cimetiere',
        'suicide', 'suicidaire', 'mourir', 'disparu', 'disparue', 'cercueil',
        'veuve', 'veuf', 'endeuille', 'me tuer', 'en finir', 'envie de mourir',
        'scarification', 'scarifications', 'me faire du mal'],
    2: ['deuil', 'perte', 'jamais plus', 'plus jamais', 'irreversible',
        'definitif', 'adieu', 'derniere fois', 'urgences', 'hopital',
        'overdose', 'accident'],
    1: ['fin', 'finir', 'absence', 'manque']
  },
  mandel: {  // LA RECURSION. La pensee qui se replie sur elle-meme et ne s'arrete pas.
    3: ['existentiel', 'existentielle', 'absurde', 'absurdite', 'nihilisme', 'infini',
        'neant', 'metaphysique', 'ruminations'],
    2: ['sens de la vie', 'a quoi bon', 'pourquoi vivre', 'pourquoi je', 'ca sert a rien',
        'aucun sens', 'quel interet', 'boucle', 'boucles', 'tourne en rond', 'ressasse',
        'rumine', 'ruminer', 'je me repete', 'toujours pareil', 'ca recommence',
        'la meme chose', 'encore une fois'],
    1: ['philosophie', 'obsession', 'obsede', 'fixette']
  },
  eclipse: { // L'ECLIPSE. La lumiere est la, quelque chose passe devant.
    3: ['melancolie', 'melancolique', 'nostalgie', 'nostalgique', 'chagrin', 'deprime',
        'deprimee', 'depression'],
    2: ['triste', 'tristesse', 'pleure', 'pleurer', 'larmes', 'cafard',
        'sombre', 'lourd', 'peine', 'coeur lourd', 'seul', 'seule', 'solitude',
        'personne ne', 'plus personne', 'abandonne', 'abandonnee', 'rejete', 'rejetee',
        'honte', 'coupable', 'culpabilite'],
    1: ['gris', 'las', 'lasse', 'pesant', 'moche', 'sale']
  },
  voidwell: { // LE PUITS. Le vide : plus de fond, plus d'envie, plus de relief.
    3: ['anhedonie', 'engourdi', 'anesthesie', 'dissocie', 'dissociation', 'vide interieur'],
    2: ['vide', 'rien ne', 'plus rien', 'aucune envie', 'plus envie', 'indifferent',
        'detache', 'creux', 'absent', 'plat', 'aucun gout', 'plus gout',
        'je ressens rien', 'ca me fait rien', 'a plat', 'eteint', 'eteinte'],
    1: ['rien', 'neutre', 'normal', 'pareil', 'bof']
  },
  monolith: { // LE MONOLITHE. Une chose dressee devant soi : l'epreuve, ce qu'il faut affronter.
    3: ['decision', 'decider', 'choix', 'ultimatum', 'demission', 'rupture', 'divorce',
        'proces', 'diagnostic', 'operation', 'convocation'],
    2: ['affronter', 'confronter', 'assumer', 'responsabilite', 'engagement', 'trancher',
        'important', 'serieux', 'entretien', 'rendez-vous', 'echeance', 'rendu',
        'presentation', 'oral', 'jury', 'signer', 'contrat', 'psy', 'psychiatre',
        'psychologue', 'therapie', 'traitement', 'ordonnance'],
    1: ['travail', 'boulot', 'taf', 'projet', 'deadline', 'examen', 'dossier', 'client']
  },
  grain: {   // LE GRAIN. Rien ne tient en place : l'angoisse, l'agitation, le corps qui parle.
    3: ['angoisse', 'angoisses', 'anxiete', 'anxieux', 'anxieuse', 'panique',
        'crise d angoisse', 'tremble', 'tremblements', 'anxio', 'anxios'],
    2: ['stresse', 'stressee', 'stress', 'nerveux', 'nerveuse', 'agite', 'agitee',
        'insomnie', 'insomnies', 'nuit blanche', 'nuits blanches', 'palpitations',
        'oppresse', 'cage thoracique', 'boule au ventre', 'dors pas', 'pas dormi',
        'defonce', 'defoncee', 'weed', 'joint', 'joints', 'fume', 'bourre', 'alcool',
        'bieres', 'cachets', 'medocs', 'trop de trucs', 'partout a la fois'],
    1: ['inquiet', 'inquiete', 'peur', 'tendu', 'tendue', 'fatigue', 'vite', 'urgent']
  },
  brume: {   // LA BRUME. Le calme : la journee tient, rien ne presse.
    3: ['apaise', 'apaisee', 'serein', 'sereine', 'paisible'],
    2: ['calme', 'tranquille', 'repose', 'reposee', 'bien', 'mieux', 'content',
        'contente', 'heureux', 'heureuse', 'soulage', 'soulagee', 'doux', 'douce',
        'ca va', 'plutot bien', 'bonne journee', 'fier', 'fiere', 'satisfait',
        'avance', 'reussi', 'termine'],
    1: ['ok', 'correct', 'agreable', 'sympa', 'chouette', 'cool']
  },
  aube: {    // L'AUBE. L'espoir : quelque chose s'ouvre, et c'est tourne vers ce qui vient.
    /*
     * LE CALME ET L'ESPOIR NE SONT PAS LA MEME CHOSE, et c'est tout l'interet
     * d'avoir les deux. « brume » dit une journee qui tient -- rien ne presse,
     * rien ne manque. Celle-ci dit que quelque chose s'ouvre : un debut, une
     * envie, une nouvelle qu'on attendait. Les mots du calme decrivent un
     * ETAT, ceux-ci une DIRECTION.
     *
     * Les racines qui pourraient tomber des deux cotes -- « bien », « mieux »,
     * « content » -- restent a « brume » : elles disent d'abord que ca va, et
     * ce produit ne promet jamais un lendemain a la place de quelqu'un.
     */
    3: ['espoir', 'espere', 'esperer', 'optimiste', 'euphorie', 'euphorique',
        'emerveille', 'emerveillee', 'gratitude', 'reconnaissant', 'reconnaissante',
        'ca y est', 'j ai reussi', 'je suis pris', 'je suis prise'],
    2: ['bonheur', 'joie', 'joyeux', 'joyeuse', 'radieux', 'radieuse', 'leger',
        'legere', 'confiance', 'confiant', 'confiante', 'motive', 'motivee',
        'enthousiaste', 'excite', 'excitee', 'impatient', 'impatiente', 'hate',
        'nouveau depart', 'ca repart', 'ca s ouvre', 'ca s arrange', 'ca s eclaircit',
        'bonne nouvelle', 'ca va aller', 'j y crois', 'envie de', 'projet qui',
        'demain', 'l avenir', 'la suite', 'recommencer', 'premiere fois'],
    1: ['sourire', 'souri', 'ri', 'rire', 'chance', 'cadeau', 'soleil', 'matin',
        'printemps', 'reveil']
  },
  pluie: {   // LA PLUIE. Ce qui se relache : ca sort, ca coule, et on est a l'abri.
    /*
     * ELLE NE DIT PAS « TU VAS MAL » -- « eclipse » porte deja le chagrin, et
     * une pluie qui voudrait dire la tristesse serait un verdict peint sur le
     * fond. Celle-ci porte le RELACHEMENT : quelque chose sort enfin, la
     * tension retombe, le corps lache. Ca peut arriver un tres bon jour.
     *
     * D'ou le vocabulaire : pleurer y est, mais « craque », « vide mon sac »,
     * « ca fait du bien de » et « enfin » aussi. Ce sont les mots d'un
     * relachement, pas ceux d'une chute -- et la difference est justement ce
     * que ce decor a de particulier a dire.
     */
    3: ['craque', 'craquee', 'j ai craque', 'lache prise', 'vide mon sac',
        'tout sorti', 'ca sort enfin', 'ca fait du bien de'],
    2: ['pleure', 'pleurer', 'pleurs', 'sanglots', 'larmes', 'relache', 'relachee',
        'souffle enfin', 'ca retombe', 'la tension retombe', 'soulagement',
        'j ai tout dit', 'je me suis confie', 'je me suis confiee', 'enfin dit',
        'ca coule', 'il pleut', 'la pluie', 'orage', 'gris dehors'],
    1: ['enfin', 'vide', 'lourd', 'trempe', 'dehors']
  },
  drift: {   // LES ETOILES. Etre perdu : ne pas savoir ou on va, flotter.
    /*
     * Le seul lexique ajoute apres coup, et il repare un vrai trou. « drift »
     * etait la scene par DEFAUT, celle qu'on affiche quand rien ne ressort --
     * elle n'avait donc aucun mot a elle. Mais son image est un champ
     * d'etoiles, et etre perdu n'est pas la meme chose que ne rien avoir dit :
     * c'est un etat, il a ses mots, et il merite d'etre reconnu comme les
     * autres. Elle reste le repli ; elle est maintenant aussi une reponse.
     */
    3: ['perdu', 'perdue', 'je sais plus', 'sais pas quoi faire', 'aucune idee',
        'desoriente', 'desorientee', 'egare', 'egaree'],
    /*
     * « je sais pas » n'y est plus. C'etait l'entree la plus frequente de tout
     * le lexique sur un vrai journal (91 fois) : un tic de langage, pas un etat,
     * et elle tirait chaque passage vers le bas. « je sais plus » et « sais pas
     * quoi faire » disent, eux, qu'on est perdu -- ils restent.
     */
    2: ['sais plus ou', 'ou je vais', 'ou j en suis', 'quoi faire',
        'dans quel sens', 'ca flotte', 'je flotte', 'a la derive', 'plus de reperes',
        'plus de cap', 'confus', 'confuse', 'flou', 'brouillard', 'melange'],
    1: ['bizarre', 'etrange', 'incertain', 'hesite', 'peut-etre']
  }
};

/**
 * CE QUE CHAQUE DECOR PORTE, en une phrase.
 *
 * Ce n'est pas de la documentation : c'est ce que l'interface affiche dans le
 * rail, sous le nom de la scene. Un decor qui change sans qu'on puisse savoir
 * ce qu'il represente reste une decoration ; nomme, il devient une lecture --
 * mais une lecture qu'on peut contredire, et c'est ce qui la rend acceptable.
 *
 * Ils disent tous ce que la SCENE represente, jamais ce que la personne EST :
 * « ce qu'on affronte », pas « tu affrontes quelque chose ».
 */
export const SENS = {
  drift:    'être perdu — des étoiles, aucun cap',
  brume:    'le calme — la journée tient',
  abyss:    'ce qui est irréversible — une pyramide au bord de l\'eau',
  eclipse:  'la lumière cachée — un disque devant le soleil',
  voidwell: 'le vide — un puits sans fond',
  monolith: 'l\'épreuve — une pierre dressée devant soi',
  grain:    'rien ne tient en place — le sol qui grouille',
  mandel:   'la pensée qui se replie — une figure sans fin',
  aube:     'ce qui s\'ouvre — le soleil qui se lève sur des champs',
  pluie:    'ce qui se relâche — la pluie, et on est à l\'abri'
};

/** La scene quand rien ne ressort. Et, depuis qu'elle a un lexique, une reponse. */
export const DEFAUT = 'drift';

/** Toutes les scenes connues du shader, dans l'ordre ou il les compile. */
export const SCENES = ['drift', 'brume', 'abyss', 'eclipse', 'voidwell', 'monolith', 'grain', 'mandel',
                       'aube', 'pluie'];

/**
 * Sous ce nombre de mots ecrits, on ne change rien.
 *
 * Le decor doit s'installer, pas sursauter. Quelqu'un qui tape « mort de rire »
 * en arrivant ne merite pas une pyramide, et un fond qui saute a chaque phrase
 * transforme une ambiance en jouet.
 */
export const MOTS_MINIMUM = 25;

/*
 * Chaque entree compilee UNE fois. Racine + terminaison possible, jamais la
 * sous-chaine : « mort » ne doit pas se declencher sur « amortir », ni « vide »
 * sur « evider ». La borne de droite est regardee sans etre mangee -- sinon
 * « mort mort » ne comptait qu'une fois.
 */
const ENTREES = Object.entries(LEXIQUES).flatMap(([scene, lex]) =>
  Object.entries(lex).flatMap(([poids, liste]) => liste.map(brut => {
    const mot = norm(brut);
    return { scene, poids: Number(poids), mot,
             re: new RegExp(`(^|[^a-z0-9])(${mot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:e?s?))(?=$|[^a-z0-9])`, 'g') };
  })));

/*
 * LA NEGATION, ET SEULEMENT SUR CE QUI VA BIEN.
 *
 * « ça va pas du tout » sortait en CALME (+0,75, soit ≈8,5 sur une reference
 * de 6), « je suis pas bien » aussi. Une negation dans les deux mots d'avant,
 * ou un « pas » juste apres, retourne donc un mot du calme ou de l'espoir.
 *
 * Elle n'efface JAMAIS un mot lourd. Le premier essai traitait « plus » comme
 * une negation : « de plus en plus triste » perdait la moitie de sa tristesse
 * et « je me sens plus angoisse » ne comptait plus rien. « plus » ne nie donc
 * que dans la forme « ne … plus », et seulement devant un mot du calme.
 *
 * TROIS FORMES QUE LA FENETRE DE DEUX MOTS NE VOYAIT PAS.
 *
 * « pas du tout motive » met trois mots entre la negation et le mot : il
 * sortait a +0,69, lu vers le haut. « du tout » ne compte donc pour aucun mot,
 * ou qu'il soit place, et « plus du tout » nie sans son « ne » (aucune autre
 * lecture n'est possible).
 *
 * Perdre ou manquer d'une chose, c'est ne pas l'avoir : « perdu tout espoir »,
 * « perte de confiance », « manque de joie » retournent le mot qui suit, comme
 * une negation.
 *
 * Et devant l'espoir, la joie ou la confiance, un « plus » seul nie aussi :
 * a l'oral, « j'ai plus d'espoir » dit qu'il n'y en a plus, bien plus souvent
 * qu'il n'en dit davantage. Le doute se paie d'un mot qui ne compte pas, pas
 * d'un desespoir lu vers le haut. Devant le calme (« je me sens plus calme »),
 * le comparatif reste la lecture courante : la regle du « ne … plus » y tient.
 */
const SCENES_NIABLES = new Set(['brume', 'aube']);
const NIE = new Set(['pas', 'jamais', 'aucun', 'aucune', 'sans']);
const DEJA_NEGATIF = /^(?:pas|plus|jamais|aucun|sans|rien)\b/;
const PRIVE = /^(?:perdu|perdue|perdus|perdues|perdre|perds|perd|perdant|perte|pertes|manque|manques|manquer|manquais|manquait)$/;
// Ce qui peut se glisser entre « perdu » et ce qu'on a perdu.
const ENTRE_PRIVE = new Set(['de', 'd', 'du', 'des', 'tout', 'toute', 'tous', 'toutes', 'la', 'l', 'le',
  'les', 'mon', 'ma', 'mes', 'ton', 'ta', 'tes', 'son', 'sa', 'ses', 'un', 'une', 'peu', 'beaucoup', 'en', 'cruellement']);

function nie(t, v) {
  if (!SCENES_NIABLES.has(v.scene) || DEJA_NEGATIF.test(v.mot)) return false;
  const brut = t.slice(0, v.s).match(/[a-z0-9]+/g) ?? [];
  // « pas du tout motive », « pas du tout tres motive » : se lisent « pas motive ».
  const avant = [];
  for (let i = 0; i < brut.length; i++) {
    if (brut[i] === 'du' && brut[i + 1] === 'tout') {
      if (avant.at(-1) === 'plus') avant[avant.length - 1] = 'pas';   // « plus du tout »
      i++;
      continue;
    }
    avant.push(brut[i]);
  }
  const deux = avant.slice(-2);
  if (deux.some(m => NIE.has(m))) return true;
  if (deux.includes('plus') && (v.scene === 'aube' || avant.slice(-5).some(m => m === 'n' || m === 'ne'))) return true;
  // « perdu tout espoir », « manque de confiance » : trois mots en arriere au plus.
  for (let i = avant.length - 1; i >= Math.max(0, avant.length - 4); i--) {
    if (PRIVE.test(avant[i])) return true;
    if (!ENTRE_PRIVE.has(avant[i])) break;
  }
  const apres = t.slice(v.f).match(/[a-z0-9]+/g)?.[0] ?? '';
  if (apres === 'pas') return true;
  // « bien trop », « bien plus », « bien moins » : un intensif, pas du calme.
  if (v.mot === 'bien' && /^(?:plus|trop|moins)$/.test(apres)) return true;
  return false;
}

/**
 * Ce qu'un texte pese pour chaque scene, avant toute ponderation.
 *
 * LA PLUS LONGUE CORRESPONDANCE GAGNE. Le lexique liste deja le feminin et le
 * pluriel alors que la terminaison les accepte : « contente » comptait 4 et
 * « content » 2, « anxios » 6 et « anxio » 3. Et une expression se cumulait
 * avec ses morceaux : « envie de mourir » donnait aussi le « envie de » de
 * l'espoir. Un meme bout de texte n'est compte qu'une fois -- sauf quand deux
 * scenes le lisent a egalite (« pleure » est chagrin ET relachement).
 *
 * `retenues` dit quel mot a ete retenu pour quelle scene : `pencheDe` en a
 * besoin pour ne donner une valence qu'aux mots qui en portent une.
 */
export function scoresDe(texte) {
  const t = ' ' + norm(texte).replace(/[’']/g, ' ') + ' ';
  const vus = [];
  for (const e of ENTREES) {
    e.re.lastIndex = 0;
    let x;
    while ((x = e.re.exec(t)) !== null) {
      const s = x.index + x[1].length;
      vus.push({ scene: e.scene, poids: e.poids, mot: e.mot, s, f: s + x[2].length });
    }
  }
  vus.sort((a, b) => (b.f - b.s) - (a.f - a.s) || b.poids - a.poids || a.s - b.s);
  const retenues = [], occupes = [];
  for (const v of vus) {
    const chevauche = occupes.some(p => p.s < v.f && v.s < p.f
      && !(p.s === v.s && p.f === v.f && p.scene !== v.scene));
    if (chevauche) continue;
    // Un mot nie occupe quand meme sa place : « pas plutot bien » ne doit pas
    // rendre son « bien » par la petite porte.
    occupes.push(v);
    if (!nie(t, v)) retenues.push(v);
  }
  const scores = {};
  for (const v of retenues) scores[v.scene] = (scores[v.scene] ?? 0) + v.poids;
  return { scores, mots: (t.match(/[a-z0-9]+/g) ?? []).length,
           retenues: retenues.sort((a, b) => a.s - b.s).map(({ scene, poids, mot }) => ({ scene, poids, mot })) };
}

/**
 * LE DECOR SUIT LA CONVERSATION, PAS SA MOYENNE.
 *
 * Tout le fil comptait a poids egal. Une soiree ou l'on avait parle d'un deuil
 * gardait donc la pyramide a l'ecran trois jours plus tard, en plein milieu
 * d'une conversation sur autre chose -- et rien de ce qu'on ecrivait ensuite
 * n'arrivait a la deloger, puisque le passe pesait toujours plus lourd que le
 * present.
 *
 * Chaque message pese donc moins que le suivant, et la decroissance est FRANCHE
 * -- demi-vie d'environ deux messages et demi. Avec une pente douce, le fil
 * accumulait : quinze messages sur un sujet formaient un socle qu'un
 * changement de sujet ne deplacait plus, et le decor restait bloque sur ce
 * dont on avait parle une heure plus tot.
 *
 * Ce que ca donne, et c'est le comportement voulu : un seul message grave au
 * milieu d'une conversation calme ne repeint pas tout ; trois de suite, oui.
 *
 * @param {string[]} messages  ce que la personne a ecrit, du plus ancien au plus recent
 */
export function readMoodFil(messages, note = null) {
  const liste = (messages ?? []).filter(m => typeof m === 'string' && m.trim());
  if (!liste.length) return readMood('', note);

  const scores = {};
  let mots = 0;
  liste.forEach((texte, i) => {
    const poids = Math.pow(0.75, liste.length - 1 - i);
    const r = scoresDe(texte);
    mots += r.mots;
    for (const [scene, v] of Object.entries(r.scores)) {
      scores[scene] = (scores[scene] ?? 0) + v * poids;
    }
  });
  return trancher(scores, mots, note);
}

/**
 * @param {string} texte  ce que la personne a ecrit dans le fil courant
 * @param {number|null} note  sa note du jour, si elle l'a posee
 * @returns {{scene: string, force: number, mots: number, scores: object}}
 */
export function readMood(texte, note = null) {
  const { scores, mots } = scoresDe(texte);
  return trancher(scores, mots, note);
}

/** Ce qui reste commun aux deux : la note, les seuils, le depart. */
function trancher(scores, mots, note) {
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
