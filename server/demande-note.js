/**
 * QUAND LE COMPAGNON A LE DROIT DE DEMANDER SON CHIFFRE À LA PERSONNE.
 *
 * Le compagnon pose des relevés en silence quand le ton bascule (relever_humeur).
 * Un relevé est une SUSPICION : c'est lui qui juge, de l'extérieur. Parfois, il
 * vaut mieux le demander que le deviner -- « là, tout de suite, tu dirais
 * combien sur 10 ? ». Ce qui revient est la parole de la personne, pas une
 * estimation, et c'est ce qui donne sa valeur au geste.
 *
 * Mais une question répétée devient un formulaire, et un formulaire tue la
 * conversation. La règle vit donc ici, dans le code, et pas seulement dans le
 * prompt : le prompt conseille, ce module refuse.
 *
 *   - PAS SANS SUSPICION. Il faut un relevé posé récemment, et APRÈS la dernière
 *     demande : on ne redemande pas sur la même bascule.
 *   - PAS PLUS DE `MAX_PAR_JOUR` par journée.
 *   - PAS MOINS DE `ECART_HEURES` entre deux demandes, jour ou pas : une
 *     demande à 23h50 et une autre à 0h10 sont la même soirée.
 *   - PAS DE RELANCE. Une demande restée sans réponse ferme la journée : s'il
 *     n'a pas répondu, c'est une réponse.
 *
 * Pur : on lui passe les demandes, les relevés et l'heure, il rend un verdict.
 */

export const MAX_PAR_JOUR = 2;
export const ECART_HEURES = 4;
/** Un relevé plus vieux que ça n'est plus « ce qui vient de se passer ». */
export const FRAICHEUR_MIN = 45;
/** Combien de formulations passées on rappelle au compagnon pour qu'il varie. */
export const FORMULES_RAPPELEES = 4;

const H = 3600_000;

/**
 * @param {{ demandes: Array<{date:string, ts:string, reponse:number|null}>,
 *           releves: Array<{ts:string}>, date: string, maintenant?: Date }} etat
 *   `demandes` : les demandes récentes (au moins les dernières 24 h), tous jours.
 *   `releves`  : les relevés de la journée.
 * @returns {{ ok: boolean, pourquoi: string }}
 */
export function peutDemander({ demandes = [], releves = [], date, maintenant = new Date() }) {
  const t = maintenant.getTime();
  const tri = [...demandes].sort((a, b) => a.ts.localeCompare(b.ts));
  const derniere = tri.at(-1) ?? null;
  const duJour = tri.filter(d => d.date === date);

  // Le relevé qui justifie la question : frais, et postérieur à la dernière demande.
  const suspicion = releves
    .filter(r => t - Date.parse(r.ts) <= FRAICHEUR_MIN * 60_000)
    .filter(r => !derniere || r.ts > derniere.ts)
    .length > 0;
  if (!suspicion) return { ok: false, pourquoi: 'aucune bascule relevée depuis la dernière question' };

  if (duJour.length >= MAX_PAR_JOUR) return { ok: false, pourquoi: `déjà ${MAX_PAR_JOUR} questions aujourd'hui` };
  if (duJour.some(d => d.reponse == null)) return { ok: false, pourquoi: "une question d'aujourd'hui est restée sans réponse" };
  if (derniere && t - Date.parse(derniere.ts) < ECART_HEURES * H) {
    return { ok: false, pourquoi: `dernière question il y a moins de ${ECART_HEURES} h` };
  }
  return { ok: true, pourquoi: 'bascule relevée, et rien demandé depuis assez longtemps' };
}

/**
 * La demande ouverte à laquelle une réponse peut se rattacher : la dernière du
 * jour, sans réponse, posée il y a moins de trois heures. Au-delà, un chiffre
 * donné ne répond plus à la question -- il parle d'autre chose.
 */
export function demandeOuverte(demandes = [], date, maintenant = new Date()) {
  const d = [...demandes].filter(x => x.date === date).sort((a, b) => a.ts.localeCompare(b.ts)).at(-1);
  if (!d || d.reponse != null) return null;
  return maintenant.getTime() - Date.parse(d.ts) <= 3 * H ? d : null;
}

/** Les dernières formulations, pour que la question ne sonne jamais pareil. */
export const formulesRecentes = (demandes = []) =>
  [...demandes].sort((a, b) => b.ts.localeCompare(a.ts))
    .map(d => d.formule).filter(Boolean).slice(0, FORMULES_RAPPELEES);

/**
 * « Si une bascule arrivait maintenant, la question serait-elle accordée ? »
 *
 * Calculé AVANT le tour, pour que le compagnon puisse poser son relevé et
 * annoncer sa question dans le même appel au lieu de deux appels en série.
 * C'est la même règle, avec un relevé fictif posé à l'instant : rien d'autre
 * n'est assoupli, et `demander_note` revérifie de toute façon au moment venu.
 */
export function peutDemanderSiBascule(etat) {
  const maintenant = etat.maintenant ?? new Date();
  return peutDemander({ ...etat, maintenant,
    releves: [...(etat.releves ?? []), { ts: maintenant.toISOString() }] });
}
