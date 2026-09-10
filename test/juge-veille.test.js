/*
 * UNE CRISE EST UN COMPORTEMENT, PAS UN VOCABULAIRE.
 *
 * Rapporté par la personne, dans ses termes : « le système flag trop souvent
 * des crises où je racontais des faits passés (anciennes scarifications), ou
 * je donnais du contexte à l'IA ».
 *
 * La veille cherche des mots, et c'est très bien pour ce qu'elle est : elle ne
 * coûte rien, ne demande aucune clé, et ne rate presque rien. Mais quelqu'un
 * qui raconte une scarification d'il y a dix ans emploie exactement le
 * vocabulaire de quelqu'un qui vient de se couper. Ce qui les distingue n'est
 * jamais dans les mots.
 *
 * Ce fichier vérifie la SECONDE passe : ce qu'un verdict a le droit de faire,
 * et surtout ce qu'il n'a PAS le droit de faire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-juge-')), 'test.db');

const { signeTientEncore, lireVerdict, passagesDuJour, motifsQuiTiennent,
        texteDuPassage, VERDICTS, CONSIGNE } = await import('../server/juge-veille.js');
const { joursDuRendezVous, comptesDuRendezVous } = await import('../server/rendez-vous.js');

const v = (verdict, certitude) => ({ verdict, certitude, cite: 'x', pourquoi: 'y' });

/* ---------------- ce qu'un verdict a le droit de faire ---------------- */

test('un verdict SÛR de « passé » retire le signe', () => {
  assert.equal(signeTientEncore(v('passe', 'haute')), false);
});

test('« du contexte donné au compagnon » aussi — et c’est un cas à part', () => {
  /*
   * « je te raconte d'où je viens pour que tu comprennes » est un acte de
   * confiance envers le compagnon. Le compter comme une crise punirait
   * exactement le geste qu'on veut voir se produire.
   */
  assert.equal(signeTientEncore(v('contexte', 'haute')), false);
  assert.ok(VERDICTS.includes('contexte'), 'il ne se confond pas avec « passé »');
});

test('UN MODÈLE QUI HÉSITE N’EFFACE RIEN', () => {
  /*
   * C'est le garde-fou central. Dans le doute, ça reste signalé : la personne
   * relit son document avant de le tendre, et elle ne peut retirer que ce
   * qu'elle voit. Un modèle hésitant qui efface enlève ce choix-là.
   */
  assert.equal(signeTientEncore(v('passe', 'moyenne')), true);
  assert.equal(signeTientEncore(v('passe', 'basse')), true);
  assert.equal(signeTientEncore(v('autre', 'moyenne')), true);
});

test('pas de verdict du tout : le signe tient', () => {
  assert.equal(signeTientEncore(null), true);
  assert.equal(signeTientEncore(undefined), true);
});

test('« crise » ne retire jamais rien, même sûr', () => {
  assert.equal(signeTientEncore(v('crise', 'haute')), true);
});

test('une réponse hors liste est une réponse absente', () => {
  assert.equal(lireVerdict({ verdict: 'peut-être', certitude: 'haute' }), null);
  assert.equal(lireVerdict({ verdict: 'passe', certitude: 'certaine' }), null);
  assert.equal(lireVerdict({}), null);
  assert.equal(lireVerdict({ verdict: 'passe', certitude: 'haute' }).verdict, 'passe',
    'et une réponse valide passe');
});

/* ---------------- le passage, et son contexte ---------------- */

const NIVEAU_FAUX = table => (texte) => table[texte] ?? { niveau: null, motifs: [] };

test('LE VOISINAGE PART AVEC LE PASSAGE — sans lui la question n’a pas de réponse', () => {
  const msgs = [
    { id: 1, role: 'user', text: 'je vais te raconter d’où je viens' },
    { id: 2, role: 'user', text: 'je me suis tailladé, à l’époque' },
    { id: 3, role: 'user', text: 'voilà, c’était il y a dix ans' }
  ];
  const p = passagesDuJour('2026-09-09', msgs, NIVEAU_FAUX({
    'je me suis tailladé, à l’époque': { niveau: 'rouge', motifs: [{ genre: 'blessure', niveau: 'rouge', extrait: 'tailladé' }] }
  }));
  assert.equal(p.length, 1);
  assert.equal(p[0].messageId, 2);
  assert.equal(p[0].avant.length, 1, 'ce qui précède part avec');
  assert.equal(p[0].apres.length, 1, 'ce qui suit aussi');
  const t = texteDuPassage({ ...p[0], message: p[0].texte });
  assert.match(t, /d’où je viens/, 'le texte donné à lire porte l’avant');
  assert.match(t, /il y a dix ans/, 'et l’après');
});

test('DEUX PASSAGES LE MÊME JOUR NE PARTAGENT PAS LEUR VERDICT', () => {
  /*
   * Le cas qui décide de tout. Une journée où la personne raconte une
   * scarification ancienne le matin et va mal le soir porte les deux. Juger
   * par JOURNÉE rendrait forcément l'une des deux réponses fausse — et on ne
   * saurait pas laquelle.
   */
  const msgs = [
    { id: 10, role: 'user', text: 'à l’époque je me tailladais' },
    { id: 11, role: 'user', text: 'là je viens de le refaire' }
  ];
  const p = passagesDuJour('2026-09-09', msgs, NIVEAU_FAUX({
    'à l’époque je me tailladais': { niveau: 'rouge', motifs: [{ genre: 'blessure', niveau: 'rouge', extrait: 'tailladais' }] },
    'là je viens de le refaire': { niveau: 'rouge', motifs: [{ genre: 'blessure', niveau: 'rouge', extrait: 'refaire' }] }
  }));
  assert.equal(p.length, 2, 'deux passages, pas un');

  const verdicts = new Map([[10, new Map([['blessure', v('passe', 'haute')]])]]);
  assert.deepEqual(motifsQuiTiennent(p[0], verdicts.get(10)), [], 'le souvenir tombe');
  assert.equal(motifsQuiTiennent(p[1], verdicts.get(11)).length, 1, 'la crise reste');
});

/* ---------------- et dans le document ---------------- */

test('le document n’imprime plus un signe sûrement écarté, et DIT qu’il l’a écarté', () => {
  const F = '2026-09-10';
  const msgs = [{ id: 42, role: 'user', text: 'je me suis tailladé au lycée' }];
  const jours = joursDuRendezVous('u', {
    jours: 2, jusquA: F,
    lireNuits: () => [], lireVeille: () => null,
    lireMessages: d => (d === F ? msgs : []),
    lireNiveau: NIVEAU_FAUX({ 'je me suis tailladé au lycée':
      { niveau: 'rouge', motifs: [{ genre: 'blessure', niveau: 'rouge', extrait: 'tailladé' }] } }),
    lireVerdicts: () => new Map([[42, new Map([['blessure', v('passe', 'haute')]])]])
  });
  const l = jours.find(x => x.date === F);
  assert.deepEqual(l.signes, [], 'il ne s’imprime plus');
  assert.equal(l.ecartes, 1, 'mais le document sait qu’il a écarté quelque chose');
  assert.equal(comptesDuRendezVous(jours).ecartes, 1,
    'effacer sans le dire demanderait de croire la machine deux fois');
});

test('sans verdict, le document imprime comme avant', () => {
  const F = '2026-09-10';
  const msgs = [{ id: 43, role: 'user', text: 'j’ai bu quatre bières' }];
  const jours = joursDuRendezVous('u', {
    jours: 2, jusquA: F, lireNuits: () => [], lireVeille: () => null,
    lireMessages: d => (d === F ? msgs : []),
    lireNiveau: NIVEAU_FAUX({ 'j’ai bu quatre bières':
      { niveau: 'jaune', motifs: [{ genre: 'substance', niveau: 'jaune', extrait: 'quatre bières' }] } }),
    lireVerdicts: () => new Map()
  });
  assert.equal(jours.find(x => x.date === F).signes.length, 1);
});

test('la consigne interdit d’ajouter un signe que le détecteur n’a pas vu', () => {
  assert.match(CONSIGNE, /n'ajoutes jamais un signe/,
    'sinon la seconde passe deviendrait un second détecteur, non calibré');
  assert.match(CONSIGNE, /aucun diagnostic/);
});

/* ---------------- le lot qui tourne en fond ---------------- */

const { passagesSansVerdict, MAX_PAR_LOT } = await import('../server/juge-veille-lot.js');
const { requeteJugement, cleLot, lireCleLot } = await import('../server/juge-veille.js');

test('ON NE JUGE JAMAIS DEUX FOIS LE MÊME PASSAGE', () => {
  /*
   * Un verdict est payé. Le rejouer coûterait de l'argent pour le même
   * résultat — et c'est exactement ce qui rend une relance sur un journal
   * déjà relu gratuite.
   */
  const msgs = { '2026-09-01': [{ id: 7, role: 'user', text: 'ça a dérapé' }] };
  const opts = {
    lireMessages: d => msgs[d] ?? [],
    lireNiveau: NIVEAU_FAUX({ 'ça a dérapé':
      { niveau: 'jaune', motifs: [{ genre: 'substance', niveau: 'jaune', extrait: 'dérapé' }] } })
  };
  assert.equal(passagesSansVerdict(['2026-09-01'], 'u',
    { ...opts, lireVerdicts: () => new Map() }).length, 1, 'jamais lu : à juger');
  assert.equal(passagesSansVerdict(['2026-09-01'], 'u',
    { ...opts, lireVerdicts: () => new Map([[7, new Map([['substance', v('passe', 'haute')]])]]) }).length,
    0, 'déjà lu : on n’y revient pas');
});

test('un lot ne part jamais sans borne', () => {
  const msgs = {};
  const jours = [];
  for (let i = 1; i <= 60; i++) {
    const d = `2026-07-${String(i).padStart(2, '0')}`;
    if (i > 31) continue;
    jours.push(d);
    msgs[d] = Array.from({ length: 30 }, (_, k) => ({ id: i * 100 + k, role: 'user', text: 'ça a dérapé' }));
  }
  const n = passagesSansVerdict(jours, 'u', {
    lireMessages: d => msgs[d] ?? [],
    lireNiveau: NIVEAU_FAUX({ 'ça a dérapé':
      { niveau: 'jaune', motifs: [{ genre: 'substance', niveau: 'jaune', extrait: 'd' }] } }),
    lireVerdicts: () => new Map()
  }).length;
  assert.equal(n, MAX_PAR_LOT, 'au-delà, on repose un lot après — on n’en envoie pas mille d’un coup');
});

test('la clé du lot fait l’aller-retour : sans elle on ne sait plus ce qu’on a jugé', () => {
  for (const [id, genre] of [[42, 'blessure'], [7, 'evoque_passe'], [1, 'en_main']])
    assert.deepEqual(lireCleLot(cleLot(id, genre)), { messageId: id, genre });
  assert.equal(lireCleLot('n’importe quoi'), null);
});

test('la requête force l’outil et reste courte', () => {
  const r = requeteJugement({ date: '2026-09-09', texte: 'x', avant: [], apres: [] });
  assert.equal(r.tool_choice.type, 'tool', 'sinon il faudrait analyser du texte libre');
  assert.ok(r.max_tokens <= 400, 'la question est fermée : la réponse n’a pas à être longue');
  assert.ok(!r.thinking, 'et elle ne demande pas de réflexion étendue, facturée en sortie');
});
