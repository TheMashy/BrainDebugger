/*
 * RANGER TOUT LE JOURNAL SUR LES JOURNÉES VÉCUES.
 *
 * Une journée ne commence pas à minuit. Ce qui est vérifié ici : une soirée
 * écrite après minuit rejoint la journée qu'elle terminait, sur TOUT le
 * journal (pas seulement la fenêtre récente), en lisant les nuits dans les
 * digests déjà stockés — et l'opération est idempotente : la relancer ne
 * déplace plus rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-rang-')), 'test.db');
const { addMessage, messagesForDate, poserActiviteJour, joursEcrits, OWNER } = await import('../server/db.js');
const api = await import('../server/api.js');

const jour = n => new Date(Date.UTC(2026, 3, 1 + n)).toISOString().slice(0, 10);
const ecrire = (date, h, m, texte) =>
  addMessage({ ts: `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`,
               date, role: 'user', text: texte });

// Dix jours : couché vers 03:30 (clavier), levé vers 11:00. Le digest porte
// plage/trous — ce que Machi Tool envoie depuis toujours.
for (let n = 0; n < 10; n++) {
  poserActiviteJour(OWNER, jour(n), {
    date: jour(n), plage: { de: '11:00', a: '23:50' },
    trous: [{ de: '03:30', a: '11:00', minutes: 450 }],
    temps_par_contexte_s: { code: 3600 }
  });
  ecrire(jour(n), 21, 10, `soirée du ${jour(n)}`);
  ecrire(jour(n), 1, 40, `nuit qui prolonge le ${jour(n - 1)}`);   // écrit à 01:40, appartient à la veille
}
api.invalidate(OWNER);

test('les nuits relues dans les digests donnent une coupure à chaque jour', () => {
  const { bornes, med } = api.bornesDuJournal(OWNER);
  assert.ok(bornes.size >= 8, `bornes trouvées : ${bornes.size}`);
  assert.ok(med > 0 && med < 720, `médiane ${med}`);
  assert.equal(bornes.get(jour(5)), 3 * 60 + 30, 'le coucher de 03:30 borne la journée');
});

test('une soirée écrite après minuit rejoint la journée qu’elle terminait', () => {
  const avant = messagesForDate(jour(5), OWNER).length;
  const r = api.rangerToutLeJournal(OWNER);
  assert.ok(r.messages >= 8, `messages déplacés : ${r.messages}`);
  assert.ok(r.jours >= 8, `jours touchés : ${r.jours}`);
  const apres = messagesForDate(jour(5), OWNER);
  assert.equal(apres.length, avant, 'un parti, un reçu : la journée en garde deux');
  assert.ok(apres.some(m => m.text.startsWith('soirée du ' + jour(5))));
  assert.ok(apres.some(m => m.text.startsWith(`nuit qui prolonge le ${jour(5)}`)),
            'la nuit du 6 (01:40) est rangée sur le 5');
});

test('relancer ne déplace plus rien — l’opération est idempotente', () => {
  const r = api.rangerToutLeJournal(OWNER);
  assert.equal(r.messages, 0, `deuxième passe : ${r.messages} messages déplacés`);
});

test('sans aucune borne, on ne déplace rien : la journée civile est un repli honnête', () => {
  const vierge = 'sans-bornes';
  addMessage({ ts: '2026-02-02T02:10:00Z', date: '2026-02-02', role: 'user', text: 'nuit', userId: vierge });
  api.invalidate(vierge);
  const r = api.rangerToutLeJournal(vierge);
  assert.equal(r.messages, 0);
  assert.ok(r.sans_coupure >= 1, 'le jour est compté comme sans coupure, pas déplacé au hasard');
  assert.equal(messagesForDate('2026-02-02', vierge).length, 1);
});

test('tous les jours écrits sont passés en revue, pas seulement la fenêtre récente', () => {
  assert.ok(joursEcrits(OWNER).length >= 10);
});
