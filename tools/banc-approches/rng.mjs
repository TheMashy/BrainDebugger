/*
 * ALÉA À GRAINE, ET RIEN D'AUTRE.
 *
 * Le banc doit être rejouable au bit près : deux personnes qui le lancent
 * doivent lire le même classement. Chaque patient tire son flux d'une graine
 * dérivée par hachage de (famille, profil, manquants, T, index) — changer le
 * nombre de patients ne décale donc jamais les autres. Math.random() est
 * interdit dans tout le dossier.
 */
export function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
/** FNV-1a 32 bits : de quoi dériver une graine d'une étiquette lisible. */
export function hacher(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export const rngDe = (...parts) => mulberry32(hacher(parts.join('|')));
export function normale(r, m = 0, s = 1) {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return m + s * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
export const bern = (r, p) => (r() < p ? 1 : 0);
export const unif = (r, a, b) => a + (b - a) * r();
export const lognorm = (r, mediane, sigma) => mediane * Math.exp(sigma * normale(r));
export const entier = (r, a, b) => a + Math.floor(r() * (b - a + 1));   // inclusif
export const clip = (x, a, b) => Math.max(a, Math.min(b, x));
