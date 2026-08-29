/**
 * Tests du choix de decor.
 *
 * Ce n'est pas une analyse et ca ne doit jamais en devenir une : rien n'est dit
 * a l'utilisateur de ce qui a ete « detecte », on change la lumiere derriere
 * lui. Se tromper de scene est donc sans consequence -- mais se tromper SOUVENT
 * transformerait le fond en girouette, et un fond qui saute a chaque phrase
 * n'est plus une ambiance.
 *
 * Le cas qui compte vraiment est le dernier : les faux positifs. « Mort de
 * rire » ne doit pas convoquer une pyramide.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readMood, readMoodFil, readEnergy, DEFAUT, MOTS_MINIMUM, SCENES, SENS } from '../server/mood.js';

const T = {
  deuil: "Mon père est mort il y a trois semaines. L'enterrement était vendredi et depuis je n'arrive pas à réaliser que c'est définitif, que je ne le reverrai plus jamais.",
  existentiel: "Je tourne en rond depuis des jours sur la même question. À quoi bon tout ça, quel est le sens de tout ce qu'on fait, je ressasse et ça n'a aucun sens.",
  anxiete: "Nuit blanche encore, une crise d'angoisse vers trois heures. J'ai un poids dans la cage thoracique et des palpitations, je tremble depuis ce matin.",
  vide: "Je ne ressens plus rien du tout. Aucune envie, plus envie de rien, je suis complètement détaché de tout, un vide interieur permanent depuis des semaines.",
  calme: "Journée tranquille et reposée. Je me sens apaisé, serein, on a passé un moment doux ensemble et je suis content de ce que j'ai fait aujourd'hui.",
  decision: "J'ai un entretien décisif demain matin, il va falloir trancher et assumer. C'est un choix important que je repousse depuis des mois, je dois affronter ça."
};

test('decor : chaque registre trouve sa scene', () => {
  const attendu = {
    deuil: 'abyss', existentiel: 'mandel', anxiete: 'grain',
    vide: 'voidwell', calme: 'brume', decision: 'monolith'
  };
  for (const [cle, scene] of Object.entries(attendu)) {
    const r = readMood(T[cle], null);
    assert.equal(r.scene, scene, `${cle} → ${r.scene} au lieu de ${scene}`);
  }
});

test('decor : toutes les scenes choisies existent dans le shader', () => {
  // Une scene nommee mais absente du shader donne un fond noir, sans erreur
  // visible : le pire des echecs, celui qu'on ne remarque pas.
  for (const cle of Object.keys(T)) assert.ok(SCENES.includes(readMood(T[cle]).scene));
  assert.ok(SCENES.includes(DEFAUT));
});

test('decor : sous le minimum de mots, rien ne bouge', () => {
  // Le decor doit s'installer, pas sursauter. Un fond qui change a la premiere
  // phrase transforme une ambiance en jouet.
  const r = readMood('je suis mort de fatigue', null);
  assert.equal(r.scene, DEFAUT);
  assert.ok(r.mots < MOTS_MINIMUM);
});

test('decor : une expression figee ne convoque pas la scene grave', () => {
  // Le faux positif le plus previsible. « Mort de rire » et « vider une
  // bouteille » ne sont pas un deuil.
  const r = readMood(
    "J'étais mort de rire hier soir, on a vidé une bouteille et on a bien ri toute la nuit avec les copains, franchement une super soirée.",
    8);
  assert.notEqual(r.scene, 'abyss');
});

test('decor : deux scenes a egalite laissent le fond neutre', () => {
  // Choisir a pile ou face entre deux decors est pire que ne pas choisir.
  const r = readMood(T.deuil + ' ' + T.calme, null);
  if (r.scene !== DEFAUT) {
    const scores = Object.values(r.scores).sort((a, b) => b - a);
    assert.ok(scores[0] - scores[1] >= 2, 'une scene a gagne sans ecart suffisant');
  }
});

test('decor : la note inflechit sans decider', () => {
  // Quelqu'un qui parle de la mort de son pere un jour note 7 parle quand meme
  // de la mort.
  assert.equal(readMood(T.deuil, 7).scene, 'abyss');
  // Mais sur un texte assez long et sans lexique marque, elle pese. Il faut
  // depasser le minimum de mots, sinon les deux restent neutres -- ce qui est
  // le comportement voulu, mais ne teste rien.
  const plat = "Journée ordinaire aujourd'hui, rien de spécial à raconter, la routine habituelle "
    + 'du travail et des trajets, les mêmes gestes aux mêmes heures, une journée qui ressemble '
    + 'à toutes les autres de la semaine.';
  const bas = readMood(plat, 1);
  const haut = readMood(plat, 9);
  assert.notEqual(bas.scene, haut.scene, `${bas.scene} vs ${haut.scene}`);
});

test('decor : la racine ne se declenche pas sur une sous-chaine', () => {
  // « mort » ne doit pas sortir de « amortir », ni « vide » de « evider ».
  const r = readMood(
    "J'ai passé la journée à amortir le budget et à évider des courgettes pour le dîner, un travail long et minutieux qui m'a occupé tout l'après-midi.",
    6);
  assert.notEqual(r.scene, 'abyss');
  assert.notEqual(r.scene, 'voidwell');
});

test('energie : elle vient de l\'ecart a la reference, pas de la note brute', () => {
  // Une journee a 5 ne veut pas dire la meme chose pour quelqu'un qui vit a 4
  // et pour quelqu'un qui vit a 8.
  assert.ok(readEnergy(5, 4) > readEnergy(5, 8));
  assert.ok(readEnergy(9, 6) > readEnergy(3, 6));
  // Bornee des deux cotes : le fond ne s'eteint jamais tout a fait.
  for (const [n, ref] of [[0, 10], [10, 0], [0, 0], [10, 10]]) {
    const e = readEnergy(n, ref);
    assert.ok(e >= 0.05 && e <= 1, `energie hors bornes : ${e}`);
  }
  assert.equal(readEnergy(null, 6), 0.35);
});


/* ------------------- ce que chaque décor représente ------------------- */

test('decor : « perdu » a sa scene, et ce n’est plus un repli', () => {
  /*
   * `drift` était la scène par DÉFAUT — celle qu'on affiche quand rien ne
   * ressort — et elle n'avait donc aucun mot à elle. Mais son image est un
   * champ d'étoiles, et être perdu n'est pas la même chose que n'avoir rien
   * dit : c'est un état, il a ses mots, il mérite d'être reconnu comme les
   * autres. Elle reste le repli ; elle est maintenant aussi une réponse.
   */
  const r = readMood(
    "Je sais plus où j'en suis en ce moment, je sais pas quoi faire de mes journées, "
    + "tout est flou, j'ai plus de repères depuis des semaines et je flotte complètement.",
    null);
  assert.equal(r.scene, 'drift');
  assert.ok(r.force > 0, 'et avec une force : ce n’est pas le repli silencieux');
});

test('decor : toute scene du shader dit ce qu’elle porte', () => {
  // La phrase s'affiche dans le rail. Un décor qui change sans qu'on puisse
  // savoir ce qu'il représente reste une décoration ; nommé, il devient une
  // lecture — qu'on peut contredire, et c'est ce qui la rend acceptable.
  for (const s of SCENES) {
    assert.ok(SENS[s], `« ${s} » n'a pas de sens écrit`);
    // Il dit ce que la SCÈNE porte, jamais ce que la personne EST.
    assert.doesNotMatch(SENS[s], /\btu\b|\bte\b|\bton\b|\bta\b/i, `« ${s} » s'adresse à la personne`);
  }
});

/* ---------------------------- la récence ---------------------------- */

test('decor : le fil récent pèse plus que le fil ancien', () => {
  /*
   * Tout le fil comptait à poids égal. Une soirée où l'on avait parlé d'un
   * deuil gardait donc la pyramide à l'écran trois jours plus tard, en plein
   * milieu d'une conversation sur autre chose — et rien de ce qu'on écrivait
   * ensuite n'arrivait à la déloger, puisque le passé pesait toujours plus
   * lourd que le présent.
   */
  const perdu = "Je sais plus où j'en suis, je sais pas quoi faire, tout est flou, "
              + "j'ai plus de repères et je flotte complètement depuis des semaines.";
  const fil = [T.deuil, T.deuil, T.deuil, perdu, perdu, perdu];
  assert.equal(readMoodFil(fil).scene, 'drift', 'le deuil d’avant ne tient plus l’écran');

  /*
   * Et c'est bien la RÉCENCE qui déplace, pas une préférence pour l'une des
   * deux scènes : on retourne le fil et on regarde la part de chacune bouger.
   * Comparer les gagnants ne dirait rien ici — les deux registres n'ont pas le
   * même poids brut dans le lexique, et le plus lourd gagnerait dans les deux
   * sens sans que la récence y soit pour quoi que ce soit.
   */
  const part = f => { const s = readMoodFil(f).scores; return s.abyss / (s.abyss + s.drift); };
  assert.ok(part([...fil].reverse()) > part(fil) * 1.5,
            'le deuil doit peser bien plus quand c’est lui qu’on vient de dire');
});

test('decor : un fil vide ne lève pas et reste neutre', () => {
  assert.equal(readMoodFil([]).scene, DEFAUT);
  assert.equal(readMoodFil(null).scene, DEFAUT);
  assert.equal(readMoodFil(['', '   ']).scene, DEFAUT);
});

test('decor : les faux positifs les plus prévisibles du français', () => {
  /*
   * Trois mots qui déclenchaient à tort : « tombé » (une chute n'est pas une
   * tombe), « pas grave » (qui dit l'inverse de grave), et « je me sens »
   * (« sens » était dans le lexique de la pensée qui tourne).
   */
  const chute = readMood(
    "Je suis tombé de vélo ce matin, c'est pas grave du tout, juste une éraflure "
    + "au genou, mais du coup j'ai dû rentrer et j'ai raté mon rendez-vous.", null);
  assert.notEqual(chute.scene, 'abyss');

  const calme = readMood(
    "Journée vraiment tranquille aujourd'hui, j'ai bien dormi cette nuit, je me sens "
    + "apaisé et plutôt content d'avoir avancé, ça va nettement mieux que la semaine dernière.", null);
  assert.equal(calme.scene, 'brume', 'le calme ne doit pas partir dans la pensée qui tourne');
});
