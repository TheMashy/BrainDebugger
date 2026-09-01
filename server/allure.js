/*
 * =====================================================================
 * L'ALLURE D'UNE JOURNÉE : SA NUIT, ET LA FORME DE SON ORDINATEUR.
 *
 * Les mesures arrivaient et restaient des séries : « sommeil_h 5,4 »,
 * « temps_par_contexte_s_navigateur 22 400 », « bascules 142 ». Chacune vraie,
 * aucune lisible. On ne se demande pas « combien de bascules » — on se demande
 * « j'ai mal dormi ? » et « ma journée est passée où ? ».
 *
 * ---------------------------------------------------------------------
 * DEUX RÈGLES QUI TIENNENT TOUT LE FICHIER.
 *
 * 1. ON COMPARE À SA PROPRE NORMALE, JAMAIS À UNE NORME.
 *
 *    « Tu as dormi 6 h, c'est insuffisant » est un verdict emprunté à une
 *    moyenne de population qui n'est pas la sienne. « Une heure et demie de
 *    moins que d'habitude » est un fait, vérifiable contre son propre souvenir,
 *    et c'est celui-là qui apprend quelque chose. La médiane de SES nuits est
 *    la seule référence honnête ; toutes les phrases d'ici en sortent.
 *
 * 2. UN ARCHÉTYPE DÉCRIT UN USAGE D'ORDINATEUR, JAMAIS UNE PERSONNE.
 *
 *    Ce produit refuse depuis le premier jour de poser une étiquette sur
 *    quelqu'un : « une étiquette posée par une machine s'installe dans la tête
 *    et ne s'enlève plus. » Un archétype ne dit pas qui on est ni comment on
 *    va. Il dit à quoi ressemble une journée de machine, à partir de ce que la
 *    machine a compté — et il montre toujours les chiffres qui l'ont produit,
 *    pour qu'on puisse ne pas être d'accord.
 *
 *    « Navigation continue » n'est pas « tu procrastines ». La différence n'est
 *    pas une nuance de vocabulaire, c'est toute la limite du produit.
 *
 * ---------------------------------------------------------------------
 * ET ON NE DEVINE PAS. Les clés appartiennent à l'application qui envoie : on
 * les reconnaît par familles de mots, et ce qu'on ne reconnaît pas ne devient
 * pas une supposition — la section reste simplement vide. Une nuit inventée
 * vaut moins que pas de nuit.
 * =====================================================================
 */

/* ------------------------------ les outils ------------------------------ */

/** La médiane, qui résiste à une nuit de douze heures ; la moyenne, non. */
export function mediane(xs) {
  const v = xs.filter(x => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
}

/** « 08:23 » -> 503 minutes. Rien d'autre n'est accepté : on ne devine pas une heure. */
export function enMinutes(t) {
  const m = /^(\d{1,2})\s*[:hH]\s*(\d{2})?$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mn = Number(m[2] ?? 0);
  if (h > 23 || mn > 59) return null;
  return h * 60 + mn;
}

/**
 * L'heure du COUCHER se compare autour de minuit, pas autour de midi.
 *
 * Se coucher à 23 h 50 et à 00 h 10 sont vingt minutes d'écart ; en minutes
 * depuis minuit ce sont 1 420 et 10, soit vingt-trois heures. Une médiane
 * calculée là-dessus tombe en plein après-midi et toutes les phrases qui en
 * sortent sont fausses. On recentre donc la nuit : au-delà de midi, on compte
 * en négatif depuis minuit.
 */
export const surLaNuit = min => (min == null ? null : (min >= 720 ? min - 1440 : min));

/** L'inverse, pour réafficher une heure : -20 -> 23:40. */
export const enHeure = min => {
  if (min == null) return null;
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** « 1 h 40 », « 25 min ». Sans signe : le sens est porté par la phrase. */
export function duree(min) {
  const m = Math.abs(Math.round(min ?? 0));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h} h ${String(r).padStart(2, '0')}` : `${h} h`;
}

/* --------------------------- reconnaître les clés --------------------------- */

/*
 * LES FAMILLES DE MOTS. Ce ne sont pas des noms de clés attendus, ce sont des
 * MORCEAUX : une clé compte si elle en contient un. `sommeil_h`,
 * `sleep_duration`, `nuit_duree_h` tombent toutes dans la même famille sans
 * qu'on ait rien publié.
 */
const DUREE_NUIT = ['sommeil', 'sleep', 'nuit'];
export const COUCHER = ['coucher', 'endormi', 'bedtime', 'bed_time', 'sleep_start'];
export const LEVER = ['lever', 'reveil', 'wake', 'sleep_end'];
/* Les heures d'ACTIVITÉ de la machine. Ce ne sont pas des heures de sommeil, et
   on ne les fera jamais passer pour telles — mais quand rien d'autre n'existe,
   « dernière activité 01 h 40 » dit quelque chose de la nuit. */
export const DERNIERE = ['derniere_activite', 'last_activity', 'derniere_action'];
export const PREMIERE = ['premiere_activite', 'first_activity', 'premiere_action'];

export const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export const contient = (cle, mots) => { const k = norm(cle); return mots.some(m => k.includes(m)); };

/** La première mesure du jour dont la clé tombe dans la famille. */
const trouver = (mesures, mots, { texte = false } = {}) =>
  (mesures ?? []).find(m => contient(m.cle, mots) && (texte ? m.texte != null : m.valeur != null)) ?? null;

/** Une durée de nuit en MINUTES, quelle que soit l'unité annoncée. */
function nuitEnMinutes(m) {
  if (!m || m.valeur == null) return null;
  const k = norm(m.cle), u = norm(m.unite);
  // L'unité déclarée l'emporte sur le nom ; à défaut, le nom ; à défaut, la
  // grandeur décide — sept heures ne s'écrivent pas « 7 » et « 420 » au hasard.
  if (u === 'min' || /_min\b|_min$|minute/.test(k)) return m.valeur;
  if (u === 'h' || /_h\b|_h$|heure|hour/.test(k)) return m.valeur * 60;
  if (u === 's' || /_s\b|_s$/.test(k)) return m.valeur / 60;
  return m.valeur > 24 ? m.valeur : m.valeur * 60;
}

/* ------------------------------ le sommeil ------------------------------ */

/** Au-delà, ce n'est plus « comme d'habitude » ni « pas comme d'habitude ». */
export const ECART_NOTABLE = 45;      // minutes, sur la durée
export const ECART_HEURE = 45;        // minutes, sur une heure de coucher ou de lever

/**
 * LA NUIT D'UNE JOURNÉE, SITUÉE.
 *
 * Trois choses au plus — combien de temps, couché quand, levé quand — et pour
 * chacune l'écart à SA médiane. Ce qui manque ne s'invente pas : une nuit sans
 * durée mesurée rend `duree: null`, et l'écran n'affiche rien plutôt qu'un
 * zéro qui aurait l'air d'une nuit blanche.
 *
 * @param {Array} duJour   les mesures de la journée
 * @param {Array} toutes   les mesures de la fenêtre, pour les médianes
 */
export function nuitDe(duJour, toutes = []) {
  const parJour = new Map();
  for (const m of toutes ?? []) {
    if (!parJour.has(m.date)) parJour.set(m.date, []);
    parJour.get(m.date).push(m);
  }
  const jours = [...parJour.values()];

  /* --- la durée --- */
  const dm = trouver(duJour, DUREE_NUIT);
  const duree = nuitEnMinutes(dm);
  const dureeMed = mediane(jours.map(j => nuitEnMinutes(trouver(j, DUREE_NUIT))));

  /* --- le coucher et le lever ---
     Mesurés s'ils existent ; sinon l'activité de la machine, et on DIT que
     c'est elle. Faire passer « dernière activité » pour « coucher » serait
     inventer une heure d'endormissement qu'aucune montre n'a relevée. */
  const heureDe = (mesures, mots, secours) => {
    const vrai = trouver(mesures, mots, { texte: true });
    if (vrai) return { min: enMinutes(vrai.texte), mesure: true };
    const proxy = trouver(mesures, secours, { texte: true });
    if (proxy) return { min: enMinutes(proxy.texte), mesure: false };
    return { min: null, mesure: false };
  };
  const c = heureDe(duJour, COUCHER, DERNIERE);
  const l = heureDe(duJour, LEVER, PREMIERE);

  const medCoucher = mediane(jours.map(j => surLaNuit(heureDe(j, COUCHER, DERNIERE).min)));
  const medLever = mediane(jours.map(j => heureDe(j, LEVER, PREMIERE).min));

  const ecart = (v, m) => (v == null || m == null ? null : Math.round(v - m));

  const nuit = {
    duree, dureeMediane: dureeMed == null ? null : Math.round(dureeMed),
    dureeEcart: ecart(duree, dureeMed),
    coucher: c.min == null ? null : enHeure(c.min), coucherMesure: c.mesure,
    coucherEcart: ecart(surLaNuit(c.min), medCoucher),
    lever: l.min == null ? null : enHeure(l.min), leverMesure: l.mesure,
    leverEcart: ecart(l.min, medLever),
    n: jours.length
  };
  nuit.dit = phrasesDeLaNuit(nuit);
  return (nuit.duree != null || nuit.coucher != null || nuit.lever != null) ? nuit : null;
}

/**
 * CE QU'ON EN DIT, ET CE QU'ON N'EN DIT PAS.
 *
 * « Trop dormi », « pas assez » sont des verdicts : ils supposent une bonne
 * quantité, et personne ici n'est en position de la fixer. « Une heure trente
 * de plus que d'habitude » porte la même information — plus précisément, même —
 * et laisse la personne décider si c'est trop.
 *
 * Rien n'est dit quand rien ne dépasse : une nuit comme les autres n'a pas
 * besoin d'une phrase, et en écrire une chaque matin apprend à ne plus les
 * lire.
 */
export function phrasesDeLaNuit(n) {
  const out = [];
  if (n.dureeEcart != null && Math.abs(n.dureeEcart) >= ECART_NOTABLE) {
    out.push({ quoi: 'duree', sens: n.dureeEcart > 0 ? 'plus' : 'moins',
               texte: `${duree(n.dureeEcart)} de ${n.dureeEcart > 0 ? 'plus' : 'moins'} que d'habitude` });
  }
  if (n.coucherEcart != null && Math.abs(n.coucherEcart) >= ECART_HEURE) {
    const tard = n.coucherEcart > 0;
    out.push({ quoi: 'coucher', sens: tard ? 'tard' : 'tot',
               mesure: n.coucherMesure,
               texte: `${n.coucherMesure ? 'couché' : 'dernière activité'} ${duree(n.coucherEcart)} `
                    + `plus ${tard ? 'tard' : 'tôt'} que d'habitude` });
  }
  if (n.leverEcart != null && Math.abs(n.leverEcart) >= ECART_HEURE) {
    const tard = n.leverEcart > 0;
    out.push({ quoi: 'lever', sens: tard ? 'tard' : 'tot',
               mesure: n.leverMesure,
               texte: `${n.leverMesure ? 'levé' : 'première activité'} ${duree(n.leverEcart)} `
                    + `plus ${tard ? 'tard' : 'tôt'} que d'habitude` });
  }
  return out;
}

/* ------------------------------ les archétypes ------------------------------ */

/*
 * LES CONTEXTES, PAR FAMILLES. Machi Tool envoie ses propres noms — « code »,
 * « navigateur », « jeu » — et une autre application en enverra d'autres. On
 * range par mots reconnus ; ce qui n'est pas reconnu va dans `autre` et ne
 * pèse sur aucun archétype, ce qui est la bonne façon de ne pas se tromper.
 */
const FAMILLES = {
  nav:     ['navigateur', 'browser', 'web', 'chrome', 'firefox', 'safari', 'edge'],
  travail: ['code', 'dev', 'ide', 'terminal', 'editeur', 'editor', 'travail', 'work',
            'design', 'blender', 'premiere', 'photoshop', 'creation'],
  social:  ['social', 'chat', 'discord', 'slack', 'message', 'mail', 'whatsapp', 'telegram'],
  video:   ['video', 'youtube', 'netflix', 'twitch', 'stream'],
  jeu:     ['jeu', 'game', 'steam'],
  musique: ['musique', 'music', 'spotify', 'deezer']
};

/** Les secondes passées par famille, à partir des clés `temps_par_contexte_*`. */
export function contextes(duJour) {
  const out = { nav: 0, travail: 0, social: 0, video: 0, jeu: 0, musique: 0, autre: 0 };
  for (const m of duJour ?? []) {
    if (m.valeur == null) continue;
    const k = norm(m.cle);
    if (!k.includes('temps') && !k.includes('contexte') && !k.includes('duree_app')) continue;
    /*
     * TOUT SE COMPTE EN SECONDES. La clé porte son unité (`temps_par_contexte_s`,
     * `duree_app_min`) ; sans elle, on suppose des secondes, qui est ce
     * qu'envoient les traqueurs d'activité. Additionner des minutes et des
     * secondes dans le même total donnerait des parts fausses sans rien lever.
     */
    const sec = /_min(_|$)/.test(k) ? m.valeur * 60
              : /_h(_|$)/.test(k) ? m.valeur * 3600
              : m.valeur;
    const fam = Object.keys(FAMILLES).find(f => FAMILLES[f].some(mot => k.includes(mot)));
    out[fam ?? 'autre'] += sec;
  }
  out.total = Object.values(out).reduce((a, b) => a + b, 0);
  return out;
}

/**
 * LES ARCHÉTYPES, ET CE QU'ILS SONT.
 *
 * Chacun a une CONDITION mesurable et une PREUVE : les chiffres qui l'ont
 * produit partent avec lui, parce qu'une étiquette sans ses chiffres ne peut
 * pas être contestée — et celle-ci doit pouvoir l'être.
 *
 * Les seuils sont posés à la main et se comparent à SA propre médiane partout
 * où c'est possible. « Beaucoup de bascules » ne veut rien dire dans l'absolu :
 * quarante par jour est énorme pour quelqu'un et calme pour un autre.
 */
export const ARCHETYPES = ['doomscroll', 'curieux', 'productif', 'social', 'repose'];

export const NOM_ARCHETYPE = {
  doomscroll: 'navigation continue',
  curieux:    'curieux',
  productif:  'concentré',
  social:     'tourné vers les autres',
  repose:     'reposé'
};

/** Un multiplicateur, à la française : « 2,2× », jamais « 2.2× ». */
const fois = x => `${x.toFixed(1).replace('.', ',')}×`;

/** Une part, protégée du zéro : sans total, il n'y a pas de part, pas 0 %. */
const part = (x, total) => (total > 0 ? x / total : null);

/**
 * @param {Array} duJour  les mesures de la journée
 * @param {Array} toutes  les mesures de la fenêtre, pour les médianes
 * @returns {{cle, nom, force, preuves} | null}
 */
export function archetypeDe(duJour, toutes = []) {
  const c = contextes(duJour);
  // Sous vingt minutes d'ordinateur, il n'y a pas de forme à décrire. On ne
  // qualifie pas une journée sur trois clics.
  if (!c.total || c.total < 20 * 60) return null;

  const parJour = new Map();
  for (const m of toutes ?? []) {
    if (!parJour.has(m.date)) parJour.set(m.date, []);
    parJour.get(m.date).push(m);
  }
  const jours = [...parJour.values()];

  const val = (mesures, mots) => trouver(mesures, mots)?.valeur ?? null;
  const bascules = val(duJour, ['bascule', 'switch']);
  const medBascules = mediane(jours.map(j => val(j, ['bascule', 'switch'])));
  const medTotal = mediane(jours.map(j => contextes(j).total || null));

  const pNav = part(c.nav + c.video, c.total);
  const pTravail = part(c.travail, c.total);
  const pSocial = part(c.social, c.total);
  const agite = bascules != null && medBascules ? bascules / medBascules : null;
  const court = medTotal ? c.total / medTotal : null;

  const min = s => Math.round(s / 60);
  const preuve = (quoi, valeur) => ({ quoi, valeur });

  const scores = [];
  if (pNav != null && pNav >= 0.45 && (agite == null || agite >= 1.15)) {
    scores.push({ cle: 'doomscroll', force: pNav + (agite ?? 1) * 0.2, preuves: [
      preuve('navigation', `${duree(min(c.nav + c.video))} sur ${duree(min(c.total))}`),
      ...(bascules != null ? [preuve('bascules', `${bascules}${agite ? ` — ${fois(agite)} ta normale` : ''}`)] : [])
    ] });
  }
  if (pNav != null && pNav >= 0.4 && agite != null && agite <= 0.85) {
    scores.push({ cle: 'curieux', force: pNav + (1 - agite) * 0.4, preuves: [
      preuve('navigation', `${duree(min(c.nav + c.video))} sur ${duree(min(c.total))}`),
      preuve('bascules', `${bascules} — ${fois(agite)} ta normale, tu es resté dans ce que tu lisais`)
    ] });
  }
  if (pTravail != null && pTravail >= 0.45 && (agite == null || agite <= 1.1)) {
    scores.push({ cle: 'productif', force: pTravail + (agite == null ? 0 : (1.1 - agite) * 0.3), preuves: [
      preuve('outils de travail', `${duree(min(c.travail))} sur ${duree(min(c.total))}`),
      ...(bascules != null ? [preuve('bascules', `${bascules}${agite ? ` — ${fois(agite)} ta normale` : ''}`)] : [])
    ] });
  }
  if (pSocial != null && pSocial >= 0.3) {
    scores.push({ cle: 'social', force: pSocial + 0.25, preuves: [
      preuve('échanges', `${duree(min(c.social))} sur ${duree(min(c.total))}`)
    ] });
  }
  if (court != null && court <= 0.6) {
    scores.push({ cle: 'repose', force: 1.2 - court, preuves: [
      preuve('devant l’écran', `${duree(min(c.total))} — ${Math.round(court * 100)} % d'une journée ordinaire`)
    ] });
  }

  if (!scores.length) return null;
  scores.sort((a, b) => b.force - a.force);
  const g = scores[0];
  return { cle: g.cle, nom: NOM_ARCHETYPE[g.cle], force: Math.round(g.force * 100) / 100,
           preuves: g.preuves };
}

/**
 * LE DIGEST EN UNE LIGNE.
 *
 * Le JSON brut est replié derrière un clic depuis toujours, ce qui est juste —
 * mais la ligne qui le referme ne disait que « 7 champs ». Sept champs de quoi ?
 * On résume donc ce qu'il y a dedans avec les trois ou quatre chiffres qui
 * portent la journée, et le brut reste là, entier, pour qui veut vérifier.
 */
export function resumeDuJour(duJour) {
  const c = contextes(duJour);
  const bouts = [];
  if (c.total) bouts.push(`${duree(Math.round(c.total / 60))} d'écran`);
  const fam = Object.entries(c)
    .filter(([k]) => k !== 'total' && k !== 'autre')
    .sort((a, b) => b[1] - a[1])[0];
  if (fam && fam[1] > 0 && c.total) {
    const NOMS = { nav: 'navigateur', travail: 'travail', social: 'échanges',
                   video: 'vidéo', jeu: 'jeu', musique: 'musique' };
    bouts.push(`${Math.round(fam[1] / c.total * 100)} % ${NOMS[fam[0]]}`);
  }
  const b = trouver(duJour, ['bascule', 'switch']);
  if (b?.valeur != null) bouts.push(`${b.valeur} bascules`);
  const p = trouver(duJour, ['pauses_nombre', 'pause_nombre', 'breaks']);
  if (p?.valeur != null) bouts.push(`${p.valeur} pauses`);
  return bouts.join(' · ');
}


/**
 * CETTE SÉRIE A-T-ELLE DÉJÀ ÉTÉ DITE PLUS HAUT ?
 *
 * `temps_par_contexte_s_navigateur`, `bascules`, `pauses_nombre`,
 * `premiere_activite` : ce sont les rouages de la nuit et de l'archétype. Une
 * fois qu'on a écrit « navigation continue — 6 h 09 sur 8 h 17, 177 bascules »,
 * les afficher chacun en carte fait dix cartes qui répètent la phrase du
 * dessus, et la page devient le mur de chiffres qu'on essayait d'éviter.
 *
 * Elles ne DISPARAISSENT pas — elles arrivent, elles ont le droit d'être vues,
 * et les cacher ferait croire qu'elles n'ont pas été reçues. Elles se replient,
 * ce qui n'est pas la même chose.
 *
 * Ce qui reste ouvert : ce qui se mesure sur un CORPS — le sommeil, le poids,
 * les pas, le cœur — et tout ce qui n'a pas été reconnu, parce qu'on ne replie
 * pas ce qu'on n'a pas compris.
 */
export function estDetail(cle) {
  const k = norm(cle);
  return contient(k, ['temps', 'contexte', 'duree_app'])
      || contient(k, ['bascule', 'switch'])
      || contient(k, ['pause', 'break'])
      || contient(k, DERNIERE) || contient(k, PREMIERE);
}
