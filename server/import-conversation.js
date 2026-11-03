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
import { db, OWNER, rebuildEntryText } from './db.js';
import { jourLocal, heureLocale, zoneCourante } from './temps.js';

/** Un PDF de plus n'est plus une conversation, c'est une archive. */
export const PDF_OCTETS_MAX = 8 * 1024 * 1024;
export const TEXTE_MAX = 400_000;
export const MESSAGE_MAX = 12_000;

export const OUTIL_TRANSCRIPTION = {
  name: 'transcrire_conversation',
  description: 'Rend la conversation du document, message par message, dans l’ordre.',
  input_schema: {
    type: 'object',
    properties: {
      plateforme: { type: 'string', description: 'D’où vient la conversation : « Discord », « Claude », « WhatsApp », « Messenger »… ou « une conversation » si rien ne le dit.' },
      titre: { type: 'string', description: 'Le nom du salon, du fil ou de la conversation s’il est écrit, sinon vide.' },
      participants: {
        type: 'array',
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
        items: {
          type: 'object',
          properties: {
            auteur: { type: 'string', description: 'Exactement un des noms de `participants`.' },
            date: { type: 'string', description: 'AAAA-MM-JJ si une date complète est écrite pour ce message ou son groupe. Vide sinon.' },
            jour_relatif: { type: 'integer', description: '0 pour « Aujourd’hui », -1 pour « Hier », -2 pour « avant-hier ». Absent sinon.' },
            heure: { type: 'string', description: 'HH:MM (24 h) si une heure est écrite pour ce message ou son groupe. Vide sinon.' },
            texte: { type: 'string', description: 'Le texte du message, mot pour mot.' }
          },
          required: ['auteur', 'texte']
        }
      }
    },
    required: ['plateforme', 'participants', 'messages']
  }
};

export const CONSIGNE = `Tu transcris une conversation contenue dans un document (un salon Discord imprimé, une conversation avec Claude ou un autre modèle exportée, une messagerie). Tu ne la résumes pas, tu ne la commentes pas : tu la recopies.

Règles :
- Un élément de « messages » par message, dans l'ordre du document. Sur Discord, plusieurs messages groupés sous un seul nom et une seule heure restent des messages distincts : chacun reprend l'auteur, et l'heure du groupe.
- Le texte MOT POUR MOT, fautes comprises. Garde les retours à la ligne entre paragraphes. Ne traduis rien.
- Laisse de côté l'interface : boutons, « (modifié) », compteurs de réactions, noms de salons répétés en en-tête de page, numéros de page, pieds de page d'impression, URL d'impression, horodatages d'impression du PDF lui-même.
- Une pièce jointe ou une image : écris « [image] » ou « [pièce jointe : nom] » à sa place.
- La date : si une date complète est écrite (séparateur « 12 mars 2025 », « 12/03/2025 », en-tête de groupe), mets-la en AAAA-MM-JJ sur ce message ET sur les suivants jusqu'à la prochaine. Si c'est « Aujourd'hui » ou « Hier », mets jour_relatif (0 ou -1) au lieu de date. Si rien n'est écrit, laisse vide : ne devine jamais une date.
- L'heure : HH:MM en 24 h si elle est écrite (« 21:04 », « 9:04 PM » → « 21:04 »). Si rien n'est écrit, laisse vide.
- Les noms des auteurs tels qu'affichés. Dans une conversation avec Claude ou un autre modèle, la personne est souvent étiquetée « Vous », « You », « Moi » ou par son initiale : garde l'étiquette telle quelle ; le modèle s'appelle « Claude » (ou son nom affiché).
- Marque est_un_modele pour Claude, ChatGPT et les bots.`;

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
      { type: 'text', text: demande.consigne + 'Transcris cette conversation avec l’outil transcrire_conversation.' }
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
  const noms = new Map();
  for (const p of Array.isArray(brut?.participants) ? brut.participants : []) {
    const nom = String(p?.nom ?? '').trim().slice(0, 60);
    if (nom && !noms.has(nom)) noms.set(nom, { nom, est_un_modele: !!p?.est_un_modele });
  }
  const messages = [];
  for (const m of Array.isArray(brut?.messages) ? brut.messages : []) {
    const texte = String(m?.texte ?? '').trim().slice(0, MESSAGE_MAX);
    const auteur = String(m?.auteur ?? '').trim().slice(0, 60);
    if (!texte || !auteur) continue;
    if (!noms.has(auteur)) noms.set(auteur, { nom: auteur, est_un_modele: false });
    const date = DATE_RE.test(String(m?.date ?? '')) && Number.isFinite(Date.parse(m.date)) ? m.date : null;
    const rel = Number.isInteger(m?.jour_relatif) && m.jour_relatif <= 0 && m.jour_relatif >= -7 ? m.jour_relatif : null;
    const h = HEURE_RE.exec(String(m?.heure ?? '').trim());
    messages.push({ auteur, texte, date, jour_relatif: date ? null : rel,
                    heure: h ? `${h[1].padStart(2, '0')}:${h[2]}` : null });
  }
  return {
    plateforme: String(brut?.plateforme ?? '').trim().slice(0, 40) || 'une conversation',
    titre: String(brut?.titre ?? '').trim().slice(0, 80),
    participants: [...noms.values()].map(p => ({ ...p, n: messages.filter(m => m.auteur === p.nom).length })),
    messages
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
  let date = null, heure = null, dernierTs = null;
  const out = [];
  for (const m of transcription.messages) {
    let dateConnue = true;
    if (m.date) date = m.date;
    else if (m.jour_relatif != null) date = ajouterJours(reference, m.jour_relatif);
    else if (!date) { date = reference; dateConnue = false; }
    const heureConnue = !!m.heure;
    if (m.heure) heure = m.heure;
    let ts = Date.parse(instantLocal(date, heure ?? '12:00', zone));
    if (!heureConnue && dernierTs != null && m.date == null && m.jour_relatif == null) ts = dernierTs + 60_000;
    // L'ordre du document prime : jamais avant le message précédent du même jour.
    if (dernierTs != null && ts <= dernierTs && ts > dernierTs - 6 * 3600_000) ts = dernierTs + 1000;
    dernierTs = ts;
    const iso = new Date(ts).toISOString();
    const deMoi = m.auteur === moi;
    out.push({
      ts: iso,
      date: (jourDe ? jourDe(iso) : null) ?? jourLocal(iso, zone),
      role: deMoi ? 'user' : 'pet',
      text: m.texte,
      // La bulle dit d'où ça vient ; pour les autres, QUI parlait.
      via: (deMoi ? plateforme : `${plateforme} · ${m.auteur}`).slice(0, 60),
      auteur: m.auteur, heureConnue, dateConnue
    });
  }
  return out;
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
export function ecrireMessages(places, userId = OWNER) {
  const jours = new Set();
  let n = 0;
  db.exec('BEGIN');
  try {
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
  return { poses: n, jours: [...jours].sort() };
}

/** L'aperçu : ce que la personne doit voir avant de dire oui. */
export function apercu(transcription, places) {
  const a_poser = places.filter(p => !p.doublon);
  const dates = places.map(p => p.date).sort();
  return {
    plateforme: transcription.plateforme,
    titre: transcription.titre,
    participants: transcription.participants,
    total: places.length,
    doublons: places.length - a_poser.length,
    sansHeure: places.filter(p => !p.heureConnue).length,
    sansDate: places.filter(p => !p.dateConnue).length,
    du: dates[0] ?? null, au: dates.at(-1) ?? null,
    jours: new Set(a_poser.filter(p => p.role === 'user').map(p => p.date)).size,
    extrait: places.slice(0, 40).map(p => ({ ts: p.ts, date: p.date, auteur: p.auteur, role: p.role,
                                              text: p.text.slice(0, 220), doublon: p.doublon }))
  };
}

