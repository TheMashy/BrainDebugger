import { db, getUser } from './db.js';

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

export const currentMonth = () => new Date().toISOString().slice(0, 7);

export function record(userId, model, input = 0, output = 0) {
  if (!input && !output) return;
  db.prepare(`
    INSERT INTO usage(user_id, ts, month, model, input_tokens, output_tokens)
    VALUES(?,?,?,?,?,?)
  `).run(userId, new Date().toISOString(), currentMonth(), model ?? null, input | 0, output | 0);
}

export function allowanceFor(userId) {
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
    SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COUNT(*) n
    FROM usage WHERE user_id = ? AND month = ?
  `).get(userId, month);

  const used = row.i + row.o;
  const allowance = allowanceFor(userId);
  const remaining = Math.max(0, allowance - used);

  const cost = db.prepare(`
    SELECT model, SUM(input_tokens) i, SUM(output_tokens) o
    FROM usage WHERE user_id = ? AND month = ? GROUP BY model
  `).all(userId, month).reduce((sum, r) => {
    const p = PRICES[r.model] ?? PRICES['claude-opus-5'];
    return sum + (r.i / 1e6) * p.in + (r.o / 1e6) * p.out;
  }, 0);

  return {
    month, used, allowance, remaining,
    inputTokens: row.i, outputTokens: row.o, calls: row.n,
    level: level(remaining, allowance),
    exhausted: remaining <= 0,
    costUsd: Math.round(cost * 100) / 100,
    resetsOn: nextMonthStart()
  };
}

function nextMonthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
}
