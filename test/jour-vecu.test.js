/**
 * LA JOURNEE VECUE.
 *
 * La grille coupait a minuit : une fin de soiree a 2 h tombait sur le
 * lendemain, la journee se retrouvait coupee en deux, et le lendemain
 * s'ouvrait avec l'humeur de la veille. La coupure est maintenant le LEVER.
 *
 * Ce qui est teste ici en priorite, ce n'est pas que ca marche quand tout est
 * connu -- c'est que ca ne bouge RIEN quand on ne sait pas. Une coupure
 * inventee ferait glisser des journees entieres d'une case.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bornesDitesDans, bornesConnues, medianeBorne, coupureDe, jourVecuDe, veilleDe,
  MIDI, SOURCE_DIT
} from '../server/jour-vecu.js';

const Z = 'UTC';
const a = (d, h, m = 0) => `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;

/* ------------------------------ ce qui se dit ------------------------------ */

test('un coucher et un lever se reconnaissent', () => {
  assert.equal(bornesDitesDans('bon allez je vais me coucher').genre, 'coucher');
  assert.equal(bornesDitesDans('bonne nuit').genre, 'coucher');
  assert.equal(bornesDitesDans('je viens de me lever').genre, 'lever');
  assert.equal(bornesDitesDans('je suis debout').genre, 'lever');
});

test('une négation collée au verbe annule la borne — mais pas un « pas » de passage', () => {
  assert.equal(bornesDitesDans('je me couche pas'), null);
  assert.equal(bornesDitesDans('je vais pas me coucher'), null);
  /*
   * « il y a pas longtemps » n'est pas une négation du lever. Chercher « pas »
   * dans tout le message refusait cette phrase-là, qui est pourtant un lever
   * dit clairement.
   */
  assert.equal(bornesDitesDans('je me suis levé il y a pas longtemps').genre, 'lever');
});

test('une habitude ou un projet n’est PAS une borne', () => {
  for (const t of [
    'je me couche tôt d’habitude',
    'faut que je me lève tôt demain',
    'je me suis levé tard hier',
    'je me couche jamais avant 2h',
    'tous les soirs je vais me coucher à pas d’heure',
    'si je me couche maintenant j’aurai 6h'
  ]) assert.equal(bornesDitesDans(t), null, `« ${t} » ne doit pas poser de borne`);
});

test('l’heure part avec la phrase quand elle y est', () => {
  assert.equal(bornesDitesDans('je me suis levé à 8h').heure, '08:00');
  assert.equal(bornesDitesDans('je me suis levé à 07:45').heure, '07:45');
  assert.equal(bornesDitesDans('je viens de me lever').heure, null,
    'sans heure dite, c’est l’instant du message qui fera foi');
  /*
   * Trente-quatre heures n'est pas une heure. La PHRASE dit quand meme un
   * lever : on garde la borne et on jette l'heure, et c'est l'instant du
   * message qui fera foi. Jeter la phrase entiere pour un chiffre mal tape
   * perdrait la seule chose qu'on avait comprise.
   */
  assert.deepEqual(bornesDitesDans('je me suis levé à 34h'), { genre: 'lever', heure: null });
});

test('du texte vide ou hors sujet ne dit rien', () => {
  for (const t of ['', null, undefined, 'j’ai mangé des pâtes', 'le lever du soleil était beau'])
    assert.equal(bornesDitesDans(t), null);
});

/*
 * LA JOURNÉE DU 8 SEPTEMBRE, BORNÉE PAR SES PROPRES PHRASES.
 *
 * Le site affichait un coucher à 16:27 et une nuit de 3,7 h, alors que la
 * personne s'était couchée à 06:48. Ce jour-là elle avait écrit DEUX couchers
 * noir sur blanc, et aucun des deux n'était reconnu : faute de borne dite, le
 * site allait chercher un appariement de machine, et cet appariement se
 * trompait. Ces deux phrases sont donc le test — si elles cessent d'être
 * reconnues, le 16:27 revient.
 */
test('les deux couchers vraiment écrits le 8 septembre sont reconnus', () => {
  assert.equal(bornesDitesDans('je vais pas tarder à dormir je pense').genre, 'coucher',
    '« pas tarder à » veut dire bientôt : en français ce n’est pas une négation');
  assert.equal(bornesDitesDans(
    'j’ai l’impression de vivre comme si je n’avais plus de futur en allant au lit ' +
    '( mtn ) c’est le fond ouais ressenti avant de m’endormir 1/10 là').genre, 'coucher',
    'le « si je » est quarante caractères plus tôt, il parle d’autre chose');
});

test('les tournures qui manquaient disent un coucher', () => {
  for (const t of ['allez, dodo', 'je pars me coucher', 'j’vais m’endormir',
                   'je vais m’endormir', 'avant de dormir je voulais dire un truc'])
    assert.equal(bornesDitesDans(t)?.genre, 'coucher', `« ${t} » est un coucher`);
});

/*
 * Le garde « ce n'est pas maintenant » ne regarde plus le message entier, mais
 * trente caractères autour du verbe. Il doit continuer à écarter tout ce qui
 * déplace la phrase dans le temps QUAND c'est collé au verbe — sinon la
 * fenêtre a été ouverte trop grand pour rien.
 */
test('trente caractères autour du verbe suffisent à écarter ce qui n’est pas maintenant', () => {
  for (const t of [
    'demain je vais me coucher tôt',
    'je vais me coucher tôt comme d’habitude',
    'hier avant de m’endormir j’ai pensé à ça',
    'faut que je pense à pas tarder à dormir',
    'je vais jamais me coucher avant 4h'
  ]) assert.equal(bornesDitesDans(t), null, `« ${t} » ne doit pas poser de borne`);
});

/* ----------------------------- les levers connus ----------------------------- */

test('ce que la personne dit passe devant le quantified self', () => {
  const l = bornesConnues([
    { date: '2026-09-01', source: 'poste', cle: 'premiere_activite', texte: '10:30' },
    { date: '2026-09-01', source: 'montre', cle: 'reveil', texte: '09:00' },
    { date: '2026-09-01', source: SOURCE_DIT, cle: 'lever_dit', texte: '07:15' }
  ]);
  assert.equal(l.get('2026-09-01'), 7 * 60 + 15);
});

test('le reveil mesuré passe devant la première activité', () => {
  const l = bornesConnues([
    { date: '2026-09-01', source: 'poste', cle: 'premiere_activite', texte: '10:30' },
    { date: '2026-09-01', source: 'montre', cle: 'sleep_end', texte: '09:00' }
  ]);
  assert.equal(l.get('2026-09-01'), 540);
});

test('un lever d’après-midi n’est pas une frontière', () => {
  const l = bornesConnues([{ date: '2026-09-01', source: 'montre', cle: 'reveil', texte: '14:20' }]);
  assert.equal(l.has('2026-09-01'), false,
    'sinon toute la matinée des AUTRES jours basculerait sur la veille');
});

test('une heure en nombre se lit, en heures comme en minutes', () => {
  const l = bornesConnues([
    { date: '2026-09-01', source: 'montre', cle: 'reveil', valeur: 8.5 },
    { date: '2026-09-02', source: 'montre', cle: 'reveil', valeur: 510 }
  ]);
  assert.equal(l.get('2026-09-01'), 510);
  assert.equal(l.get('2026-09-02'), 510);
});

test('une clé qui ne parle ni de lever ni de première activité est ignorée', () => {
  const l = bornesConnues([{ date: '2026-09-01', source: 'montre', cle: 'pas', valeur: 8000 }]);
  assert.equal(l.size, 0);
});

/* ------------------------------- la coupure ------------------------------- */

test('sans rien de connu, il n’y a pas de coupure — et donc pas de déplacement', () => {
  assert.equal(coupureDe('2026-09-01', new Map(), null), null);
  assert.equal(jourVecuDe(a('2026-09-01', 2), { zone: Z }), '2026-09-01',
    'la journée civile est le repli, et elle ne bouge pas');
});

test('la médiane sert de repli pour les jours sans lever à eux', () => {
  const bornes = new Map([['2026-09-01', 480], ['2026-09-02', 500]]);
  const med = medianeBorne(bornes);
  assert.equal(med, 490);
  assert.equal(coupureDe('2026-09-09', bornes, med), 490);
});

test('une médiane d’après-midi ne sert pas de coupure', () => {
  assert.equal(coupureDe('2026-09-09', new Map(), MIDI + 60), null);
});

/* ---------------------------- la journée vécue ---------------------------- */

test('deux heures du matin appartiennent à la veille', () => {
  const bornes = new Map([['2026-09-02', 8 * 60]]);
  assert.equal(jourVecuDe(a('2026-09-02', 2, 30), { bornes, zone: Z }), '2026-09-01');
});

test('après le lever, on est bien dans sa journée', () => {
  const bornes = new Map([['2026-09-02', 8 * 60]]);
  assert.equal(jourVecuDe(a('2026-09-02', 8, 1), { bornes, zone: Z }), '2026-09-02');
  assert.equal(jourVecuDe(a('2026-09-02', 23, 59), { bornes, zone: Z }), '2026-09-02');
});

test('pile à l’heure du lever, on est dans la journée qui commence', () => {
  const bornes = new Map([['2026-09-02', 480]]);
  assert.equal(jourVecuDe(a('2026-09-02', 8, 0), { bornes, zone: Z }), '2026-09-02');
});

/*
 * LE CAS DU COUCHE-TARD, ET C'EST CELUI QUI A FAIT CHANGER LA RÈGLE.
 *
 * Couché à 06:10, levé à 15:30. Le lever ne peut pas servir de frontière — à
 * 15 h 30 il rattacherait toute la matinée des autres jours à la veille — donc
 * la première version n'en trouvait aucune, et ce qui avait été écrit à 01:56
 * et à 05:43 restait rangé sur la journée d'après. Le coucher, lui, est une
 * frontière parfaitement nette.
 */
test('le coucher marque la journée, et il passe devant le lever', () => {
  const bornes = bornesConnues([
    { date: '2026-09-01', source: 'dit', cle: 'coucher_dit', texte: '06:10' },
    { date: '2026-09-01', source: 'dit', cle: 'lever_dit',   texte: '15:30' }
  ]);
  assert.equal(bornes.get('2026-09-01'), 6 * 60 + 10, 'le lever de 15:30 ne doit pas gagner');
  // Ce qui a été écrit avant d'aller se coucher appartient à la veille.
  assert.equal(jourVecuDe(a('2026-09-01', 1, 56), { bornes, zone: Z }), '2026-08-31');
  assert.equal(jourVecuDe(a('2026-09-01', 5, 43), { bornes, zone: Z }), '2026-08-31');
  // Ce qui vient après, non.
  assert.equal(jourVecuDe(a('2026-09-01', 16, 24), { bornes, zone: Z }), '2026-09-01');
});

test('un coucher du soir n’est pas une frontière — sinon toute la journée basculerait', () => {
  // Couché à 23:30 : la journée s'est terminée à minuit comme d'habitude.
  // Prendre 23:30 pour coupure rattacherait tout le mardi au lundi.
  const bornes = bornesConnues([{ date: '2026-09-02', source: 'dit', cle: 'coucher_dit', texte: '23:30' }]);
  assert.equal(bornes.has('2026-09-02'), false);
  assert.equal(jourVecuDe(a('2026-09-02', 14, 0), { bornes, zone: Z }), '2026-09-02');
});

test('ce que la personne dit passe devant ce qu’une machine mesure', () => {
  const bornes = bornesConnues([
    { date: '2026-09-01', source: 'montre', cle: 'coucher',   texte: '04:00' },
    { date: '2026-09-01', source: 'dit',    cle: 'lever_dit', texte: '07:30' }
  ]);
  assert.equal(bornes.get('2026-09-01'), 450, 'le lever DIT passe devant le coucher MESURÉ');
});

test('un lever d’après-midi ne sert pas de frontière', () => {
  // 13 h est au-delà de midi : on n'en fait pas une frontière, on retombe sur
  // la médiane s'il y en a une, sinon sur la journée civile.
  const bornes = bornesConnues([{ date: '2026-09-02', source: 'montre', cle: 'reveil', texte: '13:00' }]);
  assert.equal(jourVecuDe(a('2026-09-02', 11, 0), { bornes, zone: Z }), '2026-09-02');
});

test('la zone décide, pas l’horloge du serveur', () => {
  const bornes = new Map([['2026-09-02', 480]]);
  // 2026-09-02T00:30Z est le 2 à 2 h 30 à Paris : la veille pour Paris.
  assert.equal(jourVecuDe('2026-09-02T00:30:00Z', { bornes, zone: 'Europe/Paris' }), '2026-09-01');
  // Le même instant est le 1er à 20 h 30 à New York : sa propre journée.
  const l2 = new Map([['2026-09-01', 480]]);
  assert.equal(jourVecuDe('2026-09-02T00:30:00Z', { levers: l2, zone: 'America/New_York' }), '2026-09-01');
});

test('la veille se calcule sans se faire piéger par les mois ni les fuseaux', () => {
  assert.equal(veilleDe('2026-09-01'), '2026-08-31');
  assert.equal(veilleDe('2026-01-01'), '2025-12-31');
  assert.equal(veilleDe('2028-03-01'), '2028-02-29');
});

test('un instant illisible ne devient pas aujourd’hui en silence', () => {
  assert.equal(jourVecuDe('pas une date', { zone: Z }), null);
  assert.equal(jourVecuDe(null, { zone: Z }), null);
});

/* -------- le coucher estimé par le silence : deux défauts empilés -------- */

test('le coucher se lit dans le plus long silence, pas dans une soirée sans écrire', async () => {
  /*
   * DEUX DÉFAUTS, ET LE SECOND CACHAIT LE PREMIER.
   *
   * 1. `ts` est une CHAÎNE ISO, pas un nombre. `users[i+1].ts - users[i].ts`
   *    donnait NaN, et `NaN < SEUIL` est faux : la garde qui devait passer au
   *    message suivant tant que le silence est trop court ne passait jamais.
   *    La fonction rendait le PREMIER message du soir — chez quelqu'un qui se
   *    lève l'après-midi, son lever lui-même.
   *
   * 2. Même réparée, elle rendait le PREMIER écart assez long. Une soirée sans
   *    écrire (18:37 → 03:18) n'est pas un endormissement : la phrase de 03:18
   *    prouve qu'on était debout. La réfutation effaçait alors le coucher —
   *    la bonne réponse, obtenue de la mauvaise façon, et l'écran n'affichait
   *    plus rien là où 03:18 était dans les données.
   *
   * Le sommeil qui ferme la journée est le PLUS LONG silence de la fenêtre.
   */
  const U = 'coucher-silence';
  const { upsertUser, addMessage, poserActiviteJour, setNote } = await import('../server/db.js');
  const { posteDuJour } = await import('../server/api.js');
  // L'heure attendue se dérive du MÊME helper que le code : le test dit quel
  // message a été choisi, pas dans quel fuseau tourne la machine qui l'exécute.
  const { heureLocale } = await import('../server/temps.js');
  /** Le décalage du fuseau où tourne le test, ce jour-là, en « +HH:MM ». */
  const offset = jour => {
    const midi = new Date(`${jour}T12:00:00Z`);
    const [hh, mm] = heureLocale(midi.toISOString()).split(':').map(Number);
    const d = (hh * 60 + mm) - 12 * 60;
    const signe = d < 0 ? '-' : '+', v = Math.abs(d);
    return `${signe}${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
  };
  upsertUser({ id: U, username: U });
  const dig = (date, de, a, trous = []) => ({ date, plage: { de, a },
    trous: trous.map(([d, f]) => ({ de: d, a: f, minutes: 0 })), temps_par_contexte_s: { code: 3600 } });
  poserActiviteJour(U, '2026-09-05', dig('2026-09-05', '12:00', '23:59'));
  poserActiviteJour(U, '2026-09-06', dig('2026-09-06', '00:00', '23:59', [['00:10', '15:34']]));
  // Le lendemain SANS le trou de reprise : Machi Tool ne l'a pas encore envoyé.
  poserActiviteJour(U, '2026-09-07', dig('2026-09-07', '00:00', '23:59'));
  /* Les instants sont écrits dans LE FUSEAU DU TEST, pour que leur heure lue
     colle aux heures murales du digest — sinon le lever vient d'un cadran et
     les messages d'un autre, et le test mesure le fuseau de la machine. */
     
  const a = h => `2026-09-06T${h}:00${offset('2026-09-06')}`;
  const b = h => `2026-09-07T${h}:00${offset('2026-09-07')}`;
  for (const [ts, d, t] of [
    [a('15:34'), '2026-09-06', 'coucou'],
    [a('18:37'), '2026-09-06', 'je me sens différent'],       // puis 8 h 41 sans écrire
    [b('03:18'), '2026-09-06', 'de la musique, ça va mieux'], // puis 12 h : la vraie nuit
    [b('15:20'), '2026-09-07', 'nouvelle journée'],
  ]) addMessage({ ts, date: d, role: 'user', text: t, userId: U });
  setNote('2026-09-06', 5, U);

  const p = posteDuJour('2026-09-06', U);
  assert.equal(p.lever.heure, '15:34');
  assert.equal(p.coucher.heure, '03:18',
               'le coucher doit être la dernière phrase avant le plus long silence, pas celle d’avant');
  assert.notEqual(p.coucher.heure, '18:37', 'la soirée sans écrire a été prise pour un endormissement');
  assert.equal(p.coucher.source, 'estime');
});
