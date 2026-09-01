/**
 * LE CACHE DE LA LECTURE DE FOND.
 *
 * C'est le plus gros appel du produit — quatre-vingt mille jetons d'entrée
 * pour deux mille de sortie — et c'était le seul sans aucun cache.
 *
 * Ce qui est vérifié ici n'est pas « il y a des marques » : c'est que le
 * PRÉFIXE est réutilisable. Un cache est un accord d'octets ; une marque posée
 * sur un prompt qui change à chaque appel ne fait que payer la surtaxe
 * d'écriture sans jamais rien relire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { requeteLecture } from '../server/lecture.js';

const corpus = (texte, etendue = 900) => ({ texte, etendue, dates: new Set() });
const S = { anthropicModel: 'claude-opus-5' };

/** Les blocs porteurs d'une marque, dans l'ordre où l'API les rend. */
const marques = r => [
  ...(r.system ?? []).filter(b => b.cache_control).map(() => 'system'),
  ...(r.messages ?? []).flatMap(m =>
    (Array.isArray(m.content) ? m.content : []).filter(b => b.cache_control).map(() => 'message'))
];

test('deux marques, une sur le système et une sur le corpus', () => {
  const r = requeteLecture(corpus('un journal'), S);
  assert.deepEqual(marques(r), ['system', 'message']);
});

test('jamais plus de quatre marques — au-delà, l’API refuse la requête', () => {
  assert.ok(marques(requeteLecture(corpus('x'), S)).length <= 4);
});

test('la marque du système couvre l’outil : l’ordre de rendu est tools → system → messages', () => {
  const r = requeteLecture(corpus('x'), S);
  // La marque est sur le DERNIER bloc système : c'est elle qui referme le
  // préfixe outil + consignes. Posée ailleurs, elle ne couvrirait pas l'outil.
  assert.ok(r.system.at(-1).cache_control, 'la marque doit être sur le dernier bloc système');
  assert.equal(r.tools.length, 1, 'un outil, et il est déterministe');
});

test('LE TEXTE ENVOYÉ NE CHANGE PAS D’UN OCTET', () => {
  /*
   * Le corpus reste UN SEUL bloc, avec exactement la phrase qui le précédait.
   * Le découper en deux blocs pour poser la marque plus tôt aurait modifié le
   * prompt — et on ne retouche pas un prompt qui marche pour du cache.
   */
  const r = requeteLecture(corpus('LE JOURNAL'), S);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].content.length, 1);
  assert.equal(r.messages[0].content[0].type, 'text');
  assert.equal(r.messages[0].content[0].text,
    'Tout son journal, du premier jour au dernier. Découpe les séries par mois.\n\nLE JOURNAL');
});

test('cinq minutes, pas une heure : l’écriture à une heure coûte le double', () => {
  const r = requeteLecture(corpus('x'), S);
  for (const b of [r.system.at(-1), r.messages[0].content.at(-1)]) {
    assert.equal(b.cache_control.type, 'ephemeral');
    assert.equal(b.cache_control.ttl, undefined,
      'sans ttl = cinq minutes ; le cas fréquent est celui où le cache ne sert pas, ' +
      'et à une heure ces lectures-là coûteraient le double pour rien');
  }
});

test('LE PRÉFIXE EST RÉUTILISABLE : deux lectures du même journal sont identiques', () => {
  /*
   * C'est LE test. Un invalidateur silencieux — une date interpolée dans les
   * consignes, un outil sérialisé dans un ordre variable — ne se voit nulle
   * part ailleurs : les requêtes passent, la facture est simplement plus
   * élevée, et rien ne l'annonce.
   */
  const a = requeteLecture(corpus('même journal'), S);
  const b = requeteLecture(corpus('même journal'), S);
  assert.equal(JSON.stringify({ t: a.tools, s: a.system, m: a.messages }),
               JSON.stringify({ t: b.tools, s: b.system, m: b.messages }),
               'le préfixe diffère entre deux appels — le cache ne prendra jamais');
});

test('un corpus qui change laisse le préfixe système intact', () => {
  // Quelqu'un qui écrit une journée puis relance ne doit pas repayer les
  // consignes : c'est à ça que sert la première marque.
  const a = requeteLecture(corpus('journal du lundi'), S);
  const b = requeteLecture(corpus('journal du lundi, plus le mardi'), S);
  assert.equal(JSON.stringify(a.system), JSON.stringify(b.system));
  assert.equal(JSON.stringify(a.tools), JSON.stringify(b.tools));
  assert.notEqual(JSON.stringify(a.messages), JSON.stringify(b.messages));
});

test('rien de daté ni d’aléatoire dans les consignes', () => {
  // Une date dans le système invaliderait tout ce qui suit, tous les jours.
  const texte = requeteLecture(corpus('x'), S).system.map(b => b.text).join('');
  assert.doesNotMatch(texte, /\d{4}-\d{2}-\d{2}/, 'une date dans les consignes casserait le préfixe');
  assert.doesNotMatch(texte, /[0-9a-f]{8}-[0-9a-f]{4}-/i, 'un identifiant unique aussi');
});

test('le système seul dépasse le préfixe minimum d’Opus 5 (512 jetons)', () => {
  // En dessous du minimum, la marque ne crée rien — sans erreur, sans rien
  // signaler. On mesure grossièrement : trois caractères et demi par jeton.
  const texte = requeteLecture(corpus('x'), S).system.map(b => b.text).join('');
  assert.ok(texte.length / 3.5 > 512, `système trop court pour cacher : ~${Math.round(texte.length / 3.5)} jetons`);
});
