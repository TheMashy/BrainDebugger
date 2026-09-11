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
                       source = null, messageId = null, composition = null) {
  if (!input && !output && !cacheLu && !cacheEcrit) return;
  db.prepare(`
    INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens,
                      cache_read_tokens, cache_write_tokens, source, message_id, composition)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)
  `).run(userId, new Date().toISOString(), currentMonth(), model ?? null,
         input | 0, output | 0, cacheLu | 0, cacheEcrit | 0, source ?? null,
         Number.isFinite(Number(messageId)) ? Number(messageId) : null,
         composition ? JSON.stringify(composition) : null);
}

/**
 * CE QU'A COUTE CHACUNE DE CES REPONSES.
 *
 * @param {number[]} ids  identifiants de messages
 * @returns {Map<number, {model, input, output, cacheLu, cacheEcrit, jetons, dollars}>}
 *
 * LE PRIX EST CALCULE ICI ET PAS DANS LA PAGE. Il depend du modele servi et du
 * traitement particulier du cache -- un jeton relu coute un dixieme, un jeton
 * ecrit un quart de plus. Recopier cette regle dans le navigateur, c'est
 * garantir qu'un jour les deux chiffres ne diront plus la meme chose.
 *
 * UN MODELE INCONNU DE LA TABLE DES PRIX NE REND PAS ZERO : il rend `null`.
 * Zero voudrait dire « gratuit », et c'est le genre de mensonge qui ne se
 * remarque qu'en comparant a une vraie facture. Les jetons, eux, sont comptes
 * quoi qu'il arrive : ils ne dependent d'aucun tarif.
 */
export function coutsParMessage(ids, userId) {
  const l = (ids ?? []).map(Number).filter(Number.isFinite);
  if (!l.length) return new Map();
  const lignes = db.prepare(
    `SELECT message_id, model,
            SUM(input_tokens) i, SUM(output_tokens) o,
            SUM(COALESCE(cache_read_tokens, 0)) cl, SUM(COALESCE(cache_write_tokens, 0)) ce,
            MAX(composition) composition
       FROM usage
      WHERE user_id = ? AND message_id IN (${l.map(() => '?').join(',')})
      GROUP BY message_id, model`
  ).all(userId, ...l);

  const out = new Map();
  for (const r of lignes) {
    const p = PRICES[r.model];
    const dollars = p == null ? null
      : ((r.i + r.ce * ECRITURE_CACHE + r.cl * LECTURE_CACHE) * p.in + r.o * p.out) / 1e6;
    const deja = out.get(Number(r.message_id));
    let composition = null;
    try { composition = r.composition ? JSON.parse(r.composition) : null; } catch { /* illisible */ }
    const val = { model: r.model, input: r.i, output: r.o, cacheLu: r.cl, cacheEcrit: r.ce,
                  jetons: r.i + r.o + r.cl + r.ce, dollars, composition };
    // Un meme message peut porter plusieurs appels (un tour d'outil relance le
    // modele) : on additionne, et un prix inconnu contamine le total plutot que
    // de disparaitre dans une somme qui aurait l'air complete.
    out.set(Number(r.message_id), deja == null ? val : {
      model: deja.model === val.model ? deja.model : 'plusieurs',
      input: deja.input + val.input, output: deja.output + val.output,
      cacheLu: deja.cacheLu + val.cacheLu, cacheEcrit: deja.cacheEcrit + val.cacheEcrit,
      jetons: deja.jetons + val.jetons,
      composition: deja.composition ?? val.composition,
      dollars: deja.dollars == null || val.dollars == null ? null : deja.dollars + val.dollars
    });
  }
  return out;
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
 *
 * `debut` est l'horodatage du PREMIER appel : c'est lui qui range l'échange
 * dans une période. Sans lui, un échange qui traverse minuit serait coupé en
 * deux et compté comme deux échanges à moitié prix.
 *
 * @returns {Array<{debut:string, appels:number, equivalent:number, cout:number, traverses:number}>}
 */
export function echangesDe(lignes, trou = TROU_ECHANGE) {
  const out = [];
  let cour = null, dernier = null;
  for (const r of lignes) {
    const t = Date.parse(r.ts);
    if (!cour || !Number.isFinite(t) || !Number.isFinite(dernier) || t - dernier > trou * 1000) {
      cour = { debut: r.ts, appels: 0, equivalent: 0, cout: 0, traverses: 0 };
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

/*
 * =====================================================================
 *  LA CONSOMMATION DANS LE TEMPS — ET CE QU'ELLE MESURE.
 *
 * La courbe ne montrait qu'une chose : les jetons TRAVERSÉS par période. Ce
 * chiffre-là monte avec l'usage, et il ne répond donc pas à la seule question
 * qu'on se pose en optimisant — « est-ce que ça baisse ? ». Cinquante échanges
 * à moitié prix font une barre plus haute que vingt échanges au prix fort.
 *
 * Il y a maintenant quatre MESURES sur la même série, et le choix de la mesure
 * est le choix de la question :
 *
 *   volume  — les jetons traversés. « Combien ça a tourné », par source.
 *   jetons  — les jetons d'UN échange, au tarif plein. « Est-ce que le prompt
 *             maigrit ? » Un jeton relu du cache y compte pour un dixième.
 *   cout    — les dollars d'UN échange. La même chose, en argent.
 *   cache   — la part du prompt relue du cache. C'est la CAUSE quand les deux
 *             précédents bougent, et c'est le premier endroit où regarder.
 *
 * Et quatre FENÊTRES, parce qu'une optimisation se lit sur des mois, pas sur
 * deux jours. Le pas s'élargit avec la fenêtre : trente barres tiennent dans un
 * panneau, trois cent soixante-cinq n'y tiennent pas.
 *
 * UNE PÉRIODE SANS ÉCHANGE N'A PAS DE PRIX PAR ÉCHANGE — elle vaut `null`, pas
 * zéro. C'est la même règle que partout ailleurs ici : un zéro se lit comme
 * « c'était gratuit », un trou se lit comme « on ne sait pas », et une courbe
 * qui plonge à zéro chaque week-end raconterait une optimisation qui n'a pas eu
 * lieu.
 * ===================================================================== */

/** Les fenêtres : combien de pas, de quelle largeur, et comment on les nomme. */
export const FENETRES = {
  heure:   { pas: 48, unite: 'heure',   nom: '48 h' },
  jour:    { pas: 30, unite: 'jour',    nom: '30 jours' },
  semaine: { pas: 13, unite: 'semaine', nom: '3 mois' },
  mois:    { pas: 12, unite: 'mois',    nom: '1 an' },
};

/** Le début du seau qui contient cet instant, en UTC. */
function seau(d, unite) {
  const t = new Date(d);
  if (unite === 'heure') { t.setUTCMinutes(0, 0, 0); return t.toISOString().slice(0, 13); }
  t.setUTCHours(0, 0, 0, 0);
  if (unite === 'jour') return t.toISOString().slice(0, 10);
  if (unite === 'semaine') {
    // Le lundi : `getUTCDay()` rend 0 pour dimanche, qu'on ramène à 7.
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
  }
  t.setUTCDate(1);
  return t.toISOString().slice(0, 7);
}

/** Recule d'un pas. */
function reculer(t, unite, n) {
  const d = new Date(t);
  if (unite === 'heure') d.setUTCHours(d.getUTCHours() - n);
  else if (unite === 'jour') d.setUTCDate(d.getUTCDate() - n);
  else if (unite === 'semaine') d.setUTCDate(d.getUTCDate() - 7 * n);
  else d.setUTCMonth(d.getUTCMonth() - n);
  return d;
}

/**
 * LA CONSOMMATION DANS LE TEMPS, POUR UNE COURBE.
 *
 * Chaque appel au modèle a un horodatage et ses jetons ; on les regroupe par
 * heure, jour, semaine ou mois. La série est CONTINUE, trous compris : c'est
 * justement le creux qui dit « rien ne consommait là », et le masquer ferait
 * croire à une activité ininterrompue. Tout est en UTC, comme le reste du
 * comptage.
 *
 * LES ÉCHANGES SONT DÉCOUPÉS SUR TOUTE LA FENÊTRE, PUIS RANGÉS. Les découper
 * seau par seau couperait en deux l'échange qui traverse minuit et compterait
 * deux échanges à moitié prix là où il y en a un. Chaque échange va donc dans
 * le seau de son PREMIER appel.
 */
export function serieUsage(userId, grain = 'jour') {
  const f = FENETRES[grain] ?? FENETRES.jour;
  const now = new Date();
  // Le début de la fenêtre : le seau du premier pas, pas « il y a N jours ».
  const debut = new Date(`${seau(reculer(now, f.unite, f.pas - 1), f.unite)}${
    f.unite === 'heure' ? ':00:00.000Z' : f.unite === 'mois' ? '-01T00:00:00.000Z' : 'T00:00:00.000Z'}`);

  const rows = db.prepare(
    `SELECT ts, model, source, input_tokens, output_tokens,
            COALESCE(cache_read_tokens, 0) cache_read_tokens,
            COALESCE(cache_write_tokens, 0) cache_write_tokens
     FROM usage WHERE user_id = ? AND ts >= ? ORDER BY ts ASC`
  ).all(userId, debut.toISOString());

  const vide = () => ({ chat: 0, carte: 0, autre: 0, appels: 0,
                        equivalent: 0, cout: 0, lu: 0, entree: 0, ech: [] });
  const par = new Map();
  const ou = r => par.get(seau(r.ts, f.unite)) ?? null;

  // 1. les volumes, appel par appel.
  for (const r of rows) {
    const k = seau(r.ts, f.unite);
    if (!par.has(k)) par.set(k, vide());
    const e = par.get(k);
    const s_ = r.source === 'carte' ? 'carte' : r.source === 'chat' ? 'chat' : 'autre';
    e[s_] += r.input_tokens + r.output_tokens + r.cache_read_tokens + r.cache_write_tokens;
    e.appels++;
    e.equivalent += equivalentDe(r);
    e.lu += r.cache_read_tokens;
    e.entree += r.input_tokens + r.cache_read_tokens + r.cache_write_tokens;
    const p = PRICES[r.model] ?? PRICES['claude-opus-5'];
    e.cout += (r.input_tokens / 1e6) * p.in + (r.output_tokens / 1e6) * p.out
            + (r.cache_read_tokens / 1e6) * p.in * LECTURE_CACHE
            + (r.cache_write_tokens / 1e6) * p.in * ECRITURE_CACHE;
  }

  // 2. les échanges, découpés par SOURCE sur toute la fenêtre puis rangés dans
  //    le seau de leur premier appel. Deux sources mélangées feraient d'une
  //    relecture de la carte lancée pendant une conversation un seul échange.
  for (const src of ['chat', 'carte']) {
    const lignesSrc = rows.filter(r => r.source === src);
    for (const e of echangesDe(lignesSrc)) {
      const k = seau(e.debut, f.unite);
      if (!par.has(k)) par.set(k, vide());
      par.get(k).ech.push(e);
    }
  }

  const points = [];
  for (let i = f.pas - 1; i >= 0; i--) {
    const k = seau(reculer(now, f.unite, i), f.unite);
    const e = par.get(k) ?? vide();
    const ech = e.ech;
    points.push({
      k,
      chat: e.chat, carte: e.carte, autre: e.autre,
      tokens: e.chat + e.carte + e.autre,
      appels: e.appels,
      echanges: ech.length,
      // Les MÉDIANES, pas les moyennes : un seul échange à rallonge (un
      // document collé, un retissage) tirerait la moyenne du seau et cacherait
      // le quotidien — qui est précisément ce qu'on vient regarder.
      par_echange: ech.length ? Math.round(mediane(ech.map(x => x.equivalent))) : null,
      cout_par_echange: ech.length
        ? Math.round(mediane(ech.map(x => x.cout)) * 1e5) / 1e5 : null,
      // La part relue du cache n'a pas besoin d'échanges : elle se lit sur les
      // appels, et un seul appel suffit à la mesurer.
      part_cache: e.entree ? Math.round(1000 * e.lu / e.entree) / 10 : null,
      cout: Math.round(e.cout * 1e4) / 1e4,
      equivalent: Math.round(e.equivalent),
    });
  }
  const somme = c => points.reduce((s2, p) => s2 + (p[c] ?? 0), 0);
  const pics = c => Math.max(...points.map(p => p[c] ?? 0), 0);
  return {
    grain, unite: f.unite, nom: f.nom, points,
    total: somme('tokens'),
    pic: Math.max(1, pics('tokens')),
    // Un pic par mesure : chacune a sa propre échelle, et réutiliser celle du
    // volume écraserait les trois autres contre l'axe.
    pics: {
      volume: Math.max(1, pics('tokens')),
      jetons: Math.max(1, pics('par_echange')),
      cout: Math.max(1e-4, pics('cout_par_echange')),
      cache: 100,
    },
    echanges: somme('echanges'),
    coutTotal: Math.round(somme('cout') * 100) / 100,
    totaux: { chat: somme('chat'), carte: somme('carte'), autre: somme('autre') }
  };
}
