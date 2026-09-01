/**
 * LA NUIT, ET LA FORME D'UNE JOURNÉE D'ORDINATEUR.
 *
 * Les mesures arrivaient et restaient des séries : « sommeil_h 5,4 »,
 * « temps_par_contexte_s_navigateur 22 400 ». Chacune vraie, aucune lisible.
 * On ne se demande pas « combien de bascules » — on se demande « j'ai mal
 * dormi ? » et « ma journée est passée où ? ».
 *
 * Ce fichier tient les deux règles qui décident de tout :
 *   — on compare à SA propre normale, jamais à une norme ;
 *   — un archétype décrit un usage d'ordinateur, jamais une personne.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { nuitDe, archetypeDe, contextes, resumeDuJour, mediane, enMinutes, enHeure,
         surLaNuit, duree, phrasesDeLaNuit, NOM_ARCHETYPE } from '../server/allure.js';

const m = (date, cle, valeur, extra = {}) => ({ date, cle, valeur, texte: null, unite: null, source: 'x', ...extra });
const t = (date, cle, texte) => ({ date, cle, valeur: null, texte, unite: null, source: 'x' });

/* ============================ les outils ============================ */

test('une heure se lit, ou ne se lit pas — jamais à moitié', () => {
  assert.equal(enMinutes('08:23'), 503);
  assert.equal(enMinutes('23h05'), 1385);
  assert.equal(enMinutes('7:00'), 420);
  // Ce qui n'est pas une heure ne DEVIENT pas une heure.
  for (const faux of ['huit heures', '25:00', '08:99', '', null, 'demain']) {
    assert.equal(enMinutes(faux), null, `« ${faux} » est passé pour une heure`);
  }
});

test('le coucher se compare autour de MINUIT, pas autour de midi', () => {
  /*
   * Se coucher à 23 h 50 et à 00 h 10, ce sont vingt minutes d'écart. En
   * minutes depuis minuit ce sont 1 430 et 10 — vingt-trois heures. Une médiane
   * calculée là-dessus tombe en plein après-midi, et TOUTES les phrases qui en
   * sortent sont fausses, sans que rien ne le signale.
   */
  assert.equal(surLaNuit(1430), -10);
  assert.equal(surLaNuit(10), 10);
  assert.equal(Math.abs(surLaNuit(1430) - surLaNuit(10)), 20);
  assert.equal(enHeure(-10), '23:50');
});

test('la médiane, pas la moyenne : une nuit de douze heures ne déplace pas la normale', () => {
  const nuits = [420, 430, 425, 415, 840];      // quatre nuits ordinaires, une de 14 h
  assert.equal(mediane(nuits), 425);
  const moy = nuits.reduce((a, b) => a + b, 0) / nuits.length;
  assert.ok(Math.abs(moy - 425) > 60,
    `la moyenne (${Math.round(moy)}) devrait être trahie par une seule nuit`);
});

/* ============================ le sommeil ============================ */

const nuitsOrdinaires = [];
for (let i = 1; i <= 20; i++) {
  const d = `2026-05-${String(i).padStart(2, '0')}`;
  nuitsOrdinaires.push(m(d, 'sommeil_h', 7, { unite: 'h' }),
                       t(d, 'derniere_activite', '23:30'),
                       t(d, 'premiere_activite', '07:30'));
}

test('une nuit courte se dit en écart à SES nuits, pas à une norme', () => {
  const jour = [m('2026-05-21', 'sommeil_h', 5, { unite: 'h' }),
                t('2026-05-21', 'derniere_activite', '01:10'),
                t('2026-05-21', 'premiere_activite', '09:00')];
  const n = nuitDe(jour, [...nuitsOrdinaires, ...jour]);

  assert.equal(n.duree, 300);
  assert.equal(n.dureeMediane, 420);
  assert.equal(n.dureeEcart, -120);

  const dit = n.dit.map(p => p.texte).join(' | ');
  assert.match(dit, /2 h de moins que d'habitude/);
  // Couché à 01 h 10 quand la normale est 23 h 30 : 1 h 40 plus tard.
  assert.match(dit, /1 h 40 plus tard/);
  assert.match(dit, /1 h 30 plus tard/);          // levé à 9 h au lieu de 7 h 30

  /*
   * ET AUCUN VERDICT. « Trop dormi », « pas assez », « mauvaise nuit »
   * supposent une bonne quantité, et personne ici n'est en position de la
   * fixer. La phrase porte la même information, en plus précis, sans la juger.
   */
  for (const mot of ['trop', 'pas assez', 'insuffisant', 'mauvais', 'devrais', 'anormal']) {
    assert.equal(dit.toLowerCase().includes(mot), false, `« ${mot} » est un verdict`);
  }
});

test('une nuit comme les autres ne dit rien', () => {
  // Une phrase chaque matin, c'est une phrase qu'on n'ouvre plus au bout d'une
  // semaine. Le silence est le comportement par défaut.
  const jour = [m('2026-05-21', 'sommeil_h', 7.2, { unite: 'h' }),
                t('2026-05-21', 'derniere_activite', '23:40'),
                t('2026-05-21', 'premiere_activite', '07:35')];
  const n = nuitDe(jour, [...nuitsOrdinaires, ...jour]);
  assert.deepEqual(n.dit, []);
});

test('sans mesure de sommeil, l’activité de la machine le remplace — et le DIT', () => {
  /*
   * « Dernière activité » n'est pas « couché ». Faire passer l'une pour l'autre
   * inventerait une heure d'endormissement qu'aucune montre n'a relevée — et
   * quelqu'un qui lit « couché à 1 h 10 » le croira.
   */
  const jour = [t('2026-05-21', 'derniere_activite', '02:00'),
                t('2026-05-21', 'premiere_activite', '07:30')];
  const n = nuitDe(jour, [...nuitsOrdinaires, ...jour]);
  assert.equal(n.duree, null, 'une durée a été inventée');
  assert.equal(n.coucherMesure, false);
  assert.match(n.dit.find(p => p.quoi === 'coucher').texte, /dernière activité/);
  assert.equal(n.dit.some(p => /^couché/.test(p.texte)), false);
});

test('sans rien, il n’y a pas de nuit', () => {
  assert.equal(nuitDe([], []), null);
  assert.equal(nuitDe([m('2026-05-21', 'pas', 8000)], []), null);
});

test('les unités se lisent, quelle que soit leur forme', () => {
  const h = nuitDe([m('2026-05-21', 'sommeil_h', 6.5, { unite: 'h' })], []);
  const mn = nuitDe([m('2026-05-21', 'sommeil_min', 390)], []);
  const nu = nuitDe([m('2026-05-21', 'sommeil', 390)], []);       // sans unité : la grandeur décide
  assert.equal(h.duree, 390);
  assert.equal(mn.duree, 390);
  assert.equal(nu.duree, 390);
});

/* ============================ les archétypes ============================ */

const jourType = (date, { nav = 0, code = 0, social = 0, bascules = 60 }) => [
  m(date, 'temps_par_contexte_s_navigateur', nav),
  m(date, 'temps_par_contexte_s_code', code),
  m(date, 'temps_par_contexte_s_discord', social),
  m(date, 'bascules', bascules)
];

const ordinaires = [];
for (let i = 1; i <= 20; i++) {
  ordinaires.push(...jourType(`2026-06-${String(i).padStart(2, '0')}`,
    { nav: 7200, code: 10800, social: 1800, bascules: 60 }));
}

test('les contextes se rangent par familles, et l’inconnu ne pèse sur rien', () => {
  const c = contextes([m('j', 'temps_par_contexte_s_chrome', 3600),
                       m('j', 'temps_par_contexte_s_blender', 1800),
                       m('j', 'temps_par_contexte_s_zzz', 600)]);
  assert.equal(c.nav, 3600);
  assert.equal(c.travail, 1800);
  assert.equal(c.autre, 600, 'un contexte inconnu doit rester à part');
  assert.equal(c.total, 6000);
});

test('navigation continue : beaucoup de navigateur ET plus agité que d’habitude', () => {
  const j = jourType('2026-06-21', { nav: 21600, code: 1800, bascules: 190 });
  const a = archetypeDe(j, [...ordinaires, ...j]);
  assert.equal(a.cle, 'doomscroll');
  assert.equal(a.nom, NOM_ARCHETYPE.doomscroll);
  // LES PREUVES PARTENT AVEC L'ÉTIQUETTE. Sans elles on ne peut pas ne pas être
  // d'accord, et sur ce produit il faut pouvoir ne pas être d'accord.
  assert.ok(a.preuves.length >= 2);
  assert.match(a.preuves.map(p => p.valeur).join(' '), /6 h/);
  assert.match(a.preuves.map(p => p.valeur).join(' '), /190/);
});

test('curieux : autant de navigateur, mais on est RESTÉ dedans', () => {
  /*
   * C'est la distinction qui vaut le chantier. Six heures de navigateur en
   * sautant partout et six heures de navigateur sans bouger ne sont pas la même
   * journée, et un compteur d'heures seul ne les distingue pas.
   */
  const j = jourType('2026-06-21', { nav: 21600, code: 1800, bascules: 30 });
  const a = archetypeDe(j, [...ordinaires, ...j]);
  assert.equal(a.cle, 'curieux');
  assert.match(a.preuves.map(p => p.valeur).join(' '), /resté/);
});

test('concentré, tourné vers les autres, reposé', () => {
  const trav = jourType('2026-06-21', { nav: 1800, code: 21600, bascules: 40 });
  assert.equal(archetypeDe(trav, [...ordinaires, ...trav]).cle, 'productif');

  const soc = jourType('2026-06-21', { nav: 3600, code: 1800, social: 7200, bascules: 60 });
  assert.equal(archetypeDe(soc, [...ordinaires, ...soc]).cle, 'social');

  // Reposé : peu de temps devant l'écran par rapport à SES journées.
  const peu = jourType('2026-06-21', { nav: 1800, code: 1800, bascules: 20 });
  assert.equal(archetypeDe(peu, [...ordinaires, ...peu]).cle, 'repose');
});

test('une journée sans forme n’en reçoit pas une de force', () => {
  /*
   * Le défaut le plus facile serait d'étiqueter tout le monde tous les jours :
   * il y a toujours un maximum. Une journée équilibrée n'a pas de forme, et le
   * dire est plus honnête que de choisir le plus grand des cinq.
   */
  const plat = jourType('2026-06-21', { nav: 7200, code: 7200, social: 3600, bascules: 60 });
  assert.equal(archetypeDe(plat, [...ordinaires, ...plat]), null);
});

test('trois clics ne font pas une journée', () => {
  // Sous vingt minutes d'ordinateur il n'y a rien à décrire, même si 100 % de
  // ces trois minutes sont du navigateur.
  const rien = [m('2026-06-21', 'temps_par_contexte_s_chrome', 180)];
  assert.equal(archetypeDe(rien, [...ordinaires, ...rien]), null);
});

test('aucun archétype ne parle de la personne', () => {
  /*
   * « Une étiquette posée par une machine s'installe dans la tête et ne
   * s'enlève plus. » Les noms décrivent une journée d'ordinateur ; aucun ne
   * décrit un état, un trait ou une valeur morale.
   */
  const interdits = ['déprim', 'anxi', 'paresse', 'fainéant', 'accro', 'addict',
                     'malade', 'bon ', 'mauvais', 'échec', 'raté'];
  for (const nom of Object.values(NOM_ARCHETYPE)) {
    for (const mot of interdits) {
      assert.equal(nom.toLowerCase().includes(mot), false, `« ${nom} » contient « ${mot} »`);
    }
  }
});

/* ============================ le résumé ============================ */

test('le digest se résume en une ligne qui dit quelque chose', () => {
  const j = [...jourType('2026-06-21', { nav: 21600, code: 3600, bascules: 142 }),
             m('2026-06-21', 'pauses_nombre', 8)];
  const r = resumeDuJour(j);
  // « 7 champs » ne disait rien. Celle-ci dit combien, de quoi, et à quel rythme.
  assert.match(r, /d'écran/);
  assert.match(r, /% navigateur/);
  assert.match(r, /142 bascules/);
  assert.match(r, /8 pauses/);
});

test('un digest vide ne produit pas une ligne vide pleine de séparateurs', () => {
  assert.equal(resumeDuJour([]), '');
  assert.equal(resumeDuJour([m('j', 'pas', 8000)]), '');
});

/*
 * LE VRAI TRAQUEUR, ET POURQUOI RIEN NE SE DÉCLENCHAIT.
 *
 * Machi Tool ne compte pas par application mais par TITRE DE FENÊTRE :
 * `titres web:summer summer s…` vaut 1072 secondes. Aucune de ces clés ne
 * contient « temps » ni « contexte », donc aucun temps d'écran n'était compté,
 * donc aucun archétype ne se déclenchait jamais — et l'écran restait vide sans
 * rien dire.
 */
import { chiffresDuJour } from '../server/allure.js';

const titre = (d, p, v) => ({ date: d, source: 'qs', cle: `titres ${p}`, valeur: v });

test('les titres de fenêtre comptent comme du temps d’écran', () => {
  const j = [titre('2026-09-01', 'web:summer summer s', 1072),
             titre('2026-09-01', 'discord @bee - discord', 300),
             titre('2026-09-01', 'claude claude', 50)];
  const c = contextes(j);
  assert.equal(c.total, 1422, 'les titres ne sont pas comptés');
  assert.equal(c.nav, 1072);
  assert.equal(c.social, 300);
  assert.equal(c.autre, 50, 'ce qui n’est pas reconnu ne pèse sur aucun archétype');
});

test('ce qu’on fait DANS le navigateur passe devant le navigateur', () => {
  // `titres web:youtube.com …` contient « web » ET « youtube ». Avec `nav` en
  // tête, deux heures de vidéo devenaient « navigation ».
  const c = contextes([titre('2026-09-01', 'web:youtube.com youtube - x', 600),
                       titre('2026-09-01', 'web:reddit reddit', 300)]);
  assert.equal(c.video, 600);
  assert.equal(c.social, 300, 'reddit est un lieu d’échanges, pas un navigateur');
  assert.equal(c.nav, 0);
});

test('« bascules fenetre » est un COMPTE, pas des secondes', () => {
  // Il contient « fenetre ». Additionné aux secondes, il ferait une journée
  // plus longue qu'elle n'a été.
  const c = contextes([titre('2026-09-01', 'web:x', 600),
                       { date: '2026-09-01', cle: 'bascules fenetre', valeur: 77 }]);
  assert.equal(c.total, 600);
});

test('un archétype se déclenche dès le premier jour reçu', () => {
  /*
   * Les seuils se lisent contre SA propre médiane. Sur une seule journée la
   * médiane EST cette journée, l'écart vaut 1, et rien ne se déclenchait — sur
   * le tout premier écran de quelqu'un qui vient de brancher son traqueur.
   */
  const j = [titre('2026-09-01', 'web:summer', 4000), titre('2026-09-01', 'web:reddit', 2000),
             { date: '2026-09-01', cle: 'bascules', valeur: 77 }];
  const a = archetypeDe(j, j);
  assert.ok(a, 'aucun archétype sur la première journée');
  assert.ok(a.preuves.length, 'une étiquette sans ses chiffres ne se conteste pas');
});

test('la durée de sommeil se déduit du coucher et du lever quand rien ne la mesure', () => {
  const j = [t('2026-09-01', 'coucher_dit', '06:10'), t('2026-09-01', 'lever_dit', '15:30')];
  const n = nuitDe(j, j);
  assert.equal(n.duree, 9 * 60 + 20);
  assert.equal(n.dureeDeduite, true, 'c’est du temps AU LIT, et l’écran doit pouvoir le dire');
});

test('les chiffres du jour sortent prêts à être des puces', () => {
  const j = [titre('2026-09-01', 'web:summer', 3600), titre('2026-09-01', 'discord x', 1200),
             { date: '2026-09-01', cle: 'bascules', valeur: 40 },
             { date: '2026-09-01', cle: 'pauses_nombre', valeur: 5 }];
  const c = chiffresDuJour(j, j);
  assert.equal(c.ecran, 4800);
  assert.equal(c.ou.cle, 'nav');
  assert.equal(Math.round(c.ou.part * 100), 75);
  assert.equal(c.bascules, 40);
  assert.equal(c.pauses, 5);
  // Un seul jour : pas de médiane, donc pas d'écart inventé.
  assert.equal(c.ecranEcart, null);
  assert.equal(c.basculesFois, null);
});
