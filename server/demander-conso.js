/**
 * =====================================================================
 *  QUAND LE COMPAGNON A LE DROIT D'OUVRIR LE SUJET D'UNE CONSOMMATION.
 *
 * Jusqu'ici la règle était simple et absolue : « Tu n'ouvres PAS le sujet »
 * (le bloc des prises, dans chat.js). Elle avait un argument, et il tient
 * toujours : poser « tu as bu combien de fois ce mois-ci ? » à quelqu'un qui
 * venait parler d'autre chose transforme la conversation en contrôle, et on
 * cesse d'ouvrir un outil qui contrôle — les mauvais soirs d'abord,
 * c'est-à-dire ceux qui comptent.
 *
 * ---------------------------------------------------------------------
 * CE QUI CHANGE, ET CE QUI NE CHANGE PAS.
 *
 * Ce qui change : la personne peut maintenant DEMANDER à être relancée, chose
 * par chose. Elle coche « tu as le droit de m'en parler » sur un produit, sur
 * son traitement, ou sur rien du tout.
 *
 * Ce qui ne change pas : sans cette case, le silence. C'est le verrou du
 * dispositif, et tout ce fichier vit derrière lui. Une famille dont
 * `parle !== true` n'arrive même pas jusqu'aux signaux.
 *
 * ---------------------------------------------------------------------
 * POURQUOI C'EST PLUS STRICT QUE POUR LE RESSENTI.
 *
 * « Comment tu te sens ? » est une question qu'un ami pose. « Tu en as pris
 * combien ? » est une question qu'un service pose. La première mal placée est
 * maladroite ; la seconde mal placée est un contrôle — et l'argument Marlatt
 * en tête de `prises.js` dit ce que coûte un contrôle sur ce terrain :
 * transformer un écart d'un soir en échec total, et l'échec total est ce qui
 * fait enchaîner.
 *
 * D'où : une par jour au lieu de six, une par famille et par semaine, aucune
 * relance, et une fenêtre du soir.
 *
 * ---------------------------------------------------------------------
 * CE QU'ON APPELLE UN DOUTE.
 *
 * On ne demande pas parce qu'on est curieux. On demande quand NE PAS SAVOIR
 * CHANGE CE QU'ON VA RÉPONDRE. Deux signaux seulement, les deux plus rares et
 * les moins coûteux en faux positifs :
 *
 *   A. UN SIGNE SANS NOM. Il écrit quelque chose qui parle d'une prise sans
 *      dire laquelle (« j'ai craqué », « j'en ai pris plus que prévu »). C'est
 *      la forme exacte d'un doute, et la seule fois où la question apporte une
 *      information que le journal n'aura pas autrement.
 *      CE QU'IL RATE : « j'ai craqué » seul peut vouloir dire pleurer — ce
 *      dépôt le documente et ne sait le trancher qu'en rattachant à ±1 journée
 *      écrite, ce qui n'existe pas en direct dans le fil. Et tout vocabulaire
 *      hors de la liste des signes : « soirée bizarre » lui est transparent.
 *
 *   B. LE DÉCLENCHEUR DATÉ EST DANS CE QU'IL VIENT D'ÉCRIRE. « après la
 *      solitude, ça revient — 9 fois sur 11 » est déjà compté, et le bloc
 *      autorise DÉJÀ de le lui rappeler dans ce cas précis. Poser la question
 *      est le même geste, un cran plus loin.
 *      CE QU'IL RATE : il exige une carte, donc une lecture de fond déjà
 *      faite. Et tout déclencheur vécu sans réemployer les mots du nœud.
 *
 * DEUX AUTRES SIGNAUX SONT ÉCRITS ET PAS BRANCHÉS, VOLONTAIREMENT. « il a
 * écrit ce soir et n'en a rien dit alors que c'est habituel » sonnerait aussi
 * les bons soirs ; « la pente monte » est le plus dangereux du lot, parce
 * qu'une hausse est exactement ce qui pousse un modèle vers le verdict. Les
 * brancher demande d'observer d'abord ce que les deux premiers donnent.
 * =====================================================================
 */
import { NIVEAUX, niveauDuTexte } from './veille.js';
import { prisesDuTexte, signesDuTexte, SEUILS_PRISES } from './prises.js';
import { heureLocale, jourLocal } from './temps.js';

export const FREINS_CONSO = {
  /* UNE PAR JOUR, TOUTES FAMILLES CONFONDUES. Le ressenti en tolère six parce
     qu'il mesure un ÉCART dans la soirée : deux relevés à deux heures disent
     quelque chose. Une consommation ne se mesure pas en écart — deux questions
     le même soir ne rendent pas une meilleure mesure, elles rendent une
     vérification. */
  par_jour: 1,
  /* ET PAS DEUX FOIS LA MÊME CHOSE DANS LA SEMAINE. C'est le frein qui
     distingue quelqu'un qui remarque d'une check-list du soir. */
  par_famille_jours: 7,
  /* LA FENÊTRE DU SOIR, EN HEURE LOCALE. Avant, il n'y a rien à demander : la
     soirée n'a pas eu lieu. On s'arrête à minuit parce que le jour local
     bascule — « ce soir » et la journée où la réponse sera rangée ne
     désigneraient plus le même jour. */
  heure_min: 18, heure_max: 24,
  /* IL FAUT UNE CONVERSATION AVANT UNE QUESTION. Ouvrir un fil par « pas trop
     de cannabis aujourd'hui ? » fait de la première phrase du compagnon un
     contrôle. On ne demande pas à quelqu'un qui vient de dire bonsoir. */
  fil_min_siens: 3,
  /* Assez de matière pour que la phrase veuille dire quelque chose. */
  mots_min: 6
};

const rang = n => NIVEAUX[n] ?? 0;
const tsDe = m => Date.parse(m?.ts);

/**
 * Le compagnon a-t-il DÉJÀ posé la question, et quand ?
 *
 * ON LE LIT DANS LE FIL, ET PAS DANS UNE TABLE. Une question posée laisse sa
 * trace là où elle a été posée : c'est la source la moins susceptible de
 * mentir, et elle survit à tout — un redémarrage, une migration, un compteur
 * qu'on aurait oublié d'incrémenter dans une branche. Le coût est qu'elle ne
 * reconnaît que les questions qui NOMMENT la chose ; or le bloc impose
 * précisément de la nommer, donc c'est le bon compromis.
 */
export function demandesDuFil(fil = [], familles = []) {
  const vues = new Map();
  for (const m of fil) {
    if (m?.role !== 'pet') continue;
    const t = String(m.text ?? '');
    if (!t.includes('?')) continue;
    for (const f of familles) {
      if (!f?.mots?.test?.(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) continue;
      const q = tsDe(m);
      if (Number.isFinite(q)) vues.set(f.cle, Math.max(vues.get(f.cle) ?? 0, q));
    }
  }
  return vues;
}

/**
 * @param {object[]} fil       les messages récents, une semaine si possible
 * @param {object[]} prises    ce que `analyserPrises` a rendu
 * @param {object[]} familles  les expressions, pour relire le fil
 * @param {string|null} veille le niveau de veille DE LA JOURNÉE
 * @returns {{demander: boolean, cle?: string, nom?: string, genre?: string, pourquoi: string}}
 */
export function occasionDeDemanderConso(
  { fil = [], prises = [], familles = [], veille = null, maintenant = Date.now(), zone = undefined } = {}) {
  const non = pourquoi => ({ demander: false, pourquoi });

  /* --- LE VERROU, AVANT TOUT LE RESTE --- */
  const ouvertes = prises.filter(p => p?.parle);
  if (!ouvertes.length) return non('il n’a ouvert aucun sujet');

  /*
   * LA VEILLE ÉTEINT TOUT, ET ELLE SE LIT SUR LA JOURNÉE.
   *
   * C'est l'inverse du choix fait pour le ressenti — là-bas le contexte du jour
   * ferait sonner le signal toute la soirée, ici on VEUT qu'il éteigne toute la
   * soirée. Le soir où quelqu'un écrit qu'il s'est fait du mal, « tu en as pris
   * combien ? » est le moment exact où un compagnon devient un surveillant.
   *
   * Le JAUNE éteint aussi : c'est « le suicide a été évoqué », « un objet
   * dangereux ». Ce n'est pas le moment de compter des verres.
   */
  if (rang(veille) >= NIVEAUX.jaune) return non('la veille est levée aujourd’hui');

  const siens = fil.filter(m => m?.role === 'user' && String(m.text ?? '').trim());
  const dernier = siens.at(-1);
  if (!dernier) return non('rien à lire');
  if (fil.at(-1) !== dernier) return non('ce n’est pas lui qui vient de parler');

  const auj = jourLocal(dernier.ts, zone);
  const dujour = siens.filter(m => jourLocal(m.ts, zone) === auj);
  if (dujour.length < FREINS_CONSO.fil_min_siens) return non('la conversation commence à peine');

  const h = Number(String(heureLocale(dernier.ts, zone)).slice(0, 2));
  if (!(h >= FREINS_CONSO.heure_min && h < FREINS_CONSO.heure_max))
    return non('ce n’est pas l’heure : la soirée n’a pas eu lieu');

  if (String(dernier.text).trim().split(/\s+/).length < FREINS_CONSO.mots_min)
    return non('trop court pour y voir un doute');

  /* --- LES FREINS DE FRÉQUENCE --- */
  const dejaDemande = demandesDuFil(fil, familles);
  const aujDeb = Date.parse(auj + 'T00:00:00Z');
  if ([...dejaDemande.values()].some(q => jourLocal(new Date(q).toISOString(), zone) === auj))
    return non('déjà demandé aujourd’hui');

  /*
   * IL VIENT D'EN PARLER LUI-MÊME : PLUS DE DOUTE, DONC PLUS DE QUESTION.
   *
   * Sur TOUT le fil du jour, pas seulement le dernier message. S'il a écrit
   * « j'ai fumé deux joints » à 21 h, demander à 23 h n'est plus une question,
   * c'est un recoupement — et se faire recouper est ce qui fait qu'on cesse
   * d'écrire la vérité.
   */
  const ditAujourdhui = new Set();
  for (const m of dujour)
    for (const cle of prisesDuTexte(String(m.text), familles).keys()) ditAujourdhui.add(cle);

  const semaine = FREINS_CONSO.par_famille_jours * 864e5;
  const candidates = ouvertes.filter(p => {
    if (ditAujourdhui.has(p.cle)) return false;
    if (p.n < SEUILS_PRISES.min_jours) return false;
    const q = dejaDemande.get(p.cle);
    return !(q != null && maintenant - q < semaine);
  });
  if (!candidates.length) return non('rien qui ne vienne d’être dit ou demandé');

  /* --- LES SIGNAUX --- */
  const texte = String(dernier.text);
  const nomme = new Set(prisesDuTexte(texte, familles).keys());

  /*
   * SIGNAL A — UN SIGNE SANS NOM.
   *
   * On ne le pose QUE s'il n'y a qu'une seule chose ouverte : sinon on ne sait
   * pas quoi demander, et deviner reviendrait à suggérer une réponse.
   */
  if (signesDuTexte(texte).length && !nomme.size && candidates.length === 1) {
    const p = candidates[0];
    return { demander: true, cle: p.cle, nom: p.nom, genre: p.genre,
             pourquoi: 'il vient d’écrire quelque chose qui parle d’une prise sans dire laquelle' };
  }

  /*
   * SIGNAL B — CE QUI VIENT D'HABITUDE JUSTE AVANT EST DANS CE QU'IL ÉCRIT.
   *
   * Le comptage existe déjà (« après la solitude, ça revient — 9 fois sur
   * 11 »), et le bloc autorise déjà de le lui rappeler dans ce cas précis.
   */
  const t = texte.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const p of candidates) {
    const av = p.avant_ca?.[0];
    if (!av?.nom) continue;
    const mots = String(av.nom).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .split(/[^a-z0-9]+/).filter(w => w.length >= 4);
    if (mots.length && mots.every(w => t.includes(w)))
      return { demander: true, cle: p.cle, nom: p.nom, genre: p.genre,
               pourquoi: `il raconte ce qui, d’habitude, vient juste avant (« ${av.nom} »)` };
  }

  return non('pas de doute, seulement de la curiosité');
}
