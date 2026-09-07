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
export const PRICES = {
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
export const LECTURE_CACHE = 0.1;
export const ECRITURE_CACHE = 1.25;

export const currentMonth = () => new Date().toISOString().slice(0, 7);

export function record(userId, model, input = 0, output = 0, cacheLu = 0, cacheEcrit = 0,
                       source = null) {
  if (!input && !output && !cacheLu && !cacheEcrit) return;
  db.prepare(`
    INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                      cache_read_tokens, cache_write_tokens, source)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(userId, new Date().toISOString(), currentMonth(), model ?? null,
         input | 0, output | 0, cacheLu | 0, cacheEcrit | 0, source ?? null);
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
  /*
   * ET, A COTE, CE QUE CA AURAIT COUTE SANS CACHE -- OU PLUTOT L'INVERSE :
   * les memes jetons ramenes au tarif plein. Quatorze millions « traverses »
   * dont douze relus a un dixieme, c'est trois millions payes. Sans ce second
   * chiffre, la jauge fait peur pour rien, et on ne peut pas voir si le cache
   * prend : c'est l'ecart entre les deux qui le dit.
   */
  const equivalent = Math.round(row.i + row.o + row.cl * LECTURE_CACHE + row.ce * ECRITURE_CACHE);
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
    cacheLu: row.cl, cacheEcrit: row.ce, equivalent,
    level: illimitee ? 'green' : level(remaining, allowance),
    exhausted: !illimitee && remaining <= 0,
    costUsd: Math.round(cost * 100) / 100,
    resetsOn: nextMonthStart()
  };
}

/*
 * =====================================================================
 *  CE QUE COÛTE UN ÉCHANGE — LA SEULE MESURE QUI DIT SI ÇA S'AMÉLIORE.
 *
 * Le total du mois ne répond pas à « est-ce que le correctif a servi ? » :
 * il monte avec l'usage. Ce qu'on veut suivre, c'est le prix d'UN échange, et
 * il se compare d'une semaine à l'autre.
 *
 * UN ÉCHANGE N'EST PAS UN APPEL. Le compagnon qui pose un repère puis marque
 * un motif fait trois appels pour une réponse, chacun renvoyant tout le
 * prompt. On regroupe donc les appels proches : deux appels séparés de plus de
 * `TROU_ECHANGE` secondes appartiennent à deux échanges. C'est la même
 * frontière que la personne perçoit — elle écrit, ça répond, elle réécrit.
 *
 * ET ON COMPTE EN ÉQUIVALENT PLEIN TARIF, pas en jetons traversés : un jeton
 * relu du cache coûte un dixième. C'est l'écart entre les deux qui dit si le
 * cache prend, donc c'est là que l'optimisation se voit.
 * ===================================================================== */

const TROU_ECHANGE = 120;          // secondes ; au-delà, c'est un autre échange

/** L'équivalent plein tarif d'une ligne : ce qu'elle coûte, en jetons d'entrée. */
const equivalentDe = r =>
  r.input_tokens + r.output_tokens
  + (r.cache_read_tokens ?? 0) * LECTURE_CACHE
  + (r.cache_write_tokens ?? 0) * ECRITURE_CACHE;

const mediane = v => {
  const x = v.slice().sort((a, b) => a - b);
  if (!x.length) return null;
  return x.length % 2 ? x[(x.length - 1) / 2] : (x[x.length / 2 - 1] + x[x.length / 2]) / 2;
};

/**
 * Les appels d'une source, regroupés en échanges.
 * @returns {Array<{appels:number, equivalent:number, cout:number, traverses:number}>}
 */
export function echangesDe(lignes, trou = TROU_ECHANGE) {
  const out = [];
  let cour = null, dernier = null;
  for (const r of lignes) {
    const t = Date.parse(r.ts);
    if (!cour || !Number.isFinite(t) || !Number.isFinite(dernier) || t - dernier > trou * 1000) {
      cour = { appels: 0, equivalent: 0, cout: 0, traverses: 0 };
      out.push(cour);
    }
    const p = PRICES[r.model] ?? PRICES['claude-opus-5'];
    cour.appels++;
    cour.equivalent += equivalentDe(r);
    cour.traverses += r.input_tokens + r.output_tokens
                    + (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
    cour.cout += (r.input_tokens / 1e6) * p.in + (r.output_tokens / 1e6) * p.out
               + ((r.cache_read_tokens ?? 0) / 1e6) * p.in * LECTURE_CACHE
               + ((r.cache_write_tokens ?? 0) / 1e6) * p.in * ECRITURE_CACHE;
    dernier = t;
  }
  return out;
}

/** Les lignes brutes d'une fenêtre, par source. */
function lignes(userId, source, depuis, jusqua = null) {
  const cond = jusqua ? 'AND ts < ?' : '';
  const args = jusqua ? [userId, source, depuis, jusqua] : [userId, source, depuis];
  return db.prepare(
    `SELECT ts, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
     FROM usage WHERE user_id = ? AND source = ? AND ts >= ? ${cond} ORDER BY ts ASC`
  ).all(...args);
}

/** Le profil d'une fenêtre : par échange, et la part relue du cache. */
function profil(rows) {
  const ech = echangesDe(rows);
  const lu = rows.reduce((s, r) => s + (r.cache_read_tokens ?? 0), 0);
  const entree = rows.reduce((s, r) => s + r.input_tokens + (r.cache_read_tokens ?? 0)
                                        + (r.cache_write_tokens ?? 0), 0);
  return {
    echanges: ech.length,
    appels: rows.length,
    // La MÉDIANE, pas la moyenne : un seul échange à rallonge (un document
    // collé, une relecture) tirerait la moyenne et cacherait le quotidien.
    par_echange: mediane(ech.map(e => e.equivalent)),
    appels_par_echange: mediane(ech.map(e => e.appels)),
    cout_par_echange: ech.length ? Math.round(mediane(ech.map(e => e.cout)) * 10000) / 10000 : null,
    // Ce qui dit si le cache prend. C'est LE chiffre à suivre.
    part_cache: entree ? Math.round(1000 * lu / entree) / 10 : null
  };
}

const ilYA = j => new Date(Date.now() - j * 864e5).toISOString();

/**
 * CE QU'UN ÉCHANGE COÛTE, CETTE SEMAINE ET LA PRÉCÉDENTE.
 *
 * Deux fenêtres de sept jours côte à côte : c'est la comparaison qui dit si un
 * changement a servi, et elle ne demande à personne de tenir un carnet.
 */
export function profilUsage(userId, { jours = 7 } = {}) {
  const faire = source => ({
    semaine: profil(lignes(userId, source, ilYA(jours))),
    avant: profil(lignes(userId, source, ilYA(jours * 2), ilYA(jours)))
  });
  return { jours, chat: faire('chat'), carte: faire('carte') };
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
  // Par bucket ET par source : le chat (au premier plan) et la carte (le fond)
  // ne sont pas la meme depense. `chat` regroupe la conversation ; `carte` la
  // relecture / le retissage ; `autre` les lignes d'avant le suivi par source.
  const rows = db.prepare(
    `SELECT strftime('${fmt}', ts) k,
            CASE WHEN source = 'carte' THEN 'carte'
                 WHEN source = 'chat'  THEN 'chat'
                 ELSE 'autre' END AS s,
            SUM(input_tokens + output_tokens
                + COALESCE(cache_read_tokens, 0) + COALESCE(cache_write_tokens, 0)) t,
            COUNT(*) n
     FROM usage WHERE user_id = ? GROUP BY k, s`
  ).all(userId);
  const par = new Map();               // bucket -> {chat, carte, autre, appels}
  for (const r of rows) {
    const e = par.get(r.k) ?? { chat: 0, carte: 0, autre: 0, appels: 0 };
    e[r.s] = (e[r.s] ?? 0) + r.t;
    e.appels += r.n;
    par.set(r.k, e);
  }
  const now = new Date();
  const points = [];
  for (let i = pas - 1; i >= 0; i--) {
    const d = new Date(now);
    if (heure) d.setUTCHours(d.getUTCHours() - i, 0, 0, 0);
    else { d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - i); }
    const k = heure ? d.toISOString().slice(0, 13) : d.toISOString().slice(0, 10);
    const e = par.get(k) ?? { chat: 0, carte: 0, autre: 0, appels: 0 };
    points.push({ k, chat: e.chat, carte: e.carte, autre: e.autre,
                  tokens: e.chat + e.carte + e.autre, appels: e.appels });
  }
  const somme = c => points.reduce((s, p) => s + p[c], 0);
  return {
    grain, points,
    total: points.reduce((s, p) => s + p.tokens, 0),
    pic: Math.max(1, ...points.map(p => p.tokens)),
    totaux: { chat: somme('chat'), carte: somme('carte'), autre: somme('autre') }
  };
}
