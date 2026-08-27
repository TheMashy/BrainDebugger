// =====================================================================
//  INFINI  --  deux scenes de vertige : mandel et drift.
//
//  Meme main pour les deux. Meme rampe de gris (cendre froide, gris,
//  os a peine tiede), meme lampe unique et faible posee en bas a
//  droite hors du champ de lecture, meme voile qui mange le haut de
//  l'image, meme creux au centre pour que le texte s'y lise, meme
//  grain fixe contre le banding, et la meme lenteur : tout ce qui
//  bouge ici se compte en dizaines de secondes.
//
//  Attention : scene_drift remplace celle de defaut.glsl. Les deux ne
//  peuvent pas cohabiter dans le meme bundle.
// =====================================================================


// ---------------------------------------------------------------------
//  MANDEL
//  L'ensemble de Mandelbrot traite comme une gravure : une plaque
//  sombre, un trait fin, et un zoom qui ne finit jamais.
//
//  Le cadre est pose sur le point de Misiurewicz c = i, un bord
//  filamenteux ou l'ensemble est asymptotiquement auto-similaire sous
//  z -> lambda * z, avec lambda = 4 + 4i. Une periode de zoom divise
//  donc l'echelle par |lambda| = 5.656854 et tourne de
//  arg(lambda) = PI/4 : au bout d'une periode l'image est revenue sur
//  elle-meme, le cycle se referme sans raccord visible et la descente
//  peut durer toute la soiree. C'est la crise existentielle : le meme
//  motif a toutes les echelles, et pas de fond.
// ---------------------------------------------------------------------

// La rampe tonale commune aux deux scenes. Le noir n'est jamais un
// vrai noir mais une cendre froide ; la lumiere n'est jamais blanche
// mais un os a peine tiede. Plafond a 0.108 : le trait doit rester un
// trait d'argent, pas une rayure blanche.
vec3 mandel_tone(float v) {
    v = clamp(v, 0.0, 1.0);
    vec3 ash  = vec3(0.0075, 0.0100, 0.0155);
    vec3 grey = vec3(0.0330, 0.0370, 0.0450);
    vec3 bone = vec3(0.1080, 0.1030, 0.0900);
    vec3 col  = mix(ash, grey, smoothstep(0.0, 0.55, v));
    return mix(col, bone, smoothstep(0.52, 1.0, v));
}

// Produit de deux complexes.
vec2 mandel_cmul(vec2 a, vec2 b) {
    return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

// Exponentielle decroissante bornee : sert a tous les degrades de la
// scene. Le min evite de demander a exp() des valeurs absurdes.
float mandel_fall(float a) {
    return exp(-min(a, 50.0));
}

// Ce qui reste de matiere a cette hauteur : 1 en bas, presque rien en
// haut. Applique a la couleur finale, donc le haut du cadre tombe
// vraiment dans le noir.
float mandel_ciel(vec2 uv) {
    return 0.28 + 0.72 * (1.0 - smoothstep(-1.00, 0.95, uv.y));
}

// Le creux central : sous la colonne de lecture on garde tres peu de
// contraste. L'hote pose deja son propre voile la ; celui-ci ne fait
// que l'accompagner.
float mandel_centre(vec2 uv) {
    return mix(0.50, 1.0, smoothstep(0.10, 1.05, length(uv * vec2(0.58, 1.0))));
}

// L'unique source : basse, a droite, tres etalee. Elle n'eclaire rien
// franchement, elle dit seulement de quel cote se trouve le jour.
float mandel_lampe(vec2 uv) {
    vec2 p = uv - vec2(0.42, -0.86);
    return mandel_fall(dot(p, p) * 0.60);
}

vec3 scene_mandel(vec2 uv, float t, float e) {
    // Phase du zoom. e n'accelere qu'a peine : 78 s par periode au
    // repos, 60 s a pleine energie.
    float period = 78.0 - 18.0 * e;
    float x = fract(t / period);
    float s  = 0.0030 * exp(-1.7328680 * x);   // exp(-log|lambda| * x)
    float th = -0.7853982 * x;                 // -arg(lambda) * x

    // Le point de fuite est tenu bas et a droite, du cote de la lampe :
    // le tronc du filament est eclaire, ses ramures se perdent en
    // montant vers la gauche.
    vec2 d = mandel_cmul(vec2(cos(th), sin(th)) * s, uv - vec2(0.22, -0.58));
    vec2 c = vec2(0.0, 1.0) + d;

    // Iteration avec sa derivee : estimateur de distance a l'ensemble.
    // 56 tours, pas un de plus, et aucune borne variable.
    vec2  z  = vec2(0.0, 0.0);
    vec2  dz = vec2(0.0, 0.0);
    float n  = 0.0;
    float r2 = 0.0;
    for (int i = 0; i < 56; i++) {
        if (r2 < 4096.0) {
            dz = 2.0 * mandel_cmul(z, dz) + vec2(1.0, 0.0);
            z  = mandel_cmul(z, z) + c;
            r2 = dot(z, z);
            n += 1.0;
        }
    }

    float esc = step(4096.0, r2);
    float r   = sqrt(max(r2, 1.0e-12));
    float de  = r * max(log(r), 1.0e-4) / max(length(dz), 1.0e-12);

    // Largeur ramenee en unites d'ecran : le trait garde exactement la
    // meme finesse a toutes les profondeurs, ce qui est la condition
    // pour que la boucle ne se voie pas.
    float w = de / s;

    // Le burin : un trait fin, un liseret, puis une brume large
    // accrochee au trait. C'est cette brume qui donne la profondeur.
    float ink = mandel_fall(w * 230.0) * 0.90
              + mandel_fall(w *  42.0) * 0.14
              + mandel_fall(w *   9.0) * 0.05;
    ink = mix(0.42, ink, esc);

    // Les 56 tours ne suffisent plus passe une certaine finesse. Plutot
    // que de laisser ces pixels s'empater, on les eteint en douceur.
    // Le compte est corrige de la derive du cycle (une periode ajoute
    // exactement deux iterations), sans quoi le fondu deriverait et la
    // boucle se verrait.
    float deep = 1.0 - smoothstep(34.0, 52.0, n - 2.0 * x);
    ink *= deep;

    // Hachure tiree du compte d'iteration lisse : la texture de la
    // plaque. Amplitude minuscule, et serree contre le motif pour ne
    // pas grisailler le reste du cadre.
    float nu = n + 1.0 - log(max(log(r), 1.0)) * 1.4426950;
    float hatch = (0.5 + 0.5 * cos(nu * 2.4)) * 0.030 * esc * deep
                * mandel_fall(w * 2.5);

    // La distance a la lampe fait le reste de la profondeur : les
    // ramures lointaines s'effacent presque completement.
    float lampe = mandel_lampe(uv);
    ink *= 0.30 + 1.05 * lampe;

    // e ne monte pas la lumiere : il fait sortir les filaments.
    float centre = mandel_centre(uv);
    float v = (ink + hatch) * (0.55 + 0.45 * e) * centre;
    v += lampe * 0.16 * centre + 0.020;

    // Grain de plaque, fixe dans le temps : rien ne scintille.
    v += (hash21(uv * 613.0) - 0.5) * 0.010;

    return mandel_tone(v) * mandel_ciel(uv);
}


// ---------------------------------------------------------------------
//  DRIFT
//  Un champ d'etoiles tres faible qui glisse lateralement, un ruban
//  laiteux en diagonale sous la ligne de lecture, et deux ou trois
//  grandes masses de poussiere qui passent devant. C'est le
//  detachement : on pense a tres grand, et plus rien n'a de taille.
// ---------------------------------------------------------------------

// Meme rampe que mandel, au chiffre pres.
vec3 drift_tone(float v) {
    v = clamp(v, 0.0, 1.0);
    vec3 ash  = vec3(0.0075, 0.0100, 0.0155);
    vec3 grey = vec3(0.0330, 0.0370, 0.0450);
    vec3 bone = vec3(0.1080, 0.1030, 0.0900);
    vec3 col  = mix(ash, grey, smoothstep(0.0, 0.55, v));
    return mix(col, bone, smoothstep(0.52, 1.0, v));
}

float drift_fall(float a) {
    return exp(-min(a, 50.0));
}

// Memes finitions que mandel.
float drift_ciel(vec2 uv) {
    return 0.28 + 0.72 * (1.0 - smoothstep(-1.00, 0.95, uv.y));
}

float drift_centre(vec2 uv) {
    return mix(0.62, 1.0, smoothstep(0.10, 1.05, length(uv * vec2(0.58, 1.0))));
}

float drift_lampe(vec2 uv) {
    vec2 p = uv - vec2(0.42, -0.86);
    return drift_fall(dot(p, p) * 0.60);
}

// Une nappe d'etoiles. Une cellule porte au plus une etoile ; sa
// position, sa taille et sa magnitude sortent du hash de la cellule et
// ne dependent jamais du temps. Une etoile ne peut donc que se
// translater : rien ne clignote dans le champ peripherique. Le
// decalage reste a l'interieur de la cellule, ce qui evite d'avoir a
// visiter les voisines et empeche tout bord coupe.
float drift_nappe(vec2 q, float dens, float seed, float seuil, float taille) {
    vec2  g  = q * dens;
    vec2  id = floor(g);
    vec2  f  = fract(g) - 0.5;
    float h1 = hash21(id + vec2(seed,            seed * 1.7 +  3.1));
    float h2 = hash21(id + vec2(seed * 2.3 + 17.9, seed * 0.6 +  5.4));
    float h3 = hash21(id + vec2(seed * 0.9 + 41.2, seed * 3.1 + 29.7));

    vec2  off = (vec2(h2, h3) - 0.5) * 0.66;
    float d   = length(f - off) / dens;         // distance en unites d'ecran
    float sg  = (0.0032 + 0.0024 * h3) * taille;
    float k   = d / sg;
    float k2  = k * k;

    // Beaucoup de faibles, quelques vives : c'est la distribution des
    // magnitudes qui fait qu'un ciel n'est pas une trame.
    float mag = 0.10 + 0.90 * h2 * h2;
    return step(seuil, h1) * mag * (drift_fall(k2) + drift_fall(k2 * 0.35) * 0.035);
}

vec3 scene_drift(vec2 uv, float t, float e) {
    // e ne change que la vitesse de derive : de six millemes d'unite
    // par seconde au repos a deux centiemes a pleine energie.
    float sp   = 0.0060 + 0.0165 * e;
    float dx   = t * sp;
    float sway = sin(t * 0.019) * 0.028;        // une respiration, pas un mouvement

    // Trois nappes, chacune sur sa grille tournee pour qu'aucun reseau
    // ne se devine, et a sa propre vitesse : c'est la parallaxe qui
    // creuse le fond. Le decalage est applique avant la rotation, donc
    // les trois glissent bien dans le meme sens a l'ecran.
    vec2 q1 = rot(0.21) * (uv + vec2(-dx * 1.00, sway));
    vec2 q2 = rot(1.03) * (uv + vec2(-dx * 0.62, sway * 0.70));
    vec2 q3 = rot(2.27) * (uv + vec2(-dx * 0.33, sway * 0.45));
    float st = drift_nappe(q1, 14.0,  1.0, 0.80, 1.00) * 1.00
             + drift_nappe(q2, 20.0,  7.0, 0.76, 0.86) * 0.62
             + drift_nappe(q3, 27.0, 19.0, 0.72, 0.74) * 0.38;

    // Le ruban : la voie laiteuse, en diagonale douce et tenue sous le
    // centre du cadre. C'est la silhouette de la scene, celle qu'on
    // reconnait sans regarder.
    float bc   = (rot(-0.42) * uv).y + 0.42;
    float band = drift_fall(bc * bc * 5.0);
    st *= 0.18 + 1.15 * band;

    // Deux grandes masses et une plus petite, plus proches que les
    // etoiles donc plus rapides. Les seuils sont serres autour de la
    // moyenne du fbm : chaque masse ne couvre qu'un quart du cadre, et
    // ce quart respire au fil de la derive.
    float n1 = smoothstep(0.550, 0.615,
               fbm(vec2(uv.x * 0.75 - dx * 1.45 + 11.3,
                        uv.y * 0.75 + sway * 0.90 +  4.1), 4));
    float n2 = smoothstep(0.540, 0.620,
               fbm(vec2(uv.x * 1.15 - dx * 1.05 - 27.5,
                        uv.y * 1.15 - sway * 0.60 + 18.9), 4));
    float n3 = smoothstep(0.540, 0.650,
               fbm(vec2(uv.x * 1.90 - dx * 2.10 + 41.7,
                        uv.y * 1.90 + sway * 1.30 -  8.3), 3));
    float dust = clamp(n1 * 0.85 + n2 * 0.55 + n3 * 0.32, 0.0, 1.0);

    // Elles passent devant : elles mangent les etoiles et le ruban.
    st *= 1.0 - 0.55 * dust;
    float ruban = band * (0.55 + 0.45 * n2) * (1.0 - 0.85 * dust) * 0.30;

    // Loin de la lampe un nuage n'est qu'une absence ; pres d'elle il
    // prend un peu de jour. Meme lampe que mandel, au meme endroit.
    float lampe = drift_lampe(uv);
    float nuage = dust * (0.030 + 0.28 * lampe);

    float centre = drift_centre(uv);
    float v = (st * 1.90 + ruban + nuage) * centre;
    v += lampe * 0.10 * centre + 0.010;

    // Meme grain que mandel.
    v += (hash21(uv * 613.0) - 0.5) * 0.010;

    return drift_tone(v) * drift_ciel(uv);
}
