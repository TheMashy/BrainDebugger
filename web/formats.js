/**
 * =====================================================================
 *  LES NOMBRES, ÉCRITS PAREIL PARTOUT.
 *
 * Ils ne l'étaient pas. Le même montant s'écrivait « 0,140 $ » dans le
 * panneau des jetons et « 14,00 ¢ » sur la pastille d'un message ; la part
 * de cache sortait « 74.4 % » avec un point décimal anglais au milieu d'une
 * page qui met des virgules ; et `fmtTok` rendait « 1.2 k ».
 *
 * Ça n'a l'air de rien, et ça coûte deux choses. On ne peut plus COMPARER ce
 * que dit un message à ce que dit la courbe au-dessus — or c'est exactement
 * le geste qu'on fait devant ces chiffres. Et un point décimal anglais se lit
 * comme une faute : une faute d'affichage fait douter du chiffre lui-même.
 *
 * Ils vivent donc dans un fichier à part plutôt que dans `app.js` : pour
 * qu'il y ait UN endroit, et pour qu'ils soient vérifiables sans navigateur.
 * =====================================================================
 */

/** Le séparateur décimal français. Un seul endroit qui le connaît. */
export const virgule = t => String(t).replace('.', ',');

/** Un nombre, sans décimale inutile : 2 reste « 2 », 1,5 reste « 1,5 ». */
export const fmtNb = (n, dec = 1) => n == null || !Number.isFinite(Number(n)) ? '—'
  : virgule(String(Math.round(Number(n) * 10 ** dec) / 10 ** dec));

/**
 * EN CENTIMES SOUS DIX CENTIMES, ET C'EST TOUT L'INTÉRÊT.
 *
 * Une réponse coûte entre un quart de centime et quelques centimes. En dollars
 * arrondis à deux décimales, elles s'écrasent toutes sur « 0,00 $ » ou
 * « 0,02 $ » : on ne voit plus la différence entre deux façons de répondre,
 * qui est la seule chose qu'on est venu regarder.
 *
 * Rend `null` et pas « 0 $ » quand le prix est inconnu — zéro voudrait dire
 * « gratuit », et c'est le mensonge qui ne se remarque qu'en comparant à une
 * vraie facture.
 */
export const dollars = d => d == null || !Number.isFinite(Number(d)) ? null
  : Number(d) >= 0.1 ? virgule(Number(d).toFixed(2)) + ' $'
  : virgule((Number(d) * 100).toFixed(2)) + ' ¢';

/** Sous 10 000 on garde une décimale : « 5 k » pour 4 800 fait perdre 200 jetons à l'œil. */
export const fmtTok = n =>
  n >= 1e6  ? virgule((n / 1e6).toFixed(1).replace('.0', '')) + ' M' :
  n >= 1e4  ? Math.round(n / 1000) + ' k' :
  n >= 1000 ? virgule((n / 1000).toFixed(1).replace('.0', '')) + ' k' : String(n);
