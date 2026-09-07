/*
 * CE QUI A DE LA PRISE.
 *
 * Deux choses se testent ici, et la seconde compte plus que la première.
 *
 * D'abord que ça trouve. Ensuite, et surtout, que ça ne trouve PAS : sur ce
 * terrain un faux positif ne se corrige pas tout seul. Dire à quelqu'un que
 * l'alcool revient dans son journal parce qu'il a bu un verre d'eau, c'est lui
 * poser une étiquette qu'il n'ira pas vérifier — et le tableau ne fait rien de
 * plus dangereux que ça. D'où le corpus de pièges, plus long que celui des cas
 * vrais.
 *
 * Et une règle de forme, tenue partout dans le produit : aucune phrase rendue
 * ne qualifie la personne. On compte des jours, on rend la phrase écrite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisesDuTexte, signesDuTexte, seriesSans, analyserPrises,
         FAMILLES, SIGNES, SEUILS_PRISES } from '../server/prises.js';

const cles = t => [...prisesDuTexte(t).keys()].sort();
const J = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

/* --------------------------- ce qui compte --------------------------- */

test('chaque famille se reconnaît sur la façon dont on l’écrit vraiment', () => {
  const vrais = [
    ["j'ai bu quatre bières hier soir", 'alcool'],
    ["j'ai encore bu", 'alcool'],
    ["j'étais bourrée avant 22h", 'alcool'],
    ["grosse gueule de bois ce matin", 'alcool'],
    ["j'ai fumé un joint avant de dormir", 'cannabis'],
    ["deux bedos et je me suis endormi", 'cannabis'],
    ["j'ai tapé deux traces vers minuit", 'stimulants'],
    ["j'ai pris de la md samedi", 'stimulants'],
    ["j'ai pris trois xanax pour tenir", 'calmants'],
    ["j'ai fumé un paquet de clopes", 'tabac'],
    ["j'ai remis cinquante balles sur betclic", 'argent'],
  ];
  for (const [t, attendu] of vrais)
    assert.ok(cles(t).includes(attendu), `« ${t} » → ${cles(t)} (attendu ${attendu})`);
});

/* --------------------------- les pièges --------------------------- */

test('rien de ce qui ressemble à une prise et n’en est pas ne compte', () => {
  const pieges = [
    "j'ai bu un verre d'eau",                       // le mot y est, le verbe aussi
    "j'ai bu de l'eau toute la journée",
    "j'ai bu un café en arrivant",
    "j'ai fini la bouteille de jus",
    "j'ai vidé la bouteille de shampoing",
    "une bière sans alcool en terrasse",
    "mon frère a bu toute la soirée",               // ce n'est pas la personne
    "ma mère prenait du valium à l'époque",
    "je n'ai pas bu depuis trois semaines",         // la négation
    "pas une goutte ce week-end",
    "j'ai arrêté de fumer",
    "à l'époque je buvais tous les soirs",          // un souvenir
    "quand j'étais au lycée je fumais des joints",
    "c'est quoi le pire, boire ou fumer ?",         // une question au compagnon
    "j'étais bourré de travail",                    // l'hyperbole
    "défoncé de fatigue après la salle",
    "j'ai pris mon somnifère prescrit",             // un traitement suivi
    "le chien a fait un pet",
    "j'ai bu un chocolat chaud",
    "j'ai fini le livre",
  ];
  for (const t of pieges)
    assert.deepEqual(cles(t), [], `« ${t} » ne devrait rien déclencher, a donné ${cles(t)}`);
});

test('l’envie n’est pas la prise', () => {
  assert.deepEqual(cles("j'ai envie de boire mais j'ai tenu"), [],
    'une envie tenue comptée comme un jour de prise punirait exactement ce qu’on veut encourager');
  assert.ok(signesDuTexte("j'ai envie de boire mais j'ai tenu").some(s => s.id === 'manque'),
    'elle reste un signe, avec sa phrase');
});

test('la preuve rendue est la phrase écrite, pas un verdict', () => {
  const v = prisesDuTexte("Journée correcte. J'ai bu trois bières devant la télé. Dormi tard.");
  assert.match(v.get('alcool').phrase, /trois bières/);
  assert.ok(!/dépend|addict|alcooli/i.test(v.get('alcool').phrase));
});

test('aucune famille, aucun signe ne qualifie la personne', () => {
  const interdit = /addict|alcoolo|alcooliqu|toxico|dépendan|drogué|malade|accro/i;
  for (const f of FAMILLES) assert.ok(!interdit.test(f.nom), f.nom);
  for (const s of SIGNES) assert.ok(!interdit.test(s.dit), s.dit);
});

/* --------------------------- les séries --------------------------- */

test('les séries sans encadrent les occurrences, et la dernière est en cours', () => {
  const ecrits = Array.from({ length: 60 }, (_, i) => J(i));
  const s = seriesSans([J(10), J(40)], ecrits, J(59));
  assert.equal(s.length, 3);
  assert.deepEqual([s[0].de, s[0].a], [J(0), J(9)]);
  assert.deepEqual([s[1].de, s[1].a], [J(11), J(39)]);
  assert.deepEqual([s[2].de, s[2].a], [J(41), J(59)]);
  assert.equal(s[2].encours, true);
  assert.equal(s[0].encours, false);
});

test('une série trop courte n’en est pas une', () => {
  const ecrits = Array.from({ length: 30 }, (_, i) => J(i));
  const s = seriesSans([J(10), J(12)], ecrits, J(29));
  assert.ok(!s.some(x => x.jours < SEUILS_PRISES.min_serie),
    'deux jours entre deux fois ne sont pas « deux jours sans »');
});

test('une série qu’on n’a pas écrite ne devient pas un record', () => {
  // Quarante jours sans, dont un seul écrit : ça ne prouve rien, et l'annoncer
  // comme un record serait un mensonge encourageant.
  const ecrits = [J(0), J(1), J(2), J(45), J(46), J(47)];
  const r = analyserPrises([...ecrits.map(d => ({ date: d, note: 6, text: 'rien de spécial' }))]
    .map(e => [J(0), J(1), J(2)].includes(e.date) ? { ...e, text: "j'ai bu trois bières" } : e),
    { aujourdhui: J(47) });
  const a = r.prises.find(p => p.cle === 'alcool');
  assert.ok(a, 'trois jours suffisent pour exister');
  const creuse = a.series.find(s => s.maigre);
  assert.ok(creuse, 'la série de quarante jours est marquée maigre');
  assert.ok(a.plus_longue < creuse.jours, 'et elle ne peut pas devenir le record');
});

/* --------------------------- le dossier entier --------------------------- */

/** Un journal où l'alcool part doucement et s'installe, avec une série au milieu. */
function dossier({ T = 220 } = {}) {
  const rows = [];
  // Une fois tous les quinze jours au début, tous les trois jours ensuite, un
  // jour sur deux sur le dernier mois : c'est la forme qu'on veut voir sortir.
  const densite = i => i >= 190 ? i % 2 === 0 : i >= 110 ? i % 6 === 0 : i % 15 === 0;
  for (let i = 0; i < T; i++) {
    if (i % 4 === 3) continue;                          // on n'écrit pas tous les jours
    const boit = densite(i);
    rows.push({ date: J(i), note: boit ? 4 : 6,
                text: boit ? "j'ai bu quatre bières ce soir." : 'journée ordinaire, du travail et une marche.' });
  }
  return rows;
}

test('trois jours suffisent pour exister, deux ne suffisent pas', () => {
  const deux = [0, 1].map(i => ({ date: J(i), note: 5, text: "j'ai bu trois bières" }));
  const fond = Array.from({ length: 20 }, (_, i) => ({ date: J(i + 5), note: 6, text: 'rien' }));
  const r = analyserPrises([...deux, ...fond], { aujourdhui: J(24) });
  assert.deepEqual(r.prises, []);
  assert.equal(r.ecartees[0]?.cle, 'alcool');
  assert.match(r.ecartees[0].pourquoi, /2 fois/);
});

test('une montée récente se lit dans les deux fenêtres, pas dans un verdict', () => {
  const r = analyserPrises(dossier(), { aujourdhui: J(219) });
  const a = r.prises.find(p => p.cle === 'alcool');
  assert.ok(a, 'l’alcool ressort');
  assert.ok(a.recent > a.avant, `récent ${a.recent} devrait dépasser avant ${a.avant}`);
  assert.equal(typeof a.depuis, 'number');
  assert.ok(a.jours.every(d => typeof d === 'string'), 'les jours sont des dates — la bande les pose telles quelles');
});

test('ce qui vient avant se compte comme les flèches de la carte', () => {
  /* La solitude un jour, l'alcool la journée écrite suivante : neuf fois. */
  const rows = [], solitude = [];
  for (let i = 0; i < 160; i++) {
    if (i % 2) continue;
    const seul = i % 16 === 0;
    const boit = i % 16 === 2;                          // la journée écrite juste après
    if (seul) solitude.push(J(i));
    rows.push({ date: J(i), note: boit ? 4 : 6,
                text: boit ? "j'ai bu quatre bières." : seul ? 'personne de la journée.' : 'journée ordinaire.' });
  }
  const carte = { noeuds: [{ nom: 'la solitude', jours: solitude }] };
  const r = analyserPrises(rows, { carte, aujourdhui: J(159) });
  const a = r.prises.find(p => p.cle === 'alcool');
  const av = a.avant_ca.find(x => x.nom === 'la solitude');
  assert.ok(av, `« la solitude » devrait ressortir, obtenu : ${JSON.stringify(a.avant_ca)}`);
  assert.ok(av.apres >= 5 && av.p < 0.05, JSON.stringify(av));
});

test('le témoin ne se voit rien inventer', () => {
  const rows = Array.from({ length: 200 }, (_, i) => ({
    date: J(i), note: 5 + (i % 5) - 2,
    text: 'journée ordinaire : du travail, une marche, un film le soir. J’ai bu un thé.' }));
  const r = analyserPrises(rows, { aujourdhui: J(199) });
  assert.deepEqual(r.prises, [], JSON.stringify(r.prises.map(p => p.cle)));
});
