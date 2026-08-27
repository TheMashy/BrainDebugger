/**
 * Le lexique : quels mots meritent d'etre montres.
 *
 * BM25 sait dire « ce mot est rare dans ton corpus ». Il ne sait pas dire « ce
 * mot dit quelque chose ». Sur un journal intime les deux divergent tres vite :
 * « different », « fois », « autres » sont statistiquement discriminants et
 * humainement vides, tandis que « fatigue » ou « autodestruction » sont
 * frequents chez quelqu'un qui va mal -- donc mal notes par la rarete, alors
 * que ce sont exactement les mots qu'on veut voir ressortir.
 *
 * Ce fichier corrige ce biais, et rien d'autre. Il ne classe pas une journee,
 * il ne diagnostique personne, il ne dit jamais ce qu'un mot veut dire : il dit
 * seulement lequel merite l'encre. La regle du produit tient -- on montre, on
 * ne qualifie pas.
 *
 * QUATRE FAMILLES, PAR ORDRE DE CE QU'ELLES APPRENNENT
 *
 *   MECANISMES   ce que quelqu'un FAIT de son etat : ruminer, eviter, saboter,
 *                rechuter. Le plus haut poids, parce que c'est ce qui se repete
 *                et donc ce qui se reconnait d'une annee sur l'autre.
 *   ETATS        ce que quelqu'un TRAVERSE : angoisse, insomnie, panique.
 *   AFFECTS      ce que quelqu'un RESSENT : peur, honte, fierte, soulagement.
 *   CORPS        ce que le corps EN FAIT : tremble, nausee, poitrine, sommeil.
 *
 * Et deux familles qu'on rabaisse :
 *
 *   VAGUES       les mots qui annoncent un etat sans le nommer. « envie »,
 *                « impression », « bizarre » : le signal est dans la suite de
 *                la phrase, pas dans le mot. Surligner « envie » dans « envie
 *                de disparaitre » designe la mauvaise moitie.
 *   CREUX        les articulations. Aucune valeur, jamais, nulle part.
 *
 * Les EXPRESSIONS reglent le cas de « envie » pour de bon : quand la suite de
 * la phrase est la, c'est elle qu'on retient, entiere.
 */

/** Racines, sans accent (le tokenizer normalise en NFD avant d'arriver ici). */
const FAMILLES = [
  [3.0, `
    autodestruct autosabotage sabotage autodestructeur automutilation
    rumination ruminer rumine evitement eviter evite procrastin
    compulsion compulsif obsession obsessionnel addiction dependance
    rechute rechuter sevrage spirale engrenage cercle vicieux
    hypervigilan catastrophis dramatis culpabilis autocritique
    dissociation depersonnalis derealis refoulement projection
    deni denier autosuffis effondrement decompensation
    scarification scarifi automutil autolyse ideation suicidaire suicide
    purge purger restriction hyperphagie binge craving
    abstinen sobriete desintox
  `],
  [2.6, `
    anxio anxiete anxieux angoiss panique attaque phobie agoraphob
    depress deprim melancol insomni burnout epuisement trauma ptsd
    obsessionn bipolar tdah adhd hypersensib psychose paranoia
    crise trouble symptome diagnostic
    psy psychiatre psychologue psychiatrie psychotherap therapeute
    therapie seance consultation hospitalis
    cauchemar hypersomni apnee narcolep
    anorexi boulimi tca dysmorph
    borderline cyclothym spasmophil claustrophob
  `],
  [2.2, `
    peur terreur effroi honte humiliation culpabilite remords
    colere rage fureur haine rancune amertume jalousie envieux
    tristesse chagrin desespoir detresse abattement decouragement
    solitude isolement abandon rejet trahison
    vide neant absurde insignifian
    fierte fier soulag apais serein confian espoir gratitude
    joie bonheur euphorie exalt tendresse
    degout mepris ressentiment
  `],
  [1.8, `
    fatigu epuis extenu creve lessive
    tremble tremblement palpitation oppress etouff suffoqu
    nausee vomi migraine cephalee vertige acouphene
    poitrine gorge ventre machoire nuque crispation tension contracture
    sommeil dormi endormi reveil cauchemar somnol
    appetit grignot
    douleur souffrance courbature
    alcool cannabis weed cocaine benzodiazepine antidepresseur
    lithium neuroleptique somnifere dosage posologie
  `]
];

/**
 * Les mots qui annoncent un etat sans le nommer. Rabaisses, jamais supprimes :
 * « impression que rien n'avance » reste une phrase qui compte, on veut juste
 * qu'elle ne gagne pas contre « autodestruction ».
 */
const VAGUES = new Set(`
  envie impression sentiment ressenti genre style espece maniere facon
  super cool sympa chouette bizarre chelou zarbi space
  choses trucs machin bidule
`.trim().split(/\s+/));

/**
 * Les articulations. Elles passent les stopwords de la recherche parce qu'elles
 * portent du sens dans une phrase, mais en etiquette « voici pourquoi ca
 * ressort » elles ne disent rien. Retirees du flux de tokens.
 */
export const CREUX = new Set(`
  fois moment temps coup instant
  jour jours journee journees semaine semaines mois annee annees
  heure heures minute minutes midi minuit
  eu ete etais etait sera serai
  autre autres different differente differents differentes pareil pareille
  chose truc trucs
  quasiment vraiment carrement franchement completement totalement
  beaucoup enormement legerement plutot assez presque
  ensuite apres avant pendant depuis
  encore toujours souvent parfois surtout deja
  aujourd hui demain veille lendemain
  verra verrai voir vu vois vue
  avance avancer avancement ensemble bonne bon meilleur meilleure
  personne quelqu quelqu'un gens monde
  chaque chacun chacune plusieurs certains certaines
  arrive arriver arrivee passe passer passage
  donne donner mettre mis prendre pris
  juste fond genre carrement tellement
  va vais vas allait aller alle allee
  dit dis dire disais pense pensais penser crois croire croyais
  sais sait savais veux veut voulais peux peut pouvais faut faudrait devrait pourrait
  aujourd'hui hui
`.trim().split(/\s+/));

/**
 * Les expressions. Le signal psychologique vit rarement dans un mot seul --
 * « envie » ne veut rien dire, « envie de disparaitre » veut tout dire. Elles
 * sont indexees comme des tokens a part entiere (jointes par « _ », que le
 * tokenizer ne produit jamais), donc BM25 les traite comme des mots tres rares
 * et elles gagnent naturellement contre leurs propres morceaux.
 */
const EXPRESSIONS_BRUTES = `
  envie de disparaitre | envie de mourir | envie de crever | envie d en finir
  faire du mal | me faire du mal | te faire du mal | mal a moi
  plus envie de rien | plus envie de vivre | aucune envie de rien
  crise d angoisse | attaque de panique | nuit blanche | nuits blanches
  boule au ventre | boule dans la gorge | boule a la gorge | noeud a l estomac
  poids sur la poitrine | mal a respirer | plus respirer
  a quoi bon | ca sert a rien | aucun sens | tourne en rond | tourne en boucle
  au bout du rouleau | a bout de nerfs | plus tenir | tiens plus
  sortir du lit | rester au lit | pas sortir de chez moi
  plus jamais | comme d habitude | comme toujours
  peur du vide | peur de rater | peur de decevoir | peur d etre seul
  besoin d aide | demander de l aide | parler a quelqu un
  je me deteste | je me degoute | je suis nul | je sers a rien
  tentative de suicide | idees noires | idees suicidaires | passage a l acte
  me scarifier | me couper | me faire vomir
  crise de boulimie | crise de larmes
  arreter de boire | arreter de fumer | tenir le coup | tenu bon
  j ai rechute | j ai craque | je tiens toujours | ca fait une semaine
  ca fait un mois | depuis que j ai arrete | premier jour sans
`;

/* ------------------------------------------------------------------ */

/**
 * Les abreviations. Elles ne sont pas des racines : « ts » ne prefixe rien, et
 * une racine de deux lettres attraperait la moitie du corpus si on la laissait
 * prefixer. Table exacte, poids de mecanisme -- ce sont les mots les plus
 * lourds qu'on puisse ecrire dans un journal, et ils ne ressortaient pas.
 */
const ABREGES = new Map([
  ['ts', 3.0], ['hp', 2.6], ['tca', 3.0], ['tag', 2.2],
  ['tdah', 2.6], ['tspt', 2.6], ['toc', 3.0], ['od', 3.0]
]);

const POIDS = new Map();
for (const [poids, liste] of FAMILLES) {
  for (const racine of liste.trim().split(/\s+/)) {
    // La plus forte famille l'emporte : « fatigue » cite deux fois garde 2.2.
    POIDS.set(racine, Math.max(POIDS.get(racine) ?? 0, poids));
  }
}

/*
 * Racines longues : on accepte le prefixe (« anxio » attrape « anxios »,
 * « anxiolytique »). Racines courtes : mot exact seulement, sinon « fier »
 * attrape « fierement » -- acceptable -- mais « peur » attraperait « peureux »
 * et « vide » n'attraperait rien de faux, alors que « mal » attraperait
 * « malgre » et « malade ». Le seuil de 5 est le point ou les faux positifs
 * cessent d'etre rentables.
 */
const PREFIXE_MIN = 5;
const RACINES_PREFIXE = [...POIDS.keys()].filter(r => r.length >= PREFIXE_MIN)
  .sort((a, b) => b.length - a.length);

/** Le nom affichable d'un token (les expressions reviennent en clair). */
export const lisible = t => String(t).replace(/_/g, ' ');

/** Un token est-il une expression indexee ? */
export const estExpression = t => String(t).includes('_');

/**
 * Combien ce mot merite d'encre. 1 = neutre.
 * @param {string} token  token normalise (sans accent, minuscule)
 * @returns {number}
 */
export function poids(token) {
  const t = String(token ?? '');
  if (!t) return 1;
  if (estExpression(t)) return 3.2;          // une expression a ete choisie, pas subie
  const abrege = ABREGES.get(t);
  if (abrege !== undefined) return abrege;
  if (CREUX.has(t)) return 0.15;
  if (VAGUES.has(t)) return 0.55;
  const exact = POIDS.get(t);
  if (exact !== undefined) return exact;
  for (const r of RACINES_PREFIXE) if (t.startsWith(r)) return POIDS.get(r);
  return 1;
}

/** Au-dessus, un mot est « saillant » : il nomme un etat, pas une circonstance. */
export const SEUIL_SAILLANT = 1.7;
export const saillant = t => poids(t) >= SEUIL_SAILLANT;

/* --- reconnaissance des expressions dans un flux de mots bruts --- */

/*
 * Coupe sur « | » ET sur le retour a la ligne.
 *
 * split('|') seul recollait la derniere expression d'une ligne avec la premiere
 * de la suivante : « je sers a rien » + « tentative de suicide » devenait une
 * entree de huit mots qui ne pouvait plus jamais matcher. Une par frontiere de
 * ligne, dans les deux sens -- la moitie de la table etait morte, en silence, et
 * rien ne pouvait le signaler : une expression qui ne matche pas se comporte
 * exactement comme une expression absente.
 */
const EXPRESSIONS = EXPRESSIONS_BRUTES.split(/[|\n]/)
  .map(e => e.trim().split(/\s+/).filter(Boolean))
  .filter(e => e.length >= 2);

/**
 * Indexees par premier mot : le balayage ne coute rien sur les 99 % de mots.
 * La plus longue d'abord, dans chaque seau -- « me faire du mal » doit gagner
 * contre « faire du mal », et pas dependre de l'ordre ou on les a ecrites.
 */
const PAR_TETE = new Map();
for (const e of EXPRESSIONS) {
  if (!PAR_TETE.has(e[0])) PAR_TETE.set(e[0], []);
  PAR_TETE.get(e[0]).push(e);
}
for (const l of PAR_TETE.values()) l.sort((a, b) => b.length - a.length);

/**
 * @param {string[]} bruts  tous les mots du texte, stopwords compris
 * @returns {string[]}  tokens d'expression, joints par « _ »
 */
export function expressions(bruts) {
  const trouves = [];
  for (let i = 0; i < bruts.length; i++) {
    const cands = PAR_TETE.get(bruts[i]);
    if (!cands) continue;
    for (const e of cands) {
      if (i + e.length > bruts.length) continue;
      let ok = true;
      for (let k = 1; k < e.length; k++) if (bruts[i + k] !== e[k]) { ok = false; break; }
      // La plus longue qui matche gagne, et on saute par-dessus : sinon
      // « me faire du mal » rend AUSSI « faire du mal » un mot plus loin, et
      // le meme bout de phrase compte deux fois dans l'index.
      if (ok) { trouves.push(e.join('_')); i += e.length - 1; break; }
    }
  }
  return trouves;
}
