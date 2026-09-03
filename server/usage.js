import { db, getUser, getSettings } from './db.js';

/**
 * Comptage des jetons, par personne et par mois.
 *
 * L'utilisateur ne paie rien : c'est la cle de l'instance qui regle. L'enveloppe
 * n'est donc pas une facture, c'est une jauge -- de quoi savoir ou on en est
 * sans avoir a demander.
 *
 * Elle ne bloque pas non plus. Couper quelqu'un au milieu d'une phrase un
 * mauvais soir serait exactement le contraire de ce que fait ce produit : a
 * zero, on retombe sur le compagnon hors-ligne et on le dit.
 */

export const DEFAULT_ALLOWANCE = Number(process.env.BD_TOKEN_ALLOWANCE ?? 500_000);

/** Tarifs publics, en dollars par million de jetons. Sert au suivi cote operateur. */
const PRICES = {
  'claude-opus-5':   { in: 5,  out: 25 },
  'claude-sonnet-5': { in: 2,  out: 10 },
  'claude-haiku-4-5':{ in: 1,  out: 5 }
};

/*
 * CE QUE LE CACHE CHANGE AU PRIX.
 *
 * Un jeton relu du cache coute un DIXIEME du prix d'entree ; l'ecrire coute un
 * quart de plus. Compter les trois ensemble ferait mentir le seul chiffre qui
 * dit ce que ce produit coute : sur une conversation ou 85 % de l'entree est
 * relue, le total afficherait presque dix fois la depense reelle, et on
 * conclurait que le cache n'a rien change.
 */
const LECTURE_CACHE = 0.1;
const ECRITURE_CACHE = 1.25;

export const currentMonth = () => new Date().toISOString().slice(0, 7);

export function record(userId, model, input = 0, output = 0, cacheLu = 0, cacheEcrit = 0) {
  if (!input && !output && !cacheLu && !cacheEcrit) return;
  db.prepare(`
    INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                      cache_read_tokens, cache_write_tokens)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(userId, new Date().toISOString(), currentMonth(), model ?? null,
         input | 0, output | 0, cacheLu | 0, cacheEcrit | 0);
}

/**
 * L'enveloppe de quelqu'un, ou 0 s'il l'a retiree.
 *
 * ZERO VEUT DIRE « AUCUNE », JAMAIS « EPUISEE ». La nuance tient tout le
 * reglage : `remaining = max(0, allowance - used)` donne 0 dans les deux cas,
 * et sans distinction explicite lever l'enveloppe reviendrait a l'epuiser
 * instantanement -- exactement l'inverse de ce qu'on demande.
 */
export function allowanceFor(userId) {
  if (getSettings(userId)?.sansEnveloppe) return 0;
  return getUser(userId)?.allowance ?? DEFAULT_ALLOWANCE;
}

/** Vert au-dessus de 50 %, jaune jusqu'a 20 %, orange jusqu'a 5 %, rouge en dessous. */
export function level(remaining, allowance) {
  if (allowance <= 0) return 'green';
  const r = remaining / allowance;
  return r > 0.5 ? 'green' : r > 0.2 ? 'yellow' : r > 0.05 ? 'orange' : 'red';
}

export function usageFor(userId) {
  const month = currentMonth();
  const row = db.prepare(`
    SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o,
           COALESCE(SUM(cache_read_tokens),0) cl, COALESCE(SUM(cache_write_tokens),0) ce,
           COUNT(*) n
    FROM usage WHERE user_id = ? AND month = ?
  `).get(userId, month);

  /*
   * L'ENVELOPPE COMPTE TOUS LES JETONS, CACHE COMPRIS.
   *
   * Elle mesure ce qui a traverse le modele, pas ce que ca a coute : un jeton
   * relu est un jeton lu. Le prix, lui, tient compte du cache juste en dessous
   * -- ce sont deux questions differentes, et les melanger donnerait une jauge
   * qui bouge quand le tarif change.
   */
  const used = row.i + row.o + row.cl + row.ce;
  const allowance = allowanceFor(userId);
  const illimitee = allowance <= 0;
  const remaining = illimitee ? null : Math.max(0, allowance - used);

  const cost = db.prepare(`
    SELECT model, SUM(input_tokens) i, SUM(output_tokens) o,
           COALESCE(SUM(cache_read_tokens),0) cl, COALESCE(SUM(cache_write_tokens),0) ce
    FROM usage WHERE user_id = ? AND month = ? GROUP BY model
  `).all(userId, month).reduce((sum, r) => {
    const p = PRICES[r.model] ?? PRICES['claude-opus-5'];
    return sum + (r.i / 1e6) * p.in + (r.o / 1e6) * p.out
               + (r.cl / 1e6) * p.in * LECTURE_CACHE
               + (r.ce / 1e6) * p.in * ECRITURE_CACHE;
  }, 0);

  return {
    month, used, allowance, remaining, illimitee,
    inputTokens: row.i, outputTokens: row.o, calls: row.n,
    // Ce que le cache a evite de repayer. Sans ce chiffre, on ne peut pas
    // savoir si le cache fonctionne -- et un cache qui ne prend jamais coute
    // un quart de plus que pas de cache du tout.
    cacheLu: row.cl, cacheEcrit: row.ce,
    level: illimitee ? 'green' : level(remaining, allowance),
    exhausted: !illimitee && remaining <= 0,
    costUsd: Math.round(cost * 100) / 100,
    resetsOn: nextMonthStart()
  };
}

function nextMonthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}

/**
 * LA CONSOMMATION DANS LE TEMPS, POUR UNE COURBE.
 *
 * Chaque appel au modele a un horodatage et ses jetons ; on les regroupe par
 * HEURE (48 dernieres) ou par JOUR (30 derniers). On rend une serie CONTINUE,
 * trous compris (une heure sans appel vaut zero) : c'est justement le creux qui
 * dit « rien ne consommait la », et le masquer ferait croire a une activite
 * ininterrompue. Tout est en UTC, comme le reste du comptage.
 *
 * L'enveloppe compte tous les jetons (cache compris) : la barre mesure ce qui a
 * traverse le modele. `sortie` isole les jetons de sortie, les plus chers.
 */
export function serieUsage(userId, grain = 'jour') {
  const heure = grain === 'heure';
  const pas = heure ? 48 : 30;
  const fmt = heure ? '%Y-%m-%dT%H' : '%Y-%m-%d';
  const rows = db.prepare(
    `SELECT strftime('${fmt}', ts) k,
            SUM(input_tokens + output_tokens + cache_read_tokens + cache_write_tokens) t,
            SUM(output_tokens) o, COUNT(*) n
     FROM usage WHERE user_id = ? GROUP BY k`
  ).all(userId);
  const par = new Map(rows.map(r => [r.k, r]));
  const now = new Date();
  const points = [];
  for (let i = pas - 1; i >= 0; i--) {
    const d = new Date(now);
    if (heure) d.setUTCHours(d.getUTCHours() - i, 0, 0, 0);
    else { d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i); }
    const k = heure ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
    const r = par.get(k);
    points.push({ k, tokens: r?.t ?? 0, sortie: r?.o ?? 0, appels: r?.n ?? 0 });
  }
  const total = points.reduce((s, p) => s + p.tokens, 0);
  return { grain, points, total, pic: Math.max(1, ...points.map(p => p.tokens)) };
}
