/**
 * LA PASSERELLE — CE QUE LE SITE DONNE À UNE APPLICATION LOCALE.
 *
 * Machi Tool tourne sur la machine de la personne et allume une guirlande. Le
 * site, lui, tourne sur Internet. Les deux ne peuvent pas se joindre dans ce
 * sens-là : rien sur Internet ne sait joindre une machine derrière une box, et
 * un onglet fermé ne relaie plus rien. C'est donc l'application qui vient
 * DEMANDER, régulièrement, et le site qui répond.
 *
 * Elle n'a pas de session : elle n'est pas un navigateur, personne n'est devant
 * elle, et lui faire porter un cookie de connexion serait lui confier une
 * identité complète pour allumer une lampe. Elle porte donc une CLÉ, créée
 * exprès dans Réglages, qui n'ouvre que cette route et rien d'autre. On peut la
 * révoquer sans se déconnecter de nulle part.
 *
 * CE QUI SORT D'ICI SORT DÉFINITIVEMENT. Le journal ne passe pas : pas une
 * phrase écrite, pas un message, pas une lecture. Ce qui sort est ce qu'une
 * lampe peut porter — une couleur, une note sur dix, un titre de repère. Une
 * guirlande qui montrerait le texte du soir serait une fuite avec un joli nom.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, getSettings, setSettings, OWNER, allEntries, allEvents, getLecture } from './db.js';
import { deltaColor } from '../web/charts.js';
import { SENS, DEFAUT } from './mood.js';

/** Combien de journées la lampe reçoit. De quoi dessiner une bande, pas un an. */
export const JOURS_ENVOYES = 60;

/**
 * LA COULEUR DE CHAQUE AMBIANCE.
 *
 * Elle n'existait nulle part : les scènes sont des shaders, elles n'ont pas de
 * teinte unique qu'on pourrait leur prendre. Ce sont donc des choix, un par
 * scène, tenus par ce que la scène VEUT DIRE et pas par ce à quoi elle
 * ressemble — une guirlande n'a ni relief ni mouvement, elle n'a qu'un ton.
 */
export const COULEUR_SCENE = {
  drift:    '#3B4E8C',   // perdu, des étoiles : un bleu de nuit claire
  brume:    '#6E7E8A',   // le calme : un gris qui ne demande rien
  abyss:    '#8A5A2B',   // l'irréversible : la pierre chaude d'une pyramide
  eclipse:  '#4B3A6B',   // la lumière cachée : un violet qui retient
  voidwell: '#1F3350',   // le vide : le bleu le plus sombre du jeu
  monolith: '#5A5E66',   // l'épreuve : la pierre dressée, grise et franche
  grain:    '#5E6B33',   // rien ne tient : un vert acide, instable
  mandel:   '#6B3560'    // la pensée qui se replie : un magenta profond
};

/** `rgb(1,2,3)` → `#010203`. La lampe veut de l'hexadécimal. */
export function versHex(couleur) {
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(String(couleur ?? ''));
  if (!m) return null;
  return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** La couleur d'une note, prête pour une ampoule. `null` si la journée n'est pas notée. */
export const couleurDeNote = (note, reference = 6) =>
  note == null ? null : versHex(deltaColor(note - reference));

/* --------------------------------------------------------------------------
   LA CLÉ
   -------------------------------------------------------------------------- */

/** Une clé neuve. Trente-deux caractères d'URL, sans ambiguïté à recopier. */
export const nouvelleCle = () => randomBytes(24).toString('base64url');

/**
 * Comparer sans laisser fuir la longueur ni l'endroit où ça diverge.
 *
 * `a === b` sort au premier caractère différent : mille essais suffisent alors
 * à retrouver une clé un caractère à la fois. Ici la comparaison dure toujours
 * le même temps, et deux longueurs différentes ne se comparent même pas.
 */
export function memeCle(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * LA CLÉ PRÉSENTÉE, D'OÙ QU'ELLE VIENNE.
 *
 * Machi Tool l'envoie aux trois endroits à la fois — en-tête d'autorisation,
 * en-tête maison, et paramètre d'URL — parce qu'il ne sait pas lequel le site
 * lit. On les accepte tous les trois : refuser deux d'entre eux ne protège de
 * rien et fait chercher longtemps.
 */
export function cleDeLaRequete(req, url) {
  const h = req.headers ?? {};
  const bearer = /^Bearer\s+(.+)$/i.exec(String(h.authorization ?? ''));
  return (bearer?.[1] ?? h['x-machitool-cle'] ?? h['x-passerelle-cle']
          ?? url?.searchParams?.get('cle') ?? '').toString().trim() || null;
}

/**
 * À QUI APPARTIENT CETTE CLÉ.
 *
 * L'instance peut porter plusieurs journaux ; la clé désigne lequel. On les
 * parcourt tous, en comparaison à temps constant, et la première qui répond
 * gagne. Aucune clé, aucune correspondance : personne.
 */
export function proprietaireDeLaCle(cle) {
  if (!cle) return null;
  const lignes = db.prepare(
    "SELECT user_id, value FROM settings WHERE key = 'passerelleCle'"
  ).all();
  for (const l of lignes) {
    let v = null;
    try { v = JSON.parse(l.value); } catch { continue; }
    if (memeCle(v, cle)) return l.user_id;
  }
  return null;
}

/** Créer (ou remplacer) la clé de quelqu'un. Rend la nouvelle, en clair : il doit la recopier. */
export function poserCle(userId = OWNER) {
  const cle = nouvelleCle();
  setSettings({ passerelleCle: cle }, userId);
  return cle;
}

export function retirerCle(userId = OWNER) {
  setSettings({ passerelleCle: '' }, userId);
}

/* --------------------------------------------------------------------------
   CE QUE LA LAMPE REÇOIT
   -------------------------------------------------------------------------- */

const jourISO = d => d.toISOString().slice(0, 10);

/**
 * LES RAPPELS. Ce que le site a à dire, et qui tient sur une bulle.
 *
 * Il n'y a pas de système de rappels dans ce produit, et il ne faut pas en
 * inventer un : la seule chose qui ATTEND vraiment quelqu'un, c'est la note du
 * jour quand elle n'est pas venue. C'est le seul geste que personne d'autre ne
 * peut faire à sa place, et la seule raison honnête de faire clignoter une
 * lampe dans une pièce.
 */
export function rappelsPour(userId = OWNER, maintenant = new Date()) {
  const notees = new Set(
    allEntries(userId).filter(e => e.note != null).map(e => e.date)
  );
  const out = [];
  const hier = new Date(maintenant); hier.setDate(hier.getDate() - 1);
  const aujourdhui = jourISO(maintenant);

  // Hier passe avant aujourd'hui : une journée finie qui n'a pas été notée ne
  // le sera plus toute seule, alors que celle d'aujourd'hui a encore le temps.
  if (!notees.has(jourISO(hier))) {
    out.push({ id: `note-${jourISO(hier)}`, titre: 'Hier n’est pas noté',
               texte: 'Une note sur dix, et c’est rangé dans Année.' });
  } else if (maintenant.getHours() >= 20 && !notees.has(aujourdhui)) {
    out.push({ id: `note-${aujourdhui}`, titre: 'La journée n’est pas notée',
               texte: 'Une note sur dix, avant qu’elle se referme.' });
  }
  return out;
}

/**
 * L'HUMEUR DU MOMENT, en une couleur.
 *
 * La note du jour l'emporte sur l'ambiance : elle est DÉCLARÉE, quelqu'un l'a
 * posée à la main, tandis que l'ambiance est déduite de ce qui vient d'être
 * écrit. La règle de couleur du produit ne change pas parce qu'on la sort par
 * un tuyau — ce qui est mesuré passe devant ce qui est deviné.
 */
export function humeurPour(userId = OWNER, ambiance = null, maintenant = new Date()) {
  const aujourdhui = jourISO(maintenant);
  const e = allEntries(userId).find(x => x.date === aujourdhui);
  const scene = ambiance?.scene ?? DEFAUT;
  const couleur = couleurDeNote(e?.note) ?? COULEUR_SCENE[scene] ?? COULEUR_SCENE[DEFAUT];
  return {
    valeur: e?.note ?? null,
    libelle: e?.note != null ? `${e.note}/10` : (SENS[scene] ?? SENS[DEFAUT]),
    couleur,
    date: aujourdhui
  };
}

/** Les dernières journées, avec leur couleur. De quoi peindre une bande. */
export function joursPour(userId = OWNER, combien = JOURS_ENVOYES) {
  return allEntries(userId)
    .filter(e => e.note != null)
    .slice(-combien)
    .map(e => ({ date: e.date, note: e.note, couleur: couleurDeNote(e.note) }));
}

/**
 * LA COULEUR D'UN REPÈRE, ET LA RÈGLE QUI LA DÉCIDE.
 *
 * « Ce qui est REMPLI est MESURÉ, ce qui est CONTOURÉ est DÉCLARÉ » — sur la
 * frise, la teinte choisie à la main ne touche jamais le remplissage, elle ne
 * fait que le trait. Une ampoule n'a pas de trait : elle n'a qu'un
 * remplissage. Le repère sort donc dans la couleur de SA JOURNÉE, qui est une
 * mesure, et la teinte déclarée ne sert que si la journée n'est pas notée.
 *
 * Les thèmes, eux, n'ont pas de couleur — ils choisissent un dessin, pas une
 * teinte, et leur en inventer une ici en ferait une classification colorée que
 * le produit refuse partout ailleurs.
 */
function couleurDeRepere(ev, notes) {
  const mesure = couleurDeNote(notes.get(ev.date));
  if (mesure) return mesure;
  return ev.teinte == null ? null : versHexHsl(ev.teinte);
}

/** `hsl(258 62% 58%)` en hexadécimal : la lampe ne sait pas lire du HSL. */
export function versHexHsl(teinte, s = 0.62, l = 0.58) {
  const k = n => (n + teinte / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const c = n => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return '#' + [c(0), c(8), c(4)].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/** Les repères posés sur la frise. Leur libellé sort, il a été écrit pour être lu. */
export function reperesPour(userId = OWNER) {
  const notes = new Map(allEntries(userId).map(e => [e.date, e.note]));
  return allEvents(userId).map(ev => ({
    date: ev.date, titre: ev.label, couleur: couleurDeRepere(ev, notes)
  }));
}

/**
 * TOUT CE QUE LA PASSERELLE REND, EN UN OBJET.
 *
 * `ambiance` est passée plutôt que calculée ici : elle vit dans l'API, elle
 * dépend de la conversation en cours, et la recalculer ailleurs donnerait deux
 * réponses à la même question.
 */
export function attente(userId = OWNER, { ambiance = null, maintenant = new Date() } = {}) {
  const l = getLecture(userId);
  return {
    humeur: humeurPour(userId, ambiance, maintenant),
    rappels: rappelsPour(userId, maintenant),
    jours: joursPour(userId),
    reperes: reperesPour(userId),
    // De quoi savoir si la lampe parle à un journal vivant, sans rien en dire.
    lecture: l ? { fait_le: l.fait_le, jours: l.jours } : null
  };
}
