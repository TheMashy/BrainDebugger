// ===========================================================================
// aube.glsl -- LE SOLEIL QUI SE LEVE SUR DES CHAMPS
//
// La premiere scene chaude de l'application. Toutes les autres sont des gris
// froids : c'etait cohérent tant que le decor ne servait qu'a accompagner ce
// qui pese, mais il ne savait alors rien dire de ce qui va bien. « brume » dit
// le calme -- la journee tient, rien ne presse. Ce n'est pas la meme chose que
// l'espoir, qui est tourne vers ce qui vient.
//
// D'ou celle-ci : un horizon bas, des champs qui ondulent, et une lumiere qui
// monte de derriere. Le soleil n'est jamais un disque net -- il n'est pas
// arrive, il arrive, et c'est la difference que porte toute la scene.
//
// Cadre : uv.y de -0.5 en bas a +0.5 en haut, uv.x multiplie par le rapport
// d'aspect. Le soleil est pose LEGEREMENT a gauche de l'axe pour laisser le
// centre libre : c'est la que le texte se lit.
//
// e ne regle pas la luminosite, il regle la HAUTEUR du soleil et l'ampleur de
// ce qui bouge : plus haut, plus ouvert.
// ===========================================================================

const float aube_HZ = -0.20;    // la ligne des champs
const float aube_CX = -0.13;    // l'axe du soleil

// Compression douce, comme partout ailleurs : rien ne depasse 0.27, et rien
// n'est franchement ecrete -- une teinte chaude qui sature vire au blanc, et
// un blanc dans le fond se bat avec le texte.
vec3 aube_tone(vec3 c) {
    c = max(c, 0.0);
    return 0.27 * (1.0 - exp(-c / 0.27));
}

// Le profil des champs : deux ondes lentes et un fbm doux par-dessus. Ce sont
// des ondulations de terrain, pas des montagnes -- l'amplitude reste petite.
float aube_champ(float x, float t, float freq, float amp, float seed)
{
    float o = sin(x * freq + seed * 2.7) * 0.55
            + sin(x * freq * 0.47 + seed * 5.1 + t * 0.013) * 0.45;
    float g = (fbm(vec2(x * freq * 0.8 + seed * 17.0, seed * 4.0), 3) - 0.5) * 1.6;
    return (o * 0.6 + g * 0.4) * amp;
}

vec3 scene_aube(vec2 uv, float t, float e)
{
    // La palette. Le haut reste presque noir -- c'est encore la nuit la-haut --
    // et tout le chaud est concentre dans la bande de l'horizon.
    vec3 ciel_haut = vec3(0.010, 0.014, 0.030);
    vec3 ciel_bas  = vec3(0.115, 0.072, 0.048);
    vec3 feu       = vec3(0.260, 0.150, 0.062);
    vec3 terre     = vec3(0.030, 0.026, 0.022);

    // e ouvre la scene : le soleil monte d'a peine trois centiemes de cadre,
    // ce qui suffit -- toute la lumiere est dans le halo, pas dans le disque.
    float haut = aube_HZ - 0.052 + 0.030 * e;
    vec2  sp   = vec2(aube_CX, haut);

    // ---- le ciel ----------------------------------------------------------
    // Un degrade vertical, puis le halo par-dessus. Le degrade seul donnerait
    // une bande horizontale uniforme : c'est le halo qui fait le lever.
    /*
     * LA BANDE CHAUDE RESTE BASSE. Etalee jusqu'a mi-hauteur, l'ambre remplit
     * tout le cadre et il n'y a plus de nuit au-dessus : on perd le lever, il
     * ne reste qu'un fond orange. C'est le CONTRASTE entre la nuit qui tient
     * en haut et la lumiere qui monte en bas qui fait l'aube.
     */
    float v = smoothstep(0.26, aube_HZ - 0.04, uv.y);
    vec3 col = mix(ciel_haut, ciel_bas, v * v);

    // Le halo. Ecrase verticalement : la lumiere d'un soleil bas s'etale le
    // long de l'horizon bien plus qu'elle ne monte.
    vec2 d = (uv - sp) * vec2(0.62, 1.35);
    float r = length(d);
    float halo = exp(-r * 4.6) * 0.95 + exp(-r * 1.75) * 0.34;

    // Le disque, jamais un bord : un noyau plus dense, dont la moitie basse
    // est deja mangee par les champs.
    float noyau = exp(-r * 12.0) * 0.9;

    // Le voile de l'horizon : ce qui traine a plat de part et d'autre, et qui
    // dit qu'il y a de l'air entre le soleil et nous.
    float voile = exp(-abs(uv.y - aube_HZ) * 14.0) * exp(-abs(uv.x - aube_CX) * 1.1) * 0.34;

    // Trois nappes de nuages tres etirees, qui derivent chacune a sa vitesse.
    // Elles ne sont pas la pour faire joli : sans elles la lueur est un
    // dégradé propre, et un dégradé propre ne ressemble a rien de vu.
    float nu = 0.0;
    for (int i = 0; i < 3; i++) {
        float fi = float(i);
        float y  = aube_HZ + 0.055 + fi * 0.075;
        float n  = fbm(vec2(uv.x * (1.6 + fi * 0.7) + t * (0.009 + fi * 0.004) + fi * 23.0,
                            uv.y * 5.0 + fi * 11.0), 3);
        float bande = exp(-abs(uv.y - y) * (16.0 - fi * 3.0));
        nu += bande * smoothstep(0.42, 0.78, n) * (0.30 - fi * 0.06);
    }

    col += feu * (halo + noyau) * (0.55 + 0.45 * e);
    col += feu * voile;
    // Les nuages ne s'ajoutent pas a la lumiere : ils la PORTENT. Multiplies
    // par le halo, ils s'allument seulement la ou il y en a.
    col += feu * nu * (0.35 + halo * 1.6);

    // ---- les champs -------------------------------------------------------
    // Quatre plans, du plus lointain au plus proche. Chacun mange le
    // precedent ; le plus proche est presque noir, ce qui pose le cadre.
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float amp = 0.020 + fi * 0.013;
        float freq = 2.3 + fi * 1.6;
        float y0 = aube_HZ - fi * 0.052;
        float h  = y0 + aube_champ(uv.x, t, freq, amp, fi + 1.0);

        // Le bord se ferme sur deux pixels de cadre, pas plus : une crete
        // floue a cette echelle ressemble a du brouillard, pas a un champ.
        float m = smoothstep(h + 0.004, h - 0.004, uv.y);

        // La crete attrape la lumiere qui vient de derriere. C'est le seul
        // endroit ou les champs sont autre chose que du noir.
        float lisiere = exp(-abs(uv.y - h) * 95.0);
        float versSoleil = exp(-abs(uv.x - aube_CX) * 1.05);

        vec3 plan = mix(terre * (1.0 - fi * 0.22), terre * 0.35, fi * 0.25);
        plan += feu * lisiere * versSoleil * (0.72 - fi * 0.135) * (0.6 + 0.4 * e);

        // Une brume basse posee dans le creux entre deux plans, qui respire.
        float creux = smoothstep(h - 0.010, h - 0.070, uv.y);
        plan += vec3(0.055, 0.042, 0.038) * creux * (0.30 - fi * 0.05)
              * (0.55 + 0.45 * sin(t * 0.031 + fi * 1.9));

        col = mix(col, plan, m);
    }

    // ---- la finition ------------------------------------------------------
    // Le haut du cadre se perd dans le noir : le regard doit tomber vers
    // l'horizon, pas partir en haut de l'ecran.
    col *= mix(0.30, 1.0, smoothstep(0.52, -0.12, uv.y));

    // Un souffle tres lent sur l'ensemble. Une minute et demie de periode :
    // on ne le voit pas bouger, on le voit avoir bouge.
    col *= 0.94 + 0.06 * sin(t * 0.068);

    return aube_tone(col);
}
