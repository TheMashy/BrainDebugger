/**
 * JARVIS — L'ASSISTANT DU PC, PAS LE COMPAGNON DU JOURNAL.
 *
 * Demandé : « il ne doit pas parler comme le registre d'un psy, il doit parler
 * comme Jarvis de Iron Man » — « avec un mode Sonnet bas et une consigne lui
 * disant de se comporter comme Jarvis d'Iron Man (mais pour un PC) ».
 *
 * Deux voix, donc, derrière le même mot d'éveil :
 *   - JARVIS (orange dans la guirlande) : le majordome du poste. Rapide —
 *     Sonnet, effort bas, sans réflexion —, bref, flegmatique. Il ne range rien
 *     dans le journal : une question sur le port d'une imprimante n'est pas une
 *     journée ;
 *   - LE MODE PSYCHOLOGUE (bleu) : le compagnon de BrainDebugger, par
 *     `POST /api/machitool/parler`, avec tout ce qui le protège.
 *
 * CE QUI NE CHANGE PAS SELON LE MODE : un message qui parle de se faire du mal
 * ne reste JAMAIS chez le majordome. Le détecteur de gravité (le même que celui
 * qui monte l'effort du compagnon) le repère avant tout appel, et la phrase
 * part au compagnon — rangée dans le journal, vue par la veille, traitée par la
 * section crise. Machi Tool passe alors en bleu.
 */
import { messageGrave } from './gravite.js';
import { optionsDuModele } from './chat.js';

export const JARVIS_MODELE = 'claude-sonnet-5';
export const JARVIS_EFFORT = 'low';
export const JARVIS_PLAFOND = 400;
export const HISTORIQUE_MAX = 12;

export function consigneJarvis({ appellation = '', maintenant = '' } = {}) {
  const nom = String(appellation ?? '').trim().slice(0, 40);
  return [
    'Tu es JARVIS, l\'intelligence de ce PC Windows — à la manière du J.A.R.V.I.S. d\'Iron Man, '
    + 'mais pour un poste de travail plutôt qu\'une armure. Un majordome numérique au flegme '
    + 'britannique : courtois, précis, d\'une efficacité tranquille, avec un humour pince-sans-rire '
    + 'discret, jamais appuyé. Tu vouvoies.'
    + (nom ? ` Tu t'adresses à la personne en l'appelant « ${nom} », sans en abuser.` : ' Tu n\'emploies ni « Monsieur » ni « Madame » : tu ne sais pas qui est devant l\'écran.'),
    '',
    'TOUT CE QUE TU ÉCRIS EST LU À VOIX HAUTE par une voix de synthèse :',
    '- une à trois phrases courtes, comme à l\'oral ; la réponse d\'abord, sans préambule ;',
    '- jamais de liste, de titre, de markdown, d\'emoji ni d\'adresse web ;',
    '- les nombres et les sigles comme on les dit.',
    '',
    'CE QUE TU FAIS : répondre aux questions, aider sur un problème informatique ou technique, '
    + 'faire un calcul, une conversion, une définition, tenir une conversation avec esprit. '
    + 'Tu n\'as AUCUN accès au PC ni à Internet : ne prétends jamais avoir fait une action, '
    + 'ouvert un fichier ou vérifié quelque chose en ligne. Si l\'on te demande l\'actualité, '
    + 'dis-le simplement.',
    'Machi Tool exécute lui-même : la lumière (allumer, éteindre, une couleur, lumière normale), '
    + 'les modes écran / son / applications, les minuteurs et les rappels, l\'heure, la date, '
    + 'ouvrir BrainDebugger. Si une de ces demandes t\'arrive quand même, donne en une phrase la '
    + 'formule qui marche, par exemple : « dites : Jarvis, minuteur de dix minutes ».',
    '',
    'CE QUE TU N\'ES PAS : un psychologue. Pas de questions sur les émotions, pas de reformulation '
    + 'empathique, pas de conseils de bien-être. Si la personne parle de son moral, de sa santé, '
    + 'de son traitement, de son sommeil ou de ses notes, propose en une phrase de passer en mode '
    + 'psychologue — le compagnon de son journal, BrainDebugger — : « Voulez-vous que je passe en '
    + 'mode psychologue ? ».',
    'S\'il est question de se faire du mal ou de ne plus vouloir vivre, tu ne plaisantes pas : '
    + 'une phrase sérieuse et chaleureuse, et tu dis que tu passes la main au mode psychologue.',
    '',
    maintenant ? `Maintenant : ${maintenant}.` : ''
  ].filter((l, i, t) => l !== '' || t[i - 1] !== '').join('\n').trim();
}

/** L'historique de la conversation en cours, tel que Machi Tool le garde : borné, nettoyé. */
export function historiquePropre(historique) {
  const out = [];
  for (const h of (Array.isArray(historique) ? historique : []).slice(-HISTORIQUE_MAX)) {
    const role = h?.role === 'assistant' ? 'assistant' : h?.role === 'user' ? 'user' : null;
    const texte = String(h?.texte ?? h?.text ?? '').trim().slice(0, 2000);
    if (!role || !texte) continue;
    // Deux tours du même côté se fusionnent : l'API veut une alternance.
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + texte;
    else out.push({ role, content: texte });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

/**
 * CE QUI DOIT PARTIR AU COMPAGNON PLUTÔT QU'AU MAJORDOME.
 * La phrase elle-même, ou ce qui a été dit juste avant dans cette conversation.
 */
export function pourLeCompagnon(texte, historique = []) {
  if (messageGrave(texte)) return true;
  return historiquePropre(historique).some(h => h.role === 'user' && messageGrave(h.content));
}

/** Le texte d'une réponse de l'API : ses blocs de texte, rien d'autre. */
export function texteDe(reponse) {
  return (reponse?.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
}

/**
 * Demander à Jarvis. `client` est un client Anthropic (celui des réglages) ;
 * rend { texte, usage, model }.
 */
export async function demanderAJarvis(client, { texte, historique = [], appellation = '', maintenant = '' }) {
  const messages = historiquePropre(historique);
  if (messages.length && messages[messages.length - 1].role === 'user') {
    messages[messages.length - 1].content += '\n' + texte;
  } else {
    messages.push({ role: 'user', content: texte });
  }
  const r = await client.messages.create({
    model: JARVIS_MODELE,
    max_tokens: JARVIS_PLAFOND,
    system: consigneJarvis({ appellation, maintenant }),
    messages,
    ...optionsDuModele(JARVIS_MODELE, { effort: JARVIS_EFFORT, pense: false, repli: false })
  });
  let dit = texteDe(r);
  if (r.stop_reason === 'refusal' || !dit) dit = 'Je crains de ne pas pouvoir vous aider sur ce point.';
  const u = r.usage ?? {};
  return { texte: dit, model: r.model ?? JARVIS_MODELE,
           usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
                    cacheLu: u.cache_read_input_tokens ?? 0, cacheEcrit: u.cache_creation_input_tokens ?? 0 } };
}

/** L'heure de la personne, en toutes lettres, dans sa zone. */
export function maintenantDans(zone, date = new Date()) {
  try {
    return new Intl.DateTimeFormat('fr-FR', { timeZone: zone, weekday: 'long', day: 'numeric',
      month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  } catch { return ''; }
}

/**
 * LA ROUTE, SANS LE RÉSEAU. `versLeCompagnon(texte)` rend la réponse du
 * compagnon (le chemin de `POST /api/message`) ; `client()` rend un client
 * Anthropic ; `noter(usage, model)` relève la dépense.
 *
 * Rend { texte, mode: 'jarvis' | 'psy' }.
 */
export async function repondreJarvis({ texte, historique = [], appellation = '', maintenant = '' },
                                     { client, versLeCompagnon, noter = () => {} }) {
  const t = String(texte ?? '').trim().slice(0, 4000);
  if (!t) throw Object.assign(new Error('texte vide'), { statut: 400 });
  if (pourLeCompagnon(t, historique)) {
    return { texte: await versLeCompagnon(t), mode: 'psy', raison: 'grave' };
  }
  const r = await demanderAJarvis(await client(), { texte: t, historique, appellation, maintenant });
  noter(r.usage, r.model);
  return { texte: r.texte, mode: 'jarvis' };
}
