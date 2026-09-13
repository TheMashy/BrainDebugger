/**
 * =====================================================================
 *  ON COUPAIT DES JOURNÉES ENTIÈRES POUR ESQUIVER QUATRE SOIRÉES.
 *
 * Mesuré sur un journal réel de 27 journées écrites : la médiane pèse 1 456
 * signes, et quatre soirées en pèsent 64 034 — 62 % de tout. Sur la fenêtre de
 * quatorze, ces quatre-là font les trois quarts du poids.
 *
 * Le seul réglage disponible était le NOMBRE de journées. Baisser de 14 à 7,
 * c'était perdre sept journées de contexte pour esquiver deux grosses soirées.
 *
 * Un plafond par journée coûte 5 journées écourtées sur 14 au lieu de 7
 * supprimées, et rend presque la moitié du poids. Ce qui le rend acceptable et
 * distingue ce plafond-ci de celui qu'on vient de retirer : IL SE DIT. La
 * coupe est écrite dans la journée coupée, avec l'outil qui lit le reste.
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { couperJournee, memoryBlock, PLAFOND_JOURNEE } from '../server/chat.js';

const phrase = 'Une phrase entière qui se termine ici. ';
const jour = n => phrase.repeat(Math.ceil(n / phrase.length)).slice(0, n);

test('UNE JOURNÉE ORDINAIRE N’EST PAS TOUCHÉE', () => {
  // La médiane réelle fait 1 456 signes : l'écrasante majorité doit passer
  // intacte, sinon ce n'est plus un plafond, c'est un résumé.
  const t = jour(1456);
  const c = couperJournee(t);
  assert.equal(c.retire, 0);
  assert.equal(c.texte, t, 'une journée médiane a été retouchée');
});

test('ON GARDE LE DÉBUT ET LA FIN, PAS SEULEMENT LE DÉBUT', () => {
  /*
   * LE DÉFAUT QUE CE TEST GARDE. Une troncature simple (`slice(0, n)`) est ce
   * qu'on écrit d'instinct, et elle jette la FIN de la soirée — c'est-à-dire
   * où ça a atterri, la seule partie dont la conversation du lendemain part.
   */
  const t = 'DEBUTDEBUT. ' + jour(20000) + ' FINFINFIN.';
  const c = couperJournee(t, 4000);
  assert.ok(c.texte.includes('DEBUTDEBUT'), 'le début a sauté');
  assert.ok((c.queue ?? c.brut ?? '').includes('FINFINFIN'),
    'la fin a sauté : on a tronqué au lieu de couper le milieu');
  assert.ok(c.retire > 10000);
});

test('LE PLAFOND EST VRAIMENT UN PLAFOND', () => {
  const c = couperJournee(jour(50000), 4000);
  const total = c.texte.length + (c.queue ?? c.brut ?? '').length;
  assert.ok(total <= 4000, `${total} signes gardés sous un plafond de 4000`);
});

test('CE QUI MANQUE EST ÉCRIT DANS LA JOURNÉE, AVEC L’OUTIL QUI VA LE LIRE', () => {
  /*
   * C'est la ligne qui sépare ce plafond-ci du plafond global qu'on vient de
   * retirer. Sans elle, le compagnon lit une soirée qui saute d'un sujet à
   * l'autre sans savoir qu'il lui manque le milieu — et il comble le trou tout
   * seul, ce qui est exactement ce que ce produit ne fait jamais.
   */
  const b = memoryBlock([{ date: '2026-08-31', note: 4, text: jour(30000) }], { plafond: 4000 });
  assert.match(b, /signes du milieu/, 'la coupe ne se dit pas');
  assert.match(b, /chercher_journees/, 'l’outil qui rend la journée entière n’est pas nommé');
  assert.match(b, /écourtée/, 'l’en-tête ne prévient pas que des journées sont écourtées');
});

test('AUCUNE JOURNÉE COUPÉE : ON NE PARLE PAS DE COUPE', () => {
  // Un avertissement qui apparaît quand il n'y a rien à avertir apprend à
  // l'ignorer — et c'est comme ça qu'on rate celui qui compte.
  const b = memoryBlock([{ date: '2026-09-08', note: 6, text: jour(900) }], { plafond: 4000 });
  assert.equal(/écourtée|signes du milieu/.test(b), false);
});

test('LE NOMBRE DE JOURNÉES NE BOUGE JAMAIS — c’est le curseur qui le dit', () => {
  /*
   * LA RÉGRESSION D'HIER, GARDÉE ICI AUSSI. Le plafond précédent retirait des
   * journées ENTIÈRES pendant que l'écran en annonçait quatorze. Celui-ci ne
   * doit jamais en faire disparaître une seule, si grosse soit-elle.
   */
  const jours = Array.from({ length: 14 }, (_, i) =>
    ({ date: `2026-08-${String(i + 10).padStart(2, '0')}`, note: 5, text: `MARQUE${i} ` + jour(30000) }));
  const b = memoryBlock(jours, { plafond: 2000 });
  for (let i = 0; i < 14; i++) {
    assert.ok(b.includes(`MARQUE${i}`), `la journée ${i} a disparu : le plafond retire des journées`);
    assert.ok(b.includes(`2026-08-${String(i + 10).padStart(2, '0')}`), `la date ${i} a disparu`);
  }
});

test('le plafond se désarme, et alors rien n’est touché', () => {
  const t = jour(50000);
  assert.equal(couperJournee(t, 0).retire, 0);
  assert.equal(memoryBlock([{ date: '2026-08-31', note: 4, text: t }], { plafond: 0 }).includes(t), true);
});

test('la valeur par défaut laisse passer la grande majorité d’un vrai journal', () => {
  // 27 journées réelles, dont 5 au-dessus de 6 000 signes. Le plafond n'a de
  // sens que s'il vise les exceptions ; s'il mord la médiane il ment sur ce
  // qu'il est.
  assert.ok(PLAFOND_JOURNEE >= 4000,
    `${PLAFOND_JOURNEE} : à ce niveau le plafond touche les journées ordinaires`);
});
