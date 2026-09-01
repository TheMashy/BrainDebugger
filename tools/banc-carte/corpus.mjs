/*
 * VINGT VRAIES CONVERSATIONS, RENDUES EN JOURNAL.
 *
 * POURQUOI PAS DES CARTES FABRIQUEES. Le banc synthetique fabriquait des amas
 * propres : n noeuds, une densite, des ponts comptes. Il a dit ce qu'il pouvait
 * dire -- que l'enveloppe ne depend pas des liens -- et il s'arrete la. Il ne
 * peut rien dire de ce qu'un VRAI modele produit en lisant un VRAI corpus :
 * combien de pistes il nomme, combien de noeuds il met dans deux pistes a la
 * fois, s'il rappelle les memes choses deux fois de suite. Or c'est exactement
 * ce que les cinq conditions demandent de mesurer.
 *
 * D'OU VIENNENT LES CONVERSATIONS.
 *
 * AnnoMI (133 entretiens motivationnels reels, transcrits et annotes par des
 * experts, publies par uccollab pour la recherche ; les transcriptions portent
 * sur des videos de demonstration publiques). Des gens qui parlent de ce qu'ils
 * n'arrivent pas a arreter : l'alcool,
 * le tabac, les drogues, les medicaments qu'ils ne prennent pas, le sport
 * qu'ils ne font pas. Mediane 50 tours, 916 mots. C'est le domaine exact de
 * cette application -- l'ambivalence, les declencheurs, les contextes, les
 * rechutes -- et c'est aussi le domaine ou une etiquette posee par une machine
 * fait le plus de degats. Si la carte doit casser quelque part, c'est la.
 *
 * Topical-Chat (539 echanges ouverts, deux inconnus qui parlent de football, de
 * cinema, d'animaux ; publie par Amazon). Mediane 21 tours. Ils servent
 * de TEMOIN : une carte tiree d'une conversation sur le football ne doit pas
 * faire pousser un ilot « dependance ». Si elle le fait, c'est le modele qui
 * projette, et aucune correction de rendu n'y changera rien.
 *
 * SUR LES LICENCES, ce qui a ete VERIFIE et ce qui ne l'a pas ete : ni
 * uccollab/AnnoMI ni alexa/Topical-Chat ne portent de fichier de licence
 * (LICENSE, LICENSE.txt, NOTICE : tous 404) et aucun de leurs README n'en
 * nomme une. Les deux sont diffuses publiquement pour la recherche, et rien de
 * plus ne peut etre affirme. C'est sans consequence ici -- ce banc vit dans un
 * dossier de travail, rien n'est redistribue ni versionne -- mais une licence
 * annoncee de memoire dans un commentaire est une licence inventee, et elle
 * survivrait au commentaire.
 *
 * (CaSiNo, lui, porte bien une CC BY 4.0 verifiee, et son corpus donne meme les
 * scores Big Five de chaque participant. Il n'est pas retenu : treize tours de
 * negociation de campement ne font pas un journal.)
 *
 * COMMENT UNE CONVERSATION DEVIENT UN JOURNAL.
 *
 * L'application lit des JOURNEES. Une conversation est une seance. On la coupe
 * donc en segments, un segment par journee -- et la coupe suit la conversation
 * elle-meme, pas une regle de longueur : on coupe la ou le sujet tourne.
 *
 * Rien n'est reecrit. Chaque tour est recopie tel quel, avec son locuteur :
 * « moi » pour la personne (le client, ou agent_1), « l'autre » pour son
 * interlocuteur. Une phrase inventee ici deviendrait un noeud invente sur la
 * carte, et on ne saurait plus ce qu'on mesure.
 *
 * Les DATES sont un echafaudage, et il faut le dire : une seance n'a pas eu
 * lieu sur douze jours. Ce qui est vrai, en revanche, c'est le RETOUR d'un
 * sujet -- quand quelqu'un reparle de sa mere au tour 40 apres l'avoir
 * mentionnee au tour 8, deux segments differents la portent, et le noeud
 * « ma mere » aura reellement deux journees. C'est cette structure-la qu'on
 * teste, et elle, elle vient de la conversation.
 */
import fs from 'node:fs';
import path from 'node:path';

const ICI = path.dirname(new URL(import.meta.url).pathname);
export const DOSSIER = path.join(ICI, 'corpus');

/* ----------------------------- lire les corpus ----------------------------- */

/** Un parseur CSV qui tient les guillemets et les retours a la ligne dedans. */
function csv(s) {
  const lignes = [];
  let champs = [], c = '', guillemets = false;
  for (let i = 0; i < s.length; i++) {
    const x = s[i];
    if (guillemets) {
      if (x === '"') { if (s[i + 1] === '"') { c += '"'; i++; } else guillemets = false; }
      else c += x;
    } else if (x === '"') guillemets = true;
    else if (x === ',') { champs.push(c); c = ''; }
    else if (x === '\n') { champs.push(c); lignes.push(champs); champs = []; c = ''; }
    else if (x !== '\r') c += x;
  }
  if (c || champs.length) { champs.push(c); lignes.push(champs); }
  return lignes;
}

export function lireAnnoMI(fichier = path.join(DOSSIER, 'annomi.csv')) {
  const lignes = csv(fs.readFileSync(fichier, 'utf8'));
  const tete = lignes[0];
  const col = n => tete.indexOf(n);
  const iId = col('transcript_id'), iQui = col('interlocutor'), iDit = col('utterance_text'),
        iSujet = col('topic'), iQualite = col('mi_quality'), iTitre = col('video_title'),
        iOrdre = col('utterance_id');
  const par = new Map();
  for (const l of lignes.slice(1)) {
    if (l.length < tete.length) continue;
    const id = l[iId];
    if (!par.has(id)) par.set(id, {
      id: `annomi-${id}`, source: 'AnnoMI', sujet: l[iSujet].trim(),
      qualite: l[iQualite], titre: l[iTitre], tours: new Map()
    });
    // Chaque tour est annote par plusieurs annotateurs : le meme utterance_id
    // revient a l'identique. On garde une seule copie, sinon la conversation
    // est doublee et chaque phrase compte deux fois.
    par.get(id).tours.set(Number(l[iOrdre]),
      { qui: l[iQui] === 'client' ? 'moi' : "l'autre", dit: l[iDit].trim() });
  }
  return [...par.values()].map(c => ({
    ...c, tours: [...c.tours.entries()].sort((a, b) => a[0] - b[0]).map(([, t]) => t)
  }));
}

export function lireTopical(fichier = path.join(DOSSIER, 'topical.json')) {
  const j = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  return Object.entries(j).map(([id, c]) => ({
    id: `topical-${id.slice(0, 8)}`, source: 'Topical-Chat', sujet: 'conversation ouverte',
    qualite: c.conversation_rating?.agent_1 ?? '', titre: '',
    tours: c.content.map(t => ({ qui: t.agent === 'agent_1' ? 'moi' : "l'autre", dit: t.message.trim() }))
  }));
}

/* --------------------------- la coupe en journees --------------------------- */

/*
 * OU COUPER. Pas tous les six tours : la ou le sujet tourne.
 *
 * On mesure le recouvrement de vocabulaire entre deux fenetres qui se suivent
 * (les mots pleins, pas les outils grammaticaux). Un creux = un virage. On
 * coupe aux plus gros creux, en gardant des segments d'au moins `mini` tours
 * pour qu'une journee porte de quoi ecrire.
 *
 * L'interet n'est pas la finesse du decoupage : c'est qu'il vienne de la
 * conversation. Un decoupage a longueur fixe repartirait les sujets au hasard
 * entre les journees, et le retour d'un sujet -- la seule chose vraie qu'on
 * mesure ici -- deviendrait du bruit.
 */
const VIDES = new Set(('a about all also am an and any are as at be been but by can cant come could did'
  + ' do does dont for from get go going good had has have he her here him his how i if in is it its'
  + ' just know like me more my no not now of oh ok okay on one or other our out really right said say'
  + ' she should so some than that the their them then there these they thing think this those to too'
  + ' up us very was we well were what when which who why will with would yeah yes you your um uh')
  .split(' '));

const motsDe = t => t.toLowerCase().match(/[a-zà-ÿ']{3,}/g)?.filter(m => !VIDES.has(m)) ?? [];

export function couper(tours, { vise = 700, fenetre = 3 } = {}) {
  const sacs = tours.map(t => new Set(motsDe(t.dit)));
  const taille = t => t.qui.length + 3 + t.dit.length + 1;

  /* Le creux a la frontiere i : Jaccard entre les trois tours d'avant et les
     trois d'apres. Bas = le sujet tourne ici. */
  const creuxA = i => {
    const av = new Set(), ap = new Set();
    for (let k = Math.max(0, i - fenetre); k < i; k++) for (const m of sacs[k]) av.add(m);
    for (let k = i; k < Math.min(tours.length, i + fenetre); k++) for (const m of sacs[k]) ap.add(m);
    let commun = 0;
    for (const m of ap) if (av.has(m)) commun++;
    const union = av.size + ap.size - commun;
    return union ? commun / union : 0;
  };

  const seg = [];
  let debut = 0, signes = 0;
  for (let i = 0; i < tours.length; i++) {
    signes += taille(tours[i]);
    if (signes < vise || i === tours.length - 1) continue;
    /* La longueur dit QUAND couper, le contenu dit OU exactement : on prend le
       creux le plus profond dans les trois frontieres autour. Sans ca les
       journees tombent au milieu d'une phrase sur deux ; avec, elles tombent la
       ou la conversation change de sujet -- ce qui est le seul interet d'avoir
       une vraie conversation plutot qu'un texte decoupe au metre. */
    let ou = i + 1, meilleur = Infinity;
    for (let c = Math.max(debut + 1, i - 1); c <= Math.min(tours.length - 1, i + 2); c++) {
      const j = creuxA(c);
      if (j < meilleur) { meilleur = j; ou = c; }
    }
    seg.push(tours.slice(debut, ou));
    debut = ou; signes = 0;
    i = ou - 1;
  }
  if (debut < tours.length) seg.push(tours.slice(debut));
  return seg.filter(s => s.length);
}

const AAAAMMJJ = d => d.toISOString().slice(0, 10);

/*
 * COMBIEN DE JOURNEES. Assez pour qu'aucune ne soit COUPEE.
 *
 * `corpusPour()` tronque chaque journee a 900 caracteres (CAR_PAR_JOUR dans
 * server/lecture.js). Sur un vrai journal ca ne se voit pas -- on n'ecrit pas
 * neuf cents signes tous les soirs. Sur une seance de sept mille mots decoupee
 * en douze, chaque journee en perdait les trois quarts, et le modele lisait un
 * quart du corpus en croyant tout lire.
 *
 * On coupe donc en assez de segments pour que la journee MOYENNE tienne sous la
 * limite. Un journal de vingt-cinq journees courtes est d'ailleurs plus proche
 * de ce que l'application voit vraiment qu'un journal de douze journees denses.
 */
/*
 * SEIZE JOURNEES, ET LA LONGUEUR SUIT.
 *
 * Pas l'inverse. L'application refuse de lire en dessous de douze journees
 * (MIN_JOURS) : viser une longueur fixe donnait sept journees a une seance
 * courte, et le testeur ne passait meme pas la porte du produit. On vise donc
 * un NOMBRE de journees, et la longueur s'en deduit -- bornee sous les neuf
 * cents signes de CAR_PAR_JOUR pour qu'aucune ne soit tronquee, et au-dessus de
 * cent cinquante pour qu'une journee reste une journee et pas une replique.
 */
export const JOURNEES_VISEES = 16;

/**
 * Une conversation -> un journal : { id, source, sujet, jours: [{date, texte}] }.
 * `debut` est l'echafaudage de dates, et rien d'autre.
 */
export function enJournal(conv, { debut = '2026-01-06', journees = JOURNEES_VISEES } = {}) {
  const signes = conv.tours.reduce((s, t) => s + t.dit.length + t.qui.length + 4, 0);
  const vise = Math.max(150, Math.min(880, Math.round(signes / journees)));
  const segments = couper(conv.tours, { vise });
  const d0 = new Date(debut + 'T12:00:00Z');
  const jours = segments.map((seg, k) => {
    const d = new Date(d0.getTime() + k * 86400000);
    return {
      date: AAAAMMJJ(d),
      texte: seg.map(t => `${t.qui} : ${t.dit}`).join('\n')
    };
  });
  return { id: conv.id, source: conv.source, sujet: conv.sujet, qualite: conv.qualite,
           titre: conv.titre, tours: conv.tours.length, jours,
           mots: conv.tours.reduce((s, t) => s + t.dit.split(/\s+/).length, 0) };
}

/* ------------------------- le corpus tel que le voit lecture.js -------------------------
 *
 * Le meme bloc, mot pour mot, que `corpusDe()` construit dans server/lecture.js
 * (« SES JOURNÉES ÉCRITES », `[date] texte`). Si le testeur presentait le corpus
 * autrement, il testerait un autre produit.
 */
export const CAR_PAR_JOUR = 900;   // la valeur de server/lecture.js, a l'identique

export function corpusTexte(journal) {
  return `SES JOURNÉES ÉCRITES. ${journal.jours.length} journées sur les ${journal.jours.length} qui portent du texte sur cette période — les plus fournies, remises dans l'ordre.

${journal.jours.map(j => `[${j.date}] ${
  j.texte.length > CAR_PAR_JOUR ? j.texte.slice(0, CAR_PAR_JOUR) + '…' : j.texte}`).join('\n\n')}`;
}

/* ------------------------------ le choix des vingt ------------------------------
 *
 * Quatorze entretiens et six temoins. Les quatorze couvrent des sujets
 * differents ET les deux qualites d'entretien : un entretien rate produit une
 * personne qui se ferme, et c'est un corpus tout aussi reel qu'un entretien
 * reussi -- souvent plus proche de ce que quelqu'un ecrit un mauvais soir.
 *
 * Le choix est deterministe : le meme jeu a chaque passage, sinon deux mesures
 * ne se comparent pas.
 */
export function choisir({ nMI = 14, nTemoin = 6, miniTours = 24 } = {}) {
  const mi = lireAnnoMI().filter(c => c.tours.length >= miniTours);
  const parSujet = new Map();
  for (const c of mi.sort((a, b) => a.id.localeCompare(b.id))) {
    const k = c.sujet.trim().toLowerCase();
    if (!parSujet.has(k)) parSujet.set(k, []);
    parSujet.get(k).push(c);
  }
  /*
   * UN TOUR DE PISTE PAR SUJET avant d'en reprendre un deuxieme : sinon
   * l'alcool, qui est le sujet le plus frequent, occupe la moitie du jeu.
   *
   * Et les sujets sont pris DU PLUS FOURNI AU MOINS FOURNI, pas par ordre
   * alphabetique. Range par l'alphabet, la coupe a quatorze tombait avant
   * « reducing alcohol consumption » et « smoking cessation » -- les deux
   * sujets les plus representes du corpus, et les plus proches de ce que cette
   * application lit. Un jeu d'essai qui ecarte le cas central n'essaie rien.
   */
  const sujets = [...parSujet.keys()]
    .sort((a, b) => parSujet.get(b).length - parSujet.get(a).length || a.localeCompare(b));
  const pris = [];
  for (let tour = 0; pris.length < nMI && tour < 12; tour++)
    for (const s of sujets) {
      if (pris.length >= nMI) break;
      const c = parSujet.get(s)[tour];
      if (c) pris.push(c);
    }
  /*
   * LES TEMOINS LES PLUS LONGS, pas les premiers venus. Les six premiers dans
   * l'ordre alphabetique faisaient vingt-et-un tours, soit dix journees --
   * sous les douze que l'application exige avant d'accepter de lire. Un temoin
   * que le produit refuserait ne temoigne de rien.
   */
  const temoins = lireTopical()
    .sort((a, b) => b.tours.length - a.tours.length || a.id.localeCompare(b.id))
    .slice(0, nTemoin);
  return [...pris, ...temoins].map(c => enJournal(c));
}
