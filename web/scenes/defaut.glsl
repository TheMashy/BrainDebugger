// ===== drift =====
// La scene par defaut : celle qu'on voit quand rien ne ressort du texte, et
// celle qui tient les neuf dixiemes du temps. Elle doit donc etre la plus
// discrete des sept -- un champ d'etoiles tres faible, deux nappes de brume qui
// derivent lentement, et rien d'autre. C'est le detachement : on regarde loin.
//
// Lumiere : aucune source ponctuelle. La clarte vient des nappes elles-memes,
// diffuse, plus dense vers le bas.
// e : la vitesse de derive et la densite des nappes. A 0 c'est presque fixe.

// Etoiles : une grille tramee, une etoile par cellule au plus, position et
// luminosite tirees de la cellule. Pas de scintillement -- une etoile qui
// clignote dans le champ peripherique accroche l'oeil toutes les secondes, et
// c'est exactement ce qu'on ne veut pas derriere du texte.
float drift_stars(vec2 p) {
  vec2 g = floor(p);
  vec2 f = fract(p);
  float h = hash21(g);
  if (h < 0.82) return 0.0;                       // la plupart des cellules sont vides
  vec2 c = vec2(hash21(g + 11.3), hash21(g + 27.1));
  float d = length(f - c);
  float mag = 0.35 + 0.65 * hash21(g + 41.7);
  return mag * smoothstep(0.055, 0.0, d);
}

// Nappe de brume : deux octaves suffisent, on cherche une masse molle et pas
// une texture. Le decalage sur y evite que les deux nappes se superposent.
float drift_veil(vec2 p, float t, float sp, float off) {
  vec2 q = p * 1.15 + vec2(t * sp, off);
  float n = fbm(q, 2);
  n = smoothstep(0.42, 0.92, n);
  return n;
}

vec3 scene_drift(vec2 uv, float t, float e) {
  float sp = 0.006 + 0.014 * e;                   // derive : tres lente, meme a fond

  // Le ciel : un degrade qui s'eclaircit vers le bas, jamais vers le haut. Le
  // haut de l'ecran se perd dans le noir, c'est ce qui donne la profondeur.
  float bas = smoothstep(0.9, -1.0, uv.y);
  vec3 col = vec3(0.012, 0.016, 0.021) * bas;

  // Etoiles, sur deux echelles pour eviter la regularite de la grille.
  vec2 sp1 = uv * 9.0 + vec2(t * sp * 0.5, 0.0);
  vec2 sp2 = uv * 17.0 + vec2(t * sp * 0.28, 3.7);
  float st = drift_stars(sp1) * 0.9 + drift_stars(sp2) * 0.5;
  // Elles s'eteignent vers le bas : la brume les mange, ce qui pose le plan.
  st *= smoothstep(-1.1, 0.35, uv.y);
  col += vec3(0.10, 0.11, 0.125) * st;

  // Deux nappes, l'une derriere l'autre.
  float v1 = drift_veil(uv * vec2(0.85, 1.6), t, sp, 0.0);
  float v2 = drift_veil(uv * vec2(0.55, 1.2), t, -sp * 0.62, 9.4);
  float dens = 0.35 + 0.45 * e;
  col += vec3(0.052, 0.058, 0.070) * v1 * dens * bas;
  col += vec3(0.034, 0.038, 0.050) * v2 * dens * 0.8;

  // Un tres leger assombrissement des bords : ca ferme le cadre sans qu'on
  // remarque une vignette.
  float r = length(uv * vec2(0.55, 0.85));
  col *= 1.0 - 0.22 * smoothstep(0.6, 1.6, r);

  return col;
}
