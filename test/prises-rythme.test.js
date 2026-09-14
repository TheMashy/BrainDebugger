/**
 * =====================================================================
 *  LE RYTHME, ET LA SEULE CHOSE QUI L'EMPÊCHE DE MENTIR.
 *
 * La vue dessinait les jours comptés, PUIS les intervalles entre eux en
 * barres. Le second est dérivé du premier — `seriesSans` ne mesure que l'écart
 * entre deux jours marqués consécutifs — donc la hauteur d'une barre EST
 * l'espacement entre deux barrettes de la frise, ré-encodé à l'envers. Deux
 * dessins, une seule mesure, et aucun des deux ne répond à la question qu'on
 * se pose en ouvrant ce tableau : est-ce que ça se resserre ?
 *
 * La fréquence hebdomadaire y répond. Mais elle ne peut se lire QUE avec son
 * dénominateur : une semaine sans une ligne écrite et une semaine à zéro se
 * dessineraient pareil, et se liraient « il n'y en a pas eu ». C'est
 * l'inversion exacte de la règle du produit — un zéro se lit « c'était
 * gratuit », un trou se lit « on ne sait pas ».
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyserPrises } from '../server/prises.js';

const jour = (d, t) => ({ date: d, note: 5, text: t });
const FUME = 'j ai fume un joint';

test('UNE SEMAINE SANS UNE LIGNE ÉCRITE VAUT null, JAMAIS ZÉRO', () => {
  /*
   * LE DÉFAUT QUE CE TEST GARDE, ET C'EST LE SEUL QUI COMPTE ICI.
   * À zéro, la barre se dessine à ras : l'œil lit une semaine sans
   * consommation. C'est une abstinence inventée, dans un tableau dont tout
   * l'argument est de ne rien inventer sur ce terrain-là.
   */
  const r = analyserPrises([
    jour('2026-03-02', FUME), jour('2026-03-03', 'rien'),
    // 2026-03-09 → rien d'écrit de toute la semaine
    jour('2026-03-16', FUME), jour('2026-03-17', FUME),
  ], { aujourdhui: '2026-03-19' });
  const p = r.prises.find(x => x.cle === 'cannabis');
  assert.ok(p, 'le cannabis n’est pas compté');
  assert.equal(r.semaines.length, 3, `3 semaines attendues, ${r.semaines.length} rendues`);
  assert.equal(r.semaines[1].ecrites, 0, 'la semaine muette n’est pas repérée comme muette');
  assert.equal(p.par_semaine[1], null,
    'la semaine sans une ligne écrite vaut 0 : elle se dessinera comme une semaine sans prise');
  assert.equal(p.par_semaine[0], 1);
  assert.equal(p.par_semaine[2], 2);
});

test('UNE SEMAINE ÉCRITE SANS PRISE VAUT ZÉRO, ET C’EST DIFFÉRENT', () => {
  // L'autre moitié de la même règle : là on SAIT, et on doit pouvoir le dire.
  // Trois journées avec : c'est le seuil du moteur (SEUILS_PRISES.min_jours).
  const r = analyserPrises([
    jour('2026-03-02', FUME), jour('2026-03-03', FUME),
    jour('2026-03-10', 'journée tranquille, rien de spécial'),
    jour('2026-03-16', FUME),
  ], { aujourdhui: '2026-03-19' });
  const p = r.prises.find(x => x.cle === 'cannabis');
  assert.equal(p.par_semaine[1], 0, 'une semaine écrite sans prise est rendue « on ne sait pas »');
  assert.equal(r.semaines[1].ecrites, 1);
});

test('LES SEMAINES DU CALENDRIER SONT TOUTES LÀ, TROUS COMPRIS', () => {
  // Ne garder que les semaines écrites tasserait le dessin : deux barres
  // côte à côte séparées en vrai par deux mois se liraient comme deux
  // semaines de suite. L'axe doit être le temps, pas le rang.
  const r = analyserPrises([jour('2026-01-05', FUME), jour('2026-03-02', FUME), jour('2026-03-03', FUME)],
                           { aujourdhui: '2026-03-04' });
  assert.equal(r.semaines.length, 9, `${r.semaines.length} semaines pour 8 semaines d’écart`);
  assert.equal(r.semaines.filter(s => s.ecrites === 0).length, 7);
});

test('LE SOL EST PARTAGÉ, ET CHAQUE PRISE EST ALIGNÉE DESSUS', () => {
  // Deux familles, deux `par_semaine` : s'ils n'ont pas la même longueur que
  // `semaines`, la vue superposerait deux axes décalés — pire que deux blocs.
  const r = analyserPrises([
    jour('2026-03-02', FUME), jour('2026-03-03', 'j ai bu trois bieres'),
    jour('2026-03-09', FUME), jour('2026-03-10', 'j ai bu deux verres de vin'),
    jour('2026-03-16', FUME), jour('2026-03-17', 'j ai bu quatre pintes'),
  ], { aujourdhui: '2026-03-18' });
  assert.ok(r.prises.length >= 2, `une seule famille comptée : ${r.prises.map(p => p.cle)}`);
  for (const p of r.prises)
    assert.equal(p.par_semaine.length, r.semaines.length,
      `« ${p.cle} » a ${p.par_semaine.length} semaines pour un sol de ${r.semaines.length}`);
});

test('AUCUN RECORD DE SEMAINES À ZÉRO N’EST CALCULÉ', () => {
  /*
   * CE QUI RÉTABLIRAIT L'INTERDIT. « 6 semaines d'affilée à 0 » est un
   * compteur d'abstinence déguisé : il se remet à zéro au premier écart, et
   * c'est exactement ce que l'argument Marlatt en tête de prises.js refuse —
   * transformer un soir en échec total est ce qui fait enchaîner.
   *
   * On garde donc la matière (`par_semaine`) sans jamais en tirer de série.
   */
  const r = analyserPrises([
    jour('2026-03-02', FUME), jour('2026-03-03', FUME),
    jour('2026-03-09', 'rien'), jour('2026-03-16', 'rien'), jour('2026-03-23', 'rien'),
    jour('2026-03-30', FUME),
  ], { aujourdhui: '2026-03-31' });
  const p = r.prises.find(x => x.cle === 'cannabis');
  for (const clef of Object.keys(p))
    assert.equal(/^(?:semaines_sans|record_semaines|meilleure_semaine|streak)/.test(clef), false,
      `« ${clef} » ressemble à un record de semaines à zéro`);
});
