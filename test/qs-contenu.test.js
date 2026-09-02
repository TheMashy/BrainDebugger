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

/*
 * LE DIGEST PART LU, PAS SEULEMENT BRUT.
 *
 * Un vrai digest fait vingt lignes dont quatorze sont des titres de pages :
 * tout est là et rien ne se lit. La route porte donc `lu` à côté de `digest` —
 * l'un pour la page, l'autre pour vérifier.
 */
test('chaque journée d’activité part avec son digest LU', () => {
  const j = lire().activite[0];
  assert.ok(j.lu, 'la lecture du digest manque');
  assert.equal(j.lu.champs, 2, 'deux champs dans ce digest de test');
  assert.deepEqual(j.lu.familles, [], 'deux clés ne font pas une famille');
  assert.ok(j.digest, 'le brut reste, entier');
});

test('les titres de pages se replient en une famille, sans rien perdre', () => {
  const d = {};
  d['web:summer'] = 4200;
  d['web:(7)'] = 3100;
  for (let i = 0; i < 12; i++) d[`web:page${i}`] = 100 - i * 5;
  d.trous = 3;
  poserActiviteJour(OWNER, AUJ, d);

  const j = lire().activite[0];
  assert.equal(j.date, AUJ);
  const [web] = j.lu.familles;
  assert.equal(web.nom, 'web');
  assert.equal(web.n, 14);
  assert.equal(web.tetes.length + web.reste, 14, 'tout est soit nommé, soit compté');
  assert.equal(web.tetes.reduce((a, t) => a + t.valeur, 0) + web.resteTotal, web.total);
  assert.deepEqual(j.lu.lignes.map(l => l.cle), ['trous'],
    'ce qui n’est pas dans la famille reste en ligne, et rien d’autre');
});


/*
 * CE QUI A ÉTÉ CONSULTÉ PART AVEC L'ARCHÉTYPE.
 *
 * L'écran pose une étiquette — « navigation continue » — et ce produit exige
 * que ses chiffres soient à côté. Ils ne peuvent pas y être si la route ne les
 * envoie pas : sans `usage`, la page devrait recompter les contextes de son
 * côté, et une étiquette contredite par ses propres chiffres est pire qu'une
 * étiquette seule.
 */
test('la route porte ce qui a été consulté, avec l’archétype', () => {
  /* Une journée d'ordinateur, posée ici et pas dans l'échantillon partagé :
     trois séries de plus durciraient la correction des liens pour les tests
     d'avant, qui n'ont rien demandé. */
  const ctx = { navigateur: 21600, code: 3600, discord: 1800 };
  for (const [quoi, sec] of Object.entries(ctx)) {
    poserMesure({ date: AUJ, source: 'machitool', cle: `temps_par_contexte_s_${quoi}`,
                  valeur: sec, unite: 's', userId: OWNER });
  }

  const d = lire(90);
  assert.equal(d.jourLu, AUJ);
  assert.ok(d.usage, 'l’usage manque : l’étiquette partirait sans ses chiffres');
  assert.ok(d.usage.total > 0);
  assert.ok(d.usage.parts.length, 'aucune famille');
  for (const p of d.usage.parts) {
    assert.ok(p.fam && p.nom, 'une famille sans nom sortirait sa clé à l’écran');
    assert.ok(p.minutes > 0, 'une famille à zéro n’a rien à afficher');
    assert.ok(p.part >= 0 && p.part <= 100);
  }
  // Trié du plus long au plus court : c'est l'ordre dans lequel on le lit.
  const min = d.usage.parts.map(p => p.minutes);
  assert.deepEqual(min, [...min].sort((a, b) => b - a));
});


/* ===================== LE PANNEAU DÉCRIT LE JOUR OUVERT =====================
 *
 * LE BUG, TEL QU'IL SE VOYAIT. Ouvert au 2 septembre, le bloc annonçait « la
 * dernière journée reçue · 1 sep » et affichait la nuit du 1er, juste sous
 * « rien n'a été dit ce jour-là ». Deux journées différentes sur la même page,
 * et rien pour les distinguer.
 *
 * Une journée sans envoi et une journée vide se ressemblent à l'écran ; elles
 * disent le contraire l'une de l'autre. « Rien n'est arrivé » se vérifie,
 * « tu n'as rien fait » non.
 */

const contenu = (jour, jours = 60) =>
  api.routes['GET /api/qs/contenu']({ query: { jours: String(jours), jour }, userId: OWNER });

test('le contenu décrit le jour demandé, pas le dernier reçu', () => {
  const d = moins(3);
  const r = contenu(d);
  assert.equal(r.jourLu, d);
  assert.equal(r.recu, true);
  assert.ok(r.nuit, 'la nuit de CE jour-là');
});

test('un jour sans rien le dit, au lieu d’emprunter la journée d’à côté', () => {
  // Une date hors de tout envoi : le jeu d'essai commence il y a 59 jours.
  const r = contenu(moins(300));
  assert.equal(r.jourLu, moins(300));
  assert.equal(r.recu, false);
  assert.equal(r.nuit, null);
  assert.equal(r.archetype, null);
  assert.equal(r.jour, null);
  assert.equal(r.jourActivite, null);
});

test('deux jours différents ne rendent pas la même nuit', () => {
  const a = contenu(moins(3)), b = contenu(moins(4));
  assert.equal(a.jourLu, moins(3));
  assert.equal(b.jourLu, moins(4));
  // Le jeu d'essai tire un sommeil différent chaque jour : deux journées qui
  // rendraient la même durée signeraient un retour au « dernier jour reçu ».
  assert.notEqual(a.nuit?.duree, b.nuit?.duree);
});

test('sans jour demandé, c’est aujourd’hui — et pas le dernier reçu', () => {
  const r = api.routes['GET /api/qs/contenu']({ query: {}, userId: OWNER });
  assert.equal(r.jourLu, AUJ);
});

test('un jour mal formé retombe sur aujourd’hui plutôt que de casser', () => {
  for (const faux of ['hier', '2026-13-45x', '', null]) {
    assert.equal(contenu(faux).jourLu, AUJ, `« ${faux} »`);
  }
});

test('le digest du jour part avec, relu', () => {
  const d = moins(2);
  poserActiviteJour(OWNER, d, {
    temps_par_contexte_s: { machitool: 360, lightshot: 180, code: 60, mail: 30 },
    titres_web: { summer: 1072, reddit: 428, w: 304, autre: 96 }
  });
  const r = contenu(d);
  assert.equal(r.jourActivite?.date, d);
  const noms = (r.jourActivite?.lu?.familles ?? []).map(f => f.nom);
  assert.ok(noms.includes('temps_par_contexte_s'), `familles : ${noms}`);
  assert.ok(noms.includes('titres_web'), `familles : ${noms}`);
});

test('la synchro dit quand la machine a parlé pour la dernière fois', () => {
  const r = contenu(AUJ);
  assert.ok(r.synchro, 'la ligne existe');
  assert.ok(r.synchro.recu_le, 'un horodatage, pas une date de journée');
  assert.equal(typeof r.synchro.depuis_min, 'number');
  assert.ok(r.synchro.depuis_min >= 0);
  /*
   * `recu_le` est l'heure de l'ENVOI, `dernierJour` la dernière journée
   * COUVERTE : les deux se cassent séparément, et c'est pour ça qu'elles
   * voyagent toutes les deux. Une passerelle muette depuis deux jours laisse
   * un historique parfaitement couvert jusqu'à avant-hier.
   */
  assert.ok('dernierJour' in r.synchro);
});
