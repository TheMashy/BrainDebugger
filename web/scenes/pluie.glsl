// ===========================================================================
// pluie.glsl -- LA PLUIE
//
// Ce qui se relache. Pas la tristesse -- « eclipse » la porte deja, et une
// pluie qui voudrait dire « tu vas mal » serait un verdict peint sur le fond.
// Celle-ci dit le temps qui tombe : quelque chose sort, ca coule, et la piece
// est seche. C'est une scene ou l'on est A L'ABRI, ce qui est tout ce qu'elle
// affirme.
//
// Trois plans, comme on regarde vraiment la pluie : les gouttes proches et
// rapides, les moyennes, la nappe lointaine qui n'est plus qu'un voile. Et en
// bas, le sol mouille -- des ronds qui s'ouvrent et s'effacent, parce que
// c'est la qu'on voit qu'il pleut, pas dans le ciel.
//
// Cadre : uv.y de -0.5 en bas a +0.5 en haut. Le sol occupe le sixieme bas.
//
// e regle la DENSITE : une pluie fine ou une averse. Pas la luminosite --
// une averse n'est pas plus claire, elle est plus pleine.
// ===========================================================================

const float pluie_SOL = -0.33;   // la ligne du sol mouille

vec3 pluie_tone(vec3 c) {
    c = max(c, 0.0);
    return 0.27 * (1.0 - exp(-c / 0.27));
}

// Une nappe de traits qui tombent.
//
// L'astuce tient en deux lignes : on decoupe le plan en colonnes, chaque
// colonne recoit une phase et une vitesse tirees de son numero, et le trait
// vit dans le bas de sa cellule verticale. Une colonne sur trois environ porte
// une goutte -- une pluie ou chaque colonne coule est un rideau, pas une pluie.
float pluie_nappe(vec2 uv, float t, float ech, float vitesse, float seed, float densite)
{
    vec2 p = uv * ech;
    p.x += p.y * 0.13;                       // l'oblique : il ne pleut jamais droit
    float col = floor(p.x);
    float ph = hash11(col * 1.37 + seed * 57.3);
    // Une colonne sur trois porte une goutte, et le seuil descend quand ca
    // tombe plus fort.
    if (hash11(col * 2.11 + seed * 13.7) > densite) return 0.0;

    float y = fract(p.y * 0.62 - t * vitesse * (0.75 + 0.5 * ph) + ph);
    float x = fract(p.x) - 0.5;

    // Le trait : fin en travers, court dans le sens de la chute, avec une tete
    // plus dense que la queue.
    float largeur = smoothstep(0.5, 0.0, abs(x) * 11.0);
    float longueur = smoothstep(0.30, 0.0, y) * smoothstep(0.0, 0.05, y);
    return largeur * longueur * (0.55 + 0.45 * ph);
}

// Les ronds sur le sol. Six impacts qui se relancent chacun a leur rythme ;
// chaque rond s'ouvre en s'effacant, ce qui est ce que fait un rond dans une
// flaque. Ecrases verticalement : on regarde le sol de biais, pas d'au-dessus.
float pluie_ronds(vec2 uv, float t, float e)
{
    float s = 0.0;
    for (int i = 0; i < 9; i++) {
        float fi = float(i);
        float periode = 0.9 + hash11(fi * 7.3) * 1.4;
        float k = floor(t / periode + fi * 0.37);       // le numero de l'impact
        float age = fract(t / periode + fi * 0.37) * periode;

        // Chaque impact tombe ailleurs : la position vient du NUMERO, pas de
        // l'indice -- sinon les memes ronds reapparaissent toujours aux memes
        // endroits, et l'oeil le voit en dix secondes.
        vec2 c = vec2((hash11(k * 3.1 + fi * 19.0) - 0.5) * 1.8,
                      pluie_SOL - 0.012 - hash11(k * 5.7 + fi * 23.0) * 0.14);

        float r = length((uv - c) * vec2(1.0, 3.4));
        /*
         * PETITS ET BREFS. Grands et lents, ce sont des cercles dessines, pas
         * des impacts : on lit le trace au lieu de lire la pluie. Un rond de
         * goutte s'ouvre sur deux centiemes de cadre et a disparu en une
         * seconde -- c'est le NOMBRE qui fait la pluie, pas la taille.
         */
        float rayon = age * 0.026;
        // Le carre a la main : `pow` sur une base negative n'est pas defini en
        // GLSL, et `r - rayon` est negatif a l'interieur du rond.
        float dr = (r - rayon) * 150.0;
        float anneau = exp(-dr * dr);
        s += anneau * exp(-age * 3.4) * (0.6 + 0.4 * e);
    }
    return s;
}

vec3 scene_pluie(vec2 uv, float t, float e)
{
    // Gris froids, comme le reste de l'application, mais un peu plus bleus :
    // c'est la seule scene ou l'air lui-meme est mouille.
    vec3 ciel_haut = vec3(0.008, 0.011, 0.019);
    vec3 ciel_bas  = vec3(0.036, 0.046, 0.062);
    vec3 eau       = vec3(0.150, 0.176, 0.215);
    vec3 sol       = vec3(0.013, 0.016, 0.022);

    float densite = 0.26 + 0.22 * e;

    // ---- le ciel ----------------------------------------------------------
    float v = smoothstep(0.60, pluie_SOL, uv.y);
    vec3 col = mix(ciel_haut, ciel_bas, v * v);

    // Des nuages bas qui glissent. Tres etires, tres lents : ce qui donne
    // l'impression de pluie, ce n'est pas leur forme, c'est qu'ils bougent
    // tous ensemble et pas a la meme vitesse.
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float n = fbm(vec2(uv.x * (1.1 + fi * 0.6) + t * (0.016 + fi * 0.009) + fi * 31.0,
                           uv.y * 3.2 - t * 0.004 + fi * 7.0), 4);
        float bande = smoothstep(0.55, -0.10, uv.y - fi * 0.10);
        col += vec3(0.026, 0.031, 0.040) * bande * smoothstep(0.40, 0.85, n) * (0.9 - fi * 0.22);
    }

    // Une lueur diffuse en haut a gauche : une ville, une fenetre, on ne sait
    // pas. Sans elle, la pluie tombe dans du noir et ne se voit pas.
    float lueur = exp(-length((uv - vec2(-0.30, 0.30)) * vec2(0.7, 1.1)) * 2.1);
    col += vec3(0.052, 0.058, 0.070) * lueur;

    // ---- la pluie ---------------------------------------------------------
    // Trois plans. Le lointain est presque un voile, le proche a des traits
    // qu'on distingue. Le proche est aussi le plus rare : trop de gouttes
    // devant le texte et on ne lit plus.
    float p0 = pluie_nappe(uv, t, 46.0, 0.85, 1.0, densite * 1.20);   // loin
    float p1 = pluie_nappe(uv, t, 24.0, 1.35, 2.0, densite * 0.85);   // milieu
    float p2 = pluie_nappe(uv, t, 12.0, 2.10, 3.0, densite * 0.45);   // pres

    // Elle s'arrete au sol : une goutte qui traverse le sol n'est plus de la
    // pluie, c'est une rayure sur l'ecran.
    float auDessus = smoothstep(pluie_SOL - 0.01, pluie_SOL + 0.03, uv.y);
    float traits = (p0 * 0.30 + p1 * 0.52 + p2 * 0.80) * auDessus;
    col += eau * traits * (0.45 + 0.30 * e);

    // ---- le sol -----------------------------------------------------------
    /*
     * LE BORD NE DOIT PAS ETRE UN TRAIT. Ferme sur quelques millimes, la ligne
     * du sol traverse tout l'ecran comme un mur ; on la laisse donc respirer,
     * et une bande sombre juste au-dessus fait le pied de l'image.
     */
    float m = smoothstep(pluie_SOL + 0.016, pluie_SOL - 0.010, uv.y);
    col *= 1.0 - 0.30 * exp(-max(0.0, uv.y - pluie_SOL) * 26.0);
    // Le reflet : le ciel repris a l'envers, ecrase et assombri. C'est ce qui
    // fait que le sol est MOUILLE et pas seulement sombre.
    vec2 mir = vec2(uv.x, pluie_SOL - (uv.y - pluie_SOL) * 2.6);
    float lueurMir = exp(-length((mir - vec2(-0.30, 0.30)) * vec2(0.7, 1.1)) * 2.1);
    vec3 plan = sol + vec3(0.040, 0.046, 0.058) * lueurMir * 0.55;
    // Le reflet se brouille quand on s'eloigne du bord : la flaque n'est pas
    // un miroir.
    plan *= 0.75 + 0.25 * fbm(vec2(uv.x * 7.0, uv.y * 26.0 + t * 0.09), 3);
    plan += eau * pluie_ronds(uv, t, e) * 0.55;
    col = mix(col, plan, m);

    // ---- la finition ------------------------------------------------------
    col *= mix(0.34, 1.0, smoothstep(0.55, -0.10, uv.y));
    col *= 0.95 + 0.05 * sin(t * 0.047);

    return pluie_tone(col);
}
