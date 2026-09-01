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
