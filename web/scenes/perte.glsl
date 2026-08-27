// =====================================================================
//  PERTE - deux scenes de manque : eclipse, voidwell
//
//  Meme main pour les deux : la meme brume exponentielle mange la
//  lumiere avec la distance, la meme gamme de gris froids (l'encre du
//  ciel) et le meme blanc a peine tiede pour l'unique source, la meme
//  lenteur (tout se compte en dizaines de secondes).
// =====================================================================


// ---------------------------------------------------------------------
//  ECLIPSE
//  Un disque noir devant une source cachee, un filet de lumiere autour
//  de lui, et au-dessous une mer sombre qui en porte un chemin de
//  reflets brises. Il y a une lumiere, elle est derriere quelque chose.
// ---------------------------------------------------------------------

// attenuation par la brume : la meme courbe sert a la mer, au halo et
// au vignettage. C'est elle qui donne le grain commun aux deux scenes.
float eclipse_fog(float d) {
    return exp(-d * d * 0.55 - d * 0.35);
}

// l'encre du ciel : le haut se perd dans le noir, le bas garde un
// reste de matiere
vec3 eclipse_ink(float y) {
    return mix(vec3(0.016, 0.018, 0.023),
               vec3(0.002, 0.002, 0.004),
               smoothstep(-0.35, 1.05, y));
}

// la seule couleur de lumiere autorisee : un blanc gris a peine tiede
vec3 eclipse_light() {
    return vec3(0.255, 0.243, 0.216);
}

// les eclats sur l'eau : une phase de houle deformee par le bruit, si
// bien que les cretes restent des lignes au lieu de se dissoudre en
// taches, et un second bruit qui les casse en tirets - rien n'est
// continu sur l'eau. det coupe le detail au loin pour que l'horizon ne
// scintille pas ; le temps recu ici est deja ralenti par e, a e = 0 la
// mer est presque figee.
float eclipse_glint(vec2 w, float t, float det, float e) {
    float warp = fbm(vec2(w.x * 0.30, w.y * 0.28 - t * 0.030), 3);
    float c = max(sin(w.y * 4.20 + warp * 3.0 - t * 0.090), 0.0);
    float c2 = c * c;
    float crest = c2 * c;
    float lo = 0.40 + 0.12 * (1.0 - e);
    float dash = smoothstep(lo, lo + 0.32,
                 fbm(vec2(w.x * 2.00, w.y * 0.34 - t * 0.045), 2));
    return crest * dash * det;
}

vec3 scene_eclipse(vec2 uv, float t, float e) {
    float hz = -0.08;                 // ligne d'horizon, sous le texte
    vec2  c  = vec2(-0.24, 0.52);     // le disque, haut et decentre
    float R  = 0.16;                  // rayon du disque noir

    vec2  d  = uv - c;
    float r  = length(d);
    float a  = atan(d.y + 0.000001, d.x + 0.000001);

    // ciel
    vec3 col = eclipse_ink(uv.y);

    // nappes de brume hautes, tres lentes, a peine lisibles, plus
    // denses en approchant de l'horizon
    float veil = fbm(vec2(uv.x * 0.55 + t * 0.008, uv.y * 1.30 - t * 0.004), 3);
    col += vec3(0.012, 0.013, 0.017) * veil * smoothstep(0.75, -0.15, uv.y);

    // irregularite de l'anneau : la couronne n'est pas egale, elle
    // derive d'un tour de disque en une poignee de minutes
    float bead = smoothstep(0.20, 0.78,
                 fbm(vec2(cos(a), sin(a)) * 2.10
                     + t * (0.006 + 0.014 * e), 3));

    // couronne : une respiration de lumiere, jamais un halo franc,
    // et rien ne deborde a l'interieur du disque
    float outside = smoothstep(R - 0.006, R + 0.004, r);
    float corona  = exp(-max(r - R, 0.0) * 9.0) * 0.055
                  + exp(-max(r - R, 0.0) * 2.2) * 0.016;
    col += eclipse_light() * corona * (0.40 + 0.60 * bead) * outside;

    // le disque mange le ciel qu'il recouvre
    col *= 1.0 - 0.95 * smoothstep(R + 0.006, R - 0.002, r);

    // l'anneau : un filet. e l'epaissit d'un cheveu, pas davantage.
    float w    = 0.0070 + 0.0026 * e;
    float ring = smoothstep(w, w * 0.25, abs(r - R));
    col += eclipse_light() * ring * (0.35 + 0.65 * bead) * 0.92;

    // -- la mer -------------------------------------------------------
    // perspective simple : la profondeur explose vers l'horizon.
    // zz est une profondeur comprimee : la houle garde du grain pres du
    // bord bas sans se hacher en moire pres de l'horizon.
    float dy    = max(hz - uv.y, 0.0);
    float depth = min(0.16 / (dy + 0.012), 11.0);
    float zz    = pow(depth, 0.55) * 10.0;
    float det   = 1.0 / (1.0 + depth * depth * 0.55);
    float att   = eclipse_fog(depth * 0.42);
    vec2  wp    = vec2(uv.x * zz * 4.20, zz);

    // temps de la mer : e est l'amplitude du mouvement, pas la
    // luminosite. A e = 0 l'eau bouge a peine.
    float tw = t * (0.15 + 0.85 * e);

    // la colonne de reflets sous le disque : etroite a l'horizon,
    // largement etalee en bas d'ecran. e la fait deriver.
    float sig  = 0.045 + 0.42 * dy;
    float wob  = (fbm(vec2(uv.y * 2.60, tw * 0.050), 2) - 0.5)
               * (0.05 + 0.35 * e) * dy;
    float px   = (uv.x - c.x + wob) / sig;
    float path = exp(-px * px);

    float glint = eclipse_glint(wp, tw, det, e) * path * att;

    vec3 water = vec3(0.006, 0.007, 0.010) * (0.30 + 0.70 * att);
    water += eclipse_light() * (glint * (0.20 + 0.30 * e) + path * att * 0.030);

    float sea = smoothstep(hz + 0.004, hz - 0.004, uv.y);
    col = mix(col, water, sea);

    // la brume posee sur l'horizon, un peu plus dense sous la colonne :
    // c'est elle qui donne la silhouette de la scene
    float colonne = exp(-((uv.x - c.x) / 0.55) * ((uv.x - c.x) / 0.55));
    col += vec3(0.022, 0.025, 0.031)
         * exp(-abs(uv.y - hz) * 26.0) * (0.28 + 0.72 * colonne);

    // vignettage : la meme brume, appliquee a la distance au centre
    col *= eclipse_fog(max(length(uv) - 0.45, 0.0) * 0.85);

    return min(max(col, 0.0), vec3(0.26));
}


// ---------------------------------------------------------------------
//  VOIDWELL
//  Un puits circulaire vu de face. Des anneaux concentriques qui se
//  serrent vers un centre parfaitement noir, une lumiere qui rase la
//  paroi d'un seul cote, et des bords avales par la brume. Pas de fond.
//  C'est le vide : quand il n'y a rien a dire.
// ---------------------------------------------------------------------

// meme courbe d'attenuation que l'eclipse : profondeur, bords, tout
// s'eteint de la meme facon
float voidwell_fog(float d) {
    return exp(-d * d * 0.55 - d * 0.35);
}

// meme blanc a peine tiede que l'eclipse
vec3 voidwell_light() {
    return vec3(0.250, 0.240, 0.216);
}

// profil d'un anneau : un liseret fin mais doux, jamais une rayure.
// Cosinus eleve a la puissance neuf : ca reste lisse et ca ne moire pas
// quand les anneaux se resserrent.
float voidwell_band(float q) {
    float c = 0.5 + 0.5 * cos(6.2831853 * q);
    float c2 = c * c;
    float c4 = c2 * c2;
    return c4 * c4 * c;
}

vec3 scene_voidwell(vec2 uv, float t, float e) {
    // e fait tourner les anneaux : environ un degre par minute au repos,
    // cinq degres par minute au maximum. Rien de plus.
    float spin = t * (0.00035 + 0.00120 * e);

    vec2  p = uv * rot(spin);
    float r = length(uv);
    float a = atan(p.y + 0.000001, p.x + 0.000001);

    // la maconnerie n'est pas parfaite : les anneaux ondulent un peu,
    // et c'est cette irregularite qui rend la rotation perceptible
    float warp = fbm(vec2(cos(a), sin(a)) * 1.60 + 7.0, 3) - 0.5;
    float rr   = max(r * (1.0 + 0.100 * warp), 0.040);

    // coordonnee de profondeur : en 1/r, les anneaux se serrent
    // indefiniment vers le centre. Une respiration tres lente, pas un
    // defilement.
    float breath = 0.045 * sin(t * 0.055) * (0.30 + 0.70 * e);
    float q = 1.45 / rr + breath;

    float ring = voidwell_band(q);

    // la lumiere tombe d'en haut a gauche et ne prend que sur la paroi
    // opposee : un seul cote du puits existe, le reste est noir
    vec2  L   = normalize(vec2(-0.55, 0.84));
    vec2  dir = uv / max(r, 0.0001);
    float lit = 0.05 + 0.95 * pow(max(0.5 - 0.5 * dot(dir, L), 0.0), 2.6);

    // plus on descend dans le puits, plus la brume mange les anneaux
    float deep = voidwell_fog(q * 0.20);

    // le centre est parfaitement noir : le puits n'a plus de fond, et
    // c'est la que le texte se lit
    float core = smoothstep(0.10, 0.32, r);

    // les bords sont avales : pas de decor autour, juste l'extinction
    float edge = voidwell_fog(max(r - 0.35, 0.0) * 2.00);

    // le haut se perd, le bas garde un peu de matiere
    float grav = 0.30 + 0.70 * smoothstep(0.95, -0.35, uv.y);

    // salissures tres lentes sur la paroi, elles tournent avec elle
    float stain = 0.62 + 0.38
                * fbm(vec2(cos(a), sin(a)) * 2.40 + vec2(q * 0.28, 0.0), 3);

    vec3 col = voidwell_light()
             * (ring * lit * deep * core * edge * stain * grav) * 1.15;

    // poussiere de brume, absente au centre pour ne pas grisailler le
    // texte, avalee par les bords comme le reste
    float dust = fbm(vec2(uv.x * 0.90 + t * 0.006, uv.y * 0.90 - t * 0.004), 3);
    col += vec3(0.009, 0.010, 0.013) * dust * grav * edge * core;

    return min(max(col, 0.0), vec3(0.26));
}
