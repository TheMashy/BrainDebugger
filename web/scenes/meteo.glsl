// ===========================================================================
// meteo.glsl -- deux etats interieurs : BRUME et GRAIN
//
// Meme main pour les deux : la meme gamme de gris froids, la meme lueur
// voilee a peine tiede, la meme brume en exponentielle de la distance a une
// ligne, la meme lenteur (rien ne varie a plus de 0.14 Hz, tout se compte en
// dizaines de secondes), la meme finition (le haut se perd dans le noir,
// tramage fixe contre le banding, plafond dur a 0.26).
//
// Cadre : la hauteur de l'ecran vaut une unite, uv.y va de -0.5 en bas a
// +0.5 en haut, uv.x est multiplie par le rapport d'aspect (donc environ
// +-0.25 sur un telephone, +-0.9 sur un ecran large). Les deux sources sont
// posees vers le bord gauche : sur un telephone elles sortent du cadre et il
// n'en reste que la nappe qu'elles eclairent. C'est voulu -- une lumiere hors
// champ ne tire jamais l'oeil hors du texte.
// ===========================================================================


// ---------------------------------------------------------------------------
// BRUME
// Cinq couches de montagnes en fbm : pale au fond, noir au premier plan, une
// nappe de brume couchee sur chaque crete. C'est la scene des bons soirs :
// la plus douce, celle qui ne demande rien.
//
// Lumiere : une lune voilee, en haut a gauche, juste au-dessus de la crete la
// plus lointaine, plus la trainee qu'elle laisse le long de l'horizon.
// e : la hauteur de la brume entre les couches (elle monte et redescend), la
// respiration des cretes, et ce que la lune arrive a traverser.
// ---------------------------------------------------------------------------

// Profil d'une crete. Une tranche de fbm etiree horizontalement, pointes
// adoucies : des montagnes, pas des dents de scie. Retourne environ [-0.5,0.5].
float brume_ridge(vec2 uv, float freq, float drift, float seed)
{
    float x = uv.x * freq + drift + seed * 31.7;
    // Le fbm est resserre autour de 0.5 : on l'etale, sinon la crete est
    // une ligne presque droite.
    float h = (fbm(vec2(x, seed * 9.3), 4) - 0.5) * 2.2;
    return h * 0.80 + 0.20 * sin(x * 0.65 + seed * 2.1);
}

vec3 scene_brume(vec2 uv, float t, float e)
{
    // Palette commune aux deux scenes.
    vec3 ciel_haut = vec3(0.004, 0.005, 0.009);
    vec3 ciel_bas  = vec3(0.021, 0.026, 0.036);
    vec3 brume_col = vec3(0.088, 0.101, 0.122);
    vec3 lueur_col = vec3(0.228, 0.214, 0.194);

    // Ciel : le haut se perd dans le noir, l'horizon garde un peu de matiere.
    float v = smoothstep(0.55, -0.25, uv.y);
    vec3 col = mix(ciel_haut, ciel_bas, v * v);

    // e n'est pas un curseur de luminosite : il decide de ce que la lueur
    // arrive a traverser, et de l'amplitude de tout ce qui bouge.
    float pres = 0.55 + 0.45 * e;

    // La source : une lune voilee, decalee a gauche, posee juste au-dessus de
    // la crete la plus lointaine. Jamais un disque net, jamais un bord.
    vec2  lp = vec2(-0.22, 0.24);
    float ld = length((uv - lp) * vec2(1.0, 1.25));
    float halo = exp(-ld * 3.4) * 0.40 + exp(-ld * 9.5) * 0.30;
    // Sa trainee le long de l'horizon, tres etalee : c'est elle qui detache
    // les silhouettes de loin.
    halo += exp(-abs(uv.y - 0.10) * 6.2) * exp(-abs(uv.x + 0.16) * 1.1) * 0.24;
    col += lueur_col * halo * pres;

    // Les cinq couches, du fond vers le premier plan.
    for (int i = 0; i < 5; i++)
    {
        float fi = float(i);
        float k  = fi / 4.0;              // 0.0 = fond, 1.0 = premier plan
        float kk = k * (1.45 - 0.45 * k); // la valeur tombe vite des la 2e couche

        // Plus une couche est proche, plus elle est basse, ample et lente :
        // c'est le seul indice de profondeur, il doit etre net.
        float base  = mix( 0.200, -0.340, k);
        float amp   = mix( 0.090,  0.340, k);
        float freq  = mix( 6.000,  1.600, k);
        float drift = t * mix(0.0040, 0.0160, k);

        // Respiration : les cretes montent et descendent de quelques pixels.
        base += sin(t * 0.055 + fi * 1.7) * 0.008 * (0.35 + 0.65 * e);

        float hgt = base + amp * brume_ridge(uv, freq, drift, fi + 1.0);

        // Silhouette : de plus en plus noire vers l'avant.
        vec3 lay = mix(vec3(0.088, 0.100, 0.121), vec3(0.004, 0.005, 0.008), kk);
        // Le flanc tourne vers la lune garde un reste de lumiere rasante.
        lay += lueur_col * 0.08 * (1.0 - k) * exp(-abs(uv.x + 0.16) * 1.4) * pres;

        // Volume : le flanc s'assombrit en descendant sous la crete. Sans ca
        // les couches se lisent comme des bandes plates empilees.
        lay *= mix(1.0, 0.60, smoothstep(0.0, 0.30, hgt - uv.y));
        // Les couches ne sont visibles que par la lumiere qui les atteint :
        // a e nul la montagne rentre dans le noir avec le reste.
        lay *= 0.70 + 0.30 * e;

        // Bord net devant, mange par l'air au fond.
        float edge = mix(0.0060, 0.0025, k);
        float m = smoothstep(-edge, edge, hgt - uv.y);
        col = mix(col, lay, m);

        // La brume couchee sur la crete. C'est ce que e fait varier : la
        // nappe monte entre les couches quand la journee pese, et elle
        // respire par-dessus sur une vingtaine de secondes.
        float above = uv.y - hgt;
        float hh = mix(0.012, 0.045, e) * (1.0 + 0.30 * e * sin(t * 0.062 + fi * 1.1));
        float band = exp(-max(above, 0.0) / hh) * smoothstep(-hh * 1.6, 0.0, above);
        float tex  = 0.55 + 0.60 * fbm(vec2(uv.x * 2.2 + t * 0.010 + fi * 5.0, fi * 3.0), 2);
        float amt  = band * tex * mix(0.42, 0.10, k) * (0.60 + 0.40 * e);
        // La nappe se teinte de la lueur quand elle passe devant la lune.
        vec3 bc = mix(brume_col, lueur_col * 0.72,
                      exp(-abs(uv.x + 0.16) * 1.2) * 0.50 * pres);
        col = mix(col, bc, clamp(amt, 0.0, 1.0));
    }

    // Fond de vallee : le bas ne tombe jamais tout a fait dans le noir, il
    // reste un peu plus present que le haut.
    col += brume_col * 0.07 * smoothstep(-0.12, -0.55, uv.y) * (0.45 + 0.55 * e);

    // Tramage fixe en espace ecran : casse les bandes des degrades tres
    // sombres sans jamais bouger d'une image a l'autre.
    col += (hash21(uv * 511.0) - 0.5) * 0.004;

    return clamp(col, 0.0, 0.26);
}


// ---------------------------------------------------------------------------
// GRAIN
// Un grain numerique qui ne tient pas en place : des cellules qui naissent et
// meurent sur une grille deformee, des bandes horizontales qui se decalent,
// des lignes de balayage a peine visibles. C'est l'anxiete.
//
// Rien ne clignote : chaque cellule a sa propre periode, entre 7 et 19
// secondes, soit 0.05 a 0.14 Hz. L'instabilite se lit dans le fait que le
// motif ne repasse jamais deux fois par le meme etat, pas dans une frequence.
//
// Lumiere : la meme lueur voilee que dans BRUME, tombee en bas a gauche,
// comme si elle passait derriere l'ecran.
// e : la densite des cellules, et ce que la lueur traverse.
// ---------------------------------------------------------------------------

// Une nappe de cellules. cs = taille d'une cellule (plus large que haute :
// c'est une grille de caracteres, pas un damier), dens = fraction vivante.
float grain_cells(vec2 p, float t, vec2 cs, float dens, float seed)
{
    vec2 g  = p / cs;
    vec2 id = floor(g);
    vec2 f  = fract(g) - 0.5;

    float ha = hash21(id + seed);
    float hb = hash21(id * 1.31 + seed + 7.3);
    float hc = hash21(id * 0.77 + seed + 19.1);

    // Seuil : seule une fraction des cellules a le droit de vivre.
    float live = smoothstep(1.0 - dens - 0.07, 1.0 - dens + 0.07, hc);

    // Periode propre a chaque cellule, et phase propre : deux voisines ne
    // s'allument jamais ensemble et l'ensemble ne boucle pas.
    float per = 7.0 + 12.0 * ha;
    float x = fract(t / per + hb);
    float env = smoothstep(0.0, 0.30, x) * smoothstep(1.0, 0.68, x);

    // Forme : un pave a bords doux, parfois etroit, parfois plein.
    float w = mix(0.30, 0.46, step(0.55, hb));
    vec2  q = abs(f) - vec2(w, 0.30);
    float d = max(q.x, q.y);
    float shape = smoothstep(0.09, -0.03, d);

    return shape * env * live * (0.45 + 0.55 * hb);
}

// Decalage lateral par bandes horizontales. La valeur change toutes les neuf
// secondes avec un fondu de pres de deux secondes : le motif se defait, mais
// rien ne saute d'une image a l'autre.
float grain_rowshift(float row, float t)
{
    float s  = t / 9.0;
    float i0 = floor(s);
    float fr = s - i0;
    float a = hash21(vec2(row, i0));
    float b = hash21(vec2(row, i0 + 1.0));
    return (mix(a, b, smoothstep(0.80, 1.0, fr)) - 0.5) * 0.16;
}

vec3 scene_grain(vec2 uv, float t, float e)
{
    // Meme palette que BRUME, au centieme pres.
    vec3 ciel_haut = vec3(0.004, 0.005, 0.009);
    vec3 ciel_bas  = vec3(0.019, 0.023, 0.033);
    vec3 brume_col = vec3(0.088, 0.101, 0.122);
    vec3 lueur_col = vec3(0.228, 0.214, 0.194);

    float v = smoothstep(0.55, -0.25, uv.y);
    vec3 col = mix(ciel_haut, ciel_bas, v * v);

    float pres = 0.55 + 0.45 * e;

    // La source, tombee en bas a gauche et deja mangee par la brume.
    vec2  lp = vec2(-0.30, -0.32);
    float ld = length((uv - lp) * vec2(1.0, 1.35));
    float halo = exp(-ld * 4.4) * 0.40 + exp(-ld * 11.0) * 0.24;
    col += lueur_col * halo * pres;

    // La brume : meme grammaire que dans BRUME, une nappe lente qui derive et
    // qui pese sur le bas de l'image.
    float hz = fbm(vec2(uv.x * 1.6 + t * 0.012, uv.y * 3.0 - t * 0.006), 3);
    float nappe = smoothstep(0.16, -0.50, uv.y) * (0.35 + 0.65 * hz);
    col = mix(col, brume_col, clamp(nappe * (0.24 + 0.22 * e), 0.0, 1.0));

    // La grille est deformee par un bruit tres lent : elle ne se referme
    // jamais sur le meme motif.
    vec2 wp = uv;
    wp += (vec2(fbm(uv * 1.5 + vec2(t * 0.010, 0.0), 3),
                fbm(uv * 1.5 + vec2(0.0, 3.7 - t * 0.008), 3)) - 0.5) * 0.15;

    // Bandes horizontales decalees : c'est la que se lit l'instabilite.
    wp.x += grain_rowshift(floor(uv.y * 14.0 + 30.0), t);

    // Le centre reste calme : c'est la que le texte se lit.
    float rad  = length(uv * vec2(0.72, 1.0));
    float peri = smoothstep(0.12, 0.46, rad);

    // e densifie les cellules : d'une sur dix a une sur trois.
    float dens = mix(0.11, 0.32, e);

    // Deux nappes d'echelles differentes, la seconde tournee : ensemble elles
    // ne dessinent plus une grille reguliere.
    float c = grain_cells(wp, t, vec2(0.052, 0.034), dens, 0.0);
    c += grain_cells(wp * rot(0.42) + vec2(11.3, -4.7), t, vec2(0.088, 0.058),
                     dens * 0.80, 17.0) * 0.75;
    c = clamp(c, 0.0, 1.0);

    // Les cellules s'amassent la ou la brume est epaisse, elles pesent vers le
    // bas et se tiennent pres de la lueur : des amas qui se defont lentement.
    c *= 0.35 + 0.65 * hz;
    c *= peri;
    c *= 0.18 + 0.82 * smoothstep(0.42, -0.45, uv.y);
    c *= 0.55 + 0.55 * exp(-ld * 2.4);

    vec3 cc = mix(brume_col, lueur_col * 0.62, exp(-ld * 2.2) * 0.50);
    col += cc * c * (0.75 + 0.35 * e);

    // Lignes de balayage : a peine visibles, elles derivent a 0.11 Hz.
    float scan = 0.5 + 0.5 * sin(uv.y * 190.0 - t * 0.7);
    col *= 0.940 + 0.060 * scan;
    col += lueur_col * 0.018 * scan * peri * pres;

    // Grain fin : il derive d'une cellule toutes les vingt secondes. C'est une
    // matiere, pas un scintillement.
    float fg = noise2(uv * 90.0 + vec2(t * 0.050, -t * 0.037));
    col += (fg - 0.5) * 0.018 * (0.45 + 0.55 * peri);

    // Meme tramage fixe que BRUME.
    col += (hash21(uv * 511.0) - 0.5) * 0.004;

    return clamp(col, 0.0, 0.26);
}
