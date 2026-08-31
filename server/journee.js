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
import { readMood, SENS, DEFAUT } from './mood.js';
import { themeDe, THEMES } from '../web/reperes.js';
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
 * L'HEURE LOCALE D'UN MOMENT, dans le fuseau de qui lit.
 *
 * Pas une constante : minuit UTC est 01:00 à Paris et 17:00 à Los Angeles. Une
 * heure serveur ferait basculer les moments du soir au lendemain matin, et la
 * journée se raconterait à l'envers — le vide de 23h passerait avant le réveil.
 */
export function heureDe(ts, zone = zoneCourante()) {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: zone
    }).format(new Date(ts));
  } catch { return new Date(ts).toISOString().slice(11, 16); }
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
 * LES MOMENTS DE LA JOURNÉE.
 *
 * Seulement ce que la PERSONNE a écrit. Les réponses du compagnon sont ses
 * mots à lui : les faire compter dans l'ambiance de la journée reviendrait à
 * lui faire teindre le décor avec ce qu'il vient de dire.
 */
export function momentsDuJour(date, userId = OWNER, { zone = zoneCourante() } = {}) {
  const note = getEntry(date, userId)?.note ?? null;
  const msgs = messagesForDate(date, userId).filter(m => m.role === 'user' && m.text?.trim());
  const moments = [];
  for (const m of msgs) {
    const t = Date.parse(m.ts);
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
    return {
      heure: heureDe(mo.debut, zone),
      ts: new Date(mo.debut).toISOString(),
      scene, force,
      sens: force > 0 ? (SENS[scene] ?? null) : null,
      charge: chargeDe(scene, force),
      coeur: coeurDe(texte),
      messages: mo.ids.length
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
  return {
    releves: rel,
    charges: mo.map(m => ({ heure: m.heure, ts: m.ts, charge: m.charge, scene: m.scene })),
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
    volatilite: volatiliteDuJour(date, userId, opts)
  };
}
