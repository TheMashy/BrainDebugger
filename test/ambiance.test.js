/*
 * L'AMBIANCE D'UNE JOURNÉE, RENDUE LISIBLE.
 *
 * Le décor de l'application est peint depuis toujours par `readMood` : les mots
 * qu'on écrit choisissent une scène, la scène teint l'écran, et personne ne
 * sait ce que ça veut dire. La pastille de gauche, dans « Moi », nomme ce
 * calcul — un fond qui change sans qu'on sache pourquoi est une ambiance ;
 * nommé, il devient une lecture, et une lecture se conteste.
 *
 * Ce qui se teste ici tient en trois décisions, et elles comptent plus que le
 * calcul lui-même : la note n'entre pas, on se tait plutôt que de meubler, et
 * la seconde scène se dit quand elle talonne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-ambiance-')), 'test.db');

const { upsertUser, addMessage, setNote } = await import('../server/db.js');
const { ambianceDuJour, journee } = await import('../server/journee.js');
const { SENS, MOTS_MINIMUM, readMood } = await import('../server/mood.js');

const U = 'ambiance';
upsertUser({ id: U, username: U });

const VIDE = "je me sens vide, complètement vide, comme un puits sans fond. rien ne remplit rien, "
           + "j'ai l'impression de tomber sans jamais toucher le sol, il n'y a rien en dessous et rien au dessus de moi";

/** Écrit `texte` le jour `d`, avec une note optionnelle, et rend l'ambiance. */
function jour(d, texte, note = null) {
  addMessage({ ts: `${d}T20:00:00.000Z`, date: d, role: 'user', text: texte, userId: U });
  if (note !== null) setNote(d, note, U);
  return ambianceDuJour(d, U);
}

test('ce que les mots portent est nommé, avec son image', () => {
  const a = jour('2026-02-01', VIDE);
  assert.equal(a.scene, 'voidwell');
  assert.equal(a.nom, 'le vide');
  assert.equal(a.image, 'un puits sans fond');
  assert.equal(`${a.nom} — ${a.image}`, SENS.voidwell, 'le libellé doit rester celui du lexique, pas une paraphrase');
  assert.ok(a.force > 0 && a.force <= 1, `force ${a.force}`);
  assert.ok(a.mots > MOTS_MINIMUM);
});

test('LA NOTE N’ENTRE PAS — sinon les deux pastilles diraient la même chose', () => {
  /*
   * `readMood` sait se servir de la note pour infléchir la scène, et c'est bon
   * pour peindre un décor. Ici, non : la pastille se pose à CÔTÉ de la note. Si
   * la note l'alimentait, les deux seraient corrélées par construction, et le
   * jour où elles divergent — le seul qui mérite un regard — n'existerait plus.
   *
   * Les deux textes qui suivent sont choisis parce que la note CHANGE ce que
   * `readMood` en fait. Sans eux, le test passerait aussi avec la note
   * branchée : sur un texte franc, elle ne déplace rien, et on croirait avoir
   * vérifié quelque chose.
   */

  // 1. La bonne note EFFACE ce que les mots disaient. C'est la direction
  //    dangereuse : « je me sens un peu vide » disparaît parce qu'on a mis 9.
  const unPeuVide = "je me sens un peu vide ce soir, la journée a été longue et j ai fait ce que j avais "
                  + "à faire, les courses, le ménage, un appel à ma mère, rien de plus";
  assert.equal(readMood(unPeuVide, 9).scene, 'drift', 'le texte témoin ne joue plus son rôle : à revoir');
  const efface = jour('2026-02-02', unPeuVide, 9);
  assert.equal(efface?.scene, 'voidwell', 'la bonne note a effacé ce que les mots portaient');

  // 2. La mauvaise note FABRIQUE une lecture que les mots ne portent pas.
  const calme = "la journée a tenu, calme, j ai marché un peu dans le quartier et le soleil était là, "
              + "rien de spécial mais rien de lourd non plus, une journée qui passe tranquillement sans accroc";
  assert.equal(readMood(calme, null).scene, 'drift', 'le texte témoin ne joue plus son rôle : à revoir');
  assert.equal(readMood(calme, 9).scene, 'brume');
  assert.equal(jour('2026-02-03', calme, 9), null, 'la note a fabriqué une scène que les mots ne portent pas');

  // 3. Et l'invariant, sur tout l'éventail : même texte, même lecture.
  const lectures = new Set();
  for (const n of [0, 2, 5, 8, 10]) {
    const a = jour(`2026-03-0${[0, 2, 5, 8, 10].indexOf(n) + 1}`, VIDE, n);
    lectures.add(`${a.scene}|${a.force}`);
  }
  assert.equal(lectures.size, 1, `la note déplace la lecture : ${[...lectures].join(' / ')}`);
});

test('on se tait plutôt que de meubler', () => {
  assert.equal(jour('2026-02-05', 'ça va'), null, 'deux mots ne sont pas une lecture');
  assert.equal(jour('2026-02-06', ''), null);
  // Un texte long mais dont le lexique ne dit rien : pas de scène, pas de
  // pastille. Un chiffre constant présenté comme une lecture est pire que rien.
  const plat = 'lundi mardi mercredi jeudi vendredi samedi dimanche ' .repeat(6);
  assert.equal(jour('2026-02-07', plat), null);
});

test('la seconde scène se dit quand elle talonne', () => {
  const a = jour('2026-02-08', VIDE);
  if (a.seconde) {
    assert.ok(SENS[a.seconde], `« ${a.seconde} » n’est pas une scène connue`);
    assert.equal(a.seconde_nom, SENS[a.seconde].split(' — ')[0]);
  } else {
    assert.equal(a.seconde_nom, null, 'pas de seconde, pas de nom de seconde');
  }
});

test('la journée rendue au navigateur porte son ambiance', () => {
  const d = '2026-02-09';
  jour(d, VIDE, 6);
  const j = journee(d, U, { zone: 'UTC' });
  assert.equal(j.ambiance.scene, 'voidwell');
  // Et une journée sans lecture nette la porte à null plutôt que de l'omettre :
  // l'écran distingue « rien à dire » de « champ absent ».
  jour('2026-02-10', 'ok');
  assert.equal(journee('2026-02-10', U, { zone: 'UTC' }).ambiance, null);
});
