/**
 * LE DOCUMENT QU'ON EMPORTE À UN RENDEZ-VOUS.
 *
 * Il répond à une demande précise : « la première frise montre mon parcours
 * depuis ma naissance pour qu'elle ait tout le contexte ; la deuxième des
 * 30 jours montre les moments où je mentionne le suicide ou consomme une
 * substance ».
 *
 * CE MODULE N'INTERPRÈTE RIEN, ET C'EST SA SEULE RÈGLE.
 *
 * Il n'y a ici ni score, ni niveau de risque, ni évolution, ni « ça s'aggrave ».
 * Des dates, des durées, des citations — et pour chaque signe, LA PHRASE QUI
 * L'A DÉCLENCHÉ. C'est ce qui rend le document contestable : si un signe est
 * faux, la personne et la praticienne le voient toutes les deux, sur la même
 * ligne, avant d'en parler. Un document qui affirmerait sans citer demanderait
 * qu'on le croie — et c'est précisément ce qu'un compte rendu ne doit jamais
 * demander.
 *
 * CE QUI EST DIT AUJOURD'HUI ET CE QUI EST RACONTÉ NE SONT PAS LA MÊME CHOSE.
 * `veille.js` sépare déjà les deux : le genre `evoque_passe` est un souvenir
 * qui remonte, pas un geste du jour. Les fondre dans un même comptage ferait
 * lire « blessure le 12 » pour quelqu'un qui parlait d'il y a dix ans. Ils
 * sortent donc dans deux listes distinctes, et le document le dit en toutes
 * lettres.
 *
 * LES BORNES SONT CELLES DE TOUT LE JOURNAL, pas seulement celles qui ont été
 * posées sur le moment. `nuits()` relit les couchers et levers DITS, et ceux-ci
 * se relisent sur l'ensemble du journal (`relireLesBornesDites`) : une phrase
 * écrite il y a trois semaines et jamais lue à l'époque compte ici. C'est ce
 * que veut dire « déduits rétroactivement des données totales ».
 */
import { OWNER } from './db.js';
import { veilleDuJour, DIT } from './veille.js';
import { nuits } from './nuits.js';
import { addDays } from './stats.js';

/* Les genres qui parlent d'un geste ou d'une prise AU PRÉSENT. */
export const GENRES_PRESENT = ['suicide', 'blessure', 'en_main', 'moyen',
                               'substance', 'surdose', 'dereel'];
/* Et celui qui parle du passé. Il ne se mélange jamais aux autres. */
export const GENRE_PASSE = 'evoque_passe';

/**
 * Les N derniers jours, un par ligne, avec ce qui s'y est mesuré et ce qui
 * s'y est dit.
 *
 * @param {object} sources Les lectures, injectables pour les tests.
 * @returns {Array<{date, note, coucher, lever, sommeil_h, source_nuit,
 *                  signes: Array<{genre, niveau, libelle, extrait}>,
 *                  evoques: Array<{genre, libelle, extrait}>}>}
 */
export function joursDuRendezVous(userId = OWNER, {
  jours = 30, jusquA = null, notes = new Map(),
  lireVeille = veilleDuJour, lireNuits = nuits
} = {}) {
  const fin = jusquA ?? new Date().toISOString().slice(0, 10);
  const debut = addDays(fin, -(jours - 1));
  const parNuit = new Map(lireNuits(userId, { jours, jusquA: fin }).map(n => [n.date, n]));

  const out = [];
  for (let d = debut; d <= fin; d = addDays(d, 1)) {
    const v = lireVeille(d, userId) ?? null;
    const n = parNuit.get(d) ?? null;
    const motifs = v?.motifs ?? [];
    out.push({
      date: d,
      note: notes.get(d) ?? null,
      coucher: n?.coucher ?? null,
      lever: n?.lever ?? null,
      sommeil_h: n?.sommeil_h ?? null,
      // D'où vient la nuit : « dit » = la personne l'a écrit, sinon c'est
      // déduit de l'activité du poste. La praticienne doit pouvoir faire la
      // différence entre un témoignage et une déduction de machine.
      source_nuit: n?.source ?? null,
      signes: motifs.filter(m => GENRES_PRESENT.includes(m.genre))
        .map(m => ({ genre: m.genre, niveau: m.niveau,
                     libelle: DIT[m.genre] ?? m.genre, extrait: m.extrait ?? null })),
      evoques: motifs.filter(m => m.genre === GENRE_PASSE)
        .map(m => ({ genre: m.genre, libelle: DIT[m.genre] ?? m.genre,
                     extrait: m.extrait ?? null }))
    });
  }
  return out;
}

/**
 * Ce qui se compte sur la période, et RIEN DE PLUS.
 *
 * Pas de moyenne d'humeur, pas de tendance : sur trente jours elles ne
 * veulent rien dire, et un chiffre faux dans un document qu'on tend à
 * quelqu'un est pire que pas de chiffre du tout. On compte des JOURNÉES —
 * combien en portent un signe, combien ont une nuit mesurée — parce qu'un
 * dénominateur permet de contester le numérateur.
 */
export function comptesDuRendezVous(jours) {
  const avecSigne = jours.filter(j => j.signes.length);
  const parGenre = {};
  for (const j of avecSigne) for (const s of j.signes) parGenre[s.genre] = (parGenre[s.genre] ?? 0) + 1;
  return {
    jours: jours.length,
    ecrites: jours.filter(j => j.signes.length || j.evoques.length || j.note != null).length,
    avec_signe: avecSigne.length,
    par_genre: parGenre,
    nuits_mesurees: jours.filter(j => j.sommeil_h != null).length,
    nuits_dites: jours.filter(j => j.source_nuit === 'dit').length
  };
}
