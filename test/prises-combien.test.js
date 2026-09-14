/**
 * =====================================================================
 *  LE ROUGE DIT UNE QUANTITÉ ÉCRITE. IL NE DIT JAMAIS UN JUGEMENT.
 *
 * Une échelle qui monte vers le rouge QUALIFIE, et c'est ce que ce tableau
 * refuse partout ailleurs. Ce qui la rend tenable : elle ne colore pas le fait
 * d'en avoir pris, elle colore un nombre que la personne a écrit de sa main.
 *
 * D'où la garde centrale de ce fichier : `null` n'est pas 1. Quelqu'un qui
 * écrit « j'ai fumé » n'a pas dit combien ; le supposer puis le colorer
 * inventerait une dose, sur le seul terrain où ce produit ne doit rien
 * inventer. Les tests de silence passent donc avant les autres.
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyserPrises, prisesDuTexte, combienDit, plusieursFois,
         PLUSIEURS, FAMILLES, familleDuSuivi } from '../server/prises.js';

const CANNABIS = FAMILLES.find(f => f.cle === 'cannabis');
const combienDe = t => prisesDuTexte(t).get('cannabis')?.combien ?? null;
const jour = (d, t) => ({ date: d, note: 5, text: t });

/* ================= ce qu'on n'invente pas ================= */

test('SANS QUANTITÉ ÉCRITE, ON NE SAIT PAS — ET CE N’EST PAS UN', () => {
  /*
   * LA GARDE LA PLUS IMPORTANTE DU FICHIER. Si l'absence valait 1, chaque
   * journée porterait une dose que personne n'a écrite, et la couleur la
   * rendrait visible — une invention affichée comme une mesure.
   */
  for (const t of ['j ai fume un peu ce soir', 'j ai fume avant de dormir', 'soiree weed'])
    assert.equal(combienDe(t), null, `« ${t} » se voit attribuer une quantité`);
});

test('UNE JOURNÉE SANS QUANTITÉ NE DÉCLENCHE PAS LE ROUGE', () => {
  /* Le texte doit NOMMER le cannabis sans dire combien : « j'ai fumé » seul
     tombe dans la famille « fumé, sans dire quoi », et le test ne testerait
     pas ce qu'il croit. */
  const r = analyserPrises(['2026-03-02', '2026-03-03', '2026-03-04']
    .map(d => jour(d, 'j ai fume de la beuh avant de dormir')), { aujourdhui: '2026-03-05' });
  const p = r.prises.find(x => x.cle === 'cannabis');
  assert.ok(p, `décor cassé : compté comme ${r.prises.map(x => x.cle).join(', ') || 'rien'}`);
  assert.equal((p.plusieurs_semaine ?? []).some(Boolean), false,
    'le rouge s’allume sur une semaine où aucune quantité n’est écrite');
  assert.deepEqual(p.combien_par_jour, {}, 'des quantités apparaissent de nulle part');
});

/* ================= ce qui est écrit compte ================= */

test('UN NOMBRE ÉCRIT EST LU, EN LETTRES COMME EN CHIFFRES', () => {
  assert.equal(combienDe('j ai fume deux joints'), 2);
  assert.equal(combienDe('j ai fume 4 joints ce soir'), 4);
  assert.equal(combienDe('j ai fume un joint'), 1);
});

test('« DES » ET « QUELQUES » VALENT PLUSIEURS, SANS INVENTER DE CHIFFRE', () => {
  // On ne transforme pas « des joints » en « 3 joints » : la personne n'a pas
  // compté, et rendre un nombre là où il n'y en a pas est la même faute que
  // rendre 1 pour une absence.
  assert.equal(combienDe('j ai fume des joints ce soir'), PLUSIEURS);
  assert.equal(combienDe('j ai fume quelques joints'), PLUSIEURS);
  assert.equal(combienDe('j ai fume plusieurs joints'), PLUSIEURS);
});

test('UN ADJECTIF ENTRE LE NOMBRE ET LE MOT NE CASSE PAS LA LECTURE', () => {
  assert.equal(combienDe('j ai fume deux gros joints'), 2);
});

test('UN NOMBRE QUI NE PORTE PAS SUR LE PRODUIT N’EST PAS UNE DOSE', () => {
  // « deux heures après le joint » : le nombre compte des heures.
  const c = combienDe('j ai fume, deux heures apres le joint j etais mort');
  assert.equal(c === 2, false, `« deux heures » est lu comme deux joints (${c})`);
});

/* ================= le seuil du rouge ================= */

test('DEUX, C’EST DÉJÀ PLUSIEURS — un joint, non', () => {
  // La règle demandée, telle quelle : « un joint c'est pas mal déjà », le
  // rouge commence à partir de deux.
  assert.equal(plusieursFois(1), false);
  assert.equal(plusieursFois(2), true);
  assert.equal(plusieursFois(PLUSIEURS), true);
  assert.equal(plusieursFois(null), false, 'une quantité inconnue allume le rouge');
});

test('EN AVOIR PARLÉ PLUSIEURS FOIS NE COMPTE PAS — mesuré, et ça m’a donné tort', () => {
  /*
   * LA RÈGLE DEMANDÉE ÉTAIT « s'il en a parlé plusieurs fois ». Implémentée,
   * puis mesurée sur un journal réel, elle se révèle fausse.
   *
   * Le 31 août, trois mentions du cannabis : « il va falloir que je fume
   * moins », « le début de la weed quotidienne c'était en mai », « là je suis
   * en train de fumer à 18h ». Une prise, une intention, un rappel — et un
   * « un joint » compté noir sur blanc à côté. La barre passait au rouge sur
   * une journée où la personne avait écrit UN.
   *
   * Écrire plusieurs fois SUR une chose n'est pas en prendre plusieurs. Et la
   * règle punissait l'écriture réflexive que ce journal existe pour
   * encourager : plus on revient dessus, plus on est peint en rouge.
   */
  assert.equal(plusieursFois(null), false);
  assert.equal(plusieursFois(1), false, 'un nombre écrit a le dernier mot, et il dit un');
});

test('UNE TOURNURE DE REPRISE NON PLUS — quatre idiomes pour zéro vraie reprise', () => {
  /*
   * LA DEUXIÈME TENTATIVE, TUÉE PAR LA MÊME MESURE. « encore un », « une
   * autre », « un deuxième » attrapaient, sur cette seule journée :
   * « c'est pas ENCORE UN prérequis pour sortir », « ENCORE UNE FOIS, c'est
   * pas un vrai argument », « j'ai vraiment UN AUTRE état ».
   *
   * C'est le piège déjà documenté sur la famille des paris : un mot qui est
   * une tournure française courante une fois désaccentué ne compte qu'avec son
   * contexte attaché, ou pas du tout.
   */
  for (const t of ['c est pas encore un prerequis pour sortir mais je vais fumer avant',
                   'encore une fois j ai fume avant de sortir',
                   'j ai vraiment un autre etat, j ai fume ce soir'])
    assert.equal(plusieursFois(combienDe(t)), false, `« ${t} » est peint en rouge`);
});

test('UN ORDINAL COLLÉ AU PRODUIT, LUI, NE PEUT RIEN VOULOIR DIRE D’AUTRE', () => {
  // Ce qui reste de la règle de reprise, une fois ses idiomes retirés.
  assert.equal(combienDe('j ai fume un deuxieme joint'), 2);
  assert.equal(combienDe('j ai fume un troisieme joint ce soir'), 3);
  assert.equal(plusieursFois(combienDe('j ai fume un deuxieme joint')), true);
});

test('LA SEMAINE PORTE LE ROUGE DÈS QU’UN DE SES JOURS L’EST', () => {
  const r = analyserPrises([
    jour('2026-03-02', 'j ai fume un joint'),
    jour('2026-03-03', 'j ai fume un joint'),
    jour('2026-03-09', 'j ai fume trois joints'),
    jour('2026-03-16', 'j ai fume un joint'),
  ], { aujourdhui: '2026-03-17' });
  const p = r.prises.find(x => x.cle === 'cannabis');
  assert.deepEqual(p.plusieurs_semaine, [false, true, false]);
  assert.deepEqual(p.par_semaine, [2, 1, 1], 'le compte de jours a changé avec la couleur');
});

test('LA COULEUR NE REMPLACE PAS LE COMPTE — les deux restent lisibles', () => {
  /*
   * Si la hauteur cessait de dire « combien de jours » pour dire l'intensité,
   * on perdrait la seule mesure que ce tableau sait faire honnêtement. Les deux
   * tableaux sont alignés sur les mêmes semaines et restent indépendants.
   */
  const r = analyserPrises(['2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']
    .map(d => jour(d, 'j ai fume cinq joints')), { aujourdhui: '2026-03-06' });
  const p = r.prises.find(x => x.cle === 'cannabis');
  assert.equal(p.par_semaine.length, p.plusieurs_semaine.length);
  assert.equal(p.par_semaine[0], 4, 'la hauteur ne dit plus le nombre de jours');
  assert.equal(p.plusieurs_semaine[0], true);
});

test('une famille déclarée par la personne lit aussi ses quantités', () => {
  const f = familleDuSuivi({ cle: 'sien:a', nom: 'mon anxio', mots: 'anxio', genre: 'traitement' });
  assert.equal(prisesDuTexte('j ai pris deux anxios ce soir', [f]).get('sien:a')?.combien, 2);
  assert.equal(prisesDuTexte('j ai pris mon anxio', [f]).get('sien:a')?.combien, null);
});

test('combienDit ne rend rien sans expression — pas une erreur, pas un zéro', () => {
  assert.equal(combienDit('deux joints', null), null);
  assert.equal(combienDit('', CANNABIS.mots), null);
});

test('DEUX NOMBRES DIFFÉRENTS LE MÊME JOUR : ON N’EN CHOISIT AUCUN', () => {
  /*
   * LE DÉFAUT, MESURÉ SUR UN JOURNAL RÉEL. Le 4 septembre : « je viens de
   * prendre 6 anxios », puis « j'ai déjà pris 12 anxio et j'ai survécu ». Le
   * second est un souvenir, pas une dose du jour — et garder le plus grand
   * affichait 12 pour une journée à 6.
   *
   * On ne sait pas trancher lequel est celui d'aujourd'hui. Deviner
   * afficherait un chiffre que personne n'a écrit pour ce jour-là ; on rend
   * « plusieurs », qui reste vrai. La couleur ne bouge pas : elle ne regarde
   * que « au moins deux ».
   */
  const t = 'j ai pris 6 anxios ce soir. j ai deja pris 12 anxio et j ai survecu.';
  const f = familleDuSuivi({ cle: 'sien:a', nom: 'a', mots: 'anxio' });
  const v = prisesDuTexte(t, [f]).get('sien:a');
  assert.equal(v?.combien, PLUSIEURS, `la journée affirme « ${v?.combien} »`);
  assert.equal(plusieursFois(v.combien), true, 'et la couleur, elle, doit rester rouge');
});

test('LE MÊME NOMBRE RÉPÉTÉ RESTE CE NOMBRE', () => {
  // La moitié discriminante : sinon on aurait juste remplacé tous les chiffres
  // par « plusieurs » dès qu'une famille est nommée deux fois.
  const f = familleDuSuivi({ cle: 'sien:a', nom: 'a', mots: 'anxio' });
  assert.equal(prisesDuTexte('j ai pris deux anxios. encore deux anxios apres.', [f]).get('sien:a')?.combien, 2);
});
