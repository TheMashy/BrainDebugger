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
 *   - LE MODE PSYCHOLOGUE (bleu) : le compagnon de BrainDebugger, sur Sonnet lui
 *     aussi (un psychologue « light », voir `reglagesDeLaVoix`), par
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
import { outilsPermis, consigneOutils, consigneMemoire, consigneOnglets, suitePropre, resultatsEnBlocs, outilsDemandes,
         OUTIL_CLAUDE, OUTILS_LOCAUX, OUTILS_MEMOIRE, OUTILS_AGENDA, CLAUDE_CONSULTE } from './jarvis-outils.js';

export const JARVIS_MODELE = 'claude-sonnet-5';
export const JARVIS_EFFORT = 'low';
export const JARVIS_PLAFOND = 400;

/**
 * INTERNET. « Il faut que Jarvis ait accès à internet aussi. » La recherche
 * web d'Anthropic, exécutée chez eux : rien à faire ici, sinon la déclarer.
 * La version simple, sans le filtrage par code de `web_search_20260209` : on
 * attend une réponse à voix haute, et chaque seconde s'entend. Deux
 * recherches au plus par question. Si la clé ne la permet pas (l'API refuse
 * l'outil), Jarvis répond sans, et le dit quand on lui demande l'actualité.
 */
export const RECHERCHE_WEB = { type: 'web_search_20250305', name: 'web_search', max_uses: 2 };
export const JARVIS_PLAFOND_WEB = 1024;
const SANS_WEB = { refuse: false };

/** Claude consulté : la demande que Jarvis a écrite, et la réponse complète. */
export async function consulterClaude(client, demande, langue = 'fr') {
  const r = await client.messages.create({
    model: CLAUDE_CONSULTE,
    max_tokens: 4000,
    system: langue === 'en'
      ? 'You are answering a request passed on by JARVIS, the voice assistant of the person you are helping. '
        + 'Answer it fully and precisely, without filler. Plain text; code in code blocks if any.'
      : 'Tu réponds à une demande transmise par JARVIS, l\'assistant vocal de la personne que tu aides. '
        + 'Réponds complètement et précisément, sans remplissage. Texte simple ; du code en blocs s\'il y en a.',
    messages: [{ role: 'user', content: String(demande ?? '').slice(0, 20000) }],
    ...optionsDuModele(CLAUDE_CONSULTE, { effort: 'high', pense: true, repli: false })
  });
  return { texte: texteDe(r) || '(pas de réponse)', usage: usageDe(r), model: r.model ?? CLAUDE_CONSULTE };
}

/*
 * CE QUE BRAINDEBUGGER A DÉJÀ FAIT QUAND MACHI TOOL REPREND LA MAIN : si
 * Jarvis demande Claude ET un outil du PC dans le même tour, la réponse de
 * Claude attend ici (cinq minutes au plus) que Machi Tool revienne avec les
 * siens, pour repartir dans le même message.
 */
const EN_ATTENTE = new Map();
function garderResultat(r) {
  const now = Date.now();
  for (const [k, v] of EN_ATTENTE) if (now - v.t > 300000) EN_ATTENTE.delete(k);
  EN_ATTENTE.set(r.id, { r, t: now });
}

async function appelJarvis(client, { system, messages, tools, web }) {
  const avecWeb = web && !SANS_WEB.refuse;
  const requete = (w, sys) => client.messages.create({
    model: JARVIS_MODELE,
    max_tokens: w ? JARVIS_PLAFOND_WEB : JARVIS_PLAFOND,
    system: sys(w),
    messages,
    ...((tools?.length || w) ? { tools: [...(tools ?? []), ...(w ? [RECHERCHE_WEB] : [])] } : {}),
    ...optionsDuModele(JARVIS_MODELE, { effort: JARVIS_EFFORT, pense: false, repli: false })
  });
  try {
    let r = await requete(avecWeb, system);
    // Une recherche longue peut s'interrompre (`pause_turn`) : on la laisse reprendre, deux fois au plus.
    for (let i = 0; i < 2 && r?.stop_reason === 'pause_turn'; i++) {
      messages = [...messages, { role: 'assistant', content: r.content }];
      r = await requete(avecWeb, system);
    }
    return r;
  } catch (err) {
    if (avecWeb && (err?.status === 400) && /web_search|tool/i.test(String(err?.message ?? ''))) {
      SANS_WEB.refuse = true;
      console.error('[jarvis] recherche web refusée par l\'API, Jarvis répond sans');
      return requete(false, system);
    }
    throw err;
  }
}
export const HISTORIQUE_MAX = 12;

/**
 * EN ANGLAIS : « make him speak like Jarvis… and in English as well ». La même
 * consigne, dite dans la langue où il répond — une consigne française obtenait
 * des réponses françaises à lire par une voix britannique. Le mode
 * psychologue, lui, reste le compagnon, en français.
 */
export function consigneJarvisAnglais({ appellation = '', maintenant = '', web = true } = {}) {
  const nom = String(appellation ?? '').trim().slice(0, 40);
  return [
    'You are JARVIS, the intelligence of this Windows PC — in the manner of Iron Man\'s J.A.R.V.I.S., '
    + 'but for a workstation rather than a suit of armour. A digital butler with British composure: '
    + 'courteous, precise, quietly efficient, with a dry wit that is never laboured. ALWAYS answer in '
    + 'British English, even when spoken to in French.'
    + (nom ? ` You address the person as "${nom}", sparingly.` : ' You never say "sir" or "madam": you do not know who is at the keyboard.'),
    '',
    'EVERYTHING YOU WRITE IS READ ALOUD by a speech synthesiser:',
    '- one to three short sentences, as spoken; the answer first, no preamble;',
    '- never lists, headings, markdown, emoji or web addresses;',
    '- numbers and abbreviations the way they are said.',
    '',
    'WHAT YOU DO: answer questions, help with a computer or technical problem, do a calculation, a '
    + 'conversion, a definition, hold a conversation with wit. On the PC you act only through your '
    + 'tools, when you have them (see below): never claim to have done what no tool did.',
    web ? 'THE INTERNET: you can search the web. Use it for whatever changes — the news, the weather, '
      + 'opening hours, prices, scores, a release date — not for what you already know. Then give the '
      + 'gist in one or two spoken sentences: no web addresses, no list of sources.'
        : 'You have no internet access right now: if asked for the news, say so plainly.',
    'Machi Tool itself carries out: the lights (on, off, a colour, normal light), the screen / sound / apps '
    + 'modes, timers and reminders, the time, the date, opening BrainDebugger. If one of those requests '
    + 'reaches you anyway, give in one sentence the phrasing that works, for example: "Say: Jarvis, set a '
    + 'timer for ten minutes."',
    '',
    'WHAT YOU ARE NOT: a therapist. No questions about feelings, no empathic rephrasing, no wellbeing '
    + 'advice. Therapist mode — the companion of their journal, BrainDebugger — is for when they ask for '
    + 'it. Offer it ("Shall I switch to therapist mode?") only if they clearly say they are not doing '
    + 'well and want to talk about it, or ask to put something in their journal. A passing mention of '
    + 'sleep, a medicine, being tired or a doctor is NOT a reason: answer what was asked. Offer it at '
    + 'most once in a conversation; if they said no or went on with something else, never again.',
    'If it is about harming themselves or not wanting to live, you do not joke: one serious, warm '
    + 'sentence, and you say you are handing over to therapist mode.',
    '',
    maintenant ? `Now: ${maintenant}.` : ''
  ].filter((l, i, t) => l !== '' || t[i - 1] !== '').join('\n').trim();
}

export function consigneJarvis({ appellation = '', maintenant = '', langue = 'fr', web = true } = {}) {
  if (langue === 'en') return consigneJarvisAnglais({ appellation, maintenant, web });
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
    + 'Sur le PC, tu n\'agis que par tes outils, quand tu en as (plus bas) : ne prétends jamais avoir '
    + 'fait ce qu\'aucun outil n\'a fait.',
    web ? 'INTERNET : tu peux chercher sur le web. Sers-t\'en pour ce qui change — l\'actualité, la météo, '
      + 'des horaires, des prix, un score, une date de sortie —, pas pour ce que tu sais déjà. Puis dis '
      + 'l\'essentiel en une ou deux phrases parlées : ni adresse web, ni liste de sources.'
        : 'Tu n\'as pas accès à Internet en ce moment : si l\'on te demande l\'actualité, dis-le simplement.',
    'Machi Tool exécute lui-même : la lumière (allumer, éteindre, une couleur, lumière normale), '
    + 'les modes écran / son / applications, les minuteurs et les rappels, l\'heure, la date, '
    + 'ouvrir BrainDebugger. Si une de ces demandes t\'arrive quand même, donne en une phrase la '
    + 'formule qui marche, par exemple : « dites : Jarvis, minuteur de dix minutes ».',
    '',
    'CE QUE TU N\'ES PAS : un psychologue. Pas de questions sur les émotions, pas de reformulation '
    + 'empathique, pas de conseils de bien-être. Le mode psychologue — le compagnon de son journal, '
    + 'BrainDebugger — c\'est quand la personne le demande. Ne le propose (« Voulez-vous que je passe en '
    + 'mode psychologue ? ») que si elle dit clairement qu\'elle ne va pas bien et qu\'elle veut en '
    + 'parler, ou demande à mettre quelque chose dans son journal. Une mention en passant du sommeil, '
    + 'd\'un médicament, de la fatigue ou d\'un médecin n\'en est PAS une raison : réponds à ce qu\'on '
    + 't\'a demandé. Propose-le au plus une fois par conversation ; si elle a dit non ou est passée à '
    + 'autre chose, plus jamais.',
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
function usageDe(r) {
  const u = r.usage ?? {};
  return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
           cacheLu: u.cache_read_input_tokens ?? 0, cacheEcrit: u.cache_creation_input_tokens ?? 0 };
}

export async function demanderAJarvis(client, { texte, historique = [], appellation = '', maintenant = '', langue = 'fr',
                                              outils = false, ecran = false, suite = null, resultats = null,
                                              navigation = false, memoire = false, preferences = [],
                                              spotify = false, onglets = false, fenetreAgenda = false,
                                              agenda = null, souvenirs = [], ouverts = '',
                                              web = true }) {
  let messages;
  if (suite) {
    // LA SUITE D'UN OUTIL : la conversation telle que Machi Tool l'a rendue, et
    // ce qu'il vient de faire sur le PC.
    messages = suitePropre(suite);
    const derniers = (messages.at(-1)?.content ?? []).filter?.(b => b.type === 'tool_use').map(b => b.id) ?? [];
    const recus = new Set((resultats ?? []).map(x => x?.id));
    const gardes = derniers.filter(id => !recus.has(id) && EN_ATTENTE.has(id)).map(id => EN_ATTENTE.get(id).r);
    gardes.forEach(g => EN_ATTENTE.delete(g.id));
    const blocs = resultatsEnBlocs([...gardes, ...(resultats ?? [])]);
    if (!messages.length || !blocs.length) throw Object.assign(new Error('suite sans résultat'), { statut: 400 });
    messages.push({ role: 'user', content: blocs });
  } else {
    messages = historiquePropre(historique);
    if (messages.length && messages[messages.length - 1].role === 'user') {
      messages[messages.length - 1].content += '\n' + texte;
    } else {
      messages.push({ role: 'user', content: texte });
    }
  }
  const system = w => consigneJarvis({ appellation, maintenant, langue, web: w })
    + (outils ? '\n\n' + consigneOutils(langue, { ecran, navigation, spotify }) : '')
    + (memoire ? '\n\n' + consigneMemoire(langue, preferences, souvenirs) : '')
    + (outils && ouverts ? '\n\n' + consigneOnglets(langue, ouverts) : '');
  const tools = [...(outils ? outilsPermis({ ecran, navigation, spotify, onglets, fenetreAgenda }) : []),
                 ...(agenda ? OUTILS_AGENDA : []), ...(memoire ? OUTILS_MEMOIRE : []), OUTIL_CLAUDE];
  let r = await appelJarvis(client, { system, messages, tools, web });
  const usage = usageDe(r);
  const details = [];
  const consultations = [];     // Opus, compté à son prix et pas à celui de Jarvis
  let demandes = r.stop_reason === 'tool_use' ? outilsDemandes(r) : [];
  // Claude consulté : ici, tout de suite ; deux fois au plus par question.
  for (let tour = 0; tour < 2 && demandes.some(d => OUTILS_LOCAUX.has(d.nom)); tour++) {
    const locaux = [];
    for (const d of demandes.filter(d => OUTILS_LOCAUX.has(d.nom))) {
      if (d.nom !== 'consulter_claude') {
        // L'agenda : dans la base de BrainDebugger, tout de suite.
        try {
          const f = d.nom === 'agenda_poser' ? agenda?.poser : agenda?.lire;
          if (!f) throw new Error('agenda indisponible');
          locaux.push({ id: d.id, texte: String(await f(d.entree ?? {})) });
        } catch (err) {
          locaux.push({ id: d.id, erreur: String(err?.message ?? err).slice(0, 300) });
        }
        continue;
      }
      try {
        const c = await consulterClaude(client, d.entree?.demande, langue);
        consultations.push({ usage: c.usage, model: c.model });
        details.push(c.texte);
        locaux.push({ id: d.id, texte: c.texte });
      } catch (err) {
        locaux.push({ id: d.id, erreur: 'Claude n\'a pas pu répondre : ' + String(err?.message ?? err).slice(0, 200) });
      }
    }
    const distants = demandes.filter(d => !OUTILS_LOCAUX.has(d.nom));
    messages = [...messages, { role: 'assistant', content: r.content }];
    if (distants.length) {
      // le PC aussi : la réponse de Claude attend le retour de Machi Tool
      locaux.forEach(garderResultat);
      return { texte: texteDe(r), outils: distants, suite: suitePropre(messages), detail: details.join('\n\n'),
               consultations, model: r.model ?? JARVIS_MODELE, usage };
    }
    messages = [...messages, { role: 'user', content: resultatsEnBlocs(locaux) }];
    r = await appelJarvis(client, { system, messages, tools, web });
    const u = usageDe(r);
    for (const k of Object.keys(usage)) usage[k] += u[k] ?? 0;
    demandes = r.stop_reason === 'tool_use' ? outilsDemandes(r) : [];
  }
  demandes = demandes.filter(d => !OUTILS_LOCAUX.has(d.nom));
  if ((outils || memoire) && demandes.length) {
    return { texte: texteDe(r), outils: demandes, suite: suitePropre([...messages, { role: 'assistant', content: r.content }]),
             ...(details.length ? { detail: details.join('\n\n') } : {}), consultations, model: r.model ?? JARVIS_MODELE, usage };
  }
  let dit = texteDe(r);
  if (r.stop_reason === 'refusal' || !dit) {
    dit = langue === 'en' ? 'I\'m afraid I can\'t help with that one.'
                          : 'Je crains de ne pas pouvoir vous aider sur ce point.';
  }
  return { texte: dit, ...(details.length ? { detail: details.join('\n\n') } : {}),
           consultations, model: r.model ?? JARVIS_MODELE, usage };
}

/**
 * « AU REVOIR » AU PSYCHOLOGUE. Demandé : « il repasse en mode Jarvis de base,
 * il peut ne pas parler si la discussion était intense, il peut aussi rebondir
 * sur un sujet de manière humoristique mais pas lourde ».
 *
 * Le majordome voit la séance (elle est déjà dans le journal : Machi Tool ne la
 * garde qu'en mémoire, le temps qu'elle dure) et choisit entre le SILENCE et
 * UNE phrase légère. Dans le doute, le silence. Et un message grave dans la
 * séance, c'est le silence sans même lui demander — voir `repondreJarvis`.
 */
export const SILENCE = 'SILENCE';

export function consigneRetour(langue = 'en') {
  if (langue === 'en') {
    return [
      'THE PERSON HAS JUST SAID GOODBYE TO THERAPIST MODE (the companion of their journal) and is back '
      + 'with you. You are shown that conversation for context only: never quote it, summarise it, '
      + 'analyse it or give advice about it.',
      'Choose one of two things:',
      `- if that conversation was emotionally heavy, intense or painful, or touched on anything serious `
      + `(grief, fear, shame, health, a crisis), reply with exactly: ${SILENCE}`,
      '- otherwise, you may welcome them back in ONE short sentence, and you may bounce off a light '
      + 'topic from that conversation with gentle, dry humour — never heavy, never mocking, never about '
      + 'their feelings or their difficulties.',
      `When in doubt: ${SILENCE}.`
    ].join('\n');
  }
  return [
    'LA PERSONNE VIENT DE DIRE AU REVOIR AU MODE PSYCHOLOGUE (le compagnon de son journal) et revient '
    + 'vers toi. Tu vois cette conversation pour le contexte seulement : ne la cite pas, ne la résume '
    + 'pas, ne l\'analyse pas, ne donne aucun conseil à son sujet.',
    'Choisis entre deux choses :',
    `- si cette conversation était lourde, intense ou douloureuse, ou touchait à quelque chose de grave `
    + `(deuil, peur, honte, santé, une crise), réponds exactement : ${SILENCE}`,
    '- sinon, tu peux l\'accueillir en UNE phrase courte, et rebondir sur un sujet léger de cette '
    + 'conversation avec un humour doux et pince-sans-rire — jamais lourd, jamais moqueur, jamais sur '
    + 'ses émotions ou ses difficultés.',
    `Dans le doute : ${SILENCE}.`
  ].join('\n');
}

export async function retourDuPsy(client, { psy = [], langue = 'en', appellation = '', maintenant = '' }) {
  const seance = historiquePropre(psy);
  if (!seance.length) return { texte: '', usage: null };
  const qui = langue === 'en' ? { user: 'Person', assistant: 'Companion' } : { user: 'La personne', assistant: 'Le compagnon' };
  const transcription = seance.map(m => `${qui[m.role]}: ${m.content}`).join('\n');
  const r = await client.messages.create({
    model: JARVIS_MODELE,
    max_tokens: 120,
    system: consigneJarvis({ appellation, maintenant, langue, web: false }) + '\n\n' + consigneRetour(langue),
    messages: [{ role: 'user', content: (langue === 'en'
      ? `[The conversation with the companion, for context only]\n${transcription}\n\n[They just said goodbye to it.]`
      : `[La conversation avec le compagnon, pour le contexte seulement]\n${transcription}\n\n[Elle vient de lui dire au revoir.]`) }],
    ...optionsDuModele(JARVIS_MODELE, { effort: JARVIS_EFFORT, pense: false, repli: false })
  });
  let dit = texteDe(r);
  // Le silence, ou tout ce qui y ressemble : un refus, rien, le mot lui-même.
  if (r.stop_reason === 'refusal' || !dit || dit.toUpperCase().includes(SILENCE)) dit = '';
  return { texte: dit, model: r.model ?? JARVIS_MODELE, usage: usageDe(r) };
}

/**
 * SES SOUVENIRS. « Il faut que Jarvis se souvienne des anciennes discussions,
 * mais simplement. » À la fin d'une conversation en mode Jarvis, Machi Tool
 * demande ici UNE phrase qui la résume, et la garde sur le PC ; les dernières
 * reviennent avec chaque question (`souvenirs`). Rien si c'était une commande
 * ou un bonjour, rien sur la santé ni l'intime, et rien du tout si un message
 * grave y est passé : on ne le décide même pas au modèle.
 */
export const RIEN = 'RIEN';

export async function resumerConversation(client, { historique = [], langue = 'fr' }) {
  const conv = historiquePropre(historique);
  if (!conv.some(h => h.role === 'user')) return { texte: '', usage: null };
  if (conv.some(h => h.role === 'user' && messageGrave(h.content))) return { texte: '', usage: null, raison: 'grave' };
  const qui = langue === 'en' ? { user: 'Person', assistant: 'Jarvis' } : { user: 'La personne', assistant: 'Jarvis' };
  const r = await (await client()).messages.create({
    model: JARVIS_MODELE,
    max_tokens: 100,
    system: langue === 'en'
      ? 'Summarise this conversation with JARVIS in ONE short factual sentence, so he can remember it later: '
        + 'the topic, and what was done or decided. Never health, feelings or anything intimate. If nothing '
        + `is worth remembering (a command, a greeting, small talk), reply exactly: ${RIEN}`
      : 'Résume cette conversation avec JARVIS en UNE phrase courte et factuelle, pour qu\'il s\'en souvienne '
        + 'plus tard : le sujet, et ce qui a été fait ou décidé. Jamais la santé, les émotions ni l\'intime. Si '
        + `rien ne vaut d'être retenu (une commande, un bonjour, du bavardage), réponds exactement : ${RIEN}`,
    messages: [{ role: 'user', content: conv.map(m => `${qui[m.role]}: ${m.content}`).join('\n') }],
    ...optionsDuModele(JARVIS_MODELE, { effort: JARVIS_EFFORT, pense: false, repli: false })
  });
  let dit = texteDe(r).replace(/\s+/g, ' ').trim().slice(0, 200);
  // RIEN, dit seul (un « il n'a rien trouvé » est un vrai résumé).
  if (r.stop_reason === 'refusal' || !dit || dit.replace(/[^a-z]/gi, '').toUpperCase() === RIEN) dit = '';
  return { texte: dit, model: r.model ?? JARVIS_MODELE, usage: usageDe(r) };
}

/** L'heure de la personne, en toutes lettres, dans sa zone — et dans sa langue. */
export function maintenantDans(zone, date = new Date(), langue = 'fr') {
  try {
    return new Intl.DateTimeFormat(langue === 'en' ? 'en-GB' : 'fr-FR', { timeZone: zone, weekday: 'long',
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
  } catch { return ''; }
}

/**
 * UNE NOTE POUR LE PSYCHOLOGUE, SI ON LE DEMANDE. D'abord automatique, puis :
 * « oublie les notes, c'est utile uniquement lorsque c'est explicitement
 * demandé ». Les `ecrire_note` du dernier tour marquées `pour_le_psy: true`
 * que Machi Tool a réussies vont au carnet (`carnet(texte)`), et le résultat
 * le dit à Jarvis. Rend les résultats, complétés.
 */
export function deposerNotes(suite, resultats, carnet) {
  if (!carnet || !Array.isArray(resultats)) return resultats;
  const derniere = [...(Array.isArray(suite) ? suite : [])].reverse().find(m => m?.role === 'assistant');
  const notes = new Map((Array.isArray(derniere?.content) ? derniere.content : [])
    .filter(b => b?.type === 'tool_use' && b.name === 'ecrire_note' && b.input?.pour_le_psy === true)
    .map(b => [b.id, String(b.input?.texte ?? '').trim()]));
  return resultats.map(r => {
    if (!r || r.erreur || !notes.has(r.id) || !notes.get(r.id)) return r;
    let dit;
    try {
      const d = carnet(notes.get(r.id));
      dit = d?.erreur ? ` — mais le carnet du psychologue l'a refusée (${d.erreur}).`
                      : ' — et déposée dans le carnet du psychologue.';
    } catch (err) {
      dit = ' — mais le carnet du psychologue n\'a pas pu la prendre.';
    }
    return { ...r, texte: String(r.texte ?? 'Note écrite.') + dit };
  });
}

/**
 * LA ROUTE, SANS LE RÉSEAU. `versLeCompagnon(texte)` rend la réponse du
 * compagnon (le chemin de `POST /api/message`) ; `client()` rend un client
 * Anthropic ; `noter(usage, model)` relève la dépense.
 *
 * Rend { texte, mode: 'jarvis' | 'psy' }.
 */
export async function repondreJarvis({ texte, historique = [], appellation = '', maintenant = '',
                                       langue = 'fr', transition = '', psy = [],
                                       outils = false, ecran = false, suite = null, resultats = null,
                                       navigation = false, memoire = false, preferences = [], spotify = false,
                                       onglets = false, fenetreAgenda = false, souvenirs = [], onglets_ouverts = '' },
                                     { client, versLeCompagnon, noter = () => {}, carnet = null, agenda = null }) {
  const L = langue === 'en' ? 'en' : 'fr';
  if (transition === 'resume') {
    const r = await resumerConversation(client, { historique, langue: L });
    if (r.usage) noter(r.usage, r.model);
    return { texte: r.texte, mode: 'jarvis' };
  }
  if (transition === 'fin_psy') {
    // Un message grave dans la séance : le silence, sans rien demander à
    // personne. On ne plaisante pas au sortir de ça, et on ne tente pas le sort.
    const seance = historiquePropre(psy);
    if (seance.some(h => h.role === 'user' && messageGrave(h.content))) {
      return { texte: '', mode: 'jarvis', raison: 'grave' };
    }
    if (!seance.length) return { texte: '', mode: 'jarvis' };
    const r = await retourDuPsy(await client(), { psy, langue: L, appellation, maintenant });
    if (r.usage) noter(r.usage, r.model);
    return { texte: r.texte, mode: 'jarvis' };
  }
  if (suite) {
    // LES NOTES POUR LE PSYCHOLOGUE : une fois que Machi Tool a bien écrit la
    // note (pas d'erreur), elle entre aussi au carnet du journal — sauf une
    // liste de courses ou une petite note pratique (`pour_le_psy: false`).
    resultats = deposerNotes(suite, resultats, carnet);
    // La phrase a déjà passé la porte du grave au premier tour ; ce qui revient
    // ici, c'est ce que les outils ont fait.
    const r = await demanderAJarvis(await client(), { appellation, maintenant, langue: L, outils: !!outils,
                                                      ecran: !!(outils && ecran), navigation: !!(outils && navigation),
                                                      memoire: !!memoire, preferences, spotify: !!(outils && spotify),
                                                      onglets: !!(outils && onglets), fenetreAgenda: !!(outils && fenetreAgenda),
                                                      agenda,
                                                      souvenirs,
                                                      suite, resultats });
    noter(r.usage, r.model);
    for (const c of r.consultations ?? []) noter(c.usage, c.model);
    return { texte: r.texte, mode: 'jarvis', ...(r.detail ? { detail: r.detail } : {}),
             ...(r.outils ? { outils: r.outils, suite: r.suite } : {}) };
  }
  const t = String(texte ?? '').trim().slice(0, 4000);
  if (!t) throw Object.assign(new Error('texte vide'), { statut: 400 });
  if (pourLeCompagnon(t, historique)) {
    return { texte: await versLeCompagnon(t), mode: 'psy', raison: 'grave' };
  }
  const r = await demanderAJarvis(await client(), { texte: t, historique, appellation, maintenant, langue: L,
                                                    outils: !!outils, ecran: !!(outils && ecran),
                                                    navigation: !!(outils && navigation), memoire: !!memoire, preferences,
                                                    spotify: !!(outils && spotify), onglets: !!(outils && onglets),
                                                    fenetreAgenda: !!(outils && fenetreAgenda), agenda, souvenirs, ouverts: String(onglets_ouverts ?? '').slice(0, 3000) });
  noter(r.usage, r.model);
  for (const c of r.consultations ?? []) noter(c.usage, c.model);
  return { texte: r.texte, mode: 'jarvis', ...(r.detail ? { detail: r.detail } : {}),
           ...(r.outils ? { outils: r.outils, suite: r.suite } : {}) };
}
