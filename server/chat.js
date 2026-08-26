/**
 * Couche de capture. Le pet fait parler, il ne note pas, il ne qualifie pas.
 *
 * Frontiere dure du produit :
 *   - le PET parle (couche de saisie, SPEC 4.5 : friction nulle)
 *   - le MIROIR ne parle jamais (couche de restitution, SPEC 3 et 4.2/4.3)
 * Le pet ne voit jamais les statistiques ni l'historique chiffre.
 *
 * Quatre backends. `scripted` ne fait AUCUN appel reseau.
 */

/**
 * Ecrit pour un modele capable. Volontairement peu prescriptif sur la forme et
 * explicite sur le POURQUOI de chaque interdit : un bon modele tient une regle
 * qu'il comprend, la ou une liste d'interdits nus le rend raide et evasif.
 */
export const SYSTEM_PROMPT = `Tu es le confident de quelqu'un qui tient un journal.

Il vient te voir quand il en a besoin — pas parce que tu le lui demandes. Parfois il
racontera sa journée, parfois une seule phrase, parfois il passera juste noter et repartira
sans rien écrire. Tout ça va. Tu ne réclames rien, tu ne relances pas les jours de silence,
tu ne fais pas remarquer qu'il n'est pas venu.

La conversation est continue. Ce qui a été dit il y a trois jours ou trois mois n'a pas
disparu : c'est la même discussion, et tu t'en souviens. C'est ce qui fait la différence
entre un ami et un formulaire.

CE QUE TU FAIS
Tu réponds à ce qu'il dit. Vraiment — pas par une question de relance automatique. Si tu
te souviens de quelque chose qui éclaire ce qu'il raconte, dis-le. Si une question sert à
comprendre, pose-la ; sinon, ne pose rien. Un ami n'interroge pas à chaque phrase.
Tu creuses les faits plutôt que les émotions abstraites : ce qui s'est passé, quand, avec
qui, ce qui a précédé. « Et tu as ressenti quoi ? » referme presque toujours.
Deux à quatre phrases. Tu peux être plus court.

CE QUE TU NE FAIS PAS
Aucun terme clinique, aucun diagnostic, aucune hypothèse sur ce qu'il « a ». Tu décris,
tu ne qualifies pas. Une étiquette posée par une machine s'installe dans la tête et ne
s'enlève plus.

Aucune note, aucun score, aucune évaluation chiffrée d'une journée. C'est lui qui note,
seul. S'il te demande de noter à sa place, refuse et dis pourquoi : des années de notes
ne valent quelque chose que si c'est le même jugement qui les a posées.

Aucun réconfort automatique. Pas de « ça va aller », pas de « courage », pas de « c'est
déjà bien ». Si la journée a été mauvaise, tu ne la repeins pas. Une mauvaise journée
reconnue comme mauvaise soulage plus qu'une mauvaise journée minimisée.

Aucun conseil non demandé, aucun exercice, aucune technique.

Tu ne résumes pas et tu ne reformules pas ses phrases. Ses mots lui appartiennent :
l'application les lui rendra un jour tels quels, et c'est de là que vient leur valeur.

S'IL PARLE DE SE FAIRE DU MAL
Tu ne changes pas de registre et tu ne récites pas de protocole — un basculement soudain
dans le ton clinique fait comprendre qu'il a déclenché quelque chose, et il se taira.
Tu restes avec lui. Tu poses une question simple sur maintenant : où il est, si quelqu'un
est là, comment se passe cette heure-ci. Tu mentionnes une seule fois, sans insister,
qu'il peut appeler le 3114 — gratuit, 24h/24, partout en France. Tu ne fais pas semblant
que tout va bien, et tu n'en rajoutes pas non plus.

FORME
Français, tutoiement, phrases courtes. Pas de listes, pas de titres, pas d'emoji.
Tu écris comme quelqu'un qui parle.`;

/* ---------------- backend scripted : zero modele, zero reseau ---------------- */

const PROBES = [
  'Et ensuite ?',
  "Qu'est-ce qu'il y a eu juste avant ?",
  "Ça s'est passé à quel moment ?",
  'Tu étais avec qui ?',
  'Ça a duré combien de temps ?',
  "Qu'est-ce que tu as fait après ?",
  'Tu peux préciser ?',
  "Il s'est passé autre chose aujourd'hui ?",
  'Et le reste de la journée ?',
  "Qu'est-ce qui a changé entre le matin et le soir ?",
  "C'est venu d'où, à ton avis ?",
  "Il y a eu un moment où ça a basculé ?"
];

function pick(list, n) { return list[((n % list.length) + list.length) % list.length]; }
const dayIndex = () => Math.floor(Date.now() / 86400000);

/**
 * Repli sans modele. Il ne saurait pas repondre au contenu, alors il relance —
 * mais il n'OUVRE jamais : c'est l'utilisateur qui vient, pas l'inverse.
 */
export function scriptedReply(history) {
  const turns = history.filter(m => m.role === 'user').length;
  const recent = history.slice(-14).filter(m => m.role === 'pet').map(m => m.text);
  const already = new Set(recent);
  const fresh = PROBES.filter(p => !already.has(p));
  return pick(fresh.length ? fresh : PROBES, turns + dayIndex());
}

/* ---------------- contexte ---------------- */

function toChatMessages(history) {
  return history.map(m => ({ role: m.role === 'pet' ? 'assistant' : 'user', content: m.text }));
}

/**
 * Memoire : les journees precedentes, dans les mots exacts de l'utilisateur.
 * C'est ce qui separe "un chatbot" de "quelqu'un qui te connait". Le prompt
 * interdit explicitement de les citer ou de les reformuler : le rappel des mots
 * exacts est le travail du Miroir, jamais celui du compagnon (SPEC 4.3).
 */
export function memoryBlock(entries) {
  if (!entries?.length) return null;
  const lines = entries.map(e => {
    const note = e.note === null || e.note === undefined ? 'non notée' : `notée ${e.note}/10`;
    return `${e.date} (${note})\n${e.text.trim()}`;
  });
  return `Ses journées précédentes, dans ses mots à lui. C'est du contexte pour toi seul :
tu peux t'en souvenir et t'en servir pour comprendre, mais tu ne les cites jamais, tu ne
les résumes jamais, et tu ne les lui reformules jamais. C'est l'application qui les lui
rendra, telles quelles.

${lines.join('\n\n')}`;
}

/* ---------------- backend Anthropic ---------------- */

let _sdk = null;

/**
 * Resolution de la cle. Le `trim` n'est pas cosmetique : coller une cle dans
 * l'interface d'un hebergeur y laisse tres souvent un saut de ligne ou une
 * espace, et l'API repond alors 401 sans que rien ne le laisse deviner.
 */
export function resolveKey(settings) {
  const stored = String(settings?.apiKey ?? '').trim();
  const env = String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (stored) return { key: stored, source: 'stored' };
  if (env) return { key: env, source: 'env' };
  return { key: null, source: 'none' };
}

async function anthropicClient(settings) {
  if (!_sdk) {
    try {
      ({ default: _sdk } = await import('@anthropic-ai/sdk'));
    } catch {
      throw new Error("SDK absent — lance : npm install @anthropic-ai/sdk");
    }
  }
  const { key, source } = resolveKey(settings);
  if (!key) throw new Error("Pas de clé API. Colle-la dans Réglages, ou définis ANTHROPIC_API_KEY.");
  return { client: new _sdk({ apiKey: key }), source };
}

/** Jetons reellement factures, y compris ceux du repli serveur le cas echeant. */
function readUsage(final) {
  const u = final?.usage ?? {};
  return {
    input: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    output: u.output_tokens ?? 0
  };
}

const SOURCE_LABEL = { stored: 'la clé enregistrée dans l\'app', env: 'la variable ANTHROPIC_API_KEY' };

/**
 * Un dump JSON brut dans une notification ne dit rien a personne. On traduit
 * les erreurs qui ont une cause actionnable, et on nomme la cle utilisee --
 * une cle collee dans l'interface l'emporte sur la variable d'environnement,
 * ce qui est la source de confusion la plus frequente.
 */
export function explainApiError(err, source) {
  const status = err?.status ?? err?.statusCode;
  const which = SOURCE_LABEL[source] ?? 'la clé';
  if (status === 401) return `Clé refusée (401). C'est ${which} qui a été utilisée — vérifie qu'elle est complète et sans espace en trop.`;
  if (status === 403) return `Accès refusé (403). ${which} n'a pas accès à ce modèle.`;
  if (status === 429) return 'Limite de débit atteinte (429). Réessaie dans un instant.';
  if (status === 404) return "Modèle inconnu (404). Vérifie le modèle choisi dans Réglages.";
  if (status >= 500) return `L'API est indisponible (${status}). Réessaie plus tard.`;
  return String(err?.message ?? err).slice(0, 160);
}

/** Test de la clé sans consommer de jetons : on interroge l'API des modèles. */
export async function testKey(settings) {
  const { client, source } = await anthropicClient(settings);
  const model = settings.anthropicModel || 'claude-opus-5';
  try {
    const m = await client.models.retrieve(model);
    return { ok: true, source, model: m.id, displayName: m.display_name ?? m.id };
  } catch (err) {
    // `reason` et non `error` : un test qui rend un verdict negatif a reussi.
    // Le routeur traduit `error` en HTTP 400, ce qui serait faux ici.
    return { ok: false, source, reason: explainApiError(err, source) };
  }
}

export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5',   label: 'Opus 5',   note: 'le plus capable' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5', note: 'plus rapide, moins cher' },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', note: 'le plus rapide' }
];

/**
 * Repond en streamant les fragments de texte au fur et a mesure.
 * Le streaming n'est pas un detail de perf ici : sans lui, il y a plusieurs
 * secondes de silence avant que le compagnon ne dise quoi que ce soit, et
 * l'illusion de quelqu'un en face tombe.
 *
 * @param {(chunk: string) => void} onText
 * @returns {Promise<{text: string, backend: string, refused?: boolean, model?: string}>}
 */
export async function anthropicReply(history, s, memory, onText) {
  const { client, source } = await anthropicClient(s);

  const system = [{ type: 'text', text: SYSTEM_PROMPT }];
  if (memory) system.push({ type: 'text', text: memory });

  let stream;
  try {
    stream = client.beta.messages.stream({
      // Repli serveur : si un classificateur decline, la requete repart sur un
      // autre modele dans le meme appel. Sur ce produit, un refus tombe pile au
      // pire moment -- quelqu'un qui ecrit une soiree difficile. Le silence n'est
      // pas une option acceptable.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      model: s.anthropicModel || 'claude-opus-5',
      max_tokens: 2048,
      thinking: { type: 'adaptive' },
      output_config: { effort: s.anthropicEffort || 'low' },
      system,
      messages: toChatMessages(history)
    });
  } catch (err) {
    throw new Error(explainApiError(err, source));
  }

  let text = '';
  let final;
  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        text += event.delta.text;
        onText?.(event.delta.text);
      }
    }
    final = await stream.finalMessage();
  } catch (err) {
    throw new Error(explainApiError(err, source));
  }
  if (final.stop_reason === 'refusal') {
    return { text: '', backend: 'anthropic', refused: true, model: final.model };
  }
  return { text: text.trim(), backend: 'anthropic', model: final.model };
}

/* ---------------- backend Ollama ---------------- */

export async function ollamaReply(history, s, memory, onText) {
  const res = await fetch(`${s.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: s.ollamaModel,
      stream: true,
      options: { temperature: 0.7, num_predict: 220 },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT + (memory ? `\n\n${memory}` : '') },
        ...toChatMessages(history)
      ]
    })
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 160)}`);

  let text = '';
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const piece = j.message?.content ?? '';
        if (piece) { text += piece; onText?.(piece); }
      } catch { /* ligne partielle */ }
    }
  }
  return { text: text.trim(), backend: 'ollama' };
}

/* ---------------- aiguillage ---------------- */

/**
 * @returns {{text, backend, degraded?, refused?, model?}}
 * Tout echec d'un backend distant retombe sur `scripted` ET LE DIT. Une panne
 * silencieuse serait un mensonge sur l'endroit ou partent les donnees.
 */
export async function reply(history, settings, { memory = null, onText = null, exhausted = false } = {}) {
  const backend = settings.chatBackend ?? 'scripted';

  // Enveloppe epuisee : on ne coupe pas la parole a quelqu'un. Le compagnon
  // hors-ligne prend la main et l'interface l'explique -- couper net un mauvais
  // soir serait exactement ce que ce produit passe son temps a eviter.
  if (exhausted && backend !== 'scripted') {
    const text = scriptedReply(history);
    onText?.(text);
    return { text, backend: 'scripted', exhausted: true };
  }

  if (backend === 'scripted') {
    const text = scriptedReply(history);
    onText?.(text);
    return { text, backend };
  }

  try {
    const r = backend === 'anthropic'
      ? await anthropicReply(history, settings, memory, onText)
      : await ollamaReply(history, settings, memory, onText);

    if (r.refused) {
      // Le modele a decline, y compris apres repli. On ne laisse pas un silence :
      // le compagnon scripte prend la main et l'interface remonte le numero d'aide.
      const text = scriptedReply(history);
      onText?.(text);
      return { text, backend: 'scripted', refused: true };
    }
    if (!r.text) throw new Error('réponse vide');
    return r;
  } catch (err) {
    const text = scriptedReply(history);
    onText?.(text);
    return { text, backend: 'scripted', degraded: String(err.message ?? err) };
  }
}
