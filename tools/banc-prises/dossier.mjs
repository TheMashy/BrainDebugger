/*
 * UN DOSSIER SYNTHÉTIQUE, ÉCRIT.
 *
 * Le banc des approches fabrique des SÉRIES (humeur, sommeil, écran). Il ne
 * fabrique pas de texte, et tout ce qui lit le journal — la veille, les prises,
 * la carte — travaille sur du texte. On ne pouvait donc éprouver ces
 * moteurs-là que sur des phrases écrites à la main, une par cas, ce qui
 * n'attrape jamais ce qui casse sur deux cents journées.
 *
 * Ce fichier comble ce trou : il prend un patient du banc et lui écrit son
 * journal, avec une dynamique de dépendance PLANTÉE dont on connaît la vérité
 * terrain — l'escalade, le déclencheur, la fenêtre d'arrêt, la reprise, et le
 * coût du lendemain. On peut alors demander au moteur ce qu'il retrouve, et
 * surtout ce qu'il invente.
 *
 * Les tournures sont volontairement variées. Un banc où chaque jour d'alcool
 * s'écrit « j'ai bu quatre bières » ne teste pas une détection, il teste une
 * chaîne de caractères.
 */
import { rngDe, bern, entier } from '../banc-approches/rng.mjs';

const pick = (r, a) => a[Math.min(a.length - 1, Math.floor(r() * a.length))];

/* Les mêmes faits, écrits comme on les écrit vraiment. */
const DIRE = {
  alcool: ["j'ai bu quatre bières devant la télé.", "trois verres de vin, encore une fois.",
           "j'étais bourré avant minuit.", "j'ai encore bu ce soir.",
           "l'apéro a duré, j'ai fini la bouteille.", "deux pintes puis deux autres, j'ai arrêté de compter.",
           "gueule de bois ce matin, évidemment."],
  cannabis: ["j'ai fumé un joint avant de dormir.", "deux bedos et je me suis endormi devant l'écran.",
             "un spliff sur le balcon vers une heure.", "j'ai fumé, comme tous les soirs en ce moment."],
  stimulants: ["j'ai tapé deux traces vers minuit.", "j'ai pris de la md samedi soir.",
               "sniffé au bar, je ne sais même plus pourquoi.", "un rail et j'ai tenu jusqu'à six heures."],
  ordinaire: ["journée correcte, du travail et une marche.", "rien de spécial, j'ai lu un peu.",
              "boulot, courses, un film le soir.", "longue journée, rien à en dire.",
              "j'ai bossé, mangé, dormi.", "temps gris, j'ai rangé l'appartement.",
              "café avec un collègue, ça allait."],
  declencheur: ["personne de la journée.", "je n'ai parlé à personne aujourd'hui.",
                "seul toute la soirée, encore.", "l'appartement était vide et silencieux."],
  veut_arreter: ["je veux arrêter, sérieusement cette fois.", "il faut que j'arrête, ça ne peut plus durer.",
                 "j'ai décidé d'arrêter à partir de demain."],
  tient: ["toujours rien, ça tient.", "encore une journée sans, je suis content.",
          "ça fait quelques jours maintenant."],
  craque: ["j'ai craqué hier soir.", "j'ai replongé, après tout ce temps.",
           "je n'ai pas tenu, et je m'en veux."],
  manque: ["j'y pense tout le temps depuis ce matin.", "j'en ai envie, c'est physique.",
           "le manque me rend irritable."],
  lendemain: ["journée gâchée, je n'ai rien fait.", "je me suis levé à quinze heures.",
              "vidé, incapable de me concentrer."]
};

/**
 * @param {object} serie      un patient de `banc-approches/generateur.mjs`
 * @param {object} plan
 *   famille      'alcool' | 'cannabis' | 'stimulants'
 *   base         la probabilité d'un jour de prise au départ
 *   escalade     la probabilité atteinte à la fin (montée linéaire)
 *   declencheur  le nom du nœud planté (ex. « la solitude ») ; sa journée
 *                écrite suivante devient une prise avec la probabilité `suite`
 *   suite        cette probabilité
 *   arret        [t0, t1] : la fenêtre sans, annoncée puis rompue
 *   cout         de combien la note du lendemain descend après une prise
 * @param {(t:number)=>string} dateDe
 * @returns {{entrees, jours_prise, jours_declencheur, arret, plan}}
 */
export function dossier(serie, plan, dateDe) {
  const {
    famille = 'alcool', base = 0.05, escalade = 0.45, declencheur = 'la solitude',
    suite = 0.75, arret = null, cout = 2, graine = 'dossier-1'
  } = plan ?? {};
  const r = rngDe(`${graine}-${famille}`);
  const J = serie.jours;
  const T = J.length;

  const dansArret = t => arret && t >= arret[0] && t <= arret[1];

  /* 1. les jours de déclencheur, puis les jours de prise qu'ils appellent */
  const decl = [], prise = new Set();
  for (let t = 0; t < T; t++) if (J[t].ecrit && bern(r, 0.14)) decl.push(t);
  const ecrits = [];
  for (let t = 0; t < T; t++) if (J[t].ecrit) ecrits.push(t);
  const rang = new Map(ecrits.map((t, i) => [t, i]));

  for (let t = 0; t < T; t++) {
    if (!J[t].ecrit || dansArret(t)) continue;
    const p = base + (escalade - base) * (t / Math.max(1, T - 1));
    if (bern(r, p)) prise.add(t);
  }
  for (const t of decl) {
    const i = rang.get(t); const s = ecrits[i + 1];
    if (s == null || dansArret(s)) continue;
    if (bern(r, suite)) prise.add(s);
  }

  /* 2. le journal */
  const entrees = [];
  for (let t = 0; t < T; t++) {
    const j = J[t];
    if (!j.ecrit) continue;
    const bouts = [];
    if (arret && t === arret[0] - 1) bouts.push(pick(r, DIRE.veut_arreter));
    if (dansArret(t) && bern(r, 0.25)) bouts.push(pick(r, r() < 0.5 ? DIRE.tient : DIRE.manque));
    if (arret && rang.get(t) === rang.get(arret[1]) + 1 && prise.has(t)) bouts.push(pick(r, DIRE.craque));
    if (decl.includes(t)) bouts.push(pick(r, DIRE.declencheur));
    if (prise.has(t)) bouts.push(pick(r, DIRE[famille]));
    const i = rang.get(t);
    if (i > 0 && prise.has(ecrits[i - 1]) && bern(r, 0.5)) bouts.push(pick(r, DIRE.lendemain));
    if (!bouts.length || bern(r, 0.6)) bouts.unshift(pick(r, DIRE.ordinaire));

    /* le coût : la note de la journée écrite qui SUIT une prise descend */
    let note = j.humeur;
    if (note != null && i > 0 && prise.has(ecrits[i - 1])) note = Math.max(1, note - cout);

    entrees.push({ date: dateDe(t), note: note ?? null, text: bouts.join(' ') });
  }

  return {
    entrees,
    jours_prise: [...prise].sort((a, b) => a - b).map(dateDe),
    jours_declencheur: decl.map(dateDe),
    arret: arret ? { de: dateDe(arret[0]), a: dateDe(arret[1]) } : null,
    plan: { famille, base, escalade, declencheur, suite, cout }
  };
}

/** La carte que le modèle aurait rendue : un nœud par chose plantée. */
export const carteDe = d => ({
  noeuds: [{ nom: d.plan.declencheur, genre: 'etat', jours: d.jours_declencheur },
           { nom: 'le travail', genre: 'activite',
             jours: d.entrees.filter((_, i) => i % 5 === 0).map(e => e.date) }],
  liens: []
});

/** Un digest Machi Tool vraisemblable pour une journée du banc. */
export function digestDe(j, dateDe, t) {
  const h = x => { const H = Math.floor(((x % 24) + 24) % 24), M = Math.round((x - Math.floor(x)) * 60); return `${String(H).padStart(2, '0')}:${String(M % 60).padStart(2, '0')}`; };
  if (j.coucher == null && j.sommeil_h == null) return null;
  return {
    date: dateDe(t),
    poste: {
      coucher: j.coucher != null ? h(j.coucher) : null,
      reveil: j.coucher != null && j.sommeil_h != null ? h(j.coucher + j.sommeil_h) : null,
      sommeil_h: j.sommeil_h ?? null
    },
    temps_par_contexte_s: { nav: Math.round((j.ecran_min ?? 0) * 60 * 0.6), video: Math.round((j.ecran_min ?? 0) * 60 * 0.4) }
  };
}
