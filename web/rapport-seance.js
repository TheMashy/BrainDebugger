/**
 * LE RELEVÉ DEPUIS LA DERNIÈRE SÉANCE, MIS EN PAGE.
 *
 * Ce module ne choisit rien et n'écrit rien de lui-même : il reçoit les jours
 * que le serveur a assemblés (des phrases exactes, datées), retire celles que
 * la personne a écartées en relisant, et en fait les paragraphes du PDF.
 * Les seuls mots qu'il ajoute sont des dates, des moments de la journée, et
 * les repères qu'elle a posés elle-même.
 */
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août',
              'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const partie = d => { const [a, m, j] = d.split('-').map(Number); return { a, m, j, js: new Date(Date.UTC(a, m - 1, j)) }; };
/** « mercredi 10 septembre » */
export function jourEnLettres(d, { annee = false } = {}) {
  const p = partie(d);
  return `${JOURS[p.js.getUTCDay()]} ${p.j === 1 ? '1er' : p.j} ${MOIS[p.m - 1]}${annee ? ' ' + p.a : ''}`;
}
const majuscule = s => s.charAt(0).toUpperCase() + s.slice(1);
const nbJours = (a, b) => Math.round((partie(b).js - partie(a).js) / 86400000) + 1;

/** Les jours, sans ce que la personne a retiré — et sans les jours devenus vides. */
export function jourSansRetraits(jours, retirees = new Set()) {
  return jours.map(j => ({
    ...j,
    moments: j.moments.map(m => ({ ...m, citations: m.citations.filter(c => !retirees.has(c.id)) }))
                      .filter(m => m.citations.length)
  })).filter(j => j.moments.length || j.reperes.length);
}

const GRIS = [0.42, 0.42, 0.47];
const ENCRE = [0.1, 0.1, 0.12];
const REPERE = [0.24, 0.3, 0.52];

/** Les paragraphes de `documentPdf` (web/pdf.js). */
export function paragraphesDuRapport(r, retirees = new Set()) {
  const jours = jourSansRetraits(r.jours, retirees);
  const n = nbJours(r.debut, r.fin);
  const P = [];
  P.push({ morceaux: [{ t: 'Depuis ma dernière séance', f: 'HB', s: 20, c: ENCRE }], interligne: 1.2 });
  P.push({ avant: 4, morceaux: [{ t: `Du ${jourEnLettres(r.debut)} au ${jourEnLettres(r.fin, { annee: true })} · ${n} jours · ce que j'ai écrit dans mon journal`, f: 'H', s: 10.5, c: GRIS }] });
  P.push({ avant: 8, morceaux: [{ t: 'Mes phrases exactes, datées au moment où je les ai écrites. Rien n’est reformulé ni résumé : '
    + (r.choix === 'modele' ? 'une sélection a été faite pour que ça tienne en quelques pages'
                            : 'une sélection automatique a été faite pour que ça tienne en quelques pages')
    + ', et tout ce qui parlait de mourir, de me faire du mal ou de prendre quelque chose y est.', f: 'HI', s: 9, c: GRIS }] });

  for (const j of jours) {
    const titre = j.date === r.fin ? `Aujourd'hui, ${jourEnLettres(j.date)}` : majuscule(jourEnLettres(j.date));
    const tete = [{ t: titre, f: 'HB', s: 11.5, c: ENCRE }];
    if (j.note != null) tete.push({ t: `   note du jour : ${j.note}/10`, f: 'H', s: 9, c: GRIS });
    P.push({ avant: 16, garder: true, morceaux: tete });
    for (const rep of j.reperes) {
      P.push({ avant: 3, retrait: 12, morceaux: [{ t: 'Repère posé : ', f: 'H', s: 9.5, c: REPERE }, { t: rep, f: 'HB', s: 9.5, c: REPERE }] });
    }
    const seul = j.moments.length === 1;
    for (const m of j.moments) {
      const morceaux = [];
      if (!seul && m.periode) morceaux.push({ t: `${majuscule(m.periode)} : `, f: 'H', s: 10, c: GRIS });
      m.citations.forEach((c, i) => {
        if (i) morceaux.push({ t: ', ', f: 'T', s: 11.5, c: ENCRE });
        // Espaces INSÉCABLES dans les guillemets : sinon « » » peut tomber
        // seul en début de ligne, loin de la phrase qu'il ferme.
        morceaux.push({ t: `«\u00a0${c.texte}\u00a0»`, f: 'T', s: 11.5, c: ENCRE });
      });
      morceaux.push({ t: '.', f: 'T', s: 11.5, c: ENCRE });
      P.push({ avant: 4, retrait: 12, interligne: 1.42, morceaux });
    }
  }
  if (!jours.length) P.push({ avant: 18, morceaux: [{ t: 'Rien d’écrit sur cette période.', f: 'HI', s: 11, c: GRIS }] });
  return P;
}

export const nomDuFichier = r => `seance-${r.fin}.pdf`;
