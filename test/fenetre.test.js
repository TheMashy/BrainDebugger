/**
 * LA FENÊTRE COURTE, ET LA PIOCHE.
 *
 * Le compagnon portait la grille ENTIÈRE dans son contexte stable : une ligne
 * par mois, un chiffre par jour, tous les mois depuis le premier, à chaque
 * message. Mesuré à trois ans (854 journées notées) : 3855 tokens de mémoire
 * stable, dont 2951 pour la grille seule — 77 %.
 *
 * Et c'était le seul bloc qui grandissait vraiment. Les repères, les motifs et
 * les horizons plafonnent ; la grille prend mille tokens de plus par année
 * vécue, pour toujours. Une application dont le contexte grossit avec la vie de
 * la personne finit par ne plus parler que d'elle-même.
 *
 * Ce fichier tient les deux moitiés de la réparation :
 *   — la mémoire stable NE GRANDIT PLUS avec l'historique ;
 *   — ce qu'on en a retiré reste ATTEIGNABLE, exactement, par `lire_grille`.
 *
 * La deuxième moitié n'est pas un détail. Sortir la grille du contexte sans
 * donner de quoi la relire n'aurait pas allégé le compagnon, ça l'aurait rendu
 * amnésique — et « je n'ai que des bouts » est précisément la réponse que la
 * grille avait été mise là pour supprimer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-fenetre-')), 'test.db');

const { OWNER, setNote, setSettings } = await import('../server/db.js');
const api = await import('../server/api.js');
const { fenetreBlock, grilleExtrait, bornerPeriode, FENETRE_JOURS, MAX_PERIODE, OUTILS }
  = await import('../server/chat.js');

/* Le jour J moins N, sans fuseau. */
const jourMoins = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

const AUJOURD_HUI = '2026-06-15';

/*
 * Trois ans de notes, une par jour. C'est l'ordre de grandeur réel du journal
 * de la personne au moment où le problème a été mesuré — un test sur trente
 * journées n'aurait rien montré, puisque le défaut EST la croissance.
 */
const TROIS_ANS = 3 * 365;
for (let i = TROIS_ANS; i >= 0; i--) {
  setNote(jourMoins(AUJOURD_HUI, i), (i * 7) % 11, OWNER);
}
setSettings({ memoryDays: 14 }, OWNER);

const notes = Array.from({ length: TROIS_ANS + 1 }, (_, k) => {
  const i = TROIS_ANS - k;
  return { date: jourMoins(AUJOURD_HUI, i), note: (i * 7) % 11 };
});

/* ==================== CE QUI RESTE DANS LE CONTEXTE ==================== */

test('la fenêtre porte les cinq dernières semaines, jour par jour', () => {
  const bloc = fenetreBlock(notes, { fin: AUJOURD_HUI });
  assert.ok(bloc, 'aucune fenêtre rendue');
  // Le format que la personne connaît : une ligne par mois, « Juin  ... ».
  assert.match(bloc, /Juin/);
  assert.match(bloc, /Mai/);
  // Cinq semaines depuis le 15 juin remontent au 12 mai : avril n'y est pas.
  assert.equal(/\bAvr\b/.test(bloc), false, 'la fenêtre déborde de cinq semaines');
});

test('le socle dit ce qu’il y a derrière, sans le porter', () => {
  const bloc = fenetreBlock(notes, { fin: AUJOURD_HUI });
  assert.match(bloc, new RegExp(`${notes.length} journées notées`));
  assert.match(bloc, new RegExp(`Depuis le ${notes[0].date}`));
  // Et il dit où aller le lire — sinon le compagnon répond « je n'ai que des
  // bouts », qui est exactement ce qu'on essayait de supprimer.
  assert.match(bloc, /lire_grille/);
});

/*
 * LE TEST QUI COMPTE.
 *
 * Il ne mesure pas une taille absolue — un seuil en octets se périme au premier
 * mot ajouté à un prompt. Il mesure la CROISSANCE : un an de journal et trois
 * ans de journal doivent produire une mémoire stable de la même taille. C'est
 * la propriété que l'ancienne version violait, et la seule dont la violation
 * ne se voit nulle part ailleurs — pas d'erreur, pas de test rouge, juste une
 * facture qui monte et un compagnon qui lit huit cents chiffres avant de
 * répondre « et toi, ça va ? ».
 */
test('la mémoire stable ne grandit pas avec l’historique', () => {
  const unAn = notes.filter(e => e.date > jourMoins(AUJOURD_HUI, 365));
  const court = fenetreBlock(unAn, { fin: AUJOURD_HUI });
  const long = fenetreBlock(notes, { fin: AUJOURD_HUI });

  const ecart = Math.abs(long.length - court.length);
  assert.ok(ecart < 200,
    `la fenêtre grandit avec l'historique : ${court.length} → ${long.length} signes`);

  // Et concrètement : rien de vieux de deux ans ne traîne dans le contexte.
  const vieux = jourMoins(AUJOURD_HUI, 700).slice(0, 4);
  assert.equal(long.includes(vieux), false, `l'année ${vieux} est encore portée`);
});

test('la mémoire stable de l’API ne porte plus la grille entière', () => {
  const m = api.recentMemory(AUJOURD_HUI, OWNER, 'salut');
  const an = Number(AUJOURD_HUI.slice(0, 4)) - 2;
  assert.equal(m.stable.includes(String(an)), false,
    `${an} est encore dans la mémoire stable`);
  // Elle reste stable d'un message à l'autre : c'est la condition du cache.
  const n = api.recentMemory(AUJOURD_HUI, OWNER, 'autre chose entièrement');
  assert.equal(m.stable, n.stable);
});

/* ==================== CE QU’ON VA CHERCHER ==================== */

test('un mois seul se borne tout seul, février compris', () => {
  assert.deepEqual(bornerPeriode('2024-03'), { debut: '2024-03-01', fin: '2024-03-31', jours: 31 });
  // 2024 est bissextile, 2025 ne l'est pas. Un « 30 février » demandé au modèle
  // serait une date inventée ; c'est donc à nous de borner.
  assert.equal(bornerPeriode('2024-02').fin, '2024-02-29');
  assert.equal(bornerPeriode('2025-02').fin, '2025-02-28');
  assert.deepEqual(bornerPeriode('2024-01', '2024-12').fin, '2024-12-31');
});

test('les bornes impossibles sont refusées avec une phrase réparable', () => {
  assert.match(bornerPeriode('mars 2024').erreur, /AAAA-MM/);
  assert.match(bornerPeriode('2024-03-01', 'hier').erreur, /AAAA-MM/);
  assert.match(bornerPeriode('2024-06-01', '2024-05-01').erreur, /avant le début/);
  // Trop long : sinon l'outil rendrait la grille entière et annulerait le gain.
  const trop = bornerPeriode('2020-01-01', '2026-01-01');
  assert.match(trop.erreur, /trop longue/);
  assert.ok(MAX_PERIODE < 800);
});

test('l’extrait rend les vraies notes de la période demandée', () => {
  const b = bornerPeriode('2025-01');
  const e = grilleExtrait(notes, b);
  assert.match(e, /^2025/m);
  assert.match(e, /Jan/);
  assert.match(e, /31 journées notées/);
  // Et rien d'autre : un extrait qui déborde ferait rentrer par l'outil ce
  // qu'on vient de sortir du contexte.
  assert.equal(/Fév/.test(e), false);
});

test('lire_grille est déclaré et branché', () => {
  assert.ok(OUTILS.lire_grille, 'l’outil n’est pas au catalogue');
  const o = api.outilsPour(OWNER, null);
  assert.equal(typeof o.lire_grille, 'function');

  const r = o.lire_grille({ debut: '2025-01' });
  assert.match(r.message, /2025-01-01 au 2025-01-31/);
  assert.match(r.message, /Jan/);

  assert.match(o.lire_grille({ debut: 'nawak' }).erreur, /AAAA-MM/);
});

/*
 * Une période vide répond « rien », pas une erreur. La différence n'est pas
 * cosmétique : sur une erreur le modèle réessaie, sur « rien » il sait qu'il a
 * la réponse — et « tu n'as rien noté en 2019 » EST une réponse.
 */
test('une période sans note se dit, et n’est pas une erreur', () => {
  const r = api.outilsPour(OWNER, null).lire_grille({ debut: '2019-01' });
  assert.equal(r.erreur, undefined);
  assert.match(r.message, /Aucune journée notée/);
});

test('la fenêtre fait bien cinq semaines', () => {
  assert.equal(FENETRE_JOURS, 35);
});
