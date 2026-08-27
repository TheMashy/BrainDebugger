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

import { SCENES_GLSL, SCENE_IDS } from './scenes.js';

/* Les aides communes à toutes les scènes. Elles sont ici et pas dans les
   fichiers de scène : deux définitions du même `fbm` ne compilent pas. */
const PREAMBULE = `
precision highp float;

uniform vec2  uRes;
uniform float uTime;
uniform int   uA;
uniform int   uB;
uniform float uMix;
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

/* Le répartiteur. Une chaîne de `if` sur un uniform entier : le branchement est
   uniforme sur tout l'écran, donc le GPU n'en exécute qu'une seule. */
function dispatcher(ids) {
  const branches = ids
    .map((id, i) => `  if (n == ${i}) return scene_${id}(uv, t, e);`)
    .join('\n');
  return `
vec3 sceneAt(int n, vec2 uv, float t, float e) {
${branches}
  return vec3(0.0);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  vec3 a = sceneAt(uA, uv, uTime, uEnergy);
  vec3 c = a;
  // On n'évalue la seconde scène que pendant la transition : hors fondu, ça
  // doublerait le coût du pixel pour rien.
  if (uMix > 0.001) c = mix(a, sceneAt(uB, uv, uTime, uEnergy), uMix);

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

export const Ambiance = {
  gl: null, prog: null, u: {}, canvas: null,
  a: 0, b: 0, mixDebut: 0, enFondu: false,
  energie: 0.35, cibleEnergie: 0.35,
  t0: 0, raf: null, actif: false,

  /** @returns {boolean} false si WebGL est indisponible — l'app marche sans. */
  start() {
    if (this.gl) return true;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return false;

    const c = document.createElement('canvas');
    c.id = 'ambiance';
    document.body.prepend(c);

    const gl = c.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      powerPreference: 'low-power', preserveDrawingBuffer: false
    });
    if (!gl) { c.remove(); return false; }

    const src = PREAMBULE + SCENES_GLSL + dispatcher(SCENE_IDS);
    const prog = compile(gl, VERT, src);
    if (!prog) { c.remove(); return false; }

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.useProgram(prog);
    for (const n of ['uRes', 'uTime', 'uA', 'uB', 'uMix', 'uEnergy']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }

    this.gl = gl; this.prog = prog; this.canvas = c;
    this.t0 = performance.now();
    this.resize();
    addEventListener('resize', () => this.resize(), { passive: true });
    // Onglet caché : on arrête tout. Personne ne regarde, et une boucle de rendu
    // en arrière-plan est de la batterie prise à quelqu'un qui ne l'a pas demandé.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.pause(); else this.resume();
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
    const courante = this.enFondu ? this.b : this.a;
    if (n === courante) return;
    // Un fondu en cours : on repart de l'image telle qu'elle est maintenant
    // plutôt que de sauter à sa destination.
    if (this.enFondu) this.a = courante;
    this.b = n;
    this.mixDebut = performance.now();
    this.enFondu = true;
  },

  pause() { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = null; } this.actif = false; },

  resume() {
    if (this.actif || !this.gl) return;
    this.actif = true;
    let dernier = 0;
    const boucle = now => {
      this.raf = requestAnimationFrame(boucle);
      if (now - dernier < 33) return;          // ~30 images/s suffisent largement
      dernier = now;
      this.frame(now);
    };
    this.raf = requestAnimationFrame(boucle);
  },

  frame(now) {
    const gl = this.gl;
    let m = 0;
    if (this.enFondu) {
      m = Math.min(1, (now - this.mixDebut) / DUREE_FONDU);
      // Courbe douce aux deux bouts : un fondu linéaire se voit démarrer.
      m = m * m * (3.0 - 2.0 * m);
      if (m >= 1) { this.a = this.b; this.enFondu = false; m = 0; }
    }
    // L'énergie glisse elle aussi : elle change avec la note, et une note posée
    // ne doit pas faire bondir le fond.
    this.energie += (this.cibleEnergie - this.energie) * 0.02;

    gl.uniform2f(this.u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.uTime, (now - this.t0) / 1000);
    gl.uniform1i(this.u.uA, this.a);
    gl.uniform1i(this.u.uB, this.enFondu ? this.b : this.a);
    gl.uniform1f(this.u.uMix, m);
    gl.uniform1f(this.u.uEnergy, this.energie);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
};

function compile(gl, vsrc, fsrc) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      // On journalise et on renonce : un fond absent est sans conséquence,
      // une page blanche ne l'est pas.
      console.warn('[ambiance] shader refusé :', gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const v = sh(gl.VERTEX_SHADER, vsrc);
  const f = sh(gl.FRAGMENT_SHADER, fsrc);
  if (!v || !f) return null;
  const p = gl.createProgram();
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.warn('[ambiance] édition de liens refusée :', gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}
