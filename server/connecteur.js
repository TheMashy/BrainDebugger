/**
 * =====================================================================
 *  LE CONNECTEUR — CE QU'UN AUTRE MODÈLE PEUT DÉPOSER ICI.
 *
 * Quelqu'un tient une conversation « PSY » ailleurs — sur Claude, sur ChatGPT,
 * sur ce qu'il veut. Ce qui s'y dit compte autant que ce qu'il écrit ici, et ça
 * n'entre nulle part : il faudrait le recopier à la main, donc ça ne se fait
 * pas, donc la carte est lue sur la moitié de ce qui a été dit.
 *
 * Ce fichier ouvre UNE porte, dans UN sens : un client MCP — n'importe lequel —
 * peut poser une note dans le carnet. Le reste du produit s'en occupe ensuite
 * tout seul : le carnet est déjà cherché par `lire_carnet`, déjà dans la
 * mémoire du compagnon, déjà compté dans le retard qui décide d'une nouvelle
 * lecture de la carte. Il n'y avait rien à construire en aval — seulement une
 * entrée.
 *
 * ---------------------------------------------------------------------
 * POURQUOI MCP, ET PAS UN BOUT DE CODE À NOUS.
 *
 * Parce que c'est un standard, et que le but est précisément de ne pas choisir
 * le modèle à la place de quelqu'un. Claude sait s'y connecter, ChatGPT aussi,
 * et ce qui viendra après. Un protocole maison aurait attaché ce journal à un
 * fournisseur, ce qui est l'inverse de ce qu'on veut.
 *
 * ET LE PROTOCOLE VIENT DU SDK OFFICIEL, pas de ma mémoire. Une poignée de main
 * JSON-RPC écrite au jugé marche sur l'exemple qu'on a testé et rate sur le
 * client qu'on n'a pas. Le SDK est optionnel : sans lui, la route répond ce
 * qu'il faut installer au lieu d'emporter le site.
 *
 * ---------------------------------------------------------------------
 * ÇA ÉCRIT, ÇA NE LIT PAS. C'est la décision du produit, pas une étape.
 *
 * Une deuxième porte qui RENDRAIT le journal enverrait le texte de quelqu'un au
 * serveur du modèle à qui il parle. Ça se défend — il parle déjà de sa vie dans
 * cette conversation — mais ce n'est pas la même décision, et elle doit être
 * prise pour elle-même, un jour où on la regarde. Tant qu'elle ne l'est pas,
 * il n'y a rien à lire ici : `tools/list` ne montre qu'un outil, et il écrit.
 *
 * ---------------------------------------------------------------------
 * LA CLÉ EST À PART DE CELLE DE LA PASSERELLE, ET C'EST LE POINT.
 *
 * La passerelle LIT — elle rend des couleurs, des notes, des repères. Le
 * connecteur ÉCRIT. Une seule clé pour les deux, c'est un secret collé dans
 * les réglages d'un service tiers qui ouvre aussi la lecture, et c'est une
 * révocation qui casse la guirlande quand on voulait fermer le connecteur.
 * =====================================================================
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, setSettings, getSettings, addCarnet, OWNER } from './db.js';

/** Le nom sous lequel les notes arrivent, quand le client ne se nomme pas. */
const SOURCE_PAR_DEFAUT = 'connecteur';

/** Ce qu'une note peut peser. Au-delà, ce n'est plus une note, c'est un dépôt. */
export const TEXTE_MAX = 4000;

/* --------------------------------------------------------------------------
   LA CLÉ — même mécanique que la passerelle, autre serrure
   -------------------------------------------------------------------------- */

export const nouvelleCle = () => randomBytes(24).toString('base64url');

/** Comparer sans laisser fuir la longueur ni l'endroit où ça diverge. */
export function memeCle(a, b) {
  if (!a || !b) return false;
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * LA CLÉ PRÉSENTÉE. En-tête d'autorisation d'abord — c'est ce que les clients
 * MCP savent envoyer. Le paramètre d'URL reste accepté parce que certains
 * réglages de connecteur ne proposent que de coller une adresse ; il vaut moins
 * (une URL se retrouve dans les journaux), et l'écran le dit.
 */
export function cleDeLaRequete(req, url) {
  const h = req?.headers ?? {};
  const bearer = /^Bearer\s+(.+)$/i.exec(String(h.authorization ?? ''));
  return (bearer?.[1] ?? h['x-connecteur-cle']
          ?? url?.searchParams?.get('cle') ?? '').toString().trim() || null;
}

export function proprietaireDeLaCle(cle) {
  if (!cle) return null;
  const lignes = db.prepare(
    "SELECT user_id, value FROM settings WHERE key = 'connecteurCle'"
  ).all();
  for (const l of lignes) {
    let v = null;
    try { v = JSON.parse(l.value); } catch { continue; }
    if (memeCle(v, cle)) return l.user_id;
  }
  return null;
}

/** Créer (ou remplacer) la clé. Rendue en clair une fois : elle se recopie. */
export function poserCle(userId = OWNER) {
  const cle = nouvelleCle();
  setSettings({ connecteurCle: cle }, userId);
  return cle;
}

export function retirerCle(userId = OWNER) {
  setSettings({ connecteurCle: null }, userId);
}

/** Y a-t-il une clé, sans la dire. L'écran a besoin de l'état, pas du secret. */
export const cleExiste = (userId = OWNER) =>
  Boolean(String(getSettings(userId)?.connecteurCle ?? '').trim());

/* --------------------------------------------------------------------------
   POSER LA NOTE
   -------------------------------------------------------------------------- */

/**
 * UNE DATE ÉCRITE PAR UN MODÈLE NE DÉCIDE PAS SEULE DE LA JOURNÉE.
 *
 * `jourDefaut` est passé de l'extérieur et non importé : `jourVecu` vit dans
 * `api.js`, qu'`index.js` importe déjà en même temps que ce fichier. L'importer
 * ici fermerait un cycle — qui marcherait sans doute, jusqu'au jour où l'ordre
 * de chargement change.
 *
 * `jourVecu` sait qu'une journée commence au lever et pas à minuit ; un modèle
 * qui écrit « 2026-09-17 » à deux heures du matin ne le sait pas. On n'accepte
 * donc une date QUE si elle est bien formée, et sinon on prend la journée vécue
 * — jamais une date approchée, qui rangerait la note dans la mauvaise soirée
 * sans que personne ne puisse le voir après coup.
 */
export function jourDeLaNote(quand, jourDefaut) {
  const d = String(quand ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d))) return d;
  return jourDefaut();
}

/**
 * Poser une note venue d'ailleurs. Rend `{erreur}` ou `{ok, note}`.
 *
 * Elle entre par `addCarnet`, comme tout ce qui vient d'ailleurs : elle ne
 * devient PAS un message, donc elle ne se lit pas comme la parole de quelqu'un
 * dans son fil, et elle ne transforme pas une journée non écrite en journée
 * écrite. Cette règle est celle du carnet depuis le début (voir `db.js`) et un
 * connecteur n'est pas une raison de l'assouplir.
 */
export function poserNote({ texte, quand = null, source = null }, userId = OWNER, jourDefaut) {
  const t = String(texte ?? '').trim();
  if (!t) return { erreur: 'il n’y a rien à noter' };
  if (t.length > TEXTE_MAX) {
    return { erreur: `c’est trop long (${t.length} signes, ${TEXTE_MAX} au plus) — `
                   + 'une note à la fois, pas la conversation entière' };
  }
  const nom = String(source ?? '').trim().slice(0, 24) || SOURCE_PAR_DEFAUT;
  const note = addCarnet({ texte: t, jour: jourDeLaNote(quand, jourDefaut),
                           quand: null, source: nom, userId });
  return { ok: true, note };
}

/* --------------------------------------------------------------------------
   LE SERVEUR MCP
   -------------------------------------------------------------------------- */

/**
 * CE QUE LE MODÈLE D'EN FACE LIT AVANT D'APPELER L'OUTIL.
 *
 * C'est la seule consigne qu'on puisse lui donner : on ne tient pas son prompt,
 * on ne tient pas sa conversation. Elle dit donc ce qu'un outil de journal
 * intime doit dire, et surtout ce qu'il ne doit PAS faire — recopier tout,
 * résumer à la place de la personne, noter ce qu'elle n'a pas dit.
 */
export const DESCRIPTION_OUTIL = `Dépose une note dans le journal personnel de la personne à qui tu parles (l'application s'appelle BrainDebugger). Elle la relira là-bas, et son propre outil d'analyse la prendra en compte.

QUAND L'APPELER. Quand elle te le demande (« note ça », « garde ça »), ou quand quelque chose vient d'être dit qui mérite d'exister ailleurs que dans cette conversation : une prise de conscience, une décision, un fait sur sa semaine, quelque chose qu'elle voudra relire.

CE QUE TU ÉCRIS. SES mots quand tu les as, une phrase simple sinon. Une note = une chose. Ne recopie pas la conversation, ne la résume pas d'office, n'écris jamais ce qu'elle n'a pas dit — c'est son journal, pas ton compte rendu. Si tu hésites, propose-lui la note avant de l'écrire.

QUAND NE PAS L'APPELER. À chaque message. Plusieurs fois pour la même chose. Pour noter ce que TOI tu as dit.`;

/**
 * Le serveur, construit à la demande pour UN journal.
 *
 * Stateless (`sessionIdGenerator: undefined`) : il n'y a pas d'état à tenir
 * entre deux appels, et un serveur qui garderait des sessions en mémoire
 * perdrait les siennes au premier redéploiement — c'est-à-dire souvent.
 */
export async function serveurPour(userId, jourDefaut) {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { z } = await import('zod');

  const s = new McpServer({ name: 'braindebugger', version: '1' },
                          { instructions: 'Le journal personnel de la personne à qui tu parles. '
                                        + 'Tu peux y déposer une note ; tu ne peux rien y lire.' });

  s.registerTool('noter', {
    title: 'Noter dans le journal',
    description: DESCRIPTION_OUTIL,
    inputSchema: {
      texte: z.string().describe('La note, dans ses mots à elle quand tu les as. Une seule chose.'),
      quand: z.string().optional()
        .describe('La journée à laquelle ça se rattache, AAAA-MM-JJ. '
                + 'Omets-la pour aujourd’hui — le journal sait quand sa journée commence, pas toi.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  }, async ({ texte, quand }) => {
    const r = poserNote({ texte, quand, source: 'connecteur' }, userId, jourDefaut);
    if (r.erreur) {
      return { isError: true, content: [{ type: 'text', text: r.erreur }] };
    }
    return { content: [{ type: 'text',
      text: `Noté dans son journal, à la journée du ${r.note.jour}.` }] };
  });

  return s;
}

/**
 * Répondre à une requête MCP. Rend `false` si le SDK n'est pas installé, pour
 * que l'appelant dise quoi faire au lieu de rendre une pile d'appels.
 */
export async function repondre(req, res, corps, userId, jourDefaut) {
  let StreamableHTTPServerTransport;
  try {
    ({ StreamableHTTPServerTransport } =
      await import('@modelcontextprotocol/sdk/server/streamableHttp.js'));
  } catch {
    return false;
  }
  const serveur = await serveurPour(userId, jourDefaut);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  // Refermer des deux côtés : sans ça, chaque requête laisse un serveur et un
  // transport vivants, et une conversation un peu longue en empile des
  // centaines.
  res.on('close', () => { transport.close(); serveur.close(); });
  await serveur.connect(transport);
  await transport.handleRequest(req, res, corps);
  return true;
}
