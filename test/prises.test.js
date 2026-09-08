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
    /* Les tournures que le dossier d'une personne employait, et que le
       moteur manquait : douze sur vingt et une. La reprise nommée d'abord —
       c'est le jour qui compte le plus, et « repris » n'existait que chez les
       stimulants. */
    ["reprise de la weed", 'cannabis'],
    ["j'ai repris la weed", 'cannabis'],
    ["j'ai rechuté sur la weed", 'cannabis'],
    ["j'ai repris la clope", 'tabac'],
    ["j'ai replongé dans le vin", 'alcool'],
    ["je suis retombée dans la coke", 'stimulants'],
    ["j'ai fumé un pét", 'cannabis'],
    ["de la beuh ce soir", 'cannabis'],
    ["j'ai fumé un joint", 'cannabis'],
    ["j'ai tiré sur le joint", 'cannabis'],
    ["je me suis fumé un joint", 'cannabis'],
    ["j'ai fait un bang", 'cannabis'],
    ["j'ai vapé de la weed", 'cannabis'],
    ["quelques lattes sur le joint", 'cannabis'],
    ["j'ai pris de la md", 'stimulants'],
    ["j'ai bu", 'alcool'],
    ["un verre avec des potes", 'alcool'],
    ["quelques bières", 'alcool'],
    ["j'ai picolé", 'alcool'],
    ["j'ai fumé une clope", 'tabac'],
    ["j'ai vapoté toute la journée", 'tabac'],
    /* Le verbe de fumée sans objet : ni cannabis ni tabac tant que le texte
       ne dit pas quoi. C'est le dossier entier qui tranche, plus bas. */
    ["j'ai refumé", 'fume'],
    ["j'ai fumé hier soir", 'fume'],
    ["on a fumé avec des potes", 'fume'],
    ["quelques lattes", 'fume'],
    ["j'ai fumé, comme tous les soirs en ce moment.", 'fume'],
  ];
  for (const [t, attendu] of vrais)
    assert.ok(cles(t).includes(attendu), `« ${t} » → ${cles(t)} (attendu ${attendu})`);
});

test('« fumé un joint » est un joint, pas aussi « fumé, sans dire quoi »', () => {
  assert.deepEqual(cles("j'ai fumé un joint"), ['cannabis']);
  assert.deepEqual(cles("j'ai fumé une clope"), ['tabac']);
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
    /* Les pièges qu'appellent la fumée nue et la reprise : sans eux, la
       prochaine correction de vocabulaire casserait une garde sans que
       personne le voie. */
    "j'ai fumé une côte de bœuf",                   // la cuisine
    "j'ai mangé du saumon fumé",
    "j'ai fumé au barbecue un magret",
    "j'ai fumé de rage",                            // la colère
    "j'ai roulé deux heures pour rentrer",          // les verbes de fumée, sans rien à fumer
    "j'ai tiré la chasse",
    "j'ai grillé un feu rouge",
    "j'ai pris un latte au café",
    "ça a fait un bang énorme",
    "j'ai repris le sport",                         // la reprise de tout le reste
    "j'ai repris le boulot lundi",
    "reprise du travail demain",
    "reprise des cours, une journée longue",
    "j'ai repris confiance",
    "j'ai repris mon traitement",
    "je suis retombé sur mes pieds",
    "je suis retombé sur une vieille bouteille de vin",
    "j'ai craqué et j'ai pleuré",
    "j'ai craqué pour cette robe",
    "j'ai remis le couvert au boulot",
    "mon pote a refumé",                            // ce n'est pas la personne
    "mon frère a fumé",
    "j'ai vu mon pote qui a fumé",
    "la reprise de la weed de mon frère",           // le possessif APRÈS le nom
    "je veux arrêter la picole",                    // le nom de la picole n'est pas le verbe
    "j'ai arrêté la picole",
    "ma vape est cassée",                           // l'objet, pas le geste
    "j'ai envie de fumer",                          // l'intention
    "je vais fumer ce soir",
    "je fume pas",
  ];
  for (const t of pieges)
    assert.deepEqual(cles(t), [], `« ${t} » ne devrait rien déclencher, a donné ${cles(t)}`);
});

test('le possessif après le nom est un tiers, sauf si la personne s’y met', () => {
  assert.deepEqual(cles("la reprise de la weed de mon frère"), []);
  assert.ok(!signesDuTexte("la reprise de la weed de mon frère").some(s => s.id === 'craque'),
    'la reprise de son frère n’est pas la sienne');
  assert.deepEqual(cles("j'ai fumé la weed de mon frère"), ['cannabis']);
});

test('la reprise nue est un signe, pas un jour — et bornée', () => {
  for (const t of ["j'ai repris", "je suis retombé dedans", "j'ai refumé", "j'ai replongé, après tout ce temps.",
                   "reprise de la weed", "j'ai repris la clope"]) {
    assert.ok(signesDuTexte(t).some(s => s.id === 'craque'), `« ${t} » devrait allumer la reprise`);
  }
  /* « j'ai repris le sport » devenait « tu as craqué après avoir tenu » dès
     qu'il tombait à côté d'un jour d'alcool. */
  for (const t of ["j'ai repris le sport", "j'ai repris le boulot", "j'ai repris confiance", "j'ai repris mon traitement",
                   "reprise du travail", "je suis retombé sur mes pieds", "j'ai craqué et j'ai pleuré", "j'ai craqué pour cette robe"]) {
    assert.ok(!signesDuTexte(t).some(s => s.id === 'craque'), `« ${t} » ne parle pas d’une reprise`);
  }
  assert.deepEqual(cles("j'ai repris"), [], 'sans nom, ce n’est pas un jour d’une famille');
});

test('les mots lus sont rendus, pour que la vue dise « md » plutôt que « les stimulants »', () => {
  assert.deepEqual(prisesDuTexte("j'ai pris de la md samedi").get('stimulants').lus, ['md']);
  const fond = Array.from({ length: 30 }, (_, i) => ({ date: J(i + 10), note: 6, text: 'journée ordinaire' }));
  const avec = [0, 1, 2].map(i => ({ date: J(i), note: 4, text: i ? "j'ai pris de la md" : "j'ai tapé de la coke et de la md" }));
  const r = analyserPrises([...avec, ...fond], { aujourdhui: J(40) });
  assert.deepEqual(r.prises[0].lus, ['md', 'coke']);
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
  /* « craqué » et « caché » sont des verdicts sur l'acte ; « habitude »,
     « suivi », « surveillé » disent ce qu'on fait de la personne. Ils passaient
     sous le radar du premier regex, qui ne bloquait que les étiquettes
     cliniques. */
  const interdit = /addict|alcoolo|alcooliqu|toxico|dépendan|drogué|malade|accro|craqu|cach|habitude|suivi|surveill/i;
  for (const f of FAMILLES) assert.ok(!interdit.test(f.nom), f.nom);
  for (const s of SIGNES) assert.ok(!interdit.test(s.dit), s.dit);
  const deux = [0, 1].map(i => ({ date: J(i), note: 5, text: "j'ai bu trois bières" }));
  const fond = Array.from({ length: 20 }, (_, i) => ({ date: J(i + 5), note: 6, text: 'rien' }));
  for (const e of analyserPrises([...deux, ...fond], { aujourdhui: J(24) }).ecartees)
    assert.ok(!interdit.test(e.pourquoi), e.pourquoi);
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
  assert.match(r.ecartees[0].pourquoi, /écrit 2 jours — il en faut 3/);
});

/* --------------------------- la fumée nue et la reprise --------------------------- */

/** Le dossier de la personne : quatre soirs d'alcool nommés, le cannabis
    écrit comme on l'écrit vraiment — « j'ai fumé », sans le nom — un seul
    « pét », et « j'ai repris. » tout seul, loin de tout. */
function dossierFumee({ pet = true, clope = false } = {}) {
  const rows = [];
  for (let i = 0; i < 60; i += 2) rows.push({ date: J(i), note: 6, text: 'journée ordinaire.' });
  const dire = (i, t, note = 4) => { const r = rows.find(r => r.date === J(i)); r.text = t; r.note = note; };
  dire(4, "j'ai bu quatre bières."); dire(14, "j'ai encore bu."); dire(24, "un verre avec des potes."); dire(40, "j'ai bu.");
  dire(8, "j'ai fumé hier soir."); dire(18, "j'ai refumé, c'est reparti."); dire(28, "on a fumé avec des potes.");
  if (pet) dire(30, "j'ai fumé un pét.");
  if (clope) dire(36, "j'ai fumé une clope.");
  dire(50, "j'ai repris.");
  return rows;
}

test('« j’ai fumé » va au cannabis quand le dossier ne nomme que lui', () => {
  /* Avant : cannabis « vu 1 fois » (la seule ligne avec « pét »), écarté, et
     quatre soirs écrits perdus. */
  const r = analyserPrises(dossierFumee(), { aujourdhui: J(58) });
  const c = r.prises.find(p => p.cle === 'cannabis');
  assert.ok(c, `le cannabis devrait ressortir : ${JSON.stringify(r.prises.map(p => [p.cle, p.n]))}`);
  assert.ok(c.n >= 3 && c.n === 4, `4 jours attendus, ${c.n}`);
  assert.equal(c.dont_fume, 3, 'et le compte des jours versés est rendu, pour que la vue le dise');
  assert.ok(!r.prises.some(p => p.cle === 'fume') && !r.ecartees.some(e => e.cle === 'fume'),
    'la fumée nue ne reste pas une famille à part quand elle a été versée');
});

test('quand le dossier nomme le cannabis ET le tabac, « fumé » reste « sans dire quoi »', () => {
  const r = analyserPrises(dossierFumee({ clope: true }), { aujourdhui: J(58) });
  const nue = r.prises.find(p => p.cle === 'fume');
  assert.ok(nue, `on ne devine pas : ${JSON.stringify(r.prises.map(p => [p.cle, p.n]))}`);
  assert.equal(nue.n, 3);
  assert.match(nue.nom, /sans dire quoi/);
  assert.equal(r.ecartees.find(e => e.cle === 'cannabis')?.n, 1, 'le « pét » seul reste en dessous du seuil');
});

test('quand rien n’est nommé, « fumé » compte sous son propre nom', () => {
  const r = analyserPrises(dossierFumee({ pet: false }), { aujourdhui: J(58) });
  assert.ok(r.prises.some(p => p.cle === 'fume' && p.n === 3));
  assert.ok(!r.prises.some(p => p.cle === 'cannabis') && !r.prises.some(p => p.cle === 'tabac'));
});

test('un repère « reprise de la weed » est lu : un jour de cannabis, et la reprise', () => {
  /* La seule mention explicite du cannabis de la personne était un repère,
     dans une table que le moteur n'ouvrait pas. */
  const rows = dossierFumee({ pet: false });
  const sans = analyserPrises(rows, { aujourdhui: J(58) });
  assert.ok(!sans.prises.some(p => p.cle === 'cannabis'), 'sans le repère, rien ne nomme le cannabis');
  const r = analyserPrises(rows, { aujourdhui: J(58),
    reperes: [{ date: J(20), label: 'reprise de la weed', theme: 'conso', ouvert: 1 },
              { date: J(2), label: 'arrêt de l’alcool', theme: 'conso' },
              { date: J(10), label: 'déménagement', theme: 'maison' }] });
  const c = r.prises.find(p => p.cle === 'cannabis');
  assert.ok(c, `le repère devrait faire exister le cannabis : ${JSON.stringify(r.prises.map(p => [p.cle, p.n]))}`);
  assert.equal(c.n, 4, 'trois jours « fumé » versés, plus le repère à sa date');
  assert.equal(c.dont_fume, 3);
  assert.equal(c.dont_reperes, 1);
  assert.ok(c.jours.includes(J(20)));
  assert.equal(c.preuve, "on a fumé avec des potes.", 'la preuve reste la dernière phrase écrite');
  assert.ok(c.signes.some(s => s.id === 'craque' && s.phrase === 'reprise de la weed' && s.quand === J(20)),
    `le libellé du repère est la phrase du signe : ${JSON.stringify(c.signes)}`);
  const a = r.prises.find(p => p.cle === 'alcool');
  assert.ok(!a.jours.includes(J(2)), 'un repère qui dit l’arrêt n’est pas un jour d’alcool');
});

test('un repère hors des journées écrites compte pour la famille, sans casser les séries', () => {
  const rows = dossierFumee();
  const r = analyserPrises(rows, { aujourdhui: J(58),
    reperes: [{ date: J(3), label: 'j’ai fumé un joint', theme: 'conso' }] });
  const c = r.prises.find(p => p.cle === 'cannabis');
  assert.ok(c.jours.includes(J(3)));
  assert.equal(c.n, 5);
  assert.ok(c.series.every(s => s.jours > 0));
});

test('un objectif « arrêter la cigarette » est le signe « vouloir arrêter », rattaché au tabac', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ date: J(i), note: 6, text: 'journée ordinaire' });
  for (const i of [40, 45, 50]) rows[i] = { date: J(i), note: 5, text: "j'ai fumé un paquet de clopes" };
  const r = analyserPrises(rows, { aujourdhui: J(59),
    objectifs: [{ quoi: 'arrêter la cigarette', genre: 'conso', cree_le: J(2) + 'T10:00:00.000Z', depuis: J(2), tenu: 1, reprises: 0 }] });
  const t = r.prises.find(p => p.cle === 'tabac');
  const s = t.signes.find(s => s.id === 'arreter');
  assert.ok(s, `l’objectif, posé loin des jours comptés, nomme la cigarette : ${JSON.stringify(t.signes)}`);
  assert.equal(s.phrase, 'arrêter la cigarette');
  assert.equal(s.quand, J(2));
  assert.equal(s.rattache, 'nomme', 'et on dit pourquoi il est là');
});

test('le signe rendu est le plus récent, pas le premier', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ date: J(i), note: 6, text: 'journée ordinaire' });
  for (const i of [10, 20, 30]) rows[i] = { date: J(i), note: 4, text: "j'ai bu quatre bières. j'ai replongé." };
  rows[31] = { date: J(31), note: 4, text: "j'ai repris la bière." };
  const a = analyserPrises(rows, { aujourdhui: J(59) }).prises.find(p => p.cle === 'alcool');
  const c = a.signes.filter(s => s.id === 'craque');
  assert.equal(c.length, 1, 'un seul par signe');
  assert.equal(c[0].quand, J(31));
});

test('« j’ai repris. » tout seul va à la famille la plus récente, et le dit', () => {
  const r = analyserPrises(dossierFumee(), { aujourdhui: J(58) });
  const a = r.prises.find(p => p.cle === 'alcool');
  const s = a.signes.find(s => s.id === 'craque');
  assert.ok(s, `l’alcool (dernier jour J40) est la famille la plus récente avant J50 : ${JSON.stringify(a.signes)}`);
  assert.equal(s.quand, J(50));
  assert.equal(s.rattache, 'recent');
  assert.ok(!a.jours.includes(J(50)), 'ce n’est pas un jour de plus — on ne sait pas de quoi');
  const c = r.prises.find(p => p.cle === 'cannabis');
  assert.ok(!c.signes.some(s => s.quand === J(50)), 'et il ne va qu’à une seule famille');
});

test('« la plus récente » se juge au dernier jour AVANT la phrase, pas au dernier jour tout court', () => {
  /* Alcool jusqu'à J40, cannabis J30-J34 puis de nouveau J56 : à J50, la
     famille la plus récente est l'alcool. Trier sur le dernier jour tout court
     aurait donné le cannabis. */
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ date: J(i), note: 6, text: 'journée ordinaire' });
  for (const i of [4, 14, 24, 40]) rows[i] = { date: J(i), note: 4, text: "j'ai bu quatre bières." };
  for (const i of [30, 32, 34, 56]) rows[i] = { date: J(i), note: 4, text: "j'ai fumé un joint." };
  rows[50] = { date: J(50), note: 4, text: "j'ai repris." };
  const r = analyserPrises(rows, { aujourdhui: J(59) });
  assert.ok(r.prises.find(p => p.cle === 'alcool').signes.some(s => s.id === 'craque' && s.quand === J(50)));
  assert.ok(!r.prises.find(p => p.cle === 'cannabis').signes.some(s => s.quand === J(50)));
});

test('la reprise nommée va à la famille nommée, même si une autre est plus récente', () => {
  const rows = dossierFumee();
  rows.find(r => r.date === J(50)).text = "j'ai repris la weed.";
  const r = analyserPrises(rows, { aujourdhui: J(58) });
  const c = r.prises.find(p => p.cle === 'cannabis');
  assert.ok(c.jours.includes(J(50)), 'nommée, c’est un jour de cannabis');
  assert.ok(c.signes.some(s => s.id === 'craque' && s.quand === J(50)));
  assert.ok(!r.prises.find(p => p.cle === 'alcool').signes.some(s => s.quand === J(50)));
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

test('une série coupée par un long silence ne devient pas un record', () => {
  /* Le cas trouvé sur dossier : 124 jours « sans », dont soixante où le journal
     n'a pas été ouvert une seule fois. La densité moyenne ne le voyait pas —
     elle se laissait remplir par les deux bouts. */
  const ecrits = [];
  for (let i = 0; i < 20; i++) ecrits.push(J(i));          // un mois écrit
  for (let i = 90; i < 120; i++) ecrits.push(J(i));        // puis, après deux mois de rien
  const rows = ecrits.map(d => ({ date: d, note: 6,
    text: [J(0), J(1), J(2), J(118), J(119)].includes(d) ? "j'ai bu quatre bières" : 'journée ordinaire' }));
  const a = analyserPrises(rows, { aujourdhui: J(119) }).prises.find(p => p.cle === 'alcool');
  const longue = a.series.reduce((m, s) => s.jours > m.jours ? s : m, a.series[0]);
  assert.ok(longue.trou >= 60, `le silence devrait être mesuré, trou = ${longue.trou}`);
  assert.equal(longue.maigre, true, 'une série traversée par deux mois de silence est marquée');
  assert.ok(a.plus_longue < longue.jours, 'et elle ne peut pas devenir le record');
});

test('la comparaison s’affiche pour qui écrit peu', () => {
  /* Le vrai cas d'usage : un journal ouvert un jour sur douze. Il fallait
     soixante journées écrites pour comparer deux fenêtres de trente ; ce
     lecteur-là n'y arrivait jamais, et la seule ligne qui dit le SENS ne
     s'affichait donc jamais pour lui. */
  const rows = [];
  for (let i = 0; i < 480; i += 12)
    rows.push({ date: J(i), note: 6, text: i >= 300 ? "j'ai bu quatre bières" : 'journée ordinaire' });
  const r = analyserPrises(rows, { aujourdhui: J(468) });
  const a = r.prises.find(p => p.cle === 'alcool');
  assert.ok(a, 'l’alcool ressort');
  assert.equal(a.compare, true, `40 journées écrites : la comparaison doit s’afficher (avant_sur = ${a.avant_sur})`);
  assert.ok(a.avant_sur > 0 && a.recent_sur > 0, 'les deux tailles sont rendues, pour que la vue dise « sur combien »');
  assert.ok(a.recent / a.recent_sur > a.avant / a.avant_sur, 'et la montée se voit');
});

test('un journal ouvert un jour sur douze parle d’écarts, pas de séries sans', () => {
  /* Trouvé sur dossier : avec une entrée tous les treize jours, chaque série
     était marquée maigre, le record tombait à zéro, et le panneau affichait
     onze barres en pointillés sans rien en dire. Honnête et inutile.
     L'intervalle entre deux occurrences, lui, se mesure quoi qu'il arrive :
     ses deux bornes sont écrites. */
  const rows = [];
  for (let i = 0; i < 480; i += 13)
    rows.push({ date: J(i), note: 6, text: i % 39 === 0 ? "j'ai bu quatre bières" : 'journée ordinaire' });
  const a = analyserPrises(rows, { aujourdhui: J(475) }).prises.find(p => p.cle === 'alcool');
  assert.equal(a.lecture, 'ecarts');
  assert.equal(a.plus_longue, 0, 'aucune abstinence ne peut être revendiquée');
  assert.ok(a.plus_long_ecart >= 26, `l’écart, lui, se mesure : ${a.plus_long_ecart}`);
});

test('un journal tenu garde la lecture « séries sans »', () => {
  const rows = [];
  for (let i = 0; i < 200; i++)
    rows.push({ date: J(i), note: 6, text: i % 40 === 0 ? "j'ai bu quatre bières" : 'journée ordinaire' });
  const a = analyserPrises(rows, { aujourdhui: J(199) }).prises.find(p => p.cle === 'alcool');
  assert.equal(a.lecture, 'series');
  assert.ok(a.plus_longue >= 39, `la plus longue série : ${a.plus_longue}`);
});

test('la lecture gardée par texte ne confond pas deux textes', () => {
  /* La détection est mémorisée par texte, parce qu'elle est refaite à chaque
     message envoyé. Une clé trop lâche (la date, la longueur seule) ferait
     rendre la lecture d'hier pour le texte d'aujourd'hui — et ça ne se verrait
     jamais, parce que les deux réponses ont exactement la même forme. */
  const fond = Array.from({ length: 30 }, (_, i) => ({ date: J(i + 10), note: 6, text: 'journée ordinaire' }));
  const avec = [{ date: J(0), note: 4, text: "j'ai bu quatre bières" },
                { date: J(1), note: 4, text: "j'ai bu quatre bières" },
                { date: J(2), note: 4, text: "j'ai bu quatre bières" }];
  assert.equal(analyserPrises([...avec, ...fond], { aujourdhui: J(40) }).prises[0].n, 3);

  // mêmes dates, textes de MÊME LONGUEUR mais sans rien dedans
  const sans = avec.map(e => ({ ...e, text: 'un texte de longueur egale ' }));
  assert.deepEqual(analyserPrises([...sans, ...fond], { aujourdhui: J(40) }).prises, [],
    'la lecture du texte précédent a été rendue pour un autre texte');

  // et l'inverse : rechanger le texte fait revenir la détection
  assert.equal(analyserPrises([...avec, ...fond], { aujourdhui: J(40) }).prises[0].n, 3);
});

test('un signe qui nomme une autre famille ne lui est pas attribué', () => {
  /* Vu à l'écran : la carte du cannabis citait « trois verres de vin ». Les
     signes sont volontairement aveugles à la famille — « j'ai craqué » ne dit
     pas de quoi — mais une preuve qui parle visiblement d'autre chose ruine la
     confiance qu'on a dans toutes les autres. */
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ date: J(i), note: 6, text: 'journée ordinaire' });
  for (const i of [10, 20, 30]) {
    rows[i] = { date: J(i), note: 4,
      text: "j'ai fumé un joint. j'ai bu trois verres de vin, je voulais juste en prendre un." };
  }
  const r = analyserPrises(rows, { aujourdhui: J(59) });
  const alcool = r.prises.find(p => p.cle === 'alcool');
  const cannabis = r.prises.find(p => p.cle === 'cannabis');
  assert.ok(alcool.signes.some(s => /verres de vin/.test(s.phrase)),
    'la phrase revient bien à l’alcool, qu’elle nomme');
  assert.ok(!cannabis.signes.some(s => /verres de vin/.test(s.phrase)),
    `le cannabis cite une phrase d’alcool : ${JSON.stringify(cannabis.signes)}`);
});

test('un signe muet sur la famille reste partagé', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) rows.push({ date: J(i), note: 6, text: 'journée ordinaire' });
  for (const i of [10, 20, 30]) rows[i] = { date: J(i), note: 4,
    text: "j'ai fumé un joint et j'ai bu quatre bières. j'ai craqué, je n'ai pas tenu." };
  const r = analyserPrises(rows, { aujourdhui: J(59) });
  for (const cle of ['alcool', 'cannabis'])
    assert.ok(r.prises.find(p => p.cle === cle).signes.some(s => s.id === 'craque'),
      `« j'ai craqué » ne nomme rien : il vaut pour ${cle} aussi`);
});
