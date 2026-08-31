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
  plus:     '<path d="M9 4.2v9.6M4.2 9h9.6"/>'
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
  tonight: 'parler', moi: 'moi', mirror: 'carte', year: 'annee', settings: 'reglages'
};
