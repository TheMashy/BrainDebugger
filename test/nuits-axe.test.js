/**
 * L'AXE DES NUITS. Le graphe allait de 20 h à 14 h, en dur : quelqu'un qui se
 * couche à 5 h et se lève à 16 h voyait ses barres réduites à des tirets — le
 * lever de l'après-midi se repliait AVANT le coucher. Ces tests tiennent la
 * règle qui remplace la norme : l'axe vient des couchers, et la barre fait la
 * durée dormie, où qu'elle tombe dans la journée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { enHeures, enHHMM, versLAvant, origineDesNuits, dureeDeLaNuit,
         poserLesNuits, graduations, medianeHoraire, mediane } from '../web/nuits-axe.js';

const pres = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

test('lire et écrire une heure', () => {
  pres(enHeures('06:10'), 6 + 10 / 60);
  pres(enHeures('00:00'), 0);
  assert.equal(enHeures('24:00'), null);
  assert.equal(enHeures('12:60'), null);
  assert.equal(enHeures(null), null);
  assert.equal(enHHMM(16.25), '16:15');
  assert.equal(enHHMM(30.5), '06:30', 'au-delà d’un tour, on revient sur l’horloge');
  assert.equal(enHHMM(-1), '23:00');
  assert.equal(enHHMM(23.999), '00:00', 'l’arrondi ne fabrique pas 24:00');
});

test('l’écart va dans le sens du temps', () => {
  pres(versLAvant(23, 7), 8);
  pres(versLAvant(5.5, 16.25), 10.75);
  pres(versLAvant(7, 7), 0);
});

test('l’origine se pose dans le plus grand trou, pour un dormeur du soir', () => {
  // Couchers entre 23 h et 1 h : l'axe doit partir vers 22 h, pas à midi.
  const o = origineDesNuits([23, 23.5, 0.5, 1, 23.75]);
  assert.equal(o, 22, `origine ${o}`);
});

test('… et pour un dormeur du matin, il part le matin', () => {
  // C'EST LE CAS QUI CASSAIT TOUT : couchers vers 5-6 h, levers l'après-midi.
  const o = origineDesNuits([5.4, 6.17, 4.8, 5.9, 6.5]);
  assert.equal(o, 3, `origine ${o}`);
});

test('un seul coucher, ou aucun : on ne plante pas', () => {
  assert.equal(origineDesNuits([6.17]), 5);
  assert.equal(origineDesNuits([]), 20, 'un défaut, pas un jugement');
});

test('la durée vient de la mesure, sinon du tour d’horloge', () => {
  pres(dureeDeLaNuit({ sommeil_h: 9.3, coucher: '06:10', lever: '15:30' }), 9.3);
  pres(dureeDeLaNuit({ coucher: '06:10', lever: '15:30' }), versLAvant(enHeures('06:10'), enHeures('15:30')));
  pres(dureeDeLaNuit({ coucher: '23:50', lever: '07:00' }), 7 + 10 / 60);
  assert.equal(dureeDeLaNuit({ coucher: '06:10' }), null);
  assert.equal(dureeDeLaNuit({ sommeil_h: 0, coucher: '06:00', lever: '06:00' }), null);
});

test('LA RÉGRESSION : un coucher à 6 h et un lever à 15 h font une vraie barre', () => {
  const { origine, haut, posees } = poserLesNuits([
    { date: '2026-09-01', coucher: '06:10', lever: '15:30', sommeil_h: 9.3 },
    { date: '2026-09-02', coucher: '05:26', lever: '16:15', sommeil_h: 10.8 }
  ]);
  assert.ok(origine >= 3 && origine <= 5, `origine ${origine}`);
  for (const p of posees) {
    assert.ok(p.de >= 0, 'le coucher tombe dans l’axe');
    assert.ok(p.a > p.de, 'la barre a une hauteur');
    pres(p.a - p.de, p.nuit.sommeil_h);
  }
  assert.ok(haut >= 12 && haut <= 24);
  assert.ok(posees.every(p => p.a <= haut), 'rien ne dépasse l’axe');
});

test('une nuit ordinaire garde sa place, elle aussi', () => {
  const { posees } = poserLesNuits([{ date: 'x', coucher: '23:50', lever: '07:00', sommeil_h: 7.2 }]);
  pres(posees[0].a - posees[0].de, 7.2);
});

test('des nuits mélangées : chacune fait sa durée, aucune ne s’inverse', () => {
  const nuits = [
    { coucher: '23:00', lever: '07:00', sommeil_h: 8 },
    { coucher: '02:30', lever: '11:00', sommeil_h: 8.5 },
    { coucher: '06:10', lever: '15:30', sommeil_h: 9.3 },
    { coucher: '21:40', lever: '05:00', sommeil_h: 7.3 }
  ];
  const { posees, haut } = poserLesNuits(nuits);
  for (const p of posees) {
    pres(p.a - p.de, p.nuit.sommeil_h);
    assert.ok(p.de >= 0 && p.a <= haut, `${p.nuit.coucher}→${p.nuit.lever} sort de l’axe`);
  }
});

test('sans coucher, la nuit est un point ; sans rien, elle n’est nulle part', () => {
  const { posees } = poserLesNuits([{ lever: '15:30' }, {}]);
  assert.ok(posees[0].de != null && posees[0].a === null);
  assert.equal(posees[1].de, null);
});

test('les graduations disent l’heure vraie', () => {
  const g = graduations(4, 12, 2);
  assert.deepEqual(g.map(x => x.texte), ['04:00', '06:00', '08:00', '10:00', '12:00', '14:00', '16:00']);
});

test('la médiane des heures est circulaire', () => {
  // À plat, la médiane de 23:30 et 00:30 vaut midi — l'heure opposée.
  pres(medianeHoraire([23.5, 0.5]), 0);
  pres(medianeHoraire([5.4, 6.17, 4.8]), 5.4);
  assert.equal(medianeHoraire([]), null);
});

test('la médiane des durées, elle, ne tourne pas', () => {
  pres(mediane([7, 9, 8]), 8);
  pres(mediane([7, 9]), 8);
  assert.equal(mediane([]), null);
});
