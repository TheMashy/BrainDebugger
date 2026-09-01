/*
 * =====================================================================
 * LA JOURNEE VECUE, QUI NE COMMENCE PAS A MINUIT.
 *
 * Ce journal se tient le soir, et souvent tard. Quelqu'un qui ecrit a 2 h du
 * matin ne raconte pas la journee qui vient de commencer : il finit celle qui
 * n'est pas encore terminee pour lui. La grille, elle, coupait a minuit --
 * alors la fin de soiree tombait sur le lendemain, une journee se retrouvait
 * coupee en deux, et le lendemain s'ouvrait avec l'humeur de la veille.
 *
 * ---------------------------------------------------------------------
 * LA COUPURE EST LE LEVER, ET IL VIENT DE TROIS ENDROITS.
 *
 *   1. CE QUE LA PERSONNE DIT. « je viens de me lever », « je vais me
 *      coucher » : c'est la source la plus sure, et la seule qui n'ait besoin
 *      d'aucune application tierce.
 *   2. LE QUANTIFIED SELF. L'heure de reveil mesuree, a defaut la premiere
 *      activite de la machine -- ce n'est pas une heure de reveil et on ne la
 *      fera jamais passer pour telle, mais elle borne la journee aussi bien.
 *   3. SA PROPRE MEDIANE, pour les jours ou ni l'un ni l'autre n'existe.
 *
 * SANS AUCUNE DES TROIS, ON NE DEPLACE RIEN. Une coupure inventee ferait
 * glisser des journees entieres d'une case, et personne ne saurait pourquoi.
 * La journee civile est un repli honnete ; une heure devinee ne l'est pas.
 *
 * ---------------------------------------------------------------------
 * UN LEVER D'APRES-MIDI N'EST PAS UNE COUPURE.
 *
 * Quelqu'un qui se leve a 14 h a bien pu se lever a 14 h -- mais s'en servir
 * comme frontiere rattacherait toute sa matinee a la veille, y compris les
 * jours ou il s'est leve a 8 h. On n'utilise donc comme coupure qu'un lever
 * d'avant midi. Ce n'est pas un jugement sur l'heure a laquelle on se leve :
 * c'est la limite de ce qu'une frontiere peut porter.
 * =====================================================================
 */
import { jourLocal, heureLocale, zoneCourante } from './temps.js';
import { enMinutes, mediane, LEVER, PREMIERE, contient, norm } from './allure.js';

/** Au-dela, un lever ne sert plus de frontiere. Voir l'en-tete. */
export const MIDI = 720;

/** Le silence apres lequel le compagnon a le droit de demander l'heure du lever. */
export const SILENCE_QUESTION = 7 * 3600 * 1000;

/** La source des bornes que la personne a dites elle-meme. */
export const SOURCE_DIT = 'dit';
export const CLE_LEVER = 'lever_dit';
export const CLE_COUCHER = 'coucher_dit';

/* ------------------------- ce que la personne dit ------------------------- */

/*
 * CE QU'ON RECONNAIT, ET CE QU'ON NE RECONNAIT PAS.
 *
 * On cherche une phrase qui dit « maintenant », pas une habitude ni un projet.
 * « je me couche tot d'habitude » decrit une vie ; « faut que je me leve tot
 * demain » decrit un reveil qui n'a pas eu lieu. Les deux poseraient une borne
 * fausse, et une borne fausse deplace une journee entiere.
 *
 * On rate donc des tournures, exprès. Rater un « je vais dormir » coute une
 * borne de moins ; en inventer une coute une journee mal rangee, et personne
 * ne saurait de quoi ca vient.
 */
/*
 * CE QUI DEPLACE LA PHRASE DANS LE TEMPS : un autre jour, une habitude, un
 * projet. Aucun de ces trois ne pose une borne pour MAINTENANT.
 *
 * Le mot « pas » n'est PAS dans cette liste, et c'est voulu : « je me suis
 * levé il y a pas longtemps » est un lever, et le chercher partout dans le
 * message le refusait. La negation se cherche a cote du verbe, pas dans la
 * phrase entiere -- c'est ce que fait `NIE` juste en dessous.
 */
const PAS_MAINTENANT = /\b(jamais|demain|hier|d[’']habitude|souvent|toujours|parfois|chaque (jour|soir|matin)|tous les (jours|soirs|matins)|faut que|faudrait|devrais|j[’']aurais|si je)\b/;

/*
 * Une negation COLLEE au verbe : « je me couche pas ». Ancree au premier mot
 * qui suit, et pas cherchee plus loin -- « je me suis leve il y a pas
 * longtemps » est un lever, et un « pas » a quatre mots de la ne le nie pas.
 */
const NIE = /^\s*(ne|n[’']|pas|plus)\b/;

const COUCHER_DIT = [
  /\bje vais (me coucher|dormir|au lit|au dodo|pioncer|me pieuter)\b/,
  /\bje (me couche|vais me coucher)\b/,
  /\bbonne nuit\b/,
  /\bau dodo\b/,
  /\bje file (au lit|dormir|me coucher)\b/,
  /\bj[’']vais (dormir|me coucher)\b/
];

const LEVER_DIT = [
  /\bje viens de (me lever|me reveiller|emerger)\b/,
  /\bje (me suis|suis) (leve|reveille)e?\b/,
  /\bje me leve\b/,
  /\bje suis (debout|reveille)e?\b/,
  /\bdebout depuis\b/,
  /\b(bien|mal) dormi\b.*\b(je me leve|je suis debout)\b/
];

/** « à 8h », « à 08:30 », « vers 7 h 15 ». Sinon null. */
const HEURE_DITE = /\b(?:a|à|vers|depuis)\s+(\d{1,2})\s*(?:[:hH]\s*(\d{2})?)?\b/;

/**
 * CE QUE CE MESSAGE DIT D'UN LEVER OU D'UN COUCHER.
 *
 * @param {string} texte
 * @returns {{genre: 'lever'|'coucher', heure: string|null} | null}
 *   `heure` n'est remplie que si la phrase la porte (« je me suis levé à 8h ») ;
 *   sinon c'est l'instant du message qui fait foi, et l'appelant le sait.
 */
export function bornesDitesDans(texte) {
  const t = norm(texte).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (PAS_MAINTENANT.test(t)) return null;

  const trouve = r => {
    const m = r.exec(t);
    if (!m) return false;
    // La negation se juge a cote du verbe : ailleurs dans le message, elle
    // parle d'autre chose (« il y a pas longtemps »).
    return !NIE.test(t.slice(m.index + m[0].length));
  };
  const genre = LEVER_DIT.some(trouve) ? 'lever'
              : COUCHER_DIT.some(trouve) ? 'coucher'
              : null;
  if (!genre) return null;

  const m = HEURE_DITE.exec(t);
  let heure = null;
  if (m) {
    const h = Number(m[1]), mn = Number(m[2] ?? 0);
    if (h <= 23 && mn <= 59) heure = `${String(h).padStart(2, '0')}:${String(mn).padStart(2, '0')}`;
  }
  return { genre, heure };
}

/* --------------------------- les levers connus --------------------------- */

/** Une heure lisible, en minutes depuis minuit. Accepte « 08:23 » et 8.5 (heures). */
function heureDeMesure(m) {
  if (!m) return null;
  const parTexte = enMinutes(m.texte);
  if (parTexte != null) return parTexte;
  if (typeof m.valeur === 'number' && Number.isFinite(m.valeur)) {
    // Une heure de lever en nombre : 8,5 sont des heures, 510 des minutes.
    const min = m.valeur > 24 ? m.valeur : m.valeur * 60;
    return min >= 0 && min < 1440 ? Math.round(min) : null;
  }
  return null;
}

/**
 * LES LEVERS CONNUS, PAR DATE.
 *
 * Trois rangs, du plus sur au moins sur : ce que la personne a dit, l'heure de
 * reveil mesuree, la premiere activite de la machine. Le premier trouve gagne
 * -- et on ne melange jamais les rangs dans une meme journee.
 *
 * @param {Array} mesures  des lignes {date, source, cle, valeur, texte}
 * @returns {Map<string, number>} date -> minutes depuis minuit
 */
export function leversConnus(mesures = []) {
  const rangs = new Map();       // date -> {rang, min}
  const rangDe = m => {
    if (m.source === SOURCE_DIT && contient(m.cle, ['lever'])) return 0;
    if (contient(m.cle, LEVER)) return 1;
    if (contient(m.cle, PREMIERE)) return 2;
    return null;
  };
  for (const m of mesures) {
    const r = rangDe(m);
    if (r == null) continue;
    const min = heureDeMesure(m);
    // Voir l'en-tete : un lever d'apres-midi ne peut pas servir de frontiere.
    if (min == null || min >= MIDI) continue;
    const vu = rangs.get(m.date);
    if (!vu || r < vu.rang) rangs.set(m.date, { rang: r, min });
  }
  const out = new Map();
  for (const [d, v] of rangs) out.set(d, v.min);
  return out;
}

/** La mediane de SES levers. C'est le repli, et il n'est jamais une norme. */
export function medianeLever(levers) {
  return mediane([...(levers?.values?.() ?? levers ?? [])]);
}

/**
 * LA COUPURE D'UNE JOURNEE CIVILE : avant cette heure, on est encore la veille.
 *
 * @returns {number|null} minutes depuis minuit, ou null si on ne sait rien.
 */
export function coupureDe(dateCivile, levers, medLever = null) {
  const propre = levers?.get?.(dateCivile);
  if (propre != null && propre < MIDI) return propre;
  return medLever != null && medLever < MIDI ? medLever : null;
}

/** La veille d'une date civile. */
export function veilleDe(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * LA JOURNEE VECUE A LAQUELLE APPARTIENT UN INSTANT.
 *
 * @param {string|number|Date} ts
 * @param {{levers?: Map, medLever?: number|null, zone?: string}} opts
 * @returns {string|null} « 2026-09-01 », ou null si l'instant est illisible.
 */
export function jourVecuDe(ts, { levers = new Map(), medLever = null, zone = zoneCourante() } = {}) {
  const civil = jourLocal(ts, zone);
  if (!civil) return null;
  const h = enMinutes(heureLocale(ts, zone));
  if (h == null) return civil;
  const c = coupureDe(civil, levers, medLever);
  // Sans coupure connue, la journee civile. Voir l'en-tete : on ne devine pas.
  if (c == null) return civil;
  return h < c ? veilleDe(civil) : civil;
}
