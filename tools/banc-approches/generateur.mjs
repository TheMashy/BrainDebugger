/*
 * LE GÉNÉRATEUR : un patient = T jours simulés par un petit modèle d'état.
 *
 * Deux couches, et il ne faut pas les confondre. La couche LATENTE est ce qui
 * se passe vraiment (l'humeur, le coucher, la nuit) ; la vérité terrain est
 * définie dessus. La couche OBSERVÉE est ce qu'une personne note et ce qu'un
 * poste mesure : humeur entière avec un style de réponse et une dérive, jours
 * sans note qui dépendent de l'état (on n'écrit pas quand ça va mal), coucher
 * du poste qui précède l'endormissement, capteurs troués. Les méthodes ne
 * voient QUE l'observé — c'est le réalisme qui départage les cartes.
 *
 * Conventions (une fois pour toutes) :
 *   - variable(t) = mesurée pour la journée civile t ; t = 0 est un lundi.
 *   - sommeil_h(t) = la nuit t−1 → t (dormie AVANT la journée t).
 *   - coucher(t) = l'heure à laquelle on se couche le SOIR de t (→ sommeil_h(t+1)).
 * Les lags plantés découlent mécaniquement de ces équations.
 */
import { rngDe, normale, bern, unif, lognorm, entier, clip } from './rng.mjs';
import { PROFILS } from './profils.mjs';
import { etatsDe, compterChaine, liftsMaillons } from './etats.mjs';

const dow = t => t % 7;                       // 0 = lundi … 5 = samedi, 6 = dimanche
const weekend = t => dow(t) >= 5;
const nuitDeSortie = t => dow(t) === 4 || dow(t) === 5;   // vendredi et samedi soir

/* ---------------------------------------------------------------------- */
/* Le calendrier des épisodes : quand ça bascule, et pour combien de temps  */
/* ---------------------------------------------------------------------- */
function calendrier(profil, T, r) {
  const ep = [];   // { genre: 'depressif'|'manie'|'palier', t0, t1 (exclu) }
  const un = (genre, lo, hi, dmin, dmax) => {
    const t0 = entier(r, lo, hi), d = entier(r, dmin, dmax);
    ep.push({ genre, t0, t1: Math.min(T, t0 + d) });
  };
  if (profil === 'depression' || profil === 'calib_mixte') {
    if (T <= 90) un('depressif', 25, 40, 18, 28);
    else {
      un('depressif', 30, 70, 21, 28);
      if (r() < 0.5) un('depressif', 110, 140, 21, 28);
    }
  } else if (profil === 'bipolarite') {
    if (T <= 90) {
      if (r() < 0.5) un('manie', 25, 40, 10, 18); else un('depressif', 25, 40, 18, 25);
    } else {
      const t0 = entier(r, 35, 60), d = entier(r, 10, 20);
      ep.push({ genre: 'manie', t0, t1: t0 + d });
      // 40 % : la dépression s'enchaîne directement ; sinon ≥ 30 j d'euthymie.
      const t0d = r() < 0.4 ? t0 + d : t0 + d + 30 + entier(r, 0, 20);
      const dd = entier(r, 20, 35);
      if (t0d + 10 < T) ep.push({ genre: 'depressif', t0: t0d, t1: Math.min(T, t0d + dd) });
    }
  }
  return ep;
}
const regimeDe = (ep, t) => ep.find(e => t >= e.t0 && t < e.t1) ?? null;
/** Le ralentissement critique : 0 loin d'un début, 1 la veille. Sur 12 jours. */
function ralentissement(ep, t) {
  let c = 0;
  for (const e of ep) if (t < e.t0 && t >= e.t0 - 12) c = Math.max(c, (t - (e.t0 - 12) + 1) / 12);
  return c;
}
/** La rampe de sommeil avant une manie : 7,5 → 5 h sur les 4 nuits qui précèdent. */
function rampeManie(ep, t) {
  for (const e of ep) if (e.genre === 'manie' && t < e.t0 && t >= e.t0 - 4) return (t - (e.t0 - 4) + 1) / 4;
  return 0;
}

/* ---------------------------------------------------------------------- */
/* La couche latente                                                       */
/* ---------------------------------------------------------------------- */
function simulerLatent(profil, T, r) {
  const P = PROFILS[profil];
  const ep = calendrier(profil, T, r);
  // traits par patient
  const sousTypeSommeil = profil === 'depression' ? (r() < 0.5 ? 'precoce' : 'hypersomnie') : null;
  const J = [];
  let hum = P.humeur.m, ene = P.energie.m, coucherHier = P.coucher.m;
  let nuitsCourtes = 0;   // compteur glissant de nuits < 5 h (dette)
  for (let t = 0; t < T; t++) {
    const reg = regimeDe(ep, t);
    const csd = ralentissement(ep, t);
    const enEpisode = !!reg;
    const amp = enEpisode ? 0.3 : 1;            // la semaine perd sa forme en épisode
    const hier = J[t - 1] ?? null;
    const j = { t, dow: dow(t), regime: reg?.genre ?? null };

    /* ---- la nuit t−1 → t ---- */
    let sm = P.sommeil.m, ssd = P.sommeil.sd;
    if (sousTypeSommeil === 'precoce') { sm = 5.2; ssd = 0.9; }
    if (sousTypeSommeil === 'hypersomnie') { sm = 9.3; ssd = 1.0; }
    let s = sm;
    s -= 0.5 * (coucherHier - P.coucher.m);                    // coucher tard → nuit courte (commun)
    if (weekend(t)) s += 0.7 * amp;                            // grasse matinée
    if (profil === 'tdah' && weekend(t)) s += 0.8;             // rattrapage (jet-lag social)
    if (profil === 'anxiete' && dow(t) === 0) s -= 0.8;        // nuit dimanche → lundi
    if (hier?.anxio) s -= (profil === 'anxiete' ? 2.0 : 0.8);  // l'anxio de la veille rogne la nuit
    if (profil === 'calib_mixte' && hier?.substance) s -= 2.2;
    if (reg?.genre === 'manie') s = unif(r, 3, 4);
    else if (reg?.genre === 'depressif' && profil === 'bipolarite') s = 9.5;
    const rm = rampeManie(ep, t); if (rm > 0) s = 7.5 - 2.5 * rm;
    s += normale(r, 0, ssd) * (reg?.genre === 'manie' ? 0.4 : 1);
    j.sommeil_h = clip(s, 0, 12);
    nuitsCourtes = j.sommeil_h < 5 ? nuitsCourtes + 1 : 0;

    /* ---- les événements du jour ---- */
    j.declencheur = bern(r, P.p.declencheur);
    j.surcharge = bern(r, P.p.surcharge);
    let pSocial = P.p.social * (nuitDeSortie(t) ? 2.2 : 1);
    if (profil === 'autisme') {
      pSocial = weekend(t) ? 0.25 : 0.12;
      if (hier?.surcharge || J[t - 2]?.surcharge) pSocial = 0;   // retrait après surcharge
    }
    if (reg?.genre === 'manie') pSocial = Math.min(0.9, pSocial * 2.2);
    if (reg?.genre === 'depressif') pSocial *= 0.5;
    j.social = bern(r, Math.min(0.95, pSocial));
    let pAnx = P.p.anxio;
    if (j.declencheur) pAnx += (profil === 'anxiete' ? 0.7 : profil === 'autisme' ? 0.6 : 0.2);
    if (profil === 'autisme' && (hier?.declencheur || J[t - 2]?.declencheur)) pAnx += 0.45;  // 2–3 jours
    if (profil === 'autisme' && j.surcharge) pAnx += 0.5;
    j.anxio = bern(r, Math.min(0.95, pAnx));
    // déréalisation : dette de sommeil + stress, cannabis de la veille, persistance
    let pDer = P.p.dereel;
    if (profil === 'derealisation') {
      const dette = j.sommeil_h < 5.5 && (hier?.sommeil_h ?? 9) < 5.5;
      const stress = j.declencheur || j.anxio || hier?.declencheur || hier?.anxio || J[t - 2]?.declencheur;
      if (dette && stress) pDer = 0.6;
      if (hier?.substance) pDer += 0.25;
      if (hier?.dereel) pDer = Math.max(pDer, 0.55);
    }
    j.dereel = bern(r, Math.min(0.95, pDer));
    if (profil === 'derealisation' && j.dereel && r() < 0.4) j.anxio = 1;   // dereel → anxio (peur de devenir fou)
    let pSub = P.p.substance;
    if (profil === 'anxiete') pSub = j.anxio ? 0.5 : 0.1;
    if (profil === 'calib_mixte') pSub = j.declencheur ? 0.65 : 0.1;   // sa chaîne à lui : declencheur → substance → nuit courte
    if (reg?.genre === 'manie') pSub = 0.35;
    j.substance = bern(r, pSub);

    /* ---- l'écran et le coucher de ce soir ---- */
    let ecran = normale(r, P.ecran.m, P.ecran.sd);
    if (weekend(t)) ecran *= 1.2;
    if (reg?.genre === 'manie') ecran *= 2;
    j.hyperfocus = profil === 'tdah' && bern(r, P.hyperfocus);
    if (j.hyperfocus) ecran = unif(r, 700, 900);
    j.ecran_min = clip(Math.round(ecran), 0, 900);
    let c = P.coucher.m + normale(r, 0, P.coucher.sd);
    if (nuitDeSortie(t)) c += 0.8 * amp * (profil === 'autisme' ? 0 : 1);
    if (j.hyperfocus) c += 2.0;                                  // ≥ 27 le plus souvent
    if (profil === 'tdah' && j.ecran_min >= 700) c += 1.5;      // l'arête comportementale (pas le capteur)
    if (reg?.genre === 'manie') c = 26.5 + normale(r, 0, 1.5);
    if (reg?.genre === 'depressif' && sousTypeSommeil === 'hypersomnie') c += 1;
    if (profil === 'autisme' && j.surcharge) c += 0.5;
    if (profil === 'anxiete' && dow(t) === 6) c += 0.5;         // dimanche soir
    j.coucher = clip(c, 20, 30);
    coucherHier = j.coucher;

    /* ---- l'humeur et l'énergie (latentes) ---- */
    const phiH = P.humeur.phi + csd * (0.88 - P.humeur.phi);
    const sdH = P.humeur.sd * (1 + 0.4 * csd) * (reg?.genre === 'manie' ? 1.5 : 1);
    let base = P.humeur.m;
    if (reg?.genre === 'manie') base += 3.2;
    if (reg?.genre === 'depressif') base += (profil === 'bipolarite' ? -3.5 : -1.5);
    let eff = 0;
    const coefSommeil = profil === 'temoin' ? 0.25 : profil === 'anxiete' ? 1.0 : profil === 'depression' ? 0.45 : 0.3;
    if (reg?.genre === 'manie') eff += -0.6 * (j.sommeil_h - 4);      // manie : moins on dort, plus ça monte
    else eff += coefSommeil * (j.sommeil_h - sm);
    if (j.anxio) eff -= (profil === 'anxiete' ? 1.0 : 0.6);
    if (j.declencheur) eff -= (profil === 'tdah' ? 1.5 : profil === 'temoin' ? 0.8 : 0.5);
    if (j.social) eff += (profil === 'depression' ? 0.8 : profil === 'autisme' ? 0 : 0.4);
    if (weekend(t)) eff += P.weekend * amp;
    if (profil === 'autisme' && hier?.social) eff -= 1.4;           // le coût social, le lendemain
    if (profil === 'tdah' && nuitsCourtes >= 2) eff -= 1.0;
    let h = base + phiH * (hum - base) + eff + normale(r, 0, sdH * Math.sqrt(1 - phiH * phiH));
    if (j.dereel) h = 4.0 + normale(r, 0, 0.3);                        // émoussement : plateau ET chute
    hum = clip(h, 1, 10);
    j.humeur = hum;

    let baseE = P.energie.m, effE = 0;
    if (reg?.genre === 'manie') baseE = 9; if (reg?.genre === 'depressif') baseE -= (profil === 'bipolarite' ? 3.5 : 1);
    effE += 0.35 * (j.sommeil_h - sm);
    if (profil === 'tdah' && nuitsCourtes >= 2) effE -= 2.0;
    if (profil === 'tdah' && hier?.hyperfocus) effE -= 1.0;
    if (profil === 'autisme' && hier?.social) effE -= 2.5;
    if (profil === 'autisme' && J[t - 2]?.social) effE -= 1.0;
    if (profil === 'autisme' && j.surcharge) effE -= 2.0;
    const e = baseE + P.energie.phi * (ene - baseE) + effE + normale(r, 0, P.energie.sd * Math.sqrt(1 - P.energie.phi ** 2));
    ene = clip(e, 1, 10);
    j.energie = ene;

    /* ---- le marqueur de langage (probabilité latente d'un mot absolu) ---- */
    let pAbs = 0.02;
    if (profil === 'depression') pAbs = 0.018 + 0.0035 * (5 - hum) * 2;      // r ≈ −0,4 après bruit
    else if (profil === 'anxiete') pAbs = 0.02 + 0.002 * (6 - hum);           // r ≈ −0,25 : sous le seuil
    else pAbs = 0.02 + 0.0008 * (6 - hum);                                     // r ≈ −0,1 : bruit
    if (j.dereel && profil === 'derealisation') pAbs += 0.02;                  // +2 pour 100 mots
    j.p_absolus = clip(pAbs, 0.002, 0.12);
    J.push(j);
  }
  return { jours: J, episodes: ep, sousTypeSommeil };
}

/* ---------------------------------------------------------------------- */
/* La couche observée                                                      */
/* ---------------------------------------------------------------------- */
function observer(profil, lat, T, manquants, mode, r) {
  const L = lat.jours;
  const k = unif(r, 0.7, 1.2);                       // style de réponse
  const pente = unif(r, -1, 1);                      // dérive sur 180 j
  const marche = r() < 0.3 ? { t: entier(r, 30, Math.max(31, T - 30)), d: r() < 0.5 ? 1 : -1 } : null;
  /* Écrit-on aujourd'hui ? Modèle logistique sur le latent (MNAR), ou MCAR. */
  const ecrit = new Array(T).fill(1);
  if (manquants > 0) {
    const cible = manquants * (profil === 'autisme' ? 0.5 : 1);
    if (mode === 'mcar') {
      for (let t = 0; t < T; t++) ecrit[t] = bern(r, 1 - cible);
    } else {
      // alpha par bissection pour atteindre le taux marginal cible, avec les MÊMES uniformes
      const U = Array.from({ length: T }, () => r());
      const persist = profil === 'tdah' ? Math.log(4) : Math.log(3);
      const simuler = alpha => {
        const e = new Array(T).fill(1); let n = 0;
        for (let t = 0; t < T; t++) {
          const j = L[t];
          let z = alpha + 0.26 * (j.humeur - 6) + (j.regime || j.dereel ? Math.log(0.5) : 0)
            + (nuitDeSortie(t) ? Math.log(0.7) : 0) + Math.log(0.7) * (t / 180) + (t > 0 && e[t - 1] ? persist : 0);
          if (profil === 'bipolarite' && j.regime === 'manie') z += Math.log(0.5);
          const p = 1 / (1 + Math.exp(-z));
          e[t] = U[t] < p ? 1 : 0; n += 1 - e[t];
        }
        return { e, taux: n / T };
      };
      let lo = -8, hi = 8, res = null;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; res = simuler(mid); if (res.taux > cible) lo = mid; else hi = mid; }
      for (let t = 0; t < T; t++) ecrit[t] = res.e[t];
    }
    // un trou long (vacances) : 7–14 jours, p 0,5 par 180 j
    if (r() < 0.5 * T / 180) { const a = entier(r, 5, Math.max(6, T - 15)), d = entier(r, 7, 14); for (let t = a; t < Math.min(T, a + d); t++) ecrit[t] = 0; }
  }
  /* trous des capteurs */
  const nuitManque = new Array(T).fill(0);
  for (let t = 0; t < T; t++) nuitManque[t] = bern(r, t > 0 && nuitManque[t - 1] ? 0.5 : 0.04);
  if (r() < 0.5 * T / 180) { const a = entier(r, 3, Math.max(4, T - 8)), d = entier(r, 3, 7); for (let t = a; t < Math.min(T, a + d); t++) nuitManque[t] = 1; }
  const digestManque = Array.from({ length: T }, (_, t) => bern(r, weekend(t) ? 0.10 : 0.05));

  const J = [];
  for (let t = 0; t < T; t++) {
    const l = L[t];
    const o = { t };
    // passives
    o.sommeil_h = nuitManque[t] ? null : Math.round(l.sommeil_h * 10) / 10;
    let cobs = null;
    if (!digestManque[t]) {
      const pasActif = bern(r, l.social ? 0.35 : 0.08);
      if (!pasActif) {
        let lat = lognorm(r, 0.5, 0.8); if (l.anxio) lat += 0.5; if (l.regime === 'manie') lat *= 0.5;
        cobs = Math.round((l.coucher - Math.min(lat, 3)) * 12) / 12;   // au pas de 5 min
      }
    }
    o.coucher = cobs;
    o.ecran_min = digestManque[t] ? null : l.ecran_min;
    o.ecrit = ecrit[t];
    // déclaratives
    if (ecrit[t]) {
      const derive = pente * t / 180 + (marche && t >= marche.t ? marche.d : 0);
      o.humeur = clip(Math.round(6 + k * (l.humeur - 6) + normale(r, 0, 0.4) + derive), 1, 10);
      o.energie = clip(Math.round(6 + k * (l.energie - 6) + normale(r, 0, 0.4) + derive), 1, 10);
      o.anxio = l.anxio; o.social = l.social; o.declencheur = l.declencheur; o.dereel = l.dereel; o.surcharge = l.surcharge;
      o.substance = l.substance && r() < 0.7 ? 1 : 0;      // sous-déclaration : sensibilité 0,7
      let mots = lognorm(r, 120, 0.7); if (l.regime === 'depressif') mots *= 0.6; if (l.anxio) mots *= 1.5;
      mots = Math.max(5, Math.round(mots));
      let n = 0; for (let i = 0; i < mots; i++) if (r() < l.p_absolus) n++;
      o.absolus = Math.round(100 * n / mots * 10) / 10;
      o.mots = mots;
    } else {
      for (const key of ['humeur', 'energie', 'anxio', 'social', 'declencheur', 'dereel', 'surcharge', 'substance', 'absolus', 'mots']) o[key] = null;
    }
    J.push(o);
  }
  /* erreurs de saisie : 5 % de blocs datés au lendemain, 2,5 % de cases échangées */
  for (let t = 0; t < T - 1; t++) {
    if (J[t].ecrit && r() < 0.05) {
      const bloc = {}; for (const key of ['humeur', 'energie', 'anxio', 'social', 'declencheur', 'dereel', 'surcharge', 'substance', 'absolus', 'mots']) { bloc[key] = J[t][key]; J[t][key] = null; }
      Object.assign(J[t + 1], bloc); J[t + 1].ecrit = 1; J[t].ecrit = 0;
    }
    if (J[t].ecrit && r() < 0.025) { const h = J[t].humeur; J[t].humeur = J[t].energie; J[t].energie = h; }
  }
  return J;
}

/* ---------------------------------------------------------------------- */
/* La vérité terrain, émise par patient                                    */
/* ---------------------------------------------------------------------- */
function verite(profil, lat, obs, T) {
  const V = [];
  const ep = lat.episodes;
  const edge = (a, b, signe, lag) => V.push({ type: 'edge', a, b, signe, lag });
  const chain = etats => V.push({ type: 'chain', etats });
  // commun à tous : se coucher tard raccourcit la nuit ; la semaine a une forme (sauf autisme)
  edge('coucher', 'sommeil_h', '-', 1);
  if (profil !== 'autisme') V.push({ type: 'rhythm', periode: 7 });
  for (const e of ep) {
    if (e.t0 >= 6 && e.t0 <= T - 6) V.push({ type: 'episode', genre: e.genre, t0: e.t0, t1: e.t1 });
    if (e.t0 >= 29) { V.push({ type: 'ews', t0: e.t0, var: 'humeur' }); if (e.genre === 'manie') V.push({ type: 'ews', t0: e.t0, var: 'sommeil_h' }); }
  }
  switch (profil) {
    case 'temoin':
      edge('sommeil_h', 'humeur', '+', 0); break;
    case 'depression':
      V.push({ type: 'autocorr', classe: 'high' });
      edge('sommeil_h', 'humeur', '+', 0); edge('social', 'humeur', '+', 0);
      V.push({ type: 'language', avec: 'humeur' }); break;
    case 'anxiete':
      chain(['declencheur', 'anxio', 'sommeil_court', 'humeur_bas']);
      edge('anxio', 'sommeil_h', '-', 1); edge('sommeil_h', 'humeur', '+', 0);
      edge('anxio', 'substance', '+', 0); edge('anxio', 'humeur', '-', 0); break;
    case 'bipolarite':
      for (const e of ep) if (e.genre === 'manie') V.push({ type: 'coupling_sign', a: 'sommeil_h', b: 'humeur', signe: '-', de: e.t0, a_jour: e.t1 });
      break;
    case 'tdah':
      V.push({ type: 'autocorr', classe: 'low' });
      V.push({ type: 'regularity', var: 'coucher', classe: 'haute' });
      chain(['ecran_haut', 'coucher_tard', 'sommeil_court', 'energie_bas']);
      edge('sommeil_h', 'energie', '+', 0); edge('ecran_min', 'coucher', '+', 0); edge('declencheur', 'humeur', '-', 0); break;
    case 'autisme':
      V.push({ type: 'regularity', var: 'coucher', classe: 'basse' });
      chain(['social', 'energie_bas', 'humeur_bas']); chain(['surcharge', 'energie_bas', 'anxio']);
      edge('social', 'energie', '-', 1); edge('surcharge', 'social', '-', 1); edge('declencheur', 'anxio', '+', 1); break;
    case 'derealisation':
      chain(['sommeil_court', 'sommeil_court', 'dereel']);
      edge('dereel', 'humeur', '-', 0); edge('substance', 'dereel', '+', 1); edge('dereel', 'anxio', '+', 0);
      V.push({ type: 'language', avec: 'dereel' }); break;
    case 'calib_mixte':
      chain(['declencheur', 'substance', 'sommeil_court']);
      edge('social', 'humeur', '+', 0);
      V.push({ type: 'regularity', var: 'coucher', classe: 'haute' }); break;
  }
  /* réalisé & observable : une chaîne ne compte que si elle s'est produite ≥ 3 fois dans l'OBSERVÉ */
  const etats = etatsDe(obs);
  for (const v of V) {
    if (v.type === 'chain') { v.occurrences = compterChaine(etats, v.etats); v.lifts = liftsMaillons(etats, v.etats); v.realise = v.occurrences >= 3 && Math.min(...v.lifts) >= 1.5; }
    else v.realise = true;
  }
  return V;
}

/**
 * @param {object} o  { profil, famille, T, manquants (0|0.15|0.35), mode ('mnar'|'mcar'), index }
 * @returns serie = { profil, T, manquants, mode, jours (observés), latent (jours latents), verite }
 */
export function generer({ profil, famille = 'test-1', T = 180, manquants = 0.15, mode = 'mnar', index = 0 }) {
  if (!PROFILS[profil]) throw new Error('profil inconnu : ' + profil);
  const r = rngDe(famille, profil, T, manquants, mode, index);
  const lat = simulerLatent(profil, T, r);
  const jours = observer(profil, lat, T, manquants, mode, r);
  const V = verite(profil, lat, jours, T);
  return { profil, T, manquants, mode, famille, index, jours, latent: lat.jours, episodes: lat.episodes, verite: V };
}

/** La série « propre » : le latent tel quel, sans manquant ni bruit — le plafond. */
export function seriePropre(serie) {
  const jours = serie.latent.map(l => ({
    t: l.t, sommeil_h: Math.round(l.sommeil_h * 10) / 10, coucher: Math.round(l.coucher * 12) / 12, ecran_min: l.ecran_min, ecrit: 1,
    humeur: clip(Math.round(l.humeur), 1, 10), energie: clip(Math.round(l.energie), 1, 10),
    anxio: l.anxio, social: l.social, declencheur: l.declencheur, dereel: l.dereel, surcharge: l.surcharge, substance: l.substance,
    absolus: Math.round(100 * l.p_absolus * 10) / 10, mots: 120,
  }));
  return { ...serie, jours, propre: true };
}

/* auto-test : node generateur.mjs --verifier */
if (process.argv[1] && process.argv[1].endsWith('generateur.mjs') && process.argv.includes('--verifier')) {
  const { PROFILS_TEST } = await import('./profils.mjs');
  for (const profil of [...PROFILS_TEST, 'calib_mixte']) {
    const s = generer({ profil, T: 180, manquants: 0.15 });
    const nn = s.jours.filter(j => j.ecrit).length;
    const moy = k => { const v = s.jours.map(j => j[k]).filter(x => x != null); return (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2); };
    console.log(`${profil.padEnd(14)} écrits ${nn}/180  humeur ${moy('humeur')}  sommeil ${moy('sommeil_h')}  coucher ${moy('coucher')}  épisodes ${JSON.stringify(s.episodes.map(e => [e.genre, e.t0, e.t1]))}`);
    console.log('   vérité :', s.verite.map(v => v.type + (v.type === 'chain' ? `(${v.etats.join('>')}: ${v.occurrences}${v.realise ? '' : ' NON RÉALISÉ'})` : v.type === 'edge' ? `(${v.a}→${v.b}${v.signe}${v.lag})` : v.type === 'episode' ? `(${v.genre}@${v.t0})` : v.type === 'ews' ? `(@${v.t0}:${v.var})` : '')).join(' · '));
  }
}
