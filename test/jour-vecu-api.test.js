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
