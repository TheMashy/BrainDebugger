/*
 * LES PRISES, ÉPROUVÉES SUR DES DOSSIERS ENTIERS.
 *
 * Les cas écrits à la main disent qu'une phrase est reconnue. Ils ne disent
 * rien de ce qui arrive sur deux cents journées, où le bruit est la règle et
 * où une méthode qui compte mal ressemble exactement à une méthode qui compte
 * bien. `tools/banc-prises` écrit des journaux dont on connaît la vérité
 * terrain — l'escalade, le déclencheur, la fenêtre d'arrêt, le coût du
 * lendemain — et on demande au moteur ce qu'il retrouve.
 *
 * ET SURTOUT CE QU'IL INVENTE. Le témoin (aucune dynamique plantée) est le
 * test qui compte le plus : sur ce terrain, une découverte fausse pose une
 * étiquette que personne n'ira vérifier.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generer } from '../tools/banc-approches/generateur.mjs';
import { dossier, carteDe } from '../tools/banc-prises/dossier.mjs';
import { analyserPrises } from '../server/prises.js';

const dateDe = t => new Date(Date.UTC(2026, 0, 5 + t)).toISOString().slice(0, 10);
const patient = (i = 0, profil = 'temoin') => generer({ profil, famille: 'prises', T: 260, manquants: 0.2, index: i });

const avecDependance = (i = 0, sur = {}) => dossier(patient(i), {
  famille: 'alcool', base: 0.04, escalade: 0.5, declencheur: 'la solitude',
  suite: 0.8, arret: [120, 150], cout: 2.5, graine: `d${i}`, ...sur
}, dateDe);

const lire = d => analyserPrises(d.entrees, { carte: carteDe(d), aujourdhui: d.entrees.at(-1).date });

test('la famille plantée ressort, sur trois patients', () => {
  for (let i = 0; i < 3; i++) {
    const r = lire(avecDependance(i));
    const a = r.prises.find(p => p.cle === 'alcool');
    assert.ok(a, `patient ${i} : l’alcool ne ressort pas (${r.prises.map(p => p.cle)})`);
    assert.ok(a.n >= 15, `patient ${i} : seulement ${a.n} jours retrouvés`);
  }
});

test('les jours retrouvés sont ceux qui ont été plantés', () => {
  /* Mesuré sur douze patients au moment d'écrire : 100 % de rappel et 100 %
     de précision. Les seuils sont posés juste en dessous — ce qui se teste
     ici, c'est qu'une tournure cesse d'être reconnue, et ça se voit vite.
     Deux gaps trouvés par ce test et corrigés : « trois verres de vin »
     (aucun verbe de prise) et « j'ai arrêté de compter » (que `veille.js`
     lisait comme la négation « j'ai arrêté »). */
  for (let i = 0; i < 4; i++) {
    const d = avecDependance(i);
    const a = lire(d).prises.find(p => p.cle === 'alcool');
    const plantes = new Set(d.jours_prise);
    const vrais = a.jours.filter(j => plantes.has(j)).length;
    const rappel = vrais / plantes.size, precision = vrais / a.jours.length;
    assert.ok(rappel >= 0.95, `patient ${i} : rappel ${(rappel * 100).toFixed(0)} %`);
    assert.ok(precision >= 0.98,
      `patient ${i} : précision ${(precision * 100).toFixed(0)} % — un jour inventé est pire qu’un jour manqué`);
  }
});

test('l’escalade se voit dans les deux fenêtres', () => {
  // 10 sur 12 à la mesure. Ce n'est pas 12 sur 12 et ça ne peut pas l'être :
  // une montée continue de 4 % à 50 % sur 260 jours ne laisse, entre deux
  // fenêtres de 30 journées voisines, qu'un écart de quelques jours. Exiger
  // mieux reviendrait à demander au produit d'annoncer une pente qu'il ne
  // peut pas distinguer du hasard.
  let monte = 0;
  for (let i = 0; i < 6; i++) {
    const a = lire(avecDependance(i)).prises.find(p => p.cle === 'alcool');
    if (a.compare && a.recent > a.avant) monte++;
  }
  assert.ok(monte >= 4, `${monte}/6 patients montrent la montée plantée`);
});

test('le déclencheur planté ressort comme « ce qui vient avant »', () => {
  let trouve = 0;
  for (let i = 0; i < 6; i++) {
    const d = avecDependance(i);
    const a = lire(d).prises.find(p => p.cle === 'alcool');
    if (a.avant_ca.some(x => x.nom === 'la solitude')) trouve++;
    // et jamais le nœud témoin, qui ne précède rien
    assert.ok(!a.avant_ca.some(x => x.nom === 'le travail'),
      `patient ${i} : « le travail » ne précède rien et ne doit pas ressortir`);
  }
  assert.ok(trouve >= 4, `${trouve}/6 patients : « la solitude » retrouvée`);
});

test('la fenêtre d’arrêt devient la plus longue série, et la reprise ne l’efface pas', () => {
  const d = avecDependance(0);
  const a = lire(d).prises.find(p => p.cle === 'alcool');
  const arret = a.series.find(s => s.de <= d.arret.de && s.a >= d.arret.a);
  assert.ok(arret, `la fenêtre ${d.arret.de} → ${d.arret.a} devrait donner une série : ${JSON.stringify(a.series.map(s => [s.de, s.a]))}`);
  assert.equal(a.plus_longue, Math.max(...a.series.filter(s => !s.maigre).map(s => s.jours)));
  assert.ok(a.series.length > 1, 'les autres séries restent affichées — une reprise n’efface pas ce qui précède');
});

test('le coût du lendemain est mesuré, pas supposé', () => {
  let tient = 0;
  for (let i = 0; i < 6; i++) {
    const a = lire(avecDependance(i)).prises.find(p => p.cle === 'alcool');
    if (a.apres_ca?.tient) tient++;
  }
  assert.ok(tient >= 5, `${tient}/6 : le coût planté (−2,5 sur la note du lendemain) devrait se voir`);
});

test('LE TÉMOIN NE SE VOIT RIEN INVENTER', () => {
  /* Aucune prise plantée : ni escalade, ni déclencheur, ni arrêt. Ce que le
     moteur trouve ici, il l'a fabriqué. */
  for (let i = 0; i < 4; i++) {
    const d = dossier(patient(i), { famille: 'alcool', base: 0, escalade: 0, suite: 0,
      declencheur: 'la solitude', arret: null, graine: `t${i}` }, dateDe);
    const r = analyserPrises(d.entrees, { carte: carteDe(d), aujourdhui: d.entrees.at(-1).date });
    assert.deepEqual(r.prises.map(p => p.cle), [], `témoin ${i} : ${JSON.stringify(r.prises.map(p => [p.cle, p.n]))}`);
  }
});

test('rien de ce qui est rendu ne qualifie la personne, sur aucun dossier', () => {
  const interdit = /addict|alcooliqu|alcoolo|toxico|dépendan|dependan|drogué|accro|malade|trouble|craqu|cach|habitude|suivi|surveill/i;
  for (const fam of ['alcool', 'cannabis', 'stimulants']) {
    const d = avecDependance(1, { famille: fam });
    const r = lire(d);
    const texte = JSON.stringify(r.prises.map(p => ({
      nom: p.nom, signes: p.signes.map(s => s.dit), avant: p.avant_ca.map(a => a.nom) })).concat(r.ecartees.map(e => e.pourquoi)));
    assert.ok(!interdit.test(texte), `${fam} : ${texte}`);
  }
});
