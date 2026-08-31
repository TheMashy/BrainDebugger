/**
 * LES HORIZONS : ce que les derniers mois ont été, en quelques phrases.
 *
 * Le compagnon avait les quatorze dernières journées telles qu'écrites, et la
 * grille des notes sur quatre ans. Entre les deux, rien : sur « ça fait combien
 * de temps que ça dure ? », il avait le texte de la semaine et une suite de
 * chiffres, et il répondait à côté.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { HORIZONS, MIN_ECRITES, SCHEMA_HORIZONS, HORIZON_CAR,
         validerHorizons, ecritesParHorizon, horizonBlock } from '../server/horizons.js';

const jour = (n, fin = '2026-06-30') => {
  const d = new Date(fin + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
const journal = (...offsets) => offsets.map(n => ({ date: jour(n), text: 'quelque chose' }));

test('quatre fenêtres, du proche au lointain, qui se recouvrent', () => {
  assert.deepEqual(HORIZONS.map(h => h.cle), ['semaine', 'mois', 'trimestre', 'annee']);
  // Elles se recouvrent exprès : « ces trois mois » n'est pas la somme de trois
  // « ce mois-ci ». Une saison a une forme que ses mois pris un par un n'ont pas.
  const j = HORIZONS.map(h => h.jours);
  assert.deepEqual(j, [...j].sort((a, b) => a - b), 'les fenêtres ne vont pas du proche au lointain');
  assert.deepEqual(Object.keys(SCHEMA_HORIZONS.properties), HORIZONS.map(h => h.cle));
});

test('le serveur compte les journées écrites, le modèle ne décide pas', () => {
  const rows = journal(1, 2, 3, 40, 41, 200);
  const n = ecritesParHorizon(rows, '2026-06-30');
  assert.equal(n.get('semaine'), 3);
  assert.equal(n.get('mois'), 3);
  assert.equal(n.get('trimestre'), 5);
  assert.equal(n.get('annee'), 6);
  // Une journée notée sans texte n'est pas une journée écrite : compter le
  // chiffre ferait croire au modèle qu'il a de la matière à lire.
  const muettes = ecritesParHorizon([{ date: jour(1), text: '' }, { date: jour(2), text: null }], '2026-06-30');
  assert.equal(muettes.get('semaine'), 0);
});

test('UNE FENÊTRE SANS MATIÈRE NE PARLE PAS', () => {
  /*
   * « Ces trois mois ont été calmes » écrit sur deux journées notées est une
   * affirmation sur du vide — et le compagnon la répéterait comme un fait.
   */
  const dit = 'Les nuits sont restées courtes, et tu es quand même sorti trois fois cette semaine.';
  const n = new Map([['semaine', MIN_ECRITES], ['mois', MIN_ECRITES - 1],
                     ['trimestre', 40], ['annee', 0]]);
  const v = validerHorizons({ semaine: dit, mois: dit, trimestre: dit, annee: dit }, n);
  assert.deepEqual(Object.keys(v), ['semaine', 'trimestre']);
  assert.equal(v.semaine.ecrites, MIN_ECRITES);
});

test('une phrase trop courte n’est pas une synthèse', () => {
  // Deux mots ne disent rien et occupent quand même une place dans le prompt,
  // à chaque message de la semaine.
  assert.equal(validerHorizons({ semaine: 'ça va.' }, new Map([['semaine', 20]])), null);
  assert.equal(validerHorizons(null, new Map([['semaine', 20]])), null);
  assert.equal(validerHorizons({}, new Map()), null);
});

test('une synthèse trop longue est coupée sur une fin de phrase', () => {
  const long = 'Une phrase de longueur ordinaire qui raconte quelque chose. '.repeat(30);
  const v = validerHorizons({ annee: long }, new Map([['annee', 200]]));
  assert.ok(v.annee.texte.length <= HORIZON_CAR + 1);
  assert.match(v.annee.texte, /\.$|…$/, 'coupée au milieu d’un mot');
});

test('le bloc va du large au proche, et dit de ne pas le réciter', () => {
  const v = validerHorizons({
    semaine: 'La semaine a tenu, tu as rendu le doc et tu es sorti trois fois de chez toi.',
    annee: "L'année a commencé bas et remonte depuis avril, sans que rien de précis l'explique."
  }, new Map([['semaine', 6], ['annee', 200]]));
  const b = horizonBlock(v);
  // Du large au proche : on lit d'abord où l'on en est, puis ce qui vient de se
  // passer. L'ordre inverse ferait relire la semaine deux fois.
  assert.ok(b.indexOf("L'ANNÉE") < b.indexOf('LA SEMAINE'));
  // La consigne compte autant que le contenu : sans elle, le compagnon récite
  // ces paragraphes à la première occasion, et la conversation devient un exposé.
  assert.match(b, /ne les récites pas/i);
  assert.match(b, /jamais par ça/i);
  // Le nombre de journées écrites est là : une synthèse d'année sur douze
  // journées ne vaut pas une synthèse d'année sur trois cents.
  assert.match(b, /200 journées écrites/);
  assert.equal(horizonBlock(null), null);
  assert.equal(horizonBlock({}), null);
});
