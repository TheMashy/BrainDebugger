/**
 * RELIRE LES PASSAGES SIGNALÉS, EN LOT, EN FOND.
 *
 * Demandé ainsi : « execute le en fond ». C'est aussi la seule forme
 * raisonnable — un journal de plusieurs années porte des centaines de
 * passages signalés, et les juger l'un après l'autre à l'ouverture d'une page
 * ferait attendre quelqu'un devant un écran vide pour un travail dont il n'a
 * pas besoin tout de suite.
 *
 * L'API de lots rend deux choses ici : l'asynchrone, et MOITIÉ PRIX. Une
 * question courte posée trois cents fois est exactement ce pour quoi elle
 * existe.
 *
 * ON NE JUGE JAMAIS DEUX FOIS LE MÊME PASSAGE. Un verdict est payé ; il ne
 * changera pas tant que le passage ne change pas. `passagesSansVerdict` ne
 * retient donc que ce qui n'a pas encore été lu.
 */
import { OWNER, messagesForDate, verdictsEntre, poserVerdict } from './db.js';
import { niveauDuTexte } from './veille.js';
import { clientDe } from './lecture.js';
import { passagesDuJour, requeteJugement, cleLot, lireCleLot, lireVerdict } from './juge-veille.js';

/** Un lot ne part jamais à plus de ça : au-delà, on en repose un après. */
export const MAX_PAR_LOT = 400;

/**
 * Les passages d'une période qui n'ont pas encore de verdict.
 * @returns {Array<{passage, genre}>} un par COUPLE passage/genre.
 */
export function passagesSansVerdict(dates, userId = OWNER, {
  lireMessages = messagesForDate, lireNiveau = niveauDuTexte, lireVerdicts = verdictsEntre
} = {}) {
  if (!dates.length) return [];
  const deja = lireVerdicts(dates[0], dates[dates.length - 1], userId) ?? new Map();
  const out = [];
  for (const d of dates) {
    for (const p of passagesDuJour(d, lireMessages(d, userId), lireNiveau)) {
      const vus = deja.get(p.messageId) ?? null;
      for (const mo of p.motifs ?? []) {
        if (vus?.get?.(mo.genre)) continue;
        out.push({ passage: p, genre: mo.genre });
        if (out.length >= MAX_PAR_LOT) return out;
      }
    }
  }
  return out;
}

/** Pose le lot. Rend son identifiant et combien de passages il porte. */
export async function lancerLotVeille(aJuger, settings) {
  if (!aJuger.length) return { id: null, n: 0 };
  const client = await clientDe(settings);
  const lot = await client.messages.batches.create({
    requests: aJuger.map(({ passage, genre }) => ({
      custom_id: cleLot(passage.messageId, genre),
      params: requeteJugement(passage, settings)
    }))
  });
  return { id: lot.id, n: aJuger.length, etat: lot.processing_status };
}

/**
 * Va voir si le lot est prêt, et range ce qu'il rend.
 *
 * UNE RÉPONSE ILLISIBLE EST UNE RÉPONSE ABSENTE, et c'est volontaire : un
 * verdict qu'on n'a pas compris ne doit pas retirer un signe. Le passage
 * repartira dans un prochain lot, ou restera signalé — les deux sont sans
 * danger, contrairement à un effacement sur une réponse mal lue.
 *
 * @returns {{pret:false,etat:string}|{pret:true,poses:number,illisibles:number}}
 */
export async function releverLotVeille(id, settings, {
  userId = OWNER, dates = new Map(), poser = poserVerdict
} = {}) {
  const client = await clientDe(settings);
  let lot;
  try {
    lot = await client.messages.batches.retrieve(id);
  } catch (err) {
    if (err?.status === 404) { const e = new Error("le lot n'existe plus"); e.lotFini = true; throw e; }
    throw err;
  }
  if (lot.processing_status !== 'ended') return { pret: false, etat: lot.processing_status };

  let poses = 0, illisibles = 0;
  for await (const r of await client.messages.batches.results(id)) {
    const cle = lireCleLot(r.custom_id);
    if (!cle || r.result?.type !== 'succeeded') { illisibles++; continue; }
    const appel = (r.result.message?.content ?? []).find(b => b.type === 'tool_use');
    const v = lireVerdict(appel?.input);
    if (!v) { illisibles++; continue; }
    poser({
      messageId: cle.messageId, genre: cle.genre,
      date: dates.get(cle.messageId) ?? r.result.message?.date ?? '',
      verdict: v.verdict, certitude: v.certitude, cite: v.cite, pourquoi: v.pourquoi,
      modele: r.result.message?.model ?? null, userId
    });
    poses++;
  }
  return { pret: true, poses, illisibles };
}
