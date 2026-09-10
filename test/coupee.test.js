/*
 * UNE PHRASE COUPÉE EN DEUX NE PART NI À L'ÉCRAN NI DANS LA BASE.
 *
 * `stop_reason === 'max_tokens'` n'était lu nulle part : seuls `refusal` et
 * `tool_use` étaient traités, tout le reste tombait dans le `break`. Une
 * réponse qui butait sur le plafond partait donc arrêtée au milieu d'un mot —
 * et `addMessage` l'écrivait dans le journal, où elle reste. Le compagnon
 * relit ensuite ses propres réponses : une phrase tronquée s'y installe et se
 * recopie.
 *
 * C'était rare tant que le plafond valait 2048. Ça devient l'ordinaire dès
 * qu'on le baisse pour dépenser moins — donc ceci vient AVANT toute économie
 * sur la sortie, pas après.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { jusquAuPoint } from '../server/chat.js';

test('on revient à la dernière fin de phrase', () => {
  assert.equal(
    jusquAuPoint('Tu as écrit ça trois fois cette semaine. Est-ce que tu remar'),
    'Tu as écrit ça trois fois cette semaine.');
});

test('les trois ponctuations de fin comptent, et les guillemets fermants aussi', () => {
  assert.equal(jusquAuPoint('Et là, qu’est-ce qui se passe ? Tu me dis que tu ét'),
               'Et là, qu’est-ce qui se passe ?');
  assert.equal(jusquAuPoint('Tu l’as appelée « le fond ». Ce soir tu écris que'),
               'Tu l’as appelée « le fond ».');
});

test('UNE SEULE LONGUE PHRASE SE GARDE TELLE QUELLE', () => {
  /*
   * Rendre du vide serait pire que rendre l'inachevé : quelqu'un qui écrit un
   * mauvais soir n'a pas à recevoir une réponse blanche parce qu'un plafond a
   * été mal réglé.
   */
  const t = 'je crois que ce que tu décris là ressemble beaucoup à ce que tu écrivais en';
  assert.equal(jusquAuPoint(t), t);
});

test('un début trop court ne suffit pas à faire une réponse', () => {
  // « Oui. » suivi de quarante mots coupés : garder « Oui. » seul serait une
  // réponse qui n'en est pas une.
  const t = 'Oui. Et ce qui revient à chaque fois, c’est que tu commences par te dire que ce n’est pas gr';
  assert.equal(jusquAuPoint(t), t, 'on préfère l’inachevé à un acquiescement nu');
});

test('un texte déjà complet ne bouge pas', () => {
  const t = 'Tu t’es couché à 6 h. C’est la troisième fois cette semaine.';
  assert.equal(jusquAuPoint(t), t);
});

test('du vide reste du vide', () => {
  assert.equal(jusquAuPoint(''), '');
  assert.equal(jusquAuPoint(null), '');
});
