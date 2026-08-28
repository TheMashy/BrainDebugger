/**
 * L'HEURE DE CELUI QUI ECRIT, PAS CELLE DE LA MACHINE QUI SERT.
 *
 * Ce journal se tient le soir, et souvent tard. « Aujourd'hui » y est la
 * journee de la personne, telle qu'elle la vit -- pas un intervalle UTC.
 *
 * Tant que le serveur tournait sur le meme ordinateur que le navigateur, un
 * simple `new Date().getDate()` disait vrai : les deux horloges etaient la
 * meme. Des que l'application est hebergee, le processus tourne en UTC, et
 * tout ce qui touche a l'heure ment d'un decalage entier :
 *
 *   - la note posee a 00h30 a Paris tombe sur la VEILLE, un trou dans la
 *     grille et une journee comptee deux fois ;
 *   - le marqueur devant chaque message annonce 22:30 au compagnon quand la
 *     personne ecrit a minuit et demi -- et c'est precisement l'heure tardive
 *     qu'il est cense remarquer ;
 *   - un repere « demain » est refuse alors qu'il est encore aujourd'hui.
 *
 * La reponse : le navigateur annonce SA zone (en-tete « X-Fuseau »), et tout
 * ce qui, cote serveur, calcule une date ou une heure lisible passe par elle.
 * On ne stocke rien de nouveau -- les instants restent des ISO en UTC, ce qui
 * est la seule forme qui ne se perime pas ; c'est la LECTURE qui est localisee.
 *
 * Le contexte voyage par AsyncLocalStorage plutot qu'en parametre : « quelle
 * date sommes-nous ? » se pose depuis une trentaine d'endroits, et un seul
 * oubli redonne silencieusement la mauvaise journee a quelqu'un. Un stockage
 * par requete rend l'oubli impossible.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const JOURS_SEM = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];

const contexte = new AsyncLocalStorage();

/**
 * Le dernier recours : la zone du serveur lui-meme.
 *
 * En local -- le cas nominal de ce produit -- c'est exactement la zone de la
 * personne, puisque c'est la meme machine. Heberge, c'est UTC, et c'est le
 * comportement d'avant : on ne fait jamais PIRE que ce qui existait, on fait
 * mieux des que le navigateur parle.
 */
export const ZONE_SERVEUR = (() => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
  catch { return 'UTC'; }
})();

/* Les formateurs coutent cher a construire et il y en a un par zone : on les
   garde. Un jeu de zones est borne par le nombre de personnes connectees. */
const FORMATEURS = new Map();

function formateur(zone) {
  let f = FORMATEURS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
    FORMATEURS.set(zone, f);
  }
  return f;
}

/**
 * Une zone que le navigateur a le droit d'annoncer.
 *
 * La valeur vient de l'exterieur : elle sert a construire un Intl, et une
 * chaine fantaisiste ferait lever une exception au milieu d'un calcul de date.
 * On refuse tout ce qui ne ressemble pas a un identifiant IANA avant meme de
 * demander a Intl, puis on laisse Intl trancher.
 */
export function zoneValide(z) {
  if (typeof z !== 'string' || z.length < 3 || z.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9+_-]*(\/[A-Za-z0-9+._-]+)*$/.test(z)) return false;
  if (FORMATEURS.has(z)) return true;
  try { formateur(z); return true; } catch { return false; }
}

/** La zone annoncee par cette requete, ou celle du serveur. */
export function zoneDeRequete(req) {
  const z = req?.headers?.['x-fuseau'];
  return zoneValide(z) ? z : ZONE_SERVEUR;
}

/** Traite `fn` en tenant `zone` pour la zone de la personne. */
export const dansLaZone = (zone, fn) => contexte.run({ zone }, fn);

/** La zone de la requete en cours. Hors requete : celle du serveur. */
export const zoneCourante = () => contexte.getStore()?.zone ?? ZONE_SERVEUR;

/** Les morceaux d'un instant, lus dans une zone. `null` si l'instant est illisible. */
function parties(ts, zone) {
  // Pas de repli sur « maintenant » : les appelants qui veulent l'instant
  // courant le passent eux-memes. Un `undefined` ou une chaine vide est une
  // date ABSENTE, et rendre l'heure du serveur a sa place collerait un
  // marqueur inventé devant un message qui n'en a pas.
  if (ts === null || ts === undefined || ts === '') return null;
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const p = {};
  for (const m of formateur(zone).formatToParts(d)) p[m.type] = m.value;
  // « 24 » a minuit : hourCycle h23 l'evite, mais un moteur plus ancien peut
  // encore le rendre, et « 24:05 » devant un message est une heure qui n'existe pas.
  if (p.hour === '24') p.hour = '00';
  return p;
}

/**
 * La journee civile d'un instant, dans la zone : « 2026-08-28 ».
 * C'est CETTE fonction qui decide sur quelle case de la grille tombe une note.
 *
 * L'instant est OBLIGATOIRE, et il n'y a pas de repli sur « maintenant » :
 * `jourLocal(peutEtreUndefined)` rendrait la date du jour sans le dire, ce qui
 * ecrirait une entree sur aujourd'hui a la place d'une date manquante. Qui
 * veut l'instant courant passe `Date.now()`.
 */
export function jourLocal(ts, zone = zoneCourante()) {
  const p = parties(ts, zone);
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}

/** L'heure lisible d'un instant, dans la zone : « 03:14 ». */
export function heureLocale(ts, zone = zoneCourante()) {
  const p = parties(ts, zone);
  return p ? `${p.hour}:${p.minute}` : null;
}

/**
 * Le marqueur mis devant chaque message pour le compagnon : « mar. 12/08 03:14 ».
 *
 * Le jour de la semaine se deduit des morceaux deja localises, pas d'un
 * `getDay()` : celui-la rendrait le jour de la machine, ce qui est exactement
 * l'erreur qu'on repare ici.
 */
export function marqueTemps(ts, zone = zoneCourante()) {
  const p = parties(ts, zone);
  if (!p) return null;
  const jsem = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
  return `${JOURS_SEM[jsem]} ${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/**
 * De quoi verifier, a l'ecran, que la chaine entiere tient : la zone que le
 * SERVEUR a retenue, l'heure qu'il en tire, et son decalage a UTC. Si le
 * navigateur et cet encart ne disent pas la meme heure, l'en-tete ne passe pas.
 */
export function etatDuTemps(zone = zoneCourante()) {
  const maintenant = Date.now();
  const p = parties(maintenant, zone);
  // Le decalage se mesure : on relit le meme instant comme s'il etait UTC et
  // on compare. Aucune table a tenir a jour, et l'heure d'ete est incluse.
  const commeUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  const minutes = Math.round((commeUtc - Math.floor(maintenant / 60000) * 60000) / 60000);
  const signe = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return {
    zone,
    jour: `${p.year}-${p.month}-${p.day}`,
    heure: `${p.hour}:${p.minute}`,
    decalage: `UTC${signe}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`,
    duServeur: zone === ZONE_SERVEUR
  };
}
