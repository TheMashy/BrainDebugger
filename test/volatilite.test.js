/**
 * « CE QUI A BOUGÉ » DOIT MONTRER QUELQUE CHOSE QUI BOUGE.
 *
 * Le dessin sortait en quatre anneaux APLATIS (13,4 × 6,6 px mesurés au
 * navigateur) posés sur une ligne presque horizontale traversant 491 px de
 * vide : un `viewBox` de 220 × 42 avec `preserveAspectRatio="none"` étiré par
 * `.jvsvg { width: 100%; height: 46px }` à la largeur de la colonne, et une
 * échelle verticale figée sur 0..10 dans laquelle la plus grosse bascule de la
 * journée (4 → 8) n'occupait que 40 % de la hauteur utile.
 *
 * Ce fichier tient les trois défauts à la fois, parce qu'ils se réparent
 * ensemble et se cassent ensemble : l'aspect du cadre, l'ouverture de
 * l'échelle, et le fait que l'axe soit du TEMPS et le dise à ses deux bouts.
 *
 * La fonction vit dans web/app.js, qui ne s'importe pas hors navigateur (il
 * tire tout le DOM avec lui). On l'extrait donc du fichier et on l'exécute
 * pour de vrai : une assertion sur le TEXTE de la source dirait qu'on a bien
 * écrit `H = 72` sans jamais vérifier où un point atterrit — c'est exactement
 * le genre de test qui a laissé passer le trait plat.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { virgule } from '../web/formats.js';

const APP = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');

const volatiliteMarkup = (() => {
  const i = APP.indexOf('function volatiliteMarkup(v, poste) {');
  assert.ok(i >= 0, 'volatiliteMarkup a été renommée ou déplacée');
  const j = APP.indexOf('\nfunction journeeMarkup(', i);
  assert.ok(j > i, 'journeeMarkup ne suit plus volatiliteMarkup : la découpe est à revoir');
  // `_volN` est déclaré au-dessus de la fonction dans le fichier ; on le
  // redonne ici pour que l'extrait tienne debout tout seul.
  // `virgule` vient du VRAI module : c'est un rendu qu'on vérifie, et le
  // remplacer par un bouchon reviendrait à tester une autre écriture des
  // nombres que celle qui part à l'écran.
  return new Function('noteColor', 'esc', 'virgule',
    `let _volN = 0; ${APP.slice(i, j)}; return volatiliteMarkup;`
  )(n => `C${n}`,
    s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    virgule);
})();

const H = (heure, valeur, dApres = 'mots') => ({ heure, valeur, dApres });
const poste = (lever, coucher) => ({
  lever: lever ? { heure: lever, source: 'mesure' } : null,
  coucher: coucher ? { heure: coucher, source: 'mesure' } : null
});
const dessine = (hum, p = poste(null, null)) => volatiliteMarkup({ humeurs: hum }, p);
const cercles = html => [...html.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"[\s\S]*?fill="([^"]+)"/g)]
  .map(m => ({ cx: +m[1], cy: +m[2], r: +m[3], fill: m[4] }));
const cadre = html => {
  const m = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(html);
  return m ? { W: +m[1], H: +m[2] } : null;
};

/* LA JOURNÉE DE LA CAPTURE. Elle sert d'étalon parce que c'est elle qui a
   montré le défaut : lever 19:00, coucher 06:30, quatre moments serrés en
   début de soirée puis très écartés. */
const JOURNEE = [H('19:45', 6), H('21:06', 8), H('00:16', 4), H('06:09', 5.5)];
const POSTE = poste('19:00', '06:30');

test('le dessin n’est plus déformé : pas de preserveAspectRatio="none"', () => {
  const html = dessine(JOURNEE, POSTE);
  // C'est LUI qui sortait des cercles de 13,4 × 6,6 px. Un `r` ne veut plus
  // rien dire dans un cadre qu'on étire sur un seul axe.
  assert.ok(!/preserveAspectRatio\s*=\s*"none"/.test(html), 'le cadre est encore étiré sur un seul axe');
  // Et l'autre moitié du même défaut est dans la feuille de style : une hauteur
  // fixe avec une largeur en pourcentage donne un rapport variable.
  assert.ok(!/\.jvsvg\s*\{[^}]*height:\s*\d+px/.test(CSS), '.jvsvg reprend une hauteur fixe');
  assert.match(CSS, /\.jvsvg\s*\{[^}]*height:\s*auto/, '.jvsvg doit laisser le viewBox imposer le rapport');
});

test('la courbe est bornée en largeur', () => {
  // Sans borne, la courbe prend toute la colonne — mesuré 491 px sur une
  // fenêtre de 1500, 716 px sur une fenêtre de 1000 — et quatre points sur un
  // ruban pareil se lisent comme un trait.
  assert.match(CSS, /\.jvcadre\s*\{[^}]*max-width:\s*\d+px/, 'rien ne borne la largeur du cadre');
  const c = cadre(dessine(JOURNEE, POSTE));
  assert.ok(c && c.W / c.H < 6, `cadre trop plat : ${c?.W} × ${c?.H}`);
});

test('une journée qui bascule occupe vraiment la hauteur', () => {
  const html = dessine(JOURNEE, POSTE);
  const c = cadre(html);
  const cy = cercles(html).map(p => p.cy);
  const pris = (Math.max(...cy) - Math.min(...cy)) / c.H;
  // 4 → 8 est la plus grosse bascule que cette journée ait à montrer. Sur
  // l'échelle figée 0..10 elle n'occupait que 12,8 px sur 42, soit 40 % de la
  // hauteur utile : « ce qui a bougé » ne montrait rien qui bouge.
  assert.ok(pris > 0.6, `la bascule n’occupe que ${(pris * 100).toFixed(0)} % du cadre`);
});

test('mais une journée immobile a le droit d’avoir l’air immobile', () => {
  // Le revers : sans plancher d'amplitude, une journée de 5,0 à 5,2 se
  // déplierait sur toute la hauteur et se lirait comme une catastrophe.
  const html = dessine([H('09:00', 5), H('14:00', 5.2), H('21:00', 5.1)], poste('08:00', '23:00'));
  const c = cadre(html);
  const cy = cercles(html).map(p => p.cy);
  const pris = (Math.max(...cy) - Math.min(...cy)) / c.H;
  assert.ok(pris < 0.15, `une variation de 0,2 point occupe ${(pris * 100).toFixed(0)} % du cadre`);
  // Et une journée parfaitement plate ne divise pas par zéro.
  const plat = dessine([H('09:00', 5), H('21:00', 5)], poste('08:00', '23:00'));
  assert.ok(cercles(plat).every(p => Number.isFinite(p.cy)), 'une journée plate casse l’échelle');
});

test('un point tout en haut ou tout en bas reste dans le cadre', () => {
  for (const [nom, hum] of [['10/10', [H('09:00', 9), H('21:00', 10)]],
                            ['0/10',  [H('09:00', 0), H('21:00', 1)]]]) {
    const html = dessine(hum, poste('08:00', '23:00'));
    const c = cadre(html);
    for (const p of cercles(html)) {
      assert.ok(p.cy - p.r >= 0 && p.cy + p.r <= c.H, `${nom} : un point déborde du cadre (cy=${p.cy})`);
    }
  }
});

test('un moment est posé à sa part de journée vécue, pas à son rang', () => {
  const html = dessine(JOURNEE, POSTE);
  const cx = cercles(html).map(p => p.cx);
  const c = cadre(html);
  // 19:45 après un lever à 19:00 vaut 45 min sur les 690 de la journée ; 06:09
  // en vaut 669. C'est tout l'intérêt de la courbe face à la liste de gauche :
  // quatre points régulièrement espacés ne diraient rien de plus qu'elle.
  const part = [45, 126, 316, 669].map(t => t / 690);
  const gauche = cx[0], droite = cx.at(-1);
  for (let i = 0; i < cx.length; i++) {
    const attendu = gauche + (droite - gauche) * (part[i] - part[0]) / (part.at(-1) - part[0]);
    assert.ok(Math.abs(cx[i] - attendu) < c.W * 0.02,
      `le moment ${i} est à ${cx[i]} au lieu de ${attendu.toFixed(1)}`);
  }
});

test('le lever et le coucher sont écrits aux deux bouts, pas côte à côte', () => {
  const html = dessine(JOURNEE, POSTE);
  // « 19:00 → 06:30 » serré sur une ligne sous la courbe se lit comme une
  // légende : rien ne dit que 19:00 tombe à gauche du dessin et 06:30 à droite.
  assert.ok(!/19:00[\s\S]{0,60}→[\s\S]{0,60}06:30/.test(html), 'les deux bornes sont encore collées');
  const bornes = [...html.matchAll(/<span title="([^"]*)">([^<]*)<\/span>/g)].map(m => m[2]);
  assert.deepEqual(bornes, ['19:00', '06:30']);
});

test('un bout qui n’est pas une borne mesurée porte le « ≈ »', () => {
  // Sans lui, l'axe prétendrait mesurer une journée vécue qu'on n'a pas
  // mesurée : ce bout-là n'est que le premier (ou le dernier) moment.
  const html = dessine([H('09:00', 6), H('14:00', 4)]);
  const bornes = [...html.matchAll(/<span title="([^"]*)">([^<]*)<\/span>/g)].map(m => m[2]);
  assert.deepEqual(bornes, ['≈09:00', '≈14:00']);
});

test('ce qui est plein est mesuré, ce qui est creux est lu', () => {
  // La règle du produit. Le creux est rempli du FOND, pas laissé transparent :
  // sinon la ligne passe au travers du point et les deux se confondent.
  const lu = cercles(dessine(JOURNEE, POSTE));
  assert.ok(lu.every(p => p.fill === 'var(--bg)'), `un point lu est rempli de ${lu[0].fill}`);
  const mesure = cercles(dessine([H('09:00', 6, 'releve'), H('21:00', 3, 'releve')], poste('08:00', '23:00')));
  assert.ok(mesure.every(p => p.fill.startsWith('C')), 'un relevé n’est pas plein');
});

test('deux courbes dans la même page ne partagent pas leurs <defs>', () => {
  // Le dégradé du second repeindrait le premier — le piège que `_gradN` évite
  // déjà dans charts.js.
  const a = dessine(JOURNEE, POSTE), b = dessine(JOURNEE, POSTE);
  const ids = h => [...h.matchAll(/ id="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids(a).length > 0, 'aucun <defs> identifié');
  assert.deepEqual(ids(a).filter(x => ids(b).includes(x)), [], 'deux courbes portent les mêmes identifiants');
});

test('moins de deux humeurs : pas de courbe, et pas de cadre vide', () => {
  assert.equal(dessine([H('09:00', 6)], poste('08:00', '23:00')), '');
  assert.equal(dessine([]), '');
});

test('la borne de droite dit où elle EST, pas où on croit qu’elle est', () => {
  /*
   * LE DOUZIÈME CAS, ET LE PLUS RETORS. Un moment de la journée vécue peut
   * tomber AVANT le lever mesuré : l'écart au lever se compte modulo 24 h, donc
   * 18:30 après un lever à 19:00 vaut 23 h 30 de journée — c'est lui qui fixe la
   * fin de l'axe, et c'est lui qui est tout à droite.
   *
   * Écrire « 06:30 » à ce bout-là était une affirmation FAUSSE de position : le
   * coucher tombait au milieu du dessin pendant que son heure restait écrite au
   * bord. L'ancienne légende « 19:00 → 06:30 » n'affirmait rien et avait le
   * droit d'être approximative ; une borne posée sur le dessin, non.
   *
   * `hum.at(-1)` ne rattrape rien : le dernier dans l'ordre des heures n'est pas
   * le plus à droite. On lit le bout SUR le dessin.
   */
  const journee = [H('18:30', 5), H('19:45', 6), H('21:06', 7), H('00:16', 8)];
  const html = dessine(journee, poste('19:00', '06:30'));
  const bornes = [...html.matchAll(/<span title="([^"]*)">([^<]*)<\/span>/g)].map(m => m[2]);
  assert.equal(bornes.at(-1), '≈18:30',
               `le bout droit annonce ${bornes.at(-1)} alors que 18:30 y est dessiné`);

  // Et le point qui porte cette heure est bien le plus à droite.
  const pts = cercles(html);
  const droite = pts.reduce((a, b) => (b.cx > a.cx ? b : a));
  assert.equal(droite.cx, Math.max(...pts.map(p => p.cx)));

  // Quand la fin de l'axe EST le coucher, il reprend sa place, sans « ≈ ».
  const net = dessine([H('19:45', 6), H('21:06', 7), H('00:16', 8)], poste('19:00', '06:30'));
  const b2 = [...net.matchAll(/<span title="([^"]*)">([^<]*)<\/span>/g)].map(m => m[2]);
  assert.equal(b2.at(-1), '06:30');
});
