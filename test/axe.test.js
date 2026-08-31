/**
 * UN SEUL AXE POUR LES TROIS DESSINS D'ANNÉE.
 *
 * Le quotidien, le cumul et la frise racontent la même période. Ils la
 * plaçaient différemment : les deux graphes par RANG (le i-ème jour écrit à la
 * i-ème position), la frise par DATE. Tant qu'on écrit tous les jours ça se
 * ressemble ; dès qu'il manque une semaine, un repère tombe à côté de
 * l'inflexion qu'il explique — et rien à l'écran ne le signale.
 *
 * Ce qui est tenu ici : la même date se retrouve au même x, avec les mêmes
 * marges, dans les trois. Sinon l'alignement redevient une coïncidence.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CADRE, enJours, domaineDe, lineChart, dailyChart } from '../web/charts.js';
import { friseMarkup } from '../web/frise.js';

/** Le x d'un trait de repère dans un SVG rendu, en unités de viewBox. */
function xDuRepere(svg, label) {
  const bloc = svg.split('<line').find(s => s.includes(label));
  return bloc ? Number(/x1="([\d.]+)"/.exec(bloc)?.[1]) : null;
}

const DOM = { debut: '2026-08-02', fin: '2026-08-31' };
// Un journal TROUÉ : c'est tout l'intérêt. Trois notes sur trente jours.
const DATES = ['2026-08-03', '2026-08-16', '2026-08-30'];

test('un jour est à sa place dans le temps, pas à son rang d’écriture', () => {
  const { debut, largeur } = domaineDe(DATES, DOM);
  const attendu = d => CADRE.PL + ((enJours(d) - debut) / largeur) * (CADRE.W - CADRE.PL - CADRE.PR);

  // Le 16 août est au MILIEU du mois, pas au milieu des trois notes — ce qui
  // serait le cas d'un axe par rang, et donnerait exactement la même image.
  const milieu = attendu('2026-08-16');
  assert.ok(Math.abs(milieu - (CADRE.PL + (CADRE.W - CADRE.PL - CADRE.PR) * 14 / 29)) < 0.01);

  const svg = lineChart(DATES, [1, 2, 3], { domaine: DOM, events: [{ date: '2026-08-16', label: 'REPERE' }] });
  assert.ok(Math.abs(xDuRepere(svg, 'REPERE') - milieu) < 0.2,
            'le repère ne tombe pas sur sa date');
});

test('les trois dessins posent la même date au même endroit', () => {
  const ev = [{ date: '2026-08-16', label: 'REPERE' }];
  const courbe = lineChart(DATES, [1, 2, 3], { domaine: DOM, events: ev });
  const barres = dailyChart(DATES, [1, -2, 3], { domaine: DOM, events: ev });
  const frise = friseMarkup(
    { etendue: { debut: '2026-08-02', fin: '2026-08-31' },
      points: [{ id: 1, date: '2026-08-16', label: 'REPERE', theme: 'jalon', teinte: null, fort: 0 }],
      periodes: [], naissance: null },
    () => '', { mg: CADRE.PL, md: CADRE.PR, domaine: DOM });

  const xc = xDuRepere(courbe, 'REPERE');
  const xb = xDuRepere(barres, 'REPERE');
  const xf = Number(/x1="([\d.]+)"/.exec(frise.split('data-label="REPERE"')[1] ?? '')?.[1]);
  assert.ok(xc != null && xb != null && Number.isFinite(xf), 'un des trois n’a pas dessiné le repère');

  /*
   * UN DEMI-JOUR DE TOLÉRANCE, ET PAS PLUS. Les barres occupent la CASE de leur
   * journée : leur repère se pose au milieu de la case, la courbe au début du
   * jour. La demi-case est la seule différence légitime entre les trois.
   */
  const demiCase = (CADRE.W - CADRE.PL - CADRE.PR) / 30 / 2;
  assert.ok(Math.abs(xc - xf) < 0.2, `courbe ${xc} et frise ${xf} ne se répondent pas`);
  assert.ok(Math.abs(xb - xc) <= demiCase + 0.2, `barres ${xb} et courbe ${xc} s’écartent de plus d’une demi-case`);
});

test('la fenêtre demandée l’emporte sur les journées écrites', () => {
  // « 30 j » doit faire trente jours même avec trois notes dedans, sinon le
  // libellé ment et la frise en dessous ne peut pas s'aligner.
  const large = domaineDe(DATES, DOM);
  const serre = domaineDe(DATES, null);
  assert.equal(large.largeur, 29);
  assert.equal(serre.largeur, 27);   // du 3 au 30 : ce que contiennent les données
  // Sans domaine, on se replie sur les données — un appel isolé reste juste.
  assert.equal(serre.debut, enJours('2026-08-03'));
});

test('un repère sur une journée non notée reste visible', () => {
  /*
   * `dates.indexOf(e.date)` le faisait disparaître : le repère n'existait que
   * si la journée portait une note. Or les jours qui comptent le plus sont
   * souvent ceux où l'on n'a rien écrit.
   */
  const ev = [{ date: '2026-08-10', label: 'SANSNOTE' }];   // pas dans DATES
  assert.ok(xDuRepere(lineChart(DATES, [1, 2, 3], { domaine: DOM, events: ev }), 'SANSNOTE') > 0);
  assert.ok(xDuRepere(dailyChart(DATES, [1, -2, 3], { domaine: DOM, events: ev }), 'SANSNOTE') > 0);
});

test('un repère hors de la fenêtre n’est pas ramené au bord', () => {
  // Le coller au bord désignerait le mauvais jour, sans que rien ne le dise.
  const ev = [{ date: '2020-01-01', label: 'VIEUX' }];
  assert.equal(xDuRepere(lineChart(DATES, [1, 2, 3], { domaine: DOM, events: ev }), 'VIEUX'), null);
  assert.equal(xDuRepere(dailyChart(DATES, [1, -2, 3], { domaine: DOM, events: ev }), 'VIEUX'), null);
});

test('les marges sont les mêmes des deux côtés, et viennent d’un seul endroit', () => {
  // Elles valaient 46/12 pour la courbe et 34/10 pour les barres : douze pixels
  // sur mille, soit trois jours de décalage sur une fenêtre d'un an.
  const a = lineChart(DATES, [1, 2, 3], { domaine: DOM });
  const b = dailyChart(DATES, [1, -2, 3], { domaine: DOM });
  const gaucheDe = svg => Number(/<line class="grid-l" x1="([\d.]+)"/.exec(svg)[1]);
  assert.equal(gaucheDe(a), CADRE.PL);
  assert.equal(gaucheDe(b), CADRE.PL);
  for (const svg of [a, b]) assert.match(svg, new RegExp(`x2="${CADRE.W - CADRE.PR}"`));
});

test('une date se lit pareil quel que soit le fuseau du lecteur', () => {
  // `Date.parse('2026-08-16')` est minuit UTC : à Los Angeles c'est encore le
  // 15, et toute la frise glisserait d'un jour. Midi UTC ne bascule nulle part.
  assert.equal(enJours('2026-08-16') - enJours('2026-08-15'), 1);
  assert.equal(enJours('2026-08-16T23:59:00Z'), enJours('2026-08-16'));
});

test('la frise n’impose pas sa hauteur, sinon elle se recentre et rate l’axe', () => {
  /*
   * LE DÉCALAGE QU'ON NE POUVAIT PAS VOIR EN LISANT LE CODE.
   *
   * `width:100%` avec `height:58px` sur un viewBox de 1000×58 fait deux formes
   * différentes : `preserveAspectRatio` vaut « meet » par défaut, le dessin
   * rentre sans se déformer, et il se CENTRE. Sur douze cents pixels de large,
   * la frise se dessinait sur mille, centrés — cent pixels de vide de chaque
   * côté — pendant que les graphes, eux, s'étirent. Les x étaient identiques
   * dans les trois SVG et les repères tombaient quand même à côté.
   */
  const svg = friseMarkup(
    { etendue: { debut: '2026-08-02', fin: '2026-08-31' },
      points: [{ id: 1, date: '2026-08-16', label: 'REPERE', theme: 'jalon', teinte: null, fort: 0 }],
      periodes: [], naissance: null },
    () => '', { mg: CADRE.PL, md: CADRE.PR, domaine: DOM });
  const ouverture = svg.slice(0, svg.indexOf('>') + 1);
  assert.equal(/height\s*:/.test(ouverture), false,
               'une hauteur fixe recentre le dessin et casse l’alignement');
  assert.match(ouverture, /viewBox="0 0 1000 \d+"/);
});
