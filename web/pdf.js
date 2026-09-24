/**
 * =====================================================================
 *  UN PDF, SANS BIBLIOTHÈQUE.
 *
 * Le rapport de séance se relit dans l'application, puis devient un PDF
 * DANS LE NAVIGATEUR : le journal de quelqu'un n'a pas à traverser une
 * machine de plus pour changer de format. Et le produit n'a aucune
 * dépendance — ce n'est pas pour un rapport qu'il en prendra une.
 *
 * Ce qu'il faut pour ça est petit : les polices de base que tout lecteur PDF
 * possède (Helvetica, Times — rien à embarquer), le codage WinAnsi qui couvre
 * tout le français, leurs largeurs exactes pour couper les lignes (voir
 * pdf-metriques.js), et une mise en page qui descend la page et en ouvre une
 * autre quand elle est pleine.
 * =====================================================================
 */
import { CP1252, LARGEURS } from './pdf-metriques.js';

const POLICES = { H: 'Helvetica', HB: 'Helvetica-Bold', HI: 'Helvetica-Oblique',
                  T: 'Times-Roman', TI: 'Times-Italic', TB: 'Times-Bold' };
const OCTET = new Map([...CP1252].map((c, i) => [c, i + 32]).filter(([c]) => c !== '�'));

/* Ce que WinAnsi n'a pas, ramené à ce qu'il a : une espace insécable fine,
   des guillemets typographiques rares, un tiret insécable. Le reste (emoji,
   écritures non latines) disparaît plutôt que d'imprimer un carré. */
const EQUIVALENTS = { ' ': ' ', ' ': ' ', '‑': '-', '‐': '-',
                      '−': '-', '‛': '’', '′': '’', '­': '' };

/** Le texte, tel qu'il peut s'écrire dans ces polices. */
export function versWinAnsi(texte) {
  let out = '';
  for (const c of String(texte ?? '').normalize('NFC')) {
    const d = EQUIVALENTS[c] ?? c;
    if (d === '\n' || d === '\t') { out += ' '; continue; }
    for (const e of d) if (OCTET.has(e)) out += e;
  }
  return out;
}

/** Largeur d'un texte déjà ramené à WinAnsi, en points. */
export function largeur(texte, police, taille) {
  const t = LARGEURS[police];
  let s = 0;
  for (const c of texte) s += t[(OCTET.get(c) ?? 32) - 32] || 0;
  return (s * taille) / 1000;
}

/** Un texte dans une chaîne PDF : parenthèses et barres échappées, octets en octal. */
function chainePdf(texte) {
  let s = '(';
  for (const c of texte) {
    const b = OCTET.get(c) ?? 32;
    if (c === '(' || c === ')' || c === '\\') s += '\\' + c;
    else if (b < 128) s += c;
    else s += '\\' + b.toString(8).padStart(3, '0');
  }
  return s + ')';
}

/**
 * Coupe des morceaux de texte (chacun avec sa police) en lignes d'au plus
 * `largeurMax` points. Un mot plus long que la ligne est coupé net plutôt que
 * de déborder de la page.
 * @param {{t: string, f: string, s: number, c?: number[]}[]} morceaux
 */
export function couper(morceaux, largeurMax) {
  const mots = [];
  for (const m of morceaux) {
    const t = versWinAnsi(m.t);
    for (const bout of t.split(/( +)/)) if (bout) mots.push({ ...m, t: bout });
  }
  const lignes = [];
  let ligne = [], x = 0;
  const pousser = () => {
    while (ligne.length && /^ +$/.test(ligne.at(-1).t)) x -= ligne.pop().w;
    if (ligne.length) lignes.push(ligne);
    ligne = []; x = 0;
  };
  for (const m of mots) {
    let w = largeur(m.t, m.f, m.s);
    if (/^ +$/.test(m.t) && !ligne.length) continue;          // pas d'espace en début de ligne
    if (x + w > largeurMax && ligne.length) pousser();
    if (/^ +$/.test(m.t) && !ligne.length) continue;
    let reste = m.t;
    while (w > largeurMax) {                                   // mot plus long que la ligne
      let n = reste.length;
      while (n > 1 && largeur(reste.slice(0, n), m.f, m.s) > largeurMax) n--;
      ligne.push({ ...m, t: reste.slice(0, n), w: largeur(reste.slice(0, n), m.f, m.s) });
      pousser();
      reste = reste.slice(n);
      w = largeur(reste, m.f, m.s);
    }
    ligne.push({ ...m, t: reste, w });
    x += w;
  }
  pousser();
  return lignes;
}

const A4 = { l: 595.28, h: 841.89 };

/**
 * Le document entier.
 *
 * @param {object} doc
 * @param {string} doc.titre       le titre des propriétés du fichier
 * @param {string} [doc.pied]      le texte du bas de page (« page n/N » s'y ajoute)
 * @param {{morceaux: object[], avant?: number, retrait?: number, interligne?: number,
 *          garder?: boolean}[]} doc.paragraphes
 *        `garder` : ne pas laisser ce paragraphe seul en bas de page (un titre de jour).
 * @returns {Uint8Array}
 */
export function documentPdf({ titre, pied = '', paragraphes }) {
  const marge = { g: 62, d: 62, h: 64, b: 70 };
  const utile = A4.l - marge.g - marge.d;
  const pages = [];
  let ops = null, y = 0;
  const nouvellePage = () => { ops = []; pages.push(ops); y = A4.h - marge.h; };
  nouvellePage();

  const blocs = paragraphes.map(p => {
    const retrait = p.retrait ?? 0;
    const taille = Math.max(...p.morceaux.map(m => m.s));
    const pas = taille * (p.interligne ?? 1.38);
    return { ...p, retrait, pas, lignes: couper(p.morceaux, utile - retrait) };
  });

  blocs.forEach((b, i) => {
    const avant = y === A4.h - marge.h ? 0 : (b.avant ?? 0);
    // Un titre de jour ne reste jamais seul en bas de page : il part avec au
    // moins une ligne de ce qui le suit.
    const suite = b.garder && blocs[i + 1] ? blocs[i + 1].pas : 0;
    if (y - avant - b.pas - suite < marge.b) nouvellePage();
    else y -= avant;
    for (const ligne of b.lignes) {
      if (y - b.pas < marge.b) nouvellePage();
      y -= b.pas;
      let x = marge.g + b.retrait;
      for (const m of ligne) {
        const [r, g, bl] = m.c ?? [0.1, 0.1, 0.12];
        ops.push(`BT /${m.f} ${m.s} Tf ${r} ${g} ${bl} rg ${x.toFixed(2)} ${y.toFixed(2)} Td ${chainePdf(m.t)} Tj ET`);
        x += m.w;
      }
    }
  });

  // Les objets : 1 catalogue, 2 pages, 3..8 polices, puis page + contenu par page, puis infos.
  const objets = [];
  const polices = Object.keys(POLICES);
  const premierePage = 3 + polices.length;
  const kids = pages.map((_, i) => `${premierePage + i * 2} 0 R`).join(' ');
  objets.push('<< /Type /Catalog /Pages 2 0 R >>');
  objets.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  for (const p of polices) objets.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${POLICES[p]} /Encoding /WinAnsiEncoding >>`);
  const ressources = `<< /Font << ${polices.map((p, i) => `/${p} ${3 + i} 0 R`).join(' ')} >> >>`;
  pages.forEach((corps, i) => {
    const bas = versWinAnsi(`${pied}${pied ? '  —  ' : ''}page ${i + 1}/${pages.length}`);
    const flux = [...corps,
      `BT /H 8 Tf 0.45 0.45 0.5 rg ${(A4.l - marge.d - largeur(bas, 'H', 8)).toFixed(2)} 36 Td ${chainePdf(bas)} Tj ET`].join('\n');
    objets.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.l} ${A4.h}] /Resources ${ressources} /Contents ${premierePage + i * 2 + 1} 0 R >>`);
    objets.push(`<< /Length ${flux.length} >>\nstream\n${flux}\nendstream`);
  });
  const date = new Date();
  const d = `D:${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`
          + `${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}00Z`;
  objets.push(`<< /Title ${chainePdf(versWinAnsi(titre))} /Producer (BrainDebugger) /CreationDate (${d}) >>`);
  const infos = objets.length;

  let sortie = '%PDF-1.4\n%âãÏÓ\n';
  const positions = [];
  objets.forEach((o, i) => { positions.push(sortie.length); sortie += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = sortie.length;
  sortie += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`
          + positions.map(p => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
          + `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R /Info ${infos} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const octets = new Uint8Array(sortie.length);
  for (let i = 0; i < sortie.length; i++) octets[i] = sortie.charCodeAt(i) & 0xff;
  return octets;
}
