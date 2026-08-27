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

const { addMessage, recentMessages, allEvents, allMotifs, addMotif, marquerMotif, motifsDesMessages,
        deleteMotif, TEINTES, OWNER } = await import('../server/db.js');
const { outilsPour } = await import('../server/api.js');
const { OUTILS } = await import('../server/chat.js');
const { deltaColor } = await import('../web/charts.js');

/* --------------------------- le catalogue --------------------------- */

/*
 * `ranger_notes` est le seul outil sans champ requis, et c'est le point : son
 * entrée n'est pas dans ses arguments, c'est le message que la personne vient
 * d'envoyer. Le modèle déclenche le rangement ; il ne dicte jamais le texte
 * rangé — sinon de la prose générée reviendrait plus tard dans « explorer un
 * thème » comme si elle l'avait écrite.
 */
const SANS_ARGUMENT = new Set(['ranger_notes']);

test("chaque outil déclare un schéma exploitable", () => {
  for (const [nom, def] of Object.entries(OUTILS)) {
    assert.ok(def.description.length > 40, `${nom} : description trop maigre`);
    assert.equal(def.input_schema.type, 'object');
    if (!SANS_ARGUMENT.has(nom)) {
      assert.ok(def.input_schema.required?.length, `${nom} : aucun champ requis`);
    }
    for (const champ of def.input_schema.required ?? []) {
      assert.ok(def.input_schema.properties[champ], `${nom} : ${champ} requis mais non décrit`);
    }
    // Un champ sans description est un champ que le modèle remplira au hasard.
    for (const [c, d] of Object.entries(def.input_schema.properties ?? {})) {
      assert.ok(d.description?.length > 10, `${nom}.${c} : description manquante`);
    }
  }
});

/* ------------------------------ motifs ------------------------------ */

/*
 * Ce test RECALCULE la rampe au lieu de faire confiance à un commentaire.
 *
 * Le test précédent affirmait `t > 150` en expliquant que « 0-150° est
 * l'échelle des notes ». C'était faux : la rampe monte jusqu'à 208° et
 * redescend par 357°. Le test passait donc en laissant six teintes sur dix en
 * collision — dont 205°, à trois degrés de « +4, une de tes meilleures
 * journées ». Un test qui garde une propriété doit la mesurer.
 */
const teinteDe = rgbStr => {
  const [r, g, b] = rgbStr.match(/\d+/g).map(Number).map(v => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return 0;
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};
const ecartAngulaire = (a, b) => { const x = Math.abs(a - b); return Math.min(x, 360 - x); };

/** La distance minimale d'une teinte à TOUTE la rampe des notes, échantillonnée. */
function distanceALaRampe(t) {
  let min = 360;
  for (let d = -4; d <= 4; d += 0.01) {
    const e = ecartAngulaire(teinteDe(deltaColor(d)), t);
    if (e < min) min = e;
  }
  return min;
}

test('aucune teinte déclarée ne peut se confondre avec une note', () => {
  for (const t of TEINTES) {
    const d = distanceALaRampe(t);
    assert.ok(d >= 20, `${t}° n'est qu'à ${d.toFixed(1)}° de la rampe des notes`);
  }
});

test('deux teintes voisines restent distinguables', () => {
  const tri = [...TEINTES].sort((a, b) => a - b);
  for (let i = 1; i < tri.length; i++) {
    assert.ok(tri[i] - tri[i - 1] >= 20, `${tri[i - 1]}° et ${tri[i]}° se ressemblent trop`);
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

/* ------------------------ ranger des notes ------------------------ */

/*
 * Le garde-fou central de cet outil n'est pas dans sa validation : c'est qu'il
 * ne prend PAS de texte. Le texte vient de la ligne `messages`, telle qu'elle a
 * été écrite. Un outil qui accepterait du texte laisserait de la prose générée
 * entrer dans le corpus, d'où elle reviendrait plus tard — dans « explorer un
 * thème », dans « tu as déjà écrit ça » — comme si la personne l'avait écrite.
 */
const { getEntry, allCarnet, rebuildEntryText } = await import('../server/db.js');

test('ranger_notes ne prend aucun texte en argument', () => {
  assert.deepEqual(Object.keys(OUTILS.ranger_notes.input_schema.properties).sort(), ['jour', 'quand']);
});

test('un message rangé quitte la journée sans quitter le fil', () => {
  const jour = '2031-03-04';
  const vecu = addMessage({ ts: `${jour}T20:00:00Z`, date: jour, role: 'user', text: 'journée courte, rien de spécial' });
  const colle = addMessage({ ts: `${jour}T20:05:00Z`, date: jour, role: 'user', text: 'mes notes de 2019 : le sevrage, les nuits blanches' });
  assert.match(getEntry(jour).text, /notes de 2019/);

  const r = outilsPour(OWNER, colle).ranger_notes({ jour: '2019-06-01' });
  assert.ok(!r.erreur, r.erreur);

  // Sorti de la journée : sinon le soir où on colle trois ans de notes devient
  // la journée la plus dense de tout le journal.
  assert.equal(getEntry(jour).text, 'journée courte, rien de spécial');
  // Mais toujours dans le fil : la personne l'a bien envoyé.
  assert.ok(recentMessages(20, OWNER).some(m => m.id === colle));
  // Et stocké mot pour mot.
  const n = allCarnet(OWNER).at(-1);
  assert.equal(n.texte, 'mes notes de 2019 : le sevrage, les nuits blanches');
  assert.equal(n.jour, '2019-06-01');
  assert.equal(n.source, 'conversation');
  assert.ok(vecu);
});

test('un message déjà rangé ne se range pas deux fois', () => {
  const jour = '2031-03-05';
  const id = addMessage({ ts: `${jour}T20:00:00Z`, date: jour, role: 'user', text: 'un carnet recopié' });
  assert.ok(!outilsPour(OWNER, id).ranger_notes({}).erreur);
  const avant = allCarnet(OWNER).length;
  assert.ok(outilsPour(OWNER, id).ranger_notes({}).erreur);
  assert.equal(allCarnet(OWNER).length, avant, 'un doublon a été créé');
});

test('une date inventée est refusée, une date absente est acceptée', () => {
  const jour = '2031-03-06';
  const mk = t => addMessage({ ts: `${jour}T20:00:00Z`, date: jour, role: 'user', text: t });
  assert.ok(outilsPour(OWNER, mk('a')).ranger_notes({ jour: 'vers 2019' }).erreur);
  assert.ok(outilsPour(OWNER, mk('b')).ranger_notes({ jour: '2099-01-01' }).erreur);
  // Sans date : « quand » recopie SES mots, et n'est jamais analysé ni trié.
  const r = outilsPour(OWNER, mk('c')).ranger_notes({ quand: 'je sais plus, vers 2019' });
  assert.ok(!r.erreur);
  const n = allCarnet(OWNER).at(-1);
  assert.deepEqual([n.jour, n.quand], [null, 'je sais plus, vers 2019']);
});

test('rebuildEntryText continue d’ignorer les messages rangés', () => {
  // Le filtre vit dans rebuildEntryText, pas dans l'outil : n'importe quel
  // message ultérieur du même jour le rappelle, et il doit rester exclu.
  const jour = '2031-03-07';
  const id = addMessage({ ts: `${jour}T20:00:00Z`, date: jour, role: 'user', text: 'vieux carnet' });
  outilsPour(OWNER, id).ranger_notes({});
  addMessage({ ts: `${jour}T21:00:00Z`, date: jour, role: 'user', text: 'et là, ma vraie journée' });
  assert.equal(rebuildEntryText(jour, OWNER), 'et là, ma vraie journée');
});

/* ---------------------- chercher un repère ---------------------- */

test('chercher_repere trouve un fait déjà posé sous d’autres mots', () => {
  outilsPour(OWNER, null).poser_repere({ date: '2021-03-02', label: 'installation à Lyon' });
  const r = outilsPour(OWNER, null).chercher_repere({ mot: 'lyon' });
  assert.match(r.message, /installation à Lyon/);
  assert.match(r.message, /2021-03-02/);
  // Insensible aux accents : « déménagement » ne doit pas rater « demenagement ».
  assert.match(outilsPour(OWNER, null).chercher_repere({ mot: 'LYON' }).message, /installation/);
  assert.match(outilsPour(OWNER, null).chercher_repere({ mot: 'zzzz' }).message, /Aucun repère/);
});

/* ------------------------- les objectifs ------------------------- */

const { allObjectifs } = await import('../server/db.js');
const { objectifBlock } = await import('../server/chat.js');

test('un objectif se pose avec une date de début, ou aujourd’hui', () => {
  const o = outilsPour(OWNER, null);
  assert.ok(!o.poser_objectif({ quoi: 'arrêter la cigarette', genre: 'conso', depuis: '2026-08-15' }).erreur);
  const p = allObjectifs(OWNER).find(x => x.quoi === 'arrêter la cigarette');
  assert.deepEqual([p.genre, p.depuis, p.tenu, p.reprises], ['conso', '2026-08-15', 1, 0]);
  // Un genre inconnu retombe sur le jalon plutôt que d'échouer : c'est une
  // icône, pas une donnée.
  assert.ok(!o.poser_objectif({ quoi: 'lire le soir', genre: 'nimportequoi' }).erreur);
  assert.equal(allObjectifs(OWNER).find(x => x.quoi === 'lire le soir').genre, 'jalon');
});

test('une rupture n’efface pas ce qui avait été tenu', () => {
  // « rompu, après onze jours » doit rester lisible : remettre depuis à la date
  // de rupture effacerait le seul chiffre qui compte.
  const o = outilsPour(OWNER, null);
  o.poser_objectif({ quoi: 'courir le matin', genre: 'sport', depuis: '2026-08-01' });
  const id = allObjectifs(OWNER).find(x => x.quoi === 'courir le matin').id;
  o.marquer_objectif({ id, tenu: false, date: '2026-08-12' });
  const rompu = allObjectifs(OWNER).find(x => x.id === id);
  assert.deepEqual([rompu.tenu, rompu.depuis, rompu.reprises], [0, '2026-08-01', 0]);
  // La reprise, elle, redémarre la série et compte la reprise.
  o.marquer_objectif({ id, tenu: true, date: '2026-08-20' });
  const repris = allObjectifs(OWNER).find(x => x.id === id);
  assert.deepEqual([repris.tenu, repris.depuis, repris.reprises], [1, '2026-08-20', 1]);
});

test('marquer « tenu » deux fois ne compte pas deux reprises', () => {
  const o = outilsPour(OWNER, null);
  o.poser_objectif({ quoi: 'écrire chaque soir', genre: 'jalon', depuis: '2026-08-01' });
  const id = allObjectifs(OWNER).find(x => x.quoi === 'écrire chaque soir').id;
  o.marquer_objectif({ id, tenu: true, date: '2026-08-10' });
  o.marquer_objectif({ id, tenu: true, date: '2026-08-11' });
  assert.equal(allObjectifs(OWNER).find(x => x.id === id).reprises, 0);
});

test('les dates inventées et les doublons sont refusés', () => {
  const o = outilsPour(OWNER, null);
  assert.ok(o.poser_objectif({ quoi: 'x', genre: 'conso' }).erreur, 'libellé trop court');
  assert.ok(o.poser_objectif({ quoi: 'boire moins', genre: 'conso', depuis: 'un jour' }).erreur);
  assert.ok(o.poser_objectif({ quoi: 'boire moins', genre: 'conso', depuis: '2099-01-01' }).erreur);
  assert.ok(!o.poser_objectif({ quoi: 'boire moins', genre: 'conso' }).erreur);
  assert.ok(o.poser_objectif({ quoi: 'BOIRE MOINS', genre: 'conso' }).erreur, 'doublon accepté');
  assert.ok(o.marquer_objectif({ id: 9999, tenu: false }).erreur);
});

test('le bloc de contexte compte les jours à la place du modèle', () => {
  // « tenu depuis 2026-08-15 » demande une soustraction de dates, et un modèle
  // la rate assez souvent pour que ça vaille la peine de la faire ici.
  const bloc = objectifBlock(
    [{ id: 1, quoi: 'arrêter la cigarette', depuis: '2026-08-15', tenu: 1, reprises: 2 }],
    '2026-08-27');
  assert.match(bloc, /tenu depuis 12 jours/);
  assert.match(bloc, /2 reprises/);
  const rompu = objectifBlock(
    [{ id: 2, quoi: 'courir', depuis: '2026-08-26', tenu: 0, reprises: 0 }], '2026-08-27');
  assert.match(rompu, /rompu, apres 1 jour\b/);
  assert.equal(objectifBlock([], '2026-08-27'), null);
});
