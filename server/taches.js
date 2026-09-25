/**
 * LES TÂCHES DE FOND DE JARVIS.
 *
 * Demandé : « que Jarvis puisse accomplir des tâches (rechercher des choses sur
 * le côté ?) et qu'il puisse avoir accès à Claude pour réfléchir sur des idées
 * simples avec un peu de contexte des projets ».
 *
 * Jarvis répond vite (Sonnet, effort bas) : il ne peut pas passer trois minutes
 * à fouiller le web pendant qu'on attend devant le micro. Une TÂCHE part donc à
 * côté : Machi Tool la lance ici, elle tourne sans lui (Claude, avec la
 * recherche et la lecture web, et la réflexion), et Machi Tool vient voir où
 * elle en est. Finie, elle rend deux choses :
 *   - `resume` : une ou deux phrases à dire à voix haute ;
 *   - `texte`  : le travail complet, avec ses sources, que Machi Tool range.
 *
 * LE CONTEXTE DES PROJETS : ce que la personne a écrit de ses projets dans
 * Machi Tool (et ce que Jarvis y a noté pour elle), joint à chaque tâche pour
 * que Claude réfléchisse avec, pas dans le vide.
 *
 * Rien n'entre dans le journal : une recherche sur des cartes graphiques n'est
 * pas une journée. Les tâches vivent en mémoire, quelques heures : Machi Tool
 * garde les résultats sur le poste.
 */
import { randomBytes } from 'node:crypto';
import { optionsDuModele } from './chat.js';
import { CLAUDE_CONSULTE } from './jarvis-outils.js';

export const TACHE_MODELE = CLAUDE_CONSULTE;
export const TACHE_PLAFOND = 12000;           // sous le seuil où le SDK exige le streaming
export const TACHES_EN_COURS_MAX = 3;         // par personne, en même temps
export const TACHE_DUREE_MAX_MS = 12 * 60 * 1000;
export const TACHE_GARDEE_MS = 6 * 3600 * 1000;
export const PAUSES_MAX = 8;                  // une longue recherche s'interrompt (`pause_turn`) : on la relance
export const PROJETS_MAX = 4000;
export const DEMANDE_MAX = 8000;
export const GENRES = new Set(['recherche', 'reflexion']);

/** La recherche et la lecture web qui filtrent leurs résultats elles-mêmes. */
export const WEB_TACHE = [
  { type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
  { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 6 }
];
/** Si la clé ne les permet pas : la recherche simple. */
export const WEB_SIMPLE = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
const WEB = { simple: false };

export const A_DIRE = { fr: 'À DIRE :', en: 'TO SAY:' };

/** Les projets tels que Machi Tool les envoie : du texte, borné. */
export function projetsPropres(projets) {
  return String(projets ?? '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, PROJETS_MAX);
}

/** Un titre court pour la liste : celui que Jarvis a donné, ou le début de la demande. */
export function titreDe(titre, demande) {
  const t = String(titre ?? '').replace(/\s+/g, ' ').trim();
  if (t) return t.slice(0, 60);
  const d = String(demande ?? '').replace(/\s+/g, ' ').trim();
  return d.length > 60 ? d.slice(0, 57).replace(/\s+\S*$/, '') + '…' : d;
}

export function consigneTache({ genre = 'recherche', projets = '', langue = 'fr', maintenant = '' } = {}) {
  const p = projetsPropres(projets);
  if (langue === 'en') {
    return [
      'You are carrying out a background task for JARVIS, the voice assistant of the person you are helping. '
      + 'Nobody is waiting on the line: take the time to do it properly.',
      genre === 'reflexion'
        ? 'THE TASK IS TO THINK: an idea to explore, a plan, a choice to weigh. Be concrete and honest — '
          + 'say what is strong, what is weak, what to try first. Use the web only if a fact needs checking.'
        : 'THE TASK IS TO RESEARCH: search the web, read the pages that matter, cross-check, then report. '
          + 'Prefer recent, primary sources; say when sources disagree or when you could not find something.',
      p ? `THE PERSON'S PROJECTS (context — use it when relevant, never recite it):\n${p}` : '',
      `START YOUR ANSWER WITH ONE LINE: "${A_DIRE.en} " followed by one or two short sentences that JARVIS will `
      + 'read aloud — the gist, as spoken, no web addresses, no lists. Then a blank line, then the full work: '
      + 'clear, structured, plain text or light markdown, without filler.',
      maintenant ? `Now: ${maintenant}.` : ''
    ].filter(Boolean).join('\n\n');
  }
  return [
    'Tu accomplis une tâche de fond pour JARVIS, l\'assistant vocal de la personne que tu aides. '
    + 'Personne n\'attend au bout du fil : prends le temps de bien faire.',
    genre === 'reflexion'
      ? 'LA TÂCHE EST DE RÉFLÉCHIR : une idée à creuser, un plan, un choix à peser. Sois concret et honnête — '
        + 'ce qui tient, ce qui cloche, par quoi commencer. Le web seulement si un fait mérite d\'être vérifié.'
      : 'LA TÂCHE EST DE CHERCHER : sur le web, lis les pages qui comptent, recoupe, puis rends compte. '
        + 'Préfère les sources récentes et de première main ; dis quand elles divergent ou quand tu n\'as pas trouvé.',
    p ? `LES PROJETS DE LA PERSONNE (du contexte — sers-t'en quand c'est utile, ne le récite pas) :\n${p}` : '',
    `COMMENCE TA RÉPONSE PAR UNE LIGNE : « ${A_DIRE.fr} » suivi d'une ou deux phrases courtes que JARVIS lira `
    + 'à voix haute — l\'essentiel, comme à l\'oral, sans adresse web ni liste. Puis une ligne vide, puis le '
    + 'travail complet : clair, structuré, en texte simple ou markdown léger, sans remplissage.',
    maintenant ? `Maintenant : ${maintenant}.` : ''
  ].filter(Boolean).join('\n\n');
}

/**
 * La réponse de Claude → { resume, texte }. La ligne « À DIRE : » donne le
 * résumé ; sans elle, les deux premières phrases du texte.
 */
export function separerReponse(brut) {
  const t = String(brut ?? '').trim();
  const m = t.match(/^\s*\**\s*(?:À|A) DIRE\s*:?\**\s*(.+?)(?:\n\s*\n|\n|$)/i)
         || t.match(/^\s*\**\s*TO SAY\s*:?\**\s*(.+?)(?:\n\s*\n|\n|$)/i);
  if (m) {
    const resume = m[1].replace(/\*+/g, '').trim();
    const texte = t.slice(m.index + m[0].length).trim();
    return { resume, texte: texte || resume };
  }
  const phrases = t.replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+/g) ?? [];
  return { resume: phrases.slice(0, 2).map(x => x.trim()).join(' ') || t.slice(0, 200), texte: t };
}

/** Les sources citées par la recherche web : [{ titre, url }], sans doublon. */
export function sourcesDe(contenu) {
  const vues = new Map();
  for (const b of Array.isArray(contenu) ? contenu : []) {
    // ce qui est CITÉ, pas tout ce que la recherche a survolé
    for (const c of b?.citations ?? []) {
      if (c?.url && !vues.has(c.url)) vues.set(c.url, String(c.title ?? c.url).slice(0, 160));
    }
  }
  return [...vues].map(([url, titre]) => ({ titre, url }));
}

function usageDe(r) {
  const u = r?.usage ?? {};
  return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
           cacheLu: u.cache_read_input_tokens ?? 0, cacheEcrit: u.cache_creation_input_tokens ?? 0 };
}

const texteDe = contenu => (contenu ?? []).filter(b => b?.type === 'text').map(b => b.text).join('').trim();

/**
 * La tâche elle-même : Claude, la recherche web, la réflexion. Rend
 * { resume, texte, sources, usages: [{ usage, model }] }.
 */
export async function executerTache(client, { demande, genre = 'recherche', projets = '', langue = 'fr',
                                              maintenant = '' }) {
  const d = String(demande ?? '').trim().slice(0, DEMANDE_MAX);
  if (!d) throw Object.assign(new Error('demande vide'), { statut: 400 });
  const system = consigneTache({ genre, projets, langue, maintenant });
  const usages = [];
  const requete = messages => client.messages.create({
    model: TACHE_MODELE,
    max_tokens: TACHE_PLAFOND,
    system,
    messages,
    tools: WEB.simple ? WEB_SIMPLE : WEB_TACHE,
    ...optionsDuModele(TACHE_MODELE, { effort: genre === 'reflexion' ? 'medium' : 'high', pense: true, repli: false })
  });
  let messages = [{ role: 'user', content: d }];
  let r;
  try {
    r = await requete(messages);
  } catch (err) {
    if (!WEB.simple && err?.status === 400 && /web_(search|fetch)|tool/i.test(String(err?.message ?? ''))) {
      WEB.simple = true;
      console.error('[taches] recherche web avancée refusée par l\'API : recherche simple');
      r = await requete(messages);
    } else throw err;
  }
  usages.push({ usage: usageDe(r), model: r.model ?? TACHE_MODELE });
  const contenus = [...(r.content ?? [])];
  for (let i = 0; i < PAUSES_MAX && r?.stop_reason === 'pause_turn'; i++) {
    messages = [...messages, { role: 'assistant', content: r.content }];
    r = await requete(messages);
    usages.push({ usage: usageDe(r), model: r.model ?? TACHE_MODELE });
    contenus.push(...(r.content ?? []));
  }
  if (r?.stop_reason === 'refusal') {
    const non = langue === 'en' ? 'I could not carry out that task.' : 'Je n\'ai pas pu mener cette tâche.';
    return { resume: non, texte: non, sources: [], usages };
  }
  // Le texte du dernier tour porte la réponse ; les tours en pause, la recherche.
  const brut = texteDe(r.content) || texteDe(contenus);
  const { resume, texte } = separerReponse(brut || (langue === 'en' ? 'No answer.' : 'Pas de réponse.'));
  const sources = sourcesDe(contenus);
  const complet = sources.length
    ? `${texte}\n\nSources :\n${sources.map(s => `- ${s.titre} — ${s.url}`).join('\n')}`
    : texte;
  return { resume, texte: complet, sources, usages };
}

/**
 * LE REGISTRE : les tâches de chacun, en mémoire. `lancer` rend tout de suite
 * la tâche (`en_cours`) ; elle se termine seule (`fini` ou `erreur`).
 */
export function creerRegistre({ horloge = () => Date.now(), duree = TACHE_DUREE_MAX_MS } = {}) {
  const parPersonne = new Map();

  function de(userId) {
    if (!parPersonne.has(userId)) parPersonne.set(userId, new Map());
    const taches = parPersonne.get(userId);
    const t = horloge();
    for (const [id, x] of taches) if (x.etat !== 'en_cours' && t - (x.fin ?? x.debut) > TACHE_GARDEE_MS) taches.delete(id);
    return taches;
  }

  const publique = x => {
    const { promesse, ...reste } = x;
    return reste;
  };

  function lancer(userId, params, { client, noter = () => {}, maintenant = '' } = {}) {
    const genre = GENRES.has(params?.genre) ? params.genre : 'recherche';
    const demande = String(params?.demande ?? '').trim().slice(0, DEMANDE_MAX);
    if (!demande) throw Object.assign(new Error('demande vide'), { statut: 400 });
    const taches = de(userId);
    if ([...taches.values()].filter(x => x.etat === 'en_cours').length >= TACHES_EN_COURS_MAX) {
      throw Object.assign(new Error(`déjà ${TACHES_EN_COURS_MAX} tâches en cours : attends qu'une finisse`),
                          { statut: 429 });
    }
    const langue = params?.langue === 'en' ? 'en' : 'fr';
    const x = { id: randomBytes(8).toString('hex'), etat: 'en_cours', genre, langue,
                titre: titreDe(params?.titre, demande), demande, debut: horloge() };
    taches.set(x.id, x);
    let minuterie;
    const limite = new Promise((_, non) => {
      minuterie = setTimeout(() => non(new Error('trop long : la tâche a été arrêtée')), duree);
    });
    x.promesse = (async () => {
      try {
        const c = typeof client === 'function' ? await client() : client;
        const r = await Promise.race([executerTache(c, { demande, genre, projets: params?.projets, langue, maintenant }),
                                      limite]);
        for (const u of r.usages) noter(u.usage, u.model);
        Object.assign(x, { etat: 'fini', resume: r.resume, texte: r.texte, sources: r.sources, fin: horloge() });
      } catch (err) {
        Object.assign(x, { etat: 'erreur', erreur: String(err?.message ?? err).slice(0, 300), fin: horloge() });
        console.error('[taches]', x.erreur);
      } finally {
        clearTimeout(minuterie);
      }
    })();
    return publique(x);
  }

  return {
    lancer,
    lire: (userId, id) => {
      const x = de(userId).get(String(id ?? ''));
      return x ? publique(x) : null;
    },
    lister: userId => [...de(userId).values()].map(x => {
      const { texte, ...court } = publique(x);
      return court;
    }),
    /** Pour les tests : attendre qu'une tâche se termine. */
    attendre: (userId, id) => de(userId).get(id)?.promesse
  };
}
