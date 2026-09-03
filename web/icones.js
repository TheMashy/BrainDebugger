/**
 * LES ICÔNES DU PRODUIT.
 *
 * Un seul trait pour toute l'application : 18 par 18, contour, jamais de
 * remplissage, 1.15 d'épaisseur, bouts ronds. C'est déjà la langue des glyphes
 * de scène et de celui d'Année — on la pose ici une bonne fois plutôt que de la
 * réinventer à chaque bouton.
 *
 * Elles ne décorent pas : chacune est le DESSIN de ce que fait le bouton. Un
 * œil pour lire, un crayon pour écrire, une corbeille pour effacer. Une icône
 * qu'il faut apprendre est une étiquette de plus, pas une de moins.
 *
 * La seule exception est « année » : une grille de journées colorées, remplie,
 * parce que c'est littéralement l'image de cette vue. Elle est aussi celle qui
 * apparaît dans Parler quand la note part — le même signe aux deux endroits,
 * sans qu'on ait à le dire.
 */

/* Le tracé de chaque icône, dans une boîte de 18. */
export const TRAITS = {
  /* ---- les vues ---- */
  // Parler : une bulle. Ce qu'on y fait tient dans ce dessin-là.
  parler:   '<path d="M3.5 3.2h11a1.9 1.9 0 0 1 1.9 1.9v5.2a1.9 1.9 0 0 1-1.9 1.9H7.4l-3.3 3v-3h-.6a1.9 1.9 0 0 1-1.9-1.9V5.1a1.9 1.9 0 0 1 1.9-1.9z"/>',
  // Moi : une tête et des épaules. La page parle de la personne, pas de ses données.
  moi:      '<circle cx="9" cy="6" r="3.1"/><path d="M3.5 15.4c0-3 2.5-4.6 5.5-4.6s5.5 1.6 5.5 4.6"/>',
  // Ma carte : trois nœuds et ce qui les relie. C'est la vue elle-même, en petit.
  carte:    '<circle cx="4.4" cy="12.6" r="1.9"/><circle cx="9.2" cy="4.4" r="1.9"/><circle cx="14" cy="11.2" r="1.9"/><path d="M5.5 10.9 8.2 6.1M10.6 5.6l2.3 3.9M6.3 12.2l5.9-.7"/>',
  // Réglages : deux curseurs. On y déplace des valeurs, on n'y engrène rien.
  reglages: '<path d="M2.6 6h6.6M12.9 6h2.5M2.6 12h2.5M9.2 12h6.2"/><circle cx="11" cy="6" r="1.7"/><circle cx="7.3" cy="12" r="1.7"/>',
  // Suivi : une feuille avec deux lignes ecrites et un coin plie. C'est un
  // DOCUMENT qu'on emporte -- pas un graphe, pas un tableau de bord.
  suivi:    '<path d="M4 2.6h6.2L14 6.4v9a1.4 1.4 0 0 1-1.4 1.4H4a1.4 1.4 0 0 1-1.4-1.4V4a1.4 1.4 0 0 1 1.4-1.4z"/><path d="M10 2.7v3.6h3.7"/><path d="M5.4 10.2h5.2M5.4 13h3.4"/>',

  /* ---- les gestes ---- */
  oeil:     '<path d="M1.7 9s2.8-4.7 7.3-4.7S16.3 9 16.3 9s-2.8 4.7-7.3 4.7S1.7 9 1.7 9z"/><circle cx="9" cy="9" r="1.9"/>',
  refaire:  '<path d="M15 9A6 6 0 1 1 12.9 4.4"/><path d="M15.4 2.9v3.7h-3.7"/>',
  crayon:   '<path d="M12.6 2.6a1.7 1.7 0 0 1 2.4 2.4l-8.6 8.6-3.2.8.8-3.2z"/><path d="M11.4 3.8l2.4 2.4"/>',
  ranger:   '<path d="M9 2.8v7.2"/><path d="M6.2 7.4 9 10.2l2.8-2.8"/><path d="M3.2 11.8v1.8a1.4 1.4 0 0 0 1.4 1.4h8.8a1.4 1.4 0 0 0 1.4-1.4v-1.8"/>',
  sortir:   '<path d="M9 10.2V3"/><path d="M6.2 5.6 9 2.8l2.8 2.8"/><path d="M3.2 11.8v1.8a1.4 1.4 0 0 0 1.4 1.4h8.8a1.4 1.4 0 0 0 1.4-1.4v-1.8"/>',
  valider:  '<path d="M3.4 9.3 7.2 13l7.4-8"/>',
  fermer:   '<path d="M4.6 4.6 13.4 13.4M13.4 4.6 4.6 13.4"/>',
  loupe:    '<circle cx="7.9" cy="7.9" r="4.9"/><path d="M11.5 11.5 15.3 15.3"/>',
  partir:   '<path d="M7.2 15.2H4.3a1.4 1.4 0 0 1-1.4-1.4V4.2a1.4 1.4 0 0 1 1.4-1.4h2.9"/><path d="M11.5 12.1 14.8 9l-3.3-3.1"/><path d="M14.8 9H6.7"/>',
  corbeille:'<path d="M3.2 5.1h11.6"/><path d="M6.8 5.1V3.8a1 1 0 0 1 1-1h2.4a1 1 0 0 1 1 1v1.3"/><path d="M4.8 5.1l.6 9a1.2 1.2 0 0 0 1.2 1.1h4.8a1.2 1.2 0 0 0 1.2-1.1l.6-9"/>',
  cle:      '<circle cx="5.4" cy="12.1" r="2.8"/><path d="M7.4 10.1 14.8 2.7"/><path d="M12.3 5.2l1.7 1.7M10.7 6.8l1.7 1.7"/>',
  epingle:  '<path d="M9 15.4V9.9"/><circle cx="9" cy="6.3" r="3.4"/>',
  fleche:   '<path d="M3.2 9h10.4"/><path d="M10.2 5.4 13.8 9l-3.6 3.6"/>',
  point:    '<circle cx="9" cy="9" r="5.6"/><circle cx="9" cy="9" r="1.7" fill="currentColor" stroke="none"/>',
  moins:    '<path d="M4.2 9h9.6"/>',
  plus:     '<path d="M9 4.2v9.6M4.2 9h9.6"/>',
  // Antenne : un point et deux ondes qui en partent. Ce qui ARRIVE d'ailleurs
  // -- une montre, une balance, un telephone qui pousse ce qu'il a mesure.
  antenne:  '<circle cx="5" cy="13" r="1.6" fill="currentColor" stroke="none"/><path d="M8.8 13a3.8 3.8 0 0 0-3.8-3.8"/><path d="M13.2 13A8.2 8.2 0 0 0 5 4.8"/>',
  // Alerte : un triangle et un point d'exclamation. Le SEUL signe d'alarme du
  // produit. Il ne s'allume que sur ce que la personne a ecrit elle-meme, et il
  // montre toujours la phrase qui l'a declenche -- jamais un verdict de machine
  // (voir veille.js). Une crise qui ne laisse pas de trace passe entre les
  // mailles du filet, et c'est exactement ce qu'on refuse ici.
  alerte:   '<path d="M9 3.1 15.7 15H2.3z"/><path d="M9 7.4v3.4"/><circle cx="9" cy="12.9" r=".6" fill="currentColor" stroke="none"/>',

  /* ---- la nuit ----
     Deux bornes, et rien entre les deux. Une lune pour le coucher, un soleil
     pour le lever : ce sont les seuls dessins que personne n'a besoin
     d'apprendre, et ils remplacent deux mots qu'on relisait chaque matin. */
  lune:     '<path d="M14.6 11.4A6.3 6.3 0 0 1 6.6 3.4a6.3 6.3 0 1 0 8 8z"/>',
  soleil:   '<circle cx="9" cy="9" r="3.3"/><path d="M9 1.7v1.7M9 14.6v1.7M1.7 9h1.7M14.6 9h1.7M3.8 3.8l1.2 1.2M13 13l1.2 1.2M14.2 3.8 13 5M5 13l-1.2 1.2"/>',

  /* ---- la journee d'ordinateur ----
     UNE FORME D'USAGE, PAS UNE PERSONNE. Ces cinq dessins tiennent la meme
     ligne que le reste du fichier : ils montrent ce que la machine a compte --
     un ecran qu'on fait defiler, une loupe, une cible, deux tetes, une pause.
     Aucun ne porte de jugement, et c'est la condition pour qu'ils existent. */
  defiler:  '<rect x="5.2" y="1.9" width="7.6" height="14.2" rx="1.7"/><path d="M9 5.3v6.2"/><path d="M6.9 9.4 9 11.5l2.1-2.1"/>',
  cible:    '<circle cx="9" cy="9" r="6.3"/><circle cx="9" cy="9" r="3"/><circle cx="9" cy="9" r=".95" fill="currentColor" stroke="none"/>',
  gens:     '<circle cx="6.9" cy="6.1" r="2.6"/><path d="M2.4 15.1c0-2.6 2-4.2 4.5-4.2s4.5 1.6 4.5 4.2"/><path d="M12.4 4a2.6 2.6 0 0 1 0 5.2"/><path d="M13.5 11.2c1.4.5 2.4 1.7 2.4 3.9"/>',
  pause:    '<path d="M6.9 4.3v9.4M11.1 4.3v9.4"/>',

  /* ---- ce qu'on consulte ----
     Les familles de contextes qu'une application d'activite envoie. Elles ne
     sont dessinees que pour tenir en 12 pixels a cote d'une duree : un globe,
     des chevrons, un ecran de lecture, une manette, une note. */
  globe:    '<circle cx="9" cy="9" r="6.4"/><path d="M2.6 9h12.8"/><path d="M9 2.6a10 10 0 0 1 0 12.8a10 10 0 0 1 0-12.8z"/>',
  code:     '<path d="M6.2 5.6 2.6 9l3.6 3.4M11.8 5.6 15.4 9l-3.6 3.4"/><path d="M10.3 3.7 7.7 14.3"/>',
  video:    '<rect x="1.9" y="4.2" width="10.2" height="9.6" rx="1.6"/><path d="M12.1 8.2l4-2.3v6.2l-4-2.3z"/>',
  jeu:      '<rect x="1.9" y="5.6" width="14.2" height="6.8" rx="2.6"/><path d="M5.7 8.2v2.4M4.5 9.4h2.4"/><circle cx="12" cy="9" r=".95" fill="currentColor" stroke="none"/><circle cx="14" cy="10.6" r=".95" fill="currentColor" stroke="none"/>',
  musique:  '<path d="M6.6 13.2V4.5l7.6-1.7v8.7"/><ellipse cx="4.6" cy="13.4" rx="2" ry="1.7"/><ellipse cx="12.2" cy="11.5" rx="2" ry="1.7"/>'
};

/*
 * ANNÉE EST REMPLIE, ET C'EST VOULU.
 *
 * Les autres icônes sont des traits ; celle-ci est une grille de journées, avec
 * ses trous. C'est le dessin exact de ce qu'on va voir en cliquant — l'icône
 * n'apprend rien à personne, elle montre. Elle vient de Parler, où elle
 * accompagne « noté dans Année » : le même signe aux deux endroits, sans qu'on
 * ait besoin de faire le lien à voix haute.
 */
export const ANNEE = (t = 12) => `<svg viewBox="0 0 16 16" width="${t}" height="${t}"
  fill="currentColor" aria-hidden="true" focusable="false" class="ico"><rect x="1" y="1" width="3.4" height="3.4" rx=".8"/><rect x="6.3" y="1" width="3.4" height="3.4" rx=".8"/><rect x="11.6" y="1" width="3.4" height="3.4" rx=".8" opacity=".45"/><rect x="1" y="6.3" width="3.4" height="3.4" rx=".8" opacity=".45"/><rect x="6.3" y="6.3" width="3.4" height="3.4" rx=".8"/><rect x="11.6" y="6.3" width="3.4" height="3.4" rx=".8"/><rect x="1" y="11.6" width="3.4" height="3.4" rx=".8"/><rect x="6.3" y="11.6" width="3.4" height="3.4" rx=".8" opacity=".45"/><rect x="11.6" y="11.6" width="3.4" height="3.4" rx=".8"/></svg>`;

/**
 * UNE ICÔNE, PRÊTE À POSER.
 *
 * `aria-hidden` sans condition : à côté d'un mot elle le répète, et un lecteur
 * d'écran qui lit « crayon Écrire » fait perdre du temps à qui n'a que ça. Un
 * bouton sans texte porte son nom dans `aria-label`, pas dans son icône.
 *
 * @param {string} nom  une clé de TRAITS, ou « annee »
 * @param {number} t    la taille en pixels, côté
 */
export function ico(nom, t = 13) {
  if (nom === 'annee') return ANNEE(t);
  const d = TRAITS[nom];
  if (!d) return '';
  return `<svg viewBox="0 0 18 18" width="${t}" height="${t}" fill="none" stroke="currentColor"
    stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false" class="ico">${d}</svg>`;
}

/** L'icône de chaque onglet. Le nom de la vue est la clé employée partout ailleurs. */
export const ICO_VUE = {
  tonight: 'parler', moi: 'moi', mirror: 'carte', year: 'annee',
  recherche: 'loupe', settings: 'reglages'
};

/**
 * L'ICÔNE D'UNE FORME DE JOURNÉE D'ORDINATEUR.
 *
 * Les clés sont celles du serveur (`ARCHETYPES`), pas des noms d'affichage :
 * un nom lisible peut être réécrit un jour, la clé non. Une clé sans icône ne
 * casse rien — `ico()` rend une chaîne vide, et il reste le nom.
 *
 * L'icône ne remplace pas le nom, elle le devance : « navigation continue »
 * reste écrit à côté. Un dessin seul serait une étiquette qu'il faut apprendre,
 * et ce fichier dit depuis le début qu'on n'en veut pas.
 */
export const ICO_ARCHETYPE = {
  doomscroll: 'defiler', curieux: 'loupe', productif: 'cible',
  social: 'gens', repose: 'pause'
};

/**
 * L'ICÔNE D'UNE FAMILLE DE CONTEXTES — ce qu'on a consulté.
 *
 * `autre` a la sienne, et c'est voulu : c'est le temps qu'on n'a PAS su ranger,
 * il a le droit d'être vu comme les autres. Le masquer ferait des parts qui ne
 * font pas le total, sans rien dire de pourquoi.
 */
export const ICO_FAMILLE = {
  nav: 'globe', travail: 'code', social: 'gens',
  video: 'video', jeu: 'jeu', musique: 'musique', autre: 'point'
};
