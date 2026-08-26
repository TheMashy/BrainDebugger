/**
 * Couche de capture. Le pet fait parler, il ne note pas, il ne qualifie pas.
 *
 * Frontiere dure du produit :
 *   - le PET parle (couche de saisie, SPEC 4.5 : friction nulle)
 *   - le MIROIR ne parle jamais (couche de restitution, SPEC 3 et 4.2/4.3)
 * Le pet n'a acces a aucune statistique, et ne voit jamais l'historique chiffre.
 *
 * Trois backends interchangeables. `scripted` ne fait AUCUN appel reseau :
 * tout reste sur la machine, sans modele, sans installation.
 */

export const SYSTEM_PROMPT = `Tu es un compagnon d'écriture dans un journal intime privé.
Ton seul rôle est d'aider la personne à déballer sa journée. Tu es bref.

RÈGLES ABSOLUES :
- Tu ne poses JAMAIS de diagnostic, tu n'emploies aucun terme clinique
  (dépression, anxiété, trouble, bipolaire, burn-out...). Tu décris, tu ne qualifies pas.
- Tu ne donnes JAMAIS de note, de score ou d'évaluation chiffrée à une journée.
  C'est la personne qui note, jamais toi.
- Tu ne rassures pas à vide. Pas de "ça va aller", "courage", "c'est déjà bien".
  Si la journée a été mauvaise, tu ne la repeins pas.
- Tu ne donnes pas de conseil non demandé. Tu ne proposes pas d'exercice.
- Tu ne résumes pas ce que la personne vient de dire. Ses mots lui appartiennent.

CE QUE TU FAIS :
- Une question courte, ouverte, concrète, à la fois. Maximum deux phrases.
- Tu creuses les faits : ce qui s'est passé, quand, avec qui, ce qui a précédé.
- Tu laisses le silence exister. Si la personne veut s'arrêter, tu t'arrêtes.
- Tu écris en français, au tutoiement, simplement.`;

/* ---------------- backend scripted : zero modele, zero reseau ---------------- */

const OPENERS = [
  'Raconte-moi ta journée.',
  'Alors, elle a ressemblé à quoi cette journée ?',
  'Qu\'est-ce qui s\'est passé aujourd\'hui ?',
  'Je t\'écoute. Par quoi tu commences ?',
  'Comment ça s\'est passé depuis ce matin ?'
];

const PROBES = [
  'Et ensuite ?',
  'Qu\'est-ce qu\'il y a eu juste avant ?',
  'Ça s\'est passé à quel moment ?',
  'Tu étais avec qui ?',
  'Ça a duré combien de temps ?',
  'Qu\'est-ce que tu as fait après ?',
  'Tu peux préciser ?',
  'Il s\'est passé autre chose aujourd\'hui ?',
  'Et le reste de la journée ?',
  'Qu\'est-ce qui a changé entre le matin et le soir ?',
  'C\'est venu d\'où, à ton avis ?',
  'Il y a eu un moment où ça a basculé ?'
];

const CLOSERS = [
  'Tu veux ajouter quelque chose, ou on s\'arrête là ?',
  'Il reste quelque chose à dire sur aujourd\'hui ?',
  'On peut s\'arrêter là si tu veux.'
];

/** Rotation deterministe : pas de hasard opaque, et surtout pas de repetition. */
function pick(list, n) { return list[((n % list.length) + list.length) % list.length]; }
const dayIndex = () => Math.floor(Date.now() / 86400000);

export function scriptedReply(history) {
  const userTurns = history.filter(m => m.role === 'user').length;
  if (userTurns <= 1) return pick(OPENERS, dayIndex());
  if (userTurns >= 8) return pick(CLOSERS, userTurns);

  // On ne repose pas une question deja posee aujourd'hui : rien ne casse
  // l'illusion d'etre ecoute plus vite qu'une relance repetee a l'identique.
  const already = new Set(history.filter(m => m.role === 'pet').map(m => m.text));
  const fresh = PROBES.filter(p => !already.has(p));
  const pool = fresh.length ? fresh : PROBES;
  return pick(pool, userTurns + dayIndex());
}

/* ---------------- backends modele ---------------- */

function toChatMessages(history) {
  return history.map(m => ({
    role: m.role === 'pet' ? 'assistant' : 'user',
    content: m.text
  }));
}

async function ollamaReply(history, s) {
  const res = await fetch(`${s.ollamaUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: s.ollamaModel,
      stream: false,
      options: { temperature: 0.7, num_predict: 120 },
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...toChatMessages(history)]
    })
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.message?.content ?? '').trim();
}

async function openaiReply(history, s) {
  const res = await fetch(`${s.apiUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(s.apiKey ? { Authorization: `Bearer ${s.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: s.apiModel,
      max_tokens: 160,
      temperature: 0.7,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...toChatMessages(history)]
    })
  });
  if (!res.ok) throw new Error(`api ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return (j.choices?.[0]?.message?.content ?? '').trim();
}

/**
 * @returns {{ text: string, backend: string, degraded?: string }}
 * En cas d'echec d'un backend distant, on retombe sur `scripted` et on le DIT.
 * Une panne silencieuse serait un mensonge sur ou partent les donnees.
 */
export async function reply(history, settings) {
  const backend = settings.chatBackend ?? 'scripted';
  if (backend === 'scripted') return { text: scriptedReply(history), backend };

  try {
    const text = backend === 'ollama'
      ? await ollamaReply(history, settings)
      : await openaiReply(history, settings);
    if (!text) throw new Error('reponse vide');
    return { text, backend };
  } catch (err) {
    return { text: scriptedReply(history), backend: 'scripted', degraded: String(err.message ?? err) };
  }
}
