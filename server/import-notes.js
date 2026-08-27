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
  let s = String(line).trim()
    .replace(/^[-–—*•>#\s]+/, '')          // puces et titres Markdown
    .replace(/^[[({<]\s*/, '')             // [2024-03-12]  (12 mars 2024)
    .replace(/\s*[\])}>]\s*$/, '')
    .replace(/^le\s+/i, '')                // « Le 12 mars 2024 »
    .replace(/\.md$/i, '');                // en-tete recopie d'un fichier Obsidian
  if (!s) return null;

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
  const sansHeure = rest => suite(rest)
    .replace(/^(?:[àa]\s+)?\d{1,2}\s*[h:]\s*\d{0,2}\s*(?:am|pm)?[\s,:—–-]*/i, '');

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

  // 12/03  |  12-03 — jour/mois, l'annee vient du contexte
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})\b(.*)$/);
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
  for (const l of lignes) {
    if (!l.trim() || separatriceMd(l)) continue;
    const c = cellules(l);
    if (c && c.length >= 2) grille.push(c);
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

  return { entries, ignore: '', table: true, lignesIgnorees: ignorees };
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
export function parseNotes(text, ctx0 = {}) {
  // Un tableau colle depuis un tableur ne se lit pas ligne a ligne : la date y
  // occupe une colonne, pas une ligne a elle. On tente donc cette forme
  // d'abord -- elle ne repond que si la structure est franchement tabulaire.
  const table = parseTable(text, { ...ctx0 });
  if (table) return table;

  const lignes = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const ordre = [];
  const par = new Map();
  const avant = [];
  let courant = null;

  // Contexte de lecture, pour les dates sans annee. Il avance ligne a ligne :
  // une annee explicite le recale, une ligne isolee « 2024 » aussi -- c'est
  // ainsi qu'un cahier est ecrit, l'annee en tete puis plus jamais.
  const ctx = { annee: null, precedente: null, ...ctx0 };

  for (const ligne of lignes) {
    const seule = ligne.trim().match(/^(19|20)(\d{2})$/);
    if (seule && courant === null) { ctx.annee = Number(seule[0]); continue; }

    const hit = parseDateLine(ligne, ctx);
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
