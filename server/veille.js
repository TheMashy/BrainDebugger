/*
 * =====================================================================
 * LA VEILLE : DEUX SIGNES, ET RIEN D'AUTRE.
 *
 * « Détecter des patterns destructeurs, des dangers, des périodes à risque. »
 * C'est le premier mot du produit, et jusqu'ici la seule chose qui s'en
 * approchait était une pastille « crise 5 » à côté de « création 3 » — le même
 * poids visuel pour cinq passages sur une crise et trois sur un projet.
 *
 * Deux niveaux, pas plus :
 *   JAUNE  le suicide a été évoqué
 *   ROUGE  il y a eu une blessure
 *
 * ---------------------------------------------------------------------
 * CE QUE CE FICHIER NE FAIT PAS.
 *
 * Il ne diagnostique rien, il ne prédit rien, il n'évalue personne. Il COMPTE
 * ce que la personne a écrit elle-même, et il montre la phrase qui a déclenché
 * le signe. C'est la seule forme sous laquelle une alerte est acceptable ici :
 * vérifiable, et donc contestable.
 *
 * Un signe sans sa preuve serait un verdict de machine. Avec sa preuve, c'est
 * un rappel de ce qu'on a écrit — et si le signe est faux, ça se voit tout de
 * suite, ce qui est exactement ce qu'il faut pour qu'on continue à le croire
 * quand il est juste.
 *
 * ---------------------------------------------------------------------
 * L'ASYMÉTRIE, QUI DÉCIDE DES SEUILS.
 *
 * Manquer un rouge, c'est manquer la seule chose que cette application a promis
 * de voir. En poser un faux, c'est apprendre à quelqu'un à ignorer ses propres
 * alertes — et un signe qu'on ignore ne sert plus à rien le jour où il est
 * vrai. Les deux coûtent cher, et pas de la même façon.
 *
 * D'où la règle : le JAUNE est large — parler de suicide, même de loin, mérite
 * une trace. Le ROUGE est étroit — il demande soit un mot qui ne peut rien
 * vouloir dire d'autre (« scarification »), soit une blessure ET un contexte de
 * crise dans la même journée. « Je me suis coupé en cuisinant » n'est pas une
 * blessure de ce fichier.
 * =====================================================================
 */

import { messagesForDate } from './db.js';

const norm = s => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/* ---------------------------------------------------------------------
 * NIVEAU JAUNE : le suicide évoqué.
 *
 * Large exprès. Une question au compagnon — « de quoi le suicide est
 * mauvais ? » — compte : ce n'est pas un passage à l'acte, ce n'est pas non
 * plus une journée comme une autre, et c'est très exactement ce qu'un signe
 * jaune veut dire.
 * ------------------------------------------------------------------ */
const SUICIDE = [
  'suicide', 'suicidaire', 'suicider', 'me tuer', 'me foutre en l air',
  'en finir', 'plus envie de vivre', 'envie de mourir', 'envie de crever',
  'autolyse', 'ideation', 'ideations', 'tentative de suicide',
  'passage a l acte', 'me pendre', 'me jeter'
];
/* « TS » est une abréviation et pas un mot : elle ne se cherche qu'entourée de
   frontières, sans quoi « ts » attrape la moitié du dictionnaire. */
const SUICIDE_SIGLES = /\bts\b/;

/* ---------------------------------------------------------------------
 * JAUNE AUSSI : UN MOYEN À PORTÉE.
 *
 * « Là je suis devant l'ordi, je joue avec un couteau et je te parle », écrit à
 * 5 h 53. Pas un mot de suicide, pas de blessure — la première version de ce
 * fichier ne voyait donc RIEN. C'est pourtant le signe le plus concret qu'un
 * texte puisse porter : un moyen, à portée de main, maintenant.
 *
 * Il faut les DEUX : l'objet et la proximité. « J'ai acheté un couteau de
 * cuisine » n'est pas « j'ai un couteau à côté ». C'est cette paire qui fait la
 * différence entre un objet mentionné et un objet tenu.
 * ------------------------------------------------------------------ */
const MOYEN = ['couteau', 'cutter', 'lame', 'rasoir', 'ciseaux', 'corde',
               'boite de cachets', 'boite de medicaments', 'plaquette', 'flingue', 'arme'];
const A_PORTEE = ['a cote', 'a portee', 'dans la main', 'dans les mains', 'je joue avec',
                  'je tiens', 'je le garde', 'je la garde', 'devant moi', 'sur la table',
                  'sous mon lit', 'dans ma poche', 'je le touche', 'je regarde la'];

/* ---------------------------------------------------------------------
 * JAUNE ENCORE : la déréalisation, quand elle se NOMME.
 *
 * On ne détecte que ce qui se dit en toutes lettres. Reconnaître un état
 * dissociatif à la syntaxe d'un message — les phrases qui se percutent, le
 * passage à la troisième personne sur soi-même — se ferait à coups de faux
 * positifs sur n'importe quel texte écrit vite, un soir, sans ponctuation. Une
 * alerte qui se déclenche parce qu'on tape mal est une alerte qu'on éteint.
 * ------------------------------------------------------------------ */
const DEREALISATION = [
  'dereal', 'derealisation', 'depersonnalisation', 'depersonnalise',
  'irreel', 'pas vraiment la', 'pas vraiment reel', 'comme dans un reve',
  'comme un film', 'je me regarde de loin', 'je me vois de l exterieur',
  'plus dans mon corps', 'plus dans mon propre corps', 'decale de la realite',
  'dans du coton', 'brouillard', 'plus rien n est reel', 'je sais plus ce qui est reel'
];

/* ---------------------------------------------------------------------
 * NIVEAU ROUGE : une blessure a eu lieu.
 * ------------------------------------------------------------------ */

/** Ce qui ne peut rien vouloir dire d'autre. Un seul de ces mots suffit. */
const BLESSURE_CERTAINE = [
  'scarification', 'scarifications', 'scarifie', 'scarifiee', 'scarifier',
  'automutilation', 'automutile', 'auto mutilation',
  'me suis taillade', 'me suis mutile', 'me suis mutilee',
  'me taillade', 'me mutile'
];

/**
 * Ce qui peut être un accident. Ne compte qu'accompagné d'un contexte de crise
 * dans la même journée — sans quoi une cuisine devient une urgence.
 */
const BLESSURE_POSSIBLE = [
  'me suis coupe', 'me suis coupee', 'me suis brule', 'me suis brulee',
  'me suis fait mal', 'me suis fait du mal', 'me suis frappe', 'me suis cogne',
  'j ai saigne', 'ca saignait', 'entaille', 'entailles', 'coupures'
];

/**
 * LE CONTEXTE QUI FAIT BASCULER UNE BLESSURE POSSIBLE EN ROUGE.
 *
 * Ce n'est pas « des mots tristes » : c'est le vocabulaire de la crise déjà
 * défini pour la frise, plus l'intention de se faire du mal. Une coupure dans
 * une journée qui parle de suicide n'est pas la même coupure que dans une
 * journée qui parle de recette.
 */
const CONTEXTE_CRISE = [
  ...SUICIDE, 'crise', 'angoisse', 'panique', 'craque', 'craquer', 'effondre',
  'me punir', 'me faire du mal', 'me faire mal', 'je vais pas bien',
  'je tiens plus', 'j en peux plus'
];
/*
 * ET LES OBJETS N'EN FONT PAS PARTIE — c'est un vrai piège, attrapé par un
 * test. « Lame » était à la fois une blessure possible ET un contexte de
 * crise : la phrase se validait donc ELLE-MÊME et passait au rouge. « Il faut
 * que je change les lames du rasoir » devenait une alerte rouge.
 *
 * Un objet à portée est désormais son propre genre (`moyen`, en jaune). Ce qui
 * fait basculer une blessure ambiguë au rouge, c'est un état — pas un ustensile.
 */

/* ---------------------------------------------------------------------
 * UN FAIT ANCIEN RACONTÉ N'EST PAS UNE BLESSURE DE CE JOUR-LÀ.
 *
 * « Le lendemain de ma scarification en mai, je suis allé au travail direct » :
 * la personne RACONTE, elle ne se blesse pas aujourd'hui. Compter ça comme un
 * rouge « une blessure est écrite ce jour-là », c'est le faux positif qui
 * apprend à ignorer le signe — exactement ce que l'asymétrie interdit dans
 * l'autre sens.
 *
 * On demote sur deux familles de signaux :
 *   — un PASSÉ LOINTAIN daté : un mois nommé, une année, « quand j'étais »,
 *     « à l'époque », « le lendemain de » ;
 *   — un RÉCIT D'HISTOIRE : « à savoir que », « pour info », un fait REVENU
 *     plusieurs fois (« à 3 occasions », « plusieurs fois »), « il m'est
 *     arrivé ». Quelqu'un qui donne son parcours à un soignant — « je me suis
 *     coupé à 3 occasions, dont une finale qui m'a valu l'hôpital » — raconte,
 *     il ne se blesse pas maintenant.
 *
 * Surtout PAS « hier » : une scarification d'hier soir reste un rouge (c'est un
 * test). Et un marqueur de MAINTENANT (« ce matin », « je viens de », « là »)
 * annule le doute et garde le rouge : mieux vaut un rouge de trop qu'un manqué.
 */
const RECIT_PASSE = /\b(?:en |au mois de )?(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\b|\b(?:19|20)\d{2}\b|\bil y a (?:longtemps|des annees|des mois|un an|une annee|\d+ ans?|\d+ mois|\d+ annees?)\b|\bl (?:an|annee) (?:derniere|dernier|passee|passe|d avant)\b|\bannees? (?:passees?|precedentes?|d avant)\b|\bquand j (?:etais|avais)\b|\ba l epoque\b|\bautrefois\b|\bplus jeune\b|\betant (?:petit|petite|jeune|ado|adolescent|adolescente|enfant)\b|\b(?:mon|ma) (?:adolescence|enfance)\b|\ble lendemain de\b|\bla veille de\b/;
/* Le récit d'un parcours, ou un fait qui s'est répété dans le temps. */
const RACONTE_HISTOIRE = /\ba savoir\b|\bpour (?:info|contexte|te situer|que tu saches)\b|\b(?:sache|il faut que tu saches) que\b|\bpar le passe\b|\bdans (?:le|mon) passe\b|\bmon (?:historique|parcours|vecu)\b|\bdans mon histoire\b|\bil m est arrive\b|\bca m est arrive\b|\bj ai (?:deja|longtemps)\b|\ba plusieurs reprises\b|\bplusieurs fois\b|\b(?:de nombreuses|maintes) fois\b|\b\d+ (?:fois|occasions?|reprises?)\b/;
const MAINTENANT = /\b(?:aujourd hui|ce matin|ce soir|cette nuit|ce midi|la maintenant|maintenant|a l instant|tout de suite|la tout de suite)\b|\bje viens de\b|\bje me suis coupee? la\b|\bje me taille la\b/;
const raconteLePasse = np => {
  const x = np.replace(/['’`]/g, ' ').replace(/\s+/g, ' ');
  return (RECIT_PASSE.test(x) || RACONTE_HISTOIRE.test(x)) && !MAINTENANT.test(x);
};

const dedans = (t, mots) => mots.find(m => t.includes(m)) ?? null;

/**
 * LE NIVEAU D'UN TEXTE, ET LA PHRASE QUI L'A DÉCLENCHÉ.
 *
 * On découpe en phrases pour que la preuve soit une phrase et pas six cents
 * mots : ce qu'on veut montrer, c'est ce qu'on a écrit à cet endroit-là.
 *
 * @returns {{niveau: 'rouge'|'jaune'|null, motif, extrait}}
 */
export function niveauDuTexte(texte, { contexteDuJour = '' } = {}) {
  const t = norm(texte);
  if (!t.trim()) return { niveau: null, motifs: [] };
  const phrases = String(texte).split(/(?<=[.!?…])\s+|\n+/).filter(p => p.trim());
  const ctx = norm(contexteDuJour) + ' ' + t;
  const enCrise = !!dedans(ctx, CONTEXTE_CRISE);

  const motifs = [];
  const poser = (genre, niveau, mot, p) => {
    if (motifs.some(m => m.genre === genre)) return;    // un genre, une fois
    motifs.push({ genre, niveau, mot, extrait: p.trim().slice(0, 160) });
  };

  for (const p of phrases) {
    const np = norm(p);
    // Un fait ancien RACONTÉ (« ma scarification en mai ») n'est pas une
    // blessure de ce jour-là : il devient un jaune « évoqué », pas un rouge.
    const passe = raconteLePasse(np);

    const certaine = dedans(np, BLESSURE_CERTAINE);
    if (certaine) poser(...(passe ? ['evoque_passe', 'jaune'] : ['blessure', 'rouge']), certaine, p);
    else {
      const possible = dedans(np, BLESSURE_POSSIBLE);
      // Une blessure ambiguë ne compte qu'accompagnée d'un contexte de crise ;
      // racontée au passé, elle reste un jaune « évoqué » plutôt qu'un rouge.
      if (possible && enCrise) poser(...(passe ? ['evoque_passe', 'jaune'] : ['blessure', 'rouge']), possible, p);
    }

    const s = dedans(np, SUICIDE) ?? (SUICIDE_SIGLES.test(np) ? 'ts' : null);
    if (s) poser('suicide', 'jaune', s, p);

    /* L'objet ET la proximité, dans la même phrase : c'est la paire qui
       distingue un objet mentionné d'un objet tenu. */
    const objet = dedans(np, MOYEN);
    if (objet && dedans(np, A_PORTEE)) poser('moyen', 'jaune', objet, p);

    const d = dedans(np, DEREALISATION);
    if (d) poser('dereel', 'jaune', d, p);
  }

  if (!motifs.length) return { niveau: null, motifs: [] };
  const niveau = motifs.some(m => m.niveau === 'rouge') ? 'rouge' : 'jaune';
  // Le motif le plus grave d'abord : c'est celui qu'on lit si on n'en lit qu'un.
  motifs.sort((a, b) => (b.niveau === 'rouge' ? 1 : 0) - (a.niveau === 'rouge' ? 1 : 0));
  return { niveau, motifs, motif: motifs[0].mot, extrait: motifs[0].extrait };
}

/**
 * LA VEILLE D'UNE JOURNÉE.
 *
 * Elle ne lit QUE ce que la personne a écrit — `role === 'user'`. Ce que le
 * compagnon répond ne compte pas : il lui arrive de nommer ce qu'il a compris,
 * et un signe rouge déclenché par la phrase d'une machine serait une machine
 * qui s'alarme d'elle-même.
 *
 * @returns {{niveau, motif, extrait, passages} | null}
 */
export function veilleDuJour(date, userId, { messages = null } = {}) {
  const msgs = (messages ?? messagesForDate(date, userId))
    .filter(m => m.role === 'user' && m.text?.trim());
  if (!msgs.length) return null;

  // Le contexte de la journée entière : c'est lui qui fait basculer une
  // blessure possible en rouge, et il ne se lit pas message par message.
  const contexteDuJour = msgs.map(m => m.text).join(' ');

  const tous = [];
  let passages = 0;
  for (const m of msgs) {
    const r = niveauDuTexte(m.text, { contexteDuJour });
    if (!r.niveau) continue;
    passages++;
    for (const mo of r.motifs) if (!tous.some(x => x.genre === mo.genre)) tous.push(mo);
  }
  if (!tous.length) return null;
  tous.sort((a, b) => (b.niveau === 'rouge' ? 1 : 0) - (a.niveau === 'rouge' ? 1 : 0));
  return {
    niveau: tous.some(m => m.niveau === 'rouge') ? 'rouge' : 'jaune',
    motifs: tous, motif: tous[0].mot, extrait: tous[0].extrait, passages
  };
}

/** Le pire niveau d'un ensemble de jours — pour un mois, une année. */
export const NIVEAUX = { rouge: 2, jaune: 1 };
export function pireNiveau(veilles) {
  let pire = null;
  for (const v of veilles ?? []) {
    if (!v?.niveau) continue;
    if (!pire || NIVEAUX[v.niveau] > NIVEAUX[pire]) pire = v.niveau;
  }
  return pire;
}

/**
 * CE QU'ON ÉCRIT À CÔTÉ DU SIGNE.
 *
 * Des faits, au passé, sur ce qui a été écrit. Pas « tu vas mal », pas « fais
 * attention » : la personne sait déjà comment elle va, et un rappel formulé
 * comme un reproche est un rappel qu'on ferme.
 */
/**
 * CE QU'ON ÉCRIT À CÔTÉ DU SIGNE — par GENRE, pas par couleur.
 *
 * « Le suicide a été évoqué » et « un objet dangereux était à portée » sont
 * deux jaunes, et ce ne sont pas la même journée. Une couleur seule range ; ce
 * qui informe, c'est le mot.
 */
export const DIT = {
  suicide:  'le suicide a été évoqué ce jour-là',
  moyen:    'quelque chose pour se faire mal était à portée',
  dereel:   'un moment où le réel s’est décollé',
  blessure: 'une blessure est écrite ce jour-là',
  // Une blessure ANCIENNE, racontée. Pas « ce jour-là » : c'est un souvenir qui
  // remonte, pas un geste du jour. Le distinguer, c'est ne pas crier « blessure
  // aujourd'hui » quand quelqu'un revient sur ce qui lui est arrivé.
  evoque_passe: 'une blessure passée a été évoquée'
};

/*
 * LE 3114, ET LE SEUL ENDROIT OÙ IL A SA PLACE.
 *
 * Affiché en permanence, un numéro d'urgence devient du décor : on cesse de le
 * voir en trois jours, et il n'est plus là le jour où il compte. Il apparaît
 * donc sur un jour ROUGE, et seulement là.
 *
 * Pas sur un jaune : parler de suicide n'est pas être en train de passer à
 * l'acte, et répondre à quelqu'un qui y pense en lui tendant un numéro est une
 * façon de ne pas l'écouter.
 */
export const AIDE = 'Si tu as besoin de parler à quelqu’un maintenant : 3114, gratuit, 24 h/24, partout en France.';
