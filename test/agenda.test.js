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
  // « Assure-toi que rajouter à l'agenda rajoute un élément à l'agenda » : il y
  // est, et Machi Tool le sait (sa fenêtre Agenda se relit)
  assert.equal(r.agenda_modifie, true);
  assert.match(appels[0].tools.find(t => t.name === 'agenda_poser').description, /ne dis JAMAIS que c'est noté sans l'avoir appelé/);
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

test('un rendez-vous refusé ne passe pas pour posé', async () => {
  const usage = { input_tokens: 10, output_tokens: 5 };
  const reponses = [
    { content: [{ type: 'tool_use', id: 'a1', name: 'agenda_poser', input: { titre: 'Kiné', date: 'mercredi' } }],
      stop_reason: 'tool_use', model: 'claude-sonnet-5', usage },
    { content: [{ type: 'text', text: 'La date m’a échappé.' }], stop_reason: 'end_turn', model: 'claude-sonnet-5', usage }];
  const appels = [];
  const client = { messages: { create: async req => { appels.push(JSON.parse(JSON.stringify(req))); return reponses.shift(); } } };
  const dep = { client: async () => client, versLeCompagnon: async () => '',
                agenda: { poser: e => A.poserRendezVous(e, OWNER).texte, lire: () => 'rien' } };
  const r = await J.repondreJarvis({ texte: 'mets-moi kiné mercredi' }, dep);
  assert.equal(r.agenda_modifie, undefined);
  const resultat = appels[1].messages.at(-1).content[0];
  assert.equal(resultat.is_error, true, 'l’erreur revient au modèle, qui la dit');
});

test('synchro avec Machi Tool : retirer et corriger un rendez-vous, jamais un repère « psy »', () => {
  // « Fais en sorte que l'agenda soit synchro sur BrainDebugger »
  const { evenement } = A.poserRendezVous({ titre: 'Kiné-témoin', date: '2027-03-04', heure: '18:00' }, OWNER);
  const psy = addEvent({ date: '2027-03-04', label: 'un fait-témoin', genre: 'psy', userId: OWNER });
  const lire = () => A.lireAgenda({ depuis: '2027-03-01', jours: 10 }, OWNER).rendezVous;
  assert.ok(lire()[0].id, 'chaque rendez-vous porte son identifiant');
  assert.match(A.modifierRendezVous(evenement.id, { heure: '18:30', date: '2027-03-05' }, OWNER).texte,
               /Kiné-témoin.*vendredi 5 mars à 18:30/);
  assert.deepEqual(lire().map(r => [r.label, r.date, r.heure]), [['Kiné-témoin', '2027-03-05', '18:30']]);
  assert.throws(() => A.modifierRendezVous(evenement.id, { heure: '9h' }, OWNER), /Heure/);
  assert.throws(() => A.retirerRendezVous(psy.id, OWNER), /introuvable/, 'un « psy » ne se retire pas d’ici');
  assert.throws(() => A.retirerRendezVous(evenement.id, 'quelqu-un-d-autre'), /introuvable/);
  assert.match(A.retirerRendezVous(evenement.id, OWNER).texte, /Retiré de l'agenda : « Kiné-témoin »/);
  assert.deepEqual(lire(), []);
  assert.ok(allEvents(OWNER).some(e => e.id === psy.id), 'le « psy » est toujours là');
});

test('un repère dans le futur se pose, et se lit dans l’agenda', () => {
  // « Fais aussi en sorte qu'il soit possible d'ajouter des repères pour le futur »
  const r = routes['POST /api/events']({ body: { date: '2031-06-01', label: 'mariage-témoin', genre: 'agenda' }, userId: OWNER });
  assert.ok(r.events.some(e => e.label === 'mariage-témoin' && e.date === '2031-06-01'));
  assert.deepEqual(A.lireAgenda({ depuis: '2031-06-01', jours: 1 }, OWNER).rendezVous.map(x => x.label), ['mariage-témoin']);
});

test('Jarvis corrige et retire un rendez-vous, par son numéro -- jamais un repère « psy »', async () => {
  // « Jarvis doit pouvoir modifier ou supprimer des rendez-vous »
  const dentiste = A.poserRendezVous({ titre: 'Dentiste-témoin', date: '2027-05-04', heure: '10:15' }, OWNER).evenement;
  const reunion = A.poserRendezVous({ titre: 'Réunion-témoin', date: '2027-05-04', heure: '14:30' }, OWNER).evenement;
  const psy = addEvent({ date: '2027-05-04', label: 'un fait-témoin', genre: 'psy', userId: OWNER });
  // la lecture donne les numéros : c'est par eux qu'il touche
  const lu = A.agendaEnTexte(A.lireAgenda({ depuis: '2027-05-04', jours: 1 }, OWNER));
  assert.match(lu, new RegExp(`#${dentiste.id} .*Dentiste-témoin`));
  assert.match(lu, new RegExp(`#${reunion.id} .*Réunion-témoin`));
  const usage = { input_tokens: 10, output_tokens: 5 };
  const reponses = [
    { content: [{ type: 'tool_use', id: 'm1', name: 'agenda_modifier', input: { id: dentiste.id, heure: '15:00' } },
                { type: 'tool_use', id: 's1', name: 'agenda_supprimer', input: { id: reunion.id } },
                { type: 'tool_use', id: 's2', name: 'agenda_supprimer', input: { id: psy.id } }],
      stop_reason: 'tool_use', model: 'claude-sonnet-5', usage },
    { content: [{ type: 'text', text: 'Dentiste à 15 h, réunion annulée.' }], stop_reason: 'end_turn', model: 'claude-sonnet-5', usage }];
  const appels = [];
  const client = { messages: { create: async req => { appels.push(JSON.parse(JSON.stringify(req))); return reponses.shift(); } } };
  // le meme branchement que server/index.js
  const dep = { client: async () => client, versLeCompagnon: async () => '',
                agenda: { poser: () => '', lire: () => lu,
                          modifier: e => A.modifierRendezVous(e.id, Object.fromEntries(['titre', 'date', 'heure', 'fin']
                            .filter(k => e[k] !== undefined).map(k => [k, e[k]])), OWNER).texte,
                          supprimer: e => A.retirerRendezVous(e.id, OWNER).texte } };
  const r = await J.repondreJarvis({ texte: 'décale le dentiste à 15 h et annule la réunion' }, dep);
  assert.equal(r.texte, 'Dentiste à 15 h, réunion annulée.');
  assert.equal(r.outils, undefined, 'rien ne part au PC : c’est la base de BrainDebugger');
  assert.equal(r.agenda_modifie, true, 'Machi Tool relit son agenda (et son panneau)');
  const resultats = appels[1].messages.at(-1).content;
  assert.match(resultats.find(x => x.tool_use_id === 'm1').content, /Modifié : « Dentiste-témoin », .* à 15:00/);
  assert.match(resultats.find(x => x.tool_use_id === 's1').content, /Retiré de l'agenda : « Réunion-témoin »/);
  assert.equal(resultats.find(x => x.tool_use_id === 's2').is_error, true, 'un repère « psy » : introuvable pour lui');
  const apres = A.lireAgenda({ depuis: '2027-05-04', jours: 1 }, OWNER).rendezVous;
  assert.deepEqual(apres.map(x => [x.label, x.heure]), [['Dentiste-témoin', '15:00']]);
  assert.ok(allEvents(OWNER).some(e => e.id === psy.id), 'le repère « psy » est intact');
  for (const nom of ['agenda_modifier', 'agenda_supprimer']) {
    assert.match(appels[0].tools.find(t => t.name === nom).description, /agenda_lire/);
  }
});

test('retirer un rendez-vous en trois tours (lire, relire, retirer) : le retrait n’est pas perdu', async () => {
  // « Jarvis ne peut toujours pas retirer de choses dans l'agenda » : les outils
  // internes ne tournaient que deux tours ; le troisième (le retrait) était jeté
  const kine = A.poserRendezVous({ titre: 'Kiné-trois-tours', date: '2027-06-08', heure: '18:00' }, OWNER).evenement;
  const usage = { input_tokens: 10, output_tokens: 5 };
  const outil = (id, name, input) => ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use',
                                       model: 'claude-sonnet-5', usage });
  const reponses = [
    outil('l1', 'agenda_lire', { depuis: '2027-06-07', jours: 1 }),
    outil('l2', 'agenda_lire', { depuis: '2027-06-08', jours: 1 }),
    outil('s1', 'agenda_supprimer', { id: kine.id }),
    { content: [{ type: 'text', text: 'Le kiné est annulé.' }], stop_reason: 'end_turn', model: 'claude-sonnet-5', usage }];
  const client = { messages: { create: async () => reponses.shift() } };
  const lire = e => A.agendaEnTexte(A.lireAgenda({ depuis: e.depuis, jours: e.jours }, OWNER));
  const dep = { client: async () => client, versLeCompagnon: async () => '',
                agenda: { poser: () => '', lire, modifier: () => '', supprimer: e => A.retirerRendezVous(e.id, OWNER).texte } };
  const r = await J.repondreJarvis({ texte: 'annule le kiné de mardi' }, dep);
  assert.equal(r.texte, 'Le kiné est annulé.');
  assert.equal(r.agenda_modifie, true);
  assert.ok(!A.lireAgenda({ depuis: '2027-06-08', jours: 1 }, OWNER).rendezVous.some(x => x.id === kine.id),
            'il est vraiment retiré');
});
