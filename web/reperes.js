/**
 * Les reperes, et l'icone qui va avec.
 *
 * Un repere est un fait date qui change le sol sous les journees : un
 * demenagement, un debut de traitement, une rupture, un deces. Ce n'est ni une
 * humeur ni un jugement -- c'est ce qui explique pourquoi une moyenne bouge
 * sans qu'on ait rien fait de mal.
 *
 * POURQUOI CE FICHIER EST DANS web/ ET PAS DANS server/
 * Le serveur l'importe aussi. Le theme doit etre le meme des deux cotes : le
 * compagnon pose un repere et l'interface doit lui donner exactement la meme
 * icone, sinon la carte qu'il annonce n'est pas celle qui s'affiche. Et le
 * champ de saisie montre l'icone PENDANT la frappe -- ce qui exige le
 * classement dans le navigateur. Un seul fichier, aucune divergence possible.
 * Il ne touche pas au DOM : c'est du texte qui entre, un nom de theme qui sort.
 *
 * SUR LE CLASSEMENT
 * Il est volontairement grossier et il se trompera. Se tromper d'icone est sans
 * consequence : personne n'a ete etiquete, le mot ecrit reste le mot ecrit, et
 * l'icone n'entre dans aucun calcul. C'est de la signaletique, pas de la
 * semantique -- exactement comme le decor du fond.
 */

const norm = s => String(s ?? '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').toLowerCase();

/*
 * Chaque theme est une liste de racines. On cherche le mot entier ou le mot
 * suivi d'une terminaison, jamais la sous-chaine : sinon « mort » se declenche
 * sur « amortir » et « pret » sur « pretendre ».
 *
 * L'ordre compte. Le premier theme qui gagne l'emporte a egalite, et les plus
 * specifiques passent devant : « rupture » avant « amour », « deuil » avant
 * « sante », sans quoi une separation devient un coeur.
 */
export const THEMES = [
  ['deuil',   'deces mort morte morts enterrement funerailles cimetiere disparu disparue perdu perte deuil veuve veuf'],
  ['rupture', 'rupture rompu separation separe separee divorce divorcee quitte quittee largue plaque'],
  ['soin',    'traitement medicament medicaments antidepresseur antidepresseurs anxiolytique anxiolytiques anxio anxios benzo benzos cachet cachets comprime comprimes ordonnance dose dosage posologie sevrage therapie psy psychiatre psychologue psychotherapie suivi seance hospitalisation lithium somnifere'],
  ['sante',   'hopital operation operee opere diagnostic maladie malade urgences blessure blesse fracture covid accident convalescence reeducation'],
  ['travail', 'boulot travail job emploi embauche embauchee cdi cdd demission demissionne licenciement licencie poste promotion entretien stage alternance freelance mission client boite entreprise chomage'],
  ['etudes',  'diplome examen concours rentree fac faculte universite ecole master licence these soutenance memoire bac partiels formation certification'],
  ['maison',  'demenagement demenage emmenage appartement appart logement maison colocation coloc studio loyer bail installe installee'],
  ['voyage',  'voyage vacances sejour depart parti partie avion train road trip escapade weekend croisiere expatriation'],
  ['famille', 'naissance ne nee bebe enfant fille fils grossesse enceinte mariage marie mariee pacs pacse famille parents mere pere frere soeur'],
  ['amour',   'rencontre rencontre amour amoureux amoureuse couple ensemble relation histoire date fiancailles fiance'],
  ['ami',     'ami amis amie amies soiree retrouvailles groupe bande copain copains'],
  ['argent',  'salaire augmentation prime dette credit pret banque impots budget facture argent economies achat vendu'],
  ['sport',   'marathon course semi trail salle entrainement competition match club licence velo natation escalade'],
  ['creation','projet sortie lancement publication album livre jeu video film expo exposition concert scene chaine site lance']
];

const COMPILES = THEMES.map(([nom, mots]) => [
  nom,
  norm(mots).split(/\s+/).filter(Boolean)
]);

/** Le theme par defaut : un fait date, sans categorie. */
export const DEFAUT = 'jalon';

/**
 * @param {string} label  ce que la personne (ou le compagnon) a ecrit
 * @returns {string}  un nom de theme, toujours present dans ICONES
 */
export function themeDe(label) {
  const t = ' ' + norm(label).replace(/[^a-z0-9]+/g, ' ') + ' ';
  let gagnant = DEFAUT, meilleur = 0;
  for (const [nom, racines] of COMPILES) {
    let score = 0;
    for (const r of racines) {
      // racine + terminaison possible, bornee des deux cotes
      if (new RegExp(`(^| )${r}(e?s?)( |$)`).test(t)) score++;
    }
    if (score > meilleur) { meilleur = score; gagnant = nom; }
  }
  return gagnant;
}

/*
 * Les icones. Traits seuls, sans remplissage, dessinees sur une grille de 24 :
 * elles se posent a cote d'un mot et ne doivent pas peser plus que lui. Des
 * emoji auraient coute trois lignes de code et fait basculer toute
 * l'application dans un autre registre.
 *
 * `currentColor` partout : c'est la couleur de la note du jour qui les teinte,
 * la meme echelle qu'ailleurs.
 */
export const ICONES = {
  jalon:    '<path d="M12 3.5 20.5 12 12 20.5 3.5 12z"/>',
  deuil:    '<path d="M12 3c1.8 2 2.6 3.4 2.6 4.7A2.6 2.6 0 0 1 12 10.3a2.6 2.6 0 0 1-2.6-2.6C9.4 6.4 10.2 5 12 3z"/><path d="M12 10.5V14"/><path d="M7 21v-3.4a5 5 0 0 1 10 0V21z"/>',
  rupture:  '<path d="M12 20.3 4.8 13a4.4 4.4 0 0 1 6.2-6.2l.4.4"/><path d="M12.6 7.2l.4-.4A4.4 4.4 0 0 1 19.2 13L12 20.3"/><path d="M13.4 8.6 10.6 11l3.2 2.2-2.6 2.6"/>',
  soin:     '<rect x="2.6" y="9" width="18.8" height="6" rx="3" transform="rotate(-40 12 12)"/><path d="M9.4 8.2 15.8 14.6"/>',
  sante:    '<path d="M3 12.5h3.6l1.8-4.2 3 9.4 2.4-6.4 1.5 3.4H21"/>',
  travail:  '<rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3 12.5h18"/>',
  etudes:   '<path d="M12 4 22 9l-10 5L2 9z"/><path d="M6 11v5c0 1.4 2.7 2.6 6 2.6s6-1.2 6-2.6v-5"/>',
  maison:   '<path d="M3.5 11 12 4l8.5 7"/><path d="M5.6 9.4V20h12.8V9.4"/><path d="M10 20v-5.2h4V20"/>',
  voyage:   '<path d="M3 14.5 6 13l4.3 1.3 5-9a1.8 1.8 0 0 1 3.3 1.4l-2.4 8.7 3.3 1a1 1 0 0 1 .1 1.9L9 21l-2.2-3.4L3 16.4z"/>',
  famille:  '<circle cx="8" cy="7.6" r="2.8"/><circle cx="16.6" cy="9" r="2.2"/><path d="M2.8 19.5a5.2 5.2 0 0 1 10.4 0"/><path d="M14.6 19.5a4.2 4.2 0 0 1 6.6-3.4"/>',
  amour:    '<path d="M12 20.3 4.8 13a4.4 4.4 0 1 1 7.2-5 4.4 4.4 0 1 1 7.2 5z"/>',
  ami:      '<circle cx="7.4" cy="8.4" r="2.6"/><circle cx="16.6" cy="8.4" r="2.6"/><path d="M2.6 19.4a4.9 4.9 0 0 1 9.6 0"/><path d="M11.8 19.4a4.9 4.9 0 0 1 9.6 0"/>',
  argent:   '<circle cx="12" cy="12" r="8.2"/><path d="M14.6 9.2a3 3 0 0 0-2.6-1.3c-1.6 0-2.6.9-2.6 2.1 0 3 5.4 1.6 5.4 4.5 0 1.3-1.1 2.2-2.8 2.2a3.2 3.2 0 0 1-2.8-1.5"/><path d="M12 6.2v11.6"/>',
  sport:    '<circle cx="15.4" cy="5.2" r="1.9"/><path d="M6 21l2.8-5 3-2.2-1.4-4.2 3.4-1.6 2 3.4 3.4 1"/><path d="M10.4 11.6 6.6 12.4 5 15.6"/>',
  creation: '<path d="M12 3.2 13.9 9l5.9 1.9-5.9 1.9L12 18.6l-1.9-5.8L4.2 10.9 10.1 9z"/><path d="M18.4 16.6l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8z" opacity=".55"/>'
};

/** Les noms lisibles, pour les infobulles et le champ de saisie. */
export const NOMS = {
  jalon: 'jalon', deuil: 'deuil', rupture: 'rupture', soin: 'traitement',
  sante: 'santé', travail: 'travail', etudes: 'études', maison: 'logement',
  voyage: 'voyage', famille: 'famille', amour: 'rencontre', ami: 'amis',
  argent: 'argent', sport: 'sport', creation: 'création'
};

/**
 * Le SVG pret a poser. `taille` en pixels ; le trait s'affine quand l'icone
 * grandit pour que le poids visuel reste constant.
 */
export function icone(theme, taille = 18) {
  const d = ICONES[theme] ?? ICONES[DEFAUT];
  const trait = taille >= 30 ? 1.3 : taille >= 22 ? 1.5 : 1.65;
  return `<svg class="ricone" viewBox="0 0 24 24" width="${taille}" height="${taille}"
    fill="none" stroke="currentColor" stroke-width="${trait}"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/** Raccourci : du texte brut a l'icone. */
export const iconeDe = (label, taille) => icone(themeDe(label), taille);
