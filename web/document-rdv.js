/**
 * LE DOCUMENT QU'ON EMPORTE, EN UNE PAGE QU'ON IMPRIME.
 *
 * Il se fabrique ICI, dans le navigateur, à partir de ce que la route rend.
 * Rien ne part sur un serveur pour être mis en forme : le journal de
 * quelqu'un n'a pas à traverser une machine de plus pour devenir un PDF.
 *
 * TROIS RÈGLES DE FORME, ET ELLES VIENNENT DE L'USAGE.
 *
 * 1. AUCUNE COULEUR D'ALERTE. Un document tendu à quelqu'un ne crie pas. Les
 *    journées qui portent un signe se distinguent par un filet et par leur
 *    citation, pas par du rouge : la couleur déciderait à la place de la
 *    lectrice, et elle déciderait aussi à la place de la personne qui le tend.
 * 2. CHAQUE SIGNE PORTE SA PHRASE. C'est ce qui rend le document contestable
 *    — si un signe est faux, il se voit sur la même ligne. Sans citation, le
 *    document demande qu'on le croie.
 * 3. AUCUNE MOYENNE, AUCUNE TENDANCE, AUCUN SCORE. Des dates, des durées, des
 *    citations, et des comptes avec leur dénominateur.
 */

/*
 * LA GÉOMÉTRIE VIENT DE LA FRISE DE L'ÉCRAN, L'ENCRE EST ÉCRITE ICI.
 *
 * `voies`, `etendue` et `situer` décident OÙ tombe un repère : c'est la part
 * qui ne doit surtout pas diverger, sinon le document et l'écran placeraient
 * le même fait à deux endroits, et c'est le document — celui qu'on tend à
 * quelqu'un — qui aurait tort. Le DESSIN, lui, est légitimement différent :
 * l'écran est sombre, survolable et coloré par l'écart ; le papier est noir
 * sur blanc, sans survol, et doit rester lisible photocopié.
 */
import { voies, situer, estPeriode, finEffective } from './frise.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
              'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];

const ech = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const jourMois = d => `${Number(d.slice(8))} ${MOIS[Number(d.slice(5, 7)) - 1]}`;
const complet = d => `${jourMois(d)} ${d.slice(0, 4)}`;
const nomJour = d => JOURS[new Date(`${d}T12:00:00Z`).getUTCDay()];
const ans = (a, b) => {
  const j = Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  if (j < 62) return `${j} jour${j > 1 ? 's' : ''}`;
  if (j < 730) return `${Math.round(j / 30.4)} mois`;
  return `${(j / 365.25).toFixed(j % 365 < 40 ? 0 : 1)} ans`.replace('.', ',');
};

/** Le parcours : périodes et points mêlés, du plus ancien au plus récent. */
function parcours(frise) {
  const tout = [
    ...(frise.periodes ?? []).map(p => ({ ...p, periode: true })),
    ...(frise.points ?? []).map(p => ({ ...p, periode: false }))
  ].sort((a, b) => a.date.localeCompare(b.date));
  if (!tout.length) return '<p class="vide">Aucun repère n’a encore été posé sur la frise.</p>';

  const parAn = new Map();
  for (const e of tout) {
    const an = e.date.slice(0, 4);
    if (!parAn.has(an)) parAn.set(an, []);
    parAn.get(an).push(e);
  }
  return [...parAn].map(([an, liste]) => `
    <div class="an">
      <div class="anum">${an}</div>
      <div class="alignes">${liste.map(e => `
        <div class="rep">
          <div class="rquand">${e.periode
            ? `${jourMois(e.date)} → ${e.ouvert ? 'en cours'
                // L'ANNÉE DE FIN QUAND LA PÉRIODE TRAVERSE LES ANNÉES. « 3
                // septembre → 28 juin » sous le titre « 2001 » se lit comme
                // une année scolaire ; c'en était douze. Sur une frise de vie
                // que quelqu'un d'autre lit, c'est exactement la chose à ne
                // pas laisser deviner.
                : (e.fin.slice(0, 4) === e.date.slice(0, 4) ? jourMois(e.fin) : complet(e.fin))}`
            : jourMois(e.date)}</div>
          <div class="rquoi">${ech(e.label)}${e.periode
            ? ` <span class="rduree">${ans(e.date, e.fin)}</span>` : ''}</div>
        </div>`).join('')}</div>
    </div>`).join('');
}

/** Les trente derniers jours : une ligne par jour, du plus ancien au plus récent. */
function derniers(jours) {
  return jours.map(j => {
    const nuit = j.sommeil_h != null || j.coucher || j.lever
      ? `${j.coucher ? `couché ${j.coucher}` : ''}${j.coucher && j.lever ? ' · ' : ''}${
          j.lever ? `levé ${j.lever}` : ''}${j.sommeil_h != null
          ? ` · ${String(j.sommeil_h).replace('.', ',')} h` : ''}${
          j.source_nuit === 'dit' ? ' <span class="dit">écrit</span>' : ''}`
      : '<span class="rien">—</span>';
    const signes = j.signes.map(s => `
      <div class="signe">
        <div class="slib">${ech(s.libelle)}</div>
        ${s.extrait ? `<blockquote>${ech(s.extrait)}</blockquote>` : ''}
      </div>`).join('');
    const evoques = j.evoques.map(s => `
      <div class="signe passe">
        <div class="slib">${ech(s.libelle)}</div>
        ${s.extrait ? `<blockquote>${ech(s.extrait)}</blockquote>` : ''}
      </div>`).join('');
    return `<div class="jour${j.signes.length ? ' porte' : ''}">
      <div class="jdate"><b>${Number(j.date.slice(8))}</b> <span>${nomJour(j.date)}</span></div>
      <div class="jnuit">${nuit}</div>
      <div class="jnote">${j.note != null ? String(j.note).replace('.', ',') : ''}</div>
      <div class="jsignes">${signes}${evoques}</div>
    </div>`;
  }).join('');
}

/* ======================= LA FRISE DU PARCOURS =======================
 *
 * Une bande horizontale de la naissance à aujourd'hui. L'AXE RESTE LINÉAIRE :
 * comprimer l'avant-journal pour donner de la place au reste ferait une frise
 * dont les durées mentent — et lire des durées est exactement ce qu'on lui
 * demande. Trente ans se tassent donc à gauche, et c'est honnête.
 */
function friseParcours(f) {
  const et = f?.etendue;
  const periodes = (f.periodes ?? []);
  const points = (f.points ?? []);
  if (!et || (!periodes.length && !points.length)) return '';

  const L = 700, MG = 22, MD = 22, util = L - MG - MD;
  const HV = 17;                                  // hauteur d'une voie
  const lanes = voies(periodes.map(p => ({ date: p.date, fin: p.fin })), 400);
  const nv = Math.max(1, ...lanes.map(v => v.voie + 1));
  const yBarres = 20, hBarres = nv * HV;
  const yAxe = yBarres + hBarres + 12;
  const H = yAxe + 46;
  const x = date => MG + situer(date, et) * util;

  const an0 = Number(et.debut.slice(0, 4)), an1 = Number(et.fin.slice(0, 4));
  const span = an1 - an0;
  const pas = span > 40 ? 10 : span > 18 ? 5 : span > 8 ? 2 : 1;
  const ticks = [];
  for (let a = Math.ceil(an0 / pas) * pas; a <= an1; a += pas) ticks.push(a);

  const barres = periodes.map((p, i) => {
    const x0 = x(p.date), x1 = Math.max(x0 + 2, x(p.fin));
    const y = yBarres + lanes[i].voie * HV;
    return `<rect x="${x0.toFixed(1)}" y="${y}" width="${(x1 - x0).toFixed(1)}" height="10"
             rx="2" fill="#e7eaee" stroke="#333" stroke-width=".7"/>
      <text x="${(x0 + 3).toFixed(1)}" y="${y + 8}" class="fpl">${ech(p.label)}</text>`;
  }).join('');

  /* Les points : un losange sur l'axe, et le libellé en dessous, alterné haut
     et bas pour que deux faits proches ne se recouvrent pas. */
  const marques = points.map((p, i) => {
    const px = x(p.date), bas = i % 2 === 1;
    const yl = yAxe + (bas ? 30 : 16);
    /*
     * UN LIBELLÉ NE SORT PAS DU CADRE. Centré, « première séance » posé sur le
     * dernier repère débordait à droite et se faisait couper au milieu d'un
     * mot. Près des bords on l'accroche donc par son extrémité — le trait de
     * rappel dit de toute façon à quel point il se rattache.
     */
    const bord = px < 90 ? 'start' : px > L - 90 ? 'end' : 'middle';
    const tx = bord === 'start' ? px - 5 : bord === 'end' ? px + 5 : px;
    return `<path d="M${px.toFixed(1)} ${yAxe - 4.5} l4.5 4.5 -4.5 4.5 -4.5 -4.5 Z" fill="#16191c"/>
      <line x1="${px.toFixed(1)}" y1="${yAxe + 4}" x2="${px.toFixed(1)}" y2="${yl - 8}"
            stroke="#9aa3ac" stroke-width=".6"/>
      <text x="${tx.toFixed(1)}" y="${yl}" class="fpt" text-anchor="${bord}">${ech(p.label)}</text>`;
  }).join('');

  return `<svg class="frise" viewBox="0 0 ${L} ${H}" role="img"
      aria-label="Frise du parcours, de ${complet(et.debut)} à ${complet(et.fin)}">
    ${barres}
    <line x1="${MG}" y1="${yAxe}" x2="${L - MD}" y2="${yAxe}" stroke="#16191c" stroke-width="1"/>
    ${ticks.map(a => {
      const px = x(`${a}-01-01`);
      if (px < MG - 1 || px > L - MD + 1) return '';
      /*
       * UNE ANNÉE QUI TOMBE SUR UN REPÈRE S'EFFACE. « déménagement » et
       * « 2025 » s'écrivaient l'un sur l'autre, et les deux devenaient
       * illisibles. Entre une graduation et un fait, c'est le fait qui reste :
       * l'échelle se retrouve avec les graduations voisines, un événement ne
       * se retrouve nulle part.
       */
      if (points.some(pt => Math.abs(x(pt.date) - px) < 30)) return '';
      return `<line x1="${px.toFixed(1)}" y1="${yAxe}" x2="${px.toFixed(1)}" y2="${yAxe + 4}"
                stroke="#9aa3ac" stroke-width=".7"/>
        <text x="${px.toFixed(1)}" y="${yAxe + 13}" class="fan" text-anchor="middle">${a}</text>`;
    }).join('')}
    ${marques}
  </svg>`;
}

/* ======================= LA FRISE DES TRENTE JOURS =======================
 *
 * Un jour par colonne, et la VERTICALE EST L'HEURE — de midi à midi, pas de
 * minuit à minuit. C'est ce qui change tout pour quelqu'un qui vit la nuit :
 * sur un axe qui coupe à minuit, chaque nuit se casse en deux morceaux collés
 * aux deux bords, et le dessin devient illisible là où il devrait être le plus
 * parlant. De midi à midi, une nuit est une barre continue, et le décalage du
 * rythme d'un jour à l'autre se lit d'un seul coup d'œil — ce qu'aucune
 * colonne de « 05:40 / 14:20 » ne donnera jamais.
 */
function friseTrenteJours(jours) {
  if (!jours.length) return '';
  const L = 700, MG = 26, MD = 6, HT = 168, HB = 22;
  const util = L - MG - MD, pas = util / jours.length;
  const larg = Math.max(3, Math.min(16, pas - 2.5));
  const H = HT + HB + 30;

  const min = h => h ? Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)) : null;

  /*
   * L'ORIGINE DE L'AXE VIENT DU RYTHME DE LA PERSONNE, PAS DE L'HORLOGE.
   *
   * Premier essai : un axe de midi à midi, pour qu'une nuit qui passe minuit
   * reste d'un seul tenant. Sur les données de quelqu'un qui se couche à 05:40
   * et se lève à 14:20, chaque nuit s'est coupée en deux morceaux collés aux
   * deux bords — exactement le défaut qu'on voulait éviter, déplacé de minuit
   * à midi. Une origine fixe ne peut pas marcher : elle tombe forcément dans
   * le sommeil de quelqu'un.
   *
   * On prend donc la MÉDIANE DES COUCHERS observés, moins une heure. L'axe
   * s'ouvre alors juste avant que la personne ne se couche d'ordinaire, et
   * presque aucune nuit ne touche les bords. C'est ce que fait déjà `nuits.js`
   * pour départager les silences : lire le rythme de quelqu'un plutôt que de
   * lui appliquer le nôtre.
   */
  const couchers = jours.map(j => min(j.coucher)).filter(m => m != null).sort((a, b) => a - b);
  /*
   * L'origine se pose dans le PLUS GRAND TROU du cercle des couchers.
   *
   * La médiane moins une heure ne suffisait pas : dès que le rythme dérive sur
   * le mois — se coucher à 3 h en début de période et à 6 h à la fin — les
   * nuits d'un bout finissent par repasser devant l'origine et se coupent en
   * deux. Or une heure est une donnée CIRCULAIRE : le bon repère n'est pas un
   * centre, c'est le vide. On cherche donc le plus grand intervalle entre deux
   * couchers consécutifs sur le cercle, et on ouvre l'axe en son milieu — là
   * où, par construction, la personne ne se couche jamais.
   */
  let ORIG = 1320;
  if (couchers.length) {
    let large = -1, ou = couchers[0];
    for (let i = 0; i < couchers.length; i++) {
      const a = couchers[i], b = couchers[(i + 1) % couchers.length];
      const trou = ((b - a) + 1440) % 1440 || (couchers.length === 1 ? 1440 : 0);
      if (trou > large) { large = trou; ou = (a + trou / 2) % 1440; }
    }
    ORIG = ((Math.round(ou / 30) * 30) % 1440 + 1440) % 1440;
  }
  const depuisOrig = m => m == null ? null : (m - ORIG + 1440) % 1440;
  const y = m => 14 + (depuisOrig(m) / 1440) * (HT - 20);

  const colonnes = jours.map((j, i) => {
    const cx = MG + i * pas + (pas - larg) / 2;
    let barre = '';
    const c = min(j.coucher), l = min(j.lever);
    if (c != null && l != null) {
      const y0 = y(c), y1 = y(l);
      // Une nuit qui repasse par midi se dessine en deux morceaux : c'est rare
      // (dormir plus de douze heures autour de midi) et le tronquer mentirait.
      const parts = y1 > y0 ? [[y0, y1]] : [[y0, HT - 6], [14, y1]];
      barre = parts.map(([a, b]) => `<rect x="${cx.toFixed(1)}" y="${a.toFixed(1)}"
        width="${larg.toFixed(1)}" height="${Math.max(1.5, b - a).toFixed(1)}" rx="1.5"
        fill="#c9cfd6" stroke="#4a545e" stroke-width=".6"/>`).join('');
    }
    const signe = j.signes.length
      ? `<path d="M${(cx + larg / 2).toFixed(1)} ${HT + 4} l4 7 -8 0 Z" fill="#16191c"/>` : '';
    const passe = !j.signes.length && j.evoques.length
      ? `<circle cx="${(cx + larg / 2).toFixed(1)}" cy="${HT + 8}" r="2.4"
           fill="none" stroke="#9aa3ac" stroke-width=".9"/>` : '';
    const num = (i === 0 || Number(j.date.slice(8)) === 1 || i % 5 === 4)
      ? `<text x="${(cx + larg / 2).toFixed(1)}" y="${HT + HB + 12}" class="fj"
           text-anchor="middle">${Number(j.date.slice(8))}</text>` : '';
    return barre + signe + passe + num;
  }).join('');

  const heures = [0, 1, 2, 3, 4].map(k => Math.floor(((ORIG + k * 360) % 1440) / 60));
  return `<svg class="frise" viewBox="0 0 ${L} ${H}" role="img"
      aria-label="Frise des trente derniers jours : le sommeil de chaque nuit, et les journées qui portent un signe">
    ${heures.map((h, k) => {
      const yy = 14 + (k / 4) * (HT - 20);
      return `<line x1="${MG - 3}" y1="${yy.toFixed(1)}" x2="${L - MD}" y2="${yy.toFixed(1)}"
                stroke="#e2e6ea" stroke-width=".7"/>
        <text x="${MG - 7}" y="${(yy + 3).toFixed(1)}" class="fh" text-anchor="end">${
          String(h).padStart(2, '0')}h</text>`;
    }).join('')}
    ${colonnes}
  </svg>
  <div class="flg"><span><i class="lnuit"></i>une nuit dormie</span>
    <span><i class="lsigne"></i>une journée qui porte un signe</span>
    <span><i class="lpasse"></i>un souvenir raconté</span></div>`;
}

export function documentRendezVous(d) {
  const f = d.frise ?? {};
  const c = d.comptes ?? {};
  const dj = d.derniers ?? [];
  const de = dj.length ? dj[0].date : null;
  const a = dj.length ? dj[dj.length - 1].date : null;
  const parGenre = Object.entries(c.par_genre ?? {});

  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Document — ${complet(d.fait_le)}</title>
<style>
  :root { --encre:#16191c; --gris:#5c6570; --filet:#d8dde2; --pale:#f3f5f7; }
  * { box-sizing:border-box; }
  body { margin:0; background:#fff; color:var(--encre);
         font:15px/1.55 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; }
  .page { max-width:760px; margin:0 auto; padding:38px 30px 80px; }
  .mono, .rquand, .jdate, .jnuit, .jnote, .anum, .cpt b {
    font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-variant-numeric:tabular-nums; }

  h1 { font-size:23px; font-weight:600; margin:0 0 4px; letter-spacing:-.01em; }
  .sous { color:var(--gris); font-size:13.5px; margin:0 0 20px; }
  .avert { border:1px solid var(--filet); background:var(--pale); border-radius:6px;
           padding:12px 14px; font-size:13px; color:var(--gris); margin:0 0 26px; }
  .avert b { color:var(--encre); font-weight:600; }
  h2 { font-size:12px; font-weight:600; letter-spacing:.09em; text-transform:uppercase;
       color:var(--gris); margin:32px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--filet); }
  h2 .n { float:right; font-weight:400; letter-spacing:0; text-transform:none; }

  .an { display:grid; grid-template-columns:56px 1fr; gap:14px; margin-bottom:6px; page-break-inside:avoid; }
  .anum { font-size:13px; color:var(--gris); padding-top:2px; }
  .rep { display:grid; grid-template-columns:186px 1fr; gap:12px; padding:3px 0; }
  .rquand { font-size:11px; color:var(--gris); padding-top:3px; white-space:nowrap; }
  .rquoi { font-size:14.5px; }
  .rduree { color:var(--gris); font-size:12px; }

  .jour { display:grid; grid-template-columns:52px 1fr 34px; gap:12px;
          padding:6px 0 6px 8px; border-top:1px solid var(--filet); page-break-inside:avoid; }
  .jour.porte { border-left:2px solid var(--encre); padding-left:10px; }
  .jdate { font-size:12.5px; padding-top:2px; }
  .jdate span { color:var(--gris); font-size:11px; }
  .jnuit { font-size:12px; color:var(--gris); padding-top:3px; }
  .jnuit .dit { color:var(--encre); }
  .jnote { font-size:13px; text-align:right; padding-top:2px; }
  .jsignes { grid-column:2 / -1; }
  .signe { margin-top:6px; }
  .slib { font-size:13px; font-weight:600; }
  .signe.passe .slib { font-weight:400; color:var(--gris); font-style:italic; }
  blockquote { margin:3px 0 0; padding-left:10px; border-left:2px solid var(--filet);
               color:var(--gris); font-size:13px; }
  .rien { color:#aeb6bd; }

  .frise { width:100%; height:auto; display:block; margin:2px 0 6px; page-break-inside:avoid; }
  .frise text { font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; fill:var(--gris); }
  .frise .fpl { font-family:"Iowan Old Style",Georgia,serif; font-size:9.5px; fill:var(--encre); }
  .frise .fpt { font-family:"Iowan Old Style",Georgia,serif; font-size:9px; fill:var(--encre); }
  .frise .fan { font-size:8.5px; }
  .frise .fh  { font-size:8px; }
  .frise .fj  { font-size:8px; }
  .flg { display:flex; flex-wrap:wrap; gap:6px 16px; font-size:11px; color:var(--gris); margin:0 0 6px; }
  .flg span { display:inline-flex; align-items:center; gap:5px; }
  .flg i { width:9px; height:9px; display:inline-block; }
  .flg .lnuit { background:#c9cfd6; border:1px solid #4a545e; border-radius:2px; }
  .flg .lsigne { width:0; height:0; border-left:5px solid transparent; border-right:5px solid transparent;
                 border-top:8px solid #16191c; }
  .flg .lpasse { border:1px solid var(--gris); border-radius:50%; }

  .detail { margin-top:18px; }
  .dtitre { font-size:11px; letter-spacing:.07em; text-transform:uppercase; color:var(--gris);
            margin-bottom:2px; }

  .comptes { display:flex; flex-wrap:wrap; gap:8px 10px; margin-top:4px; }
  .cpt { border:1px solid var(--filet); border-radius:5px; padding:5px 9px; font-size:12.5px; color:var(--gris); }
  .cpt b { color:var(--encre); font-weight:600; }
  .vide { color:var(--gris); font-size:13.5px; }
  .pied { margin-top:34px; padding-top:12px; border-top:1px solid var(--filet);
          color:var(--gris); font-size:12px; }

  .barre { position:sticky; top:0; background:#fff; border-bottom:1px solid var(--filet);
           padding:10px 30px; display:flex; gap:10px; align-items:center; justify-content:flex-end; }
  .barre button { font:inherit; font-size:13px; padding:6px 14px; border:1px solid var(--filet);
                  background:#fff; border-radius:6px; cursor:pointer; }
  @media print { .barre { display:none; } .page { padding:0; max-width:none; } @page { margin:16mm; } }
</style></head><body>
<div class="barre"><button onclick="window.print()">Imprimer / enregistrer en PDF</button></div>
<div class="page">
  <h1>Ce que j’ai noté</h1>
  <p class="sous">Document préparé le ${complet(d.fait_le)}${de && a
    ? ` · les ${d.jours} derniers jours vont du ${jourMois(de)} au ${jourMois(a)}` : ''}.</p>

  <p class="avert">Ce document ne contient <b>aucune interprétation</b> : ni score, ni moyenne, ni
  évolution. Il rassemble des <b>faits datés</b> que j’ai posés moi-même, des <b>heures mesurées</b>,
  et des <b>phrases que j’ai écrites</b>, citées telles quelles. Un signe repéré par l’application
  peut être faux — c’est pour ça que la phrase qui l’a déclenché est toujours à côté.</p>

  <h2>Le parcours<span class="n">${(f.periodes?.length ?? 0) + (f.points?.length ?? 0)} repères${
    f.naissance ? ` · depuis ${complet(f.naissance)}` : ''}</span></h2>
  ${friseParcours(f)}
  ${parcours(f)}

  <h2>Les ${d.jours} derniers jours<span class="n">${c.avec_signe ?? 0} journée${
    (c.avec_signe ?? 0) > 1 ? 's' : ''} sur ${c.jours ?? 0} portent un signe</span></h2>
  ${friseTrenteJours(dj)}
  <div class="detail">
    <div class="dtitre">Jour par jour</div>
    ${derniers(dj)}
  </div>

  <h2>Ce qui se compte</h2>
  <div class="comptes">
    <span class="cpt"><b>${c.jours ?? 0}</b> jours couverts</span>
    <span class="cpt"><b>${c.avec_signe ?? 0}</b> avec un signe du jour</span>
    ${parGenre.map(([g, n]) => `<span class="cpt"><b>${n}</b> · ${ech(g.replace(/_/g, ' '))}</span>`).join('')}
    <span class="cpt"><b>${c.nuits_mesurees ?? 0}</b> nuits mesurées, dont <b>${
      c.nuits_dites ?? 0}</b> écrites</span>
  </div>

  <p class="pied">Les heures de coucher et de lever sont relues sur tout le journal, pas seulement
  sur ce qui a été noté sur le moment : « écrit » signale celles que j’ai écrites moi-même, les
  autres sont déduites de l’activité de l’ordinateur. Ce qui est présenté en italique et en gris a
  été <b>raconté</b> — un souvenir qui remonte, pas quelque chose de ce jour-là.</p>
</div></body></html>`;
}
