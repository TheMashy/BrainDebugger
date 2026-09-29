/**
 * UNE JOURNÉE, HEURE PAR HEURE.
 *
 * On ouvrait une journée et on y trouvait sa note, son texte, et rien de ce qui
 * s'était PASSÉ dedans. Or une journée notée 8 peut contenir « juste envie de
 * mourir » écrit le soir : c'est la bascule qui la raconte, pas le niveau moyen.
 *
 * Ce module découpe le fil de la journée en MOMENTS et rend, pour chacun, son
 * heure, ce qui s'y disait en une ligne, et l'ambiance que ces mots-là portent.
 * Rien n'est demandé à un modèle : la ligne est la phrase de la personne, pas
 * un résumé qu'on aurait fabriqué à sa place — et une paraphrase de ce qu'on a
 * écrit un mauvais soir n'a aucune raison d'être plus juste que la phrase.
 */
import { db, messagesForDate, relevesDuJour, getEntry, allEntries, OWNER } from './db.js';
import { buildSeries } from './stats.js';
import { readMood, scoresDe, SENS, DEFAUT } from './mood.js';
import { themeDe, THEMES, DEFAUT as DEFAUT_THEME } from '../web/reperes.js';
/*
 * LA VEILLE ENTRE ICI, ET DANS CE SENS-LÀ SEULEMENT.
 *
 * `veille.js` ne connaît que `db.js` : l'importer depuis la journée ne fait
 * aucun cycle. L'inverse en ferait un, et c'est pour ça que le niveau d'un
 * moment se calcule ici plutôt que là-bas.
 */
import { niveauDuTexte, plafondCourrier } from './veille.js';
import { poids, CREUX } from './lexique.js';
import { zoneCourante } from './temps.js';

/**
 * Ce qui sépare deux moments.
 *
 * Vingt-cinq minutes : en dessous, on est dans le même échange — trois messages
 * d'affilée sont une seule chose qu'on dit, pas trois moments de la journée.
 * Au-dessus, on est revenu, et ce qui a changé entre-temps est justement ce
 * qu'on vient lire.
 */
export const TROU_MOMENT = 25 * 60 * 1000;

/** La longueur d'une ligne. Assez pour une phrase, trop court pour un paragraphe. */
export const COEUR_CAR = 96;

/**
 * LE CŒUR D'UN MOMENT : sa phrase, choisie, jamais réécrite.
 *
 * On prend la phrase la plus CHARGÉE — celle dont les mots pèsent le plus au
 * lexique — et pas la première. La première phrase d'un message est souvent
 * « hello », « bon » ou « alors voilà » ; ce qui compte arrive deux lignes plus
 * bas. À charge égale, la première gagne : elle est ce qu'on a voulu dire
 * d'abord.
 */
export function coeurDe(texte) {
  const brut = String(texte ?? '').replace(/\s+/g, ' ').trim();
  if (!brut) return '';
  const phrases = brut.split(/(?<=[.!?…])\s+|\s*\n+\s*/).map(p => p.trim()).filter(p => p.length > 2);
  if (!phrases.length) return couper(brut);
  let meilleure = phrases[0], score = -1;
  phrases.forEach((p, i) => {
    const mots = p.toLowerCase().match(/[a-zà-ÿ0-9']+/g) ?? [];
    let s = 0;
    for (const m of mots) if (!CREUX.has(m)) s += poids(m);
    // Une phrase de trois mots peut être très chargée sans rien raconter : on
    // ramène au nombre de mots, avec un plancher pour ne pas primer les brèves.
    s = s / Math.max(6, mots.length) * Math.min(1, mots.length / 5);
    if (s > score + 1e-9) { score = s; meilleure = p; }
  });
  return couper(meilleure);
}

/** Couper sur un mot, jamais au milieu, et le dire par une ellipse. */
function couper(t) {
  if (t.length <= COEUR_CAR) return t;
  const bout = t.slice(0, COEUR_CAR);
  const i = bout.lastIndexOf(' ');
  return (i > COEUR_CAR * 0.55 ? bout.slice(0, i) : bout).trimEnd() + '…';
}

/**
 * DE QUELS MESSAGES VIENT LA PHRASE QU'ON AFFICHE.
 *
 * Un moment tient tant qu'il ne s'est pas écoulé vingt-cinq minutes : c'est
 * souvent la conversation entière d'un soir, cinq ou dix messages. La ligne de
 * gauche n'en montre qu'UNE phrase, et cliquer dessus allumait les dix —
 * c'est-à-dire la colonne de droite en entier. Une colonne entièrement verte ne
 * désigne plus rien : c'est le défaut que cette fonction tient fermé.
 *
 * On refait EXACTEMENT le texte que `coeurDe` a lu (les messages recollés par
 * une espace, les blancs réduits), on y retrouve la phrase, et on rend les
 * messages que sa place recouvre. Un seul message par phrase serait faux : dans
 * un chat on écrit sans point, et une phrase court alors sur trois messages —
 * ces trois-là SONT la phrase, ils s'allument tous.
 *
 * Une phrase coupée à `COEUR_CAR` est un PRÉFIXE : on cherche sans l'ellipse,
 * et seuls les messages du morceau VISIBLE s'allument. Introuvable (un cas
 * qu'on n'a pas prévu), on rend tout le moment — le comportement d'avant,
 * jamais pire.
 */
export function messagesDuCoeur(coeur, textes = [], ids = []) {
  const noyau = String(coeur ?? '').replace(/…$/, '').trim();
  const morceaux = textes.map(t => String(t ?? '').replace(/\s+/g, ' ').trim());
  const debut = noyau ? morceaux.join(' ').indexOf(noyau) : -1;
  if (debut < 0) return [...ids];
  const fin = debut + noyau.length;
  const dedans = [];
  let curseur = 0;
  morceaux.forEach((p, i) => {
    const a = curseur, b = curseur + p.length;
    curseur = b + 1;                       // l'espace qui recolle les messages
    if (a < fin && b > debut && ids[i] != null) dedans.push(ids[i]);
  });
  return dedans.length ? dedans : [...ids];
}

/**
 * L'HEURE LOCALE D'UN MOMENT, dans le fuseau de qui lit.
 *
 * Pas une constante : minuit UTC est 01:00 à Paris et 17:00 à Los Angeles. Une
 * heure serveur ferait basculer les moments du soir au lendemain matin, et la
 * journée se raconterait à l'envers — le vide de 23h passerait avant le réveil.
 */
export function heureDe(ts, zone = zoneCourante()) {
  const d = new Date(ts);
  /*
   * UN INSTANT ILLISIBLE NE FAIT PAS TOMBER LA JOURNÉE.
   *
   * Le `catch` protégeait d'un fuseau invalide, et se rattrapait sur
   * `toISOString()` — qui lève exactement de la même façon quand c'est
   * l'INSTANT qui est mauvais. Un seul message dont la date ne se lisait pas
   * rendait donc 500 sur toute la vue du jour, et l'onglet restait blanc :
   * une ligne de travers emportait une journée entière.
   */
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone
    }).format(d);
  } catch { return d.toISOString().slice(11, 16); }
}

/**
 * LA CHARGE D'UN MOMENT, ENTRE −1 ET +1.
 *
 * Ce n'est PAS une note : personne ne l'a posée, elle est déduite des mots. Elle
 * ne sort donc jamais sur l'échelle des dix — la confondre avec une note
 * reviendrait à noter quelqu'un à sa place, ce que ce produit ne fait nulle
 * part. Elle sert à une seule chose : montrer que ça a bougé, et dans quel sens.
 */
const SIGNE = {
  brume: 1, drift: -0.35, grain: -0.5, mandel: -0.5,
  eclipse: -0.7, monolith: -0.7, abyss: -0.9, voidwell: -1
};

export const chargeDe = (scene, force) =>
  Math.max(-1, Math.min(1, (SIGNE[scene] ?? 0) * Math.min(1, (force ?? 0) / 3)));

/**
 * L'ESTIMATION D'UN MOMENT, SUR L'ÉCHELLE DE LA PERSONNE.
 *
 * Le module refusait jusqu'ici de sortir la charge sur l'échelle des dix, au
 * motif que la confondre avec une note reviendrait à noter quelqu'un à sa
 * place. La règle est bonne, la conclusion était trop large : ce qu'il ne faut
 * pas, c'est qu'une DÉDUCTION passe pour une DÉCLARATION. Rendue avec son
 * étiquette et affichée autrement, une estimation n'usurpe rien — et sans
 * elle, on ne voit pas les pics de la journée, qui sont précisément ce qu'on
 * vient chercher en ouvrant une journée.
 *
 * ELLE EST RELATIVE À LA NORMALE DE LA PERSONNE, pas à un 5 imaginaire. Chez
 * quelqu'un qui tourne à 4, une journée à 5 est une bonne journée ; la caler
 * sur le milieu de l'échelle la peindrait en médiocre. C'est déjà la façon dont
 * tout le reste du produit lit un chiffre : par son écart à la référence.
 *
 * L'amplitude de ±3 points n'est pas un réglage fin : elle dit que les mots
 * d'un moment déplacent d'au plus trois points autour de la normale. Plus
 * large, un moment sombre écrit à l'emporte-pièce sortirait à 1/10 ; plus
 * étroite, la ligne serait plate et ne montrerait plus rien.
 */
export const AMPLITUDE_ESTIMEE = 3;

/**
 * VERS OÙ PENCHE UN PASSAGE — et pourquoi ce n'est pas `readMood`.
 *
 * `readMood` répond à une autre question : « faut-il repeindre tout le décor de
 * l'application ? ». Ses garde-fous sont taillés pour ça — vingt-cinq mots au
 * minimum, un score d'au moins trois, et deux points d'avance sur la scène
 * suivante. Excellent pour choisir un décor, inutilisable sur un paragraphe :
 * appliqué à des passages de dix à vingt mots, il rend `force: 0` partout, et
 * l'estimation sort à la référence exacte pour tout le monde. Un chiffre
 * constant présenté comme une lecture est pire que pas de chiffre : il a l'air
 * de dire quelque chose.
 *
 * Ici on ne CHOISIT pas une scène, on lit une direction. La moyenne des
 * valences pondérée par les scores donne le sens ; la densité de mots chargés
 * donne l'intensité. Un passage dont le lexique ne dit rien rend `null`, et
 * l'affichage se tait — c'est le seul cas honnête.
 */
export const MOTS_PENCHE = 4;

/*
 * CE QUI PORTE UN SENS, ET CE QUI N'EN PORTE PAS.
 *
 * La lecture penchait vers le bas, et pas parce que les journées l'étaient.
 * L'aube et la pluie n'avaient aucune valence mais comptaient au dénominateur :
 * « la joie et la gratitude » pesait 0 tout en diluant le reste. Et le
 * monolithe lisait un rendez-vous comme une humeur : une phrase qui disait se
 * sentir bien en sortant d'une séance sortait plus bas que la même phrase où
 * la séance était remplacée par un film.
 *
 * D'où trois règles. Seuls les mots AFFECTIFS de l'aube penchent vers le haut
 * (l'espoir, la joie, la gratitude…) ; « matin », « demain », « réveil » ou
 * « envie de » disent une heure ou une tournure, pas un état, et n'entrent
 * nulle part. Le monolithe (l'épreuve, les rendez-vous) et la pluie (le
 * relâchement, qui peut arriver un très bon jour) sortent du numérateur ET du
 * dénominateur. Le reste garde le signe de SIGNE.
 */
const AUBE_AFFECTIVE = new Set([
  'espoir', 'espere', 'esperer', 'joie', 'joyeux', 'joyeuse', 'gratitude',
  'reconnaissant', 'reconnaissante', 'bonheur', 'confiance', 'confiant', 'confiante',
  'motive', 'motivee', 'enthousiaste', 'ca s arrange', 'ca va aller'
]);
const SANS_VALENCE = new Set(['monolith', 'pluie']);

function valenceDe({ scene, mot }) {
  if (scene === 'aube') return AUBE_AFFECTIVE.has(mot) ? 0.8 : null;
  if (SANS_VALENCE.has(scene)) return null;
  return SIGNE[scene] ?? null;
}

/*
 * LA DENSITÉ DE RÉFÉRENCE. 0,35 avait été réglé sur des totaux comptés en
 * double (« contente » valait deux fois « content », une expression s'ajoutait
 * à ses morceaux). `scoresDe` ne compte plus qu'une fois chaque bout de texte :
 * sur un vrai journal, les totaux ont baissé de 17 %, et la constante suit
 * (0,35 × 0,83) pour qu'un même passage garde la même intensité.
 */
export const DENSITE_PLEINE = 0.29;

export function pencheDe(texte) {
  const { retenues, mots } = scoresDe(texte);
  let total = 0, somme = 0;
  for (const r of retenues) {
    const v = valenceDe(r);
    if (v == null) continue;
    total += r.poids;
    somme += v * r.poids;
  }
  if (!total || mots < MOTS_PENCHE) return null;
  const sens = somme / total;
  /*
   * La densité, et pas le score brut : trois mots lourds dans une phrase de
   * huit mots pèsent, les mêmes trois mots dans un pavé de trois cents mots
   * sont une incise. Sans elle, un long texte plutôt neutre finirait aussi
   * chargé qu'un cri de deux lignes.
   */
  const densite = Math.min(1, total / (mots * DENSITE_PLEINE));
  /*
   * ET UNE PRUDENCE SUR LES PASSAGES TRES COURTS.
   *
   * La densité seule sature sur quatre mots : « ça va mieux ce soir » sortait à
   * l'amplitude maximale, aussi confiant qu'un paragraphe entier. Quatre mots
   * sont un indice, pas une démonstration — au-delà d'une dizaine, la retenue
   * n'a plus lieu d'être et le facteur vaut 1.
   */
  const assez = Math.min(1, (mots + 4) / 12);
  return Math.max(-1, Math.min(1, sens * densite * assez));
}

export function estimationDe(charge, reference = 5) {
  const v = reference + (charge ?? 0) * AMPLITUDE_ESTIMEE;
  // Au demi-point : dire « 4,37 » d'une déduction faite sur des mots serait une
  // précision inventée, et c'est exactement ce qui la ferait prendre au sérieux
  // comme une mesure.
  return Math.max(1, Math.min(10, Math.round(v * 2) / 2));
}

/**
 * LES MOMENTS DE LA JOURNÉE.
 *
 * Seulement ce que la PERSONNE a écrit. Les réponses du compagnon sont ses
 * mots à lui : les faire compter dans l'ambiance de la journée reviendrait à
 * lui faire teindre le décor avec ce qu'il vient de dire.
 */
/**
 * DE QUOI PARLE UN PASSAGE, EN ICÔNES.
 *
 * Les mêmes que devant les blocs de droite et que sur la frise : un sujet
 * reconnu ici porte le dessin qu'il porte là-bas. Phrase par phrase, parce que
 * `themeDe` prend le mieux-disant d'un TEXTE — appelé sur un moment entier il
 * ne rendrait qu'un thème là où on en a dit deux.
 *
 * PAS DE SEUIL D'OCCURRENCES, contrairement à `thematiquesDuJour`. Là-bas un
 * mot lâché une fois dans une journée n'est pas un thème de la journée ; ici le
 * moment fait vingt-cinq minutes, et exiger qu'un sujet y revienne deux fois
 * reviendrait à ne jamais rien montrer.
 *
 * À égalité, l'ordre d'apparition gagne : `Map` garde l'ordre d'insertion et le
 * tri de V8 est stable, donc le premier sujet dit reste le premier affiché.
 */
export const MAX_THEMES_MOMENT = 2;

/**
 * LE THÈME D'UNE PHRASE DE JOURNAL — pas celui d'un libellé de repère.
 *
 * `themeDe` est taillé pour « départ à Londres » ou « décès de mamie ». Sur des
 * phrases de journal, des tournures courantes y tombaient à plat : « en train
 * de » (le train) et « ça fait partie de » (partie) donnaient l'avion du
 * voyage, et « je suis perdu » ou une somme d'argent perdue, l'icône du
 * DEUIL — une étiquette grave que la personne n'a pas écrite, posée sur
 * « désorienté » ou sur une perte d'argent. Une seule icône pareille
 * discrédite toutes les autres.
 *
 * On retire ces tournures AVANT de demander le thème, et seulement ici : les
 * libellés de repères passent toujours par `themeDe`, inchangé (« parti à
 * Londres » reste un voyage). Une perte d'argent garde son mot « argent » :
 * c'est le « perdu » qu'on enlève, pas ce dont on parle.
 */
const TOURNURES = [
  /\ben train d(?:e|u|es)?\b/g,
  /\b(?:fait|font|faire|faisait) partie\b/g,
  /\b(?:une|des|ma|mes|sa|ses) parties?\b/g,
  /\bpoint de depart\b/g,
  /\btrip hop\b/g,
  /\b(?:je suis|j etais|je me sens|je me sentais|suis|me sens) (?:(?:un peu|completement|trop|tellement|vraiment|tout|toute|si|tres) )?perdue?s?\b/g,
  /\bme suis perdue?s?\b/g,
  /\bperdu(?= (?:(?:pas mal|beaucoup|un peu|plein|trop) )?(?:de |d |du |des |mon |ma |mes |tout mon |tout le )?(?:thunes?|argent|fric|sous|temps|poids|kilos?)\b)/g
];

export function themeDuJournal(p) {
  let t = ' ' + String(p ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ') + ' ';
  for (const re of TOURNURES) t = t.replace(re, ' ');
  return themeDe(t);
}

export function themesDuTexte(texte, max = MAX_THEMES_MOMENT) {
  const compte = new Map();
  for (const p of String(texte ?? '').split(/(?<=[.!?…])\s+|\n+/)) {
    if (p.trim().length < 8) continue;
    const t = themeDuJournal(p);
    if (t === DEFAUT_THEME) continue;          // le défaut n'est pas un sujet
    compte.set(t, (compte.get(t) ?? 0) + 1);
  }
  return [...compte.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([t]) => t);
}

/**
 * CE QUE LA VEILLE VOIT DANS UN MOMENT.
 *
 * MESSAGE PAR MESSAGE, et LE CONTEXTE EST CELUI DU MOMENT, PAS CELUI DU JOUR.
 *
 * Première version : on passait le texte de la journée entière en contexte,
 * comme `veilleDuJour`, pour que le pire des moments égale le niveau du jour.
 * Ça marchait, et c'était faux. `niveauDuTexte` ne se sert du contexte que pour
 * `enCrise`, qui fait passer une blessure AMBIGUË au rouge : la même phrase de
 * huit heures du matin sortait donc muette un jour calme et ROUGE un jour où la
 * crise était écrite à vingt-trois heures. Mesuré :
 *   « je me suis coupé le doigt ce matin en préparant le repas. »
 *   soirée calme  → aucune marque
 *   crise à 23 h  → triangle ROUGE sur la ligne de 08 h, pendant que « j'ai
 *                   envie de mourir » de 23 h n'était qu'AMBRE.
 * La marque la plus grave de la journée se posait sur la coupure de cuisine.
 * C'est le défaut que `momentsDuJour` refuse déjà pour la note, deux commentaires
 * plus haut : rien de ce qui a été conclu le soir ne repeint la ligne du matin.
 *
 * Le bandeau du jour reste, lui, calculé sur la journée entière — c'est son
 * travail de dire qu'une journée a basculé, avec sa phrase à l'appui. Une
 * journée peut donc être rouge sans qu'aucune ligne le soit : c'est honnête, la
 * bascule vient de la COMBINAISON et le bandeau la nomme. L'inverse ne peut pas
 * arriver : le contexte du jour contient celui du moment, et il ne sait
 * qu'aggraver — vérifié sur soixante-dix journées, 0 moment plus grave que son
 * bandeau, 0 moment allumé sous un bandeau muet.
 *
 * On ne rend pas l'extrait : la phrase qui a déclenché le signe est déjà celle
 * qu'on lit sur la ligne. Le genre suffit à dire QUOI surveiller — « le suicide
 * a été évoqué » et « un objet était à portée » sont deux jaunes, et ce ne sont
 * pas le même moment.
 */
function veilleDuMoment(msgs, date) {
  /*
   * UN MESSAGE RANGÉ RESTE LU, MAIS IL NE RACONTE PAS CE JOUR-LÀ.
   *
   * Ranger un message au carnet dit qu'il « ne raconte pas ce jour-là » : une
   * lettre de médecin collée pour être gardée, une vieille entrée recollée.
   * Une lettre qui disait des antécédents faisait sortir sa ligne ROUGE, sur
   * la foi de ce qu'un autre avait écrit sur des années passées.
   *
   * La veille ne perd jamais un texte : un message rangé est lu comme les
   * autres. Mais tout ce qu'elle y trouve redescend au seul jaune « évoqué,
   * passé » — la règle du bandeau du jour, pour que la ligne et le bandeau
   * disent la même chose du même message —, et il n'entre pas dans le
   * contexte : sans quoi il ferait encore passer au rouge une coupure ambiguë
   * écrite par la personne le même soir.
   *
   * MAIS UN ACTE DE LA PERSONNE NE RETOMBE JAMAIS À RIEN. Une coupure que la
   * veille classe ambiguë ne passe au rouge qu'avec un contexte de crise, et
   * sans ce contexte elle ne donne RIEN. Si la crise n'était écrite QUE dans le
   * message rangé, la retirer du contexte effaçait la marque de ce que la
   * personne venait d'écrire elle-même, ce soir-là. On relit donc chaque
   * message non rangé AUSSI avec le contexte complet : ce qui n'y est rouge que
   * grâce au rangé reste marqué, en jaune et sous son propre genre. Plutôt
   * jaune que rien, pour un acte.
   */
  const contexteDuJour = msgs.filter(m => !m.rangee).map(m => m.text).join(' ');
  const contexteComplet = msgs.map(m => m.text).join(' ');
  const motifs = [];
  // Un genre, une fois — et à son niveau le plus grave : un jaune vu d'abord
  // n'éteint pas le rouge du même genre écrit plus tard dans le moment.
  const ajouter = m => {
    const deja = motifs.find(x => x.genre === m.genre);
    if (!deja) motifs.push(m);
    else if (m.niveau === 'rouge') deja.niveau = 'rouge';
  };
  for (const m of msgs) {
    // jamais plus grave que le bandeau : un courrier collé ne crie pas pour la personne
    const r = plafondCourrier(m.text, niveauDuTexte(m.text, { contexteDuJour, aujourdhui: date }), date);
    if (m.rangee) {
      if (r.motifs.length) ajouter({ genre: 'evoque_passe', niveau: 'jaune' });
      continue;
    }
    for (const x of r.motifs) ajouter({ genre: x.genre, niveau: x.niveau });
    if (contexteComplet === contexteDuJour) continue;
    // `ajouter` ne fait que monter : un genre déjà rouge ou déjà jaune le reste.
    for (const x of plafondCourrier(m.text, niveauDuTexte(m.text, { contexteDuJour: contexteComplet, aujourdhui: date }), date).motifs)
      if (x.niveau === 'rouge') ajouter({ genre: x.genre, niveau: 'jaune' });
  }
  if (!motifs.length) return null;
  return {
    niveau: motifs.some(m => m.niveau === 'rouge') ? 'rouge' : 'jaune',
    // Le plus grave d'abord : c'est celui qu'on lit si on n'en lit qu'un.
    genres: [...new Set(motifs
      .slice().sort((a, b) => (b.niveau === 'rouge' ? 1 : 0) - (a.niveau === 'rouge' ? 1 : 0))
      .map(m => m.genre))]
  };
}

/**
 * LES MESSAGES D'UNE JOURNÉE, REGROUPÉS EN MOMENTS — sans rien en lire encore.
 * `momentsDuJour` et `calibrationDesMots` découpent de la même façon : une
 * estimation qu'on vérifie doit être celle qu'on affiche.
 */
function grouperEnMoments(msgs) {
  const moments = [];
  for (const m of msgs) {
    const t = Date.parse(m.ts);
    // Un message sans instant lisible garde son texte : il rejoint le moment en
    // cours, ou en ouvre un à l'heure du précédent. On perd son heure, pas sa
    // phrase — et surtout pas les autres.
    if (Number.isNaN(t)) {
      const d0 = moments[moments.length - 1];
      if (d0) d0.msgs.push(m);
      else moments.push({ debut: NaN, fin: NaN, msgs: [m] });
      continue;
    }
    const dernier = moments[moments.length - 1];
    if (dernier && t - dernier.fin <= TROU_MOMENT) {
      dernier.msgs.push(m);
      dernier.fin = t;
    } else {
      moments.push({ debut: t, fin: t, msgs: [m] });
    }
  }
  return moments;
}

export function momentsDuJour(date, userId = OWNER, { zone = zoneCourante(), reference = null } = {}) {
  const note = getEntry(date, userId)?.note ?? null;
  const ref = reference ?? note ?? 5;
  /*
   * UN RELEVÉ POSÉ À LA MAIN L'EMPORTE SUR LA DÉDUCTION.
   *
   * Quelqu'un qui a relevé 3/10 à 15 h a dit quelque chose de plus fiable que
   * ce que ses phrases laissent lire, et afficher l'estimation à côté d'un
   * chiffre qu'il vient de poser lui-même serait le contredire poliment.
   */
  const releves = relevesDuJour(date, userId);
  const msgs = messagesForDate(date, userId).filter(m => m.role === 'user' && m.text?.trim());
  const idsDuJour = new Set(msgs.map(m => m.id));
  /*
   * LES MOTS NE DONNENT UN CHIFFRE QUE S'ILS ONT PROUVÉ QU'ILS SUIVENT LES SIENS.
   * Voir `calibrationDesMots` : tant que ce n'est pas le cas, pas d'estimation
   * par les mots, nulle part — ni chiffre ni flèche.
   */
  const calibre = calibrationDesMots(userId).ok;
  return grouperEnMoments(msgs).map(mo => {
    const ids = mo.msgs.map(m => m.id);
    const veille = veilleDuMoment(mo.msgs, date);
    /*
     * CE QUI RACONTE LA JOURNÉE, ET CE QUI Y A SEULEMENT ÉTÉ COLLÉ.
     *
     * La phrase, les sujets, la pente et l'estimation ne lisent que les
     * messages de la personne qui racontent CE jour : pas ceux qu'elle a
     * rangés au carnet. Un moment fait uniquement de messages rangés ne reste
     * que s'il porte un signe de veille — la veille, elle, a tout lu.
     */
    const propres = mo.msgs.filter(m => !m.rangee);
    if (!propres.length && !veille) return null;
    const textes = propres.map(m => m.text);
    const texte = textes.join(' ');
    /*
     * LA NOTE N'ENTRE PAS ICI, et c'est délibéré. `readMood` s'en sert pour
     * infléchir la scène — utile pour peindre le décor du jour, faux pour une
     * ligne du matin : la note a été posée le soir, et elle repeindrait
     * uniformément tous les moments de la journée avec ce qu'on a conclu après.
     * On perdrait exactement la bascule qu'on est venu voir.
     */
    const { scene, force } = readMood(texte, null);
    const charge = chargeDe(scene, force);
    /*
     * DEUX LECTURES DU MÊME TEXTE, ET ELLES NE RÉPONDENT PAS À LA MÊME QUESTION.
     *
     * `charge` vient de la SCÈNE choisie : c'est ce qui dessine la ligne, et
     * elle a le droit d'être muette. `penche` lit la direction du passage même
     * quand aucune scène ne l'emporte — sans quoi tous les moments d'une
     * journée sortiraient à la référence exacte, ce qui est un chiffre
     * constant présenté comme une lecture.
     */
    const penche = pencheDe(texte);
    // La phrase qu'on affichera, sortie une seule fois : le moment rend aussi le
    // message d'où elle vient, et les deux doivent parler de la MÊME phrase.
    const coeur = coeurDe(texte);
    /*
     * LE RELEVÉ DU MOMENT : D'ABORD CELUI QUI EST ANCRÉ À UN DE SES MESSAGES.
     *
     * On ne rattachait que par l'heure, et on prenait le PREMIER. Deux défauts :
     * un relevé daté de travers (voir `reparerLesNotesDites`) ne retrouvait plus
     * son moment, et quand la personne écrit « 3/10 » puis « 2/10 » une minute
     * après, le 3 cachait le 2 — alors que c'est elle qui s'est reprise. On
     * prend donc le DERNIER relevé ancré au moment, et à défaut le dernier
     * relevé posé dans sa fenêtre qui n'appartient à aucun autre message du
     * jour (celui qu'on pose en répondant à une question du compagnon).
     * Un relevé du matin ne dit toujours rien d'un moment de minuit.
     *
     * ET LA PAROLE DE LA PERSONNE AVANT L'HYPOTHÈSE DU COMPAGNON. « Le dernier
     * gagne » ne vaut qu'entre ses propres chiffres : en direct, sa note dite
     * est posée avant que le compagnon ancre son relevé au MÊME message, qui
     * arrivait donc toujours dernier — et son « 5 » cachait le « 2 » qu'elle
     * venait d'écrire. C'est la plainte même : « ramène tes 1/10 à 5-6 ».
     * Même chose quand elle touche l'échelle : son relevé est ancré au message
     * du compagnon, donc trouvé par la fenêtre, et il passe quand même avant
     * celui que le compagnon a ancré au message à elle. Le relevé du compagnon
     * ne sert qu'en l'absence de tout chiffre à elle.
     */
    const ancres = releves.filter(r => ids.includes(r.message_id));
    const fenetre = releves.filter(r => {
      if (idsDuJour.has(r.message_id)) return false;
      const t = Date.parse(r.ts);
      return t >= mo.debut - TROU_MOMENT && t <= mo.fin + TROU_MOMENT;
    });
    const deToi = r => r.source === 'toi';
    const pose = ancres.filter(deToi).at(-1) ?? fenetre.filter(deToi).at(-1)
      ?? ancres.at(-1) ?? fenetre.at(-1);
    /*
     * PAS DE CHIFFRE LU DANS LES MOTS SUR UN MOMENT QUE LA VEILLE A MARQUÉ.
     *
     * Sur un vrai journal, 23 des 26 moments marqués sortaient à 5,5 ou 6 pour
     * une référence de 6 — dont un moment rouge à ≈6, et un autre tracé à
     * ≈8,5 sur la courbe. Une estimation rassurante posée sur le pire moment
     * de la journée est la pire erreur que cette ligne puisse faire. Un relevé
     * posé par la personne, lui, reste : c'est sa parole.
     */
    const parLesMots = calibre && !veille && penche != null;
    return {
      heure: heureDe(mo.debut, zone),
      ts: Number.isNaN(mo.debut) ? null : new Date(mo.debut).toISOString(),
      scene, force,
      sens: force > 0 ? (SENS[scene] ?? null) : null,
      charge,
      coeur,
      // Que des messages rangés : pas de phrase à montrer, et la page le dit.
      // Posé seulement quand c'est vrai : la forme d'un moment ordinaire ne change pas.
      ...(propres.length ? {} : { rangeSeul: true }),
      /*
       * LES MESSAGES DE LA PHRASE AFFICHÉE. Cliquer un moment doit désigner CE
       * passage-là ; avec les seuls `ids`, un moment de dix messages allumait
       * la colonne entière — le défaut que `messagesDuCoeur` tient fermé.
       */
      coeurIds: coeur ? messagesDuCoeur(coeur, textes, propres.map(m => m.id)) : [],
      messages: ids.length,
      // Les mêmes que ceux des sujets : c'est par eux que les deux colonnes se
      // répondent, et non par l'heure qu'elles affichent l'une et l'autre.
      ids,
      /*
       * DE QUOI ON PARLAIT, ET S'IL Y A À SURVEILLER.
       *
       * La ligne portait un rond dont la couleur venait de la SCÈNE. Sur des
       * passages de vingt mots, `readMood` se tait : sur soixante-dix journées
       * de banc, les 225 moments sortaient tous en `drift` force 0 — le même
       * rond, à la même couleur, sur toutes les lignes. Une marque constante
       * n'est pas une information. Les sujets, eux, en sont une, et le signe de
       * veille est la seule chose qu'on ne veut jamais manquer en relisant.
       */
      themes: themesDuTexte(texte),
      veille,
      estime: pose
        // « releve » veut dire posé par la personne : c'est ce qui s'affiche plein.
        ? { valeur: pose.valeur, dApres: pose.source === 'toi' ? 'releve' : 'modele' }
        : parLesMots ? { valeur: estimationDe(penche, ref), dApres: 'mots' } : null
    };
  }).filter(Boolean).map(x => ({ ...x, note }));
}

/*
 * =====================================================================
 * LES MOTS ONT-ILS LE DROIT DE DONNER UN CHIFFRE ?
 *
 * L'estimation « ≈ x/10 » tirée des mots avait l'air d'une mesure sur
 * l'échelle de la personne, sans que personne ait jamais vérifié qu'elle en
 * soit une. Sur un vrai journal (43 journées notées) : aucun lien mesurable
 * avec la note du jour (Spearman 0,2, non significatif), une erreur moyenne
 * égale à celle d'un chiffre constant, et ses « 1/10 » écrits en toutes
 * lettres lus 5 ou 6. La courbe écrasait précisément les pics qu'on vient voir.
 *
 * On confronte donc la lecture à ce que la personne a dit elle-même : la note
 * de chaque journée écrite, et chaque relevé qu'elle a posé, face à
 * l'estimation que les mots en auraient tirée. Trois conditions, toutes :
 *   - au moins 20 paires : en dessous, aucune conclusion ne tient ;
 *   - un lien franc (Spearman ≥ 0,4) et qui ne doit rien au hasard
 *     (permutation, p < 0,05), mesuré sur les ÉCARTS à la référence et non
 *     sur les niveaux — une tendance des notes ne prouve rien des mots ;
 *   - une erreur moyenne PLUS PETITE que celle du meilleur chiffre constant
 *     (la référence, recalée de l'écart médian) — sinon afficher la
 *     référence ferait aussi bien, et sans rien prétendre.
 * Tant qu'une seule manque, les mots ne donnent aucun chiffre. Ce n'est pas un
 * verdict sur les mots de quelqu'un : c'est dire que ce lexique-là ne sait
 * pas encore les lire.
 * =====================================================================
 */
export const CALIBRATION = { paires: 20, rho: 0.4, p: 0.05, tirages: 2000, jours: 400 };

const rangs = v => {
  const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let i = 0; i < o.length;) {
    let j = i;
    while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
    for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
};
const pearson = (x, y) => {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
};

/** Le test de permutation, déterministe : la même base rend toujours le même verdict. */
function permutation(rx, ry, rho, tirages) {
  let graine = 0x9e3779b9;
  const alea = () => {
    graine = (graine + 0x6d2b79f5) | 0;
    let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const y = ry.slice();
  let au_moins = 0;
  for (let k = 0; k < tirages; k++) {
    for (let i = y.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [y[i], y[j]] = [y[j], y[i]];
    }
    if (pearson(rx, y) >= rho) au_moins++;
  }
  return (1 + au_moins) / (1 + tirages);
}

function calibrer(userId, cleNotes) {
  // La série ne dépend que des notes : un message de plus ne la recalcule pas.
  const deja = _series.get(userId);
  const ser = deja?.cle === cleNotes ? deja.ser : buildSeries(allEntries(userId));
  _series.set(userId, { cle: cleNotes, ser });
  // La référence d'un jour est celle de la série À CE JOUR-LÀ, calculée sur les
  // jours d'avant : c'est ce que la page utilise, et elle n'inclut pas la note
  // qu'on cherche à retrouver.
  const refAvant = date => {
    let r = null;
    for (const s of ser) { if (s.date > date) break; r = s; }
    return r?.reference ?? 5;
  };
  const noteDe = new Map(ser.map(s => [s.date, s.note]));
  const msgs = db.prepare(
    "SELECT id, ts, date, text FROM messages WHERE user_id = ? AND role = 'user' " +
    "AND COALESCE(rangee, 0) = 0 AND text IS NOT NULL AND TRIM(text) <> '' ORDER BY ts ASC"
  ).all(userId);
  const parJour = new Map();
  for (const m of msgs) {
    if (!parJour.has(m.date)) parJour.set(m.date, []);
    parJour.get(m.date).push(m);
  }
  const relevesParMessage = new Map();
  for (const r of db.prepare("SELECT message_id, valeur FROM releves WHERE user_id = ? AND source = 'toi' ORDER BY ts ASC").all(userId))
    relevesParMessage.set(r.message_id, r.valeur);          // le dernier gagne

  /*
   * Chaque texte n'est lu qu'une fois d'un calcul à l'autre : un message de
   * plus ne change que la journée où il tombe, et relire quatre cents journées
   * à chaque message coûterait des secondes. On ne garde que ce qui a servi.
   */
  const avant = _penches.get(userId) ?? new Map();
  const lues = new Map();
  const lire = t => {
    if (!lues.has(t)) lues.set(t, avant.has(t) ? avant.get(t) : pencheDe(t));
    return lues.get(t);
  };
  const paires = [];
  for (const date of [...parJour.keys()].sort().slice(-CALIBRATION.jours)) {
    const jour = parJour.get(date);
    const ref = refAvant(date);
    const note = noteDe.get(date);
    if (note != null) {
      const p = lire(jour.map(m => m.text).join(' '));
      if (p != null) paires.push({ estime: estimationDe(p, ref), vrai: note, ref });
    }
    for (const mo of grouperEnMoments(jour)) {
      const dits = mo.msgs.map(m => relevesParMessage.get(m.id)).filter(v => v != null);
      if (!dits.length) continue;
      const p = lire(mo.msgs.map(m => m.text).join(' '));
      if (p != null) paires.push({ estime: estimationDe(p, ref), vrai: dits.at(-1), ref });
    }
  }
  _penches.set(userId, lues);
  return jugerLesPaires(paires);
}

/**
 * LE VERDICT, SUR DES PAIRES { estime, vrai, ref } — rien d'autre.
 *
 * Séparé de la lecture du journal pour que chaque porte puisse être éprouvée
 * seule : une porte qu'aucun test ne ferme jamais n'est pas une porte.
 */
export function jugerLesPaires(paires) {
  const n = paires.length;
  const res = { ok: false, paires: n, rho: null, p: null, erreur: null, erreurConstante: null };
  if (n < CALIBRATION.paires) return { ...res, raison: 'trop peu de paires' };
  /*
   * L'ÉCART, PAS LE NIVEAU. Corréler l'estimation à la note laissait passer des
   * mots sans aucune information : sur des notes qui dérivent lentement, la
   * référence (une médiane sur un an, en retard sur la tendance) portait à
   * elle seule le lien, et un penchant triste constant corrigeait ce retard.
   * Trois phrases tristes interchangeables, tirées au hasard, passaient ainsi
   * le garde-fou vingt fois sur vingt. On retire donc la tendance des deux
   * côtés, et on demande aux mots ce qu'eux seuls prétendent dire : de combien
   * ce moment s'écarte de la référence. Le test de permutation porte sur ces
   * écarts-là, pas sur les niveaux.
   */
  const rx = rangs(paires.map(x => x.estime - x.ref)), ry = rangs(paires.map(x => x.vrai - x.ref));
  const rho = pearson(rx, ry);
  const erreur = paires.reduce((a, x) => a + Math.abs(x.estime - x.vrai), 0) / n;
  /*
   * Et face au MEILLEUR chiffre constant, pas à la référence brute : la
   * référence décalée de l'écart médian (le retard sur la tendance, corrigé).
   * Un penchant constant ne fait jamais mieux que ça.
   */
  const ecarts = paires.map(x => x.vrai - x.ref).sort((a, b) => a - b);
  const decalage = n % 2 ? ecarts[(n - 1) / 2] : (ecarts[n / 2 - 1] + ecarts[n / 2]) / 2;
  const erreurConstante = paires.reduce((a, x) => a + Math.abs(x.ref + decalage - x.vrai), 0) / n;
  const arrondi = v => Math.round(v * 1000) / 1000;
  Object.assign(res, { rho: arrondi(rho), erreur: arrondi(erreur), erreurConstante: arrondi(erreurConstante) });
  if (rho < CALIBRATION.rho) return { ...res, raison: 'lien trop faible' };
  const p = permutation(rx, ry, rho, CALIBRATION.tirages);
  res.p = arrondi(p);
  if (p >= CALIBRATION.p) return { ...res, raison: 'lien possiblement dû au hasard' };
  if (erreur >= erreurConstante) return { ...res, raison: 'pas mieux qu’un chiffre constant' };
  return { ...res, ok: true, raison: null };
}

/*
 * Mis en cache par personne, et recalculé dès que ce qu'il lit bouge : un
 * message, une note, un relevé, un rangement. La signature coûte trois
 * agrégats ; le calcul, lui, relit jusqu'à quatre cents journées.
 */
const _calibration = new Map();
const _penches = new Map();
const _series = new Map();

export function calibrationDesMots(userId = OWNER) {
  /*
   * Des sommes qui dépendent de la PLACE de chaque chose : échanger les notes
   * de deux jours, réécrire un message à longueur égale ou le déplacer à une
   * autre date gardaient les mêmes compte, somme et maximum — et le cache
   * servait une calibration périmée.
   */
  const cleNotes = JSON.stringify(
    db.prepare('SELECT COUNT(note) n, SUM(note) s, MIN(date) a, MAX(date) d, '
      + 'SUM(note * CAST(julianday(date) AS INTEGER)) p FROM entries WHERE user_id = ?').get(userId));
  const cle = JSON.stringify([
    db.prepare("SELECT COUNT(*) n, MAX(id) m, SUM(LENGTH(text)) l, SUM(COALESCE(rangee, 0)) r, "
      + "SUM(id * LENGTH(text)) il, SUM(id * CAST(julianday(date) AS INTEGER)) d, SUM(id * unicode(text)) u, "
      + "SUM(id * unicode(substr(text, -1))) z, SUM(id * CAST(julianday(ts) * 86400 AS INTEGER) % 1000003) t "
      + "FROM messages WHERE user_id = ? AND role = 'user'").get(userId),
    cleNotes,
    db.prepare('SELECT COUNT(*) n, MAX(id) m, SUM(valeur) s, SUM(id * valeur) iv, SUM(message_id * valeur) mv '
      + "FROM releves WHERE user_id = ? AND source = 'toi'").get(userId)
  ]);
  const vu = _calibration.get(userId);
  if (vu?.cle === cle) return vu.res;
  const res = calibrer(userId, cleNotes);
  _calibration.set(userId, { cle, res });
  return res;
}

/**
 * DE QUOI ON A PARLÉ, EN ICÔNES.
 *
 * Les thèmes viennent du même lexique que les repères de la frise : un sujet
 * reconnu ici porte le dessin qu'il porte là-bas. Ils ne QUALIFIENT personne —
 * ils choisissent une image, et c'est tout ce qu'on leur demande.
 *
 * Le seuil de deux occurrences n'est pas de la prudence : un mot lâché une fois
 * dans une conversation d'une heure n'est pas un thème de la journée, et six
 * icônes qui se valent ne disent rien de plus que zéro.
 */
export const MIN_THEME = 2;

export function thematiquesDuJour(date, userId = OWNER, { max = 5 } = {}) {
  // Un message rangé au carnet ne raconte pas ce jour-là : il ne lui donne pas
  // ses thèmes (sur un vrai journal, une seule lettre collée fournissait six des
  // treize phrases « soin » d'une journée).
  const msgs = messagesForDate(date, userId).filter(m => m.role === 'user' && m.text?.trim() && !m.rangee);
  if (!msgs.length) return [];
  const compte = new Map();
  const preuve = new Map();
  for (const m of msgs) {
    // Phrase par phrase : `themeDe` prend le mieux-disant d'un texte, et sur un
    // message entier il ne rendrait qu'un seul thème pour dix minutes de récit.
    for (const p of String(m.text).split(/(?<=[.!?…])\s+|\n+/)) {
      if (p.trim().length < 8) continue;
      const t = themeDuJournal(p);
      if (t === 'jalon') continue;          // le défaut n'est pas un thème
      compte.set(t, (compte.get(t) ?? 0) + 1);
      if (!preuve.has(t)) preuve.set(t, p.trim().slice(0, 120));
    }
  }
  const nom = new Map(THEMES.map(([id]) => [id, id]));
  return [...compte.entries()]
    .filter(([, n]) => n >= MIN_THEME)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([id, n]) => ({ theme: nom.get(id) ?? id, n, extrait: preuve.get(id) ?? '' }));
}

/*
 * =====================================================================
 * LE TEXTE DU SOIR, DÉCOUPÉ EN SUJETS.
 *
 * Ce qu'on écrit le soir arrive d'un bloc : six cents mots où l'on passe de sa
 * nuit à son ex, de son ex à sa mère, sans un alinéa. Relu trois mois plus
 * tard, ce bloc ne se relit pas — on le survole, et on n'y retrouve pas ce
 * qu'on y cherchait.
 *
 * ON NE RÉÉCRIT RIEN. Le texte reste mot pour mot, dans l'ordre où il a été
 * écrit ; on pose seulement des coupures là où le sujet change, et une icône
 * en face. Une paraphrase de ce qu'on a écrit un mauvais soir n'a aucune raison
 * d'être plus juste que la phrase — c'est la règle du module, et le découpage
 * est justement la seule façon de structurer sans toucher au texte.
 *
 * LES COUPURES SONT PRUDENTES. Un thème par phrase donnerait quinze blocs d'une
 * ligne, ce qui est moins lisible que le pavé de départ : une phrase sans thème
 * reconnu rejoint le bloc en cours, et un bloc trop court est refondu dans son
 * voisin. Mieux vaut trois blocs justes que douze exacts.
 * =====================================================================
 */

/** En dessous, un bloc n'est pas un sujet : c'est une phrase isolée. */
export const SUJET_CAR = 90;

/** Au-delà, on ne lit plus une journée, on lit un sommaire. */
export const MAX_SUJETS = 8;

/** Découpe un texte en phrases, en gardant leur ponctuation. */
function phrasesDe(texte) {
  return String(texte ?? '')
    .split(/(?<=[.!?…])\s+|\n+/)
    .map(p => p.trim())
    .filter(Boolean);
}

/**
 * @param {string} texte   le texte de la journée, tel qu'écrit
 * @param {number} ref     la normale de la personne, pour situer l'estimation
 */
/**
 * CE QUI OUVRE UN NOUVEAU BLOC — et pourquoi le thème ne suffit pas.
 *
 * `themeDe` est fait pour des LIBELLES DE REPERES : « déménagement à
 * Montpellier », « arrêt du traitement ». Sur des phrases de journal, il se
 * tait neuf fois sur douze. Découper sur lui seul donnait un premier bloc qui
 * avalait la nuit blanche, le déjeuner et « je me sens vide » d'un coup —
 * c'est-à-dire le pavé de départ avec une icône dessus.
 *
 * Le second signal est la BASCULE : le lexique d'ambiance est beaucoup plus
 * riche que celui des thèmes, et dans un journal, un virage d'humeur EST un
 * changement de sujet. Une phrase fière de sa journée suivie d'une phrase qui
 * dit le vide et l'absence d'envie est très exactement la frontière qu'on vient
 * chercher en relisant une journée.
 */
export const BASCULE = 0.45;

function themeOuNull(p) {
  if (p.length < 8) return null;
  const t = themeDuJournal(p);
  return t === DEFAUT_THEME ? null : t;
}

/**
 * LE DÉCOUPAGE EN BLOCS, À PARTIR DE PHRASES DÉJÀ LUES.
 *
 * Chaque phrase porte son texte, son thème (ou null), sa pente, et — quand on
 * découpe à partir des messages plutôt que du pavé — l'horodatage du message
 * d'où elle vient. Le découpage ne regarde jamais l'heure ; elle voyage juste
 * dans le bloc, pour qu'on puisse la lui redemander ensuite.
 */
function decouperEnBlocs(lues) {
  const blocs = [];
  for (const ph of lues) {
    const b = blocs[blocs.length - 1];
    if (!b) { blocs.push({ phrases: [ph] }); continue; }

    const themeBloc = b.phrases.find(x => x.theme)?.theme ?? null;
    const pencheBloc = b.phrases.filter(x => x.penche != null).at(-1)?.penche ?? null;

    /*
     * Une phrase muette PROLONGE toujours. « Je sais pas. » entre deux phrases
     * sur sa mère parle encore de sa mère, et lui donner son propre bloc
     * couperait le récit en son milieu.
     */
    const changeDeSujet = ph.theme != null && ph.theme !== themeBloc;
    const bascule = ph.penche != null && pencheBloc != null
                    && Math.abs(ph.penche - pencheBloc) >= BASCULE;

    if (changeDeSujet || bascule) blocs.push({ phrases: [ph] });
    else b.phrases.push(ph);
  }

  /*
   * Refonte des blocs trop courts DANS LE PRECEDENT, jamais dans le suivant :
   * une phrase courte à la fin d'un paragraphe le prolonge, la même poussée
   * dans le paragraphe suivant lui collerait une ouverture qui parle d'autre
   * chose. Le premier bloc n'a pas de précédent et reste tel quel — une
   * ouverture de journée EST un sujet.
   */
  const fondus = [];
  for (const b of blocs) {
    const precedent = fondus[fondus.length - 1];
    const long = b.phrases.map(x => x.texte).join(' ').length;
    /*
     * ON NE FOND JAMAIS UNE CONTRADICTION.
     *
     * « ça va mieux ce soir », cinq mots collés à la fin d'un bloc qui parle
     * d'une scarification, faisait sortir ce bloc à 6/10 : le lexique du calme
     * y pesait plus lourd que celui de l'irréversible, et le passage le plus
     * grave de la journée s'affichait comme une bonne nouvelle. Une phrase
     * courte qui contredit son voisin est justement celle qu'il ne faut pas
     * avaler — c'est une bascule, et une bascule est ce qu'on vient lire.
     */
    const sien = b.phrases.filter(x => x.penche != null).at(-1)?.penche ?? null;
    const hote = precedent?.phrases.filter(x => x.penche != null).at(-1)?.penche ?? null;
    const contredit = sien != null && hote != null && Math.abs(sien - hote) >= BASCULE;

    if (precedent && long < SUJET_CAR && !contredit) { precedent.phrases.push(...b.phrases); continue; }
    fondus.push({ phrases: [...b.phrases] });
  }
  return fondus;
}

/**
 * DES BLOCS AUX SUJETS. `zone` présente => on attache une heure discrète, prise
 * sur le premier message du bloc, comme le fait le fil des moments à gauche.
 *
 * `min` est le nombre de blocs en dessous duquel on ne rend rien. Il vaut 2 pour
 * un texte collé d'un seul tenant (une icône seule sur tout un pavé serait une
 * étiquette) ; il vaut 1 quand on découpe des MESSAGES horodatés : là chaque
 * bloc porte l'heure de son premier message, exactement comme un moment à
 * gauche, et un unique bloc n'est plus une étiquette mais le repère de la
 * journée d'aujourd'hui — celui qui manquait au jour en cours.
 */
function blocsEnSujets(fondus, ref, zone = null, min = 2, calibre = false) {
  const sujets = fondus.map(b => {
    const t = b.phrases.map(x => x.texte).join(' ');
    const penche = pencheDe(t);
    const s = {
      // Le thème du bloc est le PREMIER que ses phrases donnent, pas celui de
      // sa première phrase : un bloc ouvert sur une phrase muette porte quand
      // même l'icône du sujet dont il parle.
      theme: b.phrases.find(x => x.theme)?.theme ?? DEFAUT_THEME,
      texte: t,
      penche,
      /*
       * PAS D'ESTIMATION QUAND IL N'Y A RIEN A LIRE. Un passage dont le lexique
       * ne dit rien ne rend pas la référence « par défaut » : il ne rend rien,
       * et la page se tait. Un chiffre constant affiché sur la moitié des blocs
       * aurait l'air de dire quelque chose, ce qui est pire que le silence.
       */
      // Et pas d'estimation tant que les mots n'ont pas prouvé qu'ils suivent
      // les chiffres de la personne : voir `calibrationDesMots`.
      estime: penche == null || !calibre ? null : { valeur: estimationDe(penche, ref), dApres: 'mots' }
    };
    if (zone) {
      const ts = b.phrases.find(x => x.ts)?.ts ?? null;
      if (ts) s.heure = heureDe(ts, zone);
    }
    /*
     * LES MESSAGES D'OU CE BLOC VIENT.
     *
     * C'est ce qui permet de relier les deux colonnes sans rien deviner : un
     * moment à gauche et un passage à droite sont LE MEME message, et cliquer
     * l'un doit pouvoir désigner l'autre. Rapprocher par l'heure affichée
     * marcherait presque — et « presque » veut dire qu'un jour ça désignera le
     * mauvais passage, sans que rien ne le dise.
     */
    const ids = [...new Set(b.phrases.map(x => x.id).filter(x => x != null))];
    if (ids.length) s.ids = ids;
    /*
     * LES MORCEAUX DU BLOC, MESSAGE PAR MESSAGE.
     *
     * Un bloc peut recoller plusieurs messages sur le même sujet. Cliquer un
     * moment à gauche désigne des messages PRÉCIS : pour n'allumer que la phrase
     * qui les porte, et non tout le pavé, la colonne de droite a besoin de savoir
     * quel bout de texte vient de quel message. On regroupe donc les phrases
     * consécutives par identifiant, sans jamais toucher au texte ni à son ordre.
     */
    const morceaux = [];
    for (const ph of b.phrases) {
      const id = ph.id ?? null;
      const dernier = morceaux[morceaux.length - 1];
      if (dernier && dernier.id === id) dernier.texte += ' ' + ph.texte;
      else morceaux.push({ id, texte: ph.texte });
    }
    if (morceaux.some(m => m.id != null)) s.morceaux = morceaux;
    return s;
  });

  /*
   * EN DESSOUS DE `min`, ON NE REND RIEN. Pour un texte collé (min = 2), un seul
   * bloc serait une icône posée sur toute une journée — une étiquette. Pour des
   * messages horodatés (min = 1), un seul bloc porte son heure et son icône comme
   * un moment : c'est le repère du jour, pas une étiquette.
   */
  if (sujets.length < min) return [];
  return sujets.slice(0, MAX_SUJETS);
}

export function sujetsDuTexte(texte, ref = 5, { calibre = false } = {}) {
  const phrases = phrasesDe(texte);
  if (!phrases.length) return [];
  const lues = phrases.map(p => ({ texte: p, theme: themeOuNull(p), penche: pencheDe(p) }));
  return blocsEnSujets(decouperEnBlocs(lues), ref, null, 2, calibre);
}

/**
 * LES SUJETS DU JOUR, AVEC UNE HEURE.
 *
 * On repart des MESSAGES et non du pavé recollé : `entries.text` est déjà leur
 * concaténation, donc le découpage est identique, mais chaque phrase garde
 * cette fois l'horodatage de son message. Un bloc porte alors l'heure de son
 * premier message — le petit repère de temps que réclame la colonne de droite,
 * comme l'heure qui ouvre chaque moment à gauche. Sans message (une journée
 * importée d'un seul tenant), on retombe sur le texte, sans heure.
 */
export function sujetsDuJour(date, userId = OWNER, { reference = null, zone = zoneCourante() } = {}) {
  const e = getEntry(date, userId);
  const ref = reference ?? e?.note ?? 5;
  // Les messages rangés au carnet n'en sont pas : `entries.text`, sur lequel on
  // retombe, les a déjà retirés — les deux chemins lisent la même journée.
  const msgs = messagesForDate(date, userId).filter(m => m.role === 'user' && m.text?.trim() && !m.rangee);
  const calibre = calibrationDesMots(userId).ok;
  if (!msgs.length) return sujetsDuTexte(e?.text ?? '', ref, { calibre });

  const lues = [];
  for (const m of msgs)
    for (const p of phrasesDe(m.text))
      lues.push({ texte: p, theme: themeOuNull(p), penche: pencheDe(p), ts: m.ts, id: m.id });
  // min = 1 : à partir de messages horodatés, même un seul bloc mérite son heure
  // et son icône — c'est ce qui rend le jour en cours marqué comme les autres.
  return blocsEnSujets(decouperEnBlocs(lues), ref, zone, 1, calibre);
}

/**
 * LA VOLATILITÉ DE LA JOURNÉE.
 *
 * Deux couches, et il ne faut pas les confondre. Les RELEVÉS sont posés à la
 * main, sur dix, à une heure connue : c'est une mesure. La charge des moments
 * est déduite de mots : c'est une lecture. On rend les deux étiquetées, et
 * l'affichage privilégie la mesure quand elle existe — « ce qui est rempli est
 * mesuré, ce qui est contouré est déclaré », la règle vaut aussi ici.
 */
export function volatiliteDuJour(date, userId = OWNER, { zone = zoneCourante(), reference = null } = {}) {
  const rel = relevesDuJour(date, userId)
    .map(r => ({ heure: heureDe(r.ts, zone), ts: r.ts, valeur: r.valeur, quoi: r.quoi ?? null, source: r.source ?? 'modele' }));
  /*
   * LA MÊME RÉFÉRENCE QUE LA LISTE. La référence tombait ici : la courbe se
   * calait donc sur la note du soir — ce que `momentsDuJour` interdit
   * justement —, et un même moment était lu ≈5,5 dans la liste et ≈7,5 sur
   * la courbe. Sur un vrai journal, un moment marqué « suicide » y était tracé
   * à ≈8,5.
   */
  const mo = momentsDuJour(date, userId, { zone, reference });
  const v = rel.map(r => r.valeur);
  /*
   * LES HUMEURS : CHAQUE RELEVÉ À SON HEURE, ET LA LECTURE LÀ OÙ IL N'Y EN A PAS.
   *
   * Un point par relevé, posé à SON instant : quand la personne écrit « 3/10 »
   * puis « 2/10 » une minute après, les deux apparaissent — on ne cache jamais
   * la valeur la plus basse derrière la première. Les moments sans relevé
   * gardent l'estimation lue dans leurs mots, EXACTEMENT la valeur de la
   * pastille ≈ du fil à gauche, quand les mots ont le droit d'en donner une
   * (voir `calibrationDesMots`).
   */
  const quand = h => { const t = Date.parse(h.ts); return Number.isNaN(t) ? Infinity : t; };
  const humeurs = [
    // Plein pour ce que la personne a posé, creux pour ce que le compagnon a estimé.
    ...rel.map(r => ({ heure: r.heure, ts: r.ts, valeur: r.valeur, dApres: r.source === 'toi' ? 'releve' : 'modele' })),
    ...mo.filter(m => m.estime?.dApres === 'mots')
      .map(m => ({ heure: m.heure, ts: m.ts, valeur: m.estime.valeur, dApres: 'mots' }))
  ].sort((a, b) => quand(a) - quand(b));
  return {
    releves: rel,
    charges: mo.map(m => ({ heure: m.heure, ts: m.ts, charge: m.charge, scene: m.scene })),
    humeurs,
    // L'écart n'a de sens qu'à partir de deux points : un seul relevé n'est pas
    // une amplitude, c'est un point.
    ecart: v.length >= 2 ? Math.max(...v) - Math.min(...v) : null,
    bas: v.length ? Math.min(...v) : null,
    haut: v.length ? Math.max(...v) : null
  };
}

/** Tout ce que la journée ouverte a besoin de savoir sur elle-même. */
export function journee(date, userId = OWNER, opts = {}) {
  return {
    moments: momentsDuJour(date, userId, opts),
    thematiques: thematiquesDuJour(date, userId),
    volatilite: volatiliteDuJour(date, userId, opts),
    sujets: sujetsDuJour(date, userId, opts)
  };
}
