// =====================================================================
// GRAVITE  --  scenes abyss et monolith
// Deux scenes de poids. Meme palette de gris froid a peine bleute,
// meme brume en exponentielle de la hauteur, meme lenteur : aucun
// coefficient de temps ne depasse 0.20, tout se compte en dizaines
// de secondes. Meme finition : le haut du cadre se perd dans le noir,
// compression douce, grain fixe contre le banding.
// =====================================================================


// ---------------------------------------------------------------------
// ABYSS
// Une pyramide lointaine posee sur une eau immobile qui la reflete.
// Une seule lueur pale, juste au dessus du sommet. Ciel noir.
// ---------------------------------------------------------------------

// Geometrie fixe du cadre. Horizon tres bas, pyramide legerement a
// droite de l axe pour laisser le centre libre : c est la que le
// texte se lit.
const float abyss_HZ  = -0.48;   // ligne d eau
const float abyss_CX  =  0.26;   // axe de la pyramide
const float abyss_TOP = -0.155;  // hauteur du sommet
const float abyss_HW  =  0.42;   // demi base

// Compression douce. Garantit qu aucune composante ne depasse 0.27,
// sans jamais ecreter franchement.
vec3 abyss_tone(vec3 c) {
    c = max(c, 0.0);
    return 0.27 * (1.0 - exp(-c / 0.27));
}

// Distance signee approchee a la silhouette de la pyramide.
// Negatif dedans. Sert a la fois au masque et au filet des aretes.
float abyss_pyr(vec2 p) {
    float h = abyss_TOP - abyss_HZ;
    vec2  q = vec2(abs(p.x - abyss_CX), p.y - abyss_HZ);
    float l = sqrt(h * h + abyss_HW * abyss_HW);
    float flank = (q.x * h + q.y * abyss_HW - abyss_HW * h) / l;
    return max(flank, -q.y);
}

// Le ciel seul : un degrade qui s eteint en montant, un souffle de
// nuage tres lent, et l unique source de lumiere de la scene.
vec3 abyss_sky(vec2 p, float t, float e) {
    float hgt  = max(p.y - abyss_HZ, 0.0);
    float band = exp(-hgt * 4.6);
    vec3  col  = vec3(0.026, 0.033, 0.046) * band * (0.60 + 0.40 * e);

    // Nuage : derive de deux centiemes d unite par seconde.
    float n = fbm(vec2(p.x * 1.6 + t * 0.010, p.y * 2.4 - t * 0.020), 3);
    col += vec3(0.014, 0.017, 0.023) * band * (n - 0.5);

    // La lueur : un halo large, puis un coeur pale et petit qui se
    // pose juste au dessus de la pointe.
    vec2  g = (p - vec2(abyss_CX, abyss_TOP + 0.020)) * vec2(1.10, 1.0);
    float r = length(g);
    float halo = exp(-r * 2.6) * 0.42 + exp(-r * 8.0) * 0.44;
    col += vec3(0.50, 0.56, 0.68) * halo * (0.085 + 0.060 * e);
    col += vec3(0.60, 0.66, 0.78) * exp(-r * 26.0) * (0.175 + 0.110 * e);
    return col;
}

// Le monde au dessus de l eau : ciel plus pyramide. Appele une
// seconde fois, en coordonnees miroir, pour fabriquer le reflet.
vec3 abyss_field(vec2 p, float t, float e) {
    vec3  col = abyss_sky(p, t, e);
    float d   = abyss_pyr(p);

    // Le bord est net au sommet et mange par la brume vers la base.
    float low  = 1.0 - smoothstep(abyss_HZ, abyss_TOP, p.y);
    float soft = 0.0035 + 0.030 * low;
    float m    = 1.0 - smoothstep(-soft, soft, d);

    // Face dans l ombre. L arete centrale separe deux valeurs a peine
    // differentes : c est ce qui donne le volume, rien d autre.
    float facet = smoothstep(-0.008, 0.008, p.x - abyss_CX);
    vec3  face  = vec3(0.011, 0.013, 0.018) * mix(1.30, 0.70, facet)
                * (0.45 + 0.55 * low);

    // Filet de lumiere qui deborde sur les deux aretes hautes.
    float rim = exp(-abs(d) * 110.0) * (1.0 - low * 0.85);
    face += vec3(0.30, 0.34, 0.42) * rim * (0.040 + 0.045 * e);

    return mix(col, face, m);
}

vec3 scene_abyss(vec2 uv, float t, float e) {
    vec3 col = vec3(0.0);

    if (uv.y > abyss_HZ) {
        col = abyss_field(uv, t, e);
    } else {
        // Reflet : miroir autour de la ligne d eau. L ondulation est
        // infime et respire sur une vingtaine de secondes ; a e nul
        // l eau est une plaque.
        float depth  = abyss_HZ - uv.y;                  // 0 a l horizon
        float breath = 0.70 + 0.30 * sin(t * 0.11);
        float amp    = (0.0014 + 0.0080 * e) * breath * (0.20 + depth * 1.5);

        float w = sin(uv.x * 4.7 - t * 0.070) * 0.55
                + sin(uv.x * 10.3 + t * 0.048) * 0.30;
        w += (fbm(vec2(uv.x * 2.0, depth * 6.0 - t * 0.030), 3) - 0.5) * 1.6;

        vec2 rp = vec2(uv.x + w * amp * 0.30, abyss_HZ + depth + w * amp);
        col  = abyss_field(rp, t, e) * (0.52 - 0.34 * smoothstep(0.0, 0.60, depth));
        col += vec3(0.006, 0.008, 0.012) * exp(-depth * 0.9);

        // Chemin de lumiere sous la lueur, brise par de fines rides.
        // Il rend le bas du cadre un peu plus present que le haut.
        float axis = exp(-abs(uv.x - abyss_CX) * (3.0 + depth * 2.4));
        float rid  = 0.5 + 0.5 * sin(depth * 42.0 - t * 0.20 + w * 1.1);
        rid = rid * rid * rid;
        col += vec3(0.40, 0.46, 0.56) * axis * rid
             * exp(-depth * 1.6) * (0.030 + 0.028 * e);
    }

    // Voile de brume au ras de l eau. Meme grammaire que monolith :
    // exponentielle de la distance au sol, module par un fbm lent,
    // eclaire seulement du cote de la source. Il retombe plus loin
    // sous l horizon qu au dessus : c est la distance qui l epaissit.
    float above = max(uv.y - abyss_HZ, 0.0);
    float below = max(abyss_HZ - uv.y, 0.0);
    float mist  = exp(-above * 9.0 - below * 4.0);
    mist *= 0.40 + 0.95 * fbm(vec2(uv.x * 1.6 + t * 0.010,
                                   uv.y * 2.4 - t * 0.020), 4);
    float lit = exp(-abs(uv.x - abyss_CX) * 1.5);
    col = mix(col, vec3(0.038, 0.045, 0.058) * (0.30 + 0.90 * lit),
              clamp(mist * (0.30 + 0.20 * e), 0.0, 0.52));

    // Le haut se perd dans le noir, les bords reculent.
    col *= 1.0 - 0.45 * smoothstep(0.10, 1.00, uv.y);
    col *= 1.0 - 0.28 * smoothstep(0.60, 1.70, length(vec2(uv.x * 0.70, uv.y * 0.60)));

    col  = abyss_tone(col);
    col += (hash21(uv * vec2(443.7, 271.9)) - 0.5) * 0.0010;
    return max(col, 0.0);
}


// ---------------------------------------------------------------------
// MONOLITH
// Une dalle verticale, nette, plantee au centre bas d un sol brumeux.
// Quelques marches a son pied. Lumiere rasante venant de derriere, qui
// detache la silhouette sans jamais eclairer sa face.
// ---------------------------------------------------------------------

const float monolith_G  = -0.44;   // ligne de sol au pied de la dalle
const float monolith_CX =  0.015;  // axe de la dalle, quasi centre
const float monolith_HW =  0.150;  // demi largeur
const float monolith_LX = -0.22;   // la source, derriere et a gauche

// Meme compression que abyss, meme plafond.
vec3 monolith_tone(vec3 c) {
    c = max(c, 0.0);
    return 0.27 * (1.0 - exp(-c / 0.27));
}

// Silhouette de la dalle : une boite sans couvercle, qui sort du
// cadre par le haut en se resserrant a peine.
float monolith_slab(vec2 p) {
    float k  = clamp((p.y - monolith_G) / 1.8, 0.0, 1.0);
    float hw = monolith_HW * (1.0 - 0.10 * k);
    return max(abs(p.x - monolith_CX) - hw, monolith_G - p.y);
}

// L air derriere la dalle : meme degrade que le ciel d abyss, meme
// nuage lent, plus le lobe de lumiere rasante.
vec3 monolith_air(vec2 p, float t, float e) {
    float hgt  = max(p.y - monolith_G, 0.0);
    float band = exp(-hgt * 3.0);
    vec3  col  = vec3(0.024, 0.030, 0.042) * band * (0.60 + 0.40 * e);

    float n = fbm(vec2(p.x * 1.6 + t * 0.010, p.y * 2.4 - t * 0.020), 3);
    col += vec3(0.013, 0.016, 0.021) * band * (n - 0.5);

    // Lobe tres etale horizontalement et ecrase en hauteur : la
    // lumiere arrive au ras du sol. Son coeur passe derriere la dalle.
    vec2  g  = (p - vec2(monolith_LX, monolith_G + 0.06)) * vec2(0.55, 1.60);
    float lo = exp(-length(g) * 2.0);
    col += vec3(0.44, 0.50, 0.62) * lo * (0.105 + 0.075 * e);
    col += vec3(0.52, 0.58, 0.70) * exp(-length(g) * 6.0) * (0.070 + 0.055 * e);
    return col;
}

vec3 scene_monolith(vec2 uv, float t, float e) {
    vec3 col = monolith_air(uv, t, e);

    // Le sol : plan sombre que la lumiere frole sans l eclairer.
    float depth = max(monolith_G - uv.y, 0.0);
    vec3  grnd  = vec3(0.009, 0.011, 0.015) * exp(-depth * 0.7);
    float smear = exp(-abs(uv.x - monolith_LX) * 1.1) * exp(-depth * 2.6);
    grnd += vec3(0.26, 0.30, 0.38) * smear * (0.030 + 0.022 * e);
    float gm = 1.0 - smoothstep(-0.006, 0.006, uv.y - monolith_G);
    col = mix(col, grnd, gm);

    // La dalle. Sa face reste noire ; seule l arete cote source la
    // detache du fond, et plus fort en bas qu en haut.
    float d  = monolith_slab(uv);
    float sm = 1.0 - smoothstep(-0.004, 0.004, d);
    float lean  = smoothstep(-monolith_HW, monolith_HW, uv.x - monolith_CX);
    float rfall = exp(-max(uv.y - monolith_G, 0.0) * 0.95);
    vec3  slab  = vec3(0.008, 0.010, 0.014) * mix(1.35, 0.75, lean)
                * (0.08 + 0.92 * rfall);

    float rim   = exp(-abs(d) * 150.0);
    float rside = 1.0 - smoothstep(-0.020, 0.000, uv.x - monolith_CX);
    slab += vec3(0.30, 0.34, 0.44) * rim * (0.30 + 0.70 * rside)
          * rfall * (0.045 + 0.040 * e);
    col = mix(col, slab, sm);

    // Quatre marches : chacune plus basse et plus large que la
    // precedente, donc plus proche. Seule leur arete se voit.
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float ty = monolith_G - 0.030 - 0.042 * fi;
        float hw = 0.200 + 0.062 * fi;
        float mx = 1.0 - smoothstep(hw - 0.005, hw + 0.005, abs(uv.x - monolith_CX));
        float my = 1.0 - smoothstep(ty - 0.004, ty + 0.004, uv.y);
        float m  = mx * my;

        vec3 tread = vec3(0.0085, 0.0105, 0.0145) * (1.0 - 0.12 * fi);
        col = mix(col, tread, m * 0.94);

        float lip  = exp(-max(ty - uv.y, 0.0) * 22.0) * m;
        float edge = exp(-abs(uv.y - ty) * 150.0) * mx;
        float side = exp(-abs(uv.x - monolith_LX) * 0.8);
        col += vec3(0.30, 0.34, 0.42) * side * (edge * (0.034 + 0.026 * e)
                                              + lip * (0.010 + 0.008 * e));
    }

    // La brume. C est elle que e fait varier : sa hauteur le long de
    // la dalle et sa densite. Meme fbm, meme derive que dans abyss.
    float rise = 0.28 + 0.46 * e;
    float hgt  = max(uv.y - (monolith_G - 0.30), 0.0);
    float dens = exp(-hgt / rise);
    dens *= 0.40 + 1.05 * fbm(vec2(uv.x * 1.6 + t * 0.010,
                                   uv.y * 2.4 - t * 0.020), 4);
    float lit  = exp(-length((uv - vec2(monolith_LX, monolith_G))
                             * vec2(0.50, 1.30)) * 1.6);
    vec3  fogc = vec3(0.042, 0.050, 0.064) * (0.30 + 1.20 * lit);
    col = mix(col, fogc, clamp(dens * (0.42 + 0.30 * e), 0.0, 0.80));

    // Meme finition que abyss, au coefficient pres.
    col *= 1.0 - 0.45 * smoothstep(0.10, 1.00, uv.y);
    col *= 1.0 - 0.28 * smoothstep(0.60, 1.70, length(vec2(uv.x * 0.70, uv.y * 0.60)));

    col  = monolith_tone(col);
    col += (hash21(uv * vec2(443.7, 271.9)) - 0.5) * 0.0010;
    return max(col, 0.0);
}
