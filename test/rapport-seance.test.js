/**
 * LE RAPPORT DEPUIS LA DERNIÈRE SÉANCE.
 *
 * Demandé : un relevé « depuis le dernier rdv psy », jour par jour, avec les
 * phrases de la personne entre guillemets, et en PDF. Ce fichier tient ce qui
 * rend ce document sûr à tendre à un soignant :
 *   - il part du BON rendez-vous (le psy du 10, pas le psychiatre du 14, quand
 *     c'est le psy qu'on va voir) ;
 *   - le modèle choisit, il n'écrit pas : il rend des numéros, et un numéro
 *     inconnu est jeté ;
 *   - ce qui parle de mourir ou de prendre quelque chose entre d'office ;
 *   - le PDF est un vrai PDF, en français, qui ne coupe pas les guillemets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-rapport-')), 'test.db');
process.env.ANTHROPIC_API_KEY = '';
const db = await import('../server/db.js');
const R = await import('../server/rapport-seance.js');
const api = await import('../server/api.js');
const { documentPdf, versWinAnsi, couper, largeur } = await import('../web/pdf.js');
const W = await import('../web/rapport-seance.js');

const U = db.OWNER;
const ecrire = (date, h, text) => db.addMessage({ ts: `${date}T${h}:00.000Z`, date, role: 'user', text, userId: U });

/* ------------------------------ le départ ------------------------------ */

test('un rendez-vous RACONTÉ compte, un rendez-vous redouté non', () => {
  const r = R.rendezVousDansLeJournal([
    { role: 'user', date: '2026-09-10', text: "je suis content je suis allé au psy aujourd'hui" },
    { role: 'user', date: '2026-09-14', text: "aujourd'hui j'ai parlé de mes déréalisations à mon psychiatre" },
    { role: 'user', date: '2026-09-20', text: "j'ai vraiment peur de sortir voir le psy" },
    { role: 'user', date: '2026-09-21', text: 'je vais aller chez le psy demain' },
    { role: 'user', date: '2026-09-21', text: "j'ai rdv chez le psy demain, j'ai peur" },
    { role: 'pet',  date: '2026-09-22', text: 'Tu es allé chez le psy ?' },
  ]);
  assert.deepEqual(r.map(x => [x.date, x.praticien]), [['2026-09-14', 'psychiatre'], ['2026-09-10', 'psy']]);
});

test('on part du dernier rendez-vous DU MÊME GENRE que celui d’aujourd’hui', () => {
  ecrire('2026-09-10', '13:10', "je suis content je suis allé au psy aujourd'hui, ça m'a fait du bien");
  ecrire('2026-09-14', '08:15', "aujourd'hui j'ai parlé de mes déréalisations à mon psychiatre");
  ecrire('2026-09-24', '05:15', "j'ai vraiment peur de sortir voir le psy");
  const d = R.debutDuRapport(U, '2026-09-24');
  assert.equal(d.debut, '2026-09-10', 'le psychiatre du 14 n’est pas le rendez-vous qu’on prépare');
  assert.equal(d.source, 'journal');
  assert.equal(d.trouves.length, 2, 'les deux restent proposés');
});

test('une séance enregistrée passe devant le journal', () => {
  const s = db.addSeance({ date: '2026-09-16', praticien: 'psy', userId: U });
  assert.equal(R.debutDuRapport(U, '2026-09-24').debut, '2026-09-16');
  db.deleteSeance(s.id, U);
});

test('sans rien, deux semaines', () => {
  assert.equal(R.debutDuRapport('personne', '2026-09-24').debut, '2026-09-10');
});

/* ------------------------------ la matière ------------------------------ */

test('les moments de la journée viennent de l’heure', () => {
  assert.deepEqual(['02:00', '09:00', '14:00', '17:30', '21:00'].map(R.periodeDe),
    ['tard dans la nuit', 'le matin', "l'après-midi", 'en fin d’après-midi', 'le soir']);
});

test('« ok » ne se cite pas ; ce qui est grave, même court, si', () => {
  const l = R.unites([
    { role: 'user', date: 'd', ts: 't1', text: 'ok' },
    { role: 'user', date: 'd', ts: 't2', text: 'yep' },
    { role: 'user', date: 'd', ts: 't3', text: 'je suis confiant !' },
    { role: 'user', date: 'd', ts: 't4', text: 'envie de mourir' },
    { role: 'user', date: 'd', ts: 't5', text: '[capture.png]' },
  ], { heure: () => '12:00' });
  assert.deepEqual(l.map(u => u.texte), ['je suis confiant !', 'envie de mourir']);
  assert.equal(l[1].grave, true);
});

test('un long message se découpe en phrases', () => {
  const long = 'Première phrase assez longue pour compter. '.repeat(10);
  assert.ok(R.unites([{ role: 'user', date: 'd', ts: 't', text: long }], { heure: () => '12:00' }).length >= 5);
});

test('ce qui parle de mourir ou de prendre quelque chose ENTRE, même non choisi', () => {
  const liste = R.unites([
    { role: 'user', date: '2026-09-22', ts: '2026-09-22T18:10:00Z', text: "j'ai envie de prendre plein d'anxios" },
    { role: 'user', date: '2026-09-22', ts: '2026-09-22T18:40:00Z', text: "c'est un peu passé là ouais" },
    { role: 'user', date: '2026-09-23', ts: '2026-09-23T14:20:00Z', text: "j'aimerais m'endormir pour toujours, et me dissoudre lentement" },
  ], { heure: ts => ts.slice(11, 16) });
  const jours = R.assembler({ debut: '2026-09-22', fin: '2026-09-23', liste, choisis: [1] });
  const cites = jours.flatMap(j => j.moments.flatMap(m => m.citations.map(c => c.texte)));
  assert.ok(cites.includes("j'ai envie de prendre plein d'anxios"));
  assert.ok(cites.includes("j'aimerais m'endormir pour toujours, et me dissoudre lentement"));
  assert.ok(cites.includes("c'est un peu passé là ouais"));
});

test('le choix automatique ignore ce qu’on demande à l’application', () => {
  const liste = R.unites([
    { role: 'user', date: 'd', ts: 't1', text: 'tu peux me rappeler comment on change la couleur du fond ?' },
    { role: 'user', date: 'd', ts: 't2', text: "j'ai mangé en gare, c'est pas souvent" },
  ], { heure: () => '12:00' });
  const ids = R.choixParDefaut(liste);
  assert.deepEqual(ids.map(i => liste.find(u => u.id === i).texte), ["j'ai mangé en gare, c'est pas souvent"]);
});

test('les moments se regroupent, les repères se posent sur leur jour', () => {
  const liste = R.unites([
    { role: 'user', date: '2026-09-21', ts: '2026-09-21T11:00:00Z', text: "j'ai eu un appel pour du travail en octobre" },
    { role: 'user', date: '2026-09-21', ts: '2026-09-21T18:10:00Z', text: "j'ai envie de prendre plein d'anxios" },
    { role: 'user', date: '2026-09-21', ts: '2026-09-21T18:40:00Z', text: "c'est un peu passé là ouais" },
  ], { heure: ts => String(Number(ts.slice(11, 13)) + 2).padStart(2, '0') + ':00' });
  const [j] = R.assembler({ debut: '2026-09-21', fin: '2026-09-21', liste, choisis: [0, 1, 2],
                            reperes: [{ date: '2026-09-21', label: "début de l'aripiprazole" }, { date: '2026-08-01', label: 'hors période' }] });
  assert.deepEqual(j.moments.map(m => [m.periode, m.citations.length]), [["l'après-midi", 1], ['le soir', 2]]);
  assert.deepEqual(j.reperes, ["début de l'aripiprazole"]);
});

/* ------------------------------ le modèle ------------------------------ */

test('le modèle rend des numéros ; un numéro inventé est jeté', async () => {
  const liste = R.unites([
    { role: 'user', date: 'd', ts: 't1', text: 'je suis confiant aujourd’hui' },
    { role: 'user', date: 'd', ts: 't2', text: 'je me sens mal ce soir' },
  ], { heure: () => '12:00' });
  let requete;
  const client = { messages: { create: async r => { requete = r; return {
    model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 },
    content: [{ type: 'tool_use', name: 'choisir', input: { numeros: [1, 1, 99, -3, 0] } }] }; } } };
  const r = await api.choisirAvecLeModele(liste, { anthropicModel: 'claude-opus-5-5' }, client);
  assert.deepEqual(r.numeros.sort(), [0, 1]);
  assert.deepEqual(requete.tool_choice, { type: 'auto' }, 'Opus 5.5 refuse un outil imposé');
  assert.match(requete.messages[0].content, /^Réponds en appelant l’outil « choisir »/);
  assert.match(requete.messages[0].content, /\[1\] \(le soir|\[1\] \(l'après-midi|\[1\] \(le matin|\[1\] \(/);
  assert.match(requete.system, /tu rends seulement des numéros/);
});

test('sans outil rendu, on le dit — et le choix automatique prend le relais', async () => {
  const client = { messages: { create: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Voici…' }] }) } };
  await assert.rejects(api.choisirAvecLeModele([{ id: 0 }], {}, client), /pas rendu de choix/);
});

test('la route rend le relevé, en choix automatique sans modèle', async () => {
  const r = await api.routes['GET /api/rapport-seance']({ query: { depuis: '2026-09-10' }, userId: U });
  assert.equal(r.debut, '2026-09-10');
  assert.equal(r.choix, 'automatique');
  assert.ok(r.jours.some(j => j.date === '2026-09-10'));
  assert.equal((await api.routes['GET /api/rapport-seance']({ query: { depuis: '2999-01-01' }, userId: U })).error,
               'la date de départ est dans le futur');
});

/* ------------------------------ le PDF ------------------------------ */

test('le français passe, ce qui ne s’écrit pas disparaît', () => {
  assert.equal(versWinAnsi('« œuvre » l’été — ça… 🙂'), '« œuvre » l’été — ça… ');
});

test('aucune ligne ne dépasse la page', () => {
  const lignes = couper([{ t: 'mot '.repeat(80) + 'anticonstitutionnellementtrèslongsansespace'.repeat(3), f: 'T', s: 11.5 }], 300);
  for (const l of lignes) assert.ok(l.reduce((s, m) => s + m.w, 0) <= 300.01);
});

test('un vrai PDF : en-tête, xref juste, plusieurs pages numérotées', () => {
  const para = Array.from({ length: 80 }, (_, i) => ({ avant: 6, morceaux: [{ t: `Ligne ${i} — « été »`, f: 'T', s: 12 }] }));
  const o = documentPdf({ titre: 'Essai', pied: 'Relevé', paragraphes: para });
  const txt = Buffer.from(o).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.trimEnd().endsWith('%%EOF'));
  const pages = Number(txt.match(/\/Count (\d+)/)[1]);
  assert.ok(pages >= 2, `${pages} page`);
  assert.match(txt, new RegExp(`page ${pages}/${pages}`));
  // Chaque entrée de la table xref pointe bien sur « n 0 obj ».
  const xref = Number(txt.match(/startxref\n(\d+)/)[1]);
  const entrees = txt.slice(xref).match(/(\d{10}) 00000 n/g).map(e => Number(e.slice(0, 10)));
  entrees.forEach((pos, i) => assert.ok(txt.startsWith(`${i + 1} 0 obj`, pos), `objet ${i + 1}`));
  // « été » en WinAnsi : é = 0xE9 = \351.
  assert.match(txt, /\\351t\\351/);
});

test('la mise en page suit la structure demandée, sans ce qu’on a retiré', () => {
  const r = { debut: '2026-09-10', fin: '2026-09-24', choix: 'modele', lues: 30, jours: [
    { date: '2026-09-11', note: 7, reperes: [], moments: [{ periode: 'le matin', citations: [{ id: 1, texte: 'je suis confiant !' }] }] },
    { date: '2026-09-21', note: null, reperes: ["début de l'aripiprazole"], moments: [
      { periode: "l'après-midi", citations: [{ id: 2, texte: "j'ai eu un appel" }] },
      { periode: 'le soir', citations: [{ id: 3, texte: "j'ai envie de prendre plein d'anxios" }, { id: 4, texte: "c'est un peu passé" }] }] },
    { date: '2026-09-22', note: null, reperes: [], moments: [{ periode: 'le soir', citations: [{ id: 5, texte: 'à retirer' }] }] },
    { date: '2026-09-24', note: null, reperes: [], moments: [{ periode: 'le matin', citations: [{ id: 6, texte: "j'ai vraiment peur" }] }] },
  ] };
  const P = W.paragraphesDuRapport(r, new Set([5]));
  const lignes = P.map(p => p.morceaux.map(m => m.t).join(''));
  const tout = lignes.join('\n');
  assert.match(lignes[0], /^Depuis ma dernière séance$/);
  assert.match(tout, /Vendredi 11 septembre/);
  assert.match(tout, /note du jour : 7\/10/);
  assert.match(tout, /^« je suis confiant ! »\.$/m, 'un seul moment : pas d’étiquette');
  assert.match(tout, /^Le soir : « j'ai envie de prendre plein d'anxios », « c'est un peu passé »\.$/m);
  assert.match(tout, /Repère posé : début de l'aripiprazole/);
  assert.match(tout, /Aujourd'hui, jeudi 24 septembre/);
  assert.doesNotMatch(tout, /à retirer/);
  assert.doesNotMatch(tout, /Mardi 22 septembre/, 'un jour vidé par les retraits disparaît');
});
