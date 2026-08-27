/**
 * Import de notes deja ecrites.
 *
 * Le miroir ne sait rendre que ce qu'on lui a donne. Quelqu'un qui arrive avec
 * quatre ans de notes dans un fichier texte a le corpus, mais pas dans l'appli :
 * la recherche par similitude n'a rien a comparer, et les journees passees sont
 * des chiffres sans mots. Ce module colle ce fosse.
 *
 * On colle un bloc, il en ressort des journees datees. Aucune ecriture n'a lieu
 * sans qu'on ait montre d'abord ce qui va etre ecrit : se tromper de format et
 * ecraser des annees de journal serait irreparable, et l'inverse -- un import
 * silencieux qui ne prend que la moitie des entrees -- se remarque des mois plus
 * tard, quand le miroir ment par omission.
 *
 * Les notes importees entrent comme des MESSAGES, pas directement dans
 * entries.text. C'est le meme chemin que ce qui est ecrit dans la conversation,
 * donc : elles remontent dans le fil aux bonnes dates, elles survivent a un
 * rebuildEntryText (qui recalcule entries.text depuis les messages et effacerait
 * un texte pose a cote), et il n'y a qu'un seul endroit ou le corpus se
 * fabrique. Deux chemins d'ecriture pour la meme donnee, c'est la garantie
 * qu'ils divergeront.
 */

import { db, rebuildEntryText, OWNER } from './db.js';

/* ---------- dates ---------- */

const MOIS = {
  janvier: 1, janv: 1, jan: 1, january: 1,
  fevrier: 2, fevrier_: 2, fevr: 2, fev: 2, feb: 2, february: 2,
  mars: 3, mar: 3, march: 3,
  avril: 4, avri: 4, avr: 4, apr: 4, april: 4,
  mai: 5, may: 5,
  juin: 6, jui: 6, jun: 6, june: 6,
  juillet: 7, juill: 7, juil: 7, jul: 7, july: 7,
  aout: 8, aou: 8, aug: 8, august: 8,
  septembre: 9, septe: 9, sept: 9, sep: 9, september: 9,
  octobre: 10, octo: 10, oct: 10, october: 10,
  novembre: 11, nove: 11, nov: 11, november: 11,
  decembre: 12, dece: 12, dec: 12, december: 12
};

/** Sans accents ni casse : « Février », « fevrier » et « FÉVRIER » sont le meme mot. */
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/*
 * Jours de la semaine, en tete de ligne. Les formes longues passent AVANT les
 * courtes : sinon « mardi » se fait manger comme « mar » et laisse « di ».
 *
 * Et surtout, pas de joker apres l'abreviation. Un `[a-z]*` derriere `mar`
 * avalait « mars » -- toutes les dates en toutes lettres du mois de mars
 * partaient a la poubelle sans un mot.
 */
const JOURS = /^(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lun|mar|mer|jeu|ven|sam|dim|mon|tue|wed|thu|fri|sat|sun)\.?,?\s+/i;

const pad = n => String(n).padStart(2, '0');

/** Valide un triplet et le rend en 'YYYY-MM-DD'. Rejette le 31 fevrier. */
function iso(y, m, d) {
  if (!(y >= 1900 && y <= 2200) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Reconnait une date en tete de ligne et rend { date, reste }.
 *
 * Le jour vient avant le mois en 12/03/2024 : c'est un outil ecrit en francais,
 * pour un journal tenu en francais. L'apercu affiche les dates interpretees en
 * clair, ce qui est la seule facon honnete de lever l'ambiguite -- une note en
 * bas de page ne serait jamais lue.
 */
/**
 * @param {string} line
 * @param {{annee?: number|null, precedente?: string|null}} [ctx]
 *   Contexte de lecture, pour les dates sans annee. Voir `anneeProbable`.
 */
export function parseDateLine(line, ctx = {}) {
  let s = decaper(normaliser(line))
    .replace(ETIQUETTES, '')               // « Date : 05/01/2026 », « date: 2024-04-02 »
    .replace(/^[[({<]\s*/, '')             // [2024-03-12]  (12 mars 2024)
    .replace(/\s*[\])}>]\s*$/, '')
    .replace(/^le\s+/i, '')                // « Le 12 mars 2024 »
    .replace(/\.md$/i, '');                // en-tete recopie d'un fichier Obsidian
  if (!s) return null;
  if (faussePiste(s)) return null;

  // On tente d'abord la chaine telle quelle. Retirer un jour de semaine en
  // premier ferait lire « mars 12, 2024 » comme « mardi » suivi de « 12, 2024 »,
  // et le nom du mois serait perdu. L'ordre est ce qui leve l'ambiguite, pas la
  // regex.
  const direct = formats(s, ctx);
  if (direct) return direct;

  const sansJour = s.replace(JOURS, '');
  return sansJour === s ? null : formats(sansJour, ctx);
}

/**
 * Annee d'une date qui n'en porte pas — « 12 mars », « 12/03 ».
 *
 * Tres frequent dans un journal tenu a la main : on ecrit l'annee une fois en
 * tete de cahier, plus jamais ensuite. Refuser ces lignes reviendrait a jeter
 * l'essentiel du texte de quelqu'un qui ecrit comme ca.
 *
 * On reporte donc la derniere annee vue. Et si la date obtenue tombe plus de
 * six mois AVANT l'entree precedente, c'est un passage de nouvel an (« 31
 * decembre » puis « 2 janvier ») : on avance d'un an. Sans rien de connu, on
 * refuse plutot que de deviner — une entree rangee sous une annee inventee
 * serait introuvable pour toujours.
 */
function anneeProbable(mois, jour, ctx) {
  const base = ctx?.annee;

  // Aucune annee nulle part dans le document. Refuser reviendrait a jeter tout
  // un carnet parce que son auteur ecrit « 17/08 » comme tout le monde. On
  // prend donc la derniere occurrence de ce jour-mois a la date d'aujourd'hui ou
  // avant : c'est ce que quelqu'un veut dire en ecrivant « 17/08 » -- le 17 aout
  // qui vient de passer, pas celui qui arrive. « 25/12 » colle en janvier tombe
  // donc en decembre dernier, ce qui est presque toujours juste.
  //
  // L'apercu affiche chaque date interpretee en clair : c'est la que ca se
  // verifie, et c'est pour ca qu'on peut se permettre d'inferer plutot que de
  // refuser.
  if (!base) {
    const today = ctx?.today ?? new Date().toISOString().slice(0, 10);
    const an = Number(today.slice(0, 4));
    const cetteAnnee = iso(an, mois, jour);
    if (cetteAnnee && cetteAnnee <= today) return an;
    return iso(an - 1, mois, jour) ? an - 1 : null;
  }

  const candidat = iso(base, mois, jour);
  if (!candidat) return null;
  const prec = ctx?.precedente;
  if (prec && candidat < prec) {
    const ecartJours = (Date.parse(prec) - Date.parse(candidat)) / 86400000;
    if (ecartJours > 182) return base + 1;
  }
  return base;
}

function formats(s, ctx = {}) {
  const suite = rest => rest.replace(/^\s*[-–—:,.]+\s*/, '').trim();
  // Une heure accrochee a la date n'est pas du texte de journal : on la coupe
  // pour qu'elle ne se retrouve pas en premiere ligne de la journee.
  // L'heure accolee a la date, secondes comprises, et la fermeture d'un en-tete
  // entre crochets. Sans les secondes, « 06:44:33] Moi: » laissait « 33] Moi: »
  // en premiere ligne de la journee -- du bruit dans le corpus que le miroir
  // fouille, a chaque message d'un export.
  const sansHeure = rest => suite(rest)
    .replace(/^(?:[àa]\s+)?\d{1,2}\s*[h:]\s*\d{0,2}(?::\d{2})?\s*(?:am|pm)?[\s,:—–\])>-]*/i, '')
    .replace(/^[^:]{0,28}:\s+/, '')        // « Moi : », « Alex Plagne: »
    .trim();

  // 2024-03-12  |  2024/03/12
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b(.*)$/);
  if (m) {
    const d = iso(+m[1], +m[2], +m[3]);
    if (d) return { date: d, reste: sansHeure(m[4]) };
  }

  // 12/03/2024  |  12-03-2024  |  12.03.2024  |  12/03/24
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})\b(.*)$/);
  if (m) {
    let y = +m[3];
    if (m[3].length === 2) y += y <= 68 ? 2000 : 1900;   // pivot POSIX
    const d = iso(y, +m[2], +m[1]);
    if (d) return { date: d, reste: sansHeure(m[4]) };
  }

  // 20240312 — export compact, ou nom de fichier recopie.
  // Seul sur sa ligne, et rien d'autre : huit chiffres suivis de texte, c'est
  // un numero de dossier ou un code, pas l'ouverture d'une journee.
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const d = iso(+m[1], +m[2], +m[3]);
    if (d) return { date: d, reste: '' };
  }

  // 12 mars 2024  |  1er mars 2024  |  12th March 2024
  m = s.match(/^(\d{1,2})(?:er|ère|e|st|nd|rd|th)?\s+([A-Za-zÀ-ÿ]+)\.?,?\s+(\d{4})\b(.*)$/);
  if (m) {
    const mo = MOIS[norm(m[2])];
    if (mo) {
      const d = iso(+m[3], mo, +m[1]);
      if (d) return { date: d, reste: sansHeure(m[4]) };
    }
  }

  // mars 12, 2024  |  March 12th 2024
  m = s.match(/^([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2})(?:er|ère|e|st|nd|rd|th)?,?\s+(\d{4})\b(.*)$/);
  if (m) {
    const mo = MOIS[norm(m[1])];
    if (mo) {
      const d = iso(+m[3], mo, +m[2]);
      if (d) return { date: d, reste: sansHeure(m[4]) };
    }
  }

  /* ----- sans annee : reportee du contexte (voir anneeProbable) ----- */

  // 12 mars  |  1er mars  |  12 March
  m = s.match(/^(\d{1,2})(?:er|ère|e|st|nd|rd|th)?\s+([A-Za-zÀ-ÿ]+)\.?\s*(.*)$/);
  if (m) {
    const mo = MOIS[norm(m[2])];
    if (mo) {
      const y = anneeProbable(mo, +m[1], ctx);
      const d = y && iso(y, mo, +m[1]);
      if (d) return { date: d, reste: sansHeure(m[3]) };
    }
  }

  // mars 12  |  March 12
  m = s.match(/^([A-Za-zÀ-ÿ]+)\.?\s+(\d{1,2})(?:er|ère|e|st|nd|rd|th)?\s*(.*)$/);
  if (m) {
    const mo = MOIS[norm(m[1])];
    if (mo) {
      const y = anneeProbable(mo, +m[2], ctx);
      const d = y && iso(y, mo, +m[2]);
      if (d) return { date: d, reste: sansHeure(m[3]) };
    }
  }

  // 12/03  |  12-03 — jour/mois, l'annee vient du contexte.
  // La frontiere refuse explicitement un troisieme groupe : `\b` laissait
  // passer « 2.3.1 », lu comme le 2 mars avec « .1 » en reste.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})(?![-/.]?\d)(.*)$/);
  if (m) {
    const mo = +m[2];
    const y = anneeProbable(mo, +m[1], ctx);
    const d = y && iso(y, mo, +m[1]);
    if (d) return { date: d, reste: sansHeure(m[3]) };
  }

  return null;
}

/* ---------- tableaux colles ---------- */

const VIDES = new Set(['', '-', '–', '—', 'n/a', 'na', '?', '.']);
const utile = v => v && !VIDES.has(v.trim().toLowerCase());

/**
 * Decoupe une ligne en cellules. Trois provenances, trois separateurs :
 * la tabulation (tableur, de tres loin le cas le plus frequent), la barre
 * verticale (tableau Markdown, Notion), et deux espaces ou plus (colle depuis
 * un PDF ou un terminal, ou les colonnes sont alignees a la main).
 */
function cellules(ligne) {
  if (ligne.includes('\t')) return ligne.split('\t').map(c => c.trim());
  if (/^\s*\|.*\|\s*$/.test(ligne)) {
    return ligne.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
  }
  if (/ {2,}/.test(ligne)) return ligne.split(/ {2,}/).map(c => c.trim());
  return null;
}

/** Une ligne de separation Markdown : |---|---| */
const separatriceMd = l => /^\s*\|?[\s:|-]*-{2,}[\s:|-]*\|?\s*$/.test(l) && l.includes('-');

/**
 * Reconnait un tableau colle et en tire des journees.
 *
 * C'est le cas que le decoupage ligne-a-ligne ne peut pas voir : la date n'ouvre
 * pas un bloc, elle occupe une colonne, et chaque ligne est un moment de la
 * journee. Un tableur en produit plusieurs par jour -- reveil, midi, coucher --
 * qu'il faut recoller.
 *
 * @returns {{entries: Array, ignore: string}|null} null si ce n'est pas un tableau
 */
export function parseTable(text, ctx = {}) {
  const lignes = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');

  const grille = [];
  const horsTable = [];
  for (const l of lignes) {
    if (!l.trim() || separatriceMd(l)) { horsTable.push(l); continue; }
    const c = cellules(l);
    if (c && c.length >= 2) grille.push(c); else horsTable.push(l);
  }
  // Deux lignes de deux cellules peuvent etre une coincidence de mise en page.
  // A partir de trois, c'est un tableau.
  if (grille.length < 3) return null;

  const largeur = Math.max(...grille.map(r => r.length));
  if (largeur < 2) return null;

  // Colonne des dates : celle ou le plus de cellules se lisent comme une date.
  // On ne devine pas d'apres l'en-tete -- il peut s'appeler « Jour », « Quand »
  // ou ne pas exister du tout.
  let colDate = -1, meilleur = 0;
  for (let c = 0; c < largeur; c++) {
    let n = 0;
    for (const r of grille) if (r[c] && parseDateLine(r[c], ctx)) n++;
    if (n > meilleur) { meilleur = n; colDate = c; }
  }
  // Il faut que la colonne soit vraiment une colonne de dates, pas une cellule
  // isolee qui ressemble a une date au milieu d'autre chose.
  if (colDate < 0 || meilleur < Math.max(2, grille.length * 0.4)) return null;

  // Ligne d'en-tete : la premiere ligne dont la cellule de date n'en est pas une.
  let entete = null, debut = 0;
  if (grille[0][colDate] && !parseDateLine(grille[0][colDate], ctx)) {
    entete = grille[0]; debut = 1;
  }

  // Colonne de prose : la plus bavarde des colonnes restantes. C'est plus fiable
  // qu'un nom d'en-tete, qui varie d'une personne a l'autre.
  let colTexte = -1, plusLong = 0;
  for (let c = 0; c < largeur; c++) {
    if (c === colDate) continue;
    let total = 0, n = 0;
    for (let i = debut; i < grille.length; i++) {
      const v = grille[i][c];
      if (utile(v)) { total += v.length; n++; }
    }
    const moyenne = n ? total / n : 0;
    if (moyenne > plusLong) { plusLong = moyenne; colTexte = c; }
  }
  if (colTexte < 0 || plusLong < 12) return null;   // aucune colonne ne porte de phrase

  // Colonne d'heure : courte, et qui ressemble a une heure sur la moitie des lignes.
  const ressembleHeure = v => /^[~≈]?\s*\d{1,2}\s*[h:]\s*\d{0,2}$/i.test(v)
    || /^(matin|midi|soir|nuit|apr[eè]s-midi|au lever|au coucher|r[eé]veil)/i.test(v);
  let colHeure = -1;
  for (let c = 0; c < largeur; c++) {
    if (c === colDate || c === colTexte) continue;
    let n = 0, total = 0;
    for (let i = debut; i < grille.length; i++) {
      const v = grille[i][c];
      if (utile(v)) { total++; if (ressembleHeure(v)) n++; }
    }
    if (total && n / total >= 0.5) { colHeure = c; break; }
  }

  const par = new Map();
  const ordre = [];
  let ignorees = 0;

  for (let i = debut; i < grille.length; i++) {
    const r = grille[i];
    const hit = r[colDate] && parseDateLine(r[colDate], ctx);
    if (!hit) { ignorees++; continue; }
    ctx.annee = Number(hit.date.slice(0, 4));
    ctx.precedente = hit.date;

    const corps = utile(r[colTexte]) ? r[colTexte].trim() : '';
    // Les autres colonnes portent de l'information que la personne a saisie a
    // la main : humeur, sommeil, traitement. Les jeter serait perdre la moitie
    // de son suivi. On les rend lisibles plutot que de les recopier brutes.
    const reste = [];
    for (let c = 0; c < largeur; c++) {
      if (c === colDate || c === colTexte || c === colHeure) continue;
      const v = r[c];
      if (!utile(v)) continue;
      const nom = entete && utile(entete[c]) ? entete[c].replace(/\s*:\s*$/, '') : null;
      reste.push(nom ? `${nom} ${v.trim()}` : v.trim());
    }

    const heure = colHeure >= 0 && utile(r[colHeure]) ? r[colHeure].trim() : '';
    let ligne = corps;
    if (heure) ligne = ligne ? `${heure} — ${corps}` : heure;
    if (reste.length) ligne = ligne ? `${ligne} (${reste.join(' · ')})` : `(${reste.join(' · ')})`;
    if (!ligne) continue;

    if (!par.has(hit.date)) { par.set(hit.date, []); ordre.push(hit.date); }
    par.get(hit.date).push(ligne);
  }

  if (!ordre.length) return null;
  const entries = ordre.map(date => ({ date, text: par.get(date).join('\n') }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Les lignes hors tableau remontent : le lecteur tabulaire les jetait
  // silencieusement, et `ignore` revenait VIDE -- donc l'apercu affichait une
  // perte de zero ligne alors que des journees entieres de prose disparaissaient.
  // Un import qui perd du texte sans le dire est pire qu'un import qui echoue.
  return { entries, ignore: '', table: true, lignesIgnorees: ignorees, horsTable };
}

/**
 * Decoupe un bloc colle en journees datees.
 *
 * Une ligne-date ouvre une journee ; tout ce qui suit lui appartient jusqu'a la
 * date suivante. Ce qui precede la premiere date est ignore -- c'est un titre de
 * document, pas une journee, et l'attacher a la premiere date la salirait.
 *
 * Deux blocs portant la meme date sont recolles plutot que de s'ecraser : dans un
 * journal recopie a la main, une date qui revient est presque toujours un ajout
 * du soir, pas une correction.
 */
/**
 * Nettoyage du presse-papier, avant toute lecture.
 *
 * Le piege le plus couteux du lot, parce qu'il est invisible : un export
 * WhatsApp iOS commence chaque ligne par U+200E (marque gauche-a-droite). Ni
 * `trim()`, ni `\s`, ni le decapage des puces ne le voient -- la ligne ne
 * commence donc jamais par « [ », la date n'est jamais reconnue, et un fichier
 * parfaitement date rend ZERO journee. Sans message.
 *
 * Meme famille : l'espace insecable de Word, l'espace fine du francais
 * typographique, la marque d'ordre d'octets en tete de fichier.
 */
const INVISIBLES = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
const ESPACES = /[\u00A0\u202F\u2009\u2007]/g;

function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(INVISIBLES, '')
    .replace(ESPACES, ' ');
}

/*
 * Decapage de tete de ligne.
 *
 * Elargi bien au-dela des puces : cases a cocher Markdown et Notion, puces
 * Word en zone privee, emoji suivi ou non d'un selecteur de variante, liens
 * wiki d'Obsidian. Le decapage actuel laissait « x] Mon Aug 10 » sur
 * « - [x] Mon Aug 10 » : c'est le nettoyage lui-meme qui detruisait la date.
 *
 * « @ » n'est JAMAIS retire : c'est le signe d'une mention en ligne.
 */
const PUCES = /^[\s\t\-–—*+•·▪◦‣>#\uF000-\uF0FF]+/;
const CASE_COCHEE = /^\[[ xX✓]\]\s*/;
const CASE_UNICODE = /^[☑☐✅⬜]\s*/;
const EMOJI = /^(?:[\u2600-\u27BF\uFE0F\u{1F300}-\u{1FAFF}]\s*)+/u;
const WIKILINK = /^\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/;

function decaper(ligne) {
  let s = ligne;
  for (let i = 0; i < 4; i++) {          // deux ou trois couches suffisent en pratique
    const avant = s;
    s = s.replace(PUCES, '');
    s = s.replace(CASE_COCHEE, '');
    s = s.replace(CASE_UNICODE, '');
    s = s.replace(EMOJI, '');
    const w = s.match(WIKILINK);
    if (w) s = w[1] + s.slice(w[0].length);
    if (s === avant) break;
  }
  return s.trim();
}

/**
 * Une ligne qui ne porte qu'une annee, sous une forme ou une autre.
 *
 *   2019            === 2019 ===            --- 2021 ---
 *   Journal 2016    # Journal — mars 2026   ## 2024
 *
 * On refuse tout ce qui contient un autre nombre : « 12 mars 2019 » est une
 * date, pas un ancrage, et « 2019 kilometres » n'est ni l'un ni l'autre.
 */
function anneeSeule(ligne) {
  const s = decaper(ligne).replace(/[=_~*·—–-]/g, ' ').trim();
  if (!s) return null;
  const nombres = s.match(/\d+/g) ?? [];
  if (nombres.length !== 1) return null;
  const m = nombres[0].match(/^(19|20)\d{2}$/);
  if (!m) return null;
  // Le reste de la ligne doit etre un titre, pas une phrase : quelques mots au
  // plus, et rien qui ressemble a du recit.
  const reste = s.replace(/\d+/, '').trim();
  if (reste.split(/\s+/).filter(Boolean).length > 4) return null;
  return Number(nombres[0]);
}

/*
 * Etiquettes derriere lesquelles une date OUVRE une journee.
 *
 * Liste blanche, et c'est le point : « Date : 05/01/2026 » ouvre une fiche,
 * « Derniere modification : 18 aout 2025 » n'ouvre RIEN. Sans cette
 * distinction, chaque page Notion collee creerait une journee fantome a la date
 * de sa derniere retouche, qui volerait le contenu de la vraie.
 */
const ETIQUETTES = /^(date|jour|day|le|date du|created|cree le|créé le)\s*::?\s*/i;

/**
 * Trouve une date dans un en-tete de message.
 *
 * Beaucoup de gens tiennent leur journal en s'ecrivant a eux-memes. La date y
 * est au milieu de la ligne, pas en tete :
 *
 *   [17/08/2026, 06:44:33] Alex : texte
 *   17/08/2026, 21:04 - Moi : texte
 *   Alex — 17/08/2026 21:04
 *
 * On ne cherche QUE dans le debut de ligne (60 caracteres) : plus loin, un
 * nombre qui ressemble a une date appartient au recit, et le prendre
 * decouperait une phrase en deux journees.
 */
function dateEnTete(ligne, ctx) {
  const s = decaper(ligne);
  if (faussePiste(s)) return null;         // meme garde que la lecture normale

  // La date doit etre accompagnee d'une HEURE : c'est ce qui distingue un
  // en-tete de message d'un nombre qui traine dans une phrase. Sans cette
  // exigence, « rendez-vous reporte au 3/4 » ouvrirait une journee.
  const m = s.slice(0, 64).match(
    /[\[(]?\s*(\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4})[,\s]+(\d{1,2}[:h]\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i
  );
  if (!m) return null;
  const hit = parseDateLine(m[1], ctx);
  if (!hit) return null;

  // Un en-tete entre crochets se ferme au premier « ] » : on coupe la, plutot
  // que de se fier a la longueur du motif horaire, qui varie selon que les
  // secondes sont ecrites ou non.
  let reste;
  if (/^[\[(]/.test(s)) {
    const fin = s.search(/[\])]/);
    reste = fin >= 0 ? s.slice(fin + 1) : s.slice(s.indexOf(m[0]) + m[0].length);
  } else {
    reste = s.slice(s.indexOf(m[0]) + m[0].length);
  }
  reste = reste.replace(/^[\s,\])>-]*/, '');
  // Le nom de l'expediteur, s'il arrive tot : « Moi : », « Alex Plagne: ».
  const deuxPoints = reste.indexOf(':');
  if (deuxPoints >= 0 && deuxPoints <= 28) reste = reste.slice(deuxPoints + 1);
  return { date: hit.date, reste: reste.trim() };
}

/*
 * Ce qui ressemble a une date sans en etre.
 *
 * C'est la moitie du travail, et la plus chere : une fausse date range du texte
 * sous une journee inventee, et le miroir le rendra un jour comme s'il en
 * venait. Un mot manque se remarque ; un mot deplace, non.
 */

// Numero de telephone ou reference : QUATRE groupes ou plus. Une date en a
// trois au maximum, donc trois separateurs sont deja de trop.
// « 06.12.34.56.78 ». Attention a ne pas mordre sur « 2024-03-12 », qui a
// exactement deux separateurs : c'est la date la plus courante du corpus.
const SUITE_LONGUE = /^\d{1,4}([-/.])\d{1,4}\1\d{1,4}\1\d/;

// Une unite ou un article juste apres : « 8/10 de sommeil », « 5/10 mg »,
// « 2/3 des seances », « 1/2 Lexomil ». Une date n'est jamais suivie de ca.
const UNITE_APRES = /^\s*(mg|kg|g|ml|cl|l|h|km|m|%|de|des|du|d'|par|sur|fois|comprimes?|cachets?|gouttes?)\b/i;

// Score sportif : « 3-1 pour l'Islande », « 6-3 6-4 ». Deux petits nombres
// separes d'un tiret, suivis d'un autre score ou d'un mot de match.
const SCORE = /^\d{1,2}-\d{1,2}(\s+\d{1,2}-\d{1,2})+/;

function faussePiste(s) {
  if (SUITE_LONGUE.test(s)) return true;
  if (SCORE.test(s)) return true;
  // Le reste de la ligne est le groupe 1 : le (?!...) qui le precede est une
  // anticipation, pas une capture. Lire m[2] revenait a tester la chaine
  // « undefined », donc a ne rien filtrer du tout.
  const m = s.match(/^\d{1,2}[-/.]\d{1,2}(?![-/.\d])(.*)$/);
  if (m && UNITE_APRES.test(m[1])) return true;
  return false;
}

/**
 * Lignes repetees a l'identique : en-tete ou pied de page d'impression.
 *
 * Le cas observe est particulierement mauvais : « 27/08/2026 10:32  Journal —
 * aout » se repete a chaque page d'un PDF. C'est une date complete en tete de
 * ligne, elle ouvre donc une journee au jour de l'IMPRESSION -- et elle vole au
 * passage la fin du paragraphe coupe par le saut de page.
 */
function mobilierDePage(lignes) {
  const vues = new Map();
  for (const l of lignes) {
    const k = l.trim();
    if (k.length > 3) vues.set(k, (vues.get(k) ?? 0) + 1);
  }
  const repetees = new Set();
  for (const [k, n] of vues) if (n >= 3) repetees.add(k);
  return repetees;
}

export function parseNotes(text, ctx0 = {}) {
  text = normaliser(text);

  // Le mobilier de page part AVANT tout choix de lecture. Un en-tete
  // d'impression a souvent des colonnes d'espaces, donc il fait basculer le
  // collage en mode tableau -- ou le filtre ligne-a-ligne ne le voyait jamais.
  {
    const lignes = text.split('\n');
    const repetees = mobilierDePage(lignes);
    if (repetees.size) text = lignes.filter(l => !repetees.has(l.trim())).join('\n');
  }

  // L'annee ecrite en tete de document doit etre connue AVANT d'essayer la
  // lecture tabulaire : dans un carnet a colonnes, le « 2014 » est sur sa
  // propre ligne, donc hors du tableau. Sans ce pre-balayage, le tableau
  // repartait sans repere et rangeait onze ans plus tard.
  const premiereAnnee = (() => {
    for (const l of text.split('\n')) {
      const an = anneeSeule(l);
      if (an) return an;
      if (parseDateLine(l, { ...ctx0, annee: null })) break;  // une vraie date : trop tard
    }
    return null;
  })();

  // Un tableau colle depuis un tableur ne se lit pas ligne a ligne : la date y
  // occupe une colonne, pas une ligne a elle. On tente donc cette forme
  // d'abord -- elle ne repond que si la structure est franchement tabulaire.
  const table = parseTable(text, { ...ctx0, annee: premiereAnnee });
  if (table) {
    // Un collage est rarement PUREMENT tabulaire : on trouve un tableau de suivi
    // au milieu de notes datees. Ce qui n'etait pas dans le tableau repasse donc
    // par la lecture en prose, et les deux jeux fusionnent.
    const reste = (table.horsTable ?? []).join('\n');
    const prose = reste.trim() ? lireEnProse(reste, { ...ctx0, annee: premiereAnnee }) : null;
    if (!prose?.entries.length) {
      return { ...table, ignore: reste.trim().slice(0, 400) };
    }
    const par = new Map();
    for (const e of [...table.entries, ...prose.entries]) {
      par.set(e.date, par.has(e.date) ? `${par.get(e.date)}\n${e.text}` : e.text);
    }
    return {
      entries: [...par.entries()].map(([date, text]) => ({ date, text }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      ignore: prose.ignore, table: true
    };
  }
  return lireEnProse(text, { ...ctx0, annee: premiereAnnee });
}

/** Lecture ligne a ligne : une date ouvre une journee, la suite lui appartient. */
function lireEnProse(text, ctx0 = {}) {
  const premiereAnnee = ctx0.annee ?? null;

  const lignes = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const ordre = [];
  const par = new Map();
  const avant = [];
  let courant = null;

  // Contexte de lecture, pour les dates sans annee. Il avance ligne a ligne :
  // une annee explicite le recale, une ligne isolee « 2024 » aussi -- c'est
  // ainsi qu'un cahier est ecrit, l'annee en tete puis plus jamais.
  const ctx = { annee: premiereAnnee, precedente: null, ...ctx0 };
  const repetees = mobilierDePage(lignes);

  for (const ligne of lignes) {
    if (repetees.has(ligne.trim())) continue;
    // Une annee ecrite RE-ANCRE le contexte, meme si une journee est deja
    // ouverte. Le garde-fou « seulement avant la premiere date » etait un bug :
    // dans un carnet a blocs annuels, « === 2019 === » puis « 2021 » plus bas
    // etaient ignores, et cinq journees partaient sous une annee inventee --
    // classees dans le mauvais ordre, en prime.
    const an = anneeSeule(ligne);
    if (an) {
      ctx.annee = an;
      ctx.precedente = null;
      // Elle ancre l'annee ET reste signalee comme ecartee : l'apercu doit
      // montrer tout ce qui n'est pas devenu du contenu, sinon on ne peut pas
      // verifier ce qui a ete lu.
      if (courant === null && ligne.trim()) avant.push(ligne.trim());
      continue;
    }

    const hit = parseDateLine(ligne, ctx) ?? dateEnTete(ligne, ctx);
    if (hit) {
      courant = hit.date;
      ctx.annee = Number(hit.date.slice(0, 4));
      ctx.precedente = hit.date;
      if (!par.has(courant)) { par.set(courant, []); ordre.push(courant); }
      if (hit.reste) par.get(courant).push(hit.reste);
      continue;
    }
    if (courant === null) { if (ligne.trim()) avant.push(ligne.trim()); continue; }
    par.get(courant).push(ligne);
  }

  const entries = [];
  for (const date of ordre) {
    const corps = par.get(date).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (corps) entries.push({ date, text: corps });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));
  return { entries, ignore: avant.join('\n').trim() };
}

/* ---------- apercu ---------- */

const SOURCE = 'import';

/** Ce qui a deja ete importe pour cette journee, pour ne pas coller deux fois. */
function dejaImporte(userId, date) {
  return db.prepare(
    `SELECT text FROM messages WHERE user_id = ? AND date = ? AND source = ?`
  ).all(userId, date, SOURCE).map(r => r.text);
}

/**
 * Analyse sans rien ecrire. On montre ce qui va se passer plutot que de demander
 * de faire confiance -- meme regle que pour l'import CSV.
 */
export function inspectNotes(text, userId = OWNER, ctx = {}) {
  const { entries, ignore, table } = parseNotes(text, ctx);

  let nouvelles = 0, ajouts = 0, identiques = 0;
  const apercu = entries.map(e => {
    const anciens = dejaImporte(userId, e.date);
    const etat = anciens.includes(e.text) ? 'identique'
               : anciens.length ? 'ajout'
               : 'nouvelle';
    if (etat === 'identique') identiques++;
    else if (etat === 'ajout') ajouts++;
    else nouvelles++;
    return {
      date: e.date,
      etat,
      mots: e.text.split(/\s+/).filter(Boolean).length,
      extrait: e.text.length > 120 ? e.text.slice(0, 117).trimEnd() + '…' : e.text
    };
  });

  return {
    total: entries.length,
    table: !!table,
    nouvelles, ajouts, identiques,
    first: entries.length ? entries[0].date : null,
    last: entries.length ? entries[entries.length - 1].date : null,
    mots: entries.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0),
    ignore: ignore.length > 200 ? ignore.slice(0, 197) + '…' : ignore,
    apercu,
    entries
  };
}

/* ---------- ecriture ---------- */

/**
 * Ecriture en une transaction. Un import a moitie applique laisserait un corpus
 * dont on ne sait plus ce qu'il contient, et le miroir mentirait sans le dire.
 *
 * L'horodatage est 21h00 heure locale du jour concerne : ces notes ont ete
 * ecrites le soir, et c'est l'ordre dans la journee qui compte, pas la minute.
 * Un ts a l'instant de l'import les ferait toutes remonter aujourd'hui dans le
 * fil, ce qui est exactement l'inverse du but.
 */
export function applyNotes(entries, userId = OWNER) {
  const ins = db.prepare(
    'INSERT INTO messages(user_id, ts, date, source, role, text) VALUES(?,?,?,?,?,?)'
  );

  const touchees = new Set();
  let ecrites = 0;

  db.exec('BEGIN');
  try {
    for (const e of entries ?? []) {
      if (!e?.date || !e?.text) continue;
      if (dejaImporte(userId, e.date).includes(e.text)) continue;   // deja colle
      ins.run(userId, `${e.date}T21:00:00.000Z`, e.date, SOURCE, 'user', e.text);
      touchees.add(e.date);
      ecrites++;
    }
    // Dans la MEME transaction que les insertions : entries.text est derive des
    // messages, et le recalculer apres coup laisserait, si le processus tombe
    // entre les deux, un corpus dont le miroir ne verrait que la moitie.
    for (const date of touchees) rebuildEntryText(date, userId);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }

  return { ecrites, journees: touchees.size };
}
