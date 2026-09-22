/*
 * EN CRISE, LE COMPAGNON DEMANDE POURQUOI, IL NE DONNE PAS D'ORDRES.
 * Ce qui est testé : la consigne le dit, en toutes lettres, et les questions
 * scriptées du repli n'ont pas d'impératif.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../server/chat.js', import.meta.url), 'utf8');

test('en crise, la question se pose directement, et les numéros utiles se donnent', () => {
  /*
   * La règle était « aucun ordre, demander pourquoi, le 3114 une fois sans
   * insister ». Comparée à la même discussion menée ailleurs, elle rendait le
   * compagnon moins sûr, pas plus : il ne pouvait ni demander s'il y avait
   * des idées de suicide, ni dire d'apporter l'écrit à la psy, ni donner le
   * 15. Demander directement est ce que font les gens dont c'est le métier.
   */
  const crise = src.slice(src.indexOf("S'IL PARLE DE SE FAIRE DU MAL"), src.indexOf('FORME\nFrançais'));
  const plat = crise.replace(/\s+/g, ' ');
  assert.match(plat, /« est-ce que tu penses à te tuer \? »/);
  assert.match(plat, /« est-ce que tu as pensé à comment \? »/);
  assert.match(plat, /Demander ne met pas l'idée dans la tête/);
  assert.match(plat, /S'il répond non, tu le crois/);
  assert.match(plat, /3114/);
  assert.match(plat, /le 15, ou le 112, maintenant/);
  assert.match(plat, /s'il a quelqu'un qui le suit/);
  // Ce qui ne bouge pas.
  assert.match(plat, /pas de « va dormir », pas de « respire », pas de « ça va aller »/);
  assert.match(plat, /tu ne récites pas de protocole/);
  assert.match(plat, /tu ne le lâches pas/);
  assert.match(src, /LA CHALEUR/);
});

test('les questions scriptées ne sont pas des consignes', () => {
  const bloc = src.slice(src.indexOf('const PROBES = ['), src.indexOf('];', src.indexOf('const PROBES = [')));
  for (const q of bloc.match(/'([^']+)'|"([^"]+)"/g) ?? []) {
    const t = q.slice(1, -1);
    assert.doesNotMatch(t, /^(va|vas|appelle|arr[êe]te|respire|pose|dors|calme|fais|prends|essaie|essaye)\b/i, `« ${t} » est un ordre`);
    assert.doesNotMatch(t, /\bil faut\b|\btu dois\b|\btu devrais\b/i, `« ${t} » est une consigne`);
  }
});
