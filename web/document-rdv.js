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
  ${parcours(f)}

  <h2>Les ${d.jours} derniers jours<span class="n">${c.avec_signe ?? 0} journée${
    (c.avec_signe ?? 0) > 1 ? 's' : ''} sur ${c.jours ?? 0} portent un signe</span></h2>
  ${derniers(dj)}

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
