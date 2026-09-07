/**
 * =====================================================================
 *  CE QUI A DE LA PRISE.
 *
 * Le journal sait déjà repérer un excès le jour où il est écrit (`veille.js`).
 * Il ne savait rien dire de la SUITE : est-ce que ça monte, est-ce que ça
 * revient toujours après la même chose, est-ce que les jours d'après paient
 * la note. Or c'est exactement ce qui manque à quelqu'un qui veut s'en
 * sortir — un jour isolé ne s'interprète pas, une pente si.
 *
 * CE FICHIER NE DIAGNOSTIQUE PERSONNE. Il ne prononce ni « dépendance » ni
 * « addiction » à propos de qui que ce soit : il compte des jours écrits et
 * rend la phrase qui les a fait compter. La règle du produit tient — on
 * montre, on ne qualifie pas — et elle tient ici plus qu'ailleurs, parce
 * qu'une étiquette posée par une machine sur ce terrain-là devient une
 * identité, et qu'une identité ne se soigne pas.
 *
 * TROIS CHOIX QUI VONT CONTRE L'INTUITION, ET POURQUOI.
 *
 * 1. PAS DE COMPTEUR DE SÉRIE SEUL. « 14 jours sans » remis à zéro le jour
 *    d'après est la pire mécanique connue sur ce terrain : elle transforme un
 *    écart d'un soir en échec total, et l'échec total est ce qui fait
 *    enchaîner (Marlatt l'appelle l'effet de transgression de l'abstinence).
 *    On montre donc TOUTES les séries, côte à côte : une rechute devient une
 *    barre parmi des barres, et les vingt jours d'avant ne s'effacent pas.
 *
 * 2. LE COÛT SE MESURE LE JOUR D'APRÈS, pas le jour même. Le jour même, la
 *    note basse peut être la CAUSE — on boit parce que la journée était
 *    mauvaise. Le lendemain écrit, elle ne peut plus l'être. C'est la seule
 *    des deux mesures qui apprend quelque chose.
 *
 * 3. TROIS JOURS MINIMUM POUR EXISTER. En dessous, ce n'est pas une prise,
 *    c'est une soirée — et la monter à l'écran fabriquerait le problème
 *    qu'elle prétend décrire.
 *
 * CE QUI SERT VRAIMENT : ce qui vient AVANT. On repasse par `sens.js`, le
 * même comptage que les flèches de la carte : pour chaque chose de la carte,
 * est-ce que la prise tombe sur la journée écrite suivante plus souvent
 * qu'ailleurs. Ça donne « après la solitude, ça revient — 9 fois sur 11 ».
 * C'est le seul résultat sur lequel on peut agir un jour à l'avance.
 *
 * PAS DE FAMILLE « NOURRITURE ». Elle serait détectable, et ce serait une
 * faute : compter les crises alimentaires de quelqu'un et les lui remettre
 * sous les yeux chaque jour est un mécanisme d'entretien connu du trouble,
 * pas un outil d'introspection. Rien n'empêche d'en parler au compagnon ;
 * ce tableau-là ne le comptera pas.
 * =====================================================================
 */

import { allEntries, OWNER } from './db.js';
import { norm, propositions, GARDES_SUBSTANCE } from './veille.js';
import { sensDuLien, suiteDe, SEUILS_SENS } from './sens.js';
import { fisher } from './fonctionnements.js';
import { addDays } from './stats.js';

export const SEUILS_PRISES = {
  min_jours: 3,        // en dessous, c'est une soirée, pas une prise
  fenetre: 30,         // la fenêtre récente, en JOURS ÉCRITS (pas civils)
  min_serie: 7,        // une semaine : en dessous, ce n'est pas une série, c'est l'écart entre deux fois
  min_compare: 10,     // en dessous, la fenêtre d'avant ne se compare à rien
  trou_max: 21,        // trois semaines sans écrire au milieu d'une série : on ne sait plus
  serie_creuse: 2,     // le plancher : en dessous de deux entrées, aucune série ne tient
  p: 0.05,
  min_avant: 3         // trois fois au moins pour qu'un déclencheur compte
};

const jours = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);

/* ------------------------------------------------------------------ *
 * LES FAMILLES.
 *
 * `mots` seul ne suffit jamais quand le mot a une vie ordinaire (« un
 * verre », « un pet ») : il faut alors un VERBE DE PRISE dans la même
 * proposition. `franc` liste au contraire ce qui ne peut rien vouloir dire
 * d'autre — « bourré », « une trace », « gueule de bois » — et se passe de
 * verbe. C'est la distinction qui a coûté le plus de faux positifs.
 * ------------------------------------------------------------------ */
const V_BOIRE = /\b(?:bu|boire|bois|boit|sifle|siffle|descendu|vide|fini|enchaine)\b/;

/* CE QU'ON BOIT QUI N'EST PAS DE L'ALCOOL.
   « j'ai bu un verre d'eau » comptait pour un jour d'alcool : le verbe y est,
   le mot « verre » aussi. C'est le faux positif le plus bête et le plus
   fréquent, et aucun réglage de seuil ne le rattrape — il faut nommer ce qui
   n'en est pas. */
const SANS_ALCOOL = /\b(?:d eau|de l eau|de flotte|de la flotte|de jus|de lait|de the|de tisane|de cafe|de coca|de soda|de sirop|d orange|de citronnade|de limonade|de menthe|de grenadine|de kefir|de kombucha|de bouillon|de smoothie)\b|\bbu (?:un |une |mon |ma |mes |des |du |de la |de l |l )?(?:cafe|the|jus|lait|eau|flotte|soda|coca|smoothie|infusion|tisane|chocolat|bouillon)\b|\bde shampoing\b|\bde lessive\b|\bd huile\b|\bde vinaigre\b|\bde gel douche\b|\bsans alcool\b/;
const V_FUMER = /\b(?:fume|fumer|fumais|tire|roule|grille|taffe|clope)\b/;
const V_PRENDRE = /\b(?:pris|reprends|repris|prends|sniffe|snife|gobe|tape|consomme|avale|shoote|injecte|dose|sous)\b/;

export const FAMILLES = [
  { cle: 'alcool', nom: 'l’alcool', sym: 'verre',
    mots: /\b(?:alcool|biere|bieres|vin|vodka|whisky|rhum|gin|pastis|ricard|champagne|tequila|jaeger|shot|shots|pinte|pintes|verre|verres|bouteille|bouteilles|apero|aperitif)\b/,
    verbe: V_BOIRE, sauf: SANS_ALCOOL,
    /* UN NOMBRE ET UN VERRE SUFFISENT. « trois verres de vin, encore une fois »
       n'a pas de verbe : exiger « bu » perdait un jour planté sur quatre au
       banc, et c'est une des façons les plus courantes de l'écrire. */
    franc: /\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quelques|plusieurs|\d+) (?:verres?|bieres?|pintes?|shots?|coupes?|bouteilles?|canettes?)\b|\bverres? de (?:vin|rouge|blanc|rose|whisky|vodka|rhum|gin|champagne)\b|\bl? ?apero\b|\bj ai (?:encore |trop |beaucoup |pas mal |un peu |bien )?bu\b|\bje me suis bourre(?:e)?\b|\bbourre(?:e|es|s)?\b|\bivre\b|\b(?:une |grosse |la )?cuite\b|\bblack ?out\b|\bgueule de bois\b|\btorche(?:e|es)?\b|\balcoolise(?:e)?\b|\bcoma ethylique\b/ },

  { cle: 'cannabis', nom: 'le cannabis', sym: 'feuille',
    mots: /\b(?:cannabis|beuh|weed|shit|herbe|bedo|bedos|joint|joints|spliff|spliffs|bang|bangs|pet|pets|teuh|ganja)\b/,
    verbe: V_FUMER,
    franc: /\b(?:beuh|bedo|bedos|spliff|spliffs|ganja)\b|\b(?:un|deux|trois|quatre|des|plusieurs) joints?\b|\bdefonce(?:e|es)? (?:a|au) (?:la beuh|shit|cannabis)\b/ },

  { cle: 'stimulants', nom: 'les stimulants', sym: 'eclair',
    mots: /\b(?:coke|cocaine|md|mdma|ecsta|ecstasy|taz|speed|amphet|amphetamines|meth|crack|3 ?mmc|4 ?mmc|cathinones|ket|ketamine)\b/,
    verbe: V_PRENDRE,
    franc: /\b(?:une|des|deux|trois|quelques|plusieurs) (?:traces?|rails?)\b|\bsniffe\b|\bsous (?:coke|md|mdma|ecsta|speed|ket|ketamine)\b/ },

  { cle: 'calmants', nom: 'les calmants', sym: 'gelule',
    mots: /\b(?:xanax|lexomil|valium|temesta|seresta|benzo|benzos|zolpidem|stilnox|imovane|somnifere|somniferes|anxiolytique|anxiolytiques|codeine|tramadol|oxycodone|morphine|heroine|opium|subutex|methadone|lyrica|pregabaline)\b/,
    verbe: V_PRENDRE,
    /* UN TRAITEMENT SUIVI N'EST PAS UNE PRISE. Compter les jours où quelqu'un
       prend le somnifère qu'on lui a prescrit, et les lui remettre sous les
       yeux comme une habitude à surveiller, c'est fabriquer une inquiétude et
       parfois faire arrêter un traitement. Le regard en arrière annule la
       garde : « plus que prescrit », « sans ordonnance » comptent, eux. */
    sauf: /(?<!plus que )(?<!pas )\b(?:prescrit|prescrite|sur ordonnance|mon traitement|ma dose habituelle|comme prevu)\b/,
    franc: /\bheroine\b|\bsubutex\b|\bmethadone\b|\btrop de (?:xanax|lexomil|valium|cachets|comprimes)\b|\bplus que (?:la dose|prescrit|prevu)\b|\bsans ordonnance\b/ },

  { cle: 'tabac', nom: 'la cigarette', sym: 'clope',
    mots: /\b(?:clope|clopes|cigarette|cigarettes|tabac|nicotine|vape|puff|puffs|cigare)\b/,
    verbe: V_FUMER,
    franc: /\b(?:un|deux|trois|dix|quinze|vingt|\d+) (?:clopes|cigarettes)\b|\bun paquet\b|\bmanque de nicotine\b/ },

  { cle: 'argent', nom: 'les paris', sym: 'de',
    mots: /\b(?:paris|parie|parier|betclic|winamax|unibet|pmu|casino|poker|machine a sous|jeux? d argent|grattage|grattages|bookmaker|mise|mises|cote|cotes)\b/,
    verbe: /\b(?:parie|mise|joue|rejoue|remis|perdu|gagne|depose|rechargé|recharge)\b/,
    franc: /\b(?:betclic|winamax|unibet|pmu)\b|\bmachine a sous\b|\bjeux? d argent\b/ }
];

/* Les gardes propres à la lecture longue : un souvenir raconté n'est pas un
   jour de prise. `veille.js` a les siennes (tiers, négation, hyperbole,
   intention) et on les réutilise telles quelles — voir GARDES_SUBSTANCE. */
const SOUVENIR = /\b(?:a l epoque|quand j etais|il y a (?:des annees|un an|deux ans|longtemps)|dans ma jeunesse|avant je|je buvais|je fumais|j en prenais|pendant des annees|a l adolescence|au lycee|en soiree etudiante)\b/;
const QUESTION = /\?\s*$/;

/* ------------------------------------------------------------------ *
 * LES SIGNES. Chacun rend la phrase qui l'a allumé — jamais un verdict nu.
 * ------------------------------------------------------------------ */
export const SIGNES = [
  { id: 'arreter', dit: 'tu as voulu arrêter',
    re: /\b(?:j ai arrete|je veux arreter|je voulais arreter|j essaie d arreter|j essaye d arreter|je dois arreter|il faut que j arrete|je devrais arreter|j arrete|sevrage|desintox|je tiens (?:bon|le coup)|(?:zero|sans) (?:alcool|drogue) depuis|sobre depuis|j ai tenu \d+ jours)\b/ },
  { id: 'craque', dit: 'tu as craqué après avoir tenu',
    re: /\b(?:j ai craque|j ai replonge|j ai pas tenu|j ai rechute|je suis retombe|j ai repris|ca a recommence|j ai pas reussi a (?:arreter|tenir))\b/ },
  { id: 'manque', dit: 'l’envie revient toute seule',
    re: /\b(?:en manque|le manque|j en ai envie|envie de (?:boire|fumer|prendre|sniffer|me defoncer)|je pense qu a (?:ca|boire|fumer)|obsede par|il me faut|je tiens plus|j y pense tout le temps|craving)\b/ },
  { id: 'plus_que_prevu', dit: 'plus que ce que tu voulais',
    re: /\b(?:plus que prevu|je voulais (?:juste|juste en prendre|m arreter)|j ai pas su m arreter|j ai fini par|encore une fois|comme d habitude j ai|je devais (?:en )?(?:prendre|boire) (?:qu )?un)\b/ },
  { id: 'cache', dit: 'tu l’as caché',
    re: /\b(?:en cachette|personne (?:le )?sait|j ai menti|je (?:l )?ai cache|sans (?:le )?dire a|tout seul dans ma chambre|avant de (?:rentrer|sortir) j ai)\b/ }
];

/* ------------------------------------------------------------------ *
 * LA DÉTECTION, UN JOUR À LA FOIS.
 * ------------------------------------------------------------------ */

/**
 * Les familles vues dans un texte, chacune avec la proposition qui l'a fait
 * compter. Rien ne compte sur un mot seul : il faut un verbe de prise, ou un
 * mot qui ne peut rien vouloir dire d'autre.
 *
 * @returns {Map<string, {phrase: string, signes: string[]}>}
 */
export function prisesDuTexte(texte) {
  const out = new Map();
  const brut = String(texte ?? '');
  if (!brut.trim()) return out;
  for (const phrase of brut.split(/(?<=[.!?…])\s+|\n+/)) {
    const np = norm(phrase);
    if (!np.trim()) continue;
    for (const prop of propositions(np)) {
      const q = prop.replace(GARDES_SUBSTANCE.hyperbole, ' ');
      if (!q.trim()) continue;
      if (QUESTION.test(phrase.trim()) && !/\bj ai\b|\bje me suis\b/.test(q)) continue;
      if (GARDES_SUBSTANCE.tiers.test(q) && !/\b(?:je|j ai|moi|on a)\b/.test(q)) continue;
      if (GARDES_SUBSTANCE.negation.test(q)) continue;
      if (SOUVENIR.test(q)) continue;
      for (const f of FAMILLES) {
        if (f.sauf?.test(q)) continue;               // « un verre d'eau » n'est pas un verre
        const franc = f.franc.test(q);
        if (!franc && !(f.mots.test(q) && f.verbe.test(q))) continue;
        // « j'ai envie de boire » n'est pas « j'ai bu » : l'envie est un signe,
        // pas un jour de prise. Elle est relevée plus bas, sur le même texte.
        if (!franc && GARDES_SUBSTANCE.intention.test(q) && !/\bj ai\b|\bje me suis\b|\bhier\b/.test(q)) continue;
        if (!out.has(f.cle)) out.set(f.cle, { phrase: phrase.trim().slice(0, 200), signes: [] });
      }
    }
  }
  return out;
}

/** Les signes lus dans un texte, avec leur phrase. Indépendants des familles :
    « j'ai craqué » ne nomme pas ce qui a craqué, et c'est très bien ainsi. */
export function signesDuTexte(texte) {
  const out = [];
  for (const phrase of String(texte ?? '').split(/(?<=[.!?…])\s+|\n+/)) {
    const np = norm(phrase);
    if (!np.trim() || GARDES_SUBSTANCE.tiers.test(np) && !/\b(?:je|j ai|moi)\b/.test(np)) continue;
    for (const s of SIGNES)
      if (s.re.test(np) && !out.some(o => o.id === s.id))
        out.push({ id: s.id, dit: s.dit, phrase: phrase.trim().slice(0, 200) });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * LES SÉRIES SANS.
 * ------------------------------------------------------------------ */

/**
 * Toutes les séries entre deux occurrences, la dernière encore ouverte.
 *
 * Chaque série dit combien de journées ont été ÉCRITES dedans : quarante
 * jours sans, sur lesquels on n'a écrit qu'une fois, ne prouvent rien, et
 * l'annoncer comme un record serait un mensonge encourageant — c'est-à-dire
 * le pire genre.
 */
export function seriesSans(joursPrise, ecrits, aujourdhui) {
  const marque = new Set(joursPrise);
  const dates = [...ecrits].sort();
  if (!dates.length) return [];
  const bornes = dates.filter(d => marque.has(d));
  const out = [];
  const poser = (de, a) => {
    if (!de || !a || jours(de, a) < 0) return;
    const dedans = dates.filter(d => d >= de && d <= a);
    /* LE TROU. Une série de cent vingt jours dont soixante sans une ligne n'est
       pas une série de cent vingt jours : c'est ce qu'on a écrit avant, ce qu'on
       a écrit après, et deux mois sans nouvelles. La densité moyenne ne le voit
       pas — elle se laisse remplir par les deux bouts. Il faut mesurer le plus
       grand silence. */
    let trou = 0, prec = de;
    for (const x of dedans) { trou = Math.max(trou, jours(prec, x)); prec = x; }
    trou = Math.max(trou, jours(prec, a));
    /* `maigre` : une série qu'on n'a presque pas écrite ne prouve rien. Le seuil
       suit la longueur — il faut à peu près une entrée par semaine pour qu'une
       série tienne — parce que c'est justement sur les longues qu'on se raconte
       une histoire : quarante jours sans, écrits trois fois, ce sont trois jours
       sans et trente-sept sans nouvelles. On les montre quand même (les cacher
       serait mentir dans l'autre sens), mais elles ne deviennent pas un record. */
    const n = jours(de, a) + 1;
    out.push({ de, a, jours: n, ecrites: dedans.length, trou,
               maigre: dedans.length < Math.max(SEUILS_PRISES.serie_creuse, Math.round(n / 7))
                       || trou > SEUILS_PRISES.trou_max,
               encours: false });
  };
  if (!bornes.length) { poser(dates[0], aujourdhui ?? dates.at(-1)); }
  else {
    poser(dates[0], addDays(bornes[0], -1));
    for (let i = 0; i < bornes.length - 1; i++) poser(addDays(bornes[i], 1), addDays(bornes[i + 1], -1));
    poser(addDays(bornes.at(-1), 1), aujourdhui ?? dates.at(-1));
  }
  const bout = aujourdhui ?? dates.at(-1);
  const gardees = out.filter(s => s.jours >= SEUILS_PRISES.min_serie);
  for (const s of gardees) s.encours = s.a >= bout;
  return gardees;
}

/* ------------------------------------------------------------------ *
 * LE MOTEUR.
 * ------------------------------------------------------------------ */

/**
 * @param {object[]} entrees  [{date, note, text}] triées, le journal entier
 * @param {object|null} carte la carte de la lecture, pour « ce qui vient avant »
 * @param {string|null} aujourdhui
 */
export function analyserPrises(entrees, { carte = null, aujourdhui = null } = {}) {
  const rows = (entrees ?? []).filter(e => e?.date).sort((a, b) => a.date < b.date ? -1 : 1);
  const ecrits = rows.filter(e => String(e.text ?? '').trim()).map(e => e.date);
  const fin = aujourdhui ?? ecrits.at(-1) ?? null;
  const noteDe = new Map(rows.filter(e => e.note != null).map(e => [e.date, +e.note]));

  const vues = new Map();            // cle -> { jours: [], preuves: Map<date, phrase> }
  const signesParJour = new Map();   // date -> [signe]
  for (const e of rows) {
    const t = e.text;
    if (!String(t ?? '').trim()) continue;
    for (const [cle, v] of prisesDuTexte(t)) {
      if (!vues.has(cle)) vues.set(cle, { jours: [], preuves: new Map() });
      const x = vues.get(cle);
      x.jours.push(e.date); x.preuves.set(e.date, v.phrase);
    }
    const s = signesDuTexte(t);
    if (s.length) signesParJour.set(e.date, s);
  }

  const suite = suiteDe(ecrits, SEUILS_SENS.ecart_max);
  const recents = ecrits.slice(-SEUILS_PRISES.fenetre);
  const avants = ecrits.slice(-2 * SEUILS_PRISES.fenetre, -SEUILS_PRISES.fenetre);
  const seuilBas = medianeMoins(noteDe);

  const prises = [], ecartees = [];
  for (const f of FAMILLES) {
    const v = vues.get(f.cle);
    if (!v) continue;
    if (v.jours.length < SEUILS_PRISES.min_jours) {
      ecartees.push({ cle: f.cle, nom: f.nom, n: v.jours.length,
        pourquoi: `vu ${v.jours.length} fois — en dessous de ${SEUILS_PRISES.min_jours}, ce n’est pas une habitude` });
      continue;
    }
    const set = new Set(v.jours);
    prises.push({
      cle: f.cle, nom: f.nom, sym: f.sym, source: 'ecrit',
      jours: v.jours, n: v.jours.length,
      preuve: v.preuves.get(v.jours.at(-1)) ?? null,
      recent: recents.filter(d => set.has(d)).length,
      recent_sur: recents.length,
      avant: avants.filter(d => set.has(d)).length,
      /* LES DEUX FENÊTRES N'ONT PAS À FAIRE LA MÊME TAILLE.
         Elles se comptaient en journées écrites, et il en fallait trente de
         chaque côté : quelqu'un qui écrit un jour sur douze — c'est-à-dire le
         cas normal ici — n'atteignait jamais soixante, et la comparaison ne
         s'affichait donc JAMAIS pour lui. Or c'est exactement à lui qu'elle
         sert. On compare maintenant dès dix journées, et comme les deux
         fenêtres peuvent différer, on rend leur taille : la vue dit « 12 sur
         30 » contre « 5 sur 28 » plutôt qu'un chiffre nu. */
      avant_sur: avants.length,
      compare: avants.length >= SEUILS_PRISES.min_compare,
      depuis: fin && v.jours.at(-1) ? jours(v.jours.at(-1), fin) : null,
      series: seriesSans(v.jours, ecrits, fin),
      signes: signesRetenus(v.jours, signesParJour, ecrits),
      avant_ca: ceQuiVientAvant(v.jours, carte, suite),
      apres_ca: leLendemain(v.jours, suite, noteDe, seuilBas)
    });
  }
  // Le record ne se prend que sur des séries qu'on a vécues journal ouvert.
  for (const p of prises)
    p.plus_longue = p.series.filter(s => !s.maigre).reduce((m, s) => Math.max(m, s.jours), 0);

  /* L'ordre : ce qui a des signes d'abord, puis ce qui monte, puis le
     nombre. Le tabac, constant et sans signe, ne doit pas occuper la
     première ligne pendant que les stimulants doublent en silence. */
  const pente = p => !p.compare ? 0
    : p.recent / Math.max(1, p.recent_sur) - p.avant / Math.max(1, p.avant_sur);
  prises.sort((a, b) => (b.signes.length - a.signes.length) || (pente(b) - pente(a)) || (b.n - a.n));

  return {
    assez: ecrits.length >= 2 * SEUILS_PRISES.min_jours,
    ecrites: ecrits.length, fenetre: SEUILS_PRISES.fenetre,
    de: ecrits[0] ?? null, a: fin, prises, ecartees
  };
}

/** La note en dessous de laquelle une journée est « basse » chez cette personne. */
function medianeMoins(noteDe, ecart = 1) {
  const v = [...noteDe.values()].sort((a, b) => a - b);
  if (v.length < 8) return null;
  const m = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
  return m - ecart;
}

/**
 * Les signes retenus pour une prise : ceux écrits un jour de prise, ou la
 * journée écrite juste avant ou juste après. Au-delà, on rattacherait à
 * l'alcool une phrase écrite trois semaines plus tôt sur autre chose.
 */
function signesRetenus(joursPrise, signesParJour, ecrits) {
  const idx = new Map(ecrits.map((d, i) => [d, i]));
  const proches = new Set();
  for (const d of joursPrise) {
    const i = idx.get(d); if (i == null) continue;
    for (const k of [i - 1, i, i + 1]) if (ecrits[k]) proches.add(ecrits[k]);
  }
  const out = [];
  for (const d of [...proches].sort())
    for (const s of signesParJour.get(d) ?? [])
      if (!out.some(o => o.id === s.id)) out.push({ ...s, quand: d });
  return out;
}

/**
 * CE QUI VIENT AVANT — le même comptage que les flèches de la carte.
 *
 * Pour chaque chose de la carte : est-ce que la prise tombe sur la journée
 * écrite suivante plus souvent qu'après les autres journées. `sens.js` fait
 * le test exact ; on ne garde que le sens « la chose, puis la prise », parce
 * que l'inverse (la prise, puis la chose) n'est pas un déclencheur, c'est une
 * conséquence — et qu'on ne peut rien en faire à l'avance.
 */
function ceQuiVientAvant(joursPrise, carte, suite) {
  const out = [];
  for (const n of carte?.noeuds ?? []) {
    const jn = (n.jours ?? []).map(j => typeof j === 'string' ? j : j?.d).filter(Boolean);
    if (jn.length < SEUILS_PRISES.min_avant) continue;
    const s = sensDuLien(jn, joursPrise, suite);
    if (s.sens !== 'de') continue;                       // « deux » : ça tourne, ce n'est pas un déclencheur
    if (s.de.apres < SEUILS_PRISES.min_avant) continue;
    out.push({ nom: n.nom, apres: s.de.apres, sur: s.de.sur, p: s.de.p });
  }
  return out.sort((a, b) => a.p - b.p).slice(0, 3);
}

/**
 * LE LENDEMAIN ÉCRIT. Est-ce que la journée d'après est basse plus souvent
 * qu'après les autres journées ? Le jour même ne dirait rien : une note
 * basse peut être ce qui a mené à la prise. Le lendemain, non.
 */
function leLendemain(joursPrise, suite, noteDe, seuilBas) {
  if (seuilBas == null) return null;
  const A = new Set(joursPrise);
  let bas = 0, sur = 0, horsBas = 0, hors = 0;
  for (const [d, s] of suite) {
    const n = noteDe.get(s); if (n == null) continue;
    if (A.has(d)) { sur++; if (n <= seuilBas) bas++; }
    else { hors++; if (n <= seuilBas) horsBas++; }
  }
  if (sur < SEUILS_PRISES.min_avant || !hors) return null;
  const p = fisher(bas, sur, horsBas, hors);
  return { bas, sur, hors_bas: horsBas, hors, p, tient: p < SEUILS_PRISES.p && bas >= SEUILS_PRISES.min_avant };
}

/* ------------------------------------------------------------------ *
 * L'ENTRÉE DEPUIS LE SERVEUR.
 * ------------------------------------------------------------------ */
export function prises(userId = OWNER, { carte = null, aujourdhui = null } = {}) {
  return analyserPrises(allEntries(userId), { carte, aujourdhui });
}
