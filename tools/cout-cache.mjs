#!/usr/bin/env node
/**
 * LA SONDE DE COUT DU COMPAGNON.
 *
 * Elle rejoue trois echanges EXACTEMENT comme `POST /api/chat` les assemble
 * (systeme, outils, memoire, fil, echos) sur une base a elle, seedee, et lit
 * les quatre compteurs de chaque reponse : entree pleine, ecrit en cache, relu
 * du cache, sortie. Entre le premier et le deuxieme echange, elle marque un
 * motif, comme le compagnon le fait avec `marquer_motif` ; le fil compte plus
 * de vingt-cinq messages, comme n'importe quelle soiree. C'est le scenario
 * ordinaire, pas un cas limite.
 *
 * Ce qu'on regarde : au troisieme echange, `relu du cache` doit porter presque
 * tout le prompt et `entree pleine` presque rien. Si c'est l'inverse, un
 * invalidateur silencieux est a l'oeuvre -- et la sonde sort en erreur.
 *
 *   ANTHROPIC_API_KEY=... node tools/cout-cache.mjs                  # le code d'ici
 *   ANTHROPIC_API_KEY=... node tools/cout-cache.mjs --racine ../avant # une autre version
 *   node tools/cout-cache.mjs --sec                                   # sans reseau : octets du prefixe
 *
 * `--racine` pointe vers un autre clone (par ex. `git worktree add ../avant fdbad08`)
 * pour comparer avant / apres avec la MEME sonde. `--sec` ne depense rien : il
 * mesure, entre deux requetes consecutives, la part du prompt precedent qui
 * reapparait octet pour octet en prefixe -- c'est exactement ce que le cache
 * peut relire. Les jetons y sont estimes (3,3 caracteres par jeton, en francais).
 *
 * Elle depense de vrais jetons : trois requetes courtes, quelques centimes.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const SEC = args.includes('--sec');
const ICI = join(dirname(fileURLToPath(import.meta.url)), '..');
const RACINE = resolve(opt('--racine', ICI));
const MODELE = opt('--modele', 'claude-sonnet-5');
const JOUR = '2026-09-05';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-sonde-')), 'sonde.db');
const charger = f => import(pathToFileURL(join(RACINE, 'server', f)).href);
const db = await charger('db.js');
const api = await charger('api.js');
const chat = await charger('chat.js');
const usage = await charger('usage.js').catch(() => ({}));
const { OWNER } = db;

/* ---------- les tarifs, en dollars par million ---------- */
const TARIFS = usage.PRICES ?? {
  'claude-opus-5': { in: 5, out: 25 }, 'claude-sonnet-5': { in: 2, out: 10 }, 'claude-haiku-4-5': { in: 1, out: 5 }
};
const LU = usage.LECTURE_CACHE ?? 0.1, ECRIT = usage.ECRITURE_CACHE ?? 1.25;
const prix = TARIFS[MODELE] ?? TARIFS['claude-sonnet-5'];
const cout = u => (u.input * prix.in + u.sortie * prix.out + u.lu * prix.in * LU + u.ecrit * prix.in * ECRIT) / 1e6;
const coutSansCache = u => ((u.input + u.lu + u.ecrit) * prix.in + u.sortie * prix.out) / 1e6;

/* ---------- une personne plausible : quatorze journees, des reperes, des motifs ---------- */
db.setSettings({ memoryDays: 14, anthropicModelChat: MODELE, anthropicEffort: 'low' }, OWNER);
const JOURNEES = [
  "réveil à 11h, encore. j'ai traîné au lit avec le téléphone jusqu'à 13h. rien fait de la journée, à part une lessive que j'ai laissée dans la machine.",
  "j'ai vu Léa au café. c'était bien sur le moment et après je me suis senti vidé, comme si j'avais joué un rôle pendant deux heures.",
  "rendez-vous CAF demain. ça serre déjà. j'ai relu trois fois la convocation, je ne sais pas ce qu'ils veulent.",
  "j'y suis allé. c'était rien, dix minutes, la dame était gentille. j'ai dormi tout l'après-midi en rentrant.",
  "nuit blanche. j'ai regardé des vidéos jusqu'à 6h. je me suis levé à 15h avec l'impression d'avoir perdu la journée avant qu'elle commence.",
  "j'ai marché une heure au bord du canal. c'est la première fois depuis longtemps que ma tête s'est tue un moment.",
  "maman a appelé. elle a demandé si j'avais cherché du boulot. j'ai dit oui. j'ai raccroché et j'ai pleuré, je sais pas pourquoi.",
  "journée plate. mangé des pâtes, joué, dormi. pas triste, pas rien. juste rien.",
  "je devais sortir voir Théo et j'ai annulé à 18h en disant que j'étais malade. j'étais pas malade. j'ai passé la soirée à m'en vouloir.",
  "j'ai rangé la chambre. tout. ça m'a pris quatre heures et après je me suis assis par terre au milieu et j'ai pas bougé.",
  "insomnie encore. 4h du matin, je pense à des trucs de quand j'avais douze ans. aucun rapport avec maintenant.",
  "bonne journée, vraiment. j'ai codé un petit truc, ça marchait, j'ai envoyé un message à Léa pour lui montrer.",
  "la peur est revenue ce matin sans raison. comme un bruit de fond. j'ai rien fait pour qu'elle vienne, j'ai rien fait pour qu'elle parte.",
  "j'ai dit à Théo que j'allais mal. c'est la première fois que je le dis à quelqu'un comme ça, sans blague derrière."
];
JOURNEES.forEach((t, i) => {
  const d = new Date(Date.UTC(2026, 7, 20 + i)).toISOString().slice(0, 10);
  db.setNote(d, [3, 5, 4, 6, 2, 7, 3, 5, 3, 5, 2, 8, 3, 6][i], OWNER);
  db.addMessage({ ts: `${d}T20:00:00.000Z`, date: d, source: 'web', role: 'user', text: t, userId: OWNER });
});
db.setAnchor(2, 'au fond', 'je ne sors pas, je ne réponds à personne', OWNER);
db.setAnchor(5, 'plat', 'la journée passe sans moi', OWNER);
db.setAnchor(8, 'vivant', 'j’ai envie de montrer ce que j’ai fait', OWNER);
for (const [date, label] of [['2026-03-02', 'fin avec Camille'], ['2026-05-14', 'arrêt du boulot'],
                             ['2026-07-01', 'retour chez les parents'], ['2026-08-25', 'rendez-vous CAF'],
                             ['2026-09-01', 'dit à Théo que ça va mal']]) {
  db.addEvent({ date, label, userId: OWNER });
}
const MOTIFS = [
  db.addMotif({ nom: 'anticiper', mecanisme: 'la peur monte la veille d’une sortie, et retombe quand c’est fait', userId: OWNER }),
  db.addMotif({ nom: 'minimiser', mecanisme: 'dire « c’était rien » juste après avoir décrit ce qui a coûté', userId: OWNER }),
  db.addMotif({ nom: 'annuler tard', mecanisme: 'décommander une sortie dans l’heure qui précède, puis s’en vouloir', userId: OWNER }),
  db.addMotif({ nom: 'se vider après', mecanisme: 'un bon moment avec quelqu’un, puis une chute dès le retour', userId: OWNER })
];
// Des vues inegales : c'est ce qui fait bouger l'ordre « par frequence ».
const premier = db.recentUserMessages(1, OWNER)[0].id;
[[0, 3], [1, 2], [2, 2], [3, 1]].forEach(([i, n]) => { for (let k = 0; k < n; k++) db.marquerMotif(MOTIFS[i].id, premier + 100 * i + k, OWNER); });

/* ---------- une soiree deja bien entamee : quinze echanges dans le fil ---------- */
const SOIREE = [
  ["salut", "salut. comment s'est passée la journée ?"],
  ["bof. levé tard encore", "tard comment ?"],
  ["13h. j'ai traîné", "et après 13h ?"],
  ["j'ai mangé, j'ai joué un peu, j'ai rien fait", "tu as joué à quoi ?"],
  ["hades, deux heures", "ça t'a fait du bien ou c'était pour passer le temps ?"],
  ["passer le temps je crois", "et le reste de l'après-midi ?"],
  ["j'ai dormi", "une sieste, ou tu t'es rendormi pour de bon ?"],
  ["rendormi. jusqu'à 18h", "tu t'es réveillé comment ?"],
  ["lourd. avec la boule", "la boule de quoi ?"],
  ["je sais pas. de rien. elle est là", "elle était là ce matin déjà ?"],
  ["non. elle est venue en dormant", "tu as mangé ce soir ?"],
  ["des pâtes", "ok. et là, maintenant, ça va comment ?"],
  ["ça va. c'est juste lourd", "lourd où ?"],
  ["poitrine", "d'accord. tu as quelque chose de prévu demain ?"],
  ["oui justement", "quoi ?"]
];
let t0 = Date.parse(`${JOUR}T19:00:00.000Z`);
for (const [moi, lui] of SOIREE) {
  db.addMessage({ ts: new Date(t0 += 60_000).toISOString(), date: JOUR, source: 'web', role: 'user', text: moi, userId: OWNER });
  db.addMessage({ ts: new Date(t0 += 60_000).toISOString(), date: JOUR, source: 'web', role: 'pet', text: lui, userId: OWNER });
}

/* ---------- les trois echanges sondes ---------- */
const ECHANGES = [
  { texte: "demain je dois aller à la préfecture et déjà ce soir ça serre, je tourne en rond dans la chambre",
    apres: () => db.marquerMotif(MOTIFS[0].id, dernierId(), OWNER) },        // le compagnon reconnait « anticiper »
  { texte: "j'ai pas dormi. j'y suis allé quand même ce matin, c'était rien au final, dix minutes",
    apres: () => db.marquerMotif(MOTIFS[1].id, dernierId(), OWNER) },        // puis « minimiser »
  { texte: "ce soir je suis vidé. j'ai rien fait de la journée à part scroller", apres: () => {} }
];
const dernierId = () => db.recentUserMessages(1, OWNER)[0].id;

const outils = Object.entries(chat.OUTILS).map(([name, def]) => ({ name, ...def }));
const sansMarqueurs = o => JSON.stringify(o, (k, v) => k === 'cache_control' ? undefined : v);
const prefixeCommun = (a, b) => { let i = 0; const n = Math.min(a.length, b.length); while (i < n && a[i] === b[i]) i++; return i; };

function assembler(texte) {
  const fil = db.filAncre ? db.filAncre(api.FIL_TRANSMIS, OWNER) : db.recentMessages(api.FIL_TRANSMIS, OWNER);
  const history = fil.map(m => ({ role: m.role, text: m.text, ts: m.ts }));
  const m = api.recentMemory(JOUR, OWNER, texte);
  const { system, messages } = chat.assemblerPrompt({ memory: m.stable, echos: m.echos, history });
  return { system, messages, fil: fil.length };
}

/* ---------- le client, si on sort sur le reseau ---------- */
let client = null;
if (!SEC) {
  const cle = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!cle) { console.error('Pas de clé : ANTHROPIC_API_KEY=... node tools/cout-cache.mjs (ou --sec pour une mesure sans réseau).'); process.exit(2); }
  let Sdk;
  try { ({ default: Sdk } = await import('@anthropic-ai/sdk')); }
  catch { Sdk = createRequire('/opt/node22/lib/node_modules/_.js')('@anthropic-ai/sdk').default; }
  client = new Sdk({ apiKey: cle });
}

const lignes = [];
let precedent = null, precedentId = null, total = { input: 0, ecrit: 0, lu: 0, sortie: 0 };
console.log(`sonde : ${RACINE}\nmodèle : ${MODELE}${SEC ? '  (à sec, sans réseau)' : ''}\n`);

for (const [i, e] of ECHANGES.entries()) {
  const now = new Date(t0 += 90_000).toISOString();
  db.addMessage({ ts: now, date: JOUR, source: 'web', role: 'user', text: e.texte, userId: OWNER });
  const { system, messages, fil } = assembler(e.texte);
  const corps = sansMarqueurs({ system, tools: outils, messages });
  const taille = corps.length;

  let u, ou = '';
  if (SEC) {
    // Ce que le cache peut relire : la part du corps precedent qui reapparait
    // en prefixe exact. Le reste est de l'entree pleine.
    const commun = precedent ? prefixeCommun(precedent, corps) : 0;
    u = { input: Math.round((taille - commun) / 3.3), lu: Math.round(commun / 3.3), ecrit: 0, sortie: 0 };
    if (precedent) {
      const iSys = corps.indexOf('"tools"'), iMsg = corps.indexOf('"messages"');
      ou = commun >= iMsg ? 'dans le fil' : commun >= iSys ? 'dans les outils' : 'dans le système/mémoire';
      ou = `diverge ${ou}, à ${Math.round(100 * commun / precedent.length)} % du corps précédent`;
    }
    precedent = corps;
    db.addMessage({ ts: new Date(t0 += 30_000).toISOString(), date: JOUR, source: 'web', role: 'pet', text: 'd’accord.', userId: OWNER });
  } else {
    const base = {
      ...chat.optionsDuModele(MODELE, { effort: 'low' }),
      model: MODELE, max_tokens: 256,
      cache_control: { type: 'ephemeral' },
      system, tools: outils, messages
    };
    base.betas = [...(base.betas ?? []), 'cache-diagnosis-2026-04-07'];
    let res;
    try {
      res = await client.beta.messages.create(precedentId ? { ...base, diagnostics: { previous_message_id: precedentId } } : base);
    } catch (err) {
      // Le diagnostic est en beta : s'il n'est pas servi, on mesure sans lui.
      if (!precedentId) throw err;
      res = await client.beta.messages.create({ ...base, betas: base.betas.filter(b => !b.startsWith('cache-diagnosis')) });
      ou = `(diagnostic indisponible : ${String(err.message ?? err).slice(0, 80)})`;
    }
    precedentId = res.id;
    const g = res.usage ?? {};
    u = { input: g.input_tokens ?? 0, ecrit: g.cache_creation_input_tokens ?? 0, lu: g.cache_read_input_tokens ?? 0, sortie: g.output_tokens ?? 0 };
    if (res.diagnostics) ou = 'diagnostic : ' + JSON.stringify(res.diagnostics);
    const texte = (res.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim() || 'd’accord.';
    db.addMessage({ ts: new Date(t0 += 30_000).toISOString(), date: JOUR, source: 'web', role: 'pet', text: texte, userId: OWNER });
  }
  e.apres();
  for (const k of Object.keys(total)) total[k] += u[k];
  lignes.push({ n: i + 1, fil, taille, ...u, ou });
}

/* ---------- le compte rendu ---------- */
const f = n => String(n).padStart(7);
console.log('échange   fil   entrée pleine   écrit cache   relu cache   sortie   coût $');
for (const l of lignes) {
  const c = cout(l);
  console.log(`   ${l.n}     ${String(l.fil).padStart(3)}   ${f(l.input)}       ${f(l.ecrit)}      ${f(l.lu)}   ${f(l.sortie)}   ${c.toFixed(4)}`);
  if (l.ou) console.log(`         ${l.ou}`);
}
const c = cout(total), sc = coutSansCache(total);
const relu = total.lu / Math.max(1, total.input + total.lu + total.ecrit);
console.log(`\ntotal : ${c.toFixed(4)} $  (sans cache, ce serait ${sc.toFixed(4)} $)  —  ${Math.round(100 * relu)} % du prompt relu du cache`);
console.log(`équivalent plein tarif : ${Math.round(total.input + total.sortie + total.lu * LU + total.ecrit * ECRIT)} jetons pour ${total.input + total.lu + total.ecrit + total.sortie} traversés`);

// Le troisieme echange est le juge : rien n'a change que le fil et un motif.
const juge = lignes.at(-1);
const part = juge.lu / Math.max(1, juge.input + juge.lu + juge.ecrit);
if (part < 0.8) {
  console.error(`\nÉCHEC : au troisième échange, ${Math.round(100 * part)} % seulement du prompt est relu du cache. Un invalidateur est à l'œuvre.`);
  process.exit(1);
}
console.log(`\nOK : au troisième échange, ${Math.round(100 * part)} % du prompt est relu du cache.`);
