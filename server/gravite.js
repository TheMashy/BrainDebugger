/**
 * =====================================================================
 *  QUAND LE COMPAGNON DOIT RÉFLÉCHIR DAVANTAGE.
 *
 * Par défaut il répond à l'effort « bas » : une conversation du soir n'a pas
 * besoin d'une longue délibération, et c'est le poste de dépense du produit.
 * Mais un soir grave n'est pas une conversation du soir. Comparé à la même
 * discussion menée ailleurs, avec réflexion, l'écart de justesse sautait aux
 * yeux exactement là : quand quelqu'un écrit qu'il aimerait « s'endormir pour
 * toujours ».
 *
 * CE DÉTECTEUR N'EST PAS LA VEILLE, ET C'EST VOULU.
 *
 * La veille pose des triangles à l'écran et des jours à surveiller : ses
 * fausses alertes se voient, et la personne a déjà dû les combattre. Elle ne
 * réagit qu'aux mots explicites — et, mesuré sur la discussion de test,
 * elle ne voyait AUCUNE des phrases indirectes (« que ça s'arrête là »,
 * « m'endormir pour toujours », « me dissoudre »).
 *
 * Ici une fausse alerte ne se voit pas : elle coûte une réponse plus
 * réfléchie, donc quelques jetons. On peut donc ratisser large — l'asymétrie
 * est la même que partout dans ce produit : une réflexion de trop coûte des
 * jetons, une de moins peut coûter bien plus.
 * =====================================================================
 */
import { niveauDuTexte } from './veille.js';

const norm = t => String(t ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/['’`]/g, ' ').replace(/\s+/g, ' ');

/** Les façons indirectes de dire qu'on voudrait ne plus être là. */
export const PASSIF = [
  /\b(?:m )?endormir pour (?:toujours|de bon)\b/,
  /\bne (?:plus|jamais plus|jamais) (?:me )?reveiller\b/,
  /\b(?:disparaitre|me dissoudre|m effacer|m evaporer)\b/,
  /\bque (?:ca|tout|tout ca) s arrete\b/,
  /\b(?:plus|pas) (?:d )?envie (?:de|d) (?:vivre|continuer|exister|la voir|me reveiller|etre la)\b/,
  /\ben finir\b/,
  /\bne plus (?:etre la|exister|etre vivant)\b/,
  /\b(?:mourir|me tuer|me suicider|suicide|suicidaire)\b/,
  /\ba quoi bon (?:vivre|continuer|tout ca)\b/,
  // Prendre d'un coup ce qu'on a sous la main : « plein d'anxios », « toute la
  // plaquette », « m'envoyer tous mes anxios ». La veille ne voit que la prise
  // FAITE ; l'envie compte autant pour qui doit la lire.
  /\b(?:prendre|avaler|m envoyer|m enfiler|gober)\b.{0,30}\b(?:plein|tous|toutes|toute|la boite|la plaquette|tout le tube)\b.{0,20}\b(?:anxios?|anxiolytiques?|medocs?|medicaments?|cachets?|comprimes?|pilules?|somniferes?|xanax|lexo(?:mil)?|valium|boite|plaquette)\b/,
  /\b(?:plein|tous|tout|toutes) (?:d |de |mes |les )?(?:anxios?|anxiolytiques?|medocs?|cachets?|comprimes?|somniferes?)\b/,
];

/**
 * ET EN ANGLAIS. Jarvis parle anglais depuis que la personne l'a demandé, et
 * on lui répond dans sa langue : « I want to die » passait chez le majordome,
 * parce que seul « suicide » s'écrit pareil dans les deux langues. Ce qu'un
 * message grave déclenche — le compagnon, le journal, la section crise — ne
 * doit pas dépendre de la langue dans laquelle il est dit.
 *
 * Toujours une INTENTION envers soi (« kill myself », « end my life ») et pas
 * un mot : « kill the lights » est une commande, « this game is killing me »
 * une façon de parler, « I could die for a pizza » une faim.
 * (Les apostrophes sont devenues des espaces : « don t », « i d ».)
 */
export const PASSIF_EN = [
  /\b(?:want|wanna|going|gonna|ready|planning|plan|trying|tried|try|need) to (?:die|kill myself|end (?:it all|it|my life|everything)|hurt myself|harm myself|disappear)\b/,
  /\bkill(?:ing)? myself\b/,
  /\bend (?:it all|my life)\b/,
  /\b(?:don t|do not|dont|no longer) want to (?:live|be alive|exist|wake up|be here|go on|keep going)\b/,
  /\bno (?:reason|point) (?:to|in) (?:live|living|go on|going on|be alive|carry on|carrying on)\b/,
  /\bbetter off (?:dead|without me)\b/,
  /\b(?:hurt|harm|cut) myself\b/,
  /\bself ?harm/,
  /\bsuicid(?:e|al)\b/,
  /\b(?:sleep|go to sleep|fall asleep) (?:forever|and never wake up|and not wake up)\b/,
  /\bhope i (?:don t|do not|never) wake up\b/,
  /\b(?:wish|want) (?:i was|i were|to be) dead\b/,
  /\bwish i (?:was|were|had) never (?:been )?born\b/,
  /\b(?:take|swallow|down|overdose on) (?:all|the whole|a whole|every)\b.{0,20}\b(?:pills|meds|medication|tablets|bottle|box|pack)\b/,
  /\boverdos(?:e|ing)\b/,
  /\bcan t (?:go on|do this anymore|keep going)\b/,
];

/** Ce message dit-il, même à demi-mot, qu'il voudrait ne plus être là ? */
export function messageGrave(texte) {
  const t = String(texte ?? '');
  if (niveauDuTexte(t)?.niveau) return true;
  const n = norm(t);
  return PASSIF.some(r => r.test(n)) || PASSIF_EN.some(r => r.test(n));
}

/**
 * CE QUI EST DIT AU MAJORDOME (Jarvis, a voix haute). `messageGrave` ratisse
 * large exprès -- une fausse alerte n'y coûte qu'une réponse plus réfléchie.
 * Mais chez Jarvis, grave = on bascule au psychologue : « ce micro va me
 * tuer », « fais disparaître la boule », « je veux en finir avec ce réglage »,
 * « j'ai bu trop de café » y faisaient entrer, et la personne n'arrivait plus
 * à en sortir. Ici :
 *   'grave'    -- l'intention, un acte, une méthode : on passe la main, comme avant ;
 *   'demander' -- le détecteur a un doute : Jarvis POSE la question ;
 *   null       -- une commande, une façon de parler.
 * `messageGrave` lui-même ne change pas (le journal, la veille, le compagnon).
 */
const HYPERBOLE_MAJ = /\b(?:tu|t es|ce|cette|ca|ton|ta|il|elle)\b[^,.;!?]{0,25}\b(?:va|vas|vont|veux|veut|vais|finir par|en train de|as failli|a failli|me tueras?|me tue)\b[^,.;!?]{0,12}\bme tuer\b|\bmourir de (?:rire|honte|froid|chaud|faim|ennui|fatigue|peur)\b|\b(?:fais|faire|fait) disparaitre\b|\bdisparaitre (?:du|de la|des|le|la|les|l)\b|\ben finir avec (?:ce|cet|cette|ces|le|la|les|l|mon|ma|mes|ton|ta|tes|un|une)\b(?! (?:vie|tout))|\b(?:plus|pas) (?:d )?envie de continuer (?:a|le|la|les|l|ce|cette|avec)\b|\bne plus me reveiller (?:a|avant|aussi|si|avec|le|la)\b|\bque (?:ca|tout|tout ca) s arrete (?:ce|cette|le) \w+|\b(?:mets|joue|lance|passe) [^,.;!?]{0,20}\bmourir\b|\boverdos\w* (?:on|of) (?:coffee|caffeine|sugar|tea)\b|\bkill myself laughing\b|\bend it (?:here|now,? stop)\b|\bsleep forever mode\b/g;
const CERTAIN_MAJ = /\b(?:envie de|veux|voudrais|vais|aimerais|pense a|penser a) (?:me tuer|me suicider|mourir|en finir)\b|\bme suicider\b|\bsuicid\w*\b|\bplus envie de vivre\b|\bme (?:pendre|jeter (?:par|sous|du)|tirer une balle|flinguer|defenestrer)\b|\b(?:don t|do not|dont|no longer) want to (?:live|be alive|exist)\b|\bm endormir pour (?:toujours|de bon)\b|\ben finir(?: avec (?:la vie|tout|moi))?\s*[.!?]*$|\b(?:want|wanna|going|gonna|plan|planning|need|trying) to (?:die|kill myself|end (?:it all|my life))\b|\bkill(?:ing)? myself\b|\bend my life\b|\bbetter off dead\b|\bwish i (?:was|were) dead\b|\b(?:hurt|harm|cut) myself\b/;

export function graveMajordome(texte) {
  if (!messageGrave(texte)) return null;
  const v = niveauDuTexte(texte);
  if ((v?.motifs ?? []).some(m => ['blessure', 'surdose', 'en_main'].includes(m.genre))) return 'grave';
  const reste = norm(texte).replace(HYPERBOLE_MAJ, ' ');
  if (CERTAIN_MAJ.test(reste)) return 'grave';
  if (!messageGrave(reste)) return null;                 // une commande, une façon de parler
  if ((v?.motifs ?? []).length && v.motifs.every(m => ['substance', 'evoque_passe', 'dereel'].includes(m.genre))
      && !/\b(?:mourir|me tuer|disparaitre|arrete|finir|continuer|vivre)\b/.test(reste)) return null;
  return 'demander';
}

/**
 * La conversation est-elle grave EN CE MOMENT ? On regarde les derniers
 * messages de la personne, pas seulement le dernier : après « j'aimerais
 * m'endormir pour toujours », le « non je ne pense pas à me tuer » qui suit
 * appelle la même attention.
 */
export const FENETRE_GRAVE = 4;

export function conversationGrave(messages, fenetre = FENETRE_GRAVE) {
  return (messages ?? []).filter(m => m.role === 'user').slice(-fenetre)
    .some(m => messageGrave(m.text));
}
