/**
 * LA COURBE DE LA JOURNÉE : CE QU'ELLE A LE DROIT DE DIRE.
 *
 * Sur un vrai journal, l'estimation « ≈ x/10 » lue dans les mots ne suivait pas
 * les notes de la personne (pas mieux qu'un chiffre constant), ramenait ses
 * « 1/10 » à 5 ou 6, et avait posé un moment de crise à ≈8,5. Ses propres
 * chiffres, eux, étaient perdus pour leur moment : relus après coup, ils
 * portaient l'heure de la relecture.
 *
 * Ce fichier tient les réparations ensemble : les notes dites retrouvent leur
 * heure et passent en premier ; les mots ne donnent un chiffre qu'une fois
 * leur lien avec les notes vérifié, et jamais sur un moment que la veille a
 * marqué ; un message rangé au carnet ne peint plus la journée ; et quelques
 * tournures courantes ne portent plus des icônes qui ne sont pas les leurs.
 *
 * Toutes les phrases sont inventées.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-courbe-')), 'test.db');

const { upsertUser, addMessage, setNote, relevesDuJour, addReleve, rangerMessage, redaterMessages, allEntries, db } =
  await import('../server/db.js');
const { buildSeries } = await import('../server/stats.js');
const { scoresDe, readMoodFil } = await import('../server/mood.js');
const J = await import('../server/journee.js');
const { relireLesNotesDites, reparerLesNotesDites, poserCeQuIlDit, ambiance, today } =
  await import('../server/api.js');
const { themeDe } = await import('../web/reperes.js');
const { DU_COMPAGNON } = await import('../web/ressenti.js');

let n = 0;
const personne = () => { const id = `courbe-${++n}`; upsertUser({ id, username: id }); return id; };
const jour = i => new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10);
const dire = (u, date, hm, text) => addMessage({ ts: `${date}T${hm}:00.000Z`, date, source: 'web', role: 'user', text, userId: u });

const BAS = [
  'je me sens triste et seul ce soir, vide, envie de pleurer',
  'journée sombre, je suis triste et las, le cœur lourd',
  'encore cette tristesse, je me sens seul et abandonné',
  'rien ne va, je suis vide et sans aucune envie ce soir'
];
const HAUT = [
  'journée calme et tranquille, je suis content et apaisé',
  'je me sens serein et soulagé, une journée paisible',
  'ce soir je suis heureux et apaisé, tout est calme',
  'content de ma journée, tranquille et reposé'
];

/** Un journal où les mots suivent la note : la lecture a prouvé quelque chose. */
function journalCorrele(u) {
  for (let i = 0; i < 26; i++) {
    const haut = i % 2 === 0;
    const note = haut ? [7, 8, 9][i % 3] : [2, 3, 4][i % 3];
    setNote(jour(i), note, u);
    dire(u, jour(i), '20:00', (haut ? HAUT : BAS)[i % 4]);
  }
}

/* ============ LES NOTES DITES RETROUVENT LEUR HEURE ============ */

test('une note écrite hier, relue aujourd’hui, reprend l’heure de son message', () => {
  const u = personne();
  const hier = '2026-06-09';
  const id = dire(u, hier, '21:14', 'là je suis à 2/10');
  assert.equal(relireLesNotesDites(u), 1);
  const [r] = relevesDuJour(hier, u);
  const msg = db.prepare('SELECT ts FROM messages WHERE id = ?').get(id);
  assert.equal(r.ts, msg.ts, 'le relevé porte l’heure de la relecture, pas celle du message');
  const [mo] = J.momentsDuJour(hier, u, { zone: 'UTC', reference: 6 });
  assert.deepEqual(mo.estime, { valeur: 2, dApres: 'releve' });
});

test('deux relevés dans un moment : le dernier est rendu, et les deux sont tracés', () => {
  const u = personne();
  const d = '2026-06-10';
  dire(u, d, '21:00', 'je suis à 3/10 ce soir');
  dire(u, d, '21:01', 'en fait je suis à 2/10');
  assert.equal(relireLesNotesDites(u), 2);
  const [mo] = J.momentsDuJour(d, u, { zone: 'UTC', reference: 6 });
  assert.deepEqual(mo.estime, { valeur: 2, dApres: 'releve' },
    'la personne s’est reprise : le premier chiffre cachait le second');
  const v = J.volatiliteDuJour(d, u, { zone: 'UTC', reference: 6 });
  assert.deepEqual(v.humeurs.map(h => [h.valeur, h.dApres]), [[3, 'releve'], [2, 'releve']],
    'on ne cache jamais la valeur la plus basse');
});

test('la réparation remet les notes dites à leur heure, et elles seules', () => {
  const u = personne();
  // Une note dite relue par l'ancien code : datée de « maintenant ».
  const hier = '2026-06-11';
  const id = dire(u, hier, '22:40', 'je dirais 1/10 là');
  addReleve({ messageId: id, date: hier, valeur: 1, quoi: '1/10 là', source: 'toi', userId: u });
  const dite = relevesDuJour(hier, u)[0];
  // `quoi` doit être l'extrait tel que l'extracteur le relit.
  db.prepare('UPDATE releves SET quoi = ? WHERE id = ?').run('je dirais 1/10 là', dite.id);

  // Un relevé posé en touchant l'échelle, trois heures après le message.
  const il_y_a_3h = new Date(Date.now() - 3 * 3600e3).toISOString();
  const autre = addMessage({ ts: il_y_a_3h, date: today(), source: 'web', role: 'user',
                             text: 'grosse fatigue ce soir, je rentre', userId: u });
  const pose = poserCeQuIlDit({ valeur: 4 }, u);
  assert.ok(pose.ok, pose.erreur);
  assert.equal(pose.messageId, autre);
  const avant = db.prepare('SELECT ts, date FROM releves WHERE id = ?').get(pose.releve.id);

  assert.ok(reparerLesNotesDites() >= 1);
  const apres = db.prepare('SELECT ts, date FROM releves WHERE id = ?').get(dite.id);
  assert.equal(apres.ts, `${hier}T22:40:00.000Z`);
  assert.equal(apres.date, hier);
  assert.deepEqual(db.prepare('SELECT ts, date FROM releves WHERE id = ?').get(pose.releve.id), avant,
    'la réparation a réécrit un relevé posé légitimement plus tard');
  assert.equal(reparerLesNotesDites(), 0, 'relancée, elle ne réécrit rien');
});

test('un relevé de l’échelle posé sur un message qui contient une autre note n’est pas déplacé', () => {
  const u = personne();
  const il_y_a_3h = new Date(Date.now() - 3 * 3600e3).toISOString();
  addMessage({ ts: il_y_a_3h, date: today(), source: 'web', role: 'user', text: 'je suis à 3/10', userId: u });
  const pose = poserCeQuIlDit({ valeur: 6 }, u);
  assert.ok(pose.ok, pose.erreur);
  const avant = db.prepare('SELECT ts FROM releves WHERE id = ?').get(pose.releve.id).ts;
  reparerLesNotesDites();
  assert.equal(db.prepare('SELECT ts FROM releves WHERE id = ?').get(pose.releve.id).ts, avant);
});

/* ============ LES MOTS NE DONNENT UN CHIFFRE QUE S'ILS L'ONT MÉRITÉ ============ */

test('sans lien prouvé entre les mots et les notes, aucune estimation par les mots', () => {
  const u = personne();
  // La pente du texte est indépendante de la note : la lecture ne suit rien.
  for (let i = 0; i < 30; i++) {
    setNote(jour(i), i % 2 ? 8 : 3, u);
    dire(u, jour(i), '20:00', (Math.floor(i / 2) % 2 ? HAUT : BAS)[i % 4]);
    if (i % 5 === 0) dire(u, jour(i), '20:05', `je suis à ${[2, 9, 5, 7, 4, 6][i % 6]}/10`);
  }
  relireLesNotesDites(u);
  const c = J.calibrationDesMots(u);
  assert.equal(c.ok, false);
  assert.ok(c.paires >= 20, `${c.paires} paires : le test ne mesure pas ce qu’il croit`);
  for (let i = 0; i < 30; i++) {
    for (const m of J.momentsDuJour(jour(i), u, { zone: 'UTC', reference: 5.5 }))
      assert.notEqual(m.estime?.dApres, 'mots', `${jour(i)} : une estimation par les mots est sortie`);
    for (const s of J.sujetsDuJour(jour(i), u, { zone: 'UTC', reference: 5.5 }))
      assert.equal(s.estime, null);
  }
});

test('trop peu de paires : on ne conclut rien, donc pas de chiffre', () => {
  const u = personne();
  for (let i = 0; i < 5; i++) { setNote(jour(i), 3, u); dire(u, jour(i), '20:00', BAS[i % 4]); }
  const c = J.calibrationDesMots(u);
  assert.equal(c.ok, false);
  assert.equal(J.momentsDuJour(jour(0), u, { zone: 'UTC' })[0].estime, null);
});

test('quand les mots suivent les notes, l’estimation revient', () => {
  const u = personne();
  journalCorrele(u);
  const c = J.calibrationDesMots(u);
  assert.equal(c.ok, true, JSON.stringify(c));
  assert.ok(c.rho >= 0.6 && c.erreur < c.erreurConstante);
  const d = jour(40);
  dire(u, d, '09:00', 'ce matin je suis calme et content, tranquille');
  dire(u, d, '20:00', 'ce soir je suis triste et seul, le cœur lourd');
  const mo = J.momentsDuJour(d, u, { zone: 'UTC', reference: 6 });
  assert.deepEqual(mo.map(m => m.estime?.dApres), ['mots', 'mots']);
  assert.ok(mo[0].estime.valeur > mo[1].estime.valeur);
});

test('la courbe et la liste lisent la même référence', () => {
  const u = personne();
  journalCorrele(u);
  const d = jour(41);
  setNote(d, 9, u);          // la note du soir ne doit rien repeindre
  dire(u, d, '08:00', 'réveil difficile, je me sens seul et triste');
  dire(u, d, '13:00', 'midi plus calme, tranquille');
  dire(u, d, '22:00', 'ce soir je suis content et apaisé');
  const mo = J.momentsDuJour(d, u, { zone: 'UTC', reference: 6 });
  const hum = J.volatiliteDuJour(d, u, { zone: 'UTC', reference: 6 }).humeurs;
  assert.equal(hum.length, mo.length);
  mo.forEach((m, i) => assert.equal(hum[i].valeur, m.estime.valeur, `moment ${i}`));
});

test('un moment que la veille marque ne reçoit pas de chiffre lu dans les mots', () => {
  const u = personne();
  journalCorrele(u);
  const d = jour(42);
  dire(u, d, '10:00', 'ce matin je suis calme et content');
  dire(u, d, '22:00', "ce soir j'ai envie de mourir, tout est noir");
  const mo = J.momentsDuJour(d, u, { zone: 'UTC', reference: 6 });
  assert.equal(mo[0].estime?.dApres, 'mots');
  assert.ok(mo[1].veille, 'la veille n’a rien vu : le test ne teste rien');
  assert.equal(mo[1].estime, null);
  assert.ok(!J.volatiliteDuJour(d, u, { zone: 'UTC', reference: 6 }).humeurs.some(h => h.ts === mo[1].ts));

  // Son propre chiffre, lui, reste : c'est sa parole.
  const d2 = jour(43);
  dire(u, d2, '22:00', "ce soir j'ai envie de mourir, tout est noir");
  dire(u, d2, '22:02', 'je suis à 2/10');
  relireLesNotesDites(u);
  const [m2] = J.momentsDuJour(d2, u, { zone: 'UTC', reference: 6 });
  assert.deepEqual(m2.estime, { valeur: 2, dApres: 'releve' });
});

/* ============ LE LEXIQUE ============ */

test('la pente : l’espoir monte, un rendez-vous ne descend pas, « plus » n’efface rien', () => {
  assert.ok(J.pencheDe('ce matin je me suis réveillé avec envie de mourir') <= -0.5);
  assert.ok(J.pencheDe('beaucoup de joie, de gratitude et d espoir') > 0);
  // Un rendez-vous chez la psy n'est pas une humeur. On compare à la MÊME
  // phrase sans lui : la densité dilue, par construction, une phrase plus longue
  // de quatre mots neutres — ce n'est pas ce qu'on veut mesurer ici.
  // (Sur l'ancien lexique, 0,43 contre 0,88 : le rendez-vous tirait vers le bas.)
  const psy = J.pencheDe('après la séance chez la psy, je rentre à pied, un peu soulagée');
  assert.ok(psy > 0);
  assert.ok(psy >= J.pencheDe('après la séance chez la coiffeuse, je rentre à pied, un peu soulagée') - 0.1);
  assert.ok(J.pencheDe('en rentrant de chez la psy, ça va vraiment bien')
            >= J.pencheDe('en rentrant du ciné, ça va vraiment bien') - 0.1);
  assert.ok(J.pencheDe('de plus en plus triste ce soir') < 0);
  const pasBien = J.pencheDe('je suis pas bien du tout ce soir');
  assert.ok(pasBien == null || pasBien <= 0, `« pas bien » penche à ${pasBien}`);
});

test('scoresDe : une fois chaque bout de texte, et la négation sur le calme seulement', () => {
  assert.equal(scoresDe('ça va pas du tout').scores.brume, undefined);
  assert.equal(scoresDe('je me sens plus angoissé').scores.grain, 3);
  assert.deepEqual(scoresDe('je suis contente').scores, scoresDe('je suis content').scores);
  assert.equal(scoresDe('deux anxios').scores.grain, 3);
  assert.ok(!('aube' in scoresDe('envie de mourir').scores), '« envie de mourir » n’est pas de l’espoir');
  assert.equal(scoresDe('pas envie de ranger le salon ce soir').scores.aube, undefined);
  assert.equal(scoresDe('envie de ranger le salon ce soir').scores.aube, 2, 'sans la négation, le mot compte');
  assert.equal(scoresDe('bien trop fatigué ce soir').scores.brume, undefined);
  assert.equal(scoresDe('je ne suis plus content').scores.brume, undefined);
  assert.equal(scoresDe('mort mort').scores.abyss, 6, 'deux occurrences collées comptent deux fois');
});

/* ============ CE QUI EST RANGÉ NE RACONTE PAS LA JOURNÉE ============ */

test('un message rangé sort des thèmes, des sujets, de la phrase et de l’estimation', () => {
  const u = personne();
  const d = '2026-07-02';
  dire(u, d, '20:00', "ce soir j'ai cuisiné des pâtes avec ma sœur et mon frère, c'était doux");
  const lettre = dire(u, d, '20:05', 'Cher confrère, je vous adresse ce patient suivi par le psychiatre. '
    + 'Traitement par anxiolytiques, ordonnance renouvelée. Posologie inchangée, suivi mensuel.');
  assert.ok(J.thematiquesDuJour(d, u).some(t => t.theme === 'soin'), 'la lettre devait peser avant d’être rangée');
  assert.ok(rangerMessage(lettre, {}, u).note);

  assert.equal(J.thematiquesDuJour(d, u).some(t => t.theme === 'soin'), false);
  for (const s of J.sujetsDuJour(d, u, { zone: 'UTC' })) {
    assert.ok(!(s.ids ?? []).includes(lettre));
    assert.doesNotMatch(s.texte, /confrère/);
  }
  const mo = J.momentsDuJour(d, u, { zone: 'UTC' });
  for (const m of mo) {
    assert.doesNotMatch(m.coeur, /confrère|patient/);
    assert.ok(!m.themes.includes('soin'));
    assert.ok(!m.coeurIds.includes(lettre));
  }
});

test('la veille lit encore le message rangé, mais n’en tire qu’un jaune « passé »', () => {
  const u = personne();
  const d = '2026-07-03';
  const id = dire(u, d, '03:00', "Cher confrère, je vous adresse ce patient avec antécédent de scarification à l'adolescence.");
  rangerMessage(id, {}, u);
  const [mo] = J.momentsDuJour(d, u, { zone: 'UTC' });
  assert.deepEqual(mo.veille, { niveau: 'jaune', genres: ['evoque_passe'] }, 'ni rouge, ni rien');
  assert.equal(mo.estime, null);
  assert.equal(mo.coeur, '');
});

test('un message rangé ne fait pas passer au rouge une coupure de cuisine', () => {
  const u = personne();
  const d = '2026-07-04';
  dire(u, d, '21:00', 'je me suis coupé en cuisinant');
  const id = dire(u, d, '21:03', 'patient suivi pour crises répétées, scarifications multiples aux avant-bras');
  assert.equal(J.momentsDuJour(d, u, { zone: 'UTC' })[0].veille.niveau, 'rouge', 'le cas ne teste rien');
  rangerMessage(id, {}, u);
  const [mo] = J.momentsDuJour(d, u, { zone: 'UTC' });
  assert.equal(mo.veille?.niveau, 'jaune');
});

test('le décor ne se teint pas d’un message rangé', () => {
  const u = personne();
  const d = today();
  const calme = 'journée calme et tranquille, je suis content, apaisé et serein, rien ne presse, '
    + 'je me sens reposé et soulagé après cette longue semaine, tout est doux';
  for (const h of [9, 10, 11]) addMessage({ ts: new Date(Date.now() - (12 - h) * 3600e3).toISOString(), date: d,
                                            source: 'web', role: 'user', text: calme, userId: u });
  const id = addMessage({ ts: new Date().toISOString(), date: d, source: 'web', role: 'user', userId: u,
    text: 'enterrement, deuil, cimetière, cercueil, funérailles, la mort, le décès, le deuil encore, '
      + 'la perte, le cimetière, adieu, plus jamais, irréversible, définitif, le cercueil' });
  const attendu = readMoodFil([calme, calme, calme]).scene;
  assert.notEqual(ambiance(u).scene, attendu, 'le message à ranger ne pesait pas : le test ne teste rien');
  rangerMessage(id, {}, u);
  assert.equal(ambiance(u).scene, attendu);
});

/* ============ LES ICÔNES DES PHRASES DE JOURNAL ============ */

test('des tournures courantes ne portent plus l’avion ni l’icône du deuil', () => {
  assert.notEqual(J.themeDuJournal('je suis en train de cuisiner'), 'voyage');
  assert.notEqual(J.themeDuJournal('ça fait partie du boulot'), 'voyage');
  assert.notEqual(J.themeDuJournal("j'ai perdu beaucoup d'argent au poker"), 'deuil');
  assert.notEqual(J.themeDuJournal('je me sens complètement perdue'), 'deuil');
  assert.notEqual(J.themeDuJournal('je suis perdu depuis ce matin'), 'deuil');
  assert.notEqual(J.themeDuJournal('je me suis perdu dans les rayons du magasin'), 'deuil');
  assert.equal(J.themeDuJournal('mon grand-père est mort'), 'deuil');
  assert.equal(J.themeDuJournal('mon père est mort'), 'deuil');
  // Les libellés de repères ne passent pas par là : rien ne change pour eux.
  assert.equal(themeDe('parti à Londres'), 'voyage');
  assert.equal(J.themeDuJournal('parti à Londres pour les vacances'), 'voyage');
  assert.deepEqual(J.themesDuTexte('je suis en train de réfléchir. ça fait partie de moi.'), []);
});


/* ============ RELECTURE : CE QUE LA PREMIÈRE VERSION LAISSAIT PASSER ============ */

test('un rangé retiré du contexte ne fait jamais tomber un acte de la personne à rien', () => {
  const d = '2026-07-05';
  for (const [range, acte] of [
    ['patient suivi pour crises répétées', 'je me suis coupé ce soir, ça saigne'],
    ["j'ai envie de mourir, je suis en crise", 'je viens de me couper les bras']
  ]) {
    // Sans rangement, la crise écrite juste avant rend l'acte rouge.
    const u0 = personne();
    dire(u0, d, '21:00', range);
    dire(u0, d, '21:02', acte);
    assert.equal(J.momentsDuJour(d, u0, { zone: 'UTC' })[0].veille?.niveau, 'rouge', 'le cas ne teste rien');

    // Rangé, il sort du contexte : l'acte garde une marque, et son genre.
    const u = personne();
    const id = dire(u, d, '21:00', range);
    dire(u, d, '21:02', acte);
    rangerMessage(id, {}, u);
    const [mo] = J.momentsDuJour(d, u, { zone: 'UTC' });
    // jaune au moins -- rouge quand l'acte se suffit à lui-même (le geste et
    // la partie du corps : « je viens de me couper les bras »)
    assert.ok(['jaune', 'rouge'].includes(mo.veille?.niveau), `« ${acte} » : plutôt jaune que rien, pour un acte`);
    assert.ok(mo.veille.genres.includes('blessure'), `genres : ${mo.veille.genres}`);
  }
});

test('un message rangé ne donne qu’un jaune « passé », quel que soit ce qu’il dit', () => {
  const u = personne();
  const d = '2026-07-10';
  const id = dire(u, d, '23:00', "j'ai envie de mourir, je suis en crise");
  assert.equal(J.momentsDuJour(d, u, { zone: 'UTC' })[0].veille?.genres[0], 'suicide', 'le cas ne teste rien');
  rangerMessage(id, {}, u);
  const [mo] = J.momentsDuJour(d, u, { zone: 'UTC' });
  assert.deepEqual(mo.veille, { niveau: 'jaune', genres: ['evoque_passe'] }, 'ni rien, ni plus');
});

test('un jaune « blessure » vu d’abord n’éteint pas le rouge écrit ensuite dans le moment', () => {
  const u = personne();
  const d = '2026-07-09';
  const id = dire(u, d, '21:00', 'patient suivi pour crises répétées');
  dire(u, d, '21:02', 'je me suis coupé en cuisinant');
  dire(u, d, '21:04', 'et puis je me suis scarifié ce soir');
  rangerMessage(id, {}, u);
  const [mo] = J.momentsDuJour(d, u, { zone: 'UTC' });
  assert.equal(mo.veille?.niveau, 'rouge', JSON.stringify(mo.veille));
  assert.equal(mo.veille.genres[0], 'blessure');
});

test('le chiffre de la personne passe avant celui du compagnon sur le même message', () => {
  const u = personne();
  const d = '2026-07-06';
  const id = dire(u, d, '21:30', 'ce soir je suis à 2/10');
  relireLesNotesDites(u);
  // Le compagnon ancre son relevé au MÊME message, juste après : il est le dernier.
  addReleve({ messageId: id, date: d, valeur: 5, quoi: 'semble plutôt moyen ce soir', source: 'modele',
              userId: u, quand: '2026-07-06T21:31:00.000Z' });
  const [mo] = J.momentsDuJour(d, u, { zone: 'UTC', reference: 6 });
  assert.deepEqual(mo.estime, { valeur: 2, dApres: 'releve' });
  const hum = J.volatiliteDuJour(d, u, { zone: 'UTC', reference: 6 }).humeurs;
  assert.deepEqual(hum.map(h => [h.valeur, h.dApres]), [[2, 'releve'], [5, 'modele']],
    'l’estimation du compagnon ne s’affiche pas comme sa parole');

  // Seul, le relevé du compagnon reste visible — mais pas comme un relevé à la main.
  const d2 = '2026-07-07';
  const id2 = dire(u, d2, '21:30', 'longue journée, rien de spécial');
  addReleve({ messageId: id2, date: d2, valeur: 5, quoi: 'semble plutôt moyen ce soir', source: 'modele',
              userId: u, quand: '2026-07-07T21:31:00.000Z' });
  assert.deepEqual(J.momentsDuJour(d2, u, { zone: 'UTC' })[0].estime, { valeur: 5, dApres: 'modele' });
});

test('le chiffre posé sur l’échelle passe avant le relevé que le compagnon ancre au message', () => {
  const u = personne();
  const d = '2026-07-11';
  const id = dire(u, d, '21:30', 'dure soirée, je souffle un peu');
  const q = addMessage({ ts: `${d}T21:31:00.000Z`, date: d, source: 'web', role: DU_COMPAGNON,
                         text: 'où tu en es, là ?', userId: u });
  // Elle touche l'échelle : son relevé est ancré à la question du compagnon…
  addReleve({ messageId: q, date: d, valeur: 3, quoi: 'où tu en es, là ?', source: 'toi', userId: u,
              quand: `${d}T21:32:00.000Z` });
  // … et le compagnon ancre le sien au message à elle, ensuite.
  addReleve({ messageId: id, date: d, valeur: 6, quoi: 'semble tenir le coup ce soir', source: 'modele', userId: u,
              quand: `${d}T21:33:00.000Z` });
  const [mo] = J.momentsDuJour(d, u, { zone: 'UTC', reference: 6 });
  assert.deepEqual(mo.estime, { valeur: 3, dApres: 'releve' });
});

/*
 * Les notes d'une simulation seedée sur trois cents jours. La référence (une
 * médiane sur un an) est en retard sur une dérive lente — c'est ce retard qui
 * faisait passer des mots sans information.
 */
function simulation(u, { notes, texteDu }) {
  let g = 20260929;
  const alea = () => (g = (g * 1103515245 + 12345) % 2147483648) / 2147483648;
  const vals = [];
  for (let i = 0; i < 300; i++) { vals.push(notes(i, alea)); setNote(jour(i), vals[i], u); }
  // La référence de chaque jour, celle que la calibration utilise.
  const refs = new Map(buildSeries(allEntries(u)).map(s => [s.date, s.reference ?? 5]));
  for (let i = 0; i < 300; i++) dire(u, jour(i), '20:00', texteDu(vals[i] - refs.get(jour(i)), alea));
  return J.calibrationDesMots(u);
}
const TRISTES = ['un peu triste ce soir, fatigué de la semaine', 'ce soir un peu triste et las, sans raison',
                 'un peu triste aujourd’hui, et fatigué'];
const derive = (i, alea) => Math.max(1, Math.min(10, Math.round(8 - 5 * i / 300 + (alea() - 0.5) * 1.5)));

test('calibration : une dérive et des mots sans information ne passent pas', () => {
  // Trois phrases tristes interchangeables, tirées au hasard, sans rien savoir de la note.
  const c = simulation(personne(), { notes: derive, texteDu: (_, alea) => TRISTES[Math.floor(alea() * 3)] });
  assert.equal(c.ok, false, JSON.stringify(c));
  assert.ok(c.paires >= 250);
});

test('calibration : la même dérive, avec des mots qui suivent l’écart, passe', () => {
  const bruit = (i, alea) => Math.max(1, Math.min(10, Math.round(8 - 5 * i / 300 + (alea() < 0.5 ? -3 : 3))));
  const c = simulation(personne(), { notes: bruit, texteDu: (e, alea) => (e > 0 ? HAUT : BAS)[Math.floor(alea() * 4)] });
  assert.equal(c.ok, true, JSON.stringify(c));
});

test('calibration : un lien franc mais des écarts exagérés échouent sur l’erreur', () => {
  // Des notes à 4 ou 6, des mots qui en suivent le sens mais le crient : ±2 à 3 points.
  const c = simulation(personne(), {
    notes: (i, alea) => (alea() < 0.5 ? 4 : 6),
    texteDu: (e, alea) => (e > 0 ? HAUT : BAS)[Math.floor(alea() * 4)]
  });
  assert.ok(c.rho >= J.CALIBRATION.rho, JSON.stringify(c));
  assert.equal(c.ok, false);
  assert.equal(c.raison, 'pas mieux qu’un chiffre constant');
});

test('calibration : chaque porte ferme seule', () => {
  const P = (a, b, ref = 6) => ({ estime: ref + a, vrai: ref + b, ref });
  const juge = J.jugerLesPaires;
  assert.equal(juge(Array.from({ length: 19 }, (_, i) => P(i % 3 - 1, i % 3 - 1))).raison, 'trop peu de paires');

  // Un penchant constant sur des notes qui dérivent : les niveaux se suivent
  // parfaitement, les écarts pas du tout. C'est ce qui passait.
  const derivee = Array.from({ length: 40 }, (_, i) => {
    const ref = 8 - i / 10;
    return { estime: ref - 1.5, vrai: ref - 1.5 + (i % 2 ? 0.5 : -0.5), ref };
  });
  assert.equal(juge(derivee).raison, 'lien trop faible', JSON.stringify(juge(derivee)));

  // Un lien franc qui tient à un seul point sur vingt : le hasard le donne une fois sur sept.
  const rare = [...Array.from({ length: 17 }, () => P(0, 0)), P(1, 1), P(1, 0), P(1, 0)];
  const r = juge(rare);
  assert.ok(r.rho >= J.CALIBRATION.rho, JSON.stringify(r));
  assert.equal(r.raison, 'lien possiblement dû au hasard', JSON.stringify(r));

  // Le bon sens, mais trois points là où il y en a un : pas mieux qu'un chiffre constant.
  const cri = Array.from({ length: 30 }, (_, i) => (i % 2 ? P(3, 1) : P(-3, -1)));
  assert.equal(juge(cri).raison, 'pas mieux qu’un chiffre constant', JSON.stringify(juge(cri)));

  // Et des mots qui suivent l'écart, à peu près à sa taille, passent.
  const bon = Array.from({ length: 30 }, (_, i) => P((i % 5 - 2) * 0.5, (i % 5 - 2) * 0.5 + (i % 2 ? 0.2 : -0.2)));
  assert.equal(juge(bon).ok, true, JSON.stringify(juge(bon)));
});

test('calibration : échanger deux notes, déplacer ou réécrire un message, rien n’est servi périmé', () => {
  const u = personne();
  journalCorrele(u);
  const c1 = J.calibrationDesMots(u);
  assert.equal(J.calibrationDesMots(u), c1, 'le cache ne sert plus rien');
  const note = i => db.prepare('SELECT note FROM entries WHERE user_id = ? AND date = ?').get(u, jour(i)).note;
  const [a, b] = [note(0), note(1)];
  setNote(jour(0), b, u);
  setNote(jour(1), a, u);
  const c2 = J.calibrationDesMots(u);
  assert.notEqual(c2, c1, 'deux notes échangées : calibration périmée');
  const m = db.prepare('SELECT id, text FROM messages WHERE user_id = ? AND date = ?').get(u, jour(2));
  redaterMessages([m.id], jour(3), u);
  const c3 = J.calibrationDesMots(u);
  assert.notEqual(c3, c2, 'un message déplacé à une autre date : calibration périmée');
  db.prepare('UPDATE messages SET text = ? WHERE id = ?').run(m.text.split('').reverse().join(''), m.id);
  assert.notEqual(J.calibrationDesMots(u), c3, 'un message réécrit : calibration périmée');
});

test('la négation : « pas du tout », « perdu tout espoir », « manque de » ne se lisent pas vers le haut', () => {
  for (const p of ['je suis pas du tout motivé ce soir', 'je suis pas du tout très motivé ce soir',
                   "j'ai perdu tout espoir ce soir", "j'ai perdu confiance en moi ce soir",
                   'plus du tout motivée ce soir franchement', 'je manque de confiance ce soir',
                   'une perte de confiance terrible ce soir', "j'ai plus d'espoir depuis ce matin"]) {
    const v = J.pencheDe(p);
    assert.ok(v == null || v <= 0, `« ${p} » penche à ${v}`);
  }
  // Et ce qui va bien monte toujours : l'espoir non nié, le calme au comparatif.
  assert.ok(J.pencheDe("j'ai repris confiance et espoir ce soir") > 0);
  assert.ok(J.pencheDe('je me sens plus calme ce soir qu’hier') > 0);
});

/* La ligne d'un moment vit dans web/app.js : on l'en extrait, comme pour la courbe. */
const momentMarkup = (() => {
  const APP = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const i = APP.indexOf('function momentMarkup(m) {');
  assert.ok(i >= 0, 'momentMarkup a été renommée ou déplacée');
  const j = APP.indexOf('\n}\n', i);
  return new Function('esc', 'marqueMoment', 'estimeMarkup', `${APP.slice(i, j + 2)}; return momentMarkup;`)(
    s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    () => '', () => '');
})();

test('un moment fait seulement de messages rangés le dit, au lieu d’une ligne vide', () => {
  const u = personne();
  const d = '2026-07-08';
  const id = dire(u, d, '03:00', "Cher confrère, je vous adresse ce patient avec antécédent de scarification à l'adolescence.");
  dire(u, d, '19:00', 'soirée tranquille, un film et au lit');
  rangerMessage(id, {}, u);
  const mo = J.momentsDuJour(d, u, { zone: 'UTC' });
  assert.deepEqual(mo.map(m => m.rangeSeul ?? false), [true, false]);
  assert.equal('rangeSeul' in mo[1], false, 'la forme d’un moment ordinaire ne change pas');

  const range = momentMarkup(mo[0]);
  assert.match(range, /un message rangé au carnet/);
  assert.doesNotMatch(range, /role="button"/, 'la ligne promet un passage qui n’existe pas à droite');
  assert.match(range, /data-range="1"/);
  const ordinaire = momentMarkup(mo[1]);
  assert.match(ordinaire, /soirée tranquille/);
  assert.match(ordinaire, /role="button"/);
});
