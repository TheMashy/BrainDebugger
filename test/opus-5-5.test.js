/**
 * OPUS 5.5 : DEUX REFUS QUI NE SE VOIENT PAS.
 *
 * La personne a demandé ce modèle-là par défaut, pour le compagnon et pour la
 * lecture de fond. Il ne se comporte pas comme celui d'avant sur deux points,
 * et les deux rendent 400 — c'est-à-dire rien du tout à l'écran :
 *
 *   1. SA RÉFLEXION NE S'ÉTEINT PAS. `thinking: {type:'disabled'}` et
 *      `budget_tokens` sont refusés, à TOUS les niveaux d'effort. Or
 *      `optionsDuModele` envoyait `disabled` dès qu'on lui passait
 *      `pense: false` — ce que fait le chemin économique du compagnon.
 *
 *   2. ON NE PEUT PAS LUI IMPOSER UN OUTIL. `tool_choice: {type:'tool'}` est
 *      refusé. Or la lecture de fond ET le juge de veille forçaient tous les
 *      deux, parce qu'ils veulent une structure et rien d'autre.
 *
 * Le second est le pire des deux, parce qu'il est MUET : quand la lecture de
 * fond échoue, l'écran retombe sur « Lancer la lecture », exactement comme si
 * on n'avait jamais cliqué. Personne ne vient dire que ça a raté.
 *
 * Ce fichier tient donc la forme des requêtes qui partent, modèle par modèle,
 * et il tient aussi ce qui NE DOIT PAS bouger pour les autres : un modèle
 * inconnu reste servi comme avant, et Opus 5 garde son `disabled`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { optionsDuModele, demanderOutil, CAPACITES, ANTHROPIC_MODELS,
         plafondDuCompagnon, PLAFOND_SANS_REFLEXION } from '../server/chat.js';
import { requeteLecture } from '../server/lecture.js';
import { requeteJugement, OUTIL_VERDICT } from '../server/juge-veille.js';
import { DEFAULT_SETTINGS } from '../server/db.js';
import { PRICES } from '../server/usage.js';

const OPUS55 = 'claude-opus-5-5';

/* ============ 1. LA RÉFLEXION NE S'ÉTEINT PAS ============ */

test('Opus 5.5 ne reçoit JAMAIS thinking:disabled, même quand on ne veut pas qu’il pense', () => {
  for (const effort of [null, 'low', 'medium', 'high']) {
    const o = optionsDuModele(OPUS55, { effort, pense: false });
    assert.deepEqual(o.thinking, { type: 'adaptive' },
      `effort ${effort} : ${JSON.stringify(o.thinking)} au lieu d'adaptive`);
    assert.equal('budget_tokens' in (o.thinking ?? {}), false);
  }
});

test('Opus 5, lui, garde son extinction explicite — la migration ne l’a pas emporté', () => {
  /*
   * La garde d'au-dessus serait vide si elle passait aussi sur l'ancien
   * modèle : c'est la DIFFÉRENCE entre les deux qui est testée ici.
   */
  assert.deepEqual(optionsDuModele('claude-opus-5', { effort: 'low', pense: false }).thinking,
                   { type: 'disabled' });
  assert.deepEqual(optionsDuModele('claude-opus-5', { effort: 'low', pense: true }).thinking,
                   { type: 'adaptive' });
});

test('quand on veut qu’il pense, rien ne change pour personne', () => {
  for (const m of [OPUS55, 'claude-opus-5', 'claude-sonnet-5']) {
    assert.deepEqual(optionsDuModele(m, { effort: 'high', pense: true }).thinking,
                     { type: 'adaptive' }, m);
  }
});

/* ============ 2. L'OUTIL SE DEMANDE, IL NE S'IMPOSE PAS ============ */

test('on n’impose pas d’outil à Opus 5.5 — on le lui demande, et on le dit', () => {
  const d = demanderOutil(OPUS55, 'rendre_lecture');
  assert.deepEqual(d.tool_choice, { type: 'auto' });
  assert.match(d.consigne, /rendre_lecture/);
  assert.match(d.consigne, /\n\n$/, 'la consigne est un préfixe déjà ponctué');
});

test('aux modèles qui l’acceptent, on continue d’imposer — et sans consigne', () => {
  for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
    const d = demanderOutil(m, 'rendre_verdict');
    assert.deepEqual(d.tool_choice, { type: 'tool', name: 'rendre_verdict' }, m);
    assert.equal(d.consigne, '', m);
  }
});

test('un modèle INCONNU reste servi comme avant', () => {
  /*
   * Même asymétrie que pour le repli serveur : se rabattre sur `auto` là où le
   * forçage marchait rend la structure facultative, donc la lecture faillible,
   * sur tous les modèles qu'on n'a pas encore listés. Le défaut est le
   * comportement d'avant ; seul celui qui refuse le déclare.
   */
  for (const m of ['claude-modele-de-2029', '', null, undefined]) {
    assert.deepEqual(demanderOutil(m, 'rendre_lecture').tool_choice,
                     { type: 'tool', name: 'rendre_lecture' }, String(m));
  }
});

/* ============ 3. CE QUI PART VRAIMENT SUR LE FIL ============ */

const CORPUS = { etendue: 400, complet: false, texte: '12/08 — journée courte.' };

test('la lecture de fond part en demandant l’outil, la consigne collée au texte', () => {
  const r = requeteLecture(CORPUS, { anthropicModel: OPUS55 });
  assert.equal(r.model, OPUS55);
  assert.deepEqual(r.tool_choice, { type: 'auto' });
  const texte = r.messages[0].content[0].text;
  assert.match(texte, /^Réponds en appelant l’outil « rendre_lecture »/);
  assert.match(texte, /journée courte/, 'le corpus est toujours là, derrière');
});

test('la lecture de fond sur Opus 5 n’a PAS gagné de consigne parasite', () => {
  const r = requeteLecture(CORPUS, { anthropicModel: 'claude-opus-5' });
  assert.deepEqual(r.tool_choice, { type: 'tool', name: 'rendre_lecture' });
  assert.equal(r.messages[0].content[0].text.startsWith('Réponds en appelant'), false);
});

test('le juge de veille suit la même règle, sans que son défaut bouge', () => {
  const passage = { date: '2026-08-12', avant: '', texte: 'je raconte une vieille histoire', apres: '' };

  const parDefaut = requeteJugement(passage);
  assert.equal(parDefaut.model, 'claude-sonnet-5', 'le juge reste sur Sonnet : c’est un lot, à moitié prix');
  assert.deepEqual(parDefaut.tool_choice, { type: 'tool', name: OUTIL_VERDICT.name });

  const surOpus = requeteJugement(passage, { anthropicModelVeille: OPUS55 });
  assert.deepEqual(surOpus.tool_choice, { type: 'auto' });
  assert.match(surOpus.messages[0].content[0].text, /^Réponds en appelant l’outil « rendre_verdict »/);
  assert.match(surOpus.messages[0].content[0].text, /vieille histoire/);
});

/* ============ 4. CE QUE LA PERSONNE A DEMANDÉ, ET CE QUE ÇA COÛTE ============ */

test('Opus 5.5 est le défaut des DEUX chemins', () => {
  assert.equal(DEFAULT_SETTINGS.anthropicModel, OPUS55, 'la lecture de fond');
  assert.equal(DEFAULT_SETTINGS.anthropicModelChat, OPUS55, 'le compagnon');
});

test('la jauge connaît son prix — sinon elle facture 25 % de trop en silence', () => {
  /*
   * `PRICES[r.model] ?? PRICES['claude-opus-5']` : un modèle absent de la
   * table n'est pas signalé, il est facturé au tarif d'Opus 5. Le défaut du
   * produit venant de passer sur Opus 5.5, l'oubli aurait porté sur la
   * totalité de la dépense.
   */
  assert.deepEqual(PRICES[OPUS55], { in: 4, out: 20 });
  assert.ok(PRICES[OPUS55].in < PRICES['claude-opus-5'].in, 'moins cher que la génération d’avant');
  assert.ok(PRICES[OPUS55].out > PRICES['claude-sonnet-5'].out, 'mais toujours plus cher que Sonnet');
});

test('il est proposé dans Réglages, donc on peut en revenir en un clic', () => {
  const ids = ANTHROPIC_MODELS.map(m => m.id);
  assert.equal(ids[0], OPUS55, 'en tête, puisque c’est le défaut');
  for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
    assert.ok(ids.includes(m), `${m} reste atteignable`);
  }
});

test('l’écran sait l’écrire en toutes lettres', () => {
  /*
   * Sans ça, Réglages affiche « Claude claude-opus-5-5 » : le repli existe,
   * il n'est juste pas présentable.
   */
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const ligne = app.match(/const MODELES = \{[\s\S]*?\};/);
  assert.ok(ligne, 'la table des étiquettes a bougé de place');
  assert.match(ligne[0], /'claude-opus-5-5': 'Opus 5\.5'/);
});

test('la table des capacités dit les deux refus, pour qui lira le code après', () => {
  assert.equal(CAPACITES[OPUS55].coupe, 'jamais');
  assert.equal(CAPACITES[OPUS55].outilForce, false);
  assert.equal(CAPACITES[OPUS55].repli, true, 'il porte le repli serveur comme Opus 5');
});

/* ============ 5. LA RÉFLEXION QU'ON NE PEUT PAS ÉTEINDRE A UN PRIX ============ */

test('quand une réflexion part, la réponse garde sa place sous le plafond', () => {
  /*
   * Le compagnon tenait sur 2048 jetons parce que sa réflexion était éteinte.
   * Sur Opus 5.5 elle ne l'est plus, et les deux partagent `max_tokens` :
   * sans cette marge, les réponses sortaient raccourcies par `jusquAuPoint`.
   */
  const opus55 = optionsDuModele(OPUS55, { effort: 'low', pense: false });
  assert.ok(plafondDuCompagnon(opus55) > PLAFOND_SANS_REFLEXION * 2);

  // …et rien ne bouge là où la réflexion est vraiment éteinte.
  const opus5 = optionsDuModele('claude-opus-5', { effort: 'low', pense: false });
  assert.equal(plafondDuCompagnon(opus5), PLAFOND_SANS_REFLEXION);
  assert.equal(plafondDuCompagnon(optionsDuModele('claude-haiku-4-5', {})), PLAFOND_SANS_REFLEXION);
});

test('le compagnon envoie bien ce plafond-là — pas un 2048 resté en dur', () => {
  const src = readFileSync(new URL('../server/chat.js', import.meta.url), 'utf8');
  assert.match(src, /max_tokens: plafondDuCompagnon\(optionsCompagnon\)/);
  assert.doesNotMatch(src, /max_tokens: 2048/);
});

test('Réglages ne promet pas « répond d’un trait » sur un modèle qui réfléchit toujours', () => {
  assert.equal(ANTHROPIC_MODELS.find(m => m.id === OPUS55).penseToujours, true);
  for (const m of ANTHROPIC_MODELS.filter(m => m.id !== OPUS55)) {
    assert.equal(m.penseToujours, false, `${m.id} garde son bouton`);
  }
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const i = app.indexOf("segment('chatPensee'");
  const avant = app.slice(Math.max(0, i - 900), i);
  assert.match(avant, /penseToujours/, 'le bouton n’est plus conditionné au modèle');
  assert.match(avant, /ne permet pas de l’éteindre/);
});
