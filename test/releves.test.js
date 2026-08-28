/**
 * Les relevés d'humeur, et l'invariant qui les tient à distance de la note.
 *
 * La note d'une journée est saisie à la main, une fois, par la personne : quatre
 * ans de notes ne valent quelque chose que si c'est le même jugement qui les a
 * posées. Un relevé est autre chose — où quelqu'un SEMBLE être à un instant,
 * dit par le compagnon. Ce fichier vérifie que les deux ne peuvent pas se
 * rejoindre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-rel-')), 'test.db');

const { addReleve, relevesDuJour, amplitude, amplitudes, addMessage, setNote, getEntry, rebuildEntryText }
  = await import('../server/db.js');

const J = '2026-08-28';
let h = 0;
const poser = (v, quoi = 'à ce qu’il vient de dire', date = J) => addReleve({
  messageId: addMessage({ ts: new Date(Date.UTC(2026, 7, 28, 20, ++h)).toISOString(), date, role: 'user', text: 'x' }),
  date, valeur: v, quoi
});

test('un seul relevé n’est pas une amplitude', () => {
  // Le publier comme « ta journée a bougé de 0 » serait faux dans les deux sens.
  poser(7);
  assert.equal(amplitude(J), null);
});

test('deux relevés donnent un écart, jamais une moyenne', () => {
  poser(2);
  const a = amplitude(J);
  assert.deepEqual({ n: a.n, bas: a.bas, haut: a.haut, ecart: a.ecart }, { n: 2, bas: 2, haut: 7, ecart: 5 });
  // Une moyenne ressemblerait à une note, se lirait comme une note, et finirait
  // comparée à la vraie.
  assert.equal(a.moyenne, undefined);
  assert.equal(a.note, undefined);
});

test('la valeur est bornée à l’échelle, comme une note le serait', () => {
  poser(99); poser(-4);
  const v = relevesDuJour(J).map(r => r.valeur);
  assert.ok(v.every(x => x >= 0 && x <= 10), `hors échelle : ${v}`);
});

test('UN RELEVÉ N’ÉCRIT JAMAIS DANS LA JOURNÉE', () => {
  /*
   * L'invariant, et il se teste sur une journée qui existe DÉJÀ : c'est le
   * message qui crée l'entrée, pas le relevé, et confondre les deux ferait
   * passer ce test pour la mauvaise raison.
   *
   * Ce qu'on vérifie : après deux relevés au plus bas et au plus haut de
   * l'échelle, la note reste celle que la personne a posée et le texte reste
   * ce qu'elle a écrit. La comparabilité de toute la série en dépend.
   */
  const jour = '2026-09-16';
  addReleve({ messageId: addMessage({ ts: '2026-09-16T20:00:00Z', date: jour, role: 'user', text: 'ma soirée' }),
              date: jour, valeur: 5, quoi: 'un premier relevé' });
  setNote(jour, 6);

  const avant = { ...getEntry(jour) };
  addReleve({ messageId: 1, date: jour, valeur: 0, quoi: 'au plus bas' });
  addReleve({ messageId: 1, date: jour, valeur: 10, quoi: 'au plus haut' });

  assert.equal(amplitude(jour).ecart, 10, 'le décor du test n’a pas produit d’amplitude');
  assert.deepEqual({ ...getEntry(jour) }, avant, 'un relevé a modifié la journée');
  assert.equal(getEntry(jour).note, 6, 'la note de la journée a bougé');
  assert.equal(rebuildEntryText(jour), 'ma soirée', 'le texte de la journée a bougé');

  // Et un relevé seul ne fait pas naître de journée là où il n'y en a pas.
  const vide = '2026-09-15';
  addReleve({ messageId: 1, date: vide, valeur: 9, quoi: 'très haut' });
  addReleve({ messageId: 1, date: vide, valeur: 1, quoi: 'puis très bas' });
  assert.ok(amplitude(vide), 'le décor du test n’a pas produit d’amplitude');
  assert.equal(getEntry(vide), null, 'un relevé a créé une journée');
});

test('les amplitudes ne remontent que les journées à plusieurs relevés', () => {
  const seul = '2026-10-01';
  poser(5, 'un seul relevé', seul);
  const liste = amplitudes();
  assert.ok(!liste.some(a => a.date === seul), 'une journée à un relevé est remontée');
  assert.ok(liste.every(a => a.n >= 2 && a.ecart === a.haut - a.bas));
  // Triées par date : le corpus du modèle doit lire une chronologie.
  const dates = liste.map(a => a.date);
  assert.deepEqual(dates, [...dates].sort());
});
