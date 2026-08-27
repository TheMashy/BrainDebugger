/**
 * Le chaton : un compagnon dessine au trait, qui change de visage.
 *
 * POURQUOI IL N'EST PAS FAIT COMME LES AUTRES
 * Les cinq bestioles de pets.js sont des figurines : degrades radiaux, ombres
 * internes, rebonds de lumiere. Elles sont belles et elles sont FIGEES -- une
 * expression y coute une reecriture complete du visage, degrades compris. Ici
 * on veut vingt-et-une expressions, donc le trait seul, et un visage compose de
 * trois pieces qu'on echange.
 *
 * PAS TROP REACTIF, ET SURTOUT PAS UNCANNY
 * Ce n'est pas un visage humain et il ne doit jamais chercher a l'etre : deux
 * yeux, une bouche minuscule, des moustaches. Ce qui rend une bestiole
 * derangeante n'est pas le manque de detail, c'est l'exces -- une expression
 * trop lue donne l'impression d'etre jauge par la machine.
 *
 * D'OU VIENT L'HUMEUR
 * Du DECOR, c'est-a-dire de la scene et de l'energie deja calculees pour le
 * fond -- jamais de la note. Le decor est explicitement « pas une lecture de ta
 * journee » ; la note, elle, EST la journee, et un compagnon qui fait la moue
 * en la voyant qualifierait ce que l'application s'interdit de qualifier.
 *
 * `currentColor` partout : la couleur vient de la page, comme pour les icones.
 */

/* ---------------------------- la carcasse ---------------------------- */

/*
 * Assis, de face, la queue enroulee a droite. Une seule pose : un compagnon qui
 * change de posture a chaque humeur devient une animation, et on regarde
 * l'animation au lieu de la conversation.
 */
const CORPS = `
  <path d="M31 31.5 26.5 12.5 41.5 21.5"/>
  <path d="M69 31.5 73.5 12.5 58.5 21.5"/>
  <path d="M31 31.5c-1-6.5 4.5-12 10-12.6a34 34 0 0 1 18 0c5.5.6 11 6.1 10 12.6
           1.4 6.6-1.6 12.4-7.4 15.2a26 26 0 0 1-23.2 0C32.6 43.9 29.6 38.1 31 31.5Z"/>
  <path d="M37.6 46.4C31 52.6 26.5 63 26.5 72.6c0 7.6 4.6 12 12 12h23c7.4 0 12-4.4 12-12
           0-9.6-4.5-20-11.1-26.2"/>
  <path d="M44 84.6v-7.2M56 84.6v-7.2"/>
  <path d="M73.5 78c4.6.6 8.2-1.4 8.2-5.2 0-3.4-2.8-5.4-5.6-4.6-2.4.7-3.4 3-2.6 5.6"/>
  <path d="M28.5 34.5 20 32.4M28.5 38.2 20.4 38.4M28.5 41.6 21 44.4"/>
  <path d="M71.5 34.5 80 32.4M71.5 38.2 79.6 38.4M71.5 41.6 79 44.4"/>`;

/* ------------------------------ les yeux ------------------------------ */

/*
 * Les deux yeux ne sont JAMAIS strictement identiques : un demi-point d'ecart
 * sur le rayon, un dixieme sur la hauteur. C'est ce qui separe une bestiole
 * dessinee d'un clipart symetrique, et ca ne se voit pas -- ca se sent.
 */
const YEUX = {
  points:  '<circle cx="42.2" cy="34.4" r="2.5" fill="currentColor" stroke="none"/>'
         + '<circle cx="57.8" cy="34.2" r="2.3" fill="currentColor" stroke="none"/>',
  grands:  '<circle cx="42.2" cy="34.2" r="3.6"/><circle cx="57.8" cy="34.2" r="3.4"/>',
  petits:  '<circle cx="42.4" cy="35.2" r="1.6" fill="currentColor" stroke="none"/>'
         + '<circle cx="57.6" cy="35" r="1.5" fill="currentColor" stroke="none"/>',
  // ^ ^ : le sourire est dans les yeux, pas dans la bouche
  contents: '<path d="M39.2 35.4c1-2.4 4.6-2.4 5.8 0"/><path d="M55.2 35.2c1-2.4 4.6-2.4 5.8 0"/>',
  // ‿ ‿ : fermes, detendus. Le meme trait retourne dit « endormi » ou « apaise »
  fermes:  '<path d="M39.2 33.8c1 2.5 4.6 2.5 5.8 0"/><path d="M55.2 33.6c1 2.5 4.6 2.5 5.8 0"/>',
  traits:  '<path d="M39.4 34.6h5.4"/><path d="M55.4 34.4h5.2"/>',
  // Fermes ET tombants : « triste » et « calme » partageaient les memes yeux
  // fermes, et a cette taille la bouche seule ne les separait plus.
  tombants: '<path d="M39 33c1.4 2.6 4.6 2.9 6-.2"/><path d="M55 32.8c1.4 2.6 4.6 2.9 6-.2"/>',
  // un point, un trait : ce qui dit « il reflechit » sans qu'on ait a l'ecrire
  mi:      '<circle cx="42.2" cy="34.4" r="2.4" fill="currentColor" stroke="none"/>'
         + '<path d="M55.4 34.4h5.2"/>'
};

/* ----------------------------- les bouches ----------------------------- */

/* Minuscules. Une bouche large sur un museau de vingt pixels fait une grimace,
   et c'est exactement la ou une bestiole devient derangeante. */
const BOUCHES = {
  // Le « w » du chat, et pas une courbe unique : a soixante-seize pixels la
  // courbe disparaissait, et les vingt-et-une humeurs se ressemblaient toutes.
  museau:  '<path d="M50 39.4v1.1"/><path d="M46.8 40.4c.9 1.9 2.6 1.9 3.2.1c.6 1.8 2.3 1.8 3.2-.1"/>',
  sourire: '<path d="M50 39.2v1"/><path d="M45.8 40c1.2 2.9 3.1 2.9 4.2.2c1.1 2.7 3 2.7 4.2-.2"/>',
  petite:  '<path d="M50 39.4v1.1"/><path d="M48.4 41h3.2"/>',
  plate:   '<path d="M50 39.4v1.1"/><path d="M46.4 41.2h7.2"/>',
  triste:  '<path d="M50 39.2v1"/><path d="M45.8 42.4c1.2-2.8 3.1-2.8 4.2-.2c1.1-2.6 3-2.6 4.2.2"/>',
  ondulee: '<path d="M50 39.4v1.1"/><path d="M46.4 41.6c1.1-1.6 2.4-1.6 3.6 0s2.5 1.6 3.6 0"/>',
  ronde:   '<ellipse cx="50" cy="41.4" rx="1.8" ry="2.2"/>',
  aucune:  '<path d="M50 39.4v1.1"/>'
};

/* ----------------------------- les accents ----------------------------- */

/* Un seul, petit, en haut a droite. Deux accents et le dessin devient un
   pictogramme de statut ; l'idee est qu'on le remarque sans le chercher. */
const ACCENTS = {
  aucun:      '',
  coeur:      '<path d="M83 14.6c-1.6-1.8-4.4-.7-4.4 1.5 0 2 2.6 3.6 4.4 5 1.8-1.4 4.4-3 4.4-5 0-2.2-2.8-3.3-4.4-1.5Z"/>',
  etincelle:  '<path d="M83 10.5l1.3 3.9 3.9 1.3-3.9 1.3L83 20.9l-1.3-3.9-3.9-1.3 3.9-1.3z"/>',
  question:   '<path d="M80.6 12.6c0-1.9 1.6-3.1 3.2-3.1 1.8 0 3.2 1.2 3.2 3 0 2.4-3.2 2.5-3.2 4.8"/><path d="M83.8 20.4v.1"/>',
  dodo:       '<path d="M77.5 13.5h4.6l-4.6 5.4h4.6"/><path d="M84.5 8.4h3.4l-3.4 4h3.4"/>'
};

/* ------------------------------ les humeurs ------------------------------ */

/*
 * Vingt-et-une, faites de trois pieces. Beaucoup partagent leurs yeux : la
 * difference entre « pensif » et « contrarie » tient a la bouche, et c'est
 * assez -- un compagnon dont on lit vingt-et-un etats distincts sur le visage
 * n'est plus un compagnon, c'est un capteur.
 */
export const HUMEURS = {
  neutre:        { yeux: 'points',   bouche: 'museau',  accent: 'aucun' },
  heureux:       { yeux: 'contents', bouche: 'sourire', accent: 'aucun' },
  calme:         { yeux: 'fermes',   bouche: 'museau',  accent: 'aucun' },
  triste:        { yeux: 'tombants', bouche: 'triste',  accent: 'aucun' },
  reflexion:     { yeux: 'mi',       bouche: 'petite',  accent: 'aucun' },
  surpris:       { yeux: 'grands',   bouche: 'ronde',   accent: 'aucun' },
  curieux:       { yeux: 'grands',   bouche: 'museau',  accent: 'aucun' },
  reconnaissant: { yeux: 'points',   bouche: 'sourire', accent: 'coeur' },
  fatigue:       { yeux: 'traits',   bouche: 'petite',  accent: 'aucun' },
  inquiet:       { yeux: 'points',   bouche: 'ondulee', accent: 'aucun' },
  apaise:        { yeux: 'fermes',   bouche: 'sourire', accent: 'aucun' },
  motive:        { yeux: 'points',   bouche: 'sourire', accent: 'etincelle' },
  decu:          { yeux: 'tombants', bouche: 'petite',  accent: 'aucun' },
  serein:        { yeux: 'fermes',   bouche: 'aucune',  accent: 'aucun' },
  questionnant:  { yeux: 'points',   bouche: 'petite',  accent: 'question' },
  timide:        { yeux: 'petits',   bouche: 'petite',  accent: 'aucun' },
  contrarie:     { yeux: 'points',   bouche: 'plate',   accent: 'aucun' },
  pensif:        { yeux: 'points',   bouche: 'petite',  accent: 'aucun' },
  rassure:       { yeux: 'fermes',   bouche: 'museau',  accent: 'coeur' },
  endormi:       { yeux: 'fermes',   bouche: 'petite',  accent: 'dodo' },
  inspire:       { yeux: 'points',   bouche: 'museau',  accent: 'etincelle' }
};

export const DEFAUT = 'neutre';

/**
 * Le SVG complet.
 * @param {string} humeur  une clé de HUMEURS
 * @returns {string}
 */
export function chaton(humeur = DEFAUT) {
  const h = HUMEURS[humeur] ?? HUMEURS[DEFAUT];
  // Repli sur « petite » et pas sur « museau » : le museau est un sourire, et
  // une humeur mal orthographiée basculerait dans le contraire de ce qu'elle dit.
  const bouche = BOUCHES[h.bouche] ?? BOUCHES.petite;
  return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"
    fill="none" stroke="currentColor" stroke-width="1.9"
    stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">
    ${CORPS}
    ${YEUX[h.yeux] ?? YEUX.points}
    ${bouche}
    ${ACCENTS[h.accent] ?? ''}
  </svg>`;
}

/* ------------------- du décor à l'humeur ------------------- */

/*
 * Chaque scene donne DEUX humeurs : la seconde quand l'energie est basse.
 *
 * L'energie vient de readEnergy(note, reference) et vaut 0.35 sans note. Le
 * seuil est donc pose sous cette valeur : sans note du jour, le chaton doit
 * rester sur l'humeur pleine de sa scene, pas basculer dans sa version fatiguee
 * parce qu'on n'a pas encore noté.
 */
const PAR_SCENE = {
  drift:    ['neutre',    'pensif'],
  brume:    ['pensif',    'fatigue'],
  abyss:    ['triste',    'triste'],
  eclipse:  ['inquiet',   'inquiet'],
  voidwell: ['fatigue',   'endormi'],
  monolith: ['serein',    'contrarie'],
  grain:    ['curieux',   'surpris'],
  mandel:   ['reflexion', 'inspire']
};

const SEUIL_BAS = 0.3;

/**
 * @param {string} scene    une scène de mood.js
 * @param {number} energie  0..1, readEnergy()
 * @returns {string}  une clé de HUMEURS
 */
export function humeurDe(scene, energie = 0.35) {
  const paire = PAR_SCENE[scene] ?? PAR_SCENE.drift;
  return energie < SEUIL_BAS ? paire[1] : paire[0];
}
