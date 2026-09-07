/**
 * Le mode pudique, la ou le CSS ne va pas.
 *
 * Toute l'interface eteint ses lettres avec une regle de style ; la carte des
 * relations, elle, PEINT ses libelles. Une regle qui protege partout sauf sur
 * un ecran ne protege pas : ce fichier verifie que la toile obeit aussi.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { versGraphe, dessinerRelations, cadrer } from '../web/relations.js';
import { disposer } from '../web/carte.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CARTE = {
  noeuds: [{ nom: 'Léa', genre: 'personne', poids: 3, jours: [{ d: '2026-08-01', e: -1.2 }, { d: '2026-08-04', e: 0.8 }] },
           { nom: 'les nuits courtes', genre: 'corps', poids: 2 }],
  liens: [{ de: 'Léa', vers: 'les nuits courtes', quoi: 'précède', force: 3 }]
};

/** Une toile qui ne dessine rien et retient tout ce qu'on lui a demande d'ecrire. */
function fausseToile() {
  const ecrits = [];
  const rien = () => {};
  return {
    ecrits,
    ctx: {
      setTransform: rien, clearRect: rien, beginPath: rien, moveTo: rien, arc: rien,
      quadraticCurveTo: rien, roundRect: rien, fill: rien, stroke: rien,
      createRadialGradient: () => ({ addColorStop: rien }),
      measureText: t => ({ width: String(t).length * 6 }),
      fillText: t => { ecrits.push(String(t)); }
    }
  };
}

const peindre = (opts) => {
  const G = versGraphe(CARTE);
  const dispo = disposer(G, 600, 400);
  cadrer(dispo.pts, 600, 400);
  const t = fausseToile();
  dessinerRelations(t.ctx, G, dispo, { largeur: 600, hauteur: 400, survol: 0, ...opts });
  return t.ecrits;
};

test('sans le mode pudique, la carte ecrit ses noms et ses verbes', () => {
  const ecrits = peindre({});
  assert.ok(ecrits.some(t => t.includes('Léa')));
  assert.ok(ecrits.some(t => t.includes('les nuits courtes')));
  assert.ok(ecrits.some(t => t.includes('précède')));
});

test('en mode pudique, aucun nom ni verbe ne touche la toile', () => {
  const ecrits = peindre({ pudique: true });
  const tout = ecrits.join(' ');
  for (const mot of ['Léa', 'nuits', 'courtes', 'précède']) {
    assert.ok(!tout.includes(mot), `« ${mot} » est encore peint : ${tout}`);
  }
  assert.ok(tout.includes('•'), 'il ne reste rien du tout : la carte a perdu ses libellés');
});

test('le masque garde la longueur du mot, donc la forme de la carte', () => {
  // Un libelle qui retrecit deplace les bornes de son cadre et fait respirer la
  // carte au moment ou on l'allume : on remplace signe pour signe.
  const clair = peindre({}), masque = peindre({ pudique: true });
  assert.equal(masque.length, clair.length);
  for (let i = 0; i < clair.length; i++) assert.equal(masque[i].length, clair[i].length);
});

test('les dates des journees restent lisibles', () => {
  // Une date ne raconte pas ce qu'on a vecu ce jour-la, et sans elle un point
  // qui grossit sous le curseur n'est plus qu'un point qui grossit.
  const G = versGraphe(CARTE);
  const dispo = disposer(G, 600, 400);
  cadrer(dispo.pts, 600, 400);
  const t = fausseToile();
  dessinerRelations(t.ctx, G, dispo,
    { largeur: 600, hauteur: 400, survol: -1, pudique: true,
      jourSurvol: { noeud: 0, date: '2026-08-04', x: 100, y: 100 } });
  assert.ok(t.ecrits.some(x => x.includes('2026') || x.includes('08')),
    `la date a disparu avec les mots : ${t.ecrits.join(' | ')}`);
});

/* ------------------------------------------------------------------ */

/*
 * Le reglage lui-meme. setSettings() jette toute cle absente de
 * DEFAULT_SETTINGS : un mode ajoute a l'interface et oublie dans le schema
 * s'allume, s'eteint au rechargement, et personne ne voit pourquoi.
 */
process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-pud-')), 'test.db');
const { getSettings, setSettings, publicSettings } = await import('../server/db.js');
const U = 'test-pudique';

test('le mode pudique est eteint par defaut, et se retient une fois allume', () => {
  assert.equal(getSettings(U).pudique, false);
  setSettings({ pudique: true }, U);
  assert.equal(getSettings(U).pudique, true);
  // Le navigateur ne lit que la version publique : c'est elle qui pose
  // l'attribut sur la racine au chargement.
  assert.equal(publicSettings(getSettings(U)).pudique, true);
  setSettings({ pudique: false }, U);
  assert.equal(getSettings(U).pudique, false);
});

/*
 * AUCUN NOM NE DOIT SORTIR DE LA TOILE.
 *
 * Vu à l'écran : un rond en haut de la carte, sans nom. Ce n'était pas une
 * donnée manquante — le nom était peint au-dessus du bord. Le cadrage réserve
 * de la place pour les NŒUDS ; au-dessus d'un nœud il y a son anneau de
 * journées puis son nom, et la marge ne les comptait pas.
 */
test('le nom du nœud le plus haut reste dans la toile', () => {
  const noeuds = ['la solitude', 'le travail', 'les nuits courtes', 'la fatigue'].map((nom, i) => ({
    nom, genre: ['etat', 'activite', 'corps', 'corps'][i], poids: 3 - (i % 2),
    // beaucoup de journées : c'est ce qui fait grossir l'anneau, donc monter le nom
    jours: Array.from({ length: 40 + i * 12 }, (_, k) =>
      ({ d: new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10), e: 0 }))
  }));
  const carte = { noeuds, liens: [{ de: 'la solitude', vers: 'les nuits courtes', quoi: 'précède', force: 3 }] };
  for (const [L, H] of [[662, 600], [900, 420], [340, 300]]) {
    const G = versGraphe(carte);
    const dispo = disposer(G, L, H);
    cadrer(dispo.pts, L, H, 62, 66);   // la marge sans îlots, telle que `monterCarte` la passe
    const ecrits = [];
    const rien = () => {};
    const ctx = {
      setTransform: rien, clearRect: rien, beginPath: rien, moveTo: rien, arc: rien,
      quadraticCurveTo: rien, roundRect: rien, fill: rien, stroke: rien,
      createRadialGradient: () => ({ addColorStop: rien }),
      measureText: t => ({ width: String(t).length * 6 }),
      fillText: (t, x, y) => ecrits.push({ t: String(t), x, y })
    };
    dessinerRelations(ctx, G, dispo, { largeur: L, hauteur: H, survol: -1 });
    const dehors = ecrits.filter(e => e.y - 12 < 0 || e.y > H);
    assert.deepEqual(dehors.map(e => `${e.t} @ y=${Math.round(e.y)} (toile ${L}×${H})`), []);
  }
});
