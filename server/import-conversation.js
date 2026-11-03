/**
 * UNE CONVERSATION TENUE AILLEURS, RAPPORTÉE DANS « PARLER ».
 *
 * Un PDF (ou un texte) — un salon Discord imprimé, une conversation Claude
 * exportée — et on veut que ce qui s'y est dit retrouve sa place dans le fil :
 * le bon jour, la bonne heure, la bonne personne. C'est la version « en gros »
 * de `verserEchange` (connecteur.js) : même marque `via`, même règle — ses
 * phrases à elle sont SES mots et comptent dans sa journée ; celles des autres
 * restent des bulles venues d'ailleurs, jamais confondues avec le compagnon.
 *
 * LE MODÈLE LIT, LE SERVEUR PLACE. Lire un PDF de Discord — pseudos, « Hier à
 * 21:04 », messages groupés sous un seul horodatage, réactions, pièces jointes
 * — n'a pas de règle qu'on puisse écrire. Le modèle rend donc une TRANSCRIPTION
 * (auteur, date telle qu'écrite, heure telle qu'écrite, texte mot pour mot), et
 * tout ce qui est calcul se fait ici : résoudre « hier », reporter une date sur
 * les messages qui suivent, convertir l'heure locale en instant, choisir la
 * journée vécue, écarter les doublons. Un modèle qui calcule une date se trompe
 * en silence ; une fonction qui la calcule a un test.
 *
 * RIEN N'EST ÉCRIT SANS APERÇU. Comme l'import de notes : on lit, on montre
 * (qui parle, combien, de quand à quand, ce qui sera sauté), la personne dit
 * qui elle est, et seulement ensuite on écrit.
 */
import { db, OWNER, rebuildEntryText, addCarnet } from './db.js';
import { jourLocal, heureLocale, zoneCourante } from './temps.js';

/** Un PDF de plus n'est plus une conversation, c'est une archive. */
export const PDF_OCTETS_MAX = 8 * 1024 * 1024;
export const TEXTE_MAX = 400_000;
export const MESSAGE_MAX = 12_000;

export const OUTIL_TRANSCRIPTION = {
  name: 'transcrire_conversation',
  description: 'Rend le document : soit les messages d’une conversation, soit les journées d’un journal, dans l’ordre.',
  input_schema: {
    type: 'object',
    properties: {
      genre: { type: 'string', enum: ['conversation', 'journal'],
               description: '« conversation » : des messages entre plusieurs auteurs (Discord, Claude, une messagerie). « journal » : ce qu’une seule personne a écrit ou fait résumer, rangé par journées (un journal, un résumé jour par jour, des notes datées).' },
      plateforme: { type: 'string', description: 'D’où vient le document : « Discord », « Claude », « WhatsApp »… ; pour un journal, ce qu’il est en deux ou trois mots (« résumé », « journal », « notes de séance »).' },
      titre: { type: 'string', description: 'Le titre du document, du salon ou de la conversation s’il est écrit, sinon vide.' },
      annee: { type: 'integer', description: 'L’année du document si elle est écrite quelque part (titre, une date complète). Sert aux dates écrites sans année.' },
      participants: {
        type: 'array',
        description: 'Conversation : les auteurs. Journal : un seul, « moi ».',
        items: {
          type: 'object',
          properties: {
            nom: { type: 'string' },
            est_un_modele: { type: 'boolean', description: 'Vrai pour Claude, ChatGPT, un bot.' }
          },
          required: ['nom']
        }
      },
      messages: {
        type: 'array',
        description: 'Conversation : un élément par message. Journal : un élément par JOURNÉE (ou par plage de journées).',
        items: {
          type: 'object',
          properties: {
            auteur: { type: 'string', description: 'Exactement un des noms de `participants`. Journal : « moi ».' },
            date: { type: 'string', description: 'AAAA-MM-JJ quand une date est écrite pour ce message, son groupe ou cette journée — année déduite du document si elle manque. Vide sinon.' },
            date_fin: { type: 'string', description: 'Journal seulement : AAAA-MM-JJ du dernier jour quand la section couvre une plage (« Du 27/10 au 30/10 »).' },
            jour_relatif: { type: 'integer', description: '0 pour « Aujourd’hui », -1 pour « Hier », -2 pour « avant-hier ». Absent sinon.' },
            heure: { type: 'string', description: 'HH:MM (24 h) si une heure est écrite pour ce message ou son groupe. Vide sinon.' },
            texte: { type: 'string', description: 'Le texte, mot pour mot.' }
          },
          required: ['auteur', 'texte']
        }
      },
      hors_jours: {
        type: 'array',
        description: 'Journal seulement : les parties qui ne sont rattachées à AUCUNE journée (synthèse, « l’essentiel », « ce que j’ai compris », conclusions sur toute la période).',
        items: {
          type: 'object',
          properties: { titre: { type: 'string' }, texte: { type: 'string' } },
          required: ['texte']
        }
      }
    },
    required: ['genre', 'plateforme', 'participants', 'messages']
  }
};

export const CONSIGNE = `Tu transcris un document pour le ranger dans le journal de la personne, chaque chose à son jour. Tu ne résumes pas, tu ne commentes pas : tu recopies, et tu dis à quel jour chaque morceau appartient.

D'abord, le GENRE du document :
- « conversation » : des messages échangés (un salon Discord imprimé, une conversation avec Claude ou un autre modèle exportée, une messagerie) ;
- « journal » : ce qu'une seule personne a écrit ou fait résumer, rangé par journées — un journal, un résumé « jour par jour », des notes datées, un compte rendu de période.

POUR UNE CONVERSATION
- Un élément de « messages » par message, dans l'ordre du document. Sur Discord, plusieurs messages groupés sous un seul nom et une seule heure restent des messages distincts : chacun reprend l'auteur, et l'heure du groupe.
- Laisse de côté l'interface : boutons, « (modifié) », compteurs de réactions, en-têtes de page répétés, numéros de page, pieds de page et horodatages d'impression.
- Une pièce jointe ou une image : « [image] » ou « [pièce jointe : nom] ».
- Les noms des auteurs tels qu'affichés. Dans une conversation avec un modèle, la personne est souvent « Vous », « You », « Moi » ou son initiale : garde l'étiquette ; le modèle s'appelle « Claude » (ou son nom affiché). Marque est_un_modele pour les modèles et les bots.
- La date se reporte : mets-la sur le message où elle est écrite ET sur les suivants jusqu'à la prochaine. « Aujourd'hui » / « Hier » → jour_relatif (0 / -1).
- L'heure en HH:MM 24 h si elle est écrite (« 9:04 PM » → « 21:04 »), vide sinon.

POUR UN JOURNAL
- Un seul participant, « moi ». Tous les éléments ont auteur « moi ».
- Un élément de « messages » par JOURNÉE : tout ce qui est rangé sous la date de ce jour (paragraphes, citations, notes de séance, encadrés), dans l'ordre, séparé par des lignes vides. Le titre de la section n'est pas recopié, sauf ce qu'il dit de plus que la date (« séance avec la psy » → commence le texte par « Séance avec la psy. »).
- Une section qui couvre une plage (« Du 27/10 au 30/10 ») : date = premier jour, date_fin = dernier.
- Les dates sans année (« 19/10 », « lundi 19 octobre ») prennent l'année du document (titre, autres dates) ; reporte-la dans « annee ».
- Les parties qui ne sont rattachées à aucune journée — « L'essentiel », une synthèse, « ce que j'ai compris », des conclusions sur toute la période — vont dans « hors_jours », PAS dans « messages », même si elles citent des dates : elles parlent de la période, pas d'un jour.
- L'heure seulement si elle est écrite pour la journée ; « le soir », « matin » ne sont pas des heures.

DANS LES DEUX CAS
- Le texte MOT POUR MOT, fautes et guillemets compris. Ne traduis rien, n'ajoute rien, ne corrige rien.
- Ne devine jamais une date qui n'est pas dans le document.`;

/* ============================== LIRE ============================== */

/**
 * Ce que le modèle reçoit : le PDF tel quel (l'API sait le lire, texte ET
 * mise en page — c'est la mise en page qui dit qui parle sur Discord), ou le
 * texte collé.
 */
export function contenuDuDocument({ pdf = null, texte = null }) {
  if (pdf) return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf } };
  return { type: 'text', text: `<document>\n${texte}\n</document>` };
}

/**
 * LIRE LE DOCUMENT. Rend la transcription brute de l'outil, validée.
 * `appeler` est injectable pour les tests : il reçoit la requête et rend la
 * réponse de l'API.
 */
export async function transcrire({ pdf = null, texte = null }, s, { client, demanderOutil, optionsDuModele }) {
  if (!pdf && !String(texte ?? '').trim()) throw new Error('Le document est vide.');
  const model = s.anthropicModel || 'claude-opus-5-5';
  const demande = demanderOutil(model, OUTIL_TRANSCRIPTION.name);
  const requete = {
    model,
    max_tokens: 64000,
    ...optionsDuModele(model, { effort: 'low', repli: false }),
    system: CONSIGNE,
    tools: [OUTIL_TRANSCRIPTION],
    tool_choice: demande.tool_choice,
    messages: [{ role: 'user', content: [
      contenuDuDocument({ pdf, texte }),
      { type: 'text', text: demande.consigne + 'Transcris ce document avec l’outil transcrire_conversation.' }
    ] }]
  };
  // En flux : une longue conversation se transcrit en plusieurs minutes, et
  // une requête non diffusée de cette taille se fait couper par le délai.
  const res = await client.messages.stream(requete).finalMessage();
  const appel = res.content?.find(b => b.type === 'tool_use');
  if (!appel) {
    throw new Error(res.stop_reason === 'max_tokens'
      ? 'La conversation est trop longue pour une seule lecture — coupe le PDF en plusieurs morceaux.'
      : 'Le modèle n’a rien transcrit.');
  }
  const u = res.usage ?? {};
  return {
    transcription: validerTranscription(appel.input),
    coupee: res.stop_reason === 'max_tokens',
    modele: res.model ?? model,
    usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0,
             cacheLu: u.cache_read_input_tokens ?? 0, cacheEcrit: u.cache_creation_input_tokens ?? 0 }
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEURE_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** Ce que le modèle rend n'est jamais pris au mot : formes vérifiées, le reste jeté. */
export function validerTranscription(brut) {
  const journal = brut?.genre === 'journal';
  const annee = Number.isInteger(brut?.annee) && brut.annee > 1990 && brut.annee < 2100 ? brut.annee : null;
  const noms = new Map();
  for (const p of Array.isArray(brut?.participants) ? brut.participants : []) {
    const nom = String(p?.nom ?? '').trim().slice(0, 60);
    if (nom && !noms.has(nom)) noms.set(nom, { nom, est_un_modele: !!p?.est_un_modele });
  }
  const dateOk = d => DATE_RE.test(String(d ?? '')) && Number.isFinite(Date.parse(d)) ? d : null;
  const horsJours = [];
  for (const h of Array.isArray(brut?.hors_jours) ? brut.hors_jours : []) {
    const texte = String(h?.texte ?? '').trim().slice(0, MESSAGE_MAX);
    if (texte) horsJours.push({ titre: String(h?.titre ?? '').trim().slice(0, 80), texte });
  }
  const messages = [];
  for (const m of Array.isArray(brut?.messages) ? brut.messages : []) {
    const texte = String(m?.texte ?? '').trim().slice(0, MESSAGE_MAX);
    const auteur = journal ? 'moi' : String(m?.auteur ?? '').trim().slice(0, 60);
    if (!texte || !auteur) continue;
    const date = dateOk(m?.date);
    const rel = Number.isInteger(m?.jour_relatif) && m.jour_relatif <= 0 && m.jour_relatif >= -7 ? m.jour_relatif : null;
    /* UN MORCEAU DE JOURNAL SANS DATE N'APPARTIENT À AUCUN JOUR. Le poser au
       jour de référence ferait écrire à la personne, ce jour-là, une synthèse
       de deux semaines : la carte compterait ses mots sur une journée qui ne
       les porte pas. Il rejoint le carnet, avec les autres parties hors jours. */
    if (journal && !date && rel == null) { horsJours.push({ titre: '', texte }); continue; }
    if (!noms.has(auteur)) noms.set(auteur, { nom: auteur, est_un_modele: false });
    const fin = journal ? dateOk(m?.date_fin) : null;
    const h = HEURE_RE.exec(String(m?.heure ?? '').trim());
    messages.push({ auteur, texte, date, jour_relatif: date ? null : rel,
                    date_fin: fin && date && fin > date ? fin : null,
                    heure: h ? `${h[1].padStart(2, '0')}:${h[2]}` : null });
  }
  if (journal) for (const k of [...noms.keys()]) if (k !== 'moi') noms.delete(k);
  return {
    genre: journal ? 'journal' : 'conversation',
    annee,
    plateforme: String(brut?.plateforme ?? '').trim().slice(0, 40) || (journal ? 'journal' : 'une conversation'),
    titre: String(brut?.titre ?? '').trim().slice(0, 80),
    participants: [...noms.values()].map(p => ({ ...p, n: messages.filter(m => m.auteur === p.nom).length })),
    messages,
    horsJours
  };
}

/**
 * QUI EST LA PERSONNE, PROPOSÉ — ELLE CONFIRME.
 * Une étiquette « Vous / You / Moi », sinon son pseudo, sinon le participant
 * humain qui parle le plus. Jamais un modèle.
 */
export function devinerMoi(participants, { pseudo = null } = {}) {
  const humains = participants.filter(p => !p.est_un_modele);
  const norme = x => String(x ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const etiquette = humains.find(p => /^(vous|you|moi|me|toi)$/.test(norme(p.nom)));
  if (etiquette) return etiquette.nom;
  if (pseudo) {
    const vu = humains.find(p => norme(p.nom) === norme(pseudo));
    if (vu) return vu.nom;
  }
  return [...humains].sort((a, b) => b.n - a.n)[0]?.nom ?? null;
}

/* ============================== PLACER ============================== */

const ajouterJours = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** « 2026-03-12 » et « 21:04 », heure LOCALE de la personne → instant ISO. */
export function instantLocal(date, heure, zone = zoneCourante()) {
  const voulu = Date.parse(`${date}T${heure}:00.000Z`);
  let ts = voulu;
  // Deux passes suffisent, y compris les jours de changement d'heure (même
  // méthode que `vingtEtUneHeures` dans import-notes.js).
  for (let i = 0; i < 2; i++) {
    const vu = Date.parse(`${jourLocal(ts, zone)}T${heureLocale(ts, zone)}:00.000Z`);
    if (!Number.isFinite(vu)) break;
    ts += voulu - vu;
  }
  return new Date(ts).toISOString();
}

/**
 * DE LA TRANSCRIPTION AUX MESSAGES DU FIL.
 *
 * - la date se reporte d'un message aux suivants, comme on lit un fil ;
 *   « hier » se résout sur `reference` (le jour de l'export, que la personne
 *   peut corriger dans l'aperçu) ; un fil sans aucune date prend `reference` ;
 * - un message sans heure prend celle du précédent, plus une minute — l'ordre
 *   du document est gardé, et rien n'est inventé au-delà ;
 * - deux messages à la même minute sont écartés d'une seconde, sinon le tri
 *   du fil les mélangerait ;
 * - la JOURNÉE est la journée vécue (`jourDe`, celui du reste de
 *   l'application) : un message de 1 h 56 appartient à la soirée de la veille.
 *
 * @returns {{ts, date, role, text, via, auteur, heureConnue, dateConnue}[]}
 */
export function placerMessages(transcription, { moi, reference, zone = zoneCourante(), jourDe = null }) {
  const plateforme = transcription.plateforme;
  const journal = transcription.genre === 'journal';
  /* Un journal sans heure se pose à 21 h, comme l'import de notes : ces
     journées ont été écrites le soir, et c'est l'ordre dans la journée qui
     compte, pas la minute. Midi aurait fait d'un bilan du soir un message de
     la pause déjeuner. */
  const HEURE_PAR_DEFAUT = journal ? '21:00' : '12:00';
  let date = null, heure = null, dernierTs = null;
  const out = [];
  for (const m of transcription.messages) {
    let dateConnue = true;
    const nouvelleDate = m.date ?? (m.jour_relatif != null ? ajouterJours(reference, m.jour_relatif) : null);
    if (nouvelleDate) {
      // UN NOUVEAU JOUR REMET L'HEURE À ZÉRO. Elle se reportait d'un jour au
      // suivant : un message daté du 20 sans heure héritait du 21:04 du 19.
      if (nouvelleDate !== date) heure = null;
      date = nouvelleDate;
    } else if (!date) { date = reference; dateConnue = false; }
    const heureConnue = !!m.heure;
    if (m.heure) heure = m.heure;
    let ts = Date.parse(instantLocal(date, heure ?? HEURE_PAR_DEFAUT, zone));
    // Sans heure dans le MÊME jour : une minute après le précédent.
    if (!heureConnue && !nouvelleDate && dernierTs != null) ts = dernierTs + 60_000;
    // L'ordre du document prime : jamais avant le message précédent du même jour.
    if (dernierTs != null && ts <= dernierTs && ts > dernierTs - 6 * 3600_000) ts = dernierTs + 1000;
    dernierTs = ts;
    const iso = new Date(ts).toISOString();
    const deMoi = m.auteur === moi;
    out.push({
      ts: iso,
      date: (jourDe ? jourDe(iso) : null) ?? jourLocal(iso, zone),
      role: deMoi ? 'user' : 'pet',
      // Une plage de jours garde sa plage écrite en tête : posée sur son
      // premier jour, elle doit dire qu'elle en couvre plusieurs.
      text: m.date_fin ? `(du ${m.date} au ${m.date_fin}) ${m.texte}` : m.texte,
      // La bulle dit d'où ça vient ; pour les autres, QUI parlait.
      via: (deMoi ? plateforme : `${plateforme} · ${m.auteur}`).slice(0, 60),
      auteur: m.auteur, heureConnue, dateConnue
    });
  }
  return out;
}

/**
 * LES PARTIES HORS JOURS, AU CARNET.
 *
 * « L'essentiel », « ce que j'ai compris » : une synthèse de la période. Ce
 * n'est la parole d'aucun jour, c'est ce qu'on a retenu — exactement ce que
 * le carnet range, et il ne transforme jamais une journée en journée écrite.
 * Pas de `jour` (elle ne parle pas d'un jour), mais sa période dans `quand`,
 * le champ fait pour les mots qui situent sans dater.
 */
export function notesHorsJours(transcription, places) {
  const dates = places.map(p => p.date).sort();
  const quand = dates.length ? (dates[0] === dates.at(-1) ? `le ${dates[0]}` : `du ${dates[0]} au ${dates.at(-1)}`) : null;
  return (transcription.horsJours ?? []).map(h => ({
    quand, titre: h.titre,
    texte: h.titre ? `${h.titre}\n\n${h.texte}` : h.texte
  }));
}

/* ============================== ÉCRIRE ============================== */

/** Déjà là : même journée, même rôle, même texte. Réimporter ne double rien. */
export function marquerDoublons(places, userId = OWNER) {
  const deja = db.prepare('SELECT 1 FROM messages WHERE user_id = ? AND date = ? AND role = ? AND TRIM(text) = ? LIMIT 1');
  const vus = new Set();
  return places.map(p => {
    const cle = `${p.date}|${p.role}|${p.text}`;
    const doublon = vus.has(cle) || !!deja.get(userId, p.date, p.role, p.text.trim());
    vus.add(cle);
    return { ...p, doublon };
  });
}

/** Écrit tout, ou rien. Rend le nombre posé et les journées touchées. */
export function ecrireMessages(places, userId = OWNER, notes = []) {
  const jours = new Set();
  let n = 0, rangees = 0;
  const dejaNote = db.prepare('SELECT 1 FROM carnet WHERE user_id = ? AND TRIM(texte) = ? LIMIT 1');
  db.exec('BEGIN');
  try {
    for (const no of notes) {
      if (dejaNote.get(userId, no.texte.trim())) continue;   // réimporter ne double pas
      addCarnet({ texte: no.texte, jour: null, quand: no.quand, source: 'import', userId });
      rangees++;
    }
    for (const p of places) {
      if (p.doublon) continue;
      // `addMessage` refait le texte de la journée à chaque message de la
      // personne ; on le fait une fois par journée, à la fin.
      db.prepare('INSERT INTO messages(user_id, ts, date, source, role, text, via) VALUES(?,?,?,?,?,?,?)')
        .run(userId, p.ts, p.date, 'import-conversation', p.role, p.text, p.via);
      if (p.role === 'user') jours.add(p.date);
      n++;
    }
    for (const j of jours) rebuildEntryText(j, userId);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { poses: n, rangees, jours: [...jours].sort() };
}

/** L'aperçu : ce que la personne doit voir avant de dire oui. */
export function apercu(transcription, places, notes = []) {
  const a_poser = places.filter(p => !p.doublon);
  const dates = places.map(p => p.date).sort();
  return {
    genre: transcription.genre ?? 'conversation',
    notes: notes.map(n => ({ titre: n.titre || n.texte.slice(0, 60), signes: n.texte.length, quand: n.quand })),
    relatifs: transcription.messages.some(m => m.jour_relatif != null),
    plateforme: transcription.plateforme,
    titre: transcription.titre,
    participants: transcription.participants,
    total: places.length,
    doublons: places.length - a_poser.length,
    sansHeure: places.filter(p => !p.heureConnue).length,
    sansDate: places.filter(p => !p.dateConnue).length,
    du: dates[0] ?? null, au: dates.at(-1) ?? null,
    jours: new Set(a_poser.filter(p => p.role === 'user').map(p => p.date)).size,
    extrait: places.slice(0, 60).map(p => ({ ts: p.ts, date: p.date, auteur: p.auteur, role: p.role,
                                              text: p.text.slice(0, 220), doublon: p.doublon,
                                              heureConnue: p.heureConnue }))
  };
}

