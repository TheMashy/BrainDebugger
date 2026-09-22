/**
 * UNE LECTURE COUPÉE DIT QU'ELLE EST COUPÉE.
 *
 * Premier essai réel sur Opus 5.5 : « Ça n'a pas abouti — 812 signes — le
 * modèle n'a rien rendu cette fois ». Il avait rendu quelque chose : un appel
 * d'outil COUPÉ AU PLAFOND. 8000 jetons suffisaient à Opus 5 ; Opus 5.5
 * réfléchit davantage au même effort, sa réflexion ne s'éteint pas et ne se
 * voit pas (d'où 812 signes seulement). Le JSON partait tronqué, la validation
 * le vidait, et `stop_reason` n'était lu nulle part.
 *
 * Trois choses tiennent ici : la marge quand une réflexion part, la cause dite
 * en clair, et les jetons comptés même quand la carte n'arrive pas.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { requeteLecture, depouiller, PLAFOND_LECTURE, PLAFOND_LECTURE_PENSEE } from '../server/lecture.js';

const CORPUS = { etendue: 400, complet: false, texte: '12/08 — journée courte.', dates: new Set(['2026-08-12']) };
const usage = { input_tokens: 40000, output_tokens: 8000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

test('quand une réflexion part, la carte a la place de s’écrire', () => {
  const r = requeteLecture(CORPUS, { anthropicModel: 'claude-opus-5-5' });
  assert.ok(r.thinking, 'la réflexion part bien');
  assert.equal(r.max_tokens, PLAFOND_LECTURE_PENSEE);
  assert.ok(PLAFOND_LECTURE_PENSEE >= 4 * 8000, 'la marge n’est pas symbolique');
});

test('sans réflexion (Haiku), le plafond ne bouge pas', () => {
  const r = requeteLecture(CORPUS, { anthropicModel: 'claude-haiku-4-5' });
  assert.equal(r.thinking, undefined);
  assert.equal(r.max_tokens, PLAFOND_LECTURE);
});

test('coupée au plafond : la cause est dite, et ce n’est pas « rien rendu »', () => {
  const res = { stop_reason: 'max_tokens', model: 'claude-opus-5-5', usage,
                content: [{ type: 'tool_use', name: 'rendre_lecture', input: { series: [] } }] };
  assert.throws(() => depouiller(res, CORPUS, {}), err => {
    assert.match(err.message, /coupée avant la fin/);
    assert.match(err.message, /8000 jetons/);
    assert.doesNotMatch(err.message, /rien rendu/);
    assert.equal(err.lotFini, true, 'un lot coupé le restera : le relever encore ne sert à rien');
    assert.equal(err.usage.output, 8000, 'ces jetons ont été payés');
    assert.equal(err.modele, 'claude-opus-5-5');
    return true;
  });
});

test('un appel d’outil tronqué ne passe PLUS la validation en silence', () => {
  /*
   * Le cas exact de la capture : un `tool_use` présent, mais coupé. Avant,
   * seul l'absence d'appel était vérifiée — celui-ci aurait été validé vide.
   */
  const res = { stop_reason: 'max_tokens', usage,
                content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', input: {} }] };
  assert.throws(() => depouiller(res, CORPUS, {}), /coupée/);
});

test('répondu en texte au lieu de l’outil : dit aussi, avec sa fin', () => {
  // `auto` ne garantit pas l'appel sur Opus 5.5 : le cas doit se nommer.
  const res = { stop_reason: 'end_turn', usage, content: [{ type: 'text', text: 'Voici ta carte…' }] };
  assert.throws(() => depouiller(res, CORPUS, {}), err => {
    assert.match(err.message, /sans rendre de carte/);
    assert.match(err.message, /end_turn/);
    assert.equal(err.usage.input, 40000);
    return true;
  });
});

test('un refus se dit comme un refus', () => {
  const res = { stop_reason: 'refusal', usage, content: [] };
  assert.throws(() => depouiller(res, CORPUS, {}), /refusé/);
});

test('la lecture directe part en flux — le SDK refuserait ce plafond sans', () => {
  const src = readFileSync(new URL('../server/lecture.js', import.meta.url), 'utf8');
  const i = src.indexOf('export async function lire(');
  const corps = src.slice(i, src.indexOf('\n}\n', i));
  assert.match(corps, /messages\.stream\(/);
  assert.match(corps, /\.finalMessage\(\)/);
  assert.doesNotMatch(corps, /messages\.create\(/);
});

test('les trois chemins comptent une lecture ratée dans la jauge', () => {
  const api = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  const appels = api.match(/^\s+compterLectureRatee\(userId, err, s\);/gm) ?? [];
  assert.equal(appels.length, 3, 'le lot, la lecture directe, la lecture en flux');
});
