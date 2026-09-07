/**
 * LA JOURNEE VECUE, BRANCHEE.
 *
 * Le module sait couper une journee au lever ; ce fichier verifie que
 * l'application s'en sert vraiment — que la borne dite se range, qu'elle
 * change la journee d'un message, et surtout qu'elle ne change RIEN quand on
 * ne sait rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-jv-')), 'test.db');

const { OWNER, poserMesure, mesuresDuJour } = await import('../server/db.js');
const api = await import('../server/api.js');
const { dansLaZone } = await import('../server/temps.js');

const AUJ = new Date().toISOString().slice(0, 10);
const veille = (() => { const d = new Date(`${AUJ}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); })();
/** Un instant du jour J, a l'heure voulue, lu en UTC. */
const a = (d, h, m = 0) => Date.parse(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);

test('sans aucun lever connu, la journée vécue est la journée civile', () => {
  dansLaZone('UTC', () => {
    assert.equal(api.jourVecu(OWNER, a(AUJ, 2, 30)), AUJ,
      'on ne déplace rien tant qu’on ne sait rien');
  });
});

test('« je viens de me lever » se range comme une mesure', () => {
  dansLaZone('UTC', () => {
    const pose = api.noterBornesDites('je viens de me lever', OWNER, a(AUJ, 9, 20));
    assert.equal(pose, true);
    const m = mesuresDuJour(AUJ, OWNER).find(x => x.cle === 'lever_dit');
    assert.ok(m, 'la borne dite n’a pas été enregistrée');
    assert.equal(m.texte, '09:20', 'sans heure dans la phrase, c’est l’instant du message');
    assert.equal(m.source, 'dit');
  });
});

test('une fois le lever connu, deux heures du matin appartiennent à la veille', () => {
  dansLaZone('UTC', () => {
    assert.equal(api.jourVecu(OWNER, a(AUJ, 2, 30)), veille);
    assert.equal(api.jourVecu(OWNER, a(AUJ, 9, 21)), AUJ);
  });
});

test('une phrase qui ne dit pas de borne n’en pose pas', () => {
  dansLaZone('UTC', () => {
    assert.equal(api.noterBornesDites('j’ai mangé des pâtes', OWNER, a(AUJ, 13, 0)), false);
    assert.equal(api.noterBornesDites('faut que je me lève tôt demain', OWNER, a(AUJ, 13, 0)), false);
  });
});

test('l’heure dite dans la phrase l’emporte sur celle du message', () => {
  dansLaZone('UTC', () => {
    api.noterBornesDites('je me suis levé à 07:05', OWNER, a(AUJ, 11, 0));
    const m = mesuresDuJour(AUJ, OWNER).find(x => x.cle === 'lever_dit');
    assert.equal(m.texte, '07:05');
    // Et la coupure suit tout de suite : le cache s'invalide à la signature.
    assert.equal(api.jourVecu(OWNER, a(AUJ, 7, 4)), veille);
    assert.equal(api.jourVecu(OWNER, a(AUJ, 7, 5)), AUJ);
  });
});

test('le quantified self suffit, sans que personne n’ait rien dit', () => {
  /*
   * UNE AUTRE PERSONNE dans la meme base : c'est la seule facon honnete
   * d'isoler ce cas. Reimporter les modules avec une autre base laissait
   * `api.js` parler a la PREMIERE — le test passait alors sur les bornes de
   * quelqu'un d'autre, ce qui ne prouve rien.
   */
  const AUTRE = 'quantifie';
  for (let i = 1; i <= 5; i++) {
    const d = new Date(`${AUJ}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - i);
    poserMesure({ date: d.toISOString().slice(0, 10), source: 'poste',
                  cle: 'premiere_activite', texte: '08:00', userId: AUTRE });
  }
  dansLaZone('UTC', () => {
    // Aucun lever pour aujourd'hui : c'est la mediane de SES matins qui sert.
    assert.equal(api.jourVecu(AUTRE, a(AUJ, 3, 0)), veille);
    assert.equal(api.jourVecu(AUTRE, a(AUJ, 8, 30)), AUJ);
  });
});

test('un message sans date explicite se range dans la journée vécue', async () => {
  // On n'appelle pas le modèle : c'est le rangement qu'on vérifie, et il se
  // fait AVANT toute réponse.
  const { messagesForDate } = await import('../server/db.js');
  dansLaZone('UTC', () => {
    poserMesure({ date: AUJ, source: 'dit', cle: 'lever_dit', texte: '10:00', userId: OWNER });
    assert.equal(api.jourVecu(OWNER, a(AUJ, 1, 0)), veille);
  });
  assert.ok(Array.isArray(messagesForDate(AUJ, OWNER)));
});

/*
 * LE RECALAGE DE LA NUIT.
 *
 * On apprend la frontière APRÈS coup : « je vais me coucher » arrive à 6 h du
 * matin, et ce qui a été écrit cette nuit-là est déjà rangé sur la journée
 * civile du lendemain. Sans recalage, la borne est enregistrée, la règle est
 * juste, et l'écran continue d'afficher la soirée au mauvais endroit — ce qui
 * revient à n'avoir rien fait.
 */
test('dire « je vais me coucher » à 6 h range la nuit sur la veille', async () => {
  const NUIT = 'couche-tard';
  const { addMessage, messagesForDate, getEntry } = await import('../server/db.js');
  const j = '2026-06-10', hier = '2026-06-09';

  // Une soirée qui déborde : 01:56 et 05:43 le 10, puis 16:24 le même jour.
  for (const [h, m, t] of [[1, 56, 'encore debout'], [5, 43, 'toujours pas couché'], [16, 24, 'hello']]) {
    addMessage({ ts: new Date(a(j, h, m)).toISOString(), date: j, role: 'user', text: t, userId: NUIT });
  }
  assert.equal(messagesForDate(j, NUIT).length, 3);

  dansLaZone('UTC', () => {
    poserMesure({ date: j, source: 'dit', cle: 'coucher_dit', texte: '06:10', userId: NUIT });
    const bouges = api.recalerLaNuit(j, NUIT);
    assert.equal(bouges, 2, 'les deux messages d’avant 06:10 doivent partir sur la veille');
  });

  assert.deepEqual(messagesForDate(hier, NUIT).map(m => m.text),
                   ['encore debout', 'toujours pas couché']);
  assert.deepEqual(messagesForDate(j, NUIT).map(m => m.text), ['hello']);
  // Le texte d'une journée est DÉRIVÉ de ses messages : les deux se refont.
  assert.match(getEntry(hier, NUIT).text, /toujours pas couché/);
  assert.doesNotMatch(getEntry(j, NUIT).text, /toujours pas couché/);
});

test('sans borne connue, le recalage ne déplace rien', () => {
  const VIDE = 'sans-borne';
  dansLaZone('UTC', () => {
    assert.equal(api.recalerLaNuit('2026-06-10', VIDE), 0);
  });
});

test('le recalage ne remonte JAMAIS plus d’un jour en arrière', async () => {
  const UN = 'un-seul-jour';
  const { addMessage, messagesForDate } = await import('../server/db.js');
  // Une soirée sur trois jours d'affilée : seule celle du jour visé bouge.
  for (const d of ['2026-07-01', '2026-07-02', '2026-07-03']) {
    addMessage({ ts: new Date(a(d, 2, 0)).toISOString(), date: d, role: 'user', text: `nuit ${d}`, userId: UN });
    poserMesure({ date: d, source: 'dit', cle: 'coucher_dit', texte: '06:00', userId: UN });
  }
  dansLaZone('UTC', () => { api.recalerLaNuit('2026-07-02', UN); });
  // La nuit du 2 rejoint le 1er — UN jour en arrière, celui d'avant seulement.
  assert.deepEqual(messagesForDate('2026-07-01', UN).map(m => m.text),
                   ['nuit 2026-07-01', 'nuit 2026-07-02']);
  assert.deepEqual(messagesForDate('2026-07-02', UN).map(m => m.text), []);
  assert.deepEqual(messagesForDate('2026-07-03', UN).map(m => m.text), ['nuit 2026-07-03']);
  const veille = messagesForDate('2026-06-30', UN) ?? [];
  assert.equal(veille.length, 0, 'rien ne doit atterrir deux jours en arrière');
});

test('un coucher DIT du matin ne s’affiche pas comme le coucher du jour même', () => {
  // Le compagnon note « couché 09:45 » sur aujourd'hui (via noter_bornes, qui
  // date sur today()), en même temps qu'un lever de 17:30 : on vient de se lever
  // en fin d'après-midi. 09:45 est le matin — c'est la coupure qui OUVRE le jour,
  // pas sa fin. Il ne doit pas s'afficher comme « couché » du jour où l'on ne
  // s'est pas recouché.
  const U = 'poste-matin';
  poserMesure({ date: '2026-07-20', source: 'dit', cle: 'coucher_dit', texte: '09:45', userId: U });
  poserMesure({ date: '2026-07-20', source: 'dit', cle: 'lever_dit',   texte: '17:30', userId: U });

  const auj = api.posteDuJour('2026-07-20', U);
  assert.equal(auj?.lever?.heure, '17:30', 'le lever reste celui du jour');
  assert.equal(auj?.coucher?.heure ?? null, null,
    'aucun coucher fantôme le jour où l’on ne s’est pas recouché');

  // Et il se range sur la VEILLE, qu'il ferme réellement.
  const veille = api.posteDuJour('2026-07-19', U);
  assert.equal(veille?.coucher?.heure, '09:45', 'le coucher du matin ferme la veille');
  assert.equal(veille?.coucher?.source, 'dit');
});

test('un coucher DIT du soir reste bien le coucher du jour même', () => {
  const U = 'poste-soir';
  poserMesure({ date: '2026-07-25', source: 'dit', cle: 'coucher_dit', texte: '23:30', userId: U });
  const j = api.posteDuJour('2026-07-25', U);
  assert.equal(j?.coucher?.heure, '23:30', 'un « je vais me coucher » du soir ferme ce jour-là');
  assert.equal(j?.coucher?.source, 'dit');
});

/* ==================================================================
 * LES DEUX BOUTS D'UNE JOURNÉE VÉCUE SONT SUR LA MÊME JOURNÉE VÉCUE.
 *
 * L'écran montrait « levé 15:34 · couché 23:59 » un jour où la personne a
 * écrit à 03:18 du matin. Deux défauts empilés : 23:59 n'est pas une heure de
 * coucher mais le bord du fichier du jour civil, et la lune montrait de toute
 * façon le coucher de la VEILLE, pas celui qui ferme la journée affichée.
 * ================================================================== */

test('23:59 n’est pas un coucher, c’est la fin du fichier du jour', async () => {
  const U = 'minuit-bord';
  const { poserActiviteJour } = await import('../server/db.js');
  // Encore devant l'écran quand le fichier du jour se referme : plage.a = 23:59.
  poserActiviteJour(U, '2026-07-10', { date: '2026-07-10', plage: { de: '15:34', a: '23:59' } });
  const j = api.posteDuJour('2026-07-10', U);
  assert.equal(j?.lever?.heure, '15:34');
  assert.equal(j?.coucher?.heure ?? null, null,
    'un coucher au bord de minuit est une journée coupée, pas un endormissement');
});

test('une heure de fin ordinaire, elle, reste un coucher', async () => {
  const U = 'fin-normale';
  const { poserActiviteJour } = await import('../server/db.js');
  poserActiviteJour(U, '2026-07-11', { date: '2026-07-11', plage: { de: '09:10', a: '22:40' } });
  assert.equal(api.posteDuJour('2026-07-11', U)?.coucher?.heure, '22:40');
});

test('LA RÉGRESSION : un coucher réfuté par une phrase écrite plus tard tombe', async () => {
  const U = 'ecrit-apres';
  const { poserActiviteJour, addMessage } = await import('../server/db.js');
  poserActiviteJour(U, '2026-07-12', { date: '2026-07-12', plage: { de: '15:34', a: '23:59' } });
  poserMesure({ date: '2026-07-12', source: 'dit', cle: 'coucher_dit', texte: '23:30', userId: U });
  // Rangé sur la journée vécue du 12 : c'est bien le 12 qui est encore éveillé.
  dansLaZone('UTC', () => {
    addMessage({ ts: '2026-07-13T03:18:00.000Z', date: '2026-07-12', role: 'user',
                 text: 'hey non j’ai fait de la musique depuis', userId: U });
  });
  const j = dansLaZone('UTC', () => api.posteDuJour('2026-07-12', U));
  assert.equal(j?.coucher?.heure ?? null, null,
    'on ne se couche pas à 23:30 pour écrire à 03:18 — le coucher proposé est réfuté');
});

test('le coucher qui ferme la journée peut être après minuit', async () => {
  const U = 'ferme-apres-minuit';
  const { poserActiviteJour } = await import('../server/db.js');
  // Le 13 : levé 15:00, encore là à 23:59. Le 14 : première touche à 03:18,
  // puis plus rien jusqu'à 14:00 — le silence de 03:18 à 14:00 est la nuit.
  poserActiviteJour(U, '2026-07-13', { date: '2026-07-13', plage: { de: '15:00', a: '23:59' } });
  poserActiviteJour(U, '2026-07-14', { date: '2026-07-14', plage: { de: '00:05', a: '22:00' },
                                       trous: [{ de: '03:18', a: '14:00', minutes: 642 }] });
  const j = api.posteDuJour('2026-07-13', U);
  assert.equal(j?.lever?.heure, '15:00');
  assert.equal(j?.coucher?.heure, '03:18', 'la journée du 13 se ferme à 3 h du matin le 14');
  assert.equal(j?.coucher?.source, 'mesure');
});

/* ==================================================================
 * LE 7 SEPTEMBRE : « levé 00:00 (mesure) · couché 19:47 (estime) » chez
 * quelqu'un couché à 05:26 et levé à 16:16 — un jour encore en cours.
 *
 * 00:00 était `plage.de`, le bord où le fichier civil s'ouvre ; 19:47 était
 * `plage.a`, l'heure du dernier envoi. Ni l'un ni l'autre n'est une borne, et
 * aucun ne doit passer pour une mesure. Une journée en cours montre « — » aux
 * deux bouts tant que rien n'est mesuré ou dit.
 * ================================================================== */

test('une journée en cours n’a ni lever au bord de minuit ni coucher « maintenant »', async () => {
  const U = 'en-cours-vide';
  const { poserActiviteJour } = await import('../server/db.js');
  poserActiviteJour(U, AUJ, { date: AUJ, plage: { de: '00:00', a: '19:47' }, trous: [], poste: { reveil: '00:00', source: 'clavier' } });
  const j = dansLaZone('UTC', () => api.posteDuJour(AUJ, U));
  assert.equal(j?.lever?.heure ?? null, null, '00:00 est le bord du fichier civil, pas un lever');
  assert.equal(j?.lever?.source ?? null, null);
  assert.equal(j?.coucher?.heure ?? null, null, 'plage.a d’une journée en cours, c’est « maintenant »');
  assert.equal(j?.sommeil_h ?? null, null);
});

test('la même journée en cours, une fois la nuit dans le clavier : levé 16:16, pas encore couché', async () => {
  const U = 'en-cours-nuit';
  const { poserActiviteJour } = await import('../server/db.js');
  poserActiviteJour(U, veille, { date: veille, plage: { de: '00:00', a: '23:59' }, trous: [] });
  poserActiviteJour(U, AUJ, { date: AUJ, plage: { de: '00:00', a: '19:47' }, trous: [{ de: '05:26', a: '16:16', minutes: 650 }] });
  const j = dansLaZone('UTC', () => api.posteDuJour(AUJ, U));
  assert.equal(j?.lever?.heure, '16:16'); assert.equal(j?.lever?.source, 'mesure');
  assert.equal(j?.coucher?.heure ?? null, null);
  assert.equal(j?.sommeil_h, 10.8); assert.equal(j?.dormi_de, '05:26');
});

test('un jour clos : le lever à 16:15 est une mesure, le coucher vient de la nuit du lendemain', async () => {
  const U = 'clos-complet';
  const { poserActiviteJour } = await import('../server/db.js');
  poserActiviteJour(U, '2026-06-09', { date: '2026-06-09', plage: { de: '00:00', a: '23:59' }, trous: [] });
  poserActiviteJour(U, '2026-06-10', { date: '2026-06-10', plage: { de: '00:00', a: '23:59' }, trous: [{ de: '05:26', a: '16:15', minutes: 649 }] });
  poserActiviteJour(U, '2026-06-11', { date: '2026-06-11', plage: { de: '00:00', a: '22:00' }, trous: [{ de: '05:40', a: '16:30', minutes: 650 }] });
  const j = dansLaZone('UTC', () => api.posteDuJour('2026-06-10', U));
  assert.equal(j?.lever?.heure, '16:15'); assert.equal(j?.lever?.source, 'mesure');
  assert.equal(j?.coucher?.heure, '05:40'); assert.equal(j?.coucher?.source, 'mesure');
  assert.equal(j?.sommeil_h, 10.8);
});

test('un jour clos sans lendemain : plage.a redevient une estimation de coucher', async () => {
  const U = 'clos-sans-demain';
  const { poserActiviteJour } = await import('../server/db.js');
  poserActiviteJour(U, '2026-06-09', { date: '2026-06-09', plage: { de: '00:00', a: '23:59' }, trous: [] });
  poserActiviteJour(U, '2026-06-10', { date: '2026-06-10', plage: { de: '00:00', a: '22:10' }, trous: [{ de: '05:26', a: '16:15', minutes: 649 }] });
  const j = dansLaZone('UTC', () => api.posteDuJour('2026-06-10', U));
  assert.equal(j?.lever?.heure, '16:15');
  assert.equal(j?.coucher?.heure, '22:10'); assert.equal(j?.coucher?.source, 'estime');
});

test('un vieux digest clos sans nuit : pas de lever, et un coucher seulement estimé', async () => {
  const U = 'clos-vieux';
  const { poserActiviteJour } = await import('../server/db.js');
  poserActiviteJour(U, '2026-06-12', { date: '2026-06-12', plage: { de: '00:00', a: '19:47' }, trous: [], poste: { reveil: '00:00', source: 'clavier' } });
  const j = dansLaZone('UTC', () => api.posteDuJour('2026-06-12', U));
  assert.equal(j?.lever?.heure ?? null, null);
  assert.equal(j?.coucher?.heure, '19:47'); assert.equal(j?.coucher?.source, 'estime');
});
