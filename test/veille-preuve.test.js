/*
 * LA VEILLE : SA PREUVE, ET CE QUI N'EST PAS LA JOURNÉE.
 *
 * Un signe se croit parce qu'on peut lire la phrase qui l'a déclenché. Ce
 * fichier tient trois choses : l'extrait contient le mot déclencheur, même au
 * fond d'une dictée sans ponctuation ; il montre de préférence un passage qui
 * affirme plutôt qu'un démenti ; et un texte qui n'est pas la journée de la
 * personne — rangé au carnet, ou courrier entre soignants — est lu, mais
 * jamais plus haut qu'un jaune « évoqué ».
 *
 * Toutes les phrases sont inventées.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-veille-preuve-')), 'test.db');
const { niveauDuTexte, veilleDuJour, auPasse, DIT } = await import('../server/veille.js');
const { passagesDuJour } = await import('../server/juge-veille.js');
const { addMessage, messagesForDate, rangerMessage, OWNER } = await import('../server/db.js');
const { joursSurveilles } = await import('../server/fonctionnements.js');
const { GENRES_PRESENT } = await import('../server/rendez-vous.js');

/* ============================ la preuve ============================ */

test('LA PREUVE CONTIENT LE MOT, même à 700 signes dans une dictée sans point', () => {
  const remplissage = n => 'et puis on a parlé du boulot du train des courses de la semaine '.repeat(20).slice(0, n);
  const texte = remplissage(700) + ' envie de mourir ' + remplissage(300);
  assert.ok(texte.length >= 1000);
  const r = niveauDuTexte(texte);
  assert.equal(r.niveau, 'jaune');
  assert.match(r.extrait, /envie de mourir/);
  assert.ok(r.extrait.length <= 200, `extrait de ${r.extrait.length} signes`);
  assert.ok(texte.includes(r.extrait), 'l’extrait est un morceau du texte, tel qu’écrit');
});

test('une phrase courte reste entière', () => {
  assert.equal(niveauDuTexte('De quoi le suicide est mauvais ?').extrait, 'De quoi le suicide est mauvais ?');
});

test('UNE PREUVE QUI AFFIRME plutôt qu’un démenti, dans un même texte', () => {
  const r = niveauDuTexte('non, je ne veux pas me tuer. Parfois je voudrais dormir pour toujours.');
  assert.equal(r.niveau, 'jaune');
  const s = r.motifs.find(m => m.genre === 'suicide');
  assert.match(s.extrait, /dormir pour toujours/);
});

test('… et d’un message à l’autre dans la journée', () => {
  const v = veilleDuJour('2026-09-05', 'x', { messages: [
    { role: 'user', text: 'non, je ne veux pas me tuer' },
    { role: 'user', text: 'encore cette sensation de vouloir mourir' }
  ] });
  assert.equal(v.niveau, 'jaune');
  assert.match(v.motifs.find(m => m.genre === 'suicide').extrait, /vouloir mourir/);
});

test('la négation seule reste un jaune, avec sa phrase', () => {
  const r = niveauDuTexte('non, je ne veux pas me tuer');
  assert.equal(r.niveau, 'jaune');
  assert.match(r.extrait, /me tuer/);
});

/* ==================== ce qui n'est pas la journée ==================== */

test('UN MESSAGE RANGÉ AU CARNET est lu, mais au plus un jaune « évoqué »', () => {
  const v = veilleDuJour('2026-09-05', 'x', { messages: [
    { role: 'user', rangee: 1, text: 'Cher confrère, je vous adresse ce patient avec antécédent de scarification à l’adolescence.' }
  ] });
  assert.ok(v, 'un texte rangé n’est jamais tu');
  assert.equal(v.niveau, 'jaune');
  assert.deepEqual(v.motifs.map(m => m.genre), ['evoque_passe']);
});

test('un rangé fort (une blessure d’aujourd’hui) descend quand même en jaune', () => {
  const v = veilleDuJour('2026-09-05', 'x', { messages: [
    { role: 'user', rangee: 1, text: 'je me suis scarifiée ce matin' }
  ] });
  assert.equal(v.niveau, 'jaune');
  assert.equal(v.motifs[0].genre, 'evoque_passe');
});

test('UN RANGÉ NE FAIT PAS LE CONTEXTE DU JOUR : il ne fait pas basculer une coupure en rouge', () => {
  const msgs = [
    { role: 'user', rangee: 1, text: 'patient suivi pour crises répétées' },
    { role: 'user', text: 'je me suis coupé en cuisinant' }
  ];
  const v = veilleDuJour('2026-09-05', 'x', { messages: msgs });
  assert.notEqual(v?.niveau, 'rouge');
  // Le même texte, NON rangé, est bien un contexte de crise : c'est le rangement qui compte.
  const sans = veilleDuJour('2026-09-05', 'x', { messages: msgs.map(m => ({ ...m, rangee: 0 })) });
  assert.equal(sans?.niveau, 'rouge');
});

test('UN COURRIER ENTRE SOIGNANTS, collé sans être rangé : au plus un jaune « évoqué », jamais tu', () => {
  const r = niveauDuTexte('Chère consœur, je vous adresse cette patiente. Scarification ce matin selon ses dires. Bien confraternellement.');
  assert.equal(r.niveau, 'jaune');
  assert.deepEqual(r.motifs.map(m => m.genre), ['evoque_passe']);
});

test('« la patiente » ne fait pas un courrier', () => {
  const r = niveauDuTexte("je suis la patiente du Dr Martin, j'ai envie de mourir");
  assert.equal(r.niveau, 'jaune');
  assert.equal(r.motifs[0].genre, 'suicide');
});

test('auPasse ne crée rien là où il n’y a rien', () => {
  assert.deepEqual(auPasse({ niveau: null, motifs: [] }), { niveau: null, motifs: [] });
});

test('les passages jugés un par un suivent la même règle (juge-veille)', () => {
  const msgs = [
    { id: 1, role: 'user', rangee: 1, text: 'patient suivi pour crises répétées, scarification ce matin' },
    { id: 2, role: 'user', text: 'je me suis coupé en cuisinant' }
  ];
  const p = passagesDuJour('2026-09-05', msgs, niveauDuTexte);
  assert.equal(p.length, 1, 'la coupure de cuisine ne monte pas sur le contexte du rangé');
  assert.equal(p[0].messageId, 1);
  assert.deepEqual(p[0].motifs.map(m => [m.genre, m.niveau]), [['evoque_passe', 'jaune']]);
});

test('messagesForDate dit si un message est rangé', () => {
  const d = '2026-04-02';
  const id = addMessage({ ts: `${d}T20:00:00Z`, date: d, role: 'user', text: 'un texte à ranger' });
  addMessage({ ts: `${d}T21:00:00Z`, date: d, role: 'user', text: 'un texte du jour' });
  assert.ok(!rangerMessage(id, { jour: d }).erreur);
  const ms = messagesForDate(d, OWNER);
  assert.deepEqual(ms.map(m => m.rangee), [1, 0]);
});

/* ==================== le nouveau genre, partout ==================== */

test('L’ENVIE DE SE FAIRE DU MAL a sa phrase, et elle est connue partout', () => {
  assert.match(DIT.envie_mal, /envie de se faire du mal/);
  assert.ok(GENRES_PRESENT.includes('envie_mal'), 'le document de rendez-vous l’imprime');
});

test('« en main » et l’envie de se faire du mal sont des jours à surveiller', () => {
  const dateDe = t => new Date(Date.UTC(2026, 0, 5 + t)).toISOString().slice(0, 10);
  const jours = Array.from({ length: 30 }, (_, t) => ({ date: dateDe(t), note: 6, dow: t % 7, we: t % 7 >= 5 ? 1 : 0 }));
  const veille = d => d === dateDe(3) ? { niveau: 'rouge', motifs: [{ genre: 'en_main' }] }
                    : d === dateDe(9) ? { niveau: 'jaune', motifs: [{ genre: 'envie_mal' }] }
                    : d === dateDe(20) ? { niveau: 'jaune', motifs: [{ genre: 'evoque_passe' }] } : null;
  const r = joursSurveilles({ de: dateDe(0), a: dateDe(29), variables: ['note'], jours }, 'u',
    { veille, messages: () => [], niveau: () => ({ niveau: null }) });
  assert.deepEqual(r.jours.map(j => j.date), [dateDe(3), dateDe(9)], 'un souvenir raconté n’en est toujours pas un');
});
