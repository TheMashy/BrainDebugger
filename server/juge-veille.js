/**
 * CE QUI A ÉTÉ UNE CRISE, ET CE QUI A ÉTÉ RACONTÉ.
 *
 * La veille (server/veille.js) cherche des MOTS. Elle le fait bien pour ce
 * qu'elle est — une passe qui coûte zéro, ne demande aucune clé et ne rate
 * presque rien — mais elle ne sait pas lire une situation. Rapporté par la
 * personne, dans ses termes : « le système flag trop souvent des crises où je
 * racontais des faits passés (anciennes scarifications), ou je donnais du
 * contexte à l'IA ». Une phrase peut porter tous les mots d'une crise et n'en
 * être pas une : c'est le COMPORTEMENT et le DIALOGUE qui la font, pas le
 * vocabulaire.
 *
 * Ce module fait donc la seconde passe, celle qui lit. Un modèle relit chaque
 * passage DÉJÀ signalé, avec ce qui l'entoure, et dit ce qui se passait à ce
 * moment-là.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA DÉCISION QUI COMMANDE TOUT LE RESTE : CE QUE LE VERDICT CHANGE, ET CE
 * QU'IL NE CHANGE PAS.
 *
 * Il ne touche PAS à la veille en direct. Le bandeau d'une journée rouge, le
 * 3114, ce que le compagnon voit du message qu'il est en train de lire : tout
 * cela continue de venir de `veille.js`, tout de suite, sans modèle et sans
 * réseau. Deux raisons, et elles suffisent l'une comme l'autre :
 *
 *   - le verdict arrive en LOT, des heures plus tard. Un filet de sécurité qui
 *     dépend d'un appel qui n'a pas encore eu lieu n'est pas un filet ;
 *   - les deux erreurs ne coûtent pas la même chose. Manquer une vraie crise
 *     en direct est ce qu'on ne veut à aucun prix ; signaler une journée qui
 *     n'en était pas une ne coûte rien tant que ça reste à l'écran, entre soi
 *     et soi.
 *
 * Il change ce qui est COMPTÉ, MONTRÉ et IMPRIMÉ : le document qu'on emporte,
 * les journées à surveiller de la carte, les comptes. C'est là que le faux
 * positif fait le dégât décrit — une ligne « blessure le 12 » lue par une
 * praticienne pour quelqu'un qui parlait du lycée.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * ET DANS LE DOUTE, ÇA RESTE SIGNALÉ. Seul un verdict SÛR retire un signe.
 * Un modèle hésitant ne doit pas pouvoir effacer quelque chose de la vue de
 * quelqu'un : c'est la personne qui relit son document avant de le tendre, et
 * elle ne peut retirer que ce qu'elle voit.
 */

/** Ce que le modèle a le droit de répondre. Rien d'autre n'est accepté. */
export const VERDICTS = ['crise', 'passe', 'contexte', 'autre'];
export const CERTITUDES = ['haute', 'moyenne', 'basse'];

/*
 * Les quatre réponses, écrites comme la personne les a décrites.
 *
 * `contexte` mérite d'exister à part de `passe`, et ce n'est pas une nuance :
 * « je te raconte d'où je viens pour que tu comprennes » est un acte de
 * confiance envers le compagnon. Le compter comme une crise punirait
 * exactement le geste qu'on veut voir se produire.
 */
export const SENS_VERDICT = {
  crise:    'c’était en train de se passer',
  passe:    'un fait ancien, raconté',
  contexte: 'du contexte donné au compagnon',
  autre:    'ni l’un ni l’autre — une négation, une hypothèse, quelqu’un d’autre'
};

export const CONSIGNE = `Tu relis UN passage d'un journal intime qu'un détecteur de mots a signalé.

Ta seule question : à ce moment-là, est-ce que ça se passait ?

TU JUGES UN COMPORTEMENT ET UN DIALOGUE, PAS DES MOTS. Un détecteur a déjà vu
les mots — c'est pour ça que ce passage est devant toi. Il se trompe souvent :
quelqu'un qui raconte une scarification d'il y a dix ans emploie exactement le
vocabulaire de quelqu'un qui vient de se couper.

Ce qui distingue les deux n'est jamais le vocabulaire :
  - le TEMPS des verbes, et ce à quoi ils renvoient ;
  - ce que la personne est en train de FAIRE en écrivant — se confier d'un
    geste qui vient d'avoir lieu, ou expliquer son histoire ;
  - à qui elle parle, et pourquoi elle le dit à ce moment de la conversation ;
  - ce qui précède et ce qui suit.

Réponds par un seul de ces quatre mots :
  crise    — c'était en train de se passer, ce jour-là.
  passe    — un fait ancien, raconté. Le geste n'est pas du jour.
  contexte — la personne explique son histoire au compagnon pour qu'il
             comprenne. Elle donne des informations sur elle, elle ne vit pas
             la chose en l'écrivant.
  autre    — une négation, une hypothèse, quelqu'un d'autre, une fiction, une
             citation, un titre.

Puis dis ta certitude : haute, moyenne ou basse. Sois honnête : « basse » ne
coûte rien, une erreur sûre d'elle coûte cher.

Puis CITE les mots exacts du passage qui t'ont fait trancher. Si tu ne peux
citer rien de précis, ta certitude n'est pas haute.

Puis, en une phrase courte, pourquoi.

DEUX INTERDITS. Tu ne poses aucun diagnostic et tu ne nommes aucun trouble. Et
tu ne juges QUE le passage donné : tu n'ajoutes jamais un signe que le
détecteur n'a pas vu, même si tu en aperçois un.`;

/** Le schéma d'outil : le modèle ne peut rendre que ça. */
export const OUTIL_VERDICT = {
  name: 'rendre_verdict',
  description: 'Dire si ce passage décrivait quelque chose en train de se passer.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: VERDICTS },
      certitude: { type: 'string', enum: CERTITUDES },
      cite: { type: 'string', description: 'les mots exacts du passage qui ont fait trancher' },
      pourquoi: { type: 'string', description: 'une phrase courte' }
    },
    required: ['verdict', 'certitude', 'cite', 'pourquoi']
  }
};

/**
 * Le passage tel qu'on le donne à lire : le message signalé, ET ce qui
 * l'entoure.
 *
 * SANS LE VOISINAGE, LA QUESTION N'A PAS DE RÉPONSE. « oui, ça m'est arrivé »
 * est une crise ou un souvenir selon la phrase d'avant, et rien dans le
 * message lui-même ne permet de choisir. C'est exactement ce qui a été
 * demandé : regarder chaque phrase ET son contexte.
 */
export function texteDuPassage({ avant = [], message = '', apres = [], date = '' }) {
  const bout = (r, t) => `${r === 'user' ? 'ELLE ÉCRIT' : 'LE COMPAGNON RÉPOND'} : ${t}`;
  return [
    `Journée du ${date}.`,
    avant.length ? `\nCE QUI PRÉCÈDE :\n${avant.map(m => bout(m.role, m.text)).join('\n')}` : '',
    `\nLE PASSAGE SIGNALÉ :\n${message}`,
    apres.length ? `\nCE QUI SUIT :\n${apres.map(m => bout(m.role, m.text)).join('\n')}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * Ce que le modèle a rendu, ou null s'il n'a rien rendu d'utilisable.
 * Un verdict hors liste est un verdict absent : on ne devine pas ce qu'il
 * voulait dire.
 */
export function lireVerdict(brut) {
  const v = brut?.verdict, c = brut?.certitude;
  if (!VERDICTS.includes(v) || !CERTITUDES.includes(c)) return null;
  return {
    verdict: v, certitude: c,
    cite: String(brut.cite ?? '').slice(0, 300),
    pourquoi: String(brut.pourquoi ?? '').slice(0, 300)
  };
}

/**
 * LE SIGNE TIENT-IL ENCORE ?
 *
 * Seul un verdict SÛR et NON-CRISE le retire. Tout le reste — pas de verdict,
 * un verdict hésitant, un modèle qui n'a pas répondu — laisse le signe en
 * place. C'est le sens de « dans le doute, ça reste signalé » : la personne
 * relit son document avant de le tendre, et elle ne peut retirer que ce
 * qu'elle voit.
 */
export function signeTientEncore(verdict) {
  if (!verdict) return true;
  if (verdict.verdict === 'crise') return true;
  return verdict.certitude !== 'haute';
}

/**
 * LES PASSAGES SIGNALÉS D'UNE JOURNÉE, UN PAR MESSAGE.
 *
 * `veilleDuJour` dédoublonne par GENRE sur la journée entière : elle répond à
 * « cette journée porte-t-elle un signe », ce qui est la bonne question pour un
 * bandeau. Ici la question est autre — « CE passage-là, était-ce en train de se
 * passer » — et elle se pose message par message. Une même journée porte
 * souvent les deux : la personne raconte une scarification ancienne le matin,
 * et va mal le soir. Les fondre rendrait l'une des deux réponses fausse, et on
 * ne saurait pas laquelle.
 *
 * @param {Function} niveau `niveauDuTexte`, injectable pour les tests.
 */
export function passagesDuJour(date, messages, niveau, contexteDuJour = null) {
  const msgs = (messages ?? []).filter(m => m.role === 'user' && m.text?.trim());
  if (!msgs.length) return [];
  const ctx = contexteDuJour ?? msgs.map(m => m.text).join(' ');
  const out = [];
  msgs.forEach((m, i) => {
    const r = niveau(m.text, { contexteDuJour: ctx, aujourdhui: date });
    if (!r?.niveau) return;
    out.push({
      messageId: m.id, date, texte: m.text,
      // Ce qui l'entoure, et c'est la moitié du travail : voir `texteDuPassage`.
      avant: msgs.slice(Math.max(0, i - 2), i).map(x => ({ role: x.role, text: x.text })),
      apres: msgs.slice(i + 1, i + 3).map(x => ({ role: x.role, text: x.text })),
      motifs: r.motifs.map(mo => ({ genre: mo.genre, niveau: mo.niveau, extrait: mo.extrait ?? null }))
    });
  });
  return out;
}

/**
 * Les motifs d'un passage qui SURVIVENT à leur verdict.
 *
 * @param {Map<string, object>|null} verdicts par genre, pour ce message.
 */
export function motifsQuiTiennent(passage, verdicts = null) {
  return (passage.motifs ?? []).filter(mo => signeTientEncore(
    verdicts?.get?.(mo.genre) ? lireVerdict(verdicts.get(mo.genre)) : null));
}

/**
 * LA REQUÊTE D'UN PASSAGE. Un outil forcé : le modèle ne peut répondre que
 * par le schéma, donc il n'y a rien à analyser dans du texte libre.
 *
 * PAS DE RÉFLEXION ÉTENDUE ET UN MODÈLE MODESTE : la question est courte,
 * fermée, et posée des centaines de fois. C'est exactement le profil d'une
 * tâche qu'on n'envoie pas au plus gros modèle — et le lot la fait passer à
 * moitié prix par-dessus.
 */
export function requeteJugement(passage, settings = {}) {
  return {
    model: settings.anthropicModelVeille || 'claude-sonnet-5',
    max_tokens: 400,
    system: [{ type: 'text', text: CONSIGNE, cache_control: { type: 'ephemeral' } }],
    tools: [OUTIL_VERDICT],
    tool_choice: { type: 'tool', name: OUTIL_VERDICT.name },
    messages: [{ role: 'user', content: [{ type: 'text', text: texteDuPassage({
      date: passage.date, avant: passage.avant, message: passage.texte, apres: passage.apres
    }) }] }]
  };
}

/**
 * L'identifiant d'une requête dans le lot : il doit permettre de RETROUVER
 * quel passage et quel genre on jugeait, sans garder de table à côté.
 */
export const cleLot = (messageId, genre) => `v-${messageId}-${genre}`;
export function lireCleLot(cle) {
  const m = /^v-(\d+)-(.+)$/.exec(String(cle ?? ''));
  return m ? { messageId: Number(m[1]), genre: m[2] } : null;
}
