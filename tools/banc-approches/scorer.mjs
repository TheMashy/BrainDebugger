/*
 * LE SCORER : ce qu'une méthode a retrouvé, et ce qu'elle a inventé.
 *
 * Appariement UN-À-UN par type (glouton, par crédit décroissant). Une dimension
 * sur laquelle la méthode s'abstient (direction, signe, genre) vaut 0,5 ; une
 * dimension affirmée à tort vaut 0 ET un faux positif. Un item planté que
 * l'oracle a jugé non identifiable est NEUTRE : ce qui l'apparie n'est ni
 * récompensé ni puni. Le témoin n'a presque rien de planté : ce qu'on y rend
 * est la mesure des fausses découvertes.
 */
export const TYPES = ['edge', 'chain', 'episode', 'ews', 'rhythm', 'regularity', 'autocorr', 'coupling_sign', 'language'];
const sousSeq = (petit, grand) => { let i = 0; for (const s of grand) if (s === petit[i]) i++; return i === petit.length; };

/** Rend, par type : { credit, rendus, plantes, fp, neutresApparies } et les totaux. */
export function noter(tr, verite, T) {
  const par = {}; for (const t of TYPES) par[t] = { credit: 0, rendus: 0, plantes: 0, fp: 0 };
  const plantes = t => verite.filter(v => v.type === t);
  const identif = t => plantes(t).filter(v => !v.neutre);
  const neutres = t => plantes(t).filter(v => v.neutre);

  /* appariement générique : credits(rendu, plante) -> crédit ou null (pas appariable) */
  const apparier = (type, rendus, credits, { neutreSi } = {}) => {
    const P = identif(type), N = neutres(type), used = new Set();
    par[type].plantes += P.length; par[type].rendus += rendus.length;
    const paires = [];
    rendus.forEach((r, i) => P.forEach((p, k) => { const c = credits(r, p); if (c != null) paires.push({ i, k, c }); }));
    paires.sort((a, b) => b.c - a.c);
    const pris = new Set(), rendusPris = new Set();
    for (const { i, k, c } of paires) { if (pris.has(k) || rendusPris.has(i)) continue; pris.add(k); rendusPris.add(i); par[type].credit += c; if (c === 0) par[type].fp++; }
    rendus.forEach((r, i) => {
      if (rendusPris.has(i)) return;
      const neutre = N.some(p => credits(r, p) != null) || (neutreSi && neutreSi(r));
      if (neutre) par[type].rendus--;   // ni récompensé ni puni
      else par[type].fp++;
    });
  };

  // ---- arêtes ----
  const memePaire = (r, p) => (r.a === p.a && r.b === p.b) || (r.a === p.b && r.b === p.a);
  const couplingsCredit = new Set();
  apparier('edge', tr.edges ?? [], (r, p) => {
    if (!memePaire(r, p)) return null;
    const bonLag = Math.abs((r.lag ?? 0) - p.lag) <= 1;
    if (r.dir === false || r.signe == null) { if (r.signe == null || r.signe === p.signe) return bonLag ? 0.5 : 0.25; return 0; }   // non dirigé / non signé
    const bonneDir = r.a === p.a && r.b === p.b;
    if (!bonneDir) return 0;
    if (r.signe !== p.signe) return 0;
    return bonLag ? 1 : 0.5;
  }, { neutreSi: r => {
    // une arête sommeil_h↔humeur négative crédite coupling_sign (0,5) : consommée ici, pas un FP
    if (memePaire(r, { a: 'sommeil_h', b: 'humeur' }) && r.signe === '-' && identif('coupling_sign').length) { couplingsCredit.add('global'); return true; }
    return false;
  } });
  // ---- chaînes ----
  apparier('chain', tr.chains ?? [], (r, p) => {
    if (sousSeq(p.etats, r)) return 1;
    if (r.length >= Math.ceil(2 / 3 * p.etats.length) && sousSeq(r, p.etats)) return 0.5;
    return null;
  });
  // ---- épisodes : un début à ±5 j ; une coupure à la fin d'un épisode (rémission) est neutre ----
  const fins = plantes('episode').map(p => p.t1).filter(x => x != null);
  apparier('episode', tr.episodes ?? [], (r, p) => {
    if (Math.abs(r.jour - p.t0) > 5) return null;
    if (r.genre == null) return 0.5; return r.genre === p.genre ? 1 : 0;
  }, { neutreSi: r => fins.some(f => Math.abs(r.jour - f) <= 5) });
  // ---- alertes : dans [t0−14, t0−1] ; pendant l'épisode : neutre ; ailleurs : faux positif ----
  const epis = plantes('episode');
  apparier('ews', tr.alertes ?? [], (d, p) => (d >= p.t0 - 14 && d <= p.t0 - 1 ? 1 : null),
    { neutreSi: d => epis.some(e => d >= e.t0 && d <= (e.t1 ?? e.t0 + 21)) });
  // ---- rythme, régularité, autocorr ----
  apparier('rhythm', tr.rhythm ?? [], (r, p) => (r === p.periode ? 1 : null));
  apparier('regularity', tr.regularity ? [tr.regularity] : [], (r, p) => (r.var === p.var ? (r.classe === p.classe ? 1 : 0) : null));
  apparier('autocorr', tr.autocorr ? [tr.autocorr] : [], (r, p) => (r === p.classe ? 1 : 0));
  // ---- couplage par régime ----
  const rendusC = (tr.couplings ?? []).slice();
  apparier('coupling_sign', rendusC, (r, p) => {
    const recouvre = Math.max(0, Math.min(r.a_jour, p.a_jour) - Math.max(r.de, p.de)) / (p.a_jour - p.de);
    if (recouvre < 0.5) return null;
    return r.signe === p.signe ? 1 : 0;
  });
  if (couplingsCredit.size && par.coupling_sign.credit === 0 && identif('coupling_sign').length) { par.coupling_sign.credit += 0.5; par.coupling_sign.rendus += 1; }
  // ---- langage ----
  const rendusL = []; if (tr.language?.r != null) rendusL.push({ avec: 'humeur', r: tr.language.r }); if (tr.language?.r_dereel != null) rendusL.push({ avec: 'dereel', r: tr.language.r_dereel });
  apparier('language', rendusL, (r, p) => (r.avec === p.avec ? 1 : null));

  /* faux positifs pour 100 jours, par type, et fausses alertes hors épisodes */
  const fp100 = {}; for (const t of TYPES) fp100[t] = par[t].fp / T * 100;
  let joursHors = T; for (const e of epis) joursHors -= Math.min(T, (e.t1 ?? e.t0 + 21)) - Math.max(0, e.t0 - 14);
  const fauxAlertes100 = par.ews.fp / Math.max(1, joursHors) * 100;
  const total = { credit: 0, rendus: 0, plantes: 0, fp: 0 };
  for (const t of TYPES) { total.credit += par[t].credit; total.rendus += par[t].rendus; total.plantes += par[t].plantes; total.fp += par[t].fp; }
  return { parType: par, total, fp100, fauxAlertes100 };
}
/** F1 micro à partir de comptes cumulés. */
export function f1De(c) {
  const precision = c.rendus > 0 ? c.credit / c.rendus : null;
  const rappel = c.plantes > 0 ? c.credit / c.plantes : null;
  const f1 = precision != null && rappel != null && precision + rappel > 0 ? 2 * precision * rappel / (precision + rappel) : (precision == null || rappel == null ? null : 0);
  return { precision, rappel, f1 };
}
