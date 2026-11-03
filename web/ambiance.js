/**
 * Le fond.
 *
 * Un shader plein écran, très sombre, derrière toute l'interface. Il change de
 * scène selon ce dont on parle et selon la note du jour — lentement, sans jamais
 * le dire. L'idée est qu'à force d'y revenir, l'ambiance raconte quelque chose
 * qu'on ne saurait pas formuler : c'est ce que fait un jeu comme Journey.
 *
 * Trois règles qui décident de tout ici :
 *
 *   1. Ça ne doit jamais prendre le pas sur le texte. Luminosité plafonnée dans
 *      les scènes elles-mêmes, et un voile sombre par-dessus au centre.
 *   2. Ça ne doit jamais sauter. Toute transition dure une dizaine de secondes.
 *      Un fond qui change d'un coup est un effet ; un fond qui a changé sans
 *      qu'on l'ait vu changer est une ambiance.
 *   3. Ça ne doit jamais coûter la batterie de quelqu'un qui écrit. Rendu à
 *      demi-résolution, 30 images par seconde, arrêt complet quand l'onglet est
 *      caché ou que la personne a demandé moins d'animations.
 *
 * Aucune dépendance : WebGL 1, GLSL ES 1.00, un quad plein écran.
 */

import { SCENES, SCENE_IDS } from './scenes.js';

/* Les aides communes à toutes les scènes. Elles sont ici et pas dans les
   fichiers de scène : deux définitions du même `fbm` ne compilent pas. */
const PREAMBULE = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform float uEnergy;

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  return fract(p * (p + p));
}
float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * noise2(p);
    p *= 2.02;
    a *= 0.5;
  }
  return s;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdSphere(vec3 p, float r) { return length(p) - r; }
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
`;

/*
 * UN PROGRAMME PAR SCÈNE, PLUS DE RÉPARTITEUR.
 *
 * Les dix scènes étaient compilées ensemble, derrière une chaîne de `if` sur
 * un uniform : un seul shader de 58 ko. Sur Chrome/Windows, ANGLE le traduit
 * pour Direct3D en dépliant chaque branche, et la compilation se compte alors
 * en secondes — page figée à l'ouverture, et parfois le processus GPU qui
 * tombe (le chien de garde de Windows coupe ce qui tient la carte trop
 * longtemps), Chrome avec lui. Une seule scène est à l'écran : on ne compile
 * qu'elle (2 à 4 ko), et la suivante seulement quand on y va.
 *
 * Le fondu ne mélange plus deux scènes dans le même pixel : on peint l'une,
 * puis l'autre par-dessus avec une opacité constante (`blendColor`). Le
 * traitement final (gain, voile central, plafond, grain) est appliqué à
 * chacune ; le plafond étant le même des deux côtés, le mélange reste dessous.
 */
function sourceDe(id) {
  return PREAMBULE + SCENES[id] + `
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 c = scene_${id}(uv, uTime, uEnergy);

  // Les scenes sont ecrites tres sombres par contrat (0.28 maximum). Telles
  // quelles, derriere l'interface, elles ne se voyaient tout simplement pas :
  // le fond avait l'air eteint. Ce gain les remonte a une presence reelle sans
  // toucher aux scenes elles-memes -- un seul endroit a regler.
  c *= 2.4;

  // Le texte se lit dans la bande centrale : on y assombrit, mais moins fort
  // qu'avant. Trop de voile et il ne reste rien a voir ; pas assez et le texte
  // se bat avec le decor. Le compromis se mesure : on vise moins de 0.05 de
  // luminance sous la colonne de lecture.
  float d = length(uv * vec2(0.52, 1.0));
  c *= mix(0.34, 1.0, smoothstep(0.10, 0.95, d));

  // Plafond dur : quoi qu'une scene renvoie, rien ne monte assez haut pour
  // concurrencer du texte blanc.
  c = min(c, vec3(0.26));

  // Grain de dithering : sans lui, les dégradés très sombres se cassent en
  // bandes visibles sur un écran 8 bits, et c'est tout ce qu'on voit.
  c += (hash21(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5) * 0.006;

  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;
}

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const DUREE_FONDU = 9000;   // ms — assez lent pour qu'on ne voie pas le changement

/*
 * QUAND LA MACHINE NE SUIT PAS, LE FOND S'EFFACE.
 *
 * Vu en vrai : attente au chargement, PC qui rame, Claude qui plante à côté.
 * Ce shader est léger sur une carte graphique ; il ne l'est plus du tout quand
 * Chrome rend sur le PROCESSEUR — accélération matérielle coupée, ou retombée
 * après un plantage du GPU. Mesuré ainsi : 150 à 300 ms par image, en continu.
 * Un décor ne vaut pas ça.
 *
 * Trois gardes :
 *   - pas de démarrage si le rendu est logiciel (SwiftShader, llvmpipe…) ;
 *   - arrêt si LENTS_MAX images d'affilée arrivent à plus de LENT_MS d'écart ;
 *   - arrêt si le GPU se réinitialise (contexte WebGL perdu).
 * Les deux derniers sont RETENUS sur cet appareil une semaine : la machine
 * n'a pas suivi, on ne lui redemande pas à chaque ouverture.
 */
export const RENDU_LOGICIEL = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i;
export const LENT_MS = 150;
export const LENTS_MAX = 8;
const MEMO = 'bd-fond-coupe';
const MEMO_DUREE = 7 * 86400000;

/** Le compte d'images lentes d'affilée — remis à zéro par la première qui suit. */
export const compterLenteur = (lents, ecart) => (ecart > LENT_MS ? lents + 1 : 0);

function lireMemo() {
  try {
    const m = JSON.parse(localStorage.getItem(MEMO) || 'null');
    return m && Date.now() - m.quand < MEMO_DUREE ? m.raison : null;
  } catch { return null; }
}
function ecrireMemo(raison) {
  try { localStorage.setItem(MEMO, JSON.stringify({ raison, quand: Date.now() })); } catch { /* stockage refusé */ }
}
function oublierMemo() { try { localStorage.removeItem(MEMO); } catch { /* idem */ } }

export const Ambiance = {
  gl: null, progs: new Map(), canvas: null, parallele: null,
  coupe: false, raison: null,
  a: 0, b: 0, mixDebut: 0, enFondu: false,
  energie: 0.35, cibleEnergie: 0.35,
  t0: 0, raf: null, actif: false, peint: false,

  /** @returns {boolean} false si WebGL est indisponible — l'app marche sans. */
  start({ forcer = false } = {}) {
    if (forcer) oublierMemo();
    if (this.gl) {
      if (this.coupe) { this.coupe = false; this.raison = null; this.canvas.style.display = ''; this.resume(); }
      return true;
    }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
    const memo = lireMemo();
    if (memo) { this.raison = memo; return false; }

    const c = document.createElement('canvas');
    c.id = 'ambiance';
    document.body.prepend(c);

    const gl = c.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false
    });
    if (!gl) { c.remove(); return false; }

    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const rendu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) || '');
    if (RENDU_LOGICIEL.test(rendu)) {
      c.remove();
      this.raison = 'le navigateur dessine sans carte graphique';
      return false;
    }
    c.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      this.couper('la carte graphique a été réinitialisée', true);
    });

    // Compilation EN FOND quand le navigateur sait le faire : la page ne
    // s'arrête pas le temps que la carte graphique digère le shader.
    this.parallele = gl.getExtension('KHR_parallel_shader_compile');

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.blendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);

    this.gl = gl;
    // La scène de départ, lancée tout de suite ; elle sera dessinée dès prête.
    if (!this.programme(this.a)) { c.remove(); this.gl = null; return false; }

    this.canvas = c;
    this.t0 = performance.now();
    this.resize();
    addEventListener('resize', () => this.resize(), { passive: true });
    // Onglet caché : on arrête tout. Personne ne regarde, et une boucle de rendu
    // en arrière-plan est de la batterie prise à quelqu'un qui ne l'a pas demandé.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pause(); else if (!this.coupe) this.resume();
    });
    this.resume();
    return true;
  },

  resize() {
    if (!this.gl) return;
    // Demi-résolution : un fond flou et lent n'a aucun besoin des pixels d'un
    // écran Retina, et ça divise le coût par quatre.
    const r = Math.min(devicePixelRatio || 1, 2) * 0.5;
    const w = Math.max(1, Math.round(innerWidth * r));
    const h = Math.max(1, Math.round(innerHeight * r));
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w; this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  },

  /**
   * Change de scène. Sans effet si c'est déjà celle affichée — sinon un fondu
   * repartirait de zéro à chaque message et le fond battrait.
   */
  set(sceneId, energie) {
    if (energie !== undefined && energie !== null) this.cibleEnergie = energie;
    const n = SCENE_IDS.indexOf(sceneId);
    if (n < 0 || !this.gl) return;
    // Rien n'est encore à l'écran : on va droit à la bonne scène. Fondre depuis
    // la scène par défaut obligerait à en compiler deux au démarrage pour un
    // fondu que personne n'a vu commencer.
    if (!this.peint) { this.a = n; this.enFondu = false; this.programme(n); return; }
    const courante = this.enFondu ? this.b : this.a;
    if (n === courante) return;
    // Un fondu en cours : on repart de l'image telle qu'elle est maintenant
    // plutôt que de sauter à sa destination.
    if (this.enFondu) this.a = courante;
    this.b = n;
    this.programme(n);              // compilée pendant qu'on attend le fondu
    this.mixDebut = null;           // le fondu part quand elle est prête
    this.enFondu = true;
  },

  /**
   * Le programme d'une scène, compilé au premier besoin. Rend l'entrée (prête
   * ou en cours), ou null si la scène ne compile pas — alors le fond se coupe,
   * comme avant quand le shader unique était refusé.
   */
  programme(n) {
    if (this.progs.has(n)) return this.progs.get(n);
    const id = SCENE_IDS[n];
    const p = id && SCENES[id] ? lancer(this.gl, VERT, sourceDe(id)) : null;
    if (!p) { this.couper?.('le fond animé ne compile pas sur cet appareil'); return null; }
    const e = { prog: p.prog, v: p.v, f: p.f, pret: false, u: {} };
    this.progs.set(n, e);
    return e;
  },

  /** Prête à dessiner ? Vérifie sans bloquer quand la compilation est en fond. */
  pret(n) {
    const e = this.progs.get(n);
    if (!e) return false;
    if (e.pret) return true;
    const gl = this.gl;
    if (this.parallele && !gl.getProgramParameter(e.prog, this.parallele.COMPLETION_STATUS_KHR)) return false;
    if (!finir(gl, e)) { this.progs.delete(n); this.couper('le fond animé ne compile pas sur cet appareil'); return false; }
    for (const k of ['uRes', 'uTime', 'uEnergy']) e.u[k] = gl.getUniformLocation(e.prog, k);
    e.pret = true;
    return true;
  },

  pause() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; } this.actif = false; },

  /** Arrête le fond et le cache. `retenir` : cet appareil ne le relancera pas avant une semaine. */
  couper(raison, retenir = false) {
    this.coupe = true;
    this.raison = raison;
    this.pause();
    if (this.canvas) this.canvas.style.display = 'none';
    if (retenir) ecrireMemo(raison);
  },

  resume() {
    if (this.actif || !this.gl || this.coupe) return;
    this.actif = true;
    let dernier = 0, lents = 0;
    const boucle = now => {
      this.raf = requestAnimationFrame(boucle);
      if (now - dernier < 33) return;          // ~30 images/s suffisent largement
      lents = dernier ? compterLenteur(lents, now - dernier) : 0;
      dernier = now;
      if (lents >= LENTS_MAX) {
        this.couper('la machine ne suivait pas le fond animé', true);
        return;
      }
      this.frame(now);
    };
    this.raf = requestAnimationFrame(boucle);
  },

  frame(now) {
    const gl = this.gl;
    // Rien n'est peint tant que la scène n'est pas prête : le fond reste noir
    // une fraction de seconde, la page, elle, n'attend pas.
    if (!this.pret(this.a)) return;
    let m = 0;
    if (this.enFondu) {
      if (!this.pret(this.b)) { this.mixDebut = null; }
      else {
        this.mixDebut ??= now;
        m = Math.min(1, (now - this.mixDebut) / DUREE_FONDU);
        // Courbe douce aux deux bouts : un fondu linéaire se voit démarrer.
        m = m * m * (3.0 - 2.0 * m);
        if (m >= 1) { this.a = this.b; this.enFondu = false; m = 0; }
      }
    }
    // L'énergie glisse elle aussi : elle change avec la note, et une note posée
    // ne doit pas faire bondir le fond.
    this.energie += (this.cibleEnergie - this.energie) * 0.02;

    const peindre = (n, alpha) => {
      const e = this.progs.get(n);
      gl.useProgram(e.prog);
      gl.uniform2f(e.u.uRes, this.canvas.width, this.canvas.height);
      gl.uniform1f(e.u.uTime, (now - this.t0) / 1000);
      gl.uniform1f(e.u.uEnergy, this.energie);
      if (alpha < 1) { gl.enable(gl.BLEND); gl.blendColor(0, 0, 0, alpha); }
      else gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    peindre(this.a, 1);
    this.peint = true;
    // La seconde scène n'est peinte que pendant la transition : hors fondu,
    // ça doublerait le coût du pixel pour rien.
    if (m > 0.001) peindre(this.b, m);
  }
};

/*
 * Compiler en deux temps. `lancer` envoie les sources et l'édition de liens
 * SANS lire le résultat : lire un statut force le navigateur à attendre la fin
 * de la compilation, et c'est cette attente qui figeait la page. `finir` lit
 * le statut une fois la compilation terminée (ou tout de suite si le
 * navigateur ne sait pas compiler en fond).
 */
function lancer(gl, vsrc, fsrc) {
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const v = sh(gl.VERTEX_SHADER, vsrc);
  const f = sh(gl.FRAGMENT_SHADER, fsrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, v); gl.attachShader(prog, f);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  return { prog, v, f };
}

function finir(gl, e) {
  if (gl.getProgramParameter(e.prog, gl.LINK_STATUS)) return true;
  // On journalise et on renonce : un fond absent est sans conséquence,
  // une page blanche ne l'est pas.
  for (const s of [e.v, e.f]) {
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.warn('[ambiance] shader refusé :', gl.getShaderInfoLog(s));
  }
  console.warn('[ambiance] édition de liens refusée :', gl.getProgramInfoLog(e.prog));
  return false;
}
