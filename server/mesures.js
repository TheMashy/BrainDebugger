/*
 * =====================================================================
 * CE QU'UNE AUTRE APPLICATION ENVOIE, ET CE QU'ON EN GARDE.
 *
 * La passerelle avait un seul sens : le site repondait a une lampe. Ici c'est
 * l'inverse -- une application de suivi (montre, telephone, balance, tracker
 * de sommeil) POUSSE ce qu'elle mesure, et le site le range.
 *
 * ---------------------------------------------------------------------
 * ON NE DICTE PAS LA FORME DU JSON.
 *
 * C'est la decision qui tient tout le fichier. Publier un schema et refuser ce
 * qui n'y colle pas revient a demander a quelqu'un d'ecrire un adaptateur avant
 * de pouvoir essayer -- et personne n'ecrit un adaptateur pour tester si ca
 * marche. On accepte donc les formes qui existent vraiment dans la nature :
 *
 *     { "pas": 8410, "sommeil_h": 6.2 }                    -- a plat
 *     { "source": "montre", "date": "...", "mesures": {…} } -- une enveloppe
 *     { "sommeil": { "duree_h": 6.2, "reveils": 3 } }       -- un niveau imbrique
 *     [ {…}, {…} ]                                          -- un lot
 *
 * et les valeurs sous toutes leurs coutumes : nombre, nombre ecrit en chaine,
 * virgule decimale francaise, booleen, objet {valeur, unite}.
 *
 * Ce qui est refuse l'est AVEC UNE RAISON EN FRANCAIS, ecrite dans le journal.
 * Brancher une application exterieure se debogue sinon a l'aveugle : elle
 * envoie, le site repond 200, et rien ne dit ce qu'il a compris.
 *
 * ---------------------------------------------------------------------
 * UNE MESURE N'EST PAS UNE JOURNEE.
 *
 * Meme invariant que le carnet, et pour la meme raison : une journee est vecue
 * et notee a la main, une mesure est relevee par une machine a l'insu de la
 * personne. Rien de ce qui entre ici ne compte comme une journee ecrite, ne
 * deplace la reference, ni ne remplit une case du calendrier. Le journal
 * appartient a la personne ; les mesures ne sont qu'un decor date autour.
 * =====================================================================
 */

import { jourLocal, zoneCourante } from './temps.js';

/** Au-dela, ce n'est plus une synchronisation, c'est un import de fichier. */
export const MAX_MESURES = 500;

/** Un nom de serie plus long qu'un titre de colonne n'est plus un nom. */
export const MAX_CLE = 48;

/** Une mesure textuelle est une etiquette (« sommeil profond »), pas un journal. */
export const MAX_TEXTE = 200;

export const MAX_SOURCE = 32;

/**
 * Les clefs qui decrivent l'ENVOI et non une mesure.
 *
 * Elles sont reservees : `{"pas": 1, "date": "2026-08-30"}` a plat veut dire
 * « un pas, le 30 aout », pas « une mesure nommee date ». C'est le sens que
 * toutes les applications donnent a ces mots, et l'onglet le dit noir sur
 * blanc pour que la surprise n'arrive jamais silencieusement.
 */
export const RESERVES = new Set([
  'source', 'app', 'application', 'device', 'appareil',
  'date', 'jour', 'day', 'at', 'ts', 'time', 'timestamp', 'horodatage',
  'mesures', 'measures', 'data', 'metrics', 'donnees', 'valeurs'
]);

const OU_SONT_LES_MESURES = ['mesures', 'measures', 'data', 'metrics', 'donnees', 'valeurs'];
const OU_EST_LA_DATE = ['date', 'jour', 'day'];
const OU_EST_L_INSTANT = ['ts', 'at', 'time', 'timestamp', 'horodatage'];
const OU_EST_LA_SOURCE = ['source', 'app', 'application', 'device', 'appareil'];

/* ------------------------------------------------------------------ */

/**
 * NORMALISER UN NOM DE SERIE.
 *
 * « Sommeil (h) », « sommeil_h » et « SOMMEIL H » viennent de la meme
 * application un jour ou l'autre -- au fil d'une mise a jour, d'un changement
 * de langue du telephone, d'un champ renomme. Sans normalisation, l'onglet se
 * remplit de trois series de quarante points la ou il en fallait une de cent
 * vingt, et aucune n'est utilisable.
 */
export function normaliserCle(brut) {
  const s = String(brut ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // les accents s'en vont
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  return s.slice(0, MAX_CLE) || null;
}

export const normaliserSource = brut =>
  (normaliserCle(brut) ?? '').slice(0, MAX_SOURCE) || null;

/**
 * LIRE UNE VALEUR, QUELLE QUE SOIT SA FORME.
 *
 * `"6,2"` est un nombre : c'est ce que rend un `toString()` sur un telephone
 * configure en francais, et le refuser transformerait une serie entiere en
 * texte selon la langue du systeme de quelqu'un.
 *
 * Un booleen devient 1 ou 0. « j'ai pris mon traitement : oui » est une serie
 * qui a un sens (une observance, une frequence) et qui se trace ; la garder en
 * texte la rendrait incomptable.
 *
 * `null` n'est pas une valeur : c'est une absence, et une absence ne se stocke
 * pas. Une balance qui envoie `poids: null` les jours sans pesee remplirait la
 * serie de trous ecrits, indistinguables d'un zero a la lecture.
 */
export function lireValeur(v) {
  if (v == null) return null;
  if (typeof v === 'boolean') return { valeur: v ? 1 : 0, texte: null, unite: null };
  if (typeof v === 'number') return Number.isFinite(v) ? { valeur: v, texte: null, unite: null } : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    const n = Number(t.replace(',', '.'));
    // Le test sur la CHAINE et pas seulement sur `Number` : `Number('')` vaut 0
    // et `Number('  12  ')` vaut 12, ce qui ferait passer des vides pour des
    // zeros. La forme doit ressembler a un nombre pour en devenir un.
    if (/^-?\d+([.,]\d+)?$/.test(t) && Number.isFinite(n)) return { valeur: n, texte: null, unite: null };
    return { valeur: null, texte: t.slice(0, MAX_TEXTE), unite: null };
  }
  if (typeof v === 'object' && !Array.isArray(v)) {
    const brut = v.valeur ?? v.value ?? v.val ?? v.v;
    if (brut === undefined) return null;
    const inner = lireValeur(brut);
    if (!inner) return null;
    const unite = v.unite ?? v.unit ?? v.u ?? null;
    return { ...inner, unite: unite == null ? null : String(unite).slice(0, 16) };
  }
  return null;                       // un tableau n'est pas une mesure du jour
}

/* ------------------------------------------------------------------ */

const DEBUT_PLAUSIBLE = '2000-01-01';

/**
 * LA DATE D'UNE MESURE, ET POURQUOI ELLE EST VERIFIEE.
 *
 * Une seconde prise pour une milliseconde tombe en 1970 ; l'inverse tombe en
 * l'an 55000. Les deux se rangent sans broncher dans une colonne TEXT, et
 * l'erreur ne se voit qu'au moment ou un graphe s'aplatit parce que son axe
 * couvre cinquante mille ans. On la refuse ici, ou on peut encore dire
 * pourquoi.
 *
 * La borne haute est aujourd'hui + 1 : une montre reglee sur un autre fuseau
 * peut legitimement etre a demain, et refuser ca casserait l'integration une
 * nuit sur deux en voyage.
 */
export function dateDe(objet, { maintenant = new Date(), zone = zoneCourante() } = {}) {
  const explicite = OU_EST_LA_DATE.map(k => objet?.[k]).find(v => v != null);
  if (explicite != null) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(explicite));
    if (m) return { date: m[1] };
    const t = Date.parse(String(explicite));
    if (Number.isFinite(t)) return { date: jourLocal(new Date(t).toISOString(), zone) };
    return { refus: `date illisible : « ${String(explicite).slice(0, 40)} »` };
  }
  const instant = OU_EST_L_INSTANT.map(k => objet?.[k]).find(v => v != null);
  if (instant != null) {
    const ms = typeof instant === 'number'
      // Sous 10^11, c'est un compte de SECONDES : un horodatage en
      // millisecondes est a treize chiffres depuis 2001, et un horodatage en
      // secondes n'en aura pas onze avant l'an 5138.
      ? (instant < 1e11 ? instant * 1000 : instant)
      : Date.parse(String(instant));
    if (!Number.isFinite(ms)) return { refus: `instant illisible : « ${String(instant).slice(0, 40)} »` };
    const iso = new Date(ms).toISOString();
    return { date: jourLocal(iso, zone), ts: iso };
  }
  return { date: jourLocal(maintenant.toISOString(), zone) };
}

export function datePlausible(date, maintenant = new Date(), zone = zoneCourante()) {
  const demain = new Date(maintenant.getTime() + 86400000).toISOString();
  return date >= DEBUT_PLAUSIBLE && date <= jourLocal(demain, zone);
}

/* ------------------------------------------------------------------ */

/**
 * APLATIR UN OBJET DE MESURES.
 *
 * Un seul niveau d'imbrication : `{sommeil: {duree_h: 6.2}}` donne
 * `sommeil_duree_h`. Au-dela on s'arrete, et on le dit -- un arbre profond
 * aplati en noms a rallonge donne des series que personne ne reconnait, et le
 * silence ferait croire qu'elles sont arrivees.
 */
function aplatir(obj, prefixe = '', profondeur = 0) {
  const out = [];
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (prefixe === '' && RESERVES.has(String(k).toLowerCase())) continue;
    const nom = normaliserCle(prefixe ? `${prefixe}_${k}` : k);
    if (!nom) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)
        && (v.valeur ?? v.value ?? v.val ?? v.v) === undefined) {
      if (profondeur >= 1) { out.push({ cle: nom, trop: true }); continue; }
      out.push(...aplatir(v, nom, profondeur + 1));
      continue;
    }
    out.push({ cle: nom, brut: v });
  }
  return out;
}

/**
 * UN ENVOI → DES LIGNES PRETES A ECRIRE.
 *
 * Rend toujours les deux : ce qui est garde, et ce qui a ete laisse avec sa
 * raison. Une fonction qui ne rendrait que le bon obligerait a deviner la
 * difference entre les deux comptes, et c'est justement la difference qu'on
 * regarde quand ca ne marche pas.
 */
export function analyser(charge, { source = null, maintenant = new Date(), zone = zoneCourante() } = {}) {
  const lots = Array.isArray(charge) ? charge : [charge];
  const gardees = [];
  const laissees = [];
  const vues = [];

  for (const lot of lots) {
    if (!lot || typeof lot !== 'object' || Array.isArray(lot)) {
      laissees.push({ cle: null, pourquoi: 'ce n’est pas un objet JSON' });
      continue;
    }
    const src = normaliserSource(OU_EST_LA_SOURCE.map(k => lot[k]).find(v => v != null) ?? source) ?? 'inconnue';
    const quand = dateDe(lot, { maintenant, zone });
    if (quand.refus) { laissees.push({ cle: null, pourquoi: quand.refus }); continue; }
    if (!datePlausible(quand.date, maintenant, zone)) {
      laissees.push({ cle: null, pourquoi: `date hors du plausible : ${quand.date}` });
      continue;
    }

    // Une enveloppe reconnue : on descend dedans. Sinon l'objet EST la mesure.
    const dedans = OU_SONT_LES_MESURES.map(k => lot[k]).find(v => v && typeof v === 'object');
    const champs = aplatir(dedans ?? lot);
    if (!champs.length) laissees.push({ cle: null, pourquoi: 'aucune mesure dans l’envoi' });

    for (const c of champs) {
      vues.push(c.cle);
      if (gardees.length >= MAX_MESURES) {
        laissees.push({ cle: c.cle, pourquoi: `au-delà de ${MAX_MESURES} mesures par envoi` });
        continue;
      }
      if (c.trop) { laissees.push({ cle: c.cle, pourquoi: 'imbriqué trop profond (deux niveaux au maximum)' }); continue; }
      const v = lireValeur(c.brut);
      if (!v) { laissees.push({ cle: c.cle, pourquoi: 'valeur vide ou illisible' }); continue; }
      gardees.push({
        date: quand.date, ts: quand.ts ?? null, source: src, cle: c.cle,
        valeur: v.valeur, texte: v.texte, unite: v.unite
      });
    }
  }
  return { gardees, laissees, vues };
}

/**
 * L'APERCU ECRIT DANS LE JOURNAL.
 *
 * Les noms des series, pas leurs valeurs. On cherche a reconnaitre SON
 * application dans une liste d'envois -- « ah, c'est celui de la montre » -- et
 * les noms suffisent a ca. Recopier les valeurs ferait du journal une seconde
 * copie des donnees, qui vieillit et ne se corrige jamais.
 */
export const apercuDe = (vues, combien = 6) => {
  const uniques = [...new Set(vues)];
  return uniques.slice(0, combien).join(', ') + (uniques.length > combien ? `, +${uniques.length - combien}` : '');
};
