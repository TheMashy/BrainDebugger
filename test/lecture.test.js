/**
 * La lecture. Ce qui est testé n'est pas ce que le modèle trouve — c'est ce que
 * le serveur refuse de laisser passer.
 *
 * Un modèle invente des dates. Une preuve datée du 12 mars qui n'existe pas
 * envoie quelqu'un sur une journée vide en lui disant qu'il y a écrit quelque
 * chose : c'est pire que pas de preuve du tout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { valider, corpusPour, choisirJours, grainPour, nomLourd, GENRES, VERSION_LECTURE,
         SEUIL_SANS_COUPE } from '../server/lecture.js';

const DATES = new Set(['2024-03-12', '2024-04-02', '2024-05-20']);
// Un thème repose sur deux journées au moins, un nœud sur trois.
const DEUX = [{ date: '2024-03-12', extrait: 'z' }, { date: '2024-04-02', extrait: 'z' }];
const TROIS = [...DATES];

/* ----------------------------- la validation ----------------------------- */

test('une date absente du corpus est retirée', () => {
  const r = valider({
    synthese: 'x',
    themes: [{
      nom: 'instabilité', quoi: 'y', intensite: 2, serie: [],
      preuves: [{ date: '2024-03-12', extrait: 'vrai' }, { date: '1999-01-01', extrait: 'inventé' },
                { date: '2024-04-02', extrait: 'vrai aussi' }]
    }]
  }, DATES);
  assert.equal(r.themes[0].preuves.length, 2);
  assert.deepEqual(r.themes[0].preuves.map(p => p.date), ['2024-03-12', '2024-04-02']);
});

test('un thème dont toutes les preuves sont inventées disparaît', () => {
  // La consigne dit qu'un thème sans ancrage ne tient pas. Une consigne qui
  // n'est pas appliquée n'est pas une règle.
  const r = valider({
    synthese: 'x',
    themes: [
      { nom: 'fantôme', quoi: 'y', intensite: 3, serie: [], preuves: [{ date: '1999-01-01', extrait: 'z' }] },
      { nom: 'réel', quoi: 'y', intensite: 1, serie: [], preuves: DEUX }
    ]
  }, DATES);
  assert.deepEqual(r.themes.map(t => t.nom), ['réel']);
});

test('un lien vers un thème retiré ne trace pas d’arête dans le vide', () => {
  const r = valider({
    synthese: 'x',
    themes: [
      { nom: 'réel', quoi: 'y', intensite: 1, serie: [], liens: ['fantôme', 'autre'],
        preuves: DEUX },
      { nom: 'autre', quoi: 'y', intensite: 1, serie: [], liens: ['réel'],
        preuves: DEUX },
      { nom: 'fantôme', quoi: 'y', intensite: 3, serie: [], preuves: [{ date: '1999-01-01', extrait: 'z' }] }
    ]
  }, DATES);
  assert.deepEqual(r.themes.find(t => t.nom === 'réel').liens, ['autre']);
});

test('un thème ne se lie pas à lui-même', () => {
  const r = valider({
    synthese: 'x',
    themes: [{ nom: 'boucle', quoi: 'y', intensite: 1, serie: [], liens: ['boucle', 'BOUCLE'],
               preuves: DEUX }]
  }, DATES);
  assert.deepEqual(r.themes[0].liens, []);
});

test('les intensités hors échelle sont ramenées dedans', () => {
  const r = valider({
    synthese: 'x',
    themes: [{ nom: 'a', quoi: 'y', intensite: 97, preuves: DEUX,
               serie: [{ periode: '2024-03', valeur: -4 }, { periode: '2024-04', valeur: 12 },
                       { periode: '', valeur: 2 }] }]
  }, DATES);
  assert.equal(r.themes[0].intensite, 3);
  assert.deepEqual(r.themes[0].serie.map(p => p.valeur), [0, 3]);   // la période vide saute
});

test('rien d’exploitable rend une lecture vide, pas une exception', () => {
  assert.deepEqual(valider(null, DATES),
    // `horizons: null` et pas absent : sans lignes de journal, le serveur ne
    // peut pas savoir si une fenêtre a de quoi parler, donc aucune ne parle.
    { synthese: '', horizons: null, themes: [], pistes: [], carte: { noeuds: [], liens: [] }, schemas: [], version: VERSION_LECTURE });
  assert.deepEqual(valider({ themes: 'pas un tableau' }, DATES).themes, []);
  assert.deepEqual(valider({ themes: [{}] }, DATES).themes, []);
});

/* -------------------------------- la carte -------------------------------- */

test('la carte n’est faite que de ce qui se relie vraiment', () => {
  const c = valider({ synthese: '', themes: [], carte: {
    noeuds: [{ nom: 'Léa', genre: 'personne', poids: 3, jours: TROIS },
             { nom: 'les nuits courtes', genre: 'corps', poids: 2, jours: TROIS },
             { nom: 'flottant', genre: 'activite', poids: 1, jours: TROIS },
             { nom: 'Léa', genre: 'personne', poids: 1, jours: TROIS }],
    liens: [{ de: 'Léa', vers: 'les nuits courtes', quoi: 'précède', force: 2 },
            { de: 'Léa', vers: 'les nuits courtes', quoi: 'redit pareil', force: 3 },
            { de: 'Léa', vers: 'fantôme', quoi: 'x', force: 1 },
            { de: 'Léa', vers: 'les nuits courtes', quoi: '', force: 1 },
            { de: 'Léa', vers: 'Léa', quoi: 'boucle', force: 1 }]
  } }, DATES).carte;
  // un doublon de nom, un nœud sans lien, un lien vers un fantôme, un lien sans
  // « comment », le MÊME sens écrit deux fois, une boucle sur soi : rien de
  // tout ça ne se dessine.
  assert.deepEqual(c.noeuds.map(n => n.nom), ['Léa', 'les nuits courtes']);
  assert.equal(c.liens.length, 1);
  assert.equal(c.liens[0].quoi, 'précède');
});

test('les DEUX SENS d’une même paire survivent : c’est le cercle', () => {
  /*
   * « les moments à plat » → c'est là que tu sers → « le vin le soir »
   * « le vin le soir » → te les rend plus lourds → « les moments à plat »
   *
   * Ce qui soulage aggrave, donc il faut recommencer. C'est le mécanisme que
   * cette application cherche, et la clé triée l'effaçait au moment précis où
   * il apparaissait — le second sens était traité comme un doublon du premier.
   * Sur le banc, le modèle l'écrit cinq fois, et les cinq fois c'est le
   * mécanisme central de la lecture.
   */
  const c = valider({ synthese: '', themes: [], carte: {
    noeuds: [{ nom: 'le vin le soir', genre: 'dependance', poids: 3, jours: TROIS },
             { nom: 'les moments à plat', genre: 'corps', poids: 2, jours: TROIS }],
    liens: [{ de: 'les moments à plat', vers: 'le vin le soir', quoi: 'c’est là que tu sers', force: 3 },
            { de: 'le vin le soir', vers: 'les moments à plat', quoi: 'te les rend plus lourds', force: 2 }]
  } }, DATES).carte;
  assert.equal(c.liens.length, 2, 'le cercle a deux sens, et les deux comptent');
  assert.deepEqual(c.liens.map(l => l.quoi),
                   ['c’est là que tu sers', 'te les rend plus lourds']);
  assert.deepEqual(c.liens.map(l => l.de), ['les moments à plat', 'le vin le soir']);
});

test('un genre inconnu retombe sur « activite » au lieu de casser le rendu', () => {
  const c = valider({ synthese: '', themes: [], carte: {
    noeuds: [{ nom: 'a', genre: 'nimportequoi', poids: 9, jours: TROIS }, { nom: 'b', genre: 'lieu', poids: -3, jours: TROIS }],
    liens: [{ de: 'a', vers: 'b', quoi: 'suit', force: 12 }]
  } }, DATES).carte;
  assert.deepEqual(c.noeuds.map(n => [n.genre, n.poids]), [['activite', 3], ['lieu', 0]]);
  assert.equal(c.liens[0].force, 3);
});

/* ------------------------------- le corpus ------------------------------- */

const jour = n => `2024-${String(Math.floor(n / 28) + 1).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`;
const ROWS = Array.from({ length: 200 }, (_, i) => ({
  date: jour(i), note: (i % 11),
  text: i % 3 === 0 ? 'x'.repeat(50 + (i % 7) * 300) : ''
}));

test('les journées transmises sont les plus fournies, remises dans l’ordre', () => {
  // Pas les N dernières : sur cinq ans elles ne disent rien de ce qui revient.
  // Pas un tirage uniforme non plus : les journées denses sont celles où il
  // s'est passé quelque chose. Mais le modèle doit lire une chronologie.
  const g = choisirJours(ROWS, 6000);
  assert.ok(g.length > 1);
  const dates = g.map(r => r.date);
  assert.deepEqual(dates, [...dates].sort(), 'les journées ne sont pas chronologiques');
  const moyenneGardee = g.reduce((a, r) => a + r.text.length, 0) / g.length;
  const ecrites = ROWS.filter(r => r.text);
  const moyenneToutes = ecrites.reduce((a, r) => a + r.text.length, 0) / ecrites.length;
  assert.ok(moyenneGardee > moyenneToutes, 'le tri par densité ne sert à rien');
});

test('le budget est respecté et une journée courte passe encore après une longue', () => {
  // `continue` et pas `break` : sinon une seule journée trop grosse ferme la
  // porte à tout ce qui suit, et le corpus s'arrête au premier pavé.
  const g = choisirJours(ROWS, 3000);
  const total = g.reduce((a, r) => a + Math.min(r.text.length, 900) + 24, 0);
  assert.ok(total <= 3000, `budget dépassé : ${total}`);
  assert.ok(g.length >= 2, 'le budget s’est arrêté au premier pavé');
});

test('le corpus prend TOUT le journal, sans fenêtre', () => {
  // Il y avait trois fenêtres — court, moyen, long. Ce qu'on cherche est ce qui
  // REVIENT ; le découper, c'est poser trois fois la même question à trois
  // morceaux de la réponse. Le budget de caractères fait déjà le tri, et il le
  // fait sur la densité des journées, ce qui est un bien meilleur critère
  // qu'une date de coupure.
  const opts = { rows: ROWS, events: [], carnet: [], motifs: [], objectifs: [] };
  const c = corpusPour(opts);
  assert.equal(c.depuis, ROWS[0].date, 'le corpus ne part pas de la première journée');
  assert.ok(c.dates.has(ROWS[0].date) || c.dates.size < ROWS.length,
    'les vieilles journées ne sont écartées que par le budget');
  assert.ok(c.etendue >= 1);
});

/*
 * LE CORPUS NE COUPAIT PLUS QUE PAR HABITUDE. Sur un vrai journal (44 journées,
 * 120 000 signes), le modèle ne recevait qu'un quart du texte, la journée la
 * plus longue à 4 %, et le budget restait rempli aux trois quarts.
 */
const phraseSynthetique = i => `journée ${i} : le matin au travail, puis la soirée chez moi à ranger. `;
const journeeDe = (i, n) => {
  let t = '';
  while (t.length < n) t += phraseSynthetique(i);
  return t.slice(0, n);
};

test('un journal de 120 000 signes part en entier, même avec une journée de 23 000', () => {
  const rows = Array.from({ length: 44 }, (_, i) => ({
    date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}`.replace('2026-08', i < 28 ? '2026-08' : '2026-09'),
    note: 6, text: journeeDe(i, i === 10 ? 23000 : 2250)
  }));
  const total = rows.reduce((a, r) => a + r.text.length, 0);
  assert.ok(total > 115000 && total < 125000, `fixture : ${total}`);
  const c = corpusPour({ rows });
  assert.equal(c.dates.size, 44);
  assert.ok(c.texte.includes(rows[10].text), 'la journée longue a été coupée');
  assert.doesNotMatch(c.texte, /signes non lus/);
  assert.match(c.texte, /Aucune n'est coupée/);
});

/*
 * AU-DESSUS DU SEUIL, PAS DE MARCHE. Le plafond commun se cherchait contre
 * l'ancien budget de 45 000 signes : à 160 100 signes, le corpus retombait d'un
 * coup au quart du texte et des journées entières disparaissaient. Ce qui part
 * vaut maintenant min(tout, seuil), et chaque journée garde sa fin.
 */
// `n` journées de longueurs inégales (de 1 à 5 parts), `total` signes en tout,
// chacune finie par sa marque FIN.
const journal = (total, n = 50, pas = 3) => {
  const parts = Array.from({ length: n }, (_, i) => 1 + (i % 5));
  const somme = parts.reduce((a, b) => a + b, 0);
  const longueurs = parts.map(p => Math.floor(total * p / somme));
  longueurs[n - 1] += total - longueurs.reduce((a, b) => a + b, 0);
  return longueurs.map((l, i) => ({
    date: new Date(Date.UTC(2023, 0, 1 + i * pas)).toISOString().slice(0, 10),
    note: 5, text: journeeDe(i, l - ` FIN${i}`.length) + ` FIN${i}`
  }));
};
const journeesLues = c => {
  const bloc = c.texte.split('\n\n———\n\n').find(b => b.startsWith('SES JOURNÉES'));
  const lignes = bloc.split('\n\n').slice(1);
  const textes = lignes.map(l => l.replace(/^\[[^\]]*\] /, '').replace(/ \[… \d+ signes non lus …\] /, ''));
  return { bloc, lignes, textes, lus: textes.reduce((a, t) => a + t.length, 0) };
};

test('à 159 000 signes, tout part, sans coupe', () => {
  const rows = journal(159_000);
  const c = corpusPour({ rows });
  const { bloc, lus } = journeesLues(c);
  assert.equal(c.dates.size, 50);
  assert.equal(lus, 159_000);
  assert.match(bloc, /Aucune n'est coupée/);
  for (const r of rows) assert.ok(c.texte.includes(r.text), `${r.date} coupée`);
});

test('à 161 000 signes, seules les plus longues sont coupées, juste sous leur longueur', () => {
  const rows = journal(161_000);
  const c = corpusPour({ rows });
  const { bloc, lignes, textes, lus } = journeesLues(c);
  assert.equal(c.dates.size, 50, 'une journée a disparu');
  assert.ok(lus <= SEUIL_SANS_COUPE && lus > SEUIL_SANS_COUPE - 50, `${lus} signes lus`);
  assert.ok(c.texte.length > 160_000, `corpus de ${c.texte.length} signes`);
  const plus = Math.max(...rows.map(r => r.text.length));
  const cap = Number(bloc.match(/10 journées coupées à (\d+) signes/)?.[1]);
  assert.ok(cap > plus - 150 && cap < plus, `plafond ${cap} pour ${plus}`);
  // Le plafond est commun : chaque journée coupée garde exactement `cap` signes.
  rows.forEach((r, i) => assert.equal(textes[i].length, Math.min(r.text.length, cap)));
  rows.forEach((r, i) => assert.ok(lignes[i].endsWith(`FIN${i}`), `la fin de ${r.date} manque`));
  assert.match(bloc, /\d+ signes non lus sur 161000/);
});

test('à 400 000 signes, le seuil reste rempli, et toutes les fins sont là', () => {
  const rows = journal(400_000);
  const c = corpusPour({ rows });
  const { bloc, lignes, textes, lus } = journeesLues(c);
  assert.equal(c.dates.size, 50);
  assert.ok(lus <= SEUIL_SANS_COUPE && lus > SEUIL_SANS_COUPE - 50, `${lus} signes lus`);
  const cap = Number(bloc.match(/40 journées coupées à (\d+) signes/)?.[1]);
  assert.ok(cap > 3000, `le plafond reste à ${cap}`);
  rows.forEach((r, i) => assert.equal(textes[i].length, Math.min(r.text.length, cap)));
  rows.forEach((r, i) => assert.ok(lignes[i].endsWith(`FIN${i}`), `la fin de ${r.date} manque`));
});

test('ce qui part croît avec le journal, sans marche au passage du seuil', () => {
  let avant = 0;
  for (const total of [150_000, 159_000, 160_000, 160_001, 160_100, 161_000, 200_000, 300_000, 400_000]) {
    const c = corpusPour({ rows: journal(total) });
    const { lus } = journeesLues(c);
    assert.equal(c.dates.size, 50, `${total} : une journée a disparu`);
    assert.ok(lus >= Math.min(total, SEUIL_SANS_COUPE) - 50 && lus <= SEUIL_SANS_COUPE, `${total} : ${lus} lus`);
    // Le plafond est un entier : il peut laisser quelques signes sous le seuil
    // (moins d'un par journée coupée), jamais une marche.
    assert.ok(lus >= avant - 50, `${total} : ${lus} lus, contre ${avant} juste avant`);
    avant = lus;
  }
});

test('quand il faut trier, le seuil reste rempli quand même', () => {
  // 400 journées de 1 000 signes : un plafond commun serait à 400, illisible.
  // On garde les plus fournies, et leur plafond remonte jusqu'à remplir le seuil.
  const rows = Array.from({ length: 400 }, (_, i) => ({
    date: new Date(Date.UTC(2022, 0, 1 + i)).toISOString().slice(0, 10),
    note: 5, text: journeeDe(i, 1000)
  }));
  const c = corpusPour({ rows });
  const { lus, textes } = journeesLues(c);
  assert.ok(c.dates.size > 150 && c.dates.size < 400, `${c.dates.size} journées`);
  assert.ok(textes.every(t => t.length >= 900), 'une journée gardée est coupée sous le minimum');
  assert.ok(lus <= SEUIL_SANS_COUPE && lus > SEUIL_SANS_COUPE - 1000, `${lus} signes lus`);
});

test('le corpus dit l’écart-type des mois, pas seulement la moyenne', () => {
  // Deux mois à 6 de moyenne, l'un plat et l'autre entre 1 et 10, ne racontent
  // pas la même chose — et c'est exactement le signal d'une instabilité.
  const plat = Array.from({ length: 20 }, (_, i) => ({ date: `2024-01-${String(i + 1).padStart(2, '0')}`, note: 6, text: 'a' }));
  const agite = Array.from({ length: 20 }, (_, i) => ({ date: `2024-02-${String(i + 1).padStart(2, '0')}`, note: i % 2 ? 10 : 2, text: 'a' }));
  const c = corpusPour({ rows: [...plat, ...agite] });
  const l1 = c.texte.split('\n').find(l => l.startsWith('2024-01'));
  const l2 = c.texte.split('\n').find(l => l.startsWith('2024-02'));
  assert.equal(Number(l1.split(' | ')[4]), 0);
  assert.ok(Number(l2.split(' | ')[4]) > 3, l2);
});

test('le grain de la série suit l’étendue réelle', () => {
  // Une constante ne peut pas convenir aux deux bouts : sur trois semaines de
  // journal une barre par année donne UNE barre ; sur cinq ans une barre par
  // semaine en donne deux cent soixante, et le schéma borne la série à 24.
  assert.equal(grainPour(21), 'semaine');
  assert.equal(grainPour(365), 'mois');
  assert.equal(grainPour(1800), 'année');
  assert.equal(grainPour(0), 'semaine');
});

/* --------------------- quand faut-il relire --------------------- */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-lect-')), 'test.db');

const { db, setLecture, addMessage, addCarnet, OWNER } = await import('../server/db.js');
const api = await import('../server/api.js');

// invalidate() comme le fait streamMessage : la série est mémoïsée, et sans ça
// l'état se lit sur un corpus figé au premier appel.
const ecrire = (date, texte) => {
  addMessage({ ts: `${date}T20:00:00Z`, date, role: 'user', text: texte });
  api.invalidate(OWNER);
};
// La route est asynchrone depuis qu'elle relève le lot en passant.
const etat = () => api.routes['GET /api/lecture']({ userId: OWNER });

test('sans assez de journées, la lecture n’est pas possible', async () => {
  for (let i = 1; i <= 5; i++) ecrire(`2026-01-0${i}`, 'une journée');
  const r = await etat();
  assert.equal(r.possible, false);
  assert.equal(r.ecrites, 5);
});

test('sans lecture, il faut la lancer ; avec, le retard décide', async () => {
  for (let i = 6; i <= 25; i++) ecrire(`2026-01-${String(i).padStart(2, '0')}`, 'une journée');
  assert.equal((await etat()).possible, true);
  assert.equal((await etat()).arelire, true, 'aucune lecture : il faut la faire');

  setLecture({ contenu: { synthese: 'x', themes: [], version: VERSION_LECTURE },
               jusqu_au: '2026-01-25', jours: 25, modele: 'm', userId: OWNER });
  const a = await etat();
  assert.deepEqual([a.retard, a.perime, a.arelire, a.refonte], [0, false, false, false]);

  // Écrire tous les soirs ne doit PAS relancer une relecture complète du corpus
  // tous les soirs, pour un thème qui n'aura pas bougé d'un cheveu.
  ecrire('2026-01-26', 'une journée');
  ecrire('2026-01-27', 'une journée');
  const b = await etat();
  assert.deepEqual([b.retard, b.perime, b.arelire], [2, true, false]);

  // Passé le seuil, elle se relance seule.
  for (let i = 1; i <= 14; i++) ecrire(`2026-02-${String(i).padStart(2, '0')}`, 'une journée');
  assert.equal((await etat()).arelire, true);
});

test('une lecture faite par une version antérieure est à refondre : elle se relance seule, en entier', async () => {
  // Sans numéro de version : c'est une lecture d'avant les schémas.
  setLecture({ contenu: { synthese: 'x', themes: [] },
               jusqu_au: '2026-02-14', jours: 40, modele: 'm', userId: OWNER });
  const a = await etat();
  assert.equal(a.refonte, true);
  assert.equal(a.arelire, true, 'à jour sur le retard, mais périmée par la version');
  assert.equal(a.version, null);
  // La même lecture à la version courante ne se relance pas.
  setLecture({ contenu: { synthese: 'x', themes: [], version: VERSION_LECTURE },
               jusqu_au: '2026-02-14', jours: 40, modele: 'm', userId: OWNER });
  const b = await etat();
  assert.deepEqual([b.refonte, b.arelire], [false, false]);
});

test('les notes apportées font vieillir la carte, pas seulement les journées', async () => {
  // Coller trois ans de carnet est l'événement qui change le plus une carte, et
  // c'était exactement celui qui ne comptait pas : une note n'est pas une
  // journée, donc elle ne bougeait pas le retard.
  setLecture({ contenu: { synthese: 'x', themes: [] },
               jusqu_au: '2026-02-14', jours: 40, modele: 'm', userId: OWNER });
  const avant = await etat();
  assert.equal(avant.notes, 0);
  for (let i = 0; i < 30; i++) {
    addCarnet({ texte: `vieille note ${i}`, jour: null, userId: OWNER,
                quandCree: new Date(Date.now() + 1000 + i).toISOString() });
  }
  api.invalidate(OWNER);
  const apres = await etat();
  assert.equal(apres.notes, 30);
  assert.ok(apres.retard >= 30);
  assert.equal(apres.arelire, true, 'trente notes collées n’ont pas rafraîchi la carte');
});

test('une lecture faite avant la bascule s’affiche encore, mais périmée', async () => {
  // Ce qu'une migration destructive aurait effacé : la seule lecture que
  // quelqu'un possède. On la rend, marquée « ancienne », et l'interface propose
  // de relire — un écran vide serait une régression pour qui met à jour.
  db.prepare('DELETE FROM lectures').run();
  db.prepare(`INSERT INTO lectures(user_id, horizon, fait_le, jusqu_au, jours, modele, contenu)
              VALUES(?,?,?,?,?,?,?)`)
    .run(OWNER, 'moyen', '2026-02-01T00:00:00Z', '2026-01-25', 25, 'm',
         JSON.stringify({ synthese: 'la vieille', themes: [] }));
  api.invalidate(OWNER);
  const r = await etat();
  assert.equal(r.ancienne, true);
  assert.equal(r.lecture.synthese, 'la vieille');
});

test('chaque genre déclaré est utilisable', () => {
  assert.ok(GENRES.includes('personne') && GENRES.includes('mecanisme'));
  assert.equal(new Set(GENRES).size, GENRES.length);
});

/* ---------------------- le chiffre comparé à la normale ---------------------
 *
 * Un modèle à qui on demande « donne un chiffre » en invente un, et il le
 * formule si bien qu'on ne peut pas le distinguer d'un vrai. Sur une
 * application qui rend à quelqu'un sa propre vie, un chiffre faux se retient,
 * se répète, et oriente ce qu'il croit savoir de lui. Ce qui est testé ici,
 * c'est qu'aucun chemin ne mène d'un nombre écrit par le modèle jusqu'à
 * l'écran : il ne rend qu'une étiquette.
 */
const COMPS = [
  { id: 'c1', phrase: 'les dimanches sont à 4, contre 7 les autres jours', ecart: -3, n: 40 },
  { id: 'c2', phrase: 'les journées où tu écris sont à 7, les autres à 5', ecart: 2, n: 90 }
];
const theme = (extra) => ({
  nom: 'un thème', quoi: 'ce qu’il fait', intensite: 2, serie: [],
  preuves: DEUX, ...extra
});

test('le thème porte la phrase du serveur, jamais celle du modèle', () => {
  const r = valider({ themes: [theme({ chiffre: 'c1' })] }, DATES, COMPS);
  assert.equal(r.themes[0].chiffre, COMPS[0].phrase);
});

test('un identifiant inventé disparaît, le thème reste', () => {
  // Le cas qui compte : c'est exactement ce que fait un modèle qui a compris
  // qu'on attend un chiffre et qui n'en a pas trouvé un qui colle.
  for (const c of ['c99', '', 'les dimanches sont à 2', null, undefined, 42]) {
    const r = valider({ themes: [theme({ chiffre: c })] }, DATES, COMPS);
    assert.equal(r.themes.length, 1, `le thème a sauté avec ${JSON.stringify(c)}`);
    assert.equal(r.themes[0].chiffre, null, `un chiffre est passé avec ${JSON.stringify(c)}`);
  }
});

test('le même chiffre ne sert qu’une fois', () => {
  // Le même nombre répété sous trois thèmes ne dit pas trois choses : il dit
  // que le modèle a rempli le champ.
  const r = valider({ themes: [
    theme({ nom: 'premier', chiffre: 'c1' }),
    theme({ nom: 'deuxième', chiffre: 'c1' }),
    theme({ nom: 'troisième', chiffre: 'c2' })
  ] }, DATES, COMPS);
  assert.equal(r.themes[0].chiffre, COMPS[0].phrase);
  assert.equal(r.themes[1].chiffre, null);
  assert.equal(r.themes[2].chiffre, COMPS[1].phrase);
});

test('sans comparaisons calculées, aucun thème ne porte de chiffre', () => {
  const r = valider({ themes: [theme({ chiffre: 'c1' })] }, DATES);
  assert.equal(r.themes[0].chiffre, null);
});

test('le corpus transmet les comparaisons, et les calcule sur toute la fenêtre', () => {
  // Sur l'échantillon transmis (les journées les plus écrites), une moyenne
  // dirait quelque chose des journées bavardes, pas des journées.
  const rows = Array.from({ length: 300 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
    const dim = (new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7 === 6;
    // Au-dessus du seuil sans coupe : l'échantillon ne doit PAS être toute la fenêtre.
    return { date: d, note: dim ? 3 : 7, text: 'x'.repeat(dim ? 20 : 700) };
  });
  const c = corpusPour({ rows });
  const dim = c.comparaisons.find(x => x.phrase.includes('dimanche'));
  assert.ok(dim, 'le creux du dimanche n’est pas ressorti');
  assert.ok(dim.n > c.dates.size / 6, 'les dimanches comptés sortent de l’échantillon, pas de la fenêtre');
  assert.match(c.texte, /\[c\d+\]/);
  assert.match(c.texte, /recopies PAS le nombre/);
});

/* -------------------------------- les pistes --------------------------------

   Une piste peut nommer « dépression » là où un thème ne le peut pas. Ce
   privilège tient à trois verrous, et ils sont dans le code, pas dans la
   consigne : une consigne qu'on n'applique pas n'est pas une règle. */

// Dix journées en deux retours espacés : assez pour qu'une piste, même au nom
// lourd, tienne sur ses dates. Les verrous des dates sont testés plus bas.
const PDATES = ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04', '2024-03-05',
                '2024-04-10', '2024-04-11', '2024-04-12', '2024-04-13', '2024-04-14'];
const PD = new Set(PDATES);
const THEME = (nom, dates) => ({
  nom, quoi: 'ce que ça donne', intensite: 2,
  serie: [{ periode: '2024-03', valeur: 2 }],
  preuves: dates.map(date => ({ date, extrait: 'ce jour-là' }))
});

const AVEC_PISTES = pistes => ({
  synthese: 'x',
  themes: [THEME('les nuits courtes', PDATES.slice(0, 5)), THEME('minimiser après coup', PDATES.slice(5))],
  pistes,
  carte: { noeuds: [], liens: [] }
});

test('une piste tient si elle regroupe au moins deux thèmes rendus', () => {
  const p = valider(AVEC_PISTES([{
    nom: 'Dépression', quoi: 'ce que tu décris', contre: 'mais tu sors, et souvent',
    themes: ['les nuits courtes', 'minimiser après coup'], force: 2
  }]), PD).pistes;
  assert.equal(p.length, 1);
  // Le nom est normalisé en minuscules : c'est l'interface qui l'encadre, et
  // une majuscule le ferait lire comme un titre de dossier médical.
  assert.equal(p[0].nom, 'dépression');
  assert.deepEqual(p[0].themes, ['les nuits courtes', 'minimiser après coup']);
});

test('une piste accrochée à un seul thème disparaît', () => {
  // Sinon « dépression » serait ce thème-là, avec un mot plus lourd dessus.
  const p = valider(AVEC_PISTES([{
    nom: 'dépression', quoi: 'x', contre: 'y', themes: ['les nuits courtes'], force: 3
  }]), PD).pistes;
  assert.deepEqual(p, []);
});

test('une piste qui cite un thème inexistant ne le compte pas', () => {
  // Le thème a pu être jeté plus haut (aucune preuve datée) : la piste
  // pointerait alors vers un fonctionnement affiché nulle part.
  const p = valider(AVEC_PISTES([{
    nom: 'dépression', quoi: 'x', contre: 'y',
    themes: ['les nuits courtes', 'un thème qui n’existe pas'], force: 2
  }]), PD).pistes;
  assert.deepEqual(p, []);
});

test('une piste sans « ce qui va contre » est jetée', () => {
  // C'est le verrou qui sépare une hypothèse d'un verdict.
  for (const contre of ['', '   ', undefined, null]) {
    const p = valider(AVEC_PISTES([{
      nom: 'dépression', quoi: 'x', contre,
      themes: ['les nuits courtes', 'minimiser après coup'], force: 2
    }]), PD).pistes;
    assert.deepEqual(p, [], `« ${contre} » a laissé passer une piste`);
  }
});

test('jamais plus de trois pistes, et jamais deux fois la même', () => {
  // Au-delà, ce n'est plus une lecture, c'est une liste de diagnostics.
  const une = n => ({
    nom: n, quoi: 'x', contre: 'y',
    themes: ['les nuits courtes', 'minimiser après coup'], force: 2
  });
  const p = valider(AVEC_PISTES(
    ['a', 'b', 'c', 'd', 'e'].map(une)), PD).pistes;
  assert.equal(p.length, 3);
  const doubles = valider(AVEC_PISTES([une('dépression'), une('Dépression')]), PD).pistes;
  assert.equal(doubles.length, 1);
});

test('l’absence de piste est une réponse, pas une panne', () => {
  // Sur trois semaines de journal on ne voit pas de grande direction : on voit
  // trois semaines. La lecture doit pouvoir le dire.
  assert.deepEqual(valider(AVEC_PISTES([]), PD).pistes, []);
  assert.deepEqual(valider(AVEC_PISTES(undefined), PD).pistes, []);
  assert.deepEqual(valider(AVEC_PISTES('pas un tableau'), PD).pistes, []);
});

/* ---------------------- les preuves, confrontées au texte ----------------------
 *
 * Les validateurs ne vérifiaient que l'existence des dates : deux thèmes tirés
 * d'une même soirée faisaient une piste « dépression », force 3, sur une seule
 * journée, et une citation que la personne n'a jamais écrite passait. Toutes
 * les phrases ci-dessous sont synthétiques.
 */
const JOURNAL = [
  ['2024-03-01', 'Réveil tôt. On est allés au marché avec ma soeur et on a acheté des fraises pour le gouter. Ensuite sieste.'],
  ['2024-03-02', 'Longue journée au bureau, la réunion a encore débordé et je suis rentré tard.'],
  ['2024-03-03', 'Pas grand-chose. Un peu de lecture, un appel à mon père.'],
  ['2024-03-04', 'Encore la réunion qui déborde, je ne dis rien et je rentre vidé.'],
  ['2024-03-05', 'Balade au canal le soir, ça m’a fait du bien.']
];
const ROWS_J = JOURNAL.map(([date, text]) => ({ date, note: 6, text }));
const DATES_J = new Set(JOURNAL.map(([d]) => d));
const lire = (brut) => valider({ synthese: 'x', ...brut }, DATES_J, [], null, ROWS_J);

test('un extrait recopié tel quel est gardé, guillemets et apostrophes mis à part', () => {
  const r = lire({ themes: [{ nom: 'la réunion qui déborde', quoi: 'y', intensite: 2, serie: [], preuves: [
    { date: '2024-03-02', extrait: '« la réunion a encore débordé »' },
    { date: '2024-03-05', extrait: 'ça m\'a fait du bien' }] }] });
  assert.equal(r.themes.length, 1);
  // Gardé, mais tel qu'il l'a écrit : son apostrophe, pas celle du modèle.
  assert.deepEqual(r.themes[0].preuves.map(p => p.extrait),
    ['la réunion a encore débordé', 'ça m’a fait du bien']);
});

test('un extrait reconnu tel quel rend sa phrase à lui, pas la copie corrigée du modèle', () => {
  // Accent ajouté, ligature, majuscule, points de suspension : la comparaison
  // passe outre, et ce qui s'affiche comme citation est ce qui est écrit.
  const r = lire({ themes: [{ nom: 'le marché', quoi: 'y', intensite: 1, serie: [], preuves: [
    { date: '2024-03-01', extrait: '« on est allés au marché avec ma sœur »' },
    { date: '2024-03-01', extrait: '… des fraises pour le goûter …' },
    { date: '2024-03-05', extrait: 'Ça m\'a fait du bien.' }] }] });
  assert.deepEqual(r.themes[0].preuves.map(p => p.extrait),
    ['On est allés au marché avec ma soeur', 'des fraises pour le gouter', 'ça m’a fait du bien']);
});

test('un extrait reformulé est remplacé par la phrase réellement écrite', () => {
  const r = lire({ themes: [{ nom: 'les sorties en famille', quoi: 'y', intensite: 1, serie: [], preuves: [
    // « sœur » corrigé, accent ajouté, un morceau sauté : ce n'est pas ce qui est écrit.
    { date: '2024-03-01', extrait: 'on est allés au marché avec ma sœur … des fraises pour le goûter' },
    { date: '2024-03-03', extrait: 'un appel à mon père' }] }] });
  assert.equal(r.themes.length, 1);
  assert.equal(r.themes[0].preuves[0].extrait,
    'On est allés au marché avec ma soeur et on a acheté des fraises pour le gouter');
});

test('un extrait inventé fait tomber la preuve, et le thème qui n’en a plus assez', () => {
  const r = lire({ themes: [
    { nom: 'tenu', quoi: 'y', intensite: 1, serie: [], preuves: [
      { date: '2024-03-02', extrait: 'la réunion a encore débordé' },
      { date: '2024-03-04', extrait: 'je ne dis rien et je rentre vidé' },
      { date: '2024-03-03', extrait: 'je me suis disputé avec tout le monde au travail' }] },
    // Vrai texte, mauvaise journée : la preuve ne vaut pas plus.
    { nom: 'fantôme', quoi: 'y', intensite: 3, serie: [], preuves: [
      { date: '2024-03-01', extrait: 'la réunion a encore débordé' },
      { date: '2024-03-05', extrait: 'je pleure tous les soirs depuis une semaine' }] }
  ] });
  assert.deepEqual(r.themes.map(t => t.nom), ['tenu']);
  assert.deepEqual(r.themes[0].preuves.map(p => p.date), ['2024-03-02', '2024-03-04']);
});

test('un thème sur une seule journée ne tient pas', () => {
  const r = valider({ themes: [{ nom: 'un soir', quoi: 'y', intensite: 3, serie: [],
    preuves: [{ date: '2024-03-12', extrait: 'a' }, { date: '2024-03-12', extrait: 'b' }] }] }, DATES);
  assert.deepEqual(r.themes, []);
});

test('une piste dont les thèmes tiennent sur trop peu de journées n’est pas rendue', () => {
  const quatre = ['2024-03-01', '2024-03-02', '2024-03-03', '2024-03-04'];
  const brut = nom => ({
    synthese: 'x', carte: { noeuds: [], liens: [] },
    themes: [THEME('les nuits courtes', quatre.slice(0, 2)), THEME('minimiser après coup', quatre.slice(2))],
    pistes: [{ nom, quoi: 'x', contre: 'y', themes: ['les nuits courtes', 'minimiser après coup'], force: 3 }]
  });
  assert.deepEqual(valider(brut('la peur de décevoir'), PD).pistes, [], 'quatre journées font une piste');
});

test('le mot lourd d’une piste demande huit journées revenues deux fois', () => {
  const avec = (dates, nom) => valider({
    synthese: 'x', carte: { noeuds: [], liens: [] },
    themes: [THEME('les nuits courtes', dates.slice(0, Math.ceil(dates.length / 2))),
             THEME('minimiser après coup', dates.slice(Math.ceil(dates.length / 2)))],
    pistes: [{ nom, quoi: 'x', contre: 'y', themes: ['les nuits courtes', 'minimiser après coup'], force: 2 }]
  }, new Set(dates)).pistes.map(p => p.nom);
  const six = PDATES.slice(2, 8);
  assert.deepEqual(avec(six, 'la peur de décevoir'), ['la peur de décevoir'], 'six journées suffisent à un nom ordinaire');
  assert.deepEqual(avec(six, 'dépression'), [], 'six journées ont suffi au mot lourd');
  // Huit journées d'une seule salve : une période, pas une direction.
  const salve = Array.from({ length: 10 }, (_, i) => `2024-06-${String(i + 1).padStart(2, '0')}`);
  assert.deepEqual(avec(salve, 'trouble du sommeil'), []);
  assert.deepEqual(avec(PDATES, 'trouble du sommeil'), ['trouble du sommeil']);
});

test('un schéma ou un nœud sur une seule journée est retiré', () => {
  const r = valider({ synthese: 'x', themes: [], pistes: [],
    schemas: [{ nom: 'la porte', declencheur: 'sortir', reaction: 'la peur monte', comportement: 'annuler',
      effet: 'soulagement', cout: 'la peur revient', fonction: 'eviter', force: 3,
      preuves: [{ date: '2024-03-12', extrait: 'x' }], jours: ['2024-03-12'] }],
    carte: { noeuds: [{ nom: 'Léa', genre: 'personne', poids: 3, jours: ['2024-03-12'] },
                      { nom: 'le canal', genre: 'lieu', poids: 2, jours: TROIS }],
             liens: [{ de: 'Léa', vers: 'le canal', quoi: 'y emmène', force: 2 }] } }, DATES);
  assert.deepEqual(r.schemas, []);
  assert.deepEqual(r.carte.noeuds, [], 'un nœud d’un jour, et son lien avec lui');
});

test('la force d’un schéma suit ses journées : « presque à chaque fois » ne s’écrit pas sur trois', () => {
  const r = valider({ synthese: 'x', themes: [], pistes: [], carte: { noeuds: [], liens: [] },
    schemas: [{ nom: 'la porte', declencheur: 'sortir', reaction: 'la peur monte', comportement: 'annuler',
      effet: 'soulagement', cout: 'la peur revient', fonction: 'eviter', force: 3,
      preuves: DEUX, jours: TROIS }] }, DATES);
  assert.equal(r.schemas[0].force, 1);
});

test('un nom de thème, de schéma ou de nœud ne porte pas de nom de maladie', () => {
  const r = valider({ synthese: 'x', pistes: [],
    themes: [{ nom: 'anxiété du soir', quoi: 'y', intensite: 2, serie: [], preuves: DEUX },
             { nom: 'le soir qui pèse', quoi: 'y', intensite: 2, serie: [], preuves: DEUX },
             { nom: 'le soir qui retombe', quoi: 'tu fais une rechute chaque dimanche', intensite: 2, serie: [], preuves: DEUX }],
    schemas: [{ nom: 'la crise du soir', declencheur: 'le soir', reaction: 'ça monte', comportement: 'sortir',
      effet: 'ça passe', cout: 'ça revient', fonction: 'fuir', force: 1, preuves: DEUX, jours: TROIS }],
    carte: { noeuds: [{ nom: 'trouble du sommeil', genre: 'corps', poids: 2, jours: TROIS },
                      { nom: 'le canal', genre: 'lieu', poids: 2, jours: TROIS },
                      { nom: 'Léa', genre: 'personne', poids: 2, jours: TROIS }],
             liens: [{ de: 'trouble du sommeil', vers: 'le canal', quoi: 'x', force: 1 },
                     { de: 'Léa', vers: 'le canal', quoi: 'y emmène', force: 1 }] } }, DATES);
  assert.deepEqual(r.themes.map(t => t.nom), ['le soir qui pèse']);
  assert.deepEqual(r.schemas, []);
  assert.deepEqual(r.carte.noeuds.map(n => n.nom).sort(), ['Léa', 'le canal']);
});

test('ses mots à lui passent : « les anxios » et le schéma de l’anxio survivent', () => {
  // Le filtre sans exemption jetterait le nœud de dépendance le mieux documenté
  // et le schéma qui est l'exemple même de la consigne.
  const r = valider({ synthese: 'x', themes: [], pistes: [],
    schemas: [{ nom: 'l’anxio avant de sortir', declencheur: 'sortir de chez toi', reaction: 'la peur monte',
      comportement: 'tu prends un anxio', effet: 'la porte se franchit', cout: 'la peur ne redescend jamais seule',
      fonction: 'eviter', force: 2, preuves: DEUX, jours: TROIS }],
    carte: { noeuds: [{ nom: 'les anxios', genre: 'dependance', poids: 3, jours: TROIS,
                        quoi: 'Ce que tu prends quand ça monte, et après quoi tu écris.' },
                      { nom: 'la psychologue', genre: 'personne', poids: 2, jours: TROIS },
                      { nom: 'le soir', genre: 'periode', poids: 2, jours: TROIS }],
             liens: [{ de: 'le soir', vers: 'les anxios', quoi: 'précède', force: 2 },
                     { de: 'la psychologue', vers: 'le soir', quoi: 'en parle', force: 1 }] } }, DATES);
  assert.equal(r.schemas.length, 1);
  assert.equal(r.schemas[0].comportement, 'tu prends un anxio');
  assert.deepEqual(r.carte.noeuds.map(n => n.nom).sort(), ['la psychologue', 'le soir', 'les anxios']);
});

test('un schéma n’est vérifié que sur ce qui est écrit, et ses preuves aussi', () => {
  const r = valider({ synthese: 'x', themes: [], pistes: [], carte: { noeuds: [], liens: [] },
    schemas: [{ nom: 'la réunion', declencheur: 'la réunion déborde', reaction: 'ça serre', comportement: 'se taire',
      effet: 'ça passe', cout: 'rentrer vidé', fonction: 'eviter', force: 2,
      preuves: [{ date: '2024-03-02', extrait: 'la réunion a encore débordé' },
                { date: '2024-03-04', extrait: 'je n’ai rien dit du tout à mon chef' }],
      jours: ['2024-03-02', '2024-03-04', '2024-03-05'] }] }, DATES_J, [], null, ROWS_J);
  assert.deepEqual(r.schemas, [], 'une seule preuve réelle ne fait pas un schéma');
});

test('les retours de la lecture découpent comme ceux de la carte', async () => {
  // Recopiés dans lecture.js parce que promotion.js ouvre la base à l'import :
  // un test garde les deux identiques.
  const { reprises } = await import('../server/promotion.js');
  const { retours } = await import('../server/lecture.js');
  for (const jours of [[], PDATES, ['2024-01-01', '2024-01-15', '2024-01-30', '2024-03-01'], ['2024-05-01']]) {
    assert.deepEqual(retours(jours, 14), reprises(jours, 14));
  }
});

/* ------------------------- son échelle, dans ses mots -------------------------
 *
 * Le tableau mensuel comptait « ≤3 » : un 0, qui dans sa propre légende n'a pas
 * le sens d'un 3, s'y fondait. Les libellés ci-dessous sont synthétiques.
 */
const ANCRES = [
  { note: 8, label: 'Haut', descr: 'tout roule' },
  { note: 5, label: 'Moyen', descr: 'calme, rien à signaler' },
  { note: 2, label: 'Bas', descr: 'soirées lourdes' },
  { note: 0, label: 'Plancher', descr: 'le fond' }
];
const MOIS_ZEROS = [
  ...Array.from({ length: 10 }, (_, i) => ({ date: `2024-02-${String(i + 1).padStart(2, '0')}`,
    note: [0, 0, 0, 0, 1, 2, 3, 5, 8, 9][i], text: '' })),
  { date: '2024-02-20', note: 6, text: 'une journée' }
];

test('ses ancres arrivent entre « », et le plancher a sa colonne', () => {
  const c = corpusPour({ rows: MOIS_ZEROS, ancres: ANCRES });
  for (const a of ANCRES) assert.ok(c.texte.includes(`${a.note} = « ${a.label} — ${a.descr} »`), a.label);
  assert.match(c.texte, /SON ÉCHELLE, SA LÉGENDE À LUI/);
  assert.match(c.texte, /mois \| journées \| médiane \| moyenne \| écart \| ≤2 \| =0 \| ≥8/);
  const l = c.texte.split('\n').find(x => x.startsWith('2024-02 |')).split(' | ');
  assert.equal(Number(l[5]), 6, '≤2 : quatre zéros, un 1, un 2');
  assert.equal(Number(l[6]), 4, '=0 : les quatre journées au plancher');
  assert.equal(Number(l[7]), 2);
});

test('sans ancres, le tableau reste celui d’avant', () => {
  const c = corpusPour({ rows: MOIS_ZEROS });
  assert.doesNotMatch(c.texte, /SON ÉCHELLE/);
  assert.match(c.texte, /mois \| journées \| médiane \| moyenne \| écart \| ≤3 \| ≥8/);
  const l = c.texte.split('\n').find(x => x.startsWith('2024-02 |')).split(' | ');
  assert.deepEqual(l.slice(5).map(Number), [7, 2]);
});

test('le corpus du journal transmet ses ancres', async () => {
  const { setAnchor, setNote } = await import('../server/db.js');
  for (const a of ANCRES) setAnchor(a.note, a.label, a.descr, OWNER);
  setNote('2026-01-03', 0, OWNER);
  setNote('2026-01-04', 6, OWNER);
  api.invalidate(OWNER);
  const c = api.corpusDuJournal(OWNER);
  assert.ok(c.texte.includes('0 = « Plancher — le fond »'));
  assert.match(c.texte, /≤2 \| =0 \| ≥8/);
});

/* ---------------- des « » ne font pas passer un mot lourd ----------------
 *
 * Le contrôle des noms mettait de côté ce qui est entre « », comme dans une
 * phrase. Or sa légende, qui peut porter un mot lourd, part au modèle avec la
 * consigne de la citer entre guillemets : un thème « dépression » passait, et
 * une piste du même nom tenait sur une seule salve. Tout est synthétique.
 */
// Une piste sur deux thèmes qui se partagent ces journées-là.
const pisteSur = (dates, nom) => valider({
  synthese: 'x', carte: { noeuds: [], liens: [] },
  themes: [THEME('les nuits courtes', dates.slice(0, Math.ceil(dates.length / 2))),
           THEME('minimiser après coup', dates.slice(Math.ceil(dates.length / 2)))],
  pistes: [{ nom, quoi: 'x', contre: 'y', themes: ['les nuits courtes', 'minimiser après coup'], force: 2 }]
}, new Set(dates)).pistes.map(p => p.nom);
const salveDe = n => Array.from({ length: n }, (_, i) => `2024-06-${String(i + 1).padStart(2, '0')}`);

test('un nom entre « » est contrôlé comme les autres', () => {
  const r = valider({ synthese: 'x', pistes: [],
    themes: [{ nom: '« dépression »', quoi: 'y', intensite: 2, serie: [], preuves: DEUX },
             { nom: 'ton « trouble anxieux »', quoi: 'y', intensite: 2, serie: [], preuves: DEUX },
             { nom: 'les « petits riens »', quoi: 'y', intensite: 2, serie: [], preuves: DEUX }],
    schemas: [{ nom: 'la « crise » du dimanche', declencheur: 'le dimanche', reaction: 'ça monte', comportement: 'sortir',
      effet: 'ça passe', cout: 'ça revient', fonction: 'fuir', force: 1, preuves: DEUX, jours: TROIS }],
    carte: { noeuds: [{ nom: '« insomnie »', genre: 'corps', poids: 2, jours: TROIS },
                      { nom: '« les anxios »', genre: 'dependance', poids: 2, jours: TROIS },
                      { nom: 'le canal', genre: 'lieu', poids: 2, jours: TROIS }],
             liens: [{ de: '« insomnie »', vers: 'le canal', quoi: 'x', force: 1 },
                     { de: '« les anxios »', vers: 'le canal', quoi: 'y ramène', force: 1 }] } }, DATES);
  assert.deepEqual(r.themes.map(t => t.nom), ['les « petits riens »']);
  assert.deepEqual(r.schemas, []);
  assert.deepEqual(r.carte.noeuds.map(n => n.nom).sort(), ['le canal', '« les anxios »']);
});

test('une piste entre « » passe par le verrou du mot lourd, libellé de sa légende compris', () => {
  const LEGENDE = [{ note: 1, label: 'Grosse crise', descr: 'rien ne tient debout' },
                   { note: 7, label: 'Léger', descr: 'on avance' }];
  // Le libellé part bien au modèle, entre « »…
  const c = corpusPour({ rows: MOIS_ZEROS, ancres: LEGENDE });
  assert.ok(c.texte.includes('1 = « Grosse crise — rien ne tient debout »'));
  // … et le reprendre comme nom de piste ne le rend pas ordinaire.
  for (const nom of ['« dépression »', 'ta « grosse crise »', 'ta « phase basse »']) {
    assert.deepEqual(pisteSur(salveDe(6), nom), [], `${nom} sur une salve de six jours`);
    assert.deepEqual(pisteSur(salveDe(10), nom), [], `${nom} sur une seule salve de dix jours`);
    assert.deepEqual(pisteSur(PDATES, nom), [nom], `${nom} sur dix journées en deux retours`);
  }
  // Un nom ordinaire, entre « » ou non, n'a que le verrou des cinq journées.
  assert.deepEqual(pisteSur(salveDe(6), 'les « petits riens »'), ['les « petits riens »']);
  assert.deepEqual(pisteSur(salveDe(6), 'la peur de décevoir'), ['la peur de décevoir']);
});

test('« épisode » n’emporte plus la lettre qui suit : « épisode dépressif » est un mot lourd', () => {
  for (const nom of ['épisode dépressif', 'épisodes dépressifs', 'épisode dissociatif', 'Épisode dépressif',
                     'episode depressif', 'épisode de déprime', 'épisode d’angoisse', 'le bureau anxiogène']) {
    assert.equal(nomLourd(nom), true, nom);
  }
  for (const nom of ['épisodes de fou rire', 'l’épisode du parapluie', 'les anxios', 'l’anxio avant de sortir',
                     'tes anxiolytiques', 'tes antidépresseurs', 'la psychologue', 'le psychiatre']) {
    assert.equal(nomLourd(nom), false, nom);
  }
  const r = valider({ synthese: 'x', pistes: [],
    themes: [{ nom: 'épisode dépressif', quoi: 'y', intensite: 2, serie: [], preuves: DEUX },
             { nom: 'épisodes de fou rire', quoi: 'y', intensite: 2, serie: [], preuves: DEUX }],
    carte: { noeuds: [{ nom: 'épisode dissociatif', genre: 'corps', poids: 2, jours: TROIS },
                      { nom: 'le canal', genre: 'lieu', poids: 2, jours: TROIS },
                      { nom: 'Léa', genre: 'personne', poids: 2, jours: TROIS }],
             liens: [{ de: 'épisode dissociatif', vers: 'le canal', quoi: 'x', force: 1 },
                     { de: 'Léa', vers: 'le canal', quoi: 'y emmène', force: 1 }] } }, DATES);
  assert.deepEqual(r.themes.map(t => t.nom), ['épisodes de fou rire']);
  assert.deepEqual(r.carte.noeuds.map(n => n.nom).sort(), ['Léa', 'le canal']);
  // Une piste peut porter le mot, mais seulement derrière son verrou.
  assert.deepEqual(pisteSur(salveDe(6), 'épisode dépressif'), []);
  assert.deepEqual(pisteSur(PDATES, 'épisode dépressif'), ['épisode dépressif']);
});
