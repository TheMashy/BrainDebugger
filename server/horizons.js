/**
 * LES HORIZONS : ce que les derniers mois ont été, en quelques phrases.
 *
 * LE PROBLEME. Le compagnon reçoit les quatorze dernières journées telles
 * qu'elles ont été écrites, et la grille des notes sur quatre ans. Entre les
 * deux, rien : sur « ça fait combien de temps que ça dure ? », il a le texte de
 * la semaine et une suite de chiffres, et il répond à côté ou il invente.
 *
 * LE COUT AUSSI. Élargir en envoyant plus de journées brutes coûte à CHAQUE
 * message : trois mois de texte, quarante fois par jour, pour une question qui
 * arrive une fois par semaine.
 *
 * LA REPONSE. Quatre synthèses — la semaine, le mois, le trimestre, l'année —
 * écrites UNE FOIS par la lecture de fond, qui lit déjà tout le journal. Elles
 * ne coûtent aucun appel de plus : elles sortent du même outil que le reste de
 * la lecture. Elles tiennent en quelques centaines de jetons, elles ne changent
 * qu'une fois par semaine, et elles se mettent donc en cache avec le reste de
 * la mémoire stable.
 *
 * CE QU'ELLES NE REMPLACENT PAS. Les journées brutes. Le compagnon doit lire ce
 * que la personne a ECRIT, pas un résumé d'elle : une paraphrase de ce qu'on a
 * écrit un mauvais soir n'a aucune raison d'être plus juste que la phrase. Les
 * synthèses portent la DISTANCE — ce que le compagnon n'avait pas du tout — et
 * les journées brutes gardent la fidélité de près.
 */

/**
 * Les quatre fenêtres, du proche au lointain.
 *
 * Elles se recouvrent, et c'est voulu : « ces trois mois » n'est pas la somme
 * de trois « ce mois-ci ». Une saison a une forme que ses mois pris un par un
 * n'ont pas — c'est exactement ce qu'on demande à la fenêtre la plus large.
 */
export const HORIZONS = [
  { cle: 'semaine',   jours: 7,   nom: 'la semaine',      libelle: 'les sept derniers jours' },
  { cle: 'mois',      jours: 30,  nom: 'le mois',         libelle: 'les trente derniers jours' },
  { cle: 'trimestre', jours: 90,  nom: 'les trois mois',  libelle: 'les trois derniers mois' },
  { cle: 'annee',     jours: 365, nom: "l'année",         libelle: 'les douze derniers mois' }
];

/** Le nombre de journées ÉCRITES en dessous duquel une fenêtre ne dit rien. */
export const MIN_ECRITES = 3;

/**
 * Le morceau de schéma que la lecture ajoute à son outil.
 *
 * Deux à quatre phrases par fenêtre : plus court, c'est une étiquette ; plus
 * long, et les quatre ensemble pèsent autant que les journées qu'elles étaient
 * censées remplacer.
 */
export const SCHEMA_HORIZONS = {
  type: 'object',
  description: "Ce que chaque fenêtre a été, en quelques phrases. Elles servent au compagnon "
             + "quand la conversation demande du recul : « ça fait combien de temps que ça dure ? », "
             + "« c'était mieux avant ? ». Écris-les à la DEUXIÈME PERSONNE, comme la synthèse. "
             + "Une fenêtre sur laquelle tu n'as presque rien à lire : laisse-la vide plutôt que "
             + "d'inventer une tendance.",
  properties: Object.fromEntries(HORIZONS.map(h => [h.cle, {
    type: 'string',
    description: `${h.libelle} : deux à quatre phrases. Ce qui a tenu, ce qui a bougé, ce qui revient. `
               + `Des faits datés quand tu en as. Pas de conseil, pas de pronostic.`
  }])),
  required: []
};

/** Une phrase coupée sur une fin de phrase, jamais au milieu d'un mot. */
function phrase(t, max) {
  const s = String(t ?? '').replace(/\s+/g, ' ').trim();
  if (!s || s.length <= max) return s;
  const bout = s.slice(0, max);
  const fin = Math.max(bout.lastIndexOf('. '), bout.lastIndexOf('… '), bout.lastIndexOf('! '), bout.lastIndexOf('? '));
  return fin > max * 0.5 ? bout.slice(0, fin + 1) : bout.slice(0, bout.lastIndexOf(' ')) + '…';
}

/** La longueur d'une synthèse. Quatre fenêtres, et elles doivent tenir ensemble. */
export const HORIZON_CAR = 620;

/**
 * VALIDER CE QUE LE MODÈLE A RENDU.
 *
 * Une fenêtre sur laquelle il n'y a presque rien à lire ne doit pas produire de
 * phrase : « ces trois mois ont été calmes » écrit sur quatre journées notées
 * est une affirmation sur du vide, et le compagnon la répéterait comme un fait.
 * Le serveur COMPTE les journées écrites de chaque fenêtre — le modèle ne
 * décide pas s'il a de quoi parler.
 */
export function validerHorizons(brut, ecritesPar = new Map()) {
  const out = {};
  for (const h of HORIZONS) {
    const t = phrase(brut?.[h.cle], HORIZON_CAR);
    if (!t || t.length < 40) continue;
    const n = ecritesPar.get(h.cle) ?? 0;
    if (n < MIN_ECRITES) continue;
    out[h.cle] = { texte: t, jours: h.jours, ecrites: n };
  }
  return Object.keys(out).length ? out : null;
}

/** Combien de journées écrites tombent dans chaque fenêtre, depuis la dernière. */
export function ecritesParHorizon(rows, jusquAu) {
  const fin = Date.parse(String(jusquAu).slice(0, 10) + 'T12:00:00Z');
  const out = new Map();
  for (const h of HORIZONS) {
    const debut = fin - (h.jours - 1) * 86400000;
    out.set(h.cle, rows.filter(r => {
      if (!r.text || !String(r.text).trim()) return false;
      const t = Date.parse(String(r.date) + 'T12:00:00Z');
      return t >= debut && t <= fin;
    }).length);
  }
  return out;
}

/**
 * LE BLOC POUR LE COMPAGNON.
 *
 * Du plus large au plus proche : on lit d'abord où l'on en est, puis ce qui
 * vient de se passer. L'ordre inverse ferait relire la semaine deux fois.
 *
 * La consigne compte autant que le contenu. Sans elle, le compagnon récite ces
 * quatre paragraphes à la première occasion — c'est ce que fait un modèle à qui
 * l'on donne un résumé bien écrit — et la conversation devient un exposé sur la
 * personne à qui l'on parle.
 */
export function horizonBlock(h) {
  if (!h || !Object.keys(h).length) return null;
  const lignes = [...HORIZONS].reverse()
    .filter(x => h[x.cle]?.texte)
    .map(x => `${x.nom.toUpperCase()} (${h[x.cle].ecrites} journées écrites) — ${h[x.cle].texte}`);
  if (!lignes.length) return null;
  return `OÙ IL EN EST, SUR PLUSIEURS DISTANCES.\n`
       + `Écrit par la lecture de fond, pas par toi. C'est du RECUL, à sortir quand la\n`
       + `conversation en demande — « ça dure depuis quand ? », « c'était mieux avant ? ».\n`
       + `Tu ne les récites pas, et tu ne commences jamais par ça : quelqu'un qui raconte\n`
       + `sa soirée n'a pas demandé un bilan de son année.\n\n`
       + lignes.join('\n\n');
}
