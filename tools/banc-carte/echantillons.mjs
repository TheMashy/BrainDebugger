/*
 * DES CARTES DE FORMES ET DE TAILLES DIFFERENTES.
 *
 * Chacune est un cas qu'une vraie lecture peut produire. Ce ne sont pas des
 * cartes « jolies » : ce sont les cas ou l'on veut savoir ce que le rendu fait.
 */
const GENRES = ['dependance', 'travail', 'personne', 'lieu', 'corps', 'periode',
                'activite', 'mecanisme'];

/** Un generateur deterministe : deux passages donnent la meme carte. */
export function rng(graine) {
  let s = graine >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * Une carte a `amas` groupes de `parAmas` noeuds, avec `ponts` liens entre
 * groupes et `bruit` noeuds orphelins.
 */
export function fabriquer({ amas = 3, parAmas = 5, ponts = 2, bruit = 0,
                            densite = 0.6, graine = 7, nommer = true,
                            partage = 0 } = {}) {
  const r = rng(graine);
  const noeuds = [], liens = [], pistes = [];
  for (let a = 0; a < amas; a++) {
    const membres = [];
    for (let k = 0; k < parAmas; k++) {
      const nom = `a${a}n${k}`;
      membres.push(nom);
      noeuds.push({ nom, genre: GENRES[(a * 3 + k) % GENRES.length],
                    poids: 1 + Math.floor(r() * 9),
                    jours: Array.from({ length: 1 + Math.floor(r() * 20) },
                                      (_, i) => `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, '0')}`) });
    }
    // Dedans : chaque paire reliee avec la probabilite `densite`.
    for (let i = 0; i < membres.length; i++)
      for (let j = i + 1; j < membres.length; j++)
        if (r() < densite) liens.push({ de: membres[i], vers: membres[j], quoi: 'va avec', force: 1 + Math.floor(r() * 3) });
    if (nommer) pistes.push({ nom: `groupe ${a}`, teinte: 200 + a * 47, noeuds: membres, themes: [] });
  }
  /*
   * LE RECOUVREMENT. Une vraie lecture ne partitionne pas : le meme noeud
   * revient dans deux pistes, parce qu'il appartient vraiment aux deux. On
   * ajoute donc `partage` noeuds de chaque groupe a la piste suivante, et un
   * lien pour que ce soit vrai sur la carte aussi.
   */
  if (nommer && partage > 0) for (let a = 0; a < amas; a++) {
    const b = (a + 1) % amas;
    if (a === b) continue;
    for (let k = 0; k < partage; k++) {
      const nom = `a${a}n${k}`;
      if (!pistes[b].noeuds.includes(nom)) pistes[b].noeuds.push(nom);
      liens.push({ de: nom, vers: `a${b}n${k}`, quoi: 'tient a', force: 2 });
    }
  }
  // Les ponts : des liens qui traversent deux groupes.
  for (let p = 0; p < ponts; p++) {
    const a = Math.floor(r() * amas), b = (a + 1 + Math.floor(r() * (amas - 1))) % amas;
    if (a === b || amas < 2) continue;
    liens.push({ de: `a${a}n${Math.floor(r() * parAmas)}`,
                 vers: `a${b}n${Math.floor(r() * parAmas)}`, quoi: 'mene a', force: 2 });
  }
  // Le bruit : des orphelins, relies entre eux par paires.
  for (let b = 0; b < bruit; b++) {
    noeuds.push({ nom: `libre${b}`, genre: GENRES[b % GENRES.length], poids: 1 + Math.floor(r() * 4), jours: [] });
    if (b % 2 === 1) liens.push({ de: `libre${b - 1}`, vers: `libre${b}`, quoi: 'avec', force: 1 });
  }
  return { carte: { noeuds, liens }, pistes };
}

/** Les cas qu'on regarde. */
export const CAS = [
  { id: 'minuscule',   titre: '6 nœuds, 2 groupes',            o: { amas: 2, parAmas: 3, ponts: 1, bruit: 0 } },
  { id: 'typique',     titre: '15 nœuds, 3 groupes nommés',    o: { amas: 3, parAmas: 5, ponts: 2, bruit: 4 } },
  { id: 'dense',       titre: '24 nœuds, tout relié',          o: { amas: 3, parAmas: 8, ponts: 6, bruit: 0, densite: 0.9 } },
  { id: 'epars',       titre: '24 nœuds, presque rien relié',  o: { amas: 4, parAmas: 6, ponts: 0, bruit: 6, densite: 0.15 } },
  { id: 'gros',        titre: '48 nœuds, 6 groupes',           o: { amas: 6, parAmas: 8, ponts: 8, bruit: 6 } },
  { id: 'plafond',     titre: '64 nœuds — la limite',          o: { amas: 8, parAmas: 8, ponts: 12, bruit: 0 } },
  { id: 'sansnom',     titre: '20 nœuds, AUCUNE piste',        o: { amas: 4, parAmas: 5, ponts: 3, bruit: 0, nommer: false } },
  { id: 'unseul',      titre: '18 nœuds, UN seul groupe',      o: { amas: 1, parAmas: 18, ponts: 0, bruit: 0, densite: 0.25 } },
  { id: 'orphelins',   titre: '4 nommés, 16 orphelins',        o: { amas: 1, parAmas: 4, ponts: 0, bruit: 16 } },
  { id: 'chevauche',   titre: '15 nœuds, pistes qui se recoupent', o: { amas: 3, parAmas: 5, ponts: 1, bruit: 0, partage: 2 } },
  { id: 'tresse',      titre: '24 nœuds, recouvrement épais',   o: { amas: 4, parAmas: 6, ponts: 2, bruit: 0, partage: 3 } }
];
