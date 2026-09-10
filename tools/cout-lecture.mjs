#!/usr/bin/env node
/**
 * LA SONDE DE COUT DE LA LECTURE DE FOND.
 *
 * `cout-cache.mjs` mesure le compagnon, qui parle quarante fois par jour pour
 * quelques centimes. Celle-ci mesure l'AUTRE moitie de la facture : un appel
 * unique, gros, rare, dont personne ne regarde le prix parce qu'il ne se
 * repete pas — et qui coute pourtant plusieurs dizaines d'echanges de chat.
 *
 * CE QU'ELLE FAIT SANS RESEAU (`--sec`, le defaut)
 * Elle fabrique un journal plausible, le passe dans `corpusPour()` — la vraie
 * fonction, pas une imitation — puis dans `requeteLecture()`, et pese chaque
 * morceau de la requete qui part : la consigne, le schema de l'outil, chaque
 * bloc du corpus. Les jetons y sont estimes (3,3 caracteres par jeton en
 * francais, 3,0 pour le JSON du schema, qui se decoupe plus mal).
 *
 * CE QU'ELLE FAIT AVEC UNE CLE
 *   --compter  appelle `count_tokens` : le VRAI decompte du tokenizer, sans
 *              rien generer. C'est la mesure exacte de l'entree, et elle ne
 *              coute pratiquement rien.
 *   --reel     lance une vraie lecture et rend les quatre compteurs de la
 *              reponse plus la taille du JSON rendu. C'est la seule facon de
 *              savoir si `max_tokens: 8000` est atteint — la question ne se
 *              repond pas par la lecture du code, parce que le budget est
 *              partage entre la reflexion du modele et le JSON de l'outil.
 *
 *   node tools/cout-lecture.mjs                       # a sec
 *   node tools/cout-lecture.mjs --jours 900           # un journal de trois ans
 *   node tools/cout-lecture.mjs --complet             # le bouton « relire tout »
 *   ANTHROPIC_API_KEY=... node tools/cout-lecture.mjs --compter
 *   ANTHROPIC_API_KEY=... node tools/cout-lecture.mjs --reel --modele claude-sonnet-5
 *
 * POURQUOI UN JOURNAL FABRIQUE ET PAS LE VRAI. Le vrai journal n'est pas
 * versionne, et il ne doit pas l'etre. Ce qu'on mesure ici ne depend pas de ce
 * qui est ecrit : le budget de caracteres decide de la taille du corpus, pas
 * la vie de la personne. Un journal fabrique donne donc le meme chiffre, et il
 * se relance chez n'importe qui.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const COMPTER = args.includes('--compter');
const REEL = args.includes('--reel');
const COMPLET = args.includes('--complet');
const JOURS = Number(opt('--jours', 420));
const MODELE = opt('--modele', 'claude-opus-5');
const EFFORT = opt('--effort', 'high');

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-lecture-')), 'sonde.db');

const { corpusPour, requeteLecture, BUDGET_COMPLET } = await import('../server/lecture.js');
const { resolveKey, repliServeur } = await import('../server/chat.js');
const { getSettings } = await import('../server/db.js');

/* ---------- les tarifs, en dollars par million ---------- */
const usage = await import('../server/usage.js').catch(() => ({}));
const TARIFS = usage.PRICES ?? {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 }
};
const LU = usage.LECTURE_CACHE ?? 0.1, ECRIT = usage.ECRITURE_CACHE ?? 1.25;

/* ---------- un journal plausible ---------- */
/*
 * LA LONGUEUR EST CE QUI COMPTE, PAS LE CONTENU. `choisirJours` trie par
 * densite et coupe a 900 caracteres : une distribution de longueurs realiste
 * — beaucoup de soirs de trois lignes, quelques-uns de deux pages — reproduit
 * exactement le tri que le vrai journal subit. Un texte de longueur constante
 * mentirait sur le nombre de journees retenues.
 */
const MORCEAUX = [
  "réveil tard, encore. j'ai traîné avec le téléphone jusqu'à midi passé.",
  "vu Léa au café, c'était bien sur le moment et après je me suis senti vidé.",
  "nuit blanche, j'ai regardé des vidéos jusqu'à six heures du matin.",
  "j'ai marché une heure au bord du canal, ma tête s'est tue un moment.",
  "maman a appelé, elle a demandé si j'avais cherché du travail, j'ai dit oui.",
  "journée plate, mangé, joué, dormi, pas triste pas rien, juste rien.",
  "je devais sortir et j'ai annulé à dix-huit heures en disant que j'étais malade.",
  "j'ai tout rangé, ça m'a pris quatre heures, après je me suis assis par terre.",
  "la peur est revenue ce matin sans raison, comme un bruit de fond.",
  "bonne journée, j'ai codé un truc, ça marchait, j'ai envoyé un message."
];
let graine = 20260910;
const alea = () => (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;

const rows = [], events = [], carnet = [];
for (let i = 0; i < JOURS; i++) {
  const date = new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10);
  // Une journée sur trois n'est pas écrite : c'est le rythme ordinaire, et
  // `corpusPour` compte les journées écrites, pas les cases du calendrier.
  if (alea() < 0.33) { rows.push({ date, text: '', note: null }); continue; }
  const n = 1 + Math.floor(alea() * alea() * 14);   // beaucoup de courtes, peu de longues
  const text = Array.from({ length: n }, () => MORCEAUX[Math.floor(alea() * MORCEAUX.length)]).join(' ');
  rows.push({ date, text, note: 1 + Math.floor(alea() * 10) });
  if (alea() < 0.02) events.push({ date, fin: null, label: 'rendez-vous' });
  if (alea() < 0.03) carnet.push({ jour: date, quand: null, texte: MORCEAUX[0].repeat(3) });
}
const motifs = ['peur avant de sortir', 'urgence à éteindre', 'la minimisation d’après']
  .map((nom, i) => ({ nom, mecanisme: 'ce que tu fais juste après', vues: 3 + i }));
const objectifs = [{ quoi: 'me coucher avant minuit', tenu: false, depuis: '2025-02-01', reprises: 2 }];

/*
 * UNE LECTURE PRECEDENTE, PARCE QU'ELLE EST DANS LE CORPUS EN REGIME ETABLI.
 * La premiere lecture d'une vie n'arrive qu'une fois ; toutes les suivantes
 * portent le bloc « CE QUE TU AVAIS COMPRIS LA DERNIERE FOIS », et le mesurer
 * sans lui sous-estimerait le prix ordinaire.
 */
const precedente = {
  fait_le: '2026-08-01',
  synthese: 'x'.repeat(300),
  themes: Array.from({ length: 5 }, (_, i) => ({ nom: `thème ${i}`, quoi: 'y'.repeat(160), intensite: 2 })),
  pistes: Array.from({ length: 3 }, (_, i) => ({ nom: `piste ${i}`, themes: ['thème 0', 'thème 1'], noeuds: ['n0', 'n1'] })),
  schemas: Array.from({ length: 4 }, (_, i) => ({ nom: `boucle ${i}`, declencheur: 'z'.repeat(80), comportement: 'z'.repeat(80) })),
  carte: {
    noeuds: Array.from({ length: 14 }, (_, i) => ({ nom: `n${i}`, genre: 'mecanisme' })),
    liens: Array.from({ length: 22 }, (_, i) => ({ de: `n${i % 14}`, vers: `n${(i + 3) % 14}`, quoi: 'fait retomber' }))
  }
};

const corpus = corpusPour({ rows, events, carnet, motifs, objectifs, amplitudes: [],
                            precedente, complet: COMPLET });
const req = requeteLecture(corpus, { anthropicModel: MODELE });

/* ---------- la pesee ---------- */
const car = s => s.length;
const jetons = (s, r = 3.3) => Math.round(s.length / r);
const SYS = req.system[0].text;
const OUTIL = JSON.stringify(req.tools);
const MSG = req.messages[0].content[0].text;

// Le corpus part en un seul bloc, mais il est fait de sections separees par la
// meme barre. Les repeser une par une dit OU passent les jetons — et c'est la
// seule chose qui permette de decider quoi couper.
const sections = MSG.split('\n\n———\n\n');

console.log(`\n  LA REQUETE DE LECTURE — ${COMPLET ? 'complète (« relire tout »)' : 'ordinaire'}`);
console.log(`  journal fabriqué : ${JOURS} journées de calendrier, `
  + `${rows.filter(r => r.text).length} écrites, ${corpus.dates.size} transmises\n`);

const ligne = (nom, s, r) => console.log(
  `  ${nom.padEnd(34)} ${String(car(s)).padStart(9)} car  ${String(jetons(s, r)).padStart(7)} jetons`);

ligne('SYSTEME (la consigne)', SYS, 3.3);
ligne('OUTIL (schéma JSON sérialisé)', OUTIL, 3.0);
console.log('  ' + '─'.repeat(60));
for (const s of sections) {
  const titre = s.split('\n')[0].slice(0, 32).replace(/\s+$/, '');
  ligne('  · ' + titre, s, 3.3);
}
console.log('  ' + '─'.repeat(60));
ligne('CORPUS (tout le message)', MSG, 3.3);

const totalEstime = jetons(SYS, 3.3) + jetons(OUTIL, 3.0) + jetons(MSG, 3.3);
console.log(`\n  ENTREE ESTIMEE : ${totalEstime} jetons`
  + `   ·   max_tokens : ${req.max_tokens}   ·   effort : ${req.output_config?.effort ?? '—'}`
  + `   ·   thinking : ${req.thinking ? req.thinking.type : 'aucun'}`);
if (COMPLET) console.log(`  (budget complet : ${BUDGET_COMPLET.toLocaleString('fr-FR')} caractères)`);

/* ---------- ce que ca coute, par modele ---------- */
/*
 * TROIS COLONNES, PARCE QU'IL Y A TROIS CHEMINS REELS.
 *
 * « premiere » : rien en cache, tout ecrit — le cas de la toute premiere
 * lecture, et de toute lecture faite plus de cinq minutes apres la precedente,
 * c'est-a-dire PRESQUE TOUTES. « reclic » : la meme, moins de cinq minutes
 * apres — le cas rare pour lequel le cache existe. « lot » : la moitie du
 * prix, et c'est par la que part la relance automatique.
 */
function couter(modele, entree, sortie) {
  const p = TARIFS[modele] ?? TARIFS['claude-opus-5'];
  const premiere = (entree * p.in * ECRIT + sortie * p.out) / 1e6;
  const reclic = (entree * p.in * LU + sortie * p.out) / 1e6;
  return { premiere, reclic, lot: premiere / 2 };
}
console.log('\n  CE QUE LA LECTURE COUTE, selon la sortie réellement écrite');
console.log(`  ${''.padEnd(18)} ${'sortie'.padStart(7)} ${'première'.padStart(10)} ${'en lot'.padStart(9)} ${'reclic'.padStart(9)}`);
for (const m of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']) {
  for (const sortie of [2000, 4000, 8000]) {
    const c = couter(m, totalEstime, sortie);
    console.log(`  ${m.padEnd(18)} ${String(sortie).padStart(7)} `
      + `${('$' + c.premiere.toFixed(4)).padStart(10)} ${('$' + c.lot.toFixed(4)).padStart(9)} `
      + `${('$' + c.reclic.toFixed(4)).padStart(9)}`);
  }
}
console.log('\n  Rappel : un échange de chat coûte ~$0,0078. Divise pour avoir l’équivalent.');

/* ---------- avec une cle : le vrai decompte ---------- */
if (COMPTER || REEL) {
  const { key } = resolveKey(getSettings());
  if (!key) { console.log('\n  Pas de clé API : --compter et --reel sautés.'); process.exit(0); }
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: key });

  if (COMPTER) {
    /*
     * `count_tokens` prend la MEME requete, sans `max_tokens` ni les champs de
     * generation : c'est le tokenizer du modele, pas une estimation. L'ecart
     * avec la colonne « estimé » ci-dessus dit de combien la regle des 3,3
     * caracteres se trompe sur ce corpus-la.
     */
    const { max_tokens, thinking, output_config, betas, fallbacks, ...compte } = req;
    const r = await client.messages.countTokens(compte);
    console.log(`\n  COMPTE REEL (count_tokens) : ${r.input_tokens} jetons d'entrée`
      + `  —  estimé ${totalEstime}, écart ${((r.input_tokens / totalEstime - 1) * 100).toFixed(1)} %`);
  }

  if (REEL) {
    console.log(`\n  Lecture réelle sur ${MODELE}, effort ${EFFORT}… (une à deux minutes)`);
    const t0 = Date.now();
    const base = requeteLecture(corpus, { anthropicModel: MODELE });
    const res = await client.beta.messages.create({
      ...repliServeur(MODELE),
      ...base,
      // L'effort ne s'envoie que sur un modele qui le porte : `optionsDuModele`
      // l'a deja decide, on ne fait que remplacer la valeur qu'il a posee.
      ...(base.output_config ? { output_config: { ...base.output_config, effort: EFFORT } } : {})
    });
    const u = res.usage ?? {};
    const appel = res.content.find(b => b.type === 'tool_use');
    const json = appel ? JSON.stringify(appel.input) : '';
    const pense = res.content.filter(b => b.type === 'thinking').length;
    console.log(`  entrée ${u.input_tokens} · écrit ${u.cache_creation_input_tokens ?? 0} `
      + `· relu ${u.cache_read_input_tokens ?? 0} · SORTIE ${u.output_tokens}`);
    console.log(`  arrêt : ${res.stop_reason}${res.stop_reason === 'max_tokens'
      ? '   ← LE PLAFOND EST ATTEINT, le JSON est coupé' : ''}`);
    console.log(`  JSON rendu : ${json.length} caractères ≈ ${Math.round(json.length / 3)} jetons `
      + `→ la réflexion en a pris ~${u.output_tokens - Math.round(json.length / 3)}`);
    console.log(`  ${appel?.input?.themes?.length ?? 0} thèmes · `
      + `${appel?.input?.carte?.noeuds?.length ?? 0} nœuds · `
      + `${appel?.input?.schemas?.length ?? 0} schémas · ${pense} bloc(s) de réflexion`);
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
}
console.log('');
