/**
 * =====================================================================
 *  CE QUE LA PERSONNE CONSOMME — « ce qui a de la prise », jadis : le jeu de
 *  mots (emprise / dose) a cédé la place au mot que le champ des repères lui
 *  donne déjà, « consommation ».
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

import { allEntries, allEvents, allObjectifs, OWNER } from './db.js';
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
const ou = (...res) => new RegExp(res.map(r => r.source).join('|'));

/* LA REPRISE EST UN VERBE DE PRISE, POUR TOUTES LES FAMILLES.
   « reprise de la weed », « j'ai repris la clope », « j'ai rechuté sur la
   coke » : le nom y est, et aucun verbe de la famille — « repris » n'existait
   que chez les stimulants, « reprise » et « rechute » nulle part. C'est
   pourtant LA façon d'écrire le jour qui compte le plus. Chaque forme est
   bornée à la première personne ou à un complément (« retombé dans », pas
   « retombé sur mes pieds ») ; elle ne compte qu'avec un nom de famille dans
   la même proposition, donc « j'ai repris le sport » reste muet. « craqué »
   n'y est pas : on craque d'abord en pleurant. */
const V_REPRISE = /\bj ai (?:repris|rechute|replonge|recraque)\b|\bje suis retombe(?:e)? (?:dans|dedans)\b|\breprise (?:de la|de l|du|des|de)\b|\brechute (?:sur|dans|avec|a la|au)\b|\breplonge(?:e)? dans\b/;

const V_BOIRE = ou(/\b(?:bu|boire|bois|boit|sifle|siffle|descendu|vide|fini|enchaine|picole|picoler|picolais)\b/, V_REPRISE);

/* CE QU'ON BOIT QUI N'EST PAS DE L'ALCOOL.
   « j'ai bu un verre d'eau » comptait pour un jour d'alcool : le verbe y est,
   le mot « verre » aussi. C'est le faux positif le plus bête et le plus
   fréquent, et aucun réglage de seuil ne le rattrape — il faut nommer ce qui
   n'en est pas. */
const SANS_ALCOOL = /\b(?:d eau|de l eau|de flotte|de la flotte|de jus|de lait|de the|de tisane|de cafe|de coca|de soda|de sirop|d orange|de citronnade|de limonade|de menthe|de grenadine|de kefir|de kombucha|de bouillon|de smoothie)\b|\bbu (?:un |une |deux |trois |quatre |cinq |six |plusieurs |quelques |\d+ |mon |ma |mes |des |du |de la |de l |l )?(?:cafes?|the|jus|lait|eau|flotte|sodas?|coca|smoothies?|infusions?|tisanes?|chocolat|bouillon)\b|\bde shampoing\b|\bde lessive\b|\bd huile\b|\bde vinaigre\b|\bde gel douche\b|\bsans alcool\b/;
const V_FUMER = ou(/\b(?:fume|fumer|fumais|refume|tire|roule|grille|taffe|taffes|clope)\b/, V_REPRISE);
const V_PRENDRE = ou(/\b(?:pris|reprends|repris|prends|sniffe|snife|gobe|tape|consomme|avale|shoote|injecte|dose|sous)\b/, V_REPRISE);

/* LE VERBE DE FUMÉE SANS OBJET. « j'ai fumé hier soir », « on a fumé »,
   « j'ai refumé », « quelques lattes » : c'est la façon courante d'écrire le
   cannabis pour qui ne nomme jamais le tabac — et ça ne comptait pour rien,
   parce qu'aucune famille n'avait de nom dans la phrase. On le lit à part,
   collé à la première personne (« j'ai vu mon pote qui a fumé » ne colle pas),
   et le moteur décide plus loin, sur ce que le reste du dossier nomme, à qui
   ces jours vont. « je vais fumer », « envie de fumer » n'y sont pas : c'est
   l'intention, relevée comme signe. */
const FUMEE_NUE = /\b(?:j ai|on a|je me suis) (?:re)?fume\b|\b(?:quelques|deux|trois|des|plusieurs|une) (?:lattes?|taffes?)\b/;
/* Ce qui se fume sans être fumé : la cuisine, la colère, le café. */
const FUMEE_SAUF = /\b(?:saumon|poisson|jambon|lard|fromage|tofu|paprika|the|viande|magret|truite|hareng|haddock|sel|gouda|piment|poitrine|maquereau) fume\b|\bfume (?:une|un|le|la|les|des|du|mon|ma|mes) (?:cotes?|magrets?|poissons?|saumon|viandes?|truites?|poulets?|jambon|fromages?|poitrine|travers|steak|filets?|maquereau|sardines?|brisket)\b|\bfume (?:au|a la|a l) (?:barbecue|bois|hetre|chene|sciure|fumoir)\b|\bfume (?:de|par) (?:rage|colere)\b|\b(?:un|le|mon|au|du) latte\b|\bfumer la moquette\b|\bfume (?:pas|plus|jamais)\b/;

/* UN POSSESSIF APRÈS LE NOM. La garde tiers de `veille.js` veut un verbe
   après le proche (« mon frère a bu ») ; « la reprise de la weed de mon
   frère » n'en a pas, et compterait pour la personne. Sauf si elle s'y met
   elle-même : « j'ai fumé la weed de mon frère » reste à elle. */
const TIERS_APRES = /\b(?:weed|beuh|shit|cannabis|joints?|clopes?|cigarettes?|tabac|alcool|bieres?|vin|coke|md|xanax|picole) (?:de|du|a) (?:mon frere|ma soeur|mon pere|ma mere|mon pote|ma pote|mon ami|mon amie|mon copain|ma copine|mon mec|ma meuf|mon ex|mon coloc|ma coloc|mes potes|mes amis|mes parents)\b/;

export const FAMILLES = [
  { cle: 'alcool', nom: 'l’alcool', sym: 'verre',
    mots: /\b(?:alcool|biere|bieres|vin|vodka|whisky|rhum|gin|pastis|ricard|champagne|tequila|jaeger|shot|shots|pinte|pintes|verre|verres|bouteille|bouteilles|apero|aperitif)\b/,
    verbe: V_BOIRE, sauf: SANS_ALCOOL,
    /* UN NOMBRE ET UN VERRE SUFFISENT. « trois verres de vin, encore une fois »
       n'a pas de verbe : exiger « bu » perdait un jour planté sur quatre au
       banc, et c'est une des façons les plus courantes de l'écrire. */
    /* « j'ai picolé » se lit sur le même motif que « j'ai bu » — pas sur le mot
       seul : `norm` confond le verbe et le nom, et « arrêter la picole » ne
       doit pas compter. */
    franc: /\b(?:un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|douze|quelques|plusieurs|\d+) (?:verres?|bieres?|pintes?|shots?|coupes?|bouteilles?|canettes?)\b|\bverres? de (?:vin|rouge|blanc|rose|whisky|vodka|rhum|gin|champagne)\b|\bl? ?apero\b|\bj ai (?:encore |trop |beaucoup |pas mal |un peu |bien )?(?:bu|picole)\b|\bje me suis bourre(?:e)?\b|\bbourre(?:e|es|s)?\b|\bivre\b|\b(?:une |grosse |la )?cuite\b|\bblack ?out\b|\bgueule de bois\b|\btorche(?:e|es)?\b|\balcoolise(?:e)?\b|\bcoma ethylique\b|\bpompette\b|\bemeche(?:e|es)?\b|\bbiture\b/ },

  { cle: 'cannabis', nom: 'le cannabis', sym: 'feuille',
    mots: /\b(?:cannabis|beuh|weed|shit|herbe|bedo|bedos|joint|joints|spliff|spliffs|bang|bangs|pet|pets|teuh|ganja)\b/,
    /* « vapé de la weed », « quelques lattes sur le joint ». « vape » n'entre
       PAS chez le tabac : c'est déjà le nom de l'objet dans ses `mots`, et
       « ma vape est cassée » compterait. */
    verbe: ou(V_FUMER, /\b(?:vape|vapote|lattes?)\b/),
    /* « j'ai fait un bang » : « fait » ne peut pas entrer dans V_FUMER (« le
       chien a fait un pet »), il lui faut sa tournure entière. */
    franc: /\b(?:beuh|bedo|bedos|spliff|spliffs|ganja)\b|\b(?:un|deux|trois|quatre|des|plusieurs) joints?\b|\bdefonce(?:e|es)? (?:a|au) (?:la beuh|shit|cannabis)\b|\bj ai (?:fait|tape|tire|pris) (?:un|deux|trois|des|plusieurs|quelques) bangs?\b/ },

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
    franc: /\b(?:un|deux|trois|dix|quinze|vingt|\d+) (?:clopes|cigarettes)\b|\bun paquet\b|\bmanque de nicotine\b|\bj ai vapote\b/ },

  { cle: 'argent', nom: 'les paris', sym: 'de',
    mots: /\b(?:paris|parie|parier|betclic|winamax|unibet|pmu|casino|poker|machine a sous|jeux? d argent|grattage|grattages|bookmaker|mise|mises|cote|cotes)\b/,
    verbe: ou(/\b(?:parie|mise|joue|rejoue|remis|perdu|gagne|depose|recharge)\b/, V_REPRISE),
    /* Un poker entre amis avec des jetons virtuels n'est pas un pari. */
    sauf: /\b(?:gratuit|gratuite|virtuel|virtuels|virtuelle|pour rire|pour du beurre|sans argent|sans miser|fictif|demo)\b/,
    franc: /\b(?:betclic|winamax|unibet|pmu)\b|\bmachine a sous\b|\bjeux? d argent\b/ },

  /* FUMÉ, SANS DIRE QUOI. Pas de `mots` ni de `verbe` : la tournure entière
     est le fait (voir FUMEE_NUE). Une famille à part, pour ne pas deviner :
     c'est `fondreFumee` qui la verse dans le cannabis ou le tabac quand le
     dossier n'en nomme qu'un, et qui la laisse telle quelle sinon. */
  { cle: 'fume', nom: 'fumé, sans dire quoi', sym: 'point',
    sauf: FUMEE_SAUF, franc: FUMEE_NUE }
];

/** La famille qu'une phrase NOMME — le mot y est, sans qu'on sache si elle
    l'a pris. Sert au rattachement des signes et à la lecture des repères. */
const nomme = np => FAMILLES.filter(f => f.mots?.test(np) && !f.sauf?.test(np)).map(f => f.cle);
const MOTS_G = new Map(FAMILLES.filter(f => f.mots).map(f => [f.cle, new RegExp(f.mots.source, 'g')]));

/* Les gardes propres à la lecture longue : un souvenir raconté n'est pas un
   jour de prise. `veille.js` a les siennes (tiers, négation, hyperbole,
   intention) et on les réutilise telles quelles — voir GARDES_SUBSTANCE. */
const SOUVENIR = /\b(?:a l epoque|quand j etais|il y a (?:des annees|un an|deux ans|longtemps)|dans ma jeunesse|avant je|je buvais|je fumais|j en prenais|pendant des annees|a l adolescence|au lycee|en soiree etudiante)\b/;
const QUESTION = /\?\s*$/;

/* ------------------------------------------------------------------ *
 * LES SIGNES. Chacun rend la phrase qui l'a allumé — jamais un verdict nu.
 *
 * Le `dit` est court et factuel, la phrase citée juste après fait le reste.
 * « tu as craqué après avoir tenu » et « tu l'as caché » disaient ce que la
 * personne AVAIT FAIT — un verdict sur l'acte, sous une icône de trait brisé :
 * l'image même de l'échec, que l'en-tête de ce fichier refuse. On nomme ce
 * qui est écrit, pas ce que ça vaut.
 * ------------------------------------------------------------------ */
const SUBSTANCE_NOMMEE = '(?:weed|beuh|shit|cannabis|joints?|clopes?|cigarettes?|tabac|vape|alcool|picole|bieres?|vin|coke|md|xanax)';
export const SIGNES = [
  { id: 'arreter', dit: 'vouloir arrêter',
    re: /\b(?:j ai arrete|je veux arreter|je voulais arreter|j essaie d arreter|j essaye d arreter|je dois arreter|il faut que j arrete|je devrais arreter|j arrete|sevrage|desintox|je tiens (?:bon|le coup)|(?:zero|sans) (?:alcool|drogue) depuis|sobre depuis|j ai tenu \d+ jours)\b/ },
  /* LA REPRISE, BORNÉE. « j'ai repris » s'allumait sur « j'ai repris le
     sport », « je suis retombé » sur « retombé sur mes pieds », « j'ai craqué »
     sur « j'ai craqué et j'ai pleuré » — et chacun devenait « tu as craqué »
     dès qu'il tombait à côté d'un jour d'alcool. On exige la fin de la
     proposition, ou une substance derrière ; et « j'ai refumé », « reprise de
     la weed » n'allumaient rien du tout. Reste « j'ai craqué. » seul, qui peut
     vouloir dire pleurer : il ne se règle que par le rattachement (rendu à
     ±1 journée écrite d'une prise), et c'est documenté ici. */
  { id: 'craque', dit: 'repris après un arrêt',
    re: new RegExp(`\\b(?:j ai craque(?! (?:pour|sur|devant|nerveusement|en larmes|en voyant)\\b)(?! (?:et|puis) (?:j ai )?(?:pleure|chiale|fondu|sanglote|hurle|crie)\\b)|j ai replonge|j ai pas tenu|j ai rechute|ca a recommence|j ai pas reussi a (?:arreter|tenir)|j ai (?:refume|rebu|recraque|resniffe|retouche)|reprise (?:de la|de l|du|des) ${SUBSTANCE_NOMMEE}|je suis retombe(?:e)?(?=\\s*[.,;!…?]|\\s*$| dedans\\b)|j ai repris(?=\\s*[.,;!…?]|\\s*$| (?:la |le |les |de la |du |des |l )?${SUBSTANCE_NOMMEE}\\b))\\b`) },
  { id: 'manque', dit: 'l’envie',
    re: /\b(?:en manque|le manque|j en ai envie|envie de (?:boire|fumer|prendre|sniffer|me defoncer)|je pense qu a (?:ca|boire|fumer)|obsede par|il me faut|je tiens plus|j y pense tout le temps|craving)\b/ },
  { id: 'plus_que_prevu', dit: 'plus que prévu',
    /* « encore une fois » et « j'ai fini par » y étaient et s'allumaient sur
       tout — « encore une fois j'ai oublié mes clés » n'est pas une perte de
       contrôle. Ce qui compte, c'est l'écart entre ce qu'on avait prévu et ce
       qu'on a fait ; il faut donc que la phrase dise les deux. */
    re: /\b(?:plus que prevu|je voulais (?:juste|juste en prendre|m arreter)|j ai pas su m arreter|j ai fini par (?:en |y )?(?:reprendre|boire|fumer|craquer|ceder|remettre)|comme d habitude j ai|je devais (?:en )?(?:prendre|boire) (?:qu )?un)\b/ },
  { id: 'cache', dit: 'sans le dire',
    re: /\b(?:en cachette|personne (?:le )?sait|j ai menti|je (?:l )?ai cache|sans (?:le )?dire a|tout seul dans ma chambre|avant de (?:rentrer|sortir) j ai)\b/ }
];

/* ------------------------------------------------------------------ *
 * LA DÉTECTION, UN JOUR À LA FOIS.
 * ------------------------------------------------------------------ */

/*
 * LA LECTURE D'UN TEXTE SE GARDE, PARCE QU'ELLE EST REFAITE À CHAQUE MESSAGE.
 *
 * Le bloc du compagnon rappelle les comptages à chaque phrase envoyée, et
 * chaque phrase envoyée vide le cache de la série — donc tout le journal était
 * relu, six familles d'expressions par journée, à chaque message : 200 ms
 * ajoutées au fil, pour un résultat qui ne change que d'une journée.
 *
 * Or la détection ne dépend QUE du texte. On garde donc sa lecture par texte,
 * et une journée qu'on vient d'écrire est la seule à être relue. La clé porte
 * la longueur en plus de l'empreinte : deux textes de longueurs différentes ne
 * peuvent pas se confondre, et une collision demanderait deux textes de même
 * longueur et de même empreinte.
 */
const MEMO = new Map();
const MEMO_MAX = 4000;
function empreinte(t) {
  let h = 2166136261;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${t.length}:${(h >>> 0).toString(36)}`;
}
function luDuTexte(texte) {
  const t = String(texte ?? '');
  const cle = empreinte(t);
  let v = MEMO.get(cle);
  if (!v) {
    v = { prises: prisesDuTexte(t), signes: signesDuTexte(t) };
    if (MEMO.size >= MEMO_MAX) MEMO.delete(MEMO.keys().next().value);
    MEMO.set(cle, v);
  }
  return v;
}

/**
 * Les familles vues dans un texte, chacune avec la proposition qui l'a fait
 * compter. Rien ne compte sur un mot seul : il faut un verbe de prise, ou un
 * mot qui ne peut rien vouloir dire d'autre.
 *
 * @returns {Map<string, {phrase: string, signes: string[], lus: string[]}>}
 *   `lus` : les mots de la famille effectivement lus (« md », « xanax »),
 *   pour que la vue puisse rendre ce qui a été écrit plutôt que la catégorie.
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
      if (TIERS_APRES.test(q) && !/\b(?:je|j ai|moi|on a)\b/.test(q)) continue;
      if (GARDES_SUBSTANCE.negation.test(q)) continue;
      if (SOUVENIR.test(q)) continue;
      for (const f of FAMILLES) {
        if (f.sauf?.test(q)) continue;               // « un verre d'eau » n'est pas un verre
        const franc = f.franc.test(q);
        if (!franc && !(f.mots?.test(q) && f.verbe?.test(q))) continue;
        // « j'ai envie de boire » n'est pas « j'ai bu » : l'envie est un signe,
        // pas un jour de prise. Elle est relevée plus bas, sur le même texte.
        if (!franc && GARDES_SUBSTANCE.intention.test(q) && !/\bj ai\b|\bje me suis\b|\bhier\b/.test(q)) continue;
        if (!out.has(f.cle)) out.set(f.cle, { phrase: phrase.trim().slice(0, 200), signes: [], lus: [] });
        const lus = out.get(f.cle).lus;
        for (const m of q.match(MOTS_G.get(f.cle)) ?? []) if (!lus.includes(m)) lus.push(m);
      }
    }
  }
  /* « j'ai fumé un joint » est un joint : la fumée nue ne dit quelque chose
     que quand rien d'autre, dans le texte, ne dit quoi. */
  if (out.has('fume') && (out.has('cannabis') || out.has('tabac'))) out.delete('fume');
  return out;
}

/** Les signes lus dans un texte, avec leur phrase. Indépendants des familles :
    « j'ai craqué » ne nomme pas ce qui a craqué, et c'est très bien ainsi. */
export function signesDuTexte(texte) {
  const out = [];
  for (const phrase of String(texte ?? '').split(/(?<=[.!?…])\s+|\n+/)) {
    const np = norm(phrase);
    if (!np.trim() || (GARDES_SUBSTANCE.tiers.test(np) || TIERS_APRES.test(np)) && !/\b(?:je|j ai|moi)\b/.test(np)) continue;
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

const DATE = /^\d{4}-\d{2}-\d{2}/;
const ARRET = /\b(?:arret|arrete|arreter|stop|sevrage|sobre|sobriete|abstinence|abstinent|desintox|cure|sans|fin de|plus de)\b/;

/**
 * @param {object[]} entrees  [{date, note, text}] triées, le journal entier
 * @param {object|null} carte la carte de la lecture, pour « ce qui vient avant »
 * @param {string|null} aujourdhui
 * @param {object[]} reperes   les repères de la frise [{date, fin, ouvert, label, theme}]
 * @param {object[]} objectifs [{quoi, genre, cree_le, depuis, tenu, reprises}]
 *
 * CE QUE LA PERSONNE A DÉJÀ DÉCLARÉ COMPTE. Le repère « reprise de la weed »
 * vit dans la table des repères, l'objectif « arrêter la cigarette » dans la
 * sienne, et le moteur ne lisait que le texte des journées : la seule mention
 * datée et explicite du cannabis était dans une table qu'il n'ouvrait pas, et
 * aucune expression, si bonne soit-elle, ne pouvait la retrouver. Un repère
 * qui nomme une famille est un jour de cette famille à sa date, avec son
 * libellé pour phrase ; un objectif qui la nomme est le signe « vouloir
 * arrêter », daté du jour où il a été posé.
 */
export function analyserPrises(entrees, { carte = null, aujourdhui = null, reperes = [], objectifs = [] } = {}) {
  const rows = (entrees ?? []).filter(e => e?.date).sort((a, b) => a.date < b.date ? -1 : 1);
  const ecrits = rows.filter(e => String(e.text ?? '').trim()).map(e => e.date);
  const fin = aujourdhui ?? ecrits.at(-1) ?? null;
  const noteDe = new Map(rows.filter(e => e.note != null).map(e => [e.date, +e.note]));

  const vues = new Map();            // cle -> { jours: [], preuves: Map<date, phrase>, lus: Map<mot, n>, reperes: n }
  const signesParJour = new Map();   // date -> [signe]
  const declare = new Set();         // les familles que les repères et les objectifs nomment
  const poser = (cle, date, phrase, lus = [], source = 'ecrit') => {
    if (!vues.has(cle)) vues.set(cle, { jours: [], preuves: new Map(), lus: new Map(), reperes: 0 });
    const x = vues.get(cle);
    if (!x.preuves.has(date)) { x.jours.push(date); x.preuves.set(date, phrase); if (source === 'repere') x.reperes++; }
    for (const m of lus) x.lus.set(m, (x.lus.get(m) ?? 0) + 1);
  };
  const signaler = (date, signes) => {
    if (!signes.length) return;
    const l = signesParJour.get(date) ?? [];
    for (const s of signes) if (!l.some(o => o.id === s.id)) l.push(s);
    signesParJour.set(date, l);
  };
  for (const e of rows) {
    const t = e.text;
    if (!String(t ?? '').trim()) continue;
    const lu = luDuTexte(t);
    for (const [cle, v] of lu.prises) poser(cle, e.date, v.phrase, v.lus);
    signaler(e.date, lu.signes);
  }

  for (const r of reperes ?? []) {
    const date = String(r?.date ?? '').slice(0, 10);
    if (!DATE.test(date) || !String(r.label ?? '').trim()) continue;
    const lu = luDuTexte(r.label);
    let fams = [...lu.prises.keys()];
    /* Un repère de consommation qui ne fait que nommer — « cannabis », posé
       comme période — est une déclaration, pas une phrase à garder : on le
       prend sur le mot, sauf s'il dit l'arrêt. */
    if (!fams.length && r.theme === 'conso' && !ARRET.test(norm(r.label))) fams = nomme(norm(r.label));
    for (const cle of fams) { poser(cle, date, String(r.label).trim().slice(0, 200), lu.prises.get(cle)?.lus ?? [], 'repere'); declare.add(cle); }
    signaler(date, lu.signes);
  }
  for (const o of objectifs ?? []) {
    const np = norm(o?.quoi);
    const fams = nomme(np);
    if (!fams.length) continue;
    for (const cle of fams) declare.add(cle);
    const date = String(o.cree_le ?? o.depuis ?? '').slice(0, 10);
    if (DATE.test(date)) signaler(date, [{ id: 'arreter', dit: SIGNES[0].dit, phrase: String(o.quoi).trim().slice(0, 200) }]);
  }

  const alias = fondreFumee(vues, declare);

  const suite = suiteDe(ecrits, SEUILS_SENS.ecart_max);
  const recents = ecrits.slice(-SEUILS_PRISES.fenetre);
  const avants = ecrits.slice(-2 * SEUILS_PRISES.fenetre, -SEUILS_PRISES.fenetre);
  const seuilBas = medianeMoins(noteDe);

  const prises = [], ecartees = [];
  for (const f of FAMILLES) {
    const v = vues.get(f.cle);
    if (!v) continue;
    v.jours.sort();
    if (v.jours.length < SEUILS_PRISES.min_jours) {
      /* « ce n'est pas une habitude » posait l'étiquette que le seuil de trois
         existe justement pour ne pas poser. On dit le compte, et le seuil. */
      ecartees.push({ cle: f.cle, nom: f.nom, n: v.jours.length,
        pourquoi: `écrit ${v.jours.length} jour${v.jours.length > 1 ? 's' : ''} — il en faut ${SEUILS_PRISES.min_jours} pour compter` });
      continue;
    }
    const set = new Set(v.jours);
    prises.push({
      cle: f.cle, nom: f.nom, sym: f.sym, source: v.reperes ? 'ecrit+repere' : 'ecrit',
      jours: v.jours, n: v.jours.length,
      /* Les mots lus, les plus fréquents d'abord : « md », « xanax » — ce que
         la personne a écrit, pour que la vue n'ait pas à dire « les
         stimulants » à quelqu'un qui n'a jamais employé ce mot. */
      lus: [...v.lus].sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x[0]),
      dont_fume: v.dont_fume ?? 0,
      dont_reperes: v.reperes,
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
      signes: signesRetenus(v.jours, signesParJour, ecrits, f.cle, alias),
      avant_ca: ceQuiVientAvant(v.jours, carte, suite),
      apres_ca: leLendemain(v.jours, suite, noteDe, seuilBas)
    });
  }
  /*
   * DEUX LECTURES DE LA MÊME LISTE, ET C'EST LA DENSITÉ QUI TRANCHE.
   *
   * Entre deux occurrences il y a un intervalle. Quand le journal est tenu, cet
   * intervalle est une SÉRIE SANS : on sait ce qui s'est passé dedans, et le
   * plus long est un record qui veut dire quelque chose. Quand il est ouvert un
   * jour sur treize — le cas normal ici — on ne sait rien de ce qui s'est passé
   * dedans, et l'appeler « série sans » serait un compliment inventé.
   *
   * On ne cachait pas le problème : chaque série était marquée maigre, le
   * record tombait à zéro, et la vue affichait onze barres en pointillés sans
   * rien en dire. Honnête et inutile. L'intervalle, lui, se mesure quelle que
   * soit la densité — les deux bornes sont écrites. On le nomme donc pour ce
   * qu'il est, et le panneau redevient lisible sans rien promettre de faux.
   */
  for (const p of prises) {
    p.plus_longue = p.series.filter(s => !s.maigre).reduce((m, s) => Math.max(m, s.jours), 0);
    p.plus_long_ecart = p.series.reduce((m, s) => Math.max(m, s.jours), 0);
    const tenues = p.series.filter(s => !s.maigre).length;
    p.lecture = p.series.length && tenues >= p.series.length / 2 ? 'series' : 'ecarts';
  }

  /* L'ordre : ce qui a des signes d'abord, puis ce qui monte, puis le
     nombre. Le tabac, constant et sans signe, ne doit pas occuper la
     première ligne pendant que les stimulants doublent en silence. */
  const pente = p => !p.compare ? 0
    : p.recent / Math.max(1, p.recent_sur) - p.avant / Math.max(1, p.avant_sur);
  rattacherReprises(prises, signesParJour, ecrits);
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
 * À QUI VONT LES JOURS « FUMÉ, SANS DIRE QUOI ».
 *
 * On ne devine pas : si le dossier — journées, repères, objectifs — nomme le
 * cannabis et jamais le tabac, c'est du cannabis ; l'inverse, du tabac ; les
 * deux ou aucun, ils restent une famille à part, comptée et dessinée sous
 * son propre nom. Le compte des jours versés est rendu (`dont_fume`) pour
 * que la vue puisse dire « dont 3 jours écrits juste “fumé” ».
 *
 * @returns {Map<string, string>} l'alias : 'fume' → la famille qui l'a reçu
 */
function fondreFumee(vues, declare) {
  const alias = new Map();
  const nue = vues.get('fume');
  if (!nue) return alias;
  const a = vues.has('cannabis') || declare.has('cannabis');
  const b = vues.has('tabac') || declare.has('tabac');
  const cible = a && !b ? 'cannabis' : b && !a ? 'tabac' : null;
  if (!cible) return alias;
  if (!vues.has(cible)) vues.set(cible, { jours: [], preuves: new Map(), lus: new Map(), reperes: 0 });
  const x = vues.get(cible);
  let verses = 0;
  for (const d of nue.jours) if (!x.preuves.has(d)) { x.jours.push(d); x.preuves.set(d, nue.preuves.get(d)); verses++; }
  x.jours.sort();
  x.dont_fume = verses;
  vues.delete('fume');
  alias.set('fume', cible);
  return alias;
}

/**
 * LA REPRISE NUE. « j'ai repris. », « je suis retombé dedans » ne nomment
 * rien, et n'étaient rendus que s'ils tombaient à ±1 journée écrite d'un jour
 * déjà compté : écrits trois semaines après le dernier jour d'alcool, ils
 * disparaissaient — alors que c'est la phrase qu'on voudrait le moins perdre.
 * On les rattache à la famille la plus récente du journal (le dernier jour
 * compté avant la phrase ; à défaut, la première famille qui vient après), et
 * on le dit : `rattache: 'recent'`. Ce n'est pas un jour de plus — on ne sait
 * pas de quoi — c'est un signe, avec sa phrase et sa date.
 */
function rattacherReprises(prises, signesParJour, ecrits) {
  if (!prises.length) return;
  const couverts = new Set(prises.flatMap(p => [...voisins(p.jours, ecrits)]));
  for (const d of [...signesParJour.keys()].sort()) {
    if (couverts.has(d)) continue;
    for (const s of signesParJour.get(d)) {
      if (s.id !== 'craque' || luDuTexte(s.phrase).prises.size || nomme(norm(s.phrase)).length) continue;
      const dernier = p => p.jours.filter(j => j <= d).at(-1) ?? null;
      const avant = prises.filter(p => dernier(p)).sort((a, b) => dernier(b) < dernier(a) ? -1 : 1)[0];
      const cible = avant ?? prises.slice().sort((a, b) => a.jours[0] < b.jours[0] ? -1 : 1)[0];
      if (!cible || cible.signes.some(o => o.id === 'craque')) continue;
      cible.signes.push({ ...s, quand: d, rattache: 'recent' });
    }
  }
}

/** Les journées écrites à ±1 d'un jour de prise, et les jours eux-mêmes —
    un jour venu d'un repère n'est pas forcément une journée écrite. */
function voisins(joursPrise, ecrits) {
  const idx = new Map(ecrits.map((d, i) => [d, i]));
  const out = new Set(joursPrise);
  for (const d of joursPrise) {
    const i = idx.get(d); if (i == null) continue;
    for (const k of [i - 1, i + 1]) if (ecrits[k]) out.add(ecrits[k]);
  }
  return out;
}

/**
 * Les signes retenus pour une prise : ceux écrits un jour de prise, ou la
 * journée écrite juste avant ou juste après. Au-delà, on rattacherait à
 * l'alcool une phrase écrite trois semaines plus tôt sur autre chose — SAUF
 * si la phrase nomme la famille : « arrêter la cigarette », posé comme
 * objectif deux mois avant le premier jour compté, parle bien de la
 * cigarette, et on le dit (`rattache: 'nomme'`).
 */
function signesRetenus(joursPrise, signesParJour, ecrits, cle, alias = new Map()) {
  const proches = voisins(joursPrise, ecrits);
  /* Un seul par signe, LE PLUS RÉCENT : on gardait le premier, et « j'ai
     repris la weed » écrit hier restait derrière un « j'ai refumé » d'il y a
     trois mois. C'est la dernière fois qu'on veut sous les yeux. */
  const out = new Map();
  for (const d of [...signesParJour.keys()].sort())
    for (const s of signesParJour.get(d) ?? []) {
      const pres = proches.has(d);
      const nommee = nomme(norm(s.phrase)).includes(cle);
      if (!pres && !nommee) continue;
      /*
       * UNE PHRASE QUI NOMME UNE AUTRE FAMILLE NE PARLE PAS DE CELLE-CI.
       *
       * Les signes sont volontairement aveugles à la famille — « j'ai craqué »
       * ne dit pas de quoi. Mais un jour où l'on a écrit l'alcool ET le
       * cannabis leur donnait les mêmes signes, et la carte du cannabis citait
       * « trois verres de vin, encore une fois ». Une preuve qui parle
       * visiblement d'autre chose ruine la confiance qu'on a dans toutes les
       * autres. Une phrase muette sur la famille reste partagée : c'est
       * l'honnêteté du cas, pas une approximation.
       */
      const dedans = [...luDuTexte(s.phrase).prises.keys()].map(k => alias.get(k) ?? k);
      if (dedans.length && !dedans.includes(cle)) continue;
      out.set(s.id, pres ? { ...s, quand: d } : { ...s, quand: d, rattache: 'nomme' });
    }
  return [...out.values()].sort((a, b) => a.quand < b.quand ? -1 : 1);
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
  return analyserPrises(allEntries(userId),
    { carte, aujourdhui, reperes: allEvents(userId), objectifs: allObjectifs(userId) });
}
