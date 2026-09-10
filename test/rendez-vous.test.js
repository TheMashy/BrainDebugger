/*
 * LE DOCUMENT QU'ON EMPORTE À UN RENDEZ-VOUS.
 *
 * Il est tendu à quelqu'un. C'est ce qui change tout : une ligne fausse n'est
 * plus un défaut d'affichage qu'on corrige au prochain clic, c'est une phrase
 * qu'une praticienne lit et sur laquelle elle travaille.
 *
 * D'où les deux choses vérifiées ici en priorité :
 *
 *   - UN SOUVENIR RACONTÉ N'EST PAS UN GESTE DU JOUR. « je repense à la fois
 *     où je me suis tailladé » ne doit pas produire une ligne « blessure le
 *     12 ». La veille sait déjà les séparer (genre `evoque_passe`) ; le
 *     document doit tenir cette séparation jusqu'au papier ;
 *   - CHAQUE SIGNE PORTE SA CITATION. Sans elle, le document demande qu'on le
 *     croie, et un signe faux devient indiscutable.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-rdv-')), 'test.db');

const { joursDuRendezVous, comptesDuRendezVous, GENRES_PRESENT, GENRE_PASSE } =
  await import('../server/rendez-vous.js');
const { addDays } = await import('../server/stats.js');
const { DIT } = await import('../server/veille.js');

const FIN = '2026-09-10';
/** Une veille postée sur une date, sans base : on teste l'assemblage. */
const veilleFausse = table => (d) => table[d] ?? null;
const nuitsFausses = liste => () => liste;

test('un signe du jour sort avec sa citation, et son libellé', () => {
  const j = joursDuRendezVous('u', {
    jours: 3, jusquA: FIN, lireNuits: nuitsFausses([]),
    lireVeille: veilleFausse({
      [FIN]: { niveau: 'jaune', motifs: [
        { genre: 'substance', niveau: 'jaune', mot: 'bu', extrait: 'j’ai bu quatre bières hier soir' }
      ] }
    })
  });
  const ligne = j.find(x => x.date === FIN);
  assert.equal(ligne.signes.length, 1);
  assert.equal(ligne.signes[0].genre, 'substance');
  assert.match(ligne.signes[0].extrait, /quatre bières/,
    'la citation est ce qui rend le signe contestable');
  assert.ok(ligne.signes[0].libelle, 'et il porte une phrase lisible, pas un code');
});

test('UN SOUVENIR RACONTÉ NE FIGURE PAS COMME UN GESTE DU JOUR', () => {
  const j = joursDuRendezVous('u', {
    jours: 3, jusquA: FIN, lireNuits: nuitsFausses([]),
    lireVeille: veilleFausse({
      [FIN]: { niveau: 'jaune', motifs: [
        { genre: GENRE_PASSE, niveau: 'jaune', mot: 'taillade',
          extrait: 'je repense à la fois où je me suis tailladé, au lycée' }
      ] }
    })
  });
  const ligne = j.find(x => x.date === FIN);
  assert.deepEqual(ligne.signes, [],
    'aucun signe du jour : c’est un souvenir, pas un geste');
  assert.equal(ligne.evoques.length, 1, 'il n’est pas jeté pour autant, il est RANGÉ AILLEURS');
  assert.match(ligne.evoques[0].extrait, /au lycée/);
});

test('les deux ne se mélangent jamais dans les comptes', () => {
  const j = joursDuRendezVous('u', {
    jours: 4, jusquA: FIN, lireNuits: nuitsFausses([]),
    lireVeille: veilleFausse({
      [FIN]: { niveau: 'jaune', motifs: [{ genre: 'suicide', niveau: 'jaune', extrait: 'a' }] },
      [addDays(FIN, -1)]: { niveau: 'jaune', motifs: [{ genre: GENRE_PASSE, niveau: 'jaune', extrait: 'b' }] }
    })
  });
  const c = comptesDuRendezVous(j);
  assert.equal(c.avec_signe, 1, 'une seule journée porte un signe du jour');
  assert.deepEqual(c.par_genre, { suicide: 1 });
  assert.equal(c.jours, 4, 'le dénominateur est là : sans lui le numérateur ne se conteste pas');
});

test('la nuit dit d’où elle vient — témoignage ou déduction', () => {
  const j = joursDuRendezVous('u', {
    jours: 2, jusquA: FIN, lireVeille: () => null,
    lireNuits: nuitsFausses([
      { date: FIN, coucher: '06:48', lever: '18:00', sommeil_h: 11.2, source: 'dit' },
      { date: addDays(FIN, -1), coucher: '23:30', lever: '07:30', sommeil_h: 8, source: 'poste' }
    ])
  });
  assert.equal(j.find(x => x.date === FIN).source_nuit, 'dit');
  assert.equal(j.find(x => x.date === addDays(FIN, -1)).source_nuit, 'poste');
  const c = comptesDuRendezVous(j);
  assert.equal(c.nuits_mesurees, 2);
  assert.equal(c.nuits_dites, 1, 'la praticienne doit pouvoir séparer les deux');
});

test('une journée sans rien reste dans la liste, vide', () => {
  /*
   * Le document couvre trente jours PLEINS. Sauter les journées vides
   * donnerait une frise qui se resserre autour de ce qui va mal — un dessin
   * qui ment par la forme, avant même d'avoir menti par les chiffres.
   */
  const j = joursDuRendezVous('u', { jours: 5, jusquA: FIN, lireVeille: () => null, lireNuits: nuitsFausses([]) });
  assert.equal(j.length, 5);
  assert.ok(j.every(x => x.signes.length === 0 && x.evoques.length === 0));
});

test('tous les genres du présent sont connus de la veille', () => {
  for (const g of GENRES_PRESENT)
    assert.ok(DIT[g], `${g} doit avoir une phrase lisible, sinon le document affiche un code`);
  assert.ok(DIT[GENRE_PASSE]);
});
