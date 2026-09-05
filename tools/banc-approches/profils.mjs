/*
 * LES PROFILS : un tableau de paramètres par profil, TOUTES les variables.
 *
 * Chaque profil décrit les 13 variables (les non décrites prenaient une valeur
 * implicite, et une méthode aurait pu « reconnaître » un profil à la simple
 * présence d'une variable — ce qui n'est ni clinique ni discriminant). Les
 * valeurs viennent des critiques cliniques du cahier v0 ; leur source est le
 * commentaire en face. Les MÉCANISMES (chaînes, épisodes, couplages) sont
 * dans generateur.mjs — ce fichier ne porte que les lignes de base et la
 * spécification de la vérité terrain de chaque profil.
 */
export const PROFILS = {
  temoin: {
    humeur: { m: 6.5, sd: 1.0, phi: 0.30 }, energie: { m: 6.5, sd: 1.2, phi: 0.35 },
    sommeil: { m: 7.4, sd: 0.8 }, coucher: { m: 23.3, sd: 0.9 },
    p: { anxio: 0.03, substance: 0.10, social: 0.35, declencheur: 0.05, dereel: 0.005, surcharge: 0.02 },
    ecran: { m: 240, sd: 80 }, absolus: 0.02, weekend: 0.6,
    langage: -0.1,            // r attendu absolus↔humeur : bruit (une découverte ici est fausse)
  },
  depression: {
    humeur: { m: 3.5, sd: 1.1, phi: 0.65 }, energie: { m: 3.0, sd: 1.0, phi: 0.60 },
    sommeil: { m: 7.4, sd: 0.9 },            // remplacé par le sous-type (réveil précoce / hypersomnie)
    coucher: { m: 23.8, sd: 1.0 },
    p: { anxio: 0.08, substance: 0.20, social: 0.10, declencheur: 0.05, dereel: 0.01, surcharge: 0.02 },
    ecran: { m: 400, sd: 120 }, absolus: 0.02, weekend: 0.5, langage: -0.4,
  },
  anxiete: {
    humeur: { m: 6.0, sd: 1.5, phi: 0.45 }, energie: { m: 5.5, sd: 1.3, phi: 0.40 },
    sommeil: { m: 7.0, sd: 0.9 }, coucher: { m: 23.6, sd: 1.0 },
    p: { anxio: 0.10, substance: 0.10, social: 0.30, declencheur: 0.15, dereel: 0.02, surcharge: 0.02 },
    ecran: { m: 300, sd: 100 }, absolus: 0.02, weekend: 0.5, langage: -0.25,   // sous le seuil : teste la spécificité
  },
  bipolarite: {
    humeur: { m: 6.0, sd: 1.0, phi: 0.35 }, energie: { m: 6.0, sd: 1.2, phi: 0.40 },
    sommeil: { m: 7.5, sd: 0.8 }, coucher: { m: 23.5, sd: 1.0 },
    p: { anxio: 0.04, substance: 0.15, social: 0.35, declencheur: 0.05, dereel: 0.01, surcharge: 0.02 },
    ecran: { m: 260, sd: 90 }, absolus: 0.02, weekend: 0.5, langage: -0.1,
  },
  tdah: {
    humeur: { m: 6.0, sd: 1.7, phi: 0.05 }, energie: { m: 5.5, sd: 1.8, phi: 0.05 },
    sommeil: { m: 6.5, sd: 1.6 }, coucher: { m: 25.0, sd: 1.9 },
    p: { anxio: 0.05, substance: 0.20, social: 0.35, declencheur: 0.10, dereel: 0.01, surcharge: 0.06 },
    ecran: { m: 320, sd: 120 }, absolus: 0.02, weekend: 0.5, langage: -0.1,
    hyperfocus: 0.12,
  },
  autisme: {
    humeur: { m: 6.5, sd: 0.7, phi: 0.40 }, energie: { m: 6.0, sd: 1.0, phi: 0.35 },
    sommeil: { m: 6.8, sd: 0.7 }, coucher: { m: 23.4, sd: 0.5 },
    p: { anxio: 0.05, substance: 0.05, social: 0.12, declencheur: 0.08, dereel: 0.01, surcharge: 0.12 },
    ecran: { m: 350, sd: 60 }, absolus: 0.02, weekend: 0.0, langage: -0.1,   // pas de bonus week-end
  },
  derealisation: {
    humeur: { m: 5.5, sd: 1.3, phi: 0.40 }, energie: { m: 5.5, sd: 1.2, phi: 0.40 },
    sommeil: { m: 6.4, sd: 1.3 }, coucher: { m: 24.5, sd: 1.4 },
    p: { anxio: 0.10, substance: 0.25, social: 0.25, declencheur: 0.12, dereel: 0.03, surcharge: 0.02 },
    ecran: { m: 380, sd: 150 }, absolus: 0.02, weekend: 0.5, langage: -0.1,
  },
  /* Profil de CALIBRATION, jamais testé : ses fonctionnements ne sont pas
     ceux des profils jugés, pour que les seuils n'apprennent pas la réponse. */
  calib_mixte: {
    humeur: { m: 5.8, sd: 1.2, phi: 0.50 }, energie: { m: 5.8, sd: 1.2, phi: 0.45 },
    sommeil: { m: 7.0, sd: 1.0 }, coucher: { m: 24.0, sd: 1.7 },
    p: { anxio: 0.06, substance: 0.15, social: 0.30, declencheur: 0.12, dereel: 0.01, surcharge: 0.03 },
    ecran: { m: 300, sd: 100 }, absolus: 0.02, weekend: 0.5, langage: -0.1,
  },
};
export const PROFILS_TEST = ['temoin', 'depression', 'anxiete', 'bipolarite', 'tdah', 'autisme', 'derealisation'];
export const PROFILS_CALIB = ['temoin', 'calib_mixte'];
