/**
 * Les garde-fous des outils du compagnon.
 *
 * Le prompt DÉCONSEILLE ; ce code REFUSE. Un modèle peut inventer une date, un
 * identifiant, un libellé de trois cents mots — et sur ce produit un repère mal
 * posé déplace la lecture de toute une période. C'est donc ici que ça se joue,
 * pas dans les instructions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-outils-')), 'test.db');

const { addMessage, allEvents, allMotifs, addMotif, marquerMotif, motifsDesMessages, deleteMotif,
        TEINTES, OWNER } = await import('../server/db.js');
const { outilsPour } = await import('../server/api.js');
const { OUTILS } = await import('../server/chat.js');

/* --------------------------- le catalogue --------------------------- */

test("chaque outil déclare un schéma exploitable", () => {
  for (const [nom, def] of Object.entries(OUTILS)) {
    assert.ok(def.description.length > 40, `${nom} : description trop maigre`);
    assert.equal(def.input_schema.type, 'object');
    assert.ok(def.input_schema.required?.length, `${nom} : aucun champ requis`);
    for (const champ of def.input_schema.required) {
      assert.ok(def.input_schema.properties[champ], `${nom} : ${champ} requis mais non décrit`);
    }
  }
});

/* ------------------------------ motifs ------------------------------ */

test('les teintes évitent l’échelle des notes', () => {
  // 0-150° est du rouge au vert : la couleur d'un motif ne doit jamais pouvoir
  // se lire comme « bonne journée » ou « mauvaise journée ».
  for (const t of TEINTES) assert.ok(t > 150 && t < 360, `${t}° tombe dans l'échelle des notes`);
});

test('deux teintes voisines restent distinguables', () => {
  const tri = [...TEINTES].sort((a, b) => a - b);
  for (let i = 1; i < tri.length; i++) {
    assert.ok(tri[i] - tri[i - 1] >= 8, `${tri[i - 1]}° et ${tri[i]}° se ressemblent trop`);
  }
});

test('un motif déjà nommé n’est pas recréé', () => {
  const a = addMotif({ nom: 'minimisation', mecanisme: 'il referme la phrase' });
  const b = addMotif({ nom: 'minimisation', mecanisme: 'formulé autrement' });
  assert.equal(b.id, a.id);
  assert.ok(b.existait);
  assert.equal(allMotifs().filter(m => m.nom === 'minimisation').length, 1);
});

test('une occurrence ne compte qu’une fois par message', () => {
  const m = addMotif({ nom: 'humour de défense', mecanisme: 'il blague quand ça pèse' });
  const msg = addMessage({ ts: new Date().toISOString(), date: '2026-08-27', role: 'user', text: 'haha' });
  marquerMotif(m.id, msg);
  marquerMotif(m.id, msg);
  assert.equal(allMotifs().find(x => x.id === m.id).vues, 1);
});

test('marquer un motif inexistant ne fait rien', () => {
  assert.equal(marquerMotif(999999, 1), null);
});

test('retirer un motif emporte ses occurrences', () => {
  const m = addMotif({ nom: 'à retirer', mecanisme: 'un motif posé de travers' });
  const msg = addMessage({ ts: new Date().toISOString(), date: '2026-08-27', role: 'user', text: 'x' });
  marquerMotif(m.id, msg);
  assert.ok(motifsDesMessages([msg])[msg]?.length);
  assert.equal(deleteMotif(m.id), true);
  assert.equal(motifsDesMessages([msg])[msg], undefined);
  assert.equal(deleteMotif(m.id), false);
});

/* ---------------------- les outils, en situation --------------------- */

/*
 * `outilsPour` est exporté exprès. C'est la couche qui sépare un modèle qui
 * hallucine d'une base de données, et une couche pareille se teste en direct --
 * la faire passer par un faux serveur HTTP testerait surtout le faux serveur.
 */
const outils = (onGeste = () => {}) => outilsPour(OWNER, 1, (ev, d) => { if (ev === 'geste') onGeste(d); });

test('un repère daté dans le futur est refusé', () => {
  const r = outils().poser_repere({ date: '2099-01-01', label: 'quelque chose' });
  assert.match(r.erreur, /futur/i);
  assert.equal(allEvents().filter(e => e.date === '2099-01-01').length, 0);
});

test('une date mal formée est refusée avec de quoi corriger', () => {
  for (const d of ['14 mars 2026', '2026-3-4', 'hier', '']) {
    const r = outils().poser_repere({ date: d, label: 'déménagement' });
    assert.match(r.erreur, /AAAA-MM-JJ/, `« ${d} » devrait être refusée`);
  }
});

test('un libellé qui est une phrase est refusé', () => {
  assert.match(outils().poser_repere({ date: '2026-01-05', label: 'x'.repeat(80) }).erreur, /trop long/i);
  assert.match(outils().poser_repere({ date: '2026-01-05', label: 'x' }).erreur, /trop court/i);
});

test('un repère valide est posé, diffusé, et porte son thème', () => {
  const gestes = [];
  const r = outils(g => gestes.push(g)).poser_repere({ date: '2026-01-05', label: '  déménagement   à  Lyon ' });
  assert.ok(!r.erreur, r.erreur);
  assert.equal(allEvents().find(e => e.date === '2026-01-05').label, 'déménagement à Lyon');
  assert.equal(gestes[0].type, 'repere');
  assert.equal(gestes[0].theme, 'maison');
  assert.match(r.message, /2026-01-05/);                 // le modèle sait ce qu'il a fait
});

test('le même repère ne se pose pas deux fois', () => {
  outils().poser_repere({ date: '2026-02-02', label: 'rupture avec Léa' });
  const r = outils().poser_repere({ date: '2026-02-02', label: 'RUPTURE AVEC LÉA' });
  assert.match(r.erreur, /existe déjà/i);
});

test('un motif suivi marque aussitôt le message qui l’a déclenché', () => {
  const msg = addMessage({ ts: new Date().toISOString(), date: '2026-08-27', role: 'user', text: 'bref' });
  const r = outilsPour(OWNER, msg).suivre_motif({ nom: 'esquive', mecanisme: 'il change de sujet dès que ça se précise' });
  assert.ok(!r.erreur, r.erreur);
  assert.equal(allMotifs().find(x => x.nom === 'esquive').vues, 1);
  assert.equal(motifsDesMessages([msg])[msg][0].nom, 'esquive');
});

test('un mécanisme non décrit est refusé', () => {
  assert.match(outils().suivre_motif({ nom: 'quelque chose', mecanisme: 'bof' }).erreur, /phrase/i);
  assert.match(outils().suivre_motif({ nom: 'x', mecanisme: 'une phrase assez longue' }).erreur, /deux à quatre mots/i);
});

test('marquer un identifiant inventé est refusé sans rien casser', () => {
  assert.match(outils().marquer_motif({ id: 424242 }).erreur, /aucun motif/i);
});

test('le nombre de motifs suivis est borné', () => {
  const o = outils();
  let dernier;
  for (let i = 0; i < 20; i++) {
    dernier = o.suivre_motif({ nom: `motif numero ${i}`, mecanisme: 'une phrase assez longue pour passer' });
  }
  assert.match(dernier.erreur, /maximum/i);
  assert.ok(allMotifs().length <= 12, `${allMotifs().length} motifs suivis`);
});
