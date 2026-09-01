/*
 * LE BANC SE MESURE LUI-MEME.
 *
 * Il sert a juger la carte : s'il se trompe, il condamne ou blanchit a tort, et
 * personne ne le verra -- une mesure fausse ressemble exactement a une mesure
 * juste. Il en a deja donne un exemple : « dépendance » et « dependance »
 * comptaient pour deux noms differents, et la stabilite du modele paraissait
 * bien pire qu'elle n'est.
 *
 * Rien ici ne touche au reseau ni au modele. On eprouve la mecanique : la coupe
 * en journees, le format du corpus, et les quatre comptages qui repondent aux
 * conditions du screen.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { couper, enJournal, corpusTexte, CAR_PAR_JOUR, JOURNEES_VISEES } from '../tools/banc-carte/corpus.mjs';
import { recouvrementBrut, boucles, ponts, appuiDesIlots, stabilite, nu } from '../tools/banc-carte/mesurer.mjs';
import { versGraphe } from '../web/relations.js';

/* ------------------------------- la coupe ------------------------------- */

/** Des blocs de sujets nettement differents, colles bout a bout. */
function conversation(blocs, parBloc = 6) {
  const tours = [];
  for (const [i, mots] of blocs.entries())
    for (let k = 0; k < parBloc; k++)
      tours.push({ qui: k % 2 ? 'moi' : "l'autre", dit: `${mots} ${mots} ${mots} phrase ${i}${k}.` });
  return tours;
}

const bornesDe = seg => { const b = []; let n = 0; for (const s of seg) { n += s.length; b.push(n); } return b; };

test('couper tombe la ou le vocabulaire change, pas la ou la longueur tombe', () => {
  /*
   * Le piege est monte pour que les deux reponses different : quatre tours sur
   * un sujet, six sur un autre, tous de meme longueur, et une taille visee de
   * cinq tours. Couper au metre donnerait 5 ; suivre le contenu donne 4, la
   * frontiere reelle. Un test ou les deux tombent au meme endroit ne prouve
   * rien -- celui d'avant etait dans ce cas, et il passait meme en ayant
   * supprime la recherche du creux.
   */
  const tours = [...conversation(['alcool bouteille verre'], 4),
                 ...conversation(['chien promenade parc'], 6)];
  const L = tours[0].qui.length + 3 + tours[0].dit.length + 1;
  const seg = couper(tours, { vise: L * 5 });
  assert.ok(seg.length >= 2, 'au moins deux segments');
  const bornes = bornesDe(seg);
  assert.ok(bornes.includes(4),
    `coupe attendue au tour 4 (le virage), obtenues : ${bornes} — au mètre elle serait à 5`);
  assert.ok(!bornes.includes(5), `coupé au mètre : ${bornes}`);
});

test('couper ne perd ni ne duplique un tour', () => {
  const tours = conversation(['a b c', 'd e f', 'g h i', 'j k l']);
  for (const vise of [80, 200, 500, 5000]) {
    const seg = couper(tours, { vise });
    const remis = seg.flat();
    assert.equal(remis.length, tours.length, `vise=${vise}`);
    assert.deepEqual(remis.map(t => t.dit), tours.map(t => t.dit), `vise=${vise}`);
  }
});

test('couper rend un seul segment quand rien ne le justifie', () => {
  const tours = conversation(['a b c']).slice(0, 3);
  assert.equal(couper(tours, { vise: 10000 }).length, 1);
});

/* ----------------------------- le journal ----------------------------- */

test('enJournal vise le nombre de journees, et aucune n’est tronquee', () => {
  const conv = { id: 'x', source: 's', sujet: 'y', qualite: '', titre: '',
                 tours: conversation(['aa bb cc', 'dd ee ff', 'gg hh ii', 'jj kk ll', 'mm nn oo']) };
  const j = enJournal(conv);
  assert.ok(j.jours.length >= JOURNEES_VISEES - 6, `${j.jours.length} journées`);
  for (const jour of j.jours)
    assert.ok(jour.texte.length <= CAR_PAR_JOUR,
      `une journée de ${jour.texte.length} signes dépasse CAR_PAR_JOUR`);
});

test('enJournal recopie les tours sans les reecrire', () => {
  const conv = { id: 'x', source: 's', sujet: 'y', qualite: '', titre: '',
                 tours: [{ qui: 'moi', dit: 'je bois le soir, chez moi' },
                         { qui: "l'autre", dit: 'combien ?' },
                         { qui: 'moi', dit: 'trois verres' }] };
  const t = corpusTexte(enJournal(conv));
  assert.match(t, /moi : je bois le soir, chez moi/);
  assert.match(t, /l'autre : combien \?/);
  assert.match(t, /moi : trois verres/);
});

test('les dates du corpus se suivent et sont bien formees', () => {
  const conv = { id: 'x', source: 's', sujet: 'y', qualite: '', titre: '',
                 tours: conversation(['aa bb', 'cc dd', 'ee ff']) };
  const j = enJournal(conv);
  for (const d of j.jours) assert.match(d.date, /^\d{4}-\d{2}-\d{2}$/);
  const ms = j.jours.map(d => Date.parse(d.date + 'T12:00:00Z'));
  for (let i = 1; i < ms.length; i++) assert.equal(ms[i] - ms[i - 1], 86400000);
});

/* --------------------------- les comptages --------------------------- */

test('nu ramene accents et casse a la meme chaine', () => {
  assert.equal(nu('Dépendance'), nu('dependance'));
  assert.equal(nu(" l’après-verre "), nu("l'apres-verre"));
  assert.notEqual(nu('les moments à plat'), nu('la dépression'));
});

test('recouvrementBrut compte les noeuds reclames par deux pistes', () => {
  const brut = {
    carte: { noeuds: [{ nom: 'le vin' }, { nom: 'le soir' }, { nom: 'ta soeur' }], liens: [] },
    pistes: [{ nom: 'dépendance', noeuds: ['le vin', 'le soir'] },
             { nom: 'solitude', noeuds: ['le soir', 'ta soeur'] }]
  };
  const r = recouvrementBrut(brut);
  assert.equal(r.n, 1);
  assert.equal(r.noeuds[0].nom, 'le soir');
  assert.deepEqual(r.noeuds[0].pistes.sort(), ['dépendance', 'solitude']);
  assert.equal(r.surTotal, 3);
});

test('recouvrementBrut ignore une piste qui nomme un noeud absent', () => {
  const brut = { carte: { noeuds: [{ nom: 'le vin' }], liens: [] },
                 pistes: [{ nom: 'a', noeuds: ['le vin', 'disparu'] },
                          { nom: 'b', noeuds: ['disparu'] }] };
  assert.equal(recouvrementBrut(brut).n, 0);
});

test('boucles voit les deux sens ecrits sur la meme paire', () => {
  const brut = { carte: { noeuds: [], liens: [
    { de: 'les moments à plat', vers: 'le vin', quoi: 'c’est là que tu sers' },
    { de: 'le vin', vers: 'les moments à plat', quoi: 'te les rend plus lourds' },
    { de: 'le vin', vers: 'le soir', quoi: 'ouvre' }
  ] } };
  const b = boucles(brut);
  assert.equal(b.n, 1);
  assert.equal(b.surPaires, 2);
  assert.equal(b.exemples[0].length, 2);
});

/* --- un petit graphe, monte comme la carte le monte --- */
function graphe() {
  const carte = {
    noeuds: [{ nom: 'a1', genre: 'activite', poids: 1, jours: [] },
             { nom: 'a2', genre: 'activite', poids: 1, jours: [] },
             { nom: 'b1', genre: 'lieu', poids: 1, jours: [] },
             { nom: 'b2', genre: 'lieu', poids: 1, jours: [] }],
    liens: [{ de: 'a1', vers: 'a2', quoi: 'précède', force: 2 },
            { de: 'b1', vers: 'b2', quoi: 'précède', force: 2 },
            { de: 'a2', vers: 'b1', quoi: 'fait retomber', force: 3 }]
  };
  const pistes = [{ nom: 'un', teinte: 200, noeuds: ['a1', 'a2'] },
                  { nom: 'deux', teinte: 300, noeuds: ['b1', 'b2'] }];
  return versGraphe(carte, pistes);
}

test('ponts trouve le lien qui traverse deux ilots, et lui seul', () => {
  const p = ponts(graphe());
  assert.equal(p.liens, 1);
  assert.equal(p.noeuds, 2);
  assert.match(p.verbes[0], /fait retomber/);
});

test('appuiDesIlots compte dedans, dehors et la densite', () => {
  const a = appuiDesIlots(graphe());
  assert.equal(a.length, 2);
  for (const x of a) {
    assert.equal(x.n, 2);
    assert.equal(x.dedans, 1);
    assert.equal(x.dehors, 1);      // le pont
    assert.equal(x.densite, 1);     // 1 lien sur 1 paire possible
    assert.equal(x.appui, 0.5);
  }
});

test('appuiDesIlots rend une densite nulle pour un ilot sans lien interne', () => {
  const carte = { noeuds: [{ nom: 'x', genre: 'activite', poids: 1, jours: [] },
                           { nom: 'y', genre: 'activite', poids: 1, jours: [] },
                           { nom: 'z', genre: 'lieu', poids: 1, jours: [] }],
                  liens: [{ de: 'x', vers: 'z', quoi: 'précède', force: 1 },
                          { de: 'y', vers: 'z', quoi: 'précède', force: 1 }] };
  const G = versGraphe(carte, [{ nom: 'seule', teinte: 200, noeuds: ['x', 'y'] }]);
  const a = appuiDesIlots(G).find(i => i.nom === 'seule');
  assert.equal(a.dedans, 0);
  assert.equal(a.densite, 0);
  // Et pourtant l'ilot existe, avec ses deux membres : c'est exactement le cas
  // que la carte dessine aujourd'hui a pleine enveloppe.
  assert.equal(a.n, 2);
});

/* ----------------------------- la stabilite ----------------------------- */

const vue = (carte, pistes) => ({ lu: { pistes, carte }, G: versGraphe(carte, pistes) });

test('stabilite rend 100 % sur deux lectures identiques', () => {
  const carte = { noeuds: [{ nom: 'a1', genre: 'activite', poids: 1, jours: [] },
                           { nom: 'a2', genre: 'activite', poids: 1, jours: [] }],
                  liens: [{ de: 'a1', vers: 'a2', quoi: 'précède', force: 2 }] };
  const pistes = [{ nom: 'un', teinte: 200, noeuds: ['a1', 'a2'] }];
  const s = stabilite([vue(carte, pistes), vue(carte, pistes)]);
  assert.equal(s.pistesJ, 1);
  assert.equal(s.noeudsJ, 1);
  assert.equal(s.partTenue, 1);
});

test('stabilite ne compte pas un accent pour une divergence', () => {
  const c = n => ({ noeuds: [{ nom: n, genre: 'activite', poids: 1, jours: [] },
                             { nom: 'a2', genre: 'activite', poids: 1, jours: [] }],
                    liens: [{ de: n, vers: 'a2', quoi: 'précède', force: 2 }] });
  const s = stabilite([vue(c('l’après-verre'), [{ nom: 'dépendance', teinte: 200, noeuds: ['l’après-verre', 'a2'] }]),
                       vue(c("l'apres-verre"), [{ nom: 'dependance', teinte: 200, noeuds: ["l'apres-verre", 'a2'] }])]);
  assert.equal(s.pistesJ, 1, 'dépendance et dependance sont le même nom');
  assert.equal(s.noeudsJ, 1);
});

test('stabilite separe la mesure stricte de l’indulgente', () => {
  const c = n => ({ noeuds: [{ nom: n, genre: 'activite', poids: 1, jours: [] },
                             { nom: 'a2', genre: 'activite', poids: 1, jours: [] }],
                    liens: [{ de: n, vers: 'a2', quoi: 'précède', force: 2 }] });
  // « le vin le soir » et « le vin du soir » : la meme chose, dite autrement.
  const s = stabilite([vue(c('le vin le soir'), []), vue(c('le vin du soir'), [])]);
  assert.ok(s.noeudsJ < 1, 'strictement, deux noms differents');
  assert.equal(s.noeudsMou, 1, 'les memes mots pleins');
});

test('stabilite voit une paire qui ne tient pas d’une lecture a l’autre', () => {
  const noeuds = ['a', 'b', 'c'].map(nom => ({ nom, genre: 'activite', poids: 1, jours: [] }));
  const liens = [{ de: 'a', vers: 'b', quoi: 'précède', force: 2 },
                 { de: 'b', vers: 'c', quoi: 'précède', force: 2 }];
  const un = vue({ noeuds, liens }, [{ nom: 'p', teinte: 200, noeuds: ['a', 'b'] }]);
  const deux = vue({ noeuds, liens }, [{ nom: 'p', teinte: 200, noeuds: ['b', 'c'] }]);
  const s = stabilite([un, deux]);
  // a|b est affichee groupee dans la premiere, separee dans la seconde.
  assert.equal(s.pairesAffichees, 1);
  assert.equal(s.pairesTenues, 0);
  assert.equal(s.partTenue, 0);
});

test('stabilite refuse de conclure sur une seule lecture', () => {
  assert.equal(stabilite([]), null);
  assert.equal(stabilite([{ lu: { pistes: [] }, G: versGraphe({ noeuds: [], liens: [] }, []) }]), null);
});
