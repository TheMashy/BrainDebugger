/**
 * LA MÉMOIRE DES CONVERSATIONS DE JARVIS.
 *
 * « Fais en sorte que Jarvis se souvienne beaucoup mieux des conversations
 * passées, en gardant plus de détail de la discussion, pouvant reprendre un fil
 * de discussion s'il est éteint ou interrompu ; si l'utilisateur demande « on
 * parlait de quoi ce matin », il pourra répondre précisément. »
 *
 * Chaque échange avec Jarvis est déjà versé dans le fil, mot pour mot, avec son
 * heure (POST /api/machitool/journal). C'est la source : pas un résumé, pas une
 * copie de plus sur le PC. Deux usages :
 *   - le FIL RÉCENT, les dernières heures, joint à chaque question : éteint,
 *     relancé, interrompu, il sait où vous en étiez ;
 *   - l'outil `conversations_passees`, pour relire un jour précis ou chercher
 *     un mot : « ce matin », « hier soir », « ce que tu m'as dit sur le garage ».
 */
import { echangesJarvis } from './db.js';
import { RECHERCHE_JOURS, FIL_RECENT_H } from './jarvis-outils.js';

export { OUTIL_CONVERSATIONS, consigneFilRecent } from './jarvis-outils.js';

export const FIL_RECENT_MAX = 6000;       // signes, au plus
export const RELECTURE_MAX = 14000;       // ce que l'outil rend, au plus
export const ECHANGE_MAX = 800;           // un tour de parole, dans un relevé

function heure(ts, zone, langue) {
  try {
    return new Intl.DateTimeFormat(langue === 'en' ? 'en-GB' : 'fr-FR',
      { timeZone: zone, hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
  } catch { return String(ts).slice(11, 16); }
}

/**
 * Des lignes « [jj/mm ]HH:MM Toi : … » / « Jarvis : … ». Au-delà de `max`,
 * on garde la FIN (le plus récent) et on le dit.
 */
export function echangesEnTexte(rows, { zone = 'UTC', langue = 'fr', max = RELECTURE_MAX, avecDate = false } = {}) {
  const qui = langue === 'en' ? { user: 'Them', pet: 'You' } : { user: 'La personne', pet: 'Toi' };
  const lignes = rows.map(r => {
    const d = avecDate ? `${r.date.slice(8, 10)}/${r.date.slice(5, 7)} ` : '';
    const t = String(r.text ?? '').replace(/\s+/g, ' ').trim();
    const court = t.length > ECHANGE_MAX ? t.slice(0, ECHANGE_MAX) + '…' : t;
    return `${d}${heure(r.ts, zone, langue)} ${qui[r.role] ?? qui.user} : ${court}`;
  });
  const garde = [];
  let n = 0;
  for (let i = lignes.length - 1; i >= 0; i--) {
    if (n + lignes[i].length + 1 > max) {
      garde.unshift(langue === 'en' ? '(earlier exchanges cut)' : '(échanges plus anciens coupés)');
      break;
    }
    garde.unshift(lignes[i]);
    n += lignes[i].length + 1;
  }
  return garde.join('\n');
}

/** L'outil : un jour, ou une recherche. Rend du texte pour le modèle. */
export function lireConversations({ jour, recherche } = {}, { userId, zone, langue = 'fr', jourDefaut,
                                                             maintenant = new Date() } = {}) {
  const mot = String(recherche ?? '').trim().slice(0, 80);
  if (mot) {
    const depuisJour = new Date(maintenant.getTime() - RECHERCHE_JOURS * 864e5).toISOString().slice(0, 10);
    const rows = echangesJarvis({ recherche: mot, depuisJour, limite: 60 }, userId);
    if (!rows.length) {
      return langue === 'en' ? `Nothing about « ${mot} » in your conversations of the last ${RECHERCHE_JOURS} days.`
        : `Rien sur « ${mot} » dans vos conversations des ${RECHERCHE_JOURS} derniers jours.`;
    }
    return echangesEnTexte(rows, { zone, langue, avecDate: true });
  }
  const j = /^\d{4}-\d{2}-\d{2}$/.test(String(jour ?? '').trim()) ? String(jour).trim() : jourDefaut();
  const rows = echangesJarvis({ jour: j, limite: 400 }, userId);
  if (!rows.length) {
    return langue === 'en' ? `No conversation with you on ${j}.` : `Aucune conversation avec toi le ${j}.`;
  }
  return `${j}\n` + echangesEnTexte(rows, { zone, langue });
}

/** Les dernières heures, pour la consigne. Vide s'il n'y a rien. */
export function filRecent({ userId, zone, langue = 'fr', maintenant = new Date() } = {}) {
  const depuis = new Date(maintenant.getTime() - FIL_RECENT_H * 3600e3).toISOString();
  const rows = echangesJarvis({ depuis, limite: 80 }, userId);
  return rows.length ? echangesEnTexte(rows, { zone, langue, max: FIL_RECENT_MAX }) : '';
}
