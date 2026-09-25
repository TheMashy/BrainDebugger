/**
 * L'AGENDA DE BRAINDEBUGGER — « les repères divisés en psy et normal ; ce qui
 * est normal sera visible sur l'agenda de Machi Tool », et Jarvis le tient.
 *
 * Tenu ici :
 *   - un repère « agenda » a une heure, peut être dans l'avenir, et ne nourrit
 *     rien de ce qui lit la vie de la personne (allEvents rend les « psy ») ;
 *   - Jarvis et Machi Tool ne voient QUE l'agenda, jamais un repère « psy » ;
 *   - Jarvis pose et lit l'agenda ICI, sans aller-retour avec le PC ;
 *   - la fenêtre de Machi Tool ne s'offre que si Machi Tool la connaît.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-agenda-')), 'test.db');
process.env.ANTHROPIC_API_KEY = '';
const D = await import('../server/db.js');
const { routes } = await import('../server/api.js');
const A = await import('../server/agenda.js');
const J = await import('../server/jarvis.js');
const { OWNER, allEvents, addEvent } = D;

test('psy ou agenda : les deux dans la liste, les « psy » seulement pour ce qui lit la vie', () => {
  addEvent({ date: '2024-05-10', label: 'déménagement', userId: OWNER });
  const r = routes['POST /api/events']({ body: { date: '2026-10-01', label: 'dentiste', genre: 'agenda', heure: '14:30' }, userId: OWNER });
  const dentiste = r.events.find(e => e.label === 'dentiste');
  assert.equal(dentiste.genre, 'agenda');
  assert.equal(dentiste.heure, '14:30');
  assert.ok(r.events.some(e => e.label === 'déménagement' && e.genre === 'psy'), 'la liste montre les deux');
  assert.deepEqual(allEvents(OWNER).map(e => e.label), ['déménagement'], 'par défaut : les « psy » seulement');
  // modifier sans redire le genre ne le change pas
  const r2 = routes['POST /api/events']({ body: { id: dentiste.id, date: '2026-10-02', label: 'dentiste (décalé)' }, userId: OWNER });
  const apres = r2.events.find(e => e.id === dentiste.id);
  assert.equal(apres.genre, 'agenda');
  assert.equal(apres.heure, '14:30');
  assert.match(routes['POST /api/events']({ body: { date: '2026-10-01', label: 'x', genre: 'autre' }, userId: OWNER }).error, /Genre/);
  assert.match(routes['POST /api/events']({ body: { date: '2026-10-01', label: 'x', genre: 'agenda', heure: '25:00' }, userId: OWNER }).error, /Heure/);
});

test('poser et lire l’agenda : dates, heures, périodes, jamais un « psy »', () => {
  const r = A.poserRendezVous({ titre: '  Réunion   projet ', date: '2026-10-05', heure: '09:00' }, OWNER);
  assert.equal(r.texte, 'Ajouté à l’agenda : « Réunion projet », lundi 5 octobre à 09:00.'.replace('l’agenda', "l'agenda"));
  A.poserRendezVous({ titre: 'Vacances', date: '2026-10-03', fin: '2026-10-08' }, OWNER);
  addEvent({ date: '2026-10-05', label: 'rupture', genre: 'psy', userId: OWNER });
  for (const mauvais of [{ titre: '', date: '2026-10-05' }, { titre: 'x', date: 'jeudi' }, { titre: 'x', date: '2026-02-30' },
                         { titre: 'x', date: '2026-10-05', heure: '9h' }, { titre: 'x', date: '2026-10-05', fin: '2026-10-01' }]) {
    assert.throws(() => A.poserRendezVous(mauvais, OWNER), undefined, JSON.stringify(mauvais));
  }
  const a = A.lireAgenda({ depuis: '2026-10-05', jours: 1 }, OWNER);
  assert.deepEqual(a.rendezVous.map(x => x.label), ['Vacances', 'Réunion projet'],
    'la période qui traverse le jour, puis le rendez-vous à son heure ; jamais la « rupture »');
  const texte = A.agendaEnTexte(A.lireAgenda({ depuis: '2026-10-01', jours: 7 }, OWNER));
  assert.match(texte, /lundi 5 octobre à 09:00 : Réunion projet/);
  assert.doesNotMatch(texte, /rupture|déménagement/);
  assert.match(A.agendaEnTexte(A.lireAgenda({ depuis: '2030-01-01', jours: 1 }, OWNER)), /^Rien à l'agenda le mardi 1 janvier/);
});

test('Jarvis pose dans l’agenda ICI, et n’offre la fenêtre que si Machi Tool la connaît', async () => {
  const usage = { input_tokens: 10, output_tokens: 5 };
  const reponses = [
    { content: [{ type: 'tool_use', id: 'a1', name: 'agenda_poser', input: { titre: 'Kiné', date: '2026-10-07', heure: '18:00' } }],
      stop_reason: 'tool_use', model: 'claude-sonnet-5', usage },
    { content: [{ type: 'text', text: 'C’est noté pour mercredi.' }], stop_reason: 'end_turn', model: 'claude-sonnet-5', usage },
    { content: [{ type: 'text', text: 'Oui.' }], stop_reason: 'end_turn', model: 'claude-sonnet-5', usage },
    { content: [{ type: 'text', text: 'Oui.' }], stop_reason: 'end_turn', model: 'claude-sonnet-5', usage }];
  const appels = [];
  const client = { messages: { create: async req => { appels.push(JSON.parse(JSON.stringify(req))); return reponses.shift(); } } };
  const poses = [];
  const dep = { client: async () => client, versLeCompagnon: async () => '',
                agenda: { poser: e => (poses.push(e), A.poserRendezVous(e, OWNER).texte), lire: () => 'rien' } };
  const r = await J.repondreJarvis({ texte: 'mets-moi kiné mercredi à 18 h' }, dep);
  assert.equal(r.texte, 'C’est noté pour mercredi.');
  assert.equal(r.outils, undefined, 'rien ne part au PC');
  assert.equal(poses.length, 1);
  assert.match(appels[1].messages.at(-1).content[0].content, /Ajouté à l'agenda : « Kiné », mercredi 7 octobre à 18:00/);
  assert.ok(A.lireAgenda({ depuis: '2026-10-07', jours: 1 }, OWNER).rendezVous.some(x => x.label === 'Kiné'));
  await J.repondreJarvis({ texte: 'montre mon agenda', outils: true }, dep);
  assert.ok(!appels.at(-1).tools.some(t => t.name === 'montrer_agenda'));
  await J.repondreJarvis({ texte: 'montre mon agenda', outils: true, fenetreAgenda: true }, dep);
  assert.ok(appels.at(-1).tools.some(t => t.name === 'montrer_agenda'));
  assert.ok(appels.at(-1).tools.some(t => t.name === 'agenda_lire'));
});

test('le bilan des derniers jours : des chiffres (note, nuit), jamais le texte du journal', () => {
  D.setNote('2026-09-23', 7, OWNER);
  D.setNote('2026-09-25', 4.5, OWNER);
  const b = A.bilanDesJours(OWNER, '2026-09-25', 3);
  assert.deepEqual(b.jours.map(j => j.date), ['2026-09-23', '2026-09-24', '2026-09-25']);
  assert.deepEqual(b.jours.map(j => j.note), [7, null, 4.5]);
  for (const j of b.jours) {
    assert.deepEqual(Object.keys(j).sort(), ['coucher', 'date', 'lever', 'note', 'sommeil_h']);
  }
  assert.ok('sommeil_mediane' in b);
  assert.equal(A.bilanDesJours(OWNER, '2026-09-25', 999).jours.length, 31, 'borné');
});
