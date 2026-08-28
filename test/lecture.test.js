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
import { valider, corpusPour, choisirJours, grainPour, GENRES } from '../server/lecture.js';

const DATES = new Set(['2024-03-12', '2024-04-02', '2024-05-20']);

/* ----------------------------- la validation ----------------------------- */

test('une date absente du corpus est retirée', () => {
  const r = valider({
    synthese: 'x',
    themes: [{
      nom: 'instabilité', quoi: 'y', intensite: 2, serie: [],
      preuves: [{ date: '2024-03-12', extrait: 'vrai' }, { date: '1999-01-01', extrait: 'inventé' }]
    }]
  }, DATES);
  assert.equal(r.themes[0].preuves.length, 1);
  assert.equal(r.themes[0].preuves[0].date, '2024-03-12');
});

test('un thème dont toutes les preuves sont inventées disparaît', () => {
  // La consigne dit qu'un thème sans ancrage ne tient pas. Une consigne qui
  // n'est pas appliquée n'est pas une règle.
  const r = valider({
    synthese: 'x',
    themes: [
      { nom: 'fantôme', quoi: 'y', intensite: 3, serie: [], preuves: [{ date: '1999-01-01', extrait: 'z' }] },
      { nom: 'réel', quoi: 'y', intensite: 1, serie: [], preuves: [{ date: '2024-04-02', extrait: 'z' }] }
    ]
  }, DATES);
  assert.deepEqual(r.themes.map(t => t.nom), ['réel']);
});

test('un lien vers un thème retiré ne trace pas d’arête dans le vide', () => {
  const r = valider({
    synthese: 'x',
    themes: [
      { nom: 'réel', quoi: 'y', intensite: 1, serie: [], liens: ['fantôme', 'autre'],
        preuves: [{ date: '2024-04-02', extrait: 'z' }] },
      { nom: 'autre', quoi: 'y', intensite: 1, serie: [], liens: ['réel'],
        preuves: [{ date: '2024-05-20', extrait: 'z' }] },
      { nom: 'fantôme', quoi: 'y', intensite: 3, serie: [], preuves: [{ date: '1999-01-01', extrait: 'z' }] }
    ]
  }, DATES);
  assert.deepEqual(r.themes.find(t => t.nom === 'réel').liens, ['autre']);
});

test('un thème ne se lie pas à lui-même', () => {
  const r = valider({
    synthese: 'x',
    themes: [{ nom: 'boucle', quoi: 'y', intensite: 1, serie: [], liens: ['boucle', 'BOUCLE'],
               preuves: [{ date: '2024-04-02', extrait: 'z' }] }]
  }, DATES);
  assert.deepEqual(r.themes[0].liens, []);
});

test('les intensités hors échelle sont ramenées dedans', () => {
  const r = valider({
    synthese: 'x',
    themes: [{ nom: 'a', quoi: 'y', intensite: 97, preuves: [{ date: '2024-03-12', extrait: 'z' }],
               serie: [{ periode: '2024-03', valeur: -4 }, { periode: '2024-04', valeur: 12 },
                       { periode: '', valeur: 2 }] }]
  }, DATES);
  assert.equal(r.themes[0].intensite, 3);
  assert.deepEqual(r.themes[0].serie.map(p => p.valeur), [0, 3]);   // la période vide saute
});

test('rien d’exploitable rend une lecture vide, pas une exception', () => {
  assert.deepEqual(valider(null, DATES),
    { synthese: '', themes: [], pistes: [], carte: { noeuds: [], liens: [] } });
  assert.deepEqual(valider({ themes: 'pas un tableau' }, DATES).themes, []);
  assert.deepEqual(valider({ themes: [{}] }, DATES).themes, []);
});

/* -------------------------------- la carte -------------------------------- */

test('la carte n’est faite que de ce qui se relie vraiment', () => {
  const c = valider({ synthese: '', themes: [], carte: {
    noeuds: [{ nom: 'Léa', genre: 'personne', poids: 3 },
             { nom: 'les nuits courtes', genre: 'corps', poids: 2 },
             { nom: 'flottant', genre: 'activite', poids: 1 },
             { nom: 'Léa', genre: 'personne', poids: 1 }],
    liens: [{ de: 'Léa', vers: 'les nuits courtes', quoi: 'précède', force: 2 },
            { de: 'les nuits courtes', vers: 'Léa', quoi: 'doublon', force: 3 },
            { de: 'Léa', vers: 'fantôme', quoi: 'x', force: 1 },
            { de: 'Léa', vers: 'les nuits courtes', quoi: '', force: 1 },
            { de: 'Léa', vers: 'Léa', quoi: 'boucle', force: 1 }]
  } }, DATES).carte;
  // un doublon de nom, un nœud sans lien, un lien vers un fantôme, un lien sans
  // « comment », une boucle sur soi : rien de tout ça ne se dessine.
  assert.deepEqual(c.noeuds.map(n => n.nom), ['Léa', 'les nuits courtes']);
  assert.equal(c.liens.length, 1);
  assert.equal(c.liens[0].quoi, 'précède');
});

test('un genre inconnu retombe sur « activite » au lieu de casser le rendu', () => {
  const c = valider({ synthese: '', themes: [], carte: {
    noeuds: [{ nom: 'a', genre: 'nimportequoi', poids: 9 }, { nom: 'b', genre: 'lieu', poids: -3 }],
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
const etat = () => api.routes['GET /api/lecture']({ userId: OWNER });

test('sans assez de journées, la lecture n’est pas possible', () => {
  for (let i = 1; i <= 5; i++) ecrire(`2026-01-0${i}`, 'une journée');
  const r = etat();
  assert.equal(r.possible, false);
  assert.equal(r.ecrites, 5);
});

test('sans lecture, il faut la lancer ; avec, le retard décide', () => {
  for (let i = 6; i <= 25; i++) ecrire(`2026-01-${String(i).padStart(2, '0')}`, 'une journée');
  assert.equal(etat().possible, true);
  assert.equal(etat().arelire, true, 'aucune lecture : il faut la faire');

  setLecture({ contenu: { synthese: 'x', themes: [] },
               jusqu_au: '2026-01-25', jours: 25, modele: 'm', userId: OWNER });
  const a = etat();
  assert.deepEqual([a.retard, a.perime, a.arelire], [0, false, false]);

  // Écrire tous les soirs ne doit PAS relancer une relecture complète du corpus
  // tous les soirs, pour un thème qui n'aura pas bougé d'un cheveu.
  ecrire('2026-01-26', 'une journée');
  ecrire('2026-01-27', 'une journée');
  const b = etat();
  assert.deepEqual([b.retard, b.perime, b.arelire], [2, true, false]);

  // Passé le seuil, elle se relance seule.
  for (let i = 1; i <= 14; i++) ecrire(`2026-02-${String(i).padStart(2, '0')}`, 'une journée');
  assert.equal(etat().arelire, true);
});

test('les notes apportées font vieillir la carte, pas seulement les journées', () => {
  // Coller trois ans de carnet est l'événement qui change le plus une carte, et
  // c'était exactement celui qui ne comptait pas : une note n'est pas une
  // journée, donc elle ne bougeait pas le retard.
  setLecture({ contenu: { synthese: 'x', themes: [] },
               jusqu_au: '2026-02-14', jours: 40, modele: 'm', userId: OWNER });
  const avant = etat();
  assert.equal(avant.notes, 0);
  for (let i = 0; i < 30; i++) {
    addCarnet({ texte: `vieille note ${i}`, jour: null, userId: OWNER,
                quandCree: new Date(Date.now() + 1000 + i).toISOString() });
  }
  api.invalidate(OWNER);
  const apres = etat();
  assert.equal(apres.notes, 30);
  assert.ok(apres.retard >= 30);
  assert.equal(apres.arelire, true, 'trente notes collées n’ont pas rafraîchi la carte');
});

test('une lecture faite avant la bascule s’affiche encore, mais périmée', () => {
  // Ce qu'une migration destructive aurait effacé : la seule lecture que
  // quelqu'un possède. On la rend, marquée « ancienne », et l'interface propose
  // de relire — un écran vide serait une régression pour qui met à jour.
  db.prepare('DELETE FROM lectures').run();
  db.prepare(`INSERT INTO lectures(user_id, horizon, fait_le, jusqu_au, jours, modele, contenu)
              VALUES(?,?,?,?,?,?,?)`)
    .run(OWNER, 'moyen', '2026-02-01T00:00:00Z', '2026-01-25', 25, 'm',
         JSON.stringify({ synthese: 'la vieille', themes: [] }));
  api.invalidate(OWNER);
  const r = etat();
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
  preuves: [{ date: '2024-03-12', extrait: 'x' }], ...extra
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
    return { date: d, note: dim ? 3 : 7, text: 'x'.repeat(dim ? 20 : 400) };
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

const THEME = (nom, date) => ({
  nom, quoi: 'ce que ça donne', intensite: 2,
  serie: [{ periode: '2024-03', valeur: 2 }],
  preuves: [{ date, extrait: 'ce jour-là' }]
});

const AVEC_PISTES = pistes => ({
  synthese: 'x',
  themes: [THEME('les nuits courtes', '2024-03-12'), THEME('minimiser après coup', '2024-04-02')],
  pistes,
  carte: { noeuds: [], liens: [] }
});

test('une piste tient si elle regroupe au moins deux thèmes rendus', () => {
  const p = valider(AVEC_PISTES([{
    nom: 'Dépression', quoi: 'ce que tu décris', contre: 'mais tu sors, et souvent',
    themes: ['les nuits courtes', 'minimiser après coup'], force: 2
  }]), DATES).pistes;
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
  }]), DATES).pistes;
  assert.deepEqual(p, []);
});

test('une piste qui cite un thème inexistant ne le compte pas', () => {
  // Le thème a pu être jeté plus haut (aucune preuve datée) : la piste
  // pointerait alors vers un fonctionnement affiché nulle part.
  const p = valider(AVEC_PISTES([{
    nom: 'dépression', quoi: 'x', contre: 'y',
    themes: ['les nuits courtes', 'un thème qui n’existe pas'], force: 2
  }]), DATES).pistes;
  assert.deepEqual(p, []);
});

test('une piste sans « ce qui va contre » est jetée', () => {
  // C'est le verrou qui sépare une hypothèse d'un verdict.
  for (const contre of ['', '   ', undefined, null]) {
    const p = valider(AVEC_PISTES([{
      nom: 'dépression', quoi: 'x', contre,
      themes: ['les nuits courtes', 'minimiser après coup'], force: 2
    }]), DATES).pistes;
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
    ['a', 'b', 'c', 'd', 'e'].map(une)), DATES).pistes;
  assert.equal(p.length, 3);
  const doubles = valider(AVEC_PISTES([une('dépression'), une('Dépression')]), DATES).pistes;
  assert.equal(doubles.length, 1);
});

test('l’absence de piste est une réponse, pas une panne', () => {
  // Sur trois semaines de journal on ne voit pas de grande direction : on voit
  // trois semaines. La lecture doit pouvoir le dire.
  assert.deepEqual(valider(AVEC_PISTES([]), DATES).pistes, []);
  assert.deepEqual(valider(AVEC_PISTES(undefined), DATES).pistes, []);
  assert.deepEqual(valider(AVEC_PISTES('pas un tableau'), DATES).pistes, []);
});
