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
import { messagesForDate, relevesDuJour, getEntry, OWNER } from './db.js';
import { readMood, scoresDe, SENS, DEFAUT } from './mood.js';
import { themeDe, THEMES, DEFAUT as DEFAUT_THEME } from '../web/reperes.js';
/*
 * LA VEILLE ENTRE ICI, ET DANS CE SENS-LÀ SEULEMENT.
 *
 * `veille.js` ne connaît que `db.js` : l'importer depuis la journée ne fait
 * aucun cycle. L'inverse en ferait un, et c'est pour ça que le niveau d'un
 * moment se calcule ici plutôt que là-bas.
 */
import { niveauDuTexte } from './veille.js';
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

export function pencheDe(texte) {
  const { scores, mots } = scoresDe(texte);
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (!total || mots < MOTS_PENCHE) return null;
  let somme = 0;
  for (const [scene, v] of Object.entries(scores)) somme += (SIGNE[scene] ?? 0) * v;
  const sens = somme / total;
  /*
   * La densité, et pas le score brut : trois mots lourds dans une phrase de
   * huit mots pèsent, les mêmes trois mots dans un pavé de trois cents mots
   * sont une incise. Sans elle, un long texte plutôt neutre finirait aussi
   * chargé qu'un cri de deux lignes.
   */
  const densite = Math.min(1, total / (mots * 0.35));
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

export function themesDuTexte(texte, max = MAX_THEMES_MOMENT) {
  const compte = new Map();
  for (const p of String(texte ?? '').split(/(?<=[.!?…])\s+|\n+/)) {
    if (p.trim().length < 8) continue;
    const t = themeDe(p);
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
function veilleDuMoment(textes, date) {
  const contexteDuJour = textes.join(' ');
  const motifs = [];
  for (const t of textes) {
    const r = niveauDuTexte(t, { contexteDuJour, aujourdhui: date });
    if (!r.niveau) continue;
    for (const m of r.motifs) if (!motifs.some(x => x.genre === m.genre)) motifs.push(m);
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
  const moments = [];
  for (const m of msgs) {
    const t = Date.parse(m.ts);
    // Un message sans instant lisible garde son texte : il rejoint le moment en
    // cours, ou en ouvre un à l'heure du précédent. On perd son heure, pas sa
    // phrase — et surtout pas les autres.
    if (Number.isNaN(t)) {
      const d0 = moments[moments.length - 1];
      if (d0) { d0.textes.push(m.text); d0.ids.push(m.id); }
      else moments.push({ debut: NaN, fin: NaN, textes: [m.text], ids: [m.id] });
      continue;
    }
    const dernier = moments[moments.length - 1];
    if (dernier && t - dernier.fin <= TROU_MOMENT) {
      dernier.textes.push(m.text);
      dernier.fin = t;
      dernier.ids.push(m.id);
    } else {
      moments.push({ debut: t, fin: t, textes: [m.text], ids: [m.id] });
    }
  }
  return moments.map(mo => {
    const texte = mo.textes.join(' ');
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
    // Le relevé le plus proche DANS la fenêtre du moment, pas le plus proche
    // tout court : un relevé du matin ne dit rien d'un moment de minuit.
    const pose = releves.find(r => {
      const t = Date.parse(r.ts);
      return t >= mo.debut - TROU_MOMENT && t <= mo.fin + TROU_MOMENT;
    });
    return {
      heure: heureDe(mo.debut, zone),
      ts: Number.isNaN(mo.debut) ? null : new Date(mo.debut).toISOString(),
      scene, force,
      sens: force > 0 ? (SENS[scene] ?? null) : null,
      charge,
      coeur,
      /*
       * LES MESSAGES DE LA PHRASE AFFICHÉE. Cliquer un moment doit désigner CE
       * passage-là ; avec les seuls `ids`, un moment de dix messages allumait
       * la colonne entière — le défaut que `messagesDuCoeur` tient fermé.
       */
      coeurIds: messagesDuCoeur(coeur, mo.textes, mo.ids),
      messages: mo.ids.length,
      // Les mêmes que ceux des sujets : c'est par eux que les deux colonnes se
      // répondent, et non par l'heure qu'elles affichent l'une et l'autre.
      ids: mo.ids,
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
      veille: veilleDuMoment(mo.textes, date),
      estime: pose
        ? { valeur: pose.valeur, dApres: 'releve' }
        : penche == null ? null
          : { valeur: estimationDe(penche, ref), dApres: 'mots' }
    };
  }).map(x => ({ ...x, note }));
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
  const msgs = messagesForDate(date, userId).filter(m => m.role === 'user' && m.text?.trim());
  if (!msgs.length) return [];
  const compte = new Map();
  const preuve = new Map();
  for (const m of msgs) {
    // Phrase par phrase : `themeDe` prend le mieux-disant d'un texte, et sur un
    // message entier il ne rendrait qu'un seul thème pour dix minutes de récit.
    for (const p of String(m.text).split(/(?<=[.!?…])\s+|\n+/)) {
      if (p.trim().length < 8) continue;
      const t = themeDe(p);
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
 * changement de sujet. « j'étais content de moi » puis « je me sens vide, j'ai
 * plus envie de rien » est très exactement la frontière qu'on vient chercher en
 * relisant une journée.
 */
export const BASCULE = 0.45;

function themeOuNull(p) {
  if (p.length < 8) return null;
  const t = themeDe(p);
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
function blocsEnSujets(fondus, ref, zone = null, min = 2) {
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
      estime: penche == null ? null : { valeur: estimationDe(penche, ref), dApres: 'mots' }
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

export function sujetsDuTexte(texte, ref = 5) {
  const phrases = phrasesDe(texte);
  if (!phrases.length) return [];
  const lues = phrases.map(p => ({ texte: p, theme: themeOuNull(p), penche: pencheDe(p) }));
  return blocsEnSujets(decouperEnBlocs(lues), ref);
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
  const msgs = messagesForDate(date, userId).filter(m => m.role === 'user' && m.text?.trim());
  if (!msgs.length) return sujetsDuTexte(e?.text ?? '', ref);

  const lues = [];
  for (const m of msgs)
    for (const p of phrasesDe(m.text))
      lues.push({ texte: p, theme: themeOuNull(p), penche: pencheDe(p), ts: m.ts, id: m.id });
  // min = 1 : à partir de messages horodatés, même un seul bloc mérite son heure
  // et son icône — c'est ce qui rend le jour en cours marqué comme les autres.
  return blocsEnSujets(decouperEnBlocs(lues), ref, zone, 1);
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
export function volatiliteDuJour(date, userId = OWNER, { zone = zoneCourante() } = {}) {
  const rel = relevesDuJour(date, userId)
    .map(r => ({ heure: heureDe(r.ts, zone), ts: r.ts, valeur: r.valeur, quoi: r.quoi ?? null }));
  const mo = momentsDuJour(date, userId, { zone });
  const v = rel.map(r => r.valeur);
  /*
   * LES HUMEURS : UN POINT PAR MOMENT QUE L'IA A ÉVALUÉ.
   *
   * C'est ce que « ce qui a bougé » doit montrer — non pas une charge abstraite
   * de −1 à +1, mais la note même que la lecture a posée sur chaque moment, sur
   * dix, EXACTEMENT la valeur de la pastille ≈ du fil à gauche. Un point existe
   * donc parce qu'un moment a été lu et estimé, et la courbe colle enfin à
   * l'humeur de la journée. Quand un relevé tombe dans la fenêtre du moment,
   * `estime` le préfère déjà (dApres: 'releve') : la mesure prime sur la lecture,
   * ici comme partout.
   */
  const humeurs = mo
    .filter(m => m.estime)
    .map(m => ({ heure: m.heure, ts: m.ts, valeur: m.estime.valeur, dApres: m.estime.dApres }));
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
