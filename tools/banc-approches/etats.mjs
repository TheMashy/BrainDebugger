/*
 * LA DISCRÉTISATION, PARTAGÉE PAR LA VÉRITÉ TERRAIN ET PAR LES MÉTHODES.
 *
 * Un seuil d'état enfoui dans une méthode définit en douce la vérité : on le
 * sort ici, une fois. Les états d'humeur et d'énergie sont RELATIFS à la
 * personne (son quintile bas), parce qu'une journée à 5 est basse chez qui
 * tourne à 7 et haute chez qui tourne à 3 ; les états de capteur sont absolus.
 * L'ordre canonique fixe la lecture de deux états tombés le même jour.
 */
export const ORDRE = ['declencheur', 'surcharge', 'social', 'anxio', 'substance', 'dereel',
  'ecran_haut', 'coucher_tard', 'sommeil_court', 'energie_bas', 'humeur_bas', 'humeur_haut'];
export const SEUILS = { sommeil_court: 5.5, ecran_haut: 500, coucher_tard: 26, part: 0.25, fenetre: 2 };

/**
 * Un seuil « bas » tel que la part de jours ≤ seuil ne dépasse pas `part` :
 * avec des entiers, un quantile brut peut attraper 40 % des jours (égalités),
 * et un état trop fréquent fabrique des chaînes de hasard. Même chose en haut.
 */
function seuilBas(vals, part) {
  const v = vals.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 10) return null;
  let best = null;
  for (const u of [...new Set(v)]) { const frac = v.filter(x => x <= u).length / v.length; if (frac <= part) best = u; else break; }
  return best;
}
function seuilHaut(vals, part) {
  const v = vals.filter(x => x != null && Number.isFinite(x)).sort((a, b) => b - a);
  if (v.length < 10) return null;
  let best = null;
  for (const u of [...new Set(v)]) { const frac = v.filter(x => x >= u).length / v.length; if (frac <= part) best = u; else break; }
  return best;
}

/** Les états de chaque jour, dans l'ordre canonique. Une valeur null ne produit aucun état. */
export function etatsDe(jours) {
  const qb = seuilBas(jours.map(j => j.humeur), SEUILS.part);
  const qh = seuilHaut(jours.map(j => j.humeur), SEUILS.part);
  const qe = seuilBas(jours.map(j => j.energie), SEUILS.part);
  return jours.map(j => {
    const s = [];
    for (const k of ['declencheur', 'surcharge', 'social', 'anxio', 'substance', 'dereel'])
      if (j[k] === 1) s.push(k);
    if (j.ecran_min != null && j.ecran_min >= SEUILS.ecran_haut) s.push('ecran_haut');
    if (j.coucher != null && j.coucher >= SEUILS.coucher_tard) s.push('coucher_tard');
    if (j.sommeil_h != null && j.sommeil_h < SEUILS.sommeil_court) s.push('sommeil_court');
    if (j.energie != null && qe != null && j.energie <= qe) s.push('energie_bas');
    if (j.humeur != null && qb != null && j.humeur <= qb) s.push('humeur_bas');
    if (j.humeur != null && qh != null && j.humeur >= qh && qh > qb) s.push('humeur_haut');
    return s;
  });
}

/**
 * Compter les occurrences d'une chaîne ordonnée dans une fenêtre de `fenetre`
 * jours : chaque maillon sur un jour ≥ le précédent (même jour permis, dans
 * l'ordre canonique), occurrences non chevauchantes, ancrées au premier maillon.
 */
export function compterChaine(etats, chaine, fenetre = SEUILS.fenetre) {
  let n = 0, t = 0;
  const pos = s => ORDRE.indexOf(s);
  while (t < etats.length) {
    if (!etats[t].includes(chaine[0])) { t++; continue; }
    // essai d'apparier depuis t
    let jour = t, idx = pos(chaine[0]), ok = true;
    for (let k = 1; k < chaine.length; k++) {
      let trouve = false;
      for (let d = jour; d < Math.min(etats.length, t + fenetre); d++) {
        const cand = etats[d];
        const i = cand.indexOf(chaine[k]);
        if (i < 0) continue;
        if (d === jour && pos(chaine[k]) <= idx) continue;   // même jour : ordre canonique
        jour = d; idx = pos(chaine[k]); trouve = true; break;
      }
      if (!trouve) { ok = false; break; }
    }
    if (ok) { n++; t = jour + 1; } else t++;
  }
  return n;
}

/** Le taux de base d'un état dans une fenêtre de `fenetre` jours. */
export function tauxFenetre(etats, s, fenetre = SEUILS.fenetre) {
  let n = 0; const T = etats.length;
  for (let d = 0; d < T; d++) for (let k = d; k < Math.min(T, d + fenetre); k++) if (etats[k].includes(s)) { n++; break; }
  return n / T;
}
/** Le lift de chaque maillon d'une chaîne : confiance(préfixe → maillon) / taux de base du maillon. */
export function liftsMaillons(etats, chaine, fenetre = SEUILS.fenetre) {
  const lifts = [];
  for (let k = 1; k < chaine.length; k++) {
    const sPrev = compterChaine(etats, chaine.slice(0, k), fenetre), s = compterChaine(etats, chaine.slice(0, k + 1), fenetre);
    lifts.push(sPrev ? (s / sPrev) / Math.max(tauxFenetre(etats, chaine[k], fenetre), 1e-6) : 0);
  }
  return lifts;
}
