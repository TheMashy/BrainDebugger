/*
 * EN CRISE, LE COMPAGNON DEMANDE POURQUOI, IL NE DONNE PAS D'ORDRES.
 * Ce qui est testé : la consigne le dit, en toutes lettres, et les questions
 * scriptées du repli n'ont pas d'impératif.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../server/chat.js', import.meta.url), 'utf8');

test('la consigne interdit les ordres en crise et demande pourquoi', () => {
  assert.match(src, /TU NE DONNES AUCUN ORDRE/);
  assert.match(src, /DEMANDER POURQUOI/);
  assert.match(src, /LA CHALEUR/);
  assert.match(src, /3114 existe/);
});

test('les questions scriptées ne sont pas des consignes', () => {
  const bloc = src.slice(src.indexOf('const PROBES = ['), src.indexOf('];', src.indexOf('const PROBES = [')));
  for (const q of bloc.match(/'([^']+)'|"([^"]+)"/g) ?? []) {
    const t = q.slice(1, -1);
    assert.doesNotMatch(t, /^(va|vas|appelle|arr[êe]te|respire|pose|dors|calme|fais|prends|essaie|essaye)\b/i, `« ${t} » est un ordre`);
    assert.doesNotMatch(t, /\bil faut\b|\btu dois\b|\btu devrais\b/i, `« ${t} » est une consigne`);
  }
});
