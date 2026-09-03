/**
 * LA VEILLE : DEUX SIGNES, ET CE QUI LES DÉCLENCHE.
 *
 * « Détecter des patterns destructeurs, des dangers, des périodes à risque. »
 * C'est le premier mot du produit. Jusqu'ici la seule chose qui s'en approchait
 * était une pastille « crise 5 » à côté de « création 3 » — le même poids
 * visuel pour cinq passages sur une crise et trois sur un projet.
 *
 * L'ASYMÉTRIE QUI DÉCIDE DE TOUT. Manquer un rouge, c'est manquer la seule
 * chose que cette application a promis de voir. En poser un faux, c'est
 * apprendre à quelqu'un à ignorer ses propres alertes — et un signe qu'on
 * ignore ne sert plus à rien le jour où il est vrai.
 *
 * D'où : le JAUNE est large, le ROUGE est étroit. Ce fichier tient les deux
 * bords, et surtout le second — c'est là que les faux positifs feraient le
 * plus de dégâts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { niveauDuTexte, veilleDuJour, pireNiveau, DIT, AIDE } from '../server/veille.js';

/* ============================ le jaune ============================ */

test('parler de suicide suffit, même en question', () => {
  /*
   * « De quoi le suicide est mauvais ? » posé au compagnon à 5 h du matin
   * n'est pas un passage à l'acte, et ce n'est pas non plus une journée comme
   * une autre. C'est exactement ce qu'un signe jaune veut dire.
   */
  const r = niveauDuTexte('De quoi le suicide est mauvais ?');
  assert.equal(r.niveau, 'jaune');
  assert.equal(r.extrait, 'De quoi le suicide est mauvais ?');
});

test('les formes qui n’emploient pas le mot comptent aussi', () => {
  for (const p of ['j\'ai plus envie de vivre', 'je veux en finir', 'envie de crever',
                   'des idéations depuis lundi', 'après ma TS de mars']) {
    assert.equal(niveauDuTexte(p).niveau, 'jaune', `« ${p} » n’a pas été vu`);
  }
});

test('« ts » est une abréviation, pas une suite de lettres', () => {
  // Sans frontières de mot, « ts » attrape la moitié du dictionnaire.
  assert.equal(niveauDuTexte('les arts et les sports, tout ça').niveau, null);
  assert.equal(niveauDuTexte('mots croisés et chats').niveau, null);
});

/* ============================ le rouge ============================ */

test('un mot qui ne peut rien vouloir dire d’autre suffit', () => {
  for (const p of ['scarification hier soir', 'je me suis tailladé le bras',
                   'automutilation, encore']) {
    assert.equal(niveauDuTexte(p).niveau, 'rouge', `« ${p} » n’a pas été vu`);
  }
});

test('LA GARDE QUI COMPTE : une coupure sans crise n’est pas une blessure', () => {
  /*
   * « Je me suis coupé en cuisinant » est le faux rouge le plus facile à
   * produire, et le plus coûteux : il apprend à ignorer le signe. Une blessure
   * ambiguë demande donc un contexte de crise DANS LA MÊME JOURNÉE.
   */
  assert.equal(niveauDuTexte('je me suis coupé en cuisinant ce midi, rien de grave').niveau, null);
  assert.equal(niveauDuTexte('je me suis brûlé avec la casserole').niveau, null);
  assert.equal(niveauDuTexte('grosse entaille dans le bois de la table').niveau, null);
});

test('la même phrase, dans une journée de crise, devient rouge', () => {
  const r = niveauDuTexte('je me suis coupé',
                          { contexteDuJour: 'j en peux plus, je pense au suicide depuis ce matin' });
  assert.equal(r.niveau, 'rouge');
  assert.equal(r.extrait, 'je me suis coupé');
});

test('UN FAIT ANCIEN RACONTÉ n’est pas une blessure de ce jour-là', () => {
  /*
   * La personne revient sur ce qui lui est arrivé — « le lendemain de ma
   * scarification en mai ». Ce n'est pas un geste du jour ; le compter rouge
   * « une blessure est écrite ce jour-là » est le faux positif qui apprend à
   * ignorer le signe. Il descend en jaune « évoqué », sans 3114.
   */
  const r = niveauDuTexte("Le lendemain de ma scarification en mai, je suis allé au travail direct");
  assert.equal(r.niveau, 'jaune', 'un fait ancien raconté ne doit pas être rouge');
  assert.equal(r.motifs[0].genre, 'evoque_passe');

  for (const p of ['ma scarification de 2019', 'je me suis tailladé quand j’étais ado',
                   'mon automutilation à l’époque']) {
    assert.equal(niveauDuTexte(p).niveau, 'jaune', `« ${p} » devrait être un jaune évoqué`);
  }
});

test('MAIS « hier » et « ce matin » restent un vrai rouge', () => {
  // La frontière est le passé LOINTAIN. Une scarification d'hier, ou racontée
  // avec un marqueur de maintenant, reste un rouge — mieux vaut un de trop.
  assert.equal(niveauDuTexte('scarification hier soir').niveau, 'rouge');
  assert.equal(niveauDuTexte('je me suis scarifiée ce matin').niveau, 'rouge');
  assert.equal(niveauDuTexte('je viens de me scarifier').niveau, 'rouge');
});

/* ==================== un moyen à portée ==================== */

test('UN MOYEN À PORTÉE, c’est un signe — même sans le mot suicide', () => {
  /*
   * « Là je suis devant l'ordi, je joue avec un couteau et je te parle », écrit
   * à 5 h 53. Pas un mot de suicide, pas de blessure : la première version de
   * ce fichier ne voyait RIEN. C'est pourtant le signe le plus concret qu'un
   * texte puisse porter — un moyen, à portée, maintenant.
   */
  const vrai = "Là je suis devant l'ordi, je joue avec un couteau et je te parle";
  const r = niveauDuTexte(vrai);
  assert.equal(r.niveau, 'jaune');
  assert.equal(r.motifs[0].genre, 'moyen');
  assert.equal(r.motifs[0].mot, 'couteau');

  for (const p of ["j'ai un couteau à côté là", 'le rasoir est dans ma poche',
                   'la lame devant moi', 'je tiens le cutter']) {
    assert.equal(niveauDuTexte(p).niveau, 'jaune', `« ${p} » n’a pas été vu`);
  }
});

test('IL FAUT L’OBJET ET LA PROXIMITÉ — pas seulement l’objet', () => {
  /*
   * « J'ai acheté un couteau de cuisine » n'est pas « j'ai un couteau à côté ».
   * Sans cette paire, le mot seul ferait sonner une recette de cuisine, et un
   * signe qui sonne pour une recette est un signe qu'on éteint.
   */
  /*
   * ET LE CONTEXTE NE DOIT PAS POUVOIR SE VALIDER LUI-MÊME. « Lame » était à la
   * fois une blessure possible ET un contexte de crise : la phrase se validait
   * donc elle-même et passait au ROUGE. « Il faut que je change les lames du
   * rasoir » devenait une alerte rouge — le pire faux positif possible.
   */
  for (const p of ["j'ai acheté un couteau de cuisine hier",
                   'il faut que je change les lames du rasoir',
                   'les ciseaux sont cassés']) {
    assert.equal(niveauDuTexte(p).niveau, null, `« ${p} » a sonné pour rien`);
  }
});

/* ==================== la déréalisation ==================== */

test('la déréalisation compte quand elle se NOMME', () => {
  for (const p of ['je me regarde de loin depuis ce matin',
                   'tout est irréel', "j'étais comme dans un rêve",
                   'grosse déréalisation hier soir']) {
    assert.equal(niveauDuTexte(p).niveau, 'jaune', `« ${p} » n’a pas été vu`);
  }
  assert.equal(niveauDuTexte('je me regarde de loin depuis ce matin').motifs[0].genre, 'dereel');
});

test('ON NE DEVINE PAS UN ÉTAT À LA SYNTAXE', () => {
  /*
   * Reconnaître une dissociation aux phrases qui se percutent, ou au passage à
   * la troisième personne sur soi-même, se ferait à coups de faux positifs sur
   * n'importe quel texte tapé vite, un soir, sans ponctuation. Une alerte qui
   * se déclenche parce qu'on tape mal est une alerte qu'on éteint. On préfère
   * manquer ça que le rendre inutile.
   */
  const vite = "bon alors du coup voilà j'ai fait le truc et après l'autre truc "
             + "Machin il a dit non moi je pense que si Enfin bref ça va";
  assert.equal(niveauDuTexte(vite).niveau, null);
});

/* ==================== plusieurs motifs ==================== */

test('une journée peut porter plusieurs signes, et ils se rangent par gravité', () => {
  const msgs = [
    { role: 'user', text: 'je pense au suicide depuis ce matin' },
    { role: 'user', text: "j'ai un couteau à côté là" },
    { role: 'user', text: 'je me suis scarifiée hier' }
  ];
  const v = veilleDuJour('2026-09-01', 'x', { messages: msgs });
  assert.equal(v.niveau, 'rouge');
  assert.deepEqual(v.motifs.map(m => m.genre).sort(), ['blessure', 'moyen', 'suicide']);
  // Le plus grave en premier : c'est celui qu'on lit si on n'en lit qu'un.
  assert.equal(v.motifs[0].genre, 'blessure');
});

test('le rouge l’emporte sur le jaune dans la même journée', () => {
  const msgs = [
    { role: 'user', text: 'je pense au suicide' },
    { role: 'user', text: 'je me suis scarifiée' }
  ];
  const v = veilleDuJour('2026-09-01', 'x', { messages: msgs });
  assert.equal(v.niveau, 'rouge');
  assert.equal(v.passages, 2);
});

/* ============================ ce qui ne compte pas ============================ */

test('une journée ordinaire ne reçoit rien', () => {
  const msgs = [{ role: 'user', text: "j'ai repeint la cuisine tout le week-end, ça avance" }];
  assert.equal(veilleDuJour('2026-09-01', 'x', { messages: msgs }), null);
});

test('CE QUE LE COMPAGNON RÉPOND NE DÉCLENCHE RIEN', () => {
  /*
   * Il lui arrive de nommer ce qu'il a compris — « tu parlais de te faire du
   * mal ». Un signe rouge déclenché par la phrase d'une machine serait une
   * machine qui s'alarme d'elle-même, et le signe ne dirait plus rien de la
   * personne.
   */
  const msgs = [
    { role: 'pet', text: 'tu parlais de suicide tout à l’heure, je me suis scarifié n’est pas de toi' },
    { role: 'user', text: 'journée tranquille en fait' }
  ];
  assert.equal(veilleDuJour('2026-09-01', 'x', { messages: msgs }), null);
});

test('une journée vide n’est pas une journée sans risque, c’est une journée vide', () => {
  assert.equal(veilleDuJour('2026-09-01', 'x', { messages: [] }), null);
  assert.equal(veilleDuJour('2026-09-01', 'x', { messages: [{ role: 'user', text: '  ' }] }), null);
});

/* ============================ ce qu'on en dit ============================ */

test('le pire niveau d’un ensemble de jours', () => {
  assert.equal(pireNiveau([{ niveau: 'jaune' }, { niveau: 'rouge' }, null]), 'rouge');
  assert.equal(pireNiveau([{ niveau: 'jaune' }, null]), 'jaune');
  assert.equal(pireNiveau([null, undefined]), null);
  assert.equal(pireNiveau([]), null);
});

test('les phrases sont des FAITS, jamais des consignes ni des verdicts', () => {
  /*
   * « Tu vas mal », « fais attention », « tu devrais » : la personne sait déjà
   * comment elle va, et un rappel formulé comme un reproche est un rappel
   * qu'on ferme. On dit ce qui est écrit, au passé, et c'est tout.
   */
  assert.deepEqual(Object.keys(DIT).sort(), ['blessure', 'dereel', 'evoque_passe', 'moyen', 'suicide']);
  for (const phrase of Object.values(DIT)) {
    for (const mot of ['tu devrais', 'attention', 'danger', 'grave', 'inquiét',
                       'il faut', 'arrête', 'tu vas mal']) {
      assert.equal(phrase.toLowerCase().includes(mot), false,
        `« ${phrase} » contient « ${mot} »`);
    }
  }
});

test('le 3114 existe, en toutes lettres', () => {
  // Un numéro tronqué ou reformulé est un numéro qu'on ne compose pas.
  assert.match(AIDE, /3114/);
  assert.match(AIDE, /gratuit/);
  assert.match(AIDE, /24/);
});
