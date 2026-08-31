/**
 * LA JOURNÉE, HEURE PAR HEURE.
 *
 * On ouvrait une journée et on y trouvait sa note, son texte, et rien de ce qui
 * s'était PASSÉ dedans. Une journée notée 8 peut contenir « juste envie de
 * mourir » écrit le soir : c'est la bascule qui la raconte, pas le niveau moyen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-jour-')), 'test.db');

const { OWNER, addMessage, setNote } = await import('../server/db.js');
const J = await import('../server/journee.js');

const JOUR = '2026-03-12';
const ts = (h, m = 0) => `2026-03-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const dire = (h, m, text, role = 'user') =>
  addMessage({ ts: ts(h, m), date: JOUR, source: 'web', role, text, userId: OWNER });

/* ============ LE CŒUR D'UN MOMENT ============ */

test('le cœur est une phrase choisie, jamais réécrite', () => {
  const t = "hello. bon alors. j'ai fait une nuit blanche et je me sens vide depuis ce matin.";
  const c = J.coeurDe(t);
  // La phrase est celle qui PÈSE, pas la première : « hello » et « bon alors »
  // ouvrent la moitié des messages et ne racontent rien.
  assert.match(c, /nuit blanche/);
  assert.ok(!c.startsWith('hello'), 'le cœur ne doit pas être la formule d’ouverture');
  // Et c'est bien SA phrase, au caractère près tant qu'elle tient.
  assert.ok(t.includes(c.replace(/…$/, '')), 'le cœur a été réécrit au lieu d’être cité');
});

test('une phrase trop longue est coupée sur un mot, et le dit', () => {
  const c = J.coeurDe('a'.repeat(4) + ' mot '.repeat(60));
  assert.ok(c.length <= J.COEUR_CAR + 1, `${c.length} caractères`);
  assert.match(c, /…$/);
  assert.equal(c.includes('mo…'), false, 'coupé au milieu d’un mot');
});

test('un message vide n’invente pas de cœur', () => {
  assert.equal(J.coeurDe(''), '');
  assert.equal(J.coeurDe(null), '');
  assert.equal(J.coeurDe('   '), '');
});

/* ============ LES MOMENTS ============ */

test('trois messages d’affilée font UN moment, pas trois', () => {
  dire(8, 0, "j'ai encore fait une nuit blanche");
  dire(8, 4, 'je tourne en rond depuis 4h du matin');
  dire(8, 9, 'et là je suis vidé');
  dire(22, 30, 'la soirée a tenu, finalement. le vélo a aidé.');
  const mo = J.momentsDuJour(JOUR, OWNER, { zone: 'UTC' });
  assert.equal(mo.length, 2, 'un échange continu est un moment');
  assert.equal(mo[0].heure, '08:00');
  assert.equal(mo[1].heure, '22:30');
  assert.equal(mo[0].messages, 3);
});

test('le compagnon ne teint pas la journée avec ses propres mots', () => {
  dire(12, 0, "c'est peut-être la fatigue qui parle, pas toi", 'pet');
  const mo = J.momentsDuJour(JOUR, OWNER, { zone: 'UTC' });
  assert.equal(mo.some(m => m.coeur.includes('la fatigue qui parle')), false);
  assert.equal(mo.length, 2, 'la réponse du compagnon a créé un moment');
});

test('LA NOTE DU SOIR NE REPEINT PAS LE MATIN', () => {
  /*
   * `readMood` accepte une note et s'en sert pour infléchir la scène. C'est
   * juste pour peindre le décor du JOUR, faux pour une ligne du matin : la note
   * a été posée le soir, et elle repeindrait uniformément tous les moments avec
   * ce qu'on a conclu après. On perdrait exactement la bascule qu'on vient voir.
   */
  const avant = J.momentsDuJour(JOUR, OWNER, { zone: 'UTC' }).map(m => m.scene);
  setNote(JOUR, 9, OWNER);
  const apres = J.momentsDuJour(JOUR, OWNER, { zone: 'UTC' }).map(m => m.scene);
  assert.deepEqual(apres, avant, 'la note du soir a déteint sur les moments');
});

test('la charge reste entre −1 et +1, et n’est jamais une note', () => {
  for (const [scene, force] of [['voidwell', 9], ['brume', 9], ['drift', 0], ['abyss', 3]]) {
    const c = J.chargeDe(scene, force);
    assert.ok(c >= -1 && c <= 1, `${scene} ${force} → ${c}`);
  }
  assert.equal(J.chargeDe('brume', 0), 0, 'sans force, aucune charge');
  // Une scène inconnue ne doit pas rendre NaN : le tracé disparaîtrait en silence.
  assert.equal(J.chargeDe('scene-qui-n-existe-pas', 3), 0);
});

/* ============ LES THÉMATIQUES ============ */

test('un mot lâché une fois n’est pas un thème de la journée', () => {
  const t = J.thematiquesDuJour(JOUR, OWNER);
  // « nuit blanche » n'apparaît qu'une fois : sous le seuil, il ne sort pas.
  assert.equal(t.some(x => x.theme === 'dormir'), false);
});

test('un sujet qui revient sort, avec son compte et une preuve', () => {
  const D = '2026-04-02';
  const dit = (h, text) => addMessage({ ts: `${D}T${String(h).padStart(2, '0')}:00:00.000Z`,
                                        date: D, source: 'web', role: 'user', text, userId: OWNER });
  dit(9, "j'ai repris les anxiolytiques ce matin.");
  dit(14, "le psychiatre a changé la posologie.");
  dit(20, "j'ai oublié le cachet du soir.");
  const t = J.thematiquesDuJour(D, OWNER);
  assert.ok(t.length >= 1);
  assert.equal(t[0].theme, 'soin');
  assert.ok(t[0].n >= 2);
  assert.ok(t[0].extrait.length > 0, 'un thème sans preuve est une étiquette');
});

/* ============ CE QUI A BOUGÉ ============ */

test('un seul relevé n’est pas une amplitude', () => {
  const v = J.volatiliteDuJour(JOUR, OWNER, { zone: 'UTC' });
  assert.equal(v.ecart, null, 'un point n’est pas un écart');
  assert.ok(Array.isArray(v.charges));
});

test('la journée rendue au navigateur a ses trois parties', () => {
  const j = J.journee(JOUR, OWNER, { zone: 'UTC' });
  assert.deepEqual(Object.keys(j).sort(), ['moments', 'thematiques', 'volatilite']);
  for (const m of j.moments) {
    assert.deepEqual(Object.keys(m).sort(),
                     ['charge', 'coeur', 'force', 'heure', 'messages', 'note', 'scene', 'sens', 'ts']);
  }
});

test('l’heure est celle du lecteur, pas celle du serveur', () => {
  // Minuit UTC est 01:00 à Paris : lu en UTC, un moment du soir bascule au
  // lendemain matin et la journée se raconte à l'envers.
  assert.equal(J.heureDe('2026-03-12T23:30:00Z', 'UTC'), '23:30');
  assert.equal(J.heureDe('2026-03-12T23:30:00Z', 'Europe/Paris'), '00:30');
});
