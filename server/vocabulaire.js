/*
 * LE VOCABULAIRE QUE LA MACHINE N'EMPLOIE PAS À SON COMPTE.
 *
 * Il vivait dans fonctionnements.js, qui ouvre la base à l'import. La lecture
 * doit l'appliquer aussi (les noms de thèmes, de schémas, de nœuds), et elle ne
 * doit pas ouvrir la base pour ça : un test qui charge lecture.js avant d'avoir
 * choisi sa base de test écrirait dans la vraie. La règle est donc ici, sans
 * aucune dépendance, et fonctionnements.js la réexporte telle quelle.
 */

/* Ce que la machine dit À SON COMPTE ne nomme jamais un trouble, une cause, un
   état clinique. Les « … » sont les mots de la personne : elle a le droit de les
   écrire, la machine a le droit de les citer — la règle ne s'applique qu'au reste. */
export const laMachineDit = s => String(s ?? '').replace(/«[^»]*»/g, '');
export const MOTS_INTERDITS = /d[ée]pr[eé]ss|d[ée]prim|bipol|\bhypoman|\bmani(e|es|aque|aques)\b|tdah|adhd|autis|\btroubles?\b|diagnos|pathol|maladie|syndrome|d[ée]r[ée]alis|dissoci|anxi|angoiss|panique|insomni|hypersomni|burn.?out|borderline|schizo|psycho|n[ée]vros|sympt[ôo]m|rechute|suicid|euthym|prodrom|phase (haute|basse)|[ée]pisode|\bcrises?\b/i;
