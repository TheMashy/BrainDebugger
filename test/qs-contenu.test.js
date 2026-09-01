/**
 * CE QUE LE VISUALISEUR REÇOIT.
 *
 * La V1 rendait des points et des bornes : de quoi tracer une courbe, pas de
 * quoi la LIRE. Une courbe seule dit la forme et rien d'autre — montée,
 * descente, dents de scie — alors que la question qu'on se pose en la regardant
 * est « où j'en suis par rapport à d'habitude ».
 *
 * La route porte donc maintenant quatre choses de plus, et chacune répond à une
 * question que la V1 laissait sans réponse :
 *   — la MÉDIANE et le CÔTÉ : « 5,4 », c'est beaucoup ou peu ?
 *   — le LIEN avec le journal : est-ce que ça bouge avec mes journées ?
 *   — la RÉCEPTION : est-ce que l'application envoie encore ?
 *   — les valeurs DISTINCTES : une série de texte constante est muette, et le
 *     dire vaut mieux que d'écrire « texte ».
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-qscont-')), 'test.db');

const { OWNER, setNote, poserMesure, poserActiviteJour } = await import('../server/db.js');
const api = await import('../server/api.js');

const AUJ = new Date().toISOString().slice(0, 10);
const moins = n => {
  const d = new Date(`${AUJ}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/*
 * Un sommeil qui MÈNE la note, avec du bruit — soixante jours, assez pour que
 * la corrélation ait ses vingt points appariés et survive à la correction.
 * Et une balance qui s'est arrêtée il y a vingt jours : c'est le cas que la
 * V1 ne pouvait pas montrer, parce que rien ne disait la dernière date.
 */
const rnd = (s => () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)(3);
for (let i = 59; i >= 0; i--) {
  const d = moins(i);
  const h = 4.5 + 4 * rnd();
  setNote(d, Math.max(0, Math.min(10, Math.round(h * 1.05 + rnd() * 2 - 0.6))), OWNER);
  poserMesure({ date: d, source: 'montre', cle: 'sommeil_h', valeur: Math.round(h * 10) / 10, unite: 'h', userId: OWNER });
  // Du bruit pur : elle ne doit PAS ressortir liée.
  poserMesure({ date: d, source: 'montre', cle: 'fc_repos', valeur: Math.round(52 + rnd() * 16), userId: OWNER });
  if (i >= 20) poserMesure({ date: d, source: 'balance', cle: 'poids', valeur: 72, userId: OWNER });
  // Une mesure de texte, toujours la même : elle arrive, donc elle s'affiche,
  // mais elle n'apprend rien et la carte doit pouvoir le dire.
  poserMesure({ date: d, source: 'machitool', cle: 'premiere_activite', texte: '08:23', userId: OWNER });
  poserActiviteJour(OWNER, d, { date: d, bascules: 40 });
}

const lire = (jours = 90) => api.routes['GET /api/qs/contenu']({ query: { jours }, userId: OWNER });
const serie = (d, cle) => d.series.find(s => s.cle === cle);

test('chaque série porte sa médiane et le côté de sa dernière valeur', () => {
  const s = serie(lire(), 'sommeil_h');
  assert.ok(s.mediane != null, 'aucune médiane');
  assert.ok(s.dernier?.date === AUJ, 'la dernière valeur n’est pas la plus récente');
  /*
   * TROIS ÉTATS ET PAS DEUX — la même convention qu'à côté de la journée. Avec
   * un simple `>=`, la valeur qui EST la médiane s'annonce au-dessus
   * d'elle-même, ce qui arrive sur toute série impaire dont on regarde le jour
   * du milieu.
   */
  assert.ok(['pile', 'haut', 'bas'].includes(s.cote));
  const attendu = s.dernier.valeur === s.mediane ? 'pile' : s.dernier.valeur > s.mediane ? 'haut' : 'bas';
  assert.equal(s.cote, attendu);
});

test('le lien avec le journal descend jusqu’à la série — et seulement le vrai', () => {
  const d = lire();
  const dort = serie(d, 'sommeil_h');
  assert.ok(dort.lien, 'le lien construit exprès n’est pas remonté');
  assert.ok(Math.abs(dort.lien.r) >= 0.3);
  assert.ok(dort.lien.moitie, 'sans l’écart de moitié, la phrase ne se dit pas en points');

  // LA GARDE QUI COMPTE : le bruit ne doit pas ressortir lié. Sans correction,
  // une série sur vingt sort « significative » par pur hasard, et une page qui
  // annonce des liens faux est pire qu'une page vide.
  assert.equal(serie(d, 'fc_repos').lien, null, 'du bruit est ressorti comme un lien');
});

test('le lien ne dépend pas de la fenêtre qu’on regarde', () => {
  /*
   * « Je passe de 30 à 90 jours et un lien apparaît » est exactement ce qu'un
   * lien ne doit pas faire. La fenêtre règle ce qu'on REGARDE, pas ce qu'on
   * calcule : les corrélations se calculent sur tout l'historique.
   */
  const court = serie(lire(30), 'sommeil_h').lien;
  const long = serie(lire(365), 'sommeil_h').lien;
  assert.deepEqual(court, long);
});

test('la réception dit si l’application envoie encore', () => {
  const r = lire(90).reception;
  assert.equal(r.dernier, AUJ);
  assert.equal(r.depuis_jours, 0);
  assert.equal(r.attendus, 90);
  assert.ok(r.couverts >= 60 && r.couverts <= 90, `couverts = ${r.couverts}`);
});

test('une série arrêtée garde sa dernière date — c’est tout ce qui la distingue', () => {
  // Les courbes d'une montre débranchée restent belles ; elles s'arrêtent
  // simplement, et sans la date rien ne le dit.
  const p = serie(lire(90), 'poids');
  assert.equal(p.dernier.date, moins(20));
  assert.notEqual(p.dernier.date, AUJ);
});

test('une série de texte a une dernière valeur, et dit combien il y en a de différentes', () => {
  const t = serie(lire(90), 'premiere_activite');
  assert.equal(t.bas, null, 'une heure n’est pas un nombre');
  assert.equal(t.dernier.texte, '08:23', 'la dernière valeur d’une série de texte manque');
  assert.equal(t.distinctes, 1, 'une valeur constante doit pouvoir se dire muette');
});

test('la fenêtre est bornée des deux côtés', () => {
  assert.equal(lire(1).jours, 7);
  assert.equal(lire(9000).jours, 365);
  assert.equal(lire().jours, 90);
});
