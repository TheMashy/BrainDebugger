/**
 * =====================================================================
 *  UN TRAITEMENT SE COMPTE. IL NE SE SURVEILLE PAS.
 *
 * `genre: 'traitement'` a été livré comme une simple étiquette : il ne
 * décidait RIEN. Mesuré sur un journal de 60 jours où l'anxiolytique est pris
 * tous les soirs sauf un creux de douze jours, le tableau rendait
 * `plus_longue: 12` et `compare: true` — c'est-à-dire, à l'écran :
 *
 *     « ton record : 12 jours sans ton traitement »
 *     « est-ce que ça monte ? 28 sur 30, contre 20 sur 30 avant »
 *
 * Ces deux phrases sont exactement ce que db.js et prises.js promettent de ne
 * jamais dire d'une ordonnance. Mettre un traitement sous surveillance
 * fabrique une inquiétude, et fait parfois arrêter un traitement.
 *
 * CE QU'ON LUI RETIRE : le record d'abstinence, la pente, les signes
 * (« tu as craqué », « vouloir arrêter »), la place en tête de liste.
 * CE QU'ON LUI GARDE : les jours, le compte, le rythme, la dernière fois.
 * C'est la différence entre « combien, quand » et « est-ce que ça monte ».
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyserPrises, prisesDuTexte, familleDuSuivi, motsDuSuivi } from '../server/prises.js';

const SOIXANTE = (texteDuJour) => {
  const j = [];
  for (let i = 1; i <= 60; i++) {
    const d = new Date(Date.UTC(2026, 0, i)).toISOString().slice(0, 10);
    j.push({ date: d, note: 5, text: texteDuJour(i) });
  }
  return j;
};
/* Pris tous les soirs, sauf un creux de douze jours au milieu. */
const TOUS_LES_SOIRS = () => SOIXANTE(i => (i > 20 && i < 33) ? 'journee normale' : 'j ai pris mon anxio');
const suivi = (genre, extra = {}) => [{ cle: 'sien:a', nom: 'mon anxio', mots: 'anxio', genre, actif: 1, ...extra }];
const laPrise = (genre, entrees = TOUS_LES_SOIRS()) =>
  analyserPrises(entrees, { aujourdhui: '2026-03-05', suivis: suivi(genre) }).prises.find(x => x.cle === 'sien:a');

test('UN TRAITEMENT N’A PAS DE RECORD D’ABSTINENCE', () => {
  const t = laPrise('traitement');
  assert.ok(t, 'le traitement n’est plus compté du tout — on lui retire trop');
  assert.equal(t.plus_longue ?? 0, 0, `« ton record : ${t.plus_longue} jours sans ton traitement »`);
  assert.equal(t.plus_long_ecart ?? 0, 0);
  assert.equal(t.series?.length ?? 0, 0);
  // La moitié qui rend le test discriminant : la même chose en « réduire » DOIT
  // avoir son record, sinon on aurait juste cassé le calcul pour tout le monde.
  assert.ok(laPrise('reduire').plus_longue > 0, 'plus aucune famille n’a de record');
});

test('UN TRAITEMENT NE MONTE PAS — « est-ce que ça monte » n’est pas la question', () => {
  const t = laPrise('traitement');
  assert.equal(t.compare, false, 'la comparaison des deux fenêtres est offerte sur une ordonnance');
  assert.equal(laPrise('reduire').compare, true, 'plus personne ne se compare');
});

test('UN TRAITEMENT NE REÇOIT AUCUN SIGNE', () => {
  // « tu as craqué », « vouloir arrêter » collés sous un médicament prescrit.
  const e = SOIXANTE(i => i === 40 ? 'j ai craque. je veux arreter tout ca'
                       : (i > 20 && i < 33) ? 'journee normale' : 'j ai pris mon anxio');
  assert.equal(laPrise('traitement', e).signes.length, 0, 'un signe est collé sous une ordonnance');
  assert.ok(laPrise('reduire', e).signes.length > 0, 'plus aucune famille ne reçoit de signe');
});

test('UN TRAITEMENT GARDE SES JOURS — c’est tout l’intérêt de le suivre', () => {
  // Ce qu'on lui retire, c'est la surveillance. Pas le comptage : « combien,
  // quand » est exactement la question qu'on veut pouvoir poser.
  const t = laPrise('traitement');
  assert.ok(t.n > 40, `${t.n} jours comptés sur ~48`);
  assert.ok(t.jours.length === t.n);
  assert.ok(Array.isArray(t.par_semaine) && t.par_semaine.some(x => x > 0), 'le rythme a disparu');
  assert.equal(typeof t.depuis, 'number');
});

/* ================= désactiver ================= */

test('UNE FAMILLE ÉCRITE À LA MAIN SE DÉSACTIVE AUSSI', () => {
  /*
   * LE DÉFAUT, ET LE TEST QUI NE L'ATTRAPAIT PAS. `actif` n'était filtré que
   * sur les familles fabriquées ; les six écrites à la main étaient ajoutées
   * sans condition. La personne décochait « le cannabis » et il restait à
   * l'écran. Le test d'à côté ne le voyait pas : il ne testait qu'une clé
   * « sien: », c'est-à-dire précisément le seul cas qui marchait.
   */
  const e = ['2026-02-01', '2026-02-02', '2026-02-03'].map(d => ({ date: d, note: 5, text: 'j ai fume un joint' }));
  const on = analyserPrises(e, { aujourdhui: '2026-02-04', suivis: [] });
  assert.equal(on.prises.some(x => x.cle === 'cannabis'), true, 'décor cassé : le cannabis n’est pas compté');
  const off = analyserPrises(e, { aujourdhui: '2026-02-04', suivis: [{ cle: 'cannabis', nom: 'x', actif: 0 }] });
  assert.equal(off.prises.some(x => x.cle === 'cannabis'), false,
    'décoché, le cannabis reste compté et affiché');
});

test('UN SUIVI INACTIF NE PEINT PLUS SON GENRE', () => {
  // `genre` et `parle` étaient décidés à une ligne d'écart, l'un filtrant
  // `actif` et l'autre non. Un suivi éteint repeignait donc la famille.
  const e = ['2026-02-01', '2026-02-02', '2026-02-03'].map(d => ({ date: d, note: 5, text: 'j ai fume un joint' }));
  const r = analyserPrises(e, { aujourdhui: '2026-02-04',
    suivis: [{ cle: 'cannabis', nom: 'x', genre: 'traitement', actif: 0, demander: 1 }] });
  assert.equal(r.prises.some(x => x.cle === 'cannabis'), false);
});

/* ================= ce que le mot déclaré ne doit pas faire ================= */

test('NOMMER SON PROJET DE PRENDRE N’EST PAS AVOIR PRIS, MÊME AVEC UN NOMBRE', () => {
  /*
   * L'en-tête de `familleDuSuivi` promet exactement ça — et le code le
   * contredisait. `NOMBRE` contient « un | une », donc « un anxio » satisfait
   * `franc`, et `franc` court-circuite la garde d'intention. Sur un traitement,
   * c'est un soir de médicament inventé.
   */
  const f = familleDuSuivi({ cle: 'sien:a', nom: 'a', mots: 'anxio' });
  for (const q of ['envie de prendre un anxio ce soir', 'je vais prendre un anxio tout a l heure'])
    assert.equal(prisesDuTexte(q, [f]).size, 0, `« ${q} » est compté comme une prise`);
  // La moitié discriminante : sinon on aurait juste cassé `franc`.
  for (const q of ['j ai pris un anxio', 'deux anxios ce soir'])
    assert.equal(prisesDuTexte(q, [f]).size, 1, `« ${q} » ne compte plus`);
});

test('UN MOT QUI EST DÉJÀ UN VERBE DE PRISE EST REFUSÉ', () => {
  /*
   * La règle « le mot ET un verbe » s'effondre quand le mot EST le verbe : il
   * satisfait les deux conditions à lui seul. V_PRENDRE contient « dose »,
   * « sous », « tape », « avale », « gobe », « consomme ».
   */
  for (const m of ['sous', 'dose', 'tape', 'avale', 'consomme'])
    assert.deepEqual(motsDuSuivi(m), [], `« ${m} » est accepté comme nom de produit`);
  for (const m of ['anxio', 'theralene', 'fleur de cbd'])
    assert.ok(motsDuSuivi(m).length, `« ${m} » est refusé à tort`);
  // Et de bout en bout.
  const f = familleDuSuivi({ cle: 'sien:s', nom: 's', mots: 'sous' });
  assert.equal(f, null, '« sous » fabrique quand même une famille');
});

test('UN CHIFFRE SEUL N’EST PAS UN NOM DE PRODUIT', () => {
  // « j'ai pris 100 euros » compterait.
  assert.deepEqual(motsDuSuivi('100'), []);
  assert.deepEqual(motsDuSuivi('2 mg'), []);
  assert.deepEqual(motsDuSuivi('mg 2, lexo'), ['lexo'], 'le tri jette le bon mot avec les chiffres');
});

test('UNE REPRISE NUE NE SE COLLE PAS SOUS UNE ORDONNANCE', () => {
  /*
   * « j'ai craqué » ne nomme pas ce qui a craqué — et c'est très bien ainsi.
   * `rattacherReprises` le colle alors à la famille la plus proche dans le
   * temps : sur un dossier où la seule famille est un médicament prescrit, ça
   * écrit « tu as repris » sous une ordonnance.
   *
   * LE DÉCOR DOIT ÊTRE EXACT, ET LE PREMIER NE L'ÉTAIT PAS. Le rattachement
   * saute les jours « couverts » — à ±1 journée écrite d'un jour de prise. Un
   * médicament pris tous les soirs couvre donc tout, et la phrase n'était
   * jamais rattachée : le test passait sans rien exercer. Il faut un CREUX
   * dans la prise, et la phrase au milieu — assez loin pour ne pas être
   * couverte, assez près pour rester sous `trou_max` (21 jours).
   */
  const e = SOIXANTE(i => i === 30 ? 'j ai craque hier soir'
                       : (i > 20 && i < 41) ? 'journee normale' : 'j ai pris mon anxio');
  assert.equal(laPrise('traitement', e).signes.length, 0,
    'une reprise nue est collée sous un médicament prescrit');
  /* La moitié discriminante : le même journal en « réduire » DOIT la recevoir,
     sinon on aurait simplement cassé le rattachement pour tout le monde. */
  assert.ok(laPrise('reduire', e).signes.some(g => g.id === 'craque'),
    'décor inerte : le rattachement ne se déclenche pour personne');
});
