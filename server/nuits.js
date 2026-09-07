/*
 * =====================================================================
 * LES NUITS : le coucher, le lever, la durée — et ce qui ne colle pas.
 *
 * Une nuit se lit dans ce que Machi Tool sait du poste, et il le sait de
 * deux façons :
 *   — `poste` : le réveil et le coucher que l'application a appariés
 *     elle-même (démarrage et extinction du poste), avec `sommeil_h` ;
 *   — l'ACTIVITÉ : `plage` (première et dernière minute où quelqu'un
 *     touchait le clavier ce jour-là) et `trous` (les absences de plus de
 *     vingt minutes, poste allumé). C'est plus juste que le poste : un
 *     ordinateur qu'on laisse allumé la nuit n'a ni extinction ni démarrage,
 *     et pourtant on y a dormi — entre la dernière touche du soir et la
 *     première du matin.
 *
 * LA NUIT QUI OUVRE LE JOUR D, c'est le plus long silence qui se termine le
 * matin de D : une fin d'activité (dernière touche de D-1, ou un trou qui
 * s'ouvre après minuit, ou une extinction) suivie de la première reprise.
 * Deux silences séparés par moins de trente minutes de clavier — se lever
 * pour boire un verre d'eau — ne sont qu'une nuit. Une durée hors de 2 h à
 * 16 h n'est pas une nuit, c'est une coupure ou un week-end sans ordinateur.
 *
 * ET CE QUI NE COLLE PAS SE DIT. `poste.sommeil_h` qui ne vaut pas
 * lever − coucher, un coucher à 15 h, un lever à 3 h : chaque nuit porte
 * `souci`, une phrase, ou rien. On ne corrige pas en silence — la personne
 * regarde ses nuits pour savoir si elles sont justes, et un chiffre lissé
 * lui mentirait.
 * =====================================================================
 */

import { activiteEntre, mesuresDuJour, OWNER } from './db.js';
import { addDays } from './stats.js';

const MIN_NUIT = 2, MAX_NUIT = 16;           // heures ; en dehors, ce n'est pas une nuit
const FUSION_MIN = 30;                       // minutes de clavier qui ne coupent pas une nuit

const enMinutes = hhmm => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim()); return m ? +m[1] * 60 + +m[2] : null; };
const hhmm = min => { min = ((Math.round(min) % 1440) + 1440) % 1440; return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`; };

/**
 * LES INSTANTS D'UNE NUIT, sur un axe en minutes où 0 = minuit qui ouvre D
 * (le soir de D-1 est négatif, le matin de D positif).
 * fins   : où l'activité s'arrête ; debuts : où elle reprend.
 */
function instants(dig, digVeille) {
  const fins = [], debuts = [];
  const pV = digVeille?.plage ?? {}, pD = dig?.plage ?? {};
  const a = enMinutes(pV.a); if (a != null) fins.push({ t: a - 1440, src: 'activite' });
  for (const tr of digVeille?.trous ?? []) {                    // un trou de la veille qui s'ouvre le soir
    const de = enMinutes(tr.de), ta = enMinutes(tr.a);
    if (de != null && de >= 18 * 60) { fins.push({ t: de - 1440, src: 'activite' }); if (ta != null && ta > de) debuts.push({ t: ta - 1440, src: 'activite' }); }
  }
  const de = enMinutes(pD.de); if (de != null) debuts.push({ t: de, src: 'activite' });
  for (const tr of dig?.trous ?? []) {                          // un trou du jour : le poste est resté allumé
    const d0 = enMinutes(tr.de), d1 = enMinutes(tr.a);
    if (d0 != null && d1 != null && d1 > d0) { fins.push({ t: d0, src: 'activite' }); debuts.push({ t: d1, src: 'activite' }); }
  }
  // Le poste lui-même — SEULEMENT quand le clavier ne dit rien. Un démarrage
  // n'est pas une reprise : Windows redémarre seul à 00:30, personne ne s'est
  // levé. Mêlé aux instants du clavier, il couperait la nuit en deux.
  if (!fins.length && !debuts.length) {
    const pc = enMinutes(dig?.poste?.coucher), pr = enMinutes(dig?.poste?.reveil);
    if (pc != null) fins.push({ t: pc >= 12 * 60 ? pc - 1440 : pc, src: 'poste' });
    if (pr != null) debuts.push({ t: pr, src: 'poste' });
  }
  return { fins: fins.sort((x, y) => x.t - y.t), debuts: debuts.sort((x, y) => x.t - y.t) };
}

/**
 * Les silences : de chaque fin à la première reprise qui la suit.
 *
 * ET UN SILENCE NE CONTIENT AUCUNE ACTIVITÉ CONNUE. « Dernière touche à 23:50,
 * première à 11:00 » a l'air d'une nuit de onze heures — mais si on sait qu'il
 * y a eu du clavier à 03:30, ce n'en est pas une : la vraie nuit va de 03:30 à
 * 11:00. Sans cette règle, la plus longue l'emportait, et le coucher tombait
 * quatre heures trop tôt.
 */
function silences(fins, debuts) {
  const out = [];
  const connus = [...fins, ...debuts].map(x => x.t);
  for (const f of fins) {
    const d = debuts.find(x => x.t > f.t);
    if (!d) continue;
    // Un instant d'activité connu strictement à l'intérieur : ce n'est pas un silence.
    if (connus.some(t => t > f.t + 1 && t < d.t - 1)) continue;
    // Deux fins pour la même reprise (la dernière touche à 23:00, l'extinction à
    // 23:30) : on garde les deux, la plus longue nuit RECEVABLE l'emportera —
    // ne garder que la plus ancienne laissait une nuit de trente heures
    // évincer la vraie, puis se faire jeter par la borne des seize heures.
    out.push({ f, d, duree: d.t - f.t });
  }
  // Deux silences séparés par moins de trente minutes de clavier : une seule nuit,
  // et la durée ne compte pas ces minutes debout.
  const fondus = [];
  for (const s of out) {
    const prev = fondus[fondus.length - 1];
    if (prev && s.f.t - prev.d.t < FUSION_MIN && s.f.t >= prev.d.t) { prev.d = s.d; prev.duree += s.duree; }
    else fondus.push({ ...s });
  }
  return fondus;
}

/**
 * LA NUIT QUI OUVRE `date`, lue dans son digest et celui de la veille.
 * @returns {{coucher, lever, sommeil_h, source, souci} | null}
 *   coucher/lever en HH:MM ; sommeil_h en heures (une décimale) ;
 *   source : 'activite' (dérivée du clavier) | 'poste' (appariée par Machi Tool) ;
 *   souci : une phrase quand quelque chose ne colle pas, sinon null.
 */
export function nuitDuJour(dig, digVeille = null) {
  if (!dig) return null;
  const { fins, debuts } = instants(dig, digVeille);
  const cands = silences(fins, debuts)
    .filter(s => s.d.t >= 0 && s.d.t <= 16 * 60 && s.f.t >= -12 * 60);   // se termine le matin de D, commence après midi la veille
  const nuits = cands.filter(s => s.duree >= MIN_NUIT * 60 && s.duree <= MAX_NUIT * 60);
  const poste = dig.poste ?? {};
  let nuit = null, source = null;
  if (nuits.length) {
    nuit = nuits.reduce((a, b) => (b.duree > a.duree ? b : a));
    source = nuit.f.src === 'activite' || nuit.d.src === 'activite' ? 'activite' : 'poste';
  }
  // Rien de dérivable : le poste seul, tel que Machi Tool l'a apparié.
  if (!nuit && poste.reveil) {
    const pc = enMinutes(poste.coucher), pr = enMinutes(poste.reveil);
    const duree = pc != null ? pr - (pc >= 12 * 60 ? pc - 1440 : pc) : null;
    const r = { coucher: poste.coucher ?? null, lever: poste.reveil, sommeil_h: poste.sommeil_h ?? (duree != null && duree >= MIN_NUIT * 60 && duree <= MAX_NUIT * 60 ? Math.round(duree / 6) / 10 : null), source: 'poste', souci: null };
    return souci(r, poste);
  }
  if (!nuit) return null;
  const r = { coucher: hhmm(nuit.f.t), lever: hhmm(nuit.d.t), sommeil_h: Math.round(nuit.duree / 6) / 10, source, souci: null };
  return souci(r, poste);
}

/**
 * CE QUI NE COLLE PAS, DIT EN UNE PHRASE — ET SEULEMENT CE QUI EST FAUX EN SOI.
 *
 * Ces règles disaient « un coucher à 06:10, en pleine journée » et « un lever
 * à 15:30 » : deux normes déguisées en vérifications. Pour quelqu'un dont le
 * coucher médian est 5 h 26 et le lever 16 h 15, elles marquaient PRESQUE
 * TOUTES ses nuits — et une alerte qui se déclenche toujours n'alerte plus,
 * elle reproche. Ce n'est pas le rôle de cette application.
 *
 * Ne restent donc ici que les incohérences qui ne dépendent d'aucune
 * habitude : deux sources qui se contredisent, une durée qui n'est pas une
 * nuit. L'écart au rythme de la personne se juge ailleurs, sur SON rythme à
 * elle, et une fois toutes les nuits connues (voir `ecartsAuRythme`).
 */
function souci(r, poste) {
  const soucis = [];
  if (r.sommeil_h != null && poste?.sommeil_h != null && Math.abs(poste.sommeil_h - r.sommeil_h) > 0.5)
    soucis.push(`le poste dit ${String(poste.sommeil_h).replace('.', ',')} h, le clavier ${String(r.sommeil_h).replace('.', ',')} h`);
  if (r.sommeil_h != null && r.sommeil_h < 3) soucis.push(`${String(r.sommeil_h).replace('.', ',')} h seulement : une coupure plutôt qu'une nuit ?`);
  if (r.sommeil_h != null && r.sommeil_h > 13) soucis.push(`${String(r.sommeil_h).replace('.', ',')} h : l'ordinateur est peut-être resté fermé plus longtemps que toi`);
  r.souci = soucis.length ? soucis.join(' · ') : null;
  return r;
}

/** L'écart d'heure à heure, dans le sens du temps : 23:00 → 07:00 vaut 8 h. */
const versLAvant = (de, a) => (((a - de) % 1440) + 1440) % 1440;

/** La médiane d'un tableau d'heures-minutes, sur le cercle (voir web/nuits-axe.js). */
function medianeHoraire(minutes) {
  const h = minutes.filter(x => x != null).sort((a, b) => a - b);
  if (!h.length) return null;
  let trou = -1, apres = h[0];
  for (let i = 0; i < h.length; i++) {
    const g = versLAvant(h[i], h[(i + 1) % h.length]);
    if (g > trou) { trou = g; apres = h[(i + 1) % h.length]; }
  }
  const rel = h.map(x => versLAvant(apres, x)).sort((a, b) => a - b);
  const m = rel.length % 2 ? rel[(rel.length - 1) / 2] : (rel[rel.length / 2 - 1] + rel[rel.length / 2]) / 2;
  return (apres + m) % 1440;
}

/** L'écart au rythme habituel, dans un sens ou dans l'autre. */
const ecartCirculaire = (a, b) => Math.min(versLAvant(a, b), versLAvant(b, a));

/*
 * L'ÉCART AU RYTHME SE JUGE SUR LE RYTHME DE LA PERSONNE.
 *
 * Une nuit « anormale » n'est pas une nuit qui s'écarte d'un horaire de bureau :
 * c'est une nuit qui s'écarte de ses autres nuits à elle. On compare donc au
 * coucher et au lever médians de la fenêtre, et on ne dit quelque chose qu'au
 * delà de cinq heures d'écart — le décalage qu'on remarque soi-même.
 *
 * En dessous de sept nuits connues, on ne dit rien : une médiane sur trois
 * nuits n'est pas un rythme, et se tromper ici coûte plus que se taire.
 */
const ECART_H = 5, MIN_POUR_RYTHME = 7;

export function ecartsAuRythme(liste, { ecartH = ECART_H, minPourRythme = MIN_POUR_RYTHME } = {}) {
  const couchers = liste.map(n => enMinutes(n.coucher)).filter(x => x != null);
  const levers = liste.map(n => enMinutes(n.lever)).filter(x => x != null);
  const mC = couchers.length >= minPourRythme ? medianeHoraire(couchers) : null;
  const mL = levers.length >= minPourRythme ? medianeHoraire(levers) : null;
  const seuil = ecartH * 60;
  for (const n of liste) {
    const dits = [];
    const c = enMinutes(n.coucher), l = enMinutes(n.lever);
    if (mC != null && c != null && ecartCirculaire(c, mC) > seuil)
      dits.push(`couché à ${n.coucher}, loin de ton ${hhmm(mC)} habituel`);
    if (mL != null && l != null && ecartCirculaire(l, mL) > seuil)
      dits.push(`levé à ${n.lever}, loin de ton ${hhmm(mL)} habituel`);
    if (dits.length) n.souci = n.souci ? `${n.souci} · ${dits.join(' · ')}` : dits.join(' · ');
  }
  return liste;
}

/**
 * LES NUITS D'UNE PÉRIODE, une par jour, ce qui a été DIT passant devant.
 * @returns {Array<{date, coucher, lever, sommeil_h, source, souci}>}
 */
export function nuits(userId = OWNER, { jours = 90, jusquA = null } = {}) {
  const fin = jusquA ?? new Date().toISOString().slice(0, 10);
  const debut = addDays(fin, -(jours - 1));
  const parDate = new Map();
  for (const j of activiteEntre(addDays(debut, -1), fin, userId)) if (j.digest) parDate.set(j.date, j.digest);
  const out = [];
  for (let d = debut; d <= fin; d = addDays(d, 1)) {
    const n = nuitDuJour(parDate.get(d) ?? null, parDate.get(addDays(d, -1)) ?? null);
    // « Je me couche » / « je me lève » écrits ce jour-là : la personne a le dernier mot.
    const dits = mesuresDuJour(d, userId).filter(m => m.source === 'dit');
    const ditLever = dits.find(m => m.cle === 'lever_dit')?.texte ?? null;
    const ditCoucher = mesuresDuJour(addDays(d, -1), userId).find(m => m.source === 'dit' && m.cle === 'coucher_dit' && (enMinutes(m.texte) ?? 0) >= 12 * 60)?.texte
      ?? dits.find(m => m.cle === 'coucher_dit' && (enMinutes(m.texte) ?? 1440) < 12 * 60)?.texte ?? null;
    if (!n && !ditLever && !ditCoucher) continue;
    const r = n ? { ...n } : { coucher: null, lever: null, sommeil_h: null, source: 'dit', souci: null };
    if (ditLever) { r.lever = ditLever; r.source = 'dit'; }
    if (ditCoucher) { r.coucher = ditCoucher; r.source = 'dit'; }
    if ((ditLever || ditCoucher) && r.coucher && r.lever) {
      const c = enMinutes(r.coucher), l = enMinutes(r.lever);
      const duree = l - (c >= 12 * 60 ? c - 1440 : c);
      if (duree >= MIN_NUIT * 60 && duree <= MAX_NUIT * 60) r.sommeil_h = Math.round(duree / 6) / 10;
    }
    /*
     * LE SOUCI SE RECALCULE APRÈS CE QUI A ÉTÉ DIT.
     *
     * Il était posé sur les heures DÉRIVÉES, puis « je me suis levé à 15:30 »
     * remplaçait le lever sans toucher au souci : l'infobulle affichait
     * « levé 15:30 ⚠ un lever à 00:58 » — un reproche sur une heure qui
     * n'était plus là. Ce qu'on montre et ce qu'on commente doivent être la
     * même chose.
     */
    if (ditLever || ditCoucher) souci(r, n ? undefined : null);
    out.push({ date: d, ...r });
  }
  return ecartsAuRythme(out);
}
