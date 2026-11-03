/*
 * RAPPORTER UNE CONVERSATION : LE MODÈLE LIT, LE SERVEUR PLACE.
 *
 * Ce qui doit tenir : une date écrite se reporte sur les messages qui la
 * suivent, « Hier » se résout sur le jour de référence, l'heure est celle de
 * la personne (pas l'UTC), un message de 1 h 56 revient à la soirée de la
 * veille quand le jour vécu le dit, rien n'est écrit sans `apply`, et
 * réimporter le même fichier ne double rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-import-conv-')), 'test.db');
const IC = await import('../server/import-conversation.js');
const { OWNER, messagesForDate, setSettings, getEntry } = await import('../server/db.js');
const { dansLaZone, heureLocale, jourLocal } = await import('../server/temps.js');

const discord = {
  plateforme: 'Discord', titre: '#général',
  participants: [{ nom: 'mashy' }, { nom: 'Léa' }, { nom: 'MEE6', est_un_modele: true }],
  messages: [
    { auteur: 'Léa', date: '2026-10-30', heure: '21:04', texte: 'tu viens samedi ?' },
    { auteur: 'mashy', heure: '21:06', texte: 'je sais pas, je suis crevé' },
    { auteur: 'mashy', texte: 'peut-être dimanche' },
    { auteur: 'Léa', jour_relatif: -1, heure: '23:50', texte: 'alors ?' },
    { auteur: 'mashy', jour_relatif: 0, heure: '01:56', texte: 'désolé, je dormais' },
    { auteur: 'personne', texte: '' },
    { auteur: 'MEE6', heure: '9:7', texte: 'niveau 3 !' }
  ]
};

test('la transcription est vérifiée : formes, noms, vides jetés', () => {
  const t = IC.validerTranscription(discord);
  assert.equal(t.messages.length, 6, 'le message vide est jeté');
  assert.equal(t.messages[1].date, null, 'la date n’est pas recopiée par le modèle, c’est le serveur qui la reporte');
  assert.equal(t.messages.at(-1).heure, null, '« 9:7 » n’est pas une heure');
  assert.deepEqual(t.participants.map(p => [p.nom, p.n]), [['mashy', 3], ['Léa', 2], ['MEE6', 1]]);
});

test('qui est la personne : « Vous » d’abord, puis le pseudo, jamais un modèle', () => {
  assert.equal(IC.devinerMoi([{ nom: 'Claude', est_un_modele: true, n: 9 }, { nom: 'Vous', n: 3 }]), 'Vous');
  assert.equal(IC.devinerMoi([{ nom: 'Léa', n: 9 }, { nom: 'mashy', n: 3 }], { pseudo: 'Mashy' }), 'mashy');
  assert.equal(IC.devinerMoi([{ nom: 'Claude', est_un_modele: true, n: 9 }, { nom: 'A', n: 1 }]), 'A');
});

test('dates reportées, « hier » résolu, heure locale, ordre gardé', () => dansLaZone('Europe/Paris', () => {
  const t = IC.validerTranscription(discord);
  const p = IC.placerMessages(t, { moi: 'mashy', reference: '2026-11-01', zone: 'Europe/Paris' });
  assert.deepEqual(p.map(m => m.date), ['2026-10-30', '2026-10-30', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-01']);
  assert.equal(heureLocale(p[0].ts, 'Europe/Paris'), '21:04', 'l’heure écrite est une heure de Paris');
  assert.equal(p[0].ts, '2026-10-30T20:04:00.000Z', 'heure d’hiver : UTC+1');
  assert.equal(heureLocale(p[2].ts, 'Europe/Paris'), '21:07', 'sans heure : une minute après le précédent');
  for (let i = 1; i < p.length; i++) assert.ok(p[i].ts > p[i - 1].ts, `ordre du document, ${i}`);
  assert.deepEqual(p.map(m => m.role), ['pet', 'user', 'user', 'pet', 'user', 'pet']);
  assert.equal(p[0].via, 'Discord · Léa');
  assert.equal(p[1].via, 'Discord');
  assert.equal(p[2].heureConnue, false);
}));

test('la journée est la journée VÉCUE : 1 h 56 revient à la veille si la coupure le dit', () => {
  const t = IC.validerTranscription(discord);
  // Une coupure à 6 h, comme `jourVecu` la donnerait avec un lever connu.
  const jourDe = ts => {
    const h = heureLocale(ts, 'Europe/Paris'), d = jourLocal(ts, 'Europe/Paris');
    if (h >= '06:00') return d;
    const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1);
    return x.toISOString().slice(0, 10);
  };
  const p = IC.placerMessages(t, { moi: 'mashy', reference: '2026-11-01', zone: 'Europe/Paris', jourDe });
  assert.equal(p[4].date, '2026-10-31', '« désolé, je dormais » à 01:56 appartient à la soirée d’avant');
});

test('un fil sans aucune date prend le jour de référence', () => {
  const t = IC.validerTranscription({ plateforme: 'Claude', participants: [{ nom: 'Vous' }, { nom: 'Claude', est_un_modele: true }],
    messages: [{ auteur: 'Vous', texte: 'salut' }, { auteur: 'Claude', texte: 'bonjour' }] });
  const p = IC.placerMessages(t, { moi: 'Vous', reference: '2026-10-12', zone: 'UTC' });
  assert.deepEqual(p.map(m => m.date), ['2026-10-12', '2026-10-12']);
  assert.ok(p[1].ts > p[0].ts);
  assert.equal(p[0].dateConnue, false);
});

/* ============ LA ROUTE, CONTRE UN FAUX SERVEUR ============ */

let sdk = true;
try { await import('@anthropic-ai/sdk'); } catch { sdk = false; }

test('la route : lit une fois, montre, n’écrit qu’avec apply, et ne double pas', { skip: !sdk && 'SDK absent' }, async () => {
  const vues = [];
  const serveur = createServer(async (req, res) => {
    const bouts = [];
    for await (const c of req) bouts.push(c);
    const corps = JSON.parse(Buffer.concat(bouts).toString() || '{}');
    vues.push(corps);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const env = (t, d) => res.write(`event: ${t}\ndata: ${JSON.stringify(d)}\n\n`);
    env('message_start', { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant',
      model: corps.model, content: [], stop_reason: null, usage: { input_tokens: 900, output_tokens: 0 } } });
    env('content_block_start', { type: 'content_block_start', index: 0,
      content_block: { type: 'tool_use', id: 't1', name: 'transcrire_conversation', input: {} } });
    env('content_block_delta', { type: 'content_block_delta', index: 0,
      delta: { type: 'input_json_delta', partial_json: JSON.stringify(discord) } });
    env('content_block_stop', { type: 'content_block_stop', index: 0 });
    env('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 300 } });
    env('message_stop', { type: 'message_stop' });
    res.end();
  });
  const port = 7000 + Math.floor(Math.random() * 900);
  await new Promise(r => serveur.listen(port, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
  try {
    setSettings({ apiKey: 'sk-test', anthropicModel: 'claude-opus-5-5' }, OWNER);
    const { routes } = await import('../server/api.js');
    const route = routes['POST /api/import-conversation'];
    const pdf = Buffer.from('%PDF-1.4 faux').toString('base64');

    const a = (await dansLaZone('Europe/Paris', () => route({ body: { pdf, reference: '2026-11-01' }, userId: OWNER }))).apercu;
    assert.equal(vues.length, 1);
    const doc = vues[0].messages[0].content[0];
    assert.equal(doc.type, 'document');
    assert.equal(doc.source.media_type, 'application/pdf');
    assert.equal(doc.source.data, pdf);
    assert.equal(a.moi, 'mashy', 'le participant humain qui parle le plus');
    assert.equal(a.total, 6);
    assert.equal(messagesForDate('2026-10-30', OWNER).length, 0, 'rien n’est écrit à l’aperçu');

    // Corriger qui est qui ne relit pas le document.
    const b = (await dansLaZone('Europe/Paris', () => route({ body: { jeton: a.jeton, moi: 'Léa', reference: '2026-11-01' }, userId: OWNER }))).apercu;
    assert.equal(vues.length, 1, 'pas de seconde lecture');
    assert.equal(b.moi, 'Léa');

    const r = await dansLaZone('Europe/Paris', () => route({ body: { jeton: a.jeton, moi: 'mashy', reference: '2026-11-01', apply: true }, userId: OWNER }));
    assert.equal(r.poses, 6);
    const jour = messagesForDate('2026-10-30', OWNER);
    assert.deepEqual(jour.map(m => [m.role, m.text]), [
      ['pet', 'tu viens samedi ?'], ['user', 'je sais pas, je suis crevé'], ['user', 'peut-être dimanche']]);
    assert.equal(jour[0].via, 'Discord · Léa');
    assert.match(getEntry('2026-10-30', OWNER)?.text ?? '', /crevé/, 'ses phrases comptent dans sa journée');
    assert.doesNotMatch(getEntry('2026-10-30', OWNER)?.text ?? '', /samedi/, 'celles des autres, non');

    // Le même fichier une seconde fois : tout est déjà là.
    const c = (await dansLaZone('Europe/Paris', () => route({ body: { pdf, reference: '2026-11-01' }, userId: OWNER }))).apercu;
    assert.equal(c.doublons, 6);
    const r2 = await dansLaZone('Europe/Paris', () => route({ body: { jeton: c.jeton, moi: 'mashy', reference: '2026-11-01', apply: true }, userId: OWNER }));
    assert.equal(r2.poses, 0);
    assert.equal(messagesForDate('2026-10-30', OWNER).length, 3);

    const expire = await route({ body: { jeton: a.jeton, apply: true }, userId: OWNER });
    assert.match(expire.error, /expiré/);
  } finally {
    serveur.close();
  }
});

/* ============ UN JOURNAL, PAS UNE CONVERSATION ============
 * Un résumé « jour par jour » : des sections datées, une plage de jours, et
 * des parties qui parlent de toute la période. Contenu inventé, même forme. */

const resume = {
  genre: 'journal', plateforme: 'résumé', titre: 'Du 5 au 9 mars 2026', annee: 2026,
  participants: [{ nom: 'moi' }],
  messages: [
    { auteur: 'moi', date: '2026-03-05', texte: 'Journée lente. « je suis fatigué ».' },
    { auteur: 'moi', date: '2026-03-06', texte: 'Séance avec la psy.\n\nNotes de séance : pourquoi je remets la faute sur moi ?' },
    { auteur: 'moi', date: '2026-03-07', date_fin: '2026-03-08', texte: 'Pas de notes.' },
    { auteur: 'Claude', date: '2026-03-09', heure: '08:15', texte: 'Matin : café, puis le travail.' },
    { auteur: 'moi', texte: 'L’essentiel : beaucoup de fatigue sur la période.' }
  ],
  hors_jours: [{ titre: 'Ce que j’ai compris', texte: 'Le cadre m’aide.' }]
};

test('journal : une journée par message, à 21 h, à elle ; le hors-jours va au carnet', () => dansLaZone('Europe/Paris', () => {
  const t = IC.validerTranscription(resume);
  assert.equal(t.genre, 'journal');
  assert.deepEqual(t.participants.map(p => p.nom), ['moi'], 'un journal n’a qu’une voix');
  assert.equal(t.messages.length, 4);
  assert.equal(t.horsJours.length, 2, 'la section sans date rejoint les parties hors jours');
  const moi = IC.devinerMoi(t.participants);
  assert.equal(moi, 'moi');
  const p = IC.placerMessages(t, { moi, reference: '2026-11-03', zone: 'Europe/Paris' });
  assert.deepEqual(p.map(m => m.date), ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-09']);
  assert.ok(p.every(m => m.role === 'user'));
  assert.equal(heureLocale(p[0].ts, 'Europe/Paris'), '21:00', 'un journal sans heure est écrit le soir');
  assert.equal(heureLocale(p[1].ts, 'Europe/Paris'), '21:00', 'chaque NOUVEAU jour repart de son heure, pas de la minute d’après');
  assert.equal(heureLocale(p[3].ts, 'Europe/Paris'), '08:15', 'une heure écrite est gardée');
  assert.match(p[2].text, /^\(du 2026-03-07 au 2026-03-08\)/, 'une plage dit qu’elle en est une');
  const notes = IC.notesHorsJours(t, p);
  assert.equal(notes.length, 2);
  assert.equal(notes[0].quand, 'du 2026-03-05 au 2026-03-09');
  assert.match(notes[0].texte, /^Ce que j’ai compris\n\nLe cadre/);
}));

test('conversation : l’heure ne passe pas d’un jour au suivant', () => {
  const t = IC.validerTranscription({ plateforme: 'Discord', participants: [{ nom: 'a' }, { nom: 'b' }], messages: [
    { auteur: 'a', date: '2026-01-01', heure: '23:10', texte: 'un' },
    { auteur: 'b', date: '2026-01-02', texte: 'deux' }] });
  const p = IC.placerMessages(t, { moi: 'a', reference: '2026-01-05', zone: 'UTC' });
  assert.equal(p[1].ts, '2026-01-02T12:00:00.000Z', 'le 2 sans heure : midi, pas 23:10');
});

test('journal écrit : messages au fil, synthèses au carnet, et rien en double au second passage', () => dansLaZone('Europe/Paris', () => {
  const t = IC.validerTranscription(resume);
  const p = IC.marquerDoublons(IC.placerMessages(t, { moi: 'moi', reference: '2026-11-03', zone: 'Europe/Paris' }), OWNER);
  const notes = IC.notesHorsJours(t, p);
  const r = IC.ecrireMessages(p, OWNER, notes);
  assert.equal(r.poses, 4);
  assert.equal(r.rangees, 2);
  assert.match(getEntry('2026-03-06', OWNER)?.text ?? '', /faute sur moi/);
  assert.doesNotMatch(getEntry('2026-03-09', OWNER)?.text ?? '', /essentiel/, 'la synthèse n’est la journée de personne');
  const p2 = IC.marquerDoublons(IC.placerMessages(t, { moi: 'moi', reference: '2026-11-03', zone: 'Europe/Paris' }), OWNER);
  const r2 = IC.ecrireMessages(p2, OWNER, IC.notesHorsJours(t, p2));
  assert.deepEqual([r2.poses, r2.rangees], [0, 0]);
}));
