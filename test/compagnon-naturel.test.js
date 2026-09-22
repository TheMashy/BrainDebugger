/**
 * LE COMPAGNON PARLE COMME UN AMI, PAS COMME UN DOSSIER.
 *
 * Une réponse réelle, sur Opus 5.5 : « Entre 17h49 et 19h41, qu'est-ce qui a
 * fait redescendre ? ». Et avant elle, des « c'est comme le 14 ». La personne :
 * « à tout prix éviter ce genre de question, plutôt demander ce qu'il fait là,
 * ou ce qu'il va faire après, plus du small talk constructif ».
 *
 * Les deux tournures venaient de NOS consignes : « c'est un peu comme le 14 »
 * y était donné en exemple, « levé à 15:38 » aussi, et l'heure de chaque
 * message était à utiliser « comme quelqu'un qui a une montre ». Opus 5.5
 * suit les exemples de très près — il les a suivis.
 *
 * Ce fichier tient trois choses : les exemples qui se recopient ont disparu,
 * les tournures à éviter sont NOMMÉES (c'est ce que ce modèle suit le mieux),
 * et la conversation ordinaire est ce qu'on lui demande à la place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SYSTEM_PROMPT, echoBlock, posteBlock, demanderConsoBlock, prisesBlock, scriptedReply } from '../server/chat.js';
import { proposerNoteBlock } from '../server/proposer-note.js';

const plat = t => String(t).replace(/\s+/g, ' ');

test('l’exemple « c’est comme le 14 » n’est plus une chose À FAIRE', () => {
  const p = plat(SYSTEM_PROMPT);
  assert.doesNotMatch(p, /dis-le, en citant le jour/);
  assert.doesNotMatch(p, /Un rappel daté se vérifie/);
  // Il ne subsiste que dans la liste de ce qu'on n'écrit pas.
  const i = p.indexOf('c\'est comme le 14');
  assert.ok(i > p.indexOf('CE QUI SONNE FAUX'), 'l’exemple est revenu hors de la liste des interdits');
});

test('les tournures à éviter sont nommées, une par une', () => {
  const p = plat(SYSTEM_PROMPT);
  assert.match(p, /CE QUI SONNE FAUX, ET QUE TU N'ÉCRIS PAS/);
  assert.match(p, /entre 17h49 et 19h41/);
  assert.match(p, /qu'est-ce qui a fait redescendre/);
  assert.match(p, /comment tu te sens, là/);
});

test('ce qu’on lui demande à la place : la vie ordinaire', () => {
  const p = plat(SYSTEM_PROMPT);
  assert.match(p, /ce qu'il fait là, ce qu'il a prévu après/);
  assert.match(p, /pas de l'introspection/);
  assert.doesNotMatch(p, /Tu creuses les faits plutôt que les émotions/);
  assert.doesNotMatch(p, /comme quelqu'un qui a une montre/);
});

test('la crise garde sa façon à elle de demander pourquoi', () => {
  // L'interdit des questions « mécanisme » ne vaut pas en crise : là, demander
  // ce qui s'est passé EST la consigne, et elle ne doit pas être emportée.
  const p = plat(SYSTEM_PROMPT);
  assert.match(p, /En crise, c'est autre chose/);
  assert.match(p, /DEMANDER POURQUOI/);
  assert.match(p, /3114/);
});

test('les mesures de la machine ne se récitent pas à la minute', () => {
  const b = plat(posteBlock({ lever: { heure: '15:38', source: 'mesure' }, sommeil_h: 9.5 }));
  assert.doesNotMatch(b, /« ah, levé à/);
  assert.match(b, /pas à la minute/);
});

test('les échos ne se ressortent pas de soi-même', () => {
  const b = plat(echoBlock([{ date: '2026-09-14', note: 5, text: 'rentré plus tôt du boulot, crevé' }]));
  assert.match(b, /Pas de « c'est comme le 14 » lancé de toi-même/);
});

test('l’humeur passe par la conversation, pas par « comment tu te sens, là ? »', () => {
  const b = plat(proposerNoteBlock({ demander: true, pourquoi: 'le ton vient de changer' }));
  assert.match(b, /Pas en le lui demandant de front/);
  assert.match(b, /ce qu'il fait là, ce qu'il a prévu après/);
  assert.doesNotMatch(b, /Demande-lui où il en est LÀ/);
});

test('la consommation s’amène par la soirée, jamais par « pas trop de X ? »', () => {
  const autre = plat(demanderConsoBlock({ demander: true, nom: 'le cannabis', genre: 'produit',
                                          pourquoi: 'il en a parlé hier' }));
  assert.match(autre, /par la conversation, pas de front/);
  assert.match(autre, /jamais « pas trop de cannabis aujourd'hui \? », qui sonne comme une surveillance/);
  assert.doesNotMatch(autre, /Demande-lui où ça en est ce soir, court et sans détour/);

  // Le traitement reste un compte, jamais une surveillance.
  const trt = plat(demanderConsoBlock({ demander: true, nom: 'le Xanax', genre: 'traitement', pourquoi: 'x' }));
  assert.match(trt, /COMBIEN/);
  assert.match(trt, /jamais « pas trop \? »/);

  const regle = plat(prisesBlock({ prises: [{ nom: 'cannabis', n: 30, parle: true, genre: 'produit' }] }));
  assert.match(regle, /Par la conversation, pas par un contrôle/);
  assert.doesNotMatch(regle, /« pas trop de cannabis aujourd'hui \? », « tu en as pris/);
});

test('même hors-ligne, les relances parlent de la soirée, pas du mécanisme', () => {
  const vues = new Set();
  for (let i = 0; i < 40; i++) vues.add(scriptedReply(Array.from({ length: i }, () => ({ role: 'user', text: 'x' }))));
  for (const r of vues) {
    assert.doesNotMatch(r, /à quel moment|basculé|venu d'où|juste avant|entre le matin et le soir/, r);
  }
});
