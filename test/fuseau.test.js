/**
 * L'heure de celui qui écrit.
 *
 * Le bogue qu'on répare ici ne se voit pas : hébergé, le serveur tourne en UTC,
 * et une note posée à 00h30 à Paris tombait sur la VEILLE. Ni erreur, ni trace
 * — juste un trou dans la grille, et la journée d'avant notée deux fois.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  jourLocal, heureLocale, marqueTemps, etatDuTemps,
  zoneValide, zoneDeRequete, dansLaZone, zoneCourante, ZONE_SERVEUR
} from '../server/temps.js';

/* Minuit et demi à Paris, le 12 août : c'est encore le 11 en UTC. C'est
   exactement l'heure où l'on vient noter sa journée avant de se coucher. */
const MINUIT_ET_DEMI = '2026-08-11T22:30:00Z';

test('la journée est celle de la personne, pas celle du processus', () => {
  assert.equal(jourLocal(MINUIT_ET_DEMI, 'UTC'), '2026-08-11');
  assert.equal(jourLocal(MINUIT_ET_DEMI, 'Europe/Paris'), '2026-08-12');
  assert.equal(jourLocal(MINUIT_ET_DEMI, 'America/Los_Angeles'), '2026-08-11');
});

test('les fuseaux à demi-heure ne sont pas arrondis', () => {
  // +05:45 : le genre de décalage qu'une table écrite à la main rate.
  assert.equal(heureLocale(MINUIT_ET_DEMI, 'Asia/Kathmandu'), '04:15');
  assert.equal(etatDuTemps('Asia/Kathmandu').decalage, 'UTC+05:45');
  assert.equal(etatDuTemps('America/Los_Angeles').decalage.slice(0, 4), 'UTC-');
});

test('l’heure d’été suit toute seule', () => {
  // Même zone, six mois d'écart : +02:00 en août, +01:00 en janvier. Aucune
  // table à tenir à jour — c'est Intl qui porte les règles.
  assert.equal(heureLocale('2026-08-11T12:00:00Z', 'Europe/Paris'), '14:00');
  assert.equal(heureLocale('2026-01-11T12:00:00Z', 'Europe/Paris'), '13:00');
});

test('le marqueur porte le bon jour de la semaine, dans la zone', () => {
  // Le 11 en UTC est un mardi ; le 12 à Paris est un mercredi. Le jour de la
  // semaine se déduit des morceaux DÉJÀ localisés, pas d'un getDay().
  assert.equal(marqueTemps(MINUIT_ET_DEMI, 'UTC'), 'mar. 11/08 22:30');
  assert.equal(marqueTemps(MINUIT_ET_DEMI, 'Europe/Paris'), 'mer. 12/08 00:30');
});

test('minuit s’écrit 00, jamais 24', () => {
  assert.match(marqueTemps('2026-08-11T22:00:00Z', 'Europe/Paris'), /00:00$/);
});

test('une date absente ou illisible ne produit rien', () => {
  // Sans ça, un message sans horodatage recevrait l'heure du serveur — un
  // marqueur inventé, que le compagnon lirait comme un fait.
  // Aucun repli sur « maintenant » : un instant manquant doit ressortir
  // manquant, sinon une entrée sans date s'écrirait sur aujourd'hui.
  for (const x of [undefined, null, '', 'pas une date']) {
    assert.equal(marqueTemps(x), null, `« ${x} » a produit un marqueur`);
    assert.equal(jourLocal(x, 'UTC'), null, `« ${x} » a produit une journée`);
    assert.equal(heureLocale(x, 'UTC'), null);
  }
});

test('une zone annoncée par le navigateur est validée avant usage', () => {
  // La valeur vient de l'extérieur et sert à construire un Intl : une chaîne
  // fantaisiste ferait lever une exception au milieu d'un calcul de date.
  assert.ok(zoneValide('Europe/Paris'));
  assert.ok(zoneValide('UTC'));
  assert.ok(!zoneValide('../../etc/passwd'));
  assert.ok(!zoneValide('Nulle/Part'));
  assert.ok(!zoneValide(''));
  assert.ok(!zoneValide(undefined));
  assert.ok(!zoneValide('A'.repeat(200)));
});

test('une requête sans fuseau valide retombe sur celui du serveur', () => {
  // Le comportement d'avant : on ne fait jamais pire, on fait mieux dès que
  // le navigateur parle.
  assert.equal(zoneDeRequete({ headers: {} }), ZONE_SERVEUR);
  assert.equal(zoneDeRequete({ headers: { 'x-fuseau': 'Nulle/Part' } }), ZONE_SERVEUR);
  assert.equal(zoneDeRequete(undefined), ZONE_SERVEUR);
  assert.equal(zoneDeRequete({ headers: { 'x-fuseau': 'Asia/Tokyo' } }), 'Asia/Tokyo');
});

test('deux requêtes simultanées ne se volent pas leur fuseau', async () => {
  // C'est la garantie qui justifie AsyncLocalStorage plutôt qu'une variable de
  // module : deux personnes dans deux fuseaux, servies en même temps.
  const lu = [];
  await Promise.all([
    dansLaZone('Pacific/Kiritimati', async () => {
      await new Promise(r => setTimeout(r, 12));
      lu.push(['K', zoneCourante(), jourLocal(MINUIT_ET_DEMI)]);
    }),
    dansLaZone('America/Los_Angeles', async () => {
      await new Promise(r => setTimeout(r, 4));
      lu.push(['L', zoneCourante(), jourLocal(MINUIT_ET_DEMI)]);
    })
  ]);
  const par = Object.fromEntries(lu.map(([k, z, j]) => [k, [z, j]]));
  assert.deepEqual(par.K, ['Pacific/Kiritimati', '2026-08-12']);
  assert.deepEqual(par.L, ['America/Los_Angeles', '2026-08-11']);
});

test('hors requête, on est dans la zone du serveur', () => {
  assert.equal(zoneCourante(), ZONE_SERVEUR);
});
