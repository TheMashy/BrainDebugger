/*
 * CE QUE LE TABLEAU DES CONSOMMATIONS DISAIT DE FAUX, SUR UN JOURNAL RÉEL.
 *
 * Relu journée par journée : un record « 13 jours sans » cannabis sur une
 * série où la consommation était écrite trois fois (un adverbe entre « j'ai »
 * et « fumé », un chiffre devant « joints »), une carte alcool entière bâtie
 * sur des projets, un souvenir et une fraction de verre lue comme plusieurs
 * verres, les anxiolytiques absents sous leur abréviation, une flèche ↗ qui
 * mesurait un changement de manière d'écrire, et trois citations sur quatre
 * qui ne parlaient pas de consommation.
 *
 * Toutes les phrases ci-dessous sont synthétiques.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prisesDuTexte, signesDuTexte, combienDit, analyserPrises, FAMILLES, familleDuSuivi } from '../server/prises.js';
import { norm } from '../server/veille.js';
import { prisesBlock } from '../server/chat.js';

const cles = (t, an = 2026) => [...prisesDuTexte(t, [], an).keys()].sort();
const J = i => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
const fam = cle => FAMILLES.find(f => f.cle === cle);
const signes = t => signesDuTexte(t).map(s => s.id);

/* ------------------------------ P3 : fumer ------------------------------ */

test('« j’ai un peu / beaucoup fumé », « je fume pas mal » comptent', () => {
  for (const t of ["j'ai un peu fumé puis rangé la cuisine", "j'ai beaucoup fumé après le dîner.",
                   'je fume pas mal en ce moment', 'je suis en train de fumer sur le balcon'])
    assert.deepEqual(cles(t), ['fume'], t);
});

test('« j’ai déjà fumé » raconte une expérience, pas un soir', () => {
  assert.deepEqual(cles("j'ai déjà fumé une fois au lycée"), []);
  assert.deepEqual(cles("j'ai déjà fumé, c'était pas pour moi"), []);
  assert.deepEqual(cles('je fume pas, merci'), [], 'la négation reste une négation');
});

test('« 4 joints » : un chiffre devant le joint est un compte', () => {
  const r = prisesDuTexte('4 joints dans la soirée', [], 2026);
  assert.ok(r.has('cannabis'));
  assert.equal(r.get('cannabis').combien, 4);
});

test('treize journées dont trois « j’ai beaucoup fumé » : aucune série sans de sept jours', () => {
  const rows = Array.from({ length: 13 }, (_, i) => ({ date: J(i), note: 5,
    text: [1, 7, 12].includes(i) ? "j'ai beaucoup fumé ce soir." : 'journée de travail, rien de spécial.' }));
  const r = analyserPrises(rows, { aujourdhui: J(12) });
  assert.ok(r.prises.length, 'les trois soirs ne sont pas comptés');
  for (const p of r.prises) {
    assert.equal(p.series.filter(s => !s.maigre && s.jours >= 7).length, 0,
      `${p.cle} : ${JSON.stringify(p.series)}`);
    assert.equal(p.plus_longue, 0);
  }
});

/* ------------------------------ P3 : cachets ----------------------------- */

test('« anxio(s) » se compte, avec le nombre écrit', () => {
  const a = prisesDuTexte('là je viens de prendre 7 anxios', [], 2026);
  assert.equal(a.get('calmants')?.combien, 7);
  const b = prisesDuTexte("j'ai pris deux anxios en rentrant", [], 2026);
  assert.equal(b.get('calmants')?.combien, 2);
  assert.equal(prisesDuTexte('6 seresta ce soir', [], 2026).get('calmants')?.combien, 6);
});

test('nommer un cachet, ou en avoir envie, n’est pas en prendre', () => {
  for (const t of ["j'aurais bien envie d'avaler plein de lexomil",
                   'envie de prendre 3 anxios ce soir',
                   '1 anxio le soir, mon traitement comme prévu',
                   'je dois prendre rendez-vous pour le seresta',
                   'faut que je rachète des anxios',
                   // Le stock, l'ordonnance, la consigne : des cachets qu'on n'a pas pris.
                   'il me reste 3 anxios dans la boîte', "j'ai racheté une boîte de 30 anxios",
                   'je dois prendre 2 anxios chaque soir', 'ma psy veut que je passe à 1 xanax',
                   'je prends rendez-vous pour le seresta'])
    assert.deepEqual(cles(t), [], t);
  // Et le stock ne se lit pas comme la dose, à côté d'une vraie prise.
  assert.equal(prisesDuTexte("j'ai pris 2 anxios, il me reste 3 anxios", [], 2026).get('calmants')?.combien, 2);
});

test('un suivi « anxio » en traitement : une seule ligne, sans record', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ date: J(i), note: 5,
    text: i % 3 ? 'journée calme.' : "j'ai pris deux anxios ce soir." }));
  const suivis = [{ cle: 'sien:anxio', nom: 'mon anxio', mots: 'anxio', genre: 'traitement', actif: 1 }];
  const r = analyserPrises(rows, { aujourdhui: J(39), suivis });
  assert.deepEqual(r.prises.map(p => p.cle), ['sien:anxio'], 'deux lignes pour les mêmes jours');
  assert.equal(r.prises[0].plus_longue, 0);
  assert.deepEqual(r.prises[0].series, []);
});

test('un suivi « somnifère » ne tait que ses mots : le reste des calmants se compte', () => {
  const som = [familleDuSuivi({ cle: 'sien:somn', nom: 'mon somnifère', mots: 'somnifère', genre: 'traitement', actif: 1 })];
  const k = t => [...prisesDuTexte(t, som, 2026).keys()].sort();
  for (const t of ["j'ai pris de l'héroïne", "j'ai pris 4 xanax", "j'ai pris du tramadol en plus"])
    assert.deepEqual(k(t), ['calmants'], t);
  assert.equal(prisesDuTexte("j'ai pris 4 xanax", som, 2026).get('calmants').combien, 4);
  assert.deepEqual(k("j'ai pris deux somnifères"), ['sien:somn'], 'le suivi seul, pas deux lignes');
  assert.deepEqual(k("j'ai pris un somnifère et 2 xanax"), ['calmants', 'sien:somn']);
  // Dans le moteur : la ligne du suivi ET celle des calmants, chacune ses jours.
  const rows = Array.from({ length: 30 }, (_, i) => ({ date: J(i), note: 5,
    text: i % 5 === 0 ? "j'ai pris deux somnifères." : i % 5 === 2 ? "j'ai pris 3 xanax." : 'journée calme.' }));
  const r = analyserPrises(rows, { aujourdhui: J(29),
    suivis: [{ cle: 'sien:somn', nom: 'mon somnifère', mots: 'somnifère', genre: 'traitement', actif: 1 }] });
  assert.equal(r.prises.find(p => p.cle === 'calmants')?.n, 6);
  assert.equal(r.prises.find(p => p.cle === 'sien:somn')?.n, 6);
});

test('sans suivi, les calmants se comptent sans record ni pente', () => {
  const rows = Array.from({ length: 70 }, (_, i) => ({ date: J(i), note: 5,
    text: (i > 20 && i < 40) ? 'journée calme.' : "j'ai pris deux anxios ce soir." }));
  const c = analyserPrises(rows, { aujourdhui: J(69) }).prises.find(p => p.cle === 'calmants');
  assert.ok(c, 'les jours ne sont plus comptés');
  assert.deepEqual(c.series, []);
  assert.equal(c.compare, false);
  assert.equal(c.pente_p, null);
  assert.equal(c.combien_par_jour[J(0)], 2, 'le combien reste dit');
  // Un suivi « calmants » explicite en « réduire » rend le record.
  const r = analyserPrises(rows, { aujourdhui: J(69),
    suivis: [{ cle: 'calmants', nom: 'les calmants', genre: 'reduire', actif: 1 }] });
  assert.ok(r.prises.find(p => p.cle === 'calmants').plus_longue > 0);
  // Et « j'ai craqué » seul ne leur est pas rattaché : c'est peut-être une ordonnance.
  const nus = Array.from({ length: 30 }, (_, i) => ({ date: J(i), note: 5,
    text: i % 6 === 0 ? "j'ai pris deux anxios ce soir." : i === 9 ? "j'ai craqué." : 'journée calme.' }));
  const c2 = analyserPrises(nus, { aujourdhui: J(29) }).prises.find(p => p.cle === 'calmants');
  assert.ok(c2);
  assert.ok(!c2.signes.some(s => s.rattache === 'recent'), JSON.stringify(c2.signes));
});

/* --------------------------- P9 : projet, souvenir -------------------------- */

test('un projet ou une envie n’est pas une prise, même avec un nombre', () => {
  for (const t of ['demain midi on ira boire un verre avec Paul',
                   'samedi on va boire trois bières, ça va être cool',
                   'en 2019 je devais boire de la vodka pour sortir',
                   "j'ai envie de boire une bière", "j'ai envie d'un joint",
                   'en mars 2024 je prenais deux xanax le soir',
                   'fumer deux joints au parc, ça va être top'])
    assert.deepEqual(cles(t), [], t);
});

test('ce qui est fait reste fait, même à côté d’un projet', () => {
  const r = prisesDuTexte("j'ai bu trois verres, ça va être dur demain", [], 2026);
  assert.equal(r.get('alcool')?.combien, 3);
  assert.deepEqual(cles("j'ai fumé, demain je bosse"), ['fume']);
  assert.deepEqual(cles("j'aimerais arrêter mais j'ai fumé deux joints"), ['cannabis']);
  assert.deepEqual(cles("je devais prendre qu'un verre et j'en ai pris quatre"), ['alcool']);
  assert.deepEqual(cles("je viens de boire deux bières, demain je bosse"), ['alcool']);
  // Le présent, « on a », le participe nu, et un « demain » ou une envie qui
  // parlent d'autre chose, de l'autre côté de la virgule.
  for (const [t, c] of [["je suis complètement bourré, demain je bosse", 'alcool'],
                        ["on a bu cinq bières, demain c'est repos", 'alcool'],
                        ['on a fumé trois joints, ça va être dur demain', 'cannabis'],
                        ['là je bois ma quatrième bière, demain je bosse', 'alcool'],
                        ['quatre bières ce soir, demain je me lève tôt', 'alcool'],
                        ["pris 3 xanax ce soir, j'aimerais dormir", 'calmants'],
                        ['avalé deux lexomil, demain rendez-vous', 'calmants'],
                        ['6 anxios avalés, envie de dormir', 'calmants'],
                        ['envie de rien, trois joints dans la soirée', 'cannabis']])
    assert.deepEqual(cles(t), [c], t);
  // Mais un « demain » seul devant la virgule reste le projet de ce qui suit.
  assert.deepEqual(cles('demain, trois bières avec Paul'), []);
  assert.deepEqual(cles('demain je bois un verre avec Paul'), []);
});

test('une année nommée n’est un souvenir que si elle est passée', () => {
  assert.deepEqual(cles("en 2026 j'ai bu trois bières", 2026), ['alcool']);
  assert.deepEqual(cles("en 2026 j'ai bu trois bières", 2027), []);
  // Et dans le moteur, l'année vient de l'entrée.
  const rows = [0, 3, 6].map(i => ({ date: J(i), note: 5, text: "en 2026 j'ai bu trois bières" }));
  assert.ok(analyserPrises(rows, { aujourdhui: J(6) }).prises.some(p => p.cle === 'alcool'));
});

test('une fraction n’est pas un compte, un ordinal détaché non plus', () => {
  const a = fam('alcool').mots;
  assert.notEqual(combienDit(norm('un cocktail avec 1/3 de verre de gin'), a), 3);
  assert.notEqual(combienDit(norm('un mojito avec 1/4 de verre de vodka'), a), 4);
  assert.equal(combienDit(norm('trois verres de vin'), a), 3);
  assert.equal(combienDit(norm('un troisième verre'), a), 3);
  assert.equal(combienDit(norm("c'est la troisième semaine xanax"), fam('calmants').mots), null);
});

/* ------------------------------ P9 : signes ------------------------------ */

test('les signes ne s’allument plus sur ce qui ne parle pas de consommation', () => {
  for (const t of ['je voulais juste te le dire', 'le manque de sommeil me pèse',
                   "j'ai arrêté d'aller à la salle de sport",
                   'obsédé par le fait de rater mes examens', 'envie de prendre de la distance'])
    assert.deepEqual(signes(t), [], t);
});

test('et restent allumés sur ce qui en parle', () => {
  for (const t of ["j'ai arrêté de picoler", "j'ai arrêté d'en prendre", "j'ai arrêté de me droguer",
                   "dès que j'arrête la beuh", "j'ai arrêté.", "j'ai arrêté la clope",
                   "j'ai arrêté depuis cinq jours", "j'ai arrêté il y a une semaine",
                   "j'ai arrêté complètement", "j'ai arrêté la picole"])
    assert.ok(signes(t).includes('arreter'), t);
  for (const t of ['le manque me tue', "j'ai envie de prendre un verre", 'envie de refumer ce soir',
                   'obsédé par la weed', 'le manque de clope', 'le manque se fait sentir',
                   'le manque physique est horrible', 'envie de prendre de la md',
                   'envie de prendre un lexomil', 'envie de prendre des somnifères'])
    assert.ok(signes(t).includes('manque'), t);
  assert.ok(signes('je voulais juste un verre, j’en ai bu cinq').includes('plus_que_prevu'));
  assert.ok(signes("je voulais juste boire un verre, j'en ai bu six").includes('plus_que_prevu'));
  assert.deepEqual(signes("je voulais juste boire de l'eau"), []);
});

test('une envie qui nomme les cachets n’est pas citée sous le cannabis', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ date: J(i), note: 5,
    text: i % 4 === 0 ? "j'ai fumé un joint." : i === 9 ? "grosse envie de prendre des xanax." : 'journée calme.' }));
  const c = analyserPrises(rows, { aujourdhui: J(19) }).prises.find(p => p.cle === 'cannabis');
  assert.ok(c);
  assert.ok(!c.signes.some(s => /xanax/.test(s.phrase)), JSON.stringify(c.signes));
});

/* ------------------------------ P9 : la flèche ----------------------------- */

test('quatorze notes sur 400 jours contre trente journées d’affilée : on ne compare pas', () => {
  const rows = [];
  for (let k = 0; k < 14; k++) rows.push({ date: J(k * 30), note: 5, text: 'une note courte.' });
  for (let k = 0; k < 30; k++) rows.push({ date: J(420 + k), note: 5,
    text: (k % 4 === 0 ? "j'ai bu deux bières. " : '') + 'une longue conversation du soir. '.repeat(20) });
  rows[3].text = "j'ai bu deux bières.";
  const a = analyserPrises(rows, { aujourdhui: J(449) }).prises.find(p => p.cle === 'alcool');
  assert.ok(a);
  assert.equal(a.compare, false);
  assert.equal(a.pente_p, null);
});

test('même rythme, textes dix fois plus longs : on ne compare pas', () => {
  const fenetres = long => Array.from({ length: 60 }, (_, i) => ({ date: J(i), note: 5,
    text: (i % 4 === 0 ? "j'ai bu deux bières. " : '') + 'une note.'
      + (i >= 30 && long ? ' une longue page du soir.'.repeat(10) : '') }));
  const a = analyserPrises(fenetres(true), { aujourdhui: J(59) }).prises.find(p => p.cle === 'alcool');
  assert.equal(a.compare, false);
  assert.equal(a.pente_p, null);
  const b = analyserPrises(fenetres(false), { aujourdhui: J(59) }).prises.find(p => p.cle === 'alcool');
  assert.equal(b.compare, true);
  assert.equal(typeof b.pente_p, 'number');
});

test('trente et trente journées, un jour sur douze irrégulier : on compare', () => {
  const ecarts = [12, 5, 19, 8, 14, 11, 16, 7, 13, 10, 22, 9, 12, 6, 15];
  const rows = [];
  let d = 0;
  for (let k = 0; k < 60; k++) {
    rows.push({ date: J(d), note: 5, text: (k % 5 === 0 ? "j'ai bu deux bières. " : '') + 'une note du jour.' });
    d += ecarts[k % ecarts.length];
  }
  const a = analyserPrises(rows, { aujourdhui: rows.at(-1).date }).prises.find(p => p.cle === 'alcool');
  assert.equal(a.compare, true);
  assert.equal(typeof a.pente_p, 'number');
});

test('8 sur 30 contre 1 sur 14 : pas de flèche, pas de fractions au compagnon', () => {
  const rows = Array.from({ length: 44 }, (_, i) => ({ date: J(i), note: 5,
    text: (i === 3 || (i >= 14 && (i - 14) % 4 === 0)) ? "j'ai bu deux bières." : 'une note du jour.' }));
  const a = analyserPrises(rows, { aujourdhui: J(43) }).prises.find(p => p.cle === 'alcool');
  assert.equal(a.recent, 8); assert.equal(a.avant, 1); assert.equal(a.avant_sur, 14);
  assert.equal(a.compare, true, 'les deux fenêtres sont écrites pareil');
  assert.ok(a.pente_p >= 0.05, `p = ${a.pente_p}`);
  const b = prisesBlock({ prises: [a] });
  assert.ok(!/sur ses \d+ dernières/.test(b), 'le compagnon reçoit une montée que le test ne tient pas');
});

test('« cannabis quotidien » : les semaines muettes d’après sont inconnues, pas 0', () => {
  const rows = [];
  for (let i = 0; i < 70; i += 2) rows.push({ date: J(i), note: 5,
    text: i < 14 || i > 56 ? "j'ai fumé un joint." : 'journée de travail.' });
  const sans = analyserPrises(rows, { aujourdhui: J(69) }).prises.find(p => p.cle === 'cannabis');
  const avec = analyserPrises(rows, { aujourdhui: J(69),
    reperes: [{ date: J(20), label: 'début du cannabis quotidien' }] }).prises.find(p => p.cle === 'cannabis');
  const zeros = sans.par_semaine.filter(x => x === 0).length;
  assert.ok(zeros >= 3, `le décor n’a pas de semaine muette : ${sans.par_semaine}`);
  assert.ok(avec.par_semaine.filter(x => x === 0).length < zeros, `${avec.par_semaine}`);
  // Avant le repère, une semaine muette reste 0 ; et un repère d'arrêt ferme la période.
  const ferme = analyserPrises(rows, { aujourdhui: J(69), reperes: [
    { date: J(20), label: 'début du cannabis quotidien' },
    { date: J(35), label: 'arrêt du cannabis' }] }).prises.find(p => p.cle === 'cannabis');
  assert.ok(ferme.par_semaine.filter(x => x === 0).length > avec.par_semaine.filter(x => x === 0).length,
    `${ferme.par_semaine}`);
});
