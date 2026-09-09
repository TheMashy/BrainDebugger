/*
 * « LES MESURES DE COUCHERS ET LEVERS SONT TOUJOURS FAUSSES. »
 *
 * Signalé sur une capture du 8 septembre : l'écran disait « levé 00:19, couché
 * 16:27, 3,7 h » sur une journée où la personne s'était couchée vers 11:30 et
 * levée à 18:00. Les trois nombres étaient faux ensemble, et rien ne le disait.
 *
 * Reproduit à la minute près, puis compris : chez quelqu'un de nocturne encore
 * éveillé à minuit, le fichier civil du jour s'ouvre à 00:19 — et Machi Tool
 * appariait ce bord de fichier comme un « réveil ». Le site le reprenait tel
 * quel, puis rattrapait la durée sur le même appariement, puis le coucher sur
 * celui du lendemain.
 *
 * LA RÈGLE QUI MANQUAIT NE PARLE PAS D'HEURE. Aucun seuil d'horloge n'aurait
 * raison chez tout le monde — c'est justement ce que ce fichier refuse depuis
 * le début. Elle demande qu'un SILENCE précède le lever : une dernière touche à
 * 23:59 et un « réveil » à 00:19, c'est vingt minutes, personne n'a dormi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-noct-')), 'test.db');

const { upsertUser, poserActiviteJour } = await import('../server/db.js');
const { nuitDuJour, paireEstUneNuit } = await import('../server/nuits.js');
const { posteDuJour } = await import('../server/api.js');

const U = 'nocturne';
upsertUser({ id: U, username: U });

/* La journée telle que le site l'a reçue : le PC a été éteint pendant le
   sommeil, donc aucun trou n'est remonté — seul l'appariement de Machi Tool. */
poserActiviteJour(U, '2026-09-07', {
  date: '2026-09-07', plage: { de: '00:05', a: '23:59' }, trous: [] });
poserActiviteJour(U, '2026-09-08', {
  date: '2026-09-08', plage: { de: '00:19', a: '23:59' }, trous: [],
  temps_par_contexte_s: { 'web:youtube': 9000, code: 7800 },
  poste: { coucher: '20:37', reveil: '00:19', sommeil_h: 3.7, source: 'poste' } });
poserActiviteJour(U, '2026-09-09', {
  date: '2026-09-09', plage: { de: '00:00', a: '06:48' }, trous: [],
  poste: { coucher: '16:27', reveil: '18:00', sommeil_h: 1.5, source: 'poste' } });

test('le bord du fichier civil n’est pas un lever, même à 00:19', () => {
  const p = posteDuJour('2026-09-08', U);
  assert.equal(p.lever.heure, null,
    '« levé 00:19 » : la dernière touche de la veille est à 23:59, vingt minutes avant');
  assert.equal(p.sommeil_h, null,
    'la durée venait du même appariement — elle revenait par la fenêtre sous un lever vide');
  assert.equal(p.coucher.heure, null,
    '« couché 16:27 » venait de l’appariement du lendemain : une heure trente-trois, pas une nuit');
  assert.equal(p.dormi_de, null);
  assert.ok(p.ecran, 'la journée reste affichée : ce qui est mesuré l’est toujours');
});

test('« je ne sais pas » vaut mieux que trois nombres faux', () => {
  const p = posteDuJour('2026-09-08', U);
  assert.equal(p.lever.source, null,
    'aucune source ne se dit « mesure » pour une heure que rien ne mesure');
});

test('avec la journée complète, la vraie nuit revient — et elle est juste', () => {
  const V = 'nocturne-complet';
  upsertUser({ id: V, username: V });
  poserActiviteJour(V, '2026-09-07', {
    date: '2026-09-07', plage: { de: '00:05', a: '23:59' }, trous: [] });
  poserActiviteJour(V, '2026-09-08', {
    date: '2026-09-08', plage: { de: '00:19', a: '23:59' },
    temps_par_contexte_s: { code: 7800 },
    // Le PC rallumé à 18:00 laisse enfin son trou : c'est ça, la vraie nuit.
    trous: [{ de: '11:30', a: '18:00' }] });
  const p = posteDuJour('2026-09-08', V);
  assert.equal(p.lever.heure, '18:00');
  assert.equal(p.lever.source, 'mesure');
  assert.equal(p.sommeil_h, 6.5);
  assert.equal(p.dormi_de, '11:30');
});

test('un silence de deux heures suffit : la règle n’interdit pas les nuits courtes', () => {
  const fins = [{ t: -60, src: 'activite' }];        // 23:00 la veille
  const debuts = [{ t: 90, src: 'activite' }];       // 01:30
  const n = nuitDuJour({ date: '2026-09-08', plage: { de: '01:30', a: '23:59' },
                         poste: { coucher: '23:00', reveil: '01:30', sommeil_h: 2.5 } },
                       { date: '2026-09-07', plage: { de: '08:00', a: '23:00' } });
  assert.equal(n.lever, '01:30', 'deux heures et demie de silence : c’est une nuit');
  assert.ok(fins.length && debuts.length);
});

test('sans rien de connu avant, on ne refuse pas — on ne sait pas', () => {
  const n = nuitDuJour({ date: '2026-09-05',
                         poste: { coucher: '00:23', reveil: '05:41', sommeil_h: 5.3 } }, null);
  assert.equal(n.lever, '05:41',
    'refuser ici effacerait la nuit de quiconque n’a pas encore de digest de la veille');
});

test('une paire qui n’a pas la durée d’une nuit n’est pas une nuit', () => {
  assert.equal(paireEstUneNuit({ coucher: '16:27', reveil: '18:00' }), false, '1 h 33');
  assert.equal(paireEstUneNuit({ coucher: '23:00', reveil: '07:00' }), true, '8 h');
  assert.equal(paireEstUneNuit({ coucher: '05:26', reveil: '16:15' }), true,
    '10 h 49 chez quelqu’un de nocturne : l’heure ne juge de rien, la durée si');
  assert.equal(paireEstUneNuit({ coucher: '08:00', reveil: '06:00' }), false, '22 h');
  assert.equal(paireEstUneNuit({ coucher: '23:00' }), false, 'un coucher sans réveil');
  assert.equal(paireEstUneNuit(null), false);
});
