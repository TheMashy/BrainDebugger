/*
 * LE SCEPTIQUE, LENTILLE LANGAGE ET PRODUIT.
 *
 * Ce fichier ne juge pas si le moteur retrouve ce qui est planté (c'est
 * fonctionnements.test.js). Il juge CE QU'ON LIT : chaque phrase que la machine
 * écrit à son compte, sur 21 patients du banc, plus les manques, les raisons de
 * ce qu'on ne montre pas, et les textes fixes de la vue. Le produit est un
 * journal intime, lu la nuit, parfois un mauvais soir : une tournure qui
 * ressemble à un diagnostic, une cause, un conseil, une étiquette ou une
 * prédiction n'a pas le droit d'y être — et un nombre affiché n'a pas le droit
 * de mentir (« 23:60 », « ± 0 min », « ≤ 6 » et « ≥ 6 » dans la même phrase).
 *
 * La liste des tournures interdites ici est PLUS LARGE que MOTS_INTERDITS du
 * module : MOTS_INTERDITS est la règle minimale (jamais un nom de trouble) ;
 * ce test est la relecture d'un lecteur qui cherche la petite bête.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generer } from '../tools/banc-approches/generateur.mjs';
import { analyserTable, MOTS_INTERDITS, SEUILS } from '../server/fonctionnements.js';

/* ------------------------------------------------------------------ */
/* Le corpus : tout ce que la machine écrit                             */
/* ------------------------------------------------------------------ */
const dateDe = t => { const d = new Date(Date.UTC(2026, 0, 5 + t)); return d.toISOString().slice(0, 10); };   // 2026-01-05 est un lundi
const VARIABLES = ['note', 'sommeil_h', 'coucher', 'lever', 'ecran_min', 'absolus'];
const enTable = s => ({
  de: dateDe(0), a: dateDe(s.T - 1), variables: VARIABLES,
  jours: s.jours.map((j, t) => ({ date: dateDe(t), note: j.humeur, sommeil_h: j.sommeil_h, coucher: j.coucher, lever: null, ecran_min: j.ecran_min,
    absolus: j.absolus, absolus_mots: j.absolus != null ? ['toujours', 'rien'] : [], dow: t % 7, we: t % 7 >= 5 ? 1 : 0, sortie: (t % 7 === 4 || t % 7 === 5) ? 1 : 0 })),
});
const PROFILS = ['temoin', 'depression', 'anxiete', 'bipolarite', 'tdah', 'autisme', 'derealisation'];
const PATIENTS = [];
for (const p of PROFILS) for (let i = 0; i < 3; i++) PATIENTS.push({ nom: `${p}#${i}`, r: analyserTable(enTable(generer({ profil: p, famille: 'test-1', T: 180, manquants: 0.15, index: i }))) });

/** Une table construite à la main, pour les cas que le banc ne fabrique pas (capteur figé, note plate…). */
function table(N, f, variables = VARIABLES) {
  const jours = [];
  for (let t = 0; t < N; t++) {
    const j = { date: dateDe(t), note: null, sommeil_h: null, coucher: null, lever: null, ecran_min: null, absolus: null, dow: t % 7, we: t % 7 >= 5 ? 1 : 0, sortie: (t % 7 === 4 || t % 7 === 5) ? 1 : 0 };
    Object.assign(j, f(t)); jours.push(j);
  }
  return { de: dateDe(0), a: dateDe(N - 1), variables, jours };
}
/* Un aléa à graine : un test qui ne rejoue pas la même table ne prouve rien. */
function graine(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const gaussDe = r => () => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

/*
 * CE QUE LA MACHINE DIT À SON COMPTE. Les mots entre « » sont ceux de la
 * personne (« toujours », « rien » : ses mots absolus). Elle a le droit d'écrire
 * « crise » dans son journal, et la machine a le droit de la citer ; ce qui est
 * interdit, c'est que la machine emploie le mot dans SA tournure. La règle est
 * celle de compte-rendu.js (SANS_DIAGNOSTIC) : on l'applique en retirant les
 * citations avant de chercher.
 */
const laMachineDit = s => String(s).replace(/«[^»]*»/g, '');

/* Les textes fixes de la vue : les chaînes du bloc « COMMENT ÇA MARCHE CHEZ
   TOI » de app.js, sans les commentaires (ils ne se lisent pas), sans les
   `${…}` ni les balises. C'est ce bloc qui arrive sous les yeux. */
function textesDeLaVue() {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  // On part du « /* » qui ouvre le cartouche, pas du titre : sinon le cartouche n'est pas un commentaire et ses apostrophes fabriquent de fausses chaînes.
  const debut = app.lastIndexOf('/*', app.indexOf('COMMENT ÇA MARCHE CHEZ TOI.'));
  const fin = app.indexOf('async function renderLecture', debut);
  assert.ok(debut > 0 && fin > debut, 'le bloc des fonctionnements de app.js est introuvable — repères déplacés ?');
  const code = app.slice(debut, fin).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const textes = [];
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
    const t = (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length >= 4 && /[a-zà-ÿ]{3}/i.test(t)) textes.push(t);
  }
  return { code, textes };
}

/* Tout ce qui se lit, d'où que ça vienne : { d'où, texte }. */
function corpus() {
  const out = [];
  for (const { nom, r } of PATIENTS) {
    for (const it of r.items) out.push({ ou: `${nom} [${it.type}]`, texte: it.phrase });
    for (const m of r.manques) out.push({ ou: `${nom} [manque]`, texte: m });
  }
  for (const e of PATIENTS[0].r.exclus) out.push({ ou: `exclus:${e.type}`, texte: e.raison });
  for (const t of textesDeLaVue().textes) out.push({ ou: 'vue', texte: t });
  return out;
}

/* ------------------------------------------------------------------ */
/* Les tournures qu'une phrase de la machine n'a pas le droit de porter */
/* ------------------------------------------------------------------ */
const TOURNURES = [
  { quoi: 'un nom de trouble, ou un mot de clinique (un « épisode », une « phase haute », « la littérature » en sont)',
    re: /d[ée]pr[eé]ss|d[ée]prim|bipol|\bhypoman|\bmani(e|es|aque|aques)\b|tdah|adhd|autis|\btroubles?\b|diagnos|pathol|maladie|syndrome|d[ée]r[ée]alis|dissoci|anxi|angoiss|panique|insomni|hypersomni|burn.?out|borderline|schizo|psycho|n[ée]vros|sympt[ôo]m|rechute|s[ée]v[ée]rit|clinique|th[ée]rap|traitement|m[ée]dica|suicid|euthym|prodrom|phase (haute|basse)|[ée]pisode|\bcrises?\b|litt[ée]rature/i },
  { quoi: 'une cause affirmée (« tire », « pousse », « à cause de » : une régression propose, un comptage ne cause rien)',
    re: /à cause|parce que|\bcauses?\b|provoqu|entra[îi]n|expliqu|d[ée]clench|est d[ûu]e? à|\btire\b|\bpousse\b|fait (monter|baisser|que)/i },
  { quoi: 'un conseil, ou une étiquette sur la personne (« tes journées se ressemblent » est ce qu’on se dit un mauvais soir)',
    re: /tu devrais|il faut que tu|tu dois|essaie|pense à|fais attention|tu ferais|conseil|tu es (trop|un|une)\b|tu vas mal|\bnormal|anormal|\bfragile|\binstable|chaotique|malade|tes journées se ressemblent/i },
  { quoi: 'une prédiction, ou de quoi avoir peur',
    re: /\bva (baisser|monter|changer|revenir)|risque|bient[ôo]t|prochain|annonc|pr[ée]vo|pr[ée]di|\bpeur\b|inqui[eè]t|danger|\bgrave/i },
  { quoi: 'une loi générale sur la personne, là où on ne montre que des jours comptés',
    re: /\bquand ta note (baisse|monte)|à chaque fois|toujours quand|dès que/i },
  { quoi: 'un mot d’atelier que la personne ne peut pas vérifier (« au banc » ne dit rien à qui n’a pas lu le dépôt)',
    re: /\bbanc\b|bootstrap|r[ée]gression|ridge|welch|spearman|\bAR\b|[ée]cart-type|quantile|significati|\bp-?valeur|corr[ée]lation/i },
];

test('aucune phrase de la machine — 21 patients, manques, refus, vue — ne porte une tournure interdite, liste plus large que MOTS_INTERDITS', () => {
  const fautes = [];
  for (const { ou, texte } of corpus()) {
    const dit = laMachineDit(texte);
    for (const { quoi, re } of TOURNURES) { const m = re.exec(dit); if (m) fautes.push(`${ou} : « ${m[0]} » (${quoi}) dans « ${texte} »`); }
  }
  // Une seule faute suffit à échouer ; on les liste toutes, sinon on les corrige une par une en relançant vingt fois.
  assert.deepEqual([...new Set(fautes)], [], '\n' + [...new Set(fautes)].join('\n'));
});

/* ------------------------------------------------------------------ */
/* Le français                                                          */
/* ------------------------------------------------------------------ */
test('la forme de la semaine s’accorde : une note est haute ou basse, une nuit est longue ou courte, un écran est long', () => {
  const fautes = [];
  for (const { nom, r } of PATIENTS) for (const it of r.items.filter(i => i.type === 'rythme')) {
    if (/ta note est plus (haut|bas)\b/.test(it.phrase)) fautes.push(`${nom} : « note » est féminin — « ${it.phrase} »`);
    if (/sommeil est plus (haut|bas)/.test(it.phrase)) fautes.push(`${nom} : un sommeil n’est pas « haut », des nuits sont plus longues — « ${it.phrase} »`);
    if (/écran est plus (haut|bas)/.test(it.phrase)) fautes.push(`${nom} : un temps d’écran est plus long, pas plus haut — « ${it.phrase} »`);
    // Le coucher se compare aux vendredis et samedis ; « le reste » contient le dimanche soir, qui n'est pas « en semaine ».
    if (it.variable === 'coucher' && /en semaine/.test(it.phrase)) fautes.push(`${nom} : le dimanche soir n’est pas « en semaine » — « ${it.phrase} »`);
  }
  assert.deepEqual(fautes, [], '\n' + fautes.join('\n'));
});

test('le premier du mois s’écrit « 1er », pas « 1 »', () => {
  // Une bascule de sommeil plantée exactement le 2026-02-01 (t = 27), sans bruit : elle se date au jour près.
  const T = table(180, t => ({ sommeil_h: (t < 27 ? 7.5 : 5) + (t % 3) * 0.05 }));
  const b = analyserTable(T).items.find(i => i.type === 'bascule');
  assert.ok(b && b.date === '2026-02-01', `la bascule attendue le 1er février n’est pas là : ${b?.date}`);
  assert.doesNotMatch(b.phrase, /Autour du 1 /, `« ${b.phrase} »`);
  assert.match(b.phrase, /Autour du 1er févr\./);
});

test('les manques se disent au singulier quand il n’y a qu’une nuit, et « aucune » quand il n’y en a pas', () => {
  const une = analyserTable(table(60, t => (t === 3 ? { note: 6, sommeil_h: 7 } : {})));
  for (const m of une.manques) {
    assert.doesNotMatch(m, /\b1 (nuits|journées)\b/, `« ${m} »`);
    assert.doesNotMatch(m, /\b0 (nuits|journées)\b/, `« ${m} » : zéro se dit « aucune »`);
  }
  const rien = analyserTable(table(60, () => ({ note: 6 })));
  const nuits = rien.manques.find(m => /nuit/i.test(m));
  assert.ok(nuits, 'le manque de nuits doit se dire');
  // « Machi Tool n’a rien envoyé (ou une montre, via la passerelle) » : la parenthèse se lit « ou a envoyé une montre ».
  assert.doesNotMatch(nuits, /\(ou une montre/, `« ${nuits} »`);
});

test('une clé apportée (montre, balance) garde un article : « ta mesure « poids » », pas « poids du lendemain »', () => {
  const r = graine(7), gauss = gaussDe(r);
  let veille = 6;
  const T = table(180, () => {
    const note = Math.max(1, Math.min(10, Math.round(6 + 2 * gauss())));
    const poids = 70 + (veille - 6) * 1.2 + 0.4 * gauss(); veille = note;
    return { note, poids, sommeil_h: 7 + 0.8 * gauss(), coucher: 23.5 + 0.9 * gauss() };
  }, [...VARIABLES, 'poids']);
  const l = analyserTable(T).items.find(i => i.type === 'lien' && i.vers === 'poids');
  assert.ok(l, 'le lien note → poids planté doit se voir');
  assert.doesNotMatch(l.phrase, /, poids du lendemain/, `« ${l.phrase} »`);
  assert.doesNotMatch(l.phrase, /\b(un|une)? ?poids (bas|haut) \(/, `« ${l.phrase} » : la condition d’une clé apportée se dit avec ses guillemets et un article`);
});

/* ------------------------------------------------------------------ */
/* Les nombres qui mentent                                              */
/* ------------------------------------------------------------------ */
test('une heure ne s’écrit jamais « 23:60 » : les minutes s’arrondissent avant de se séparer des heures', () => {
  // Une médiane à 23,9958 h : arrondir 0,9958 × 60 donne 60, et « 23:60 » n'est pas une heure.
  const T = table(180, t => ({ coucher: 23.9958 + (t % 3 === 0 ? 0.002 : 0) }));
  const g = analyserTable(T).items.find(i => i.type === 'regularite');
  assert.ok(g, 'un coucher figé est « régulier »');
  assert.doesNotMatch(g.phrase, /\d\d:60/, `« ${g.phrase} »`);
  assert.match(g.phrase, /00:00/);
});

test('« ± 0 min près » n’existe pas, et « ± » n’est pas une borne : un tiers des nuits sont au-delà d’un écart-type', () => {
  const fige = analyserTable(table(180, () => ({ coucher: 23.0 }))).items.find(i => i.type === 'regularite');
  assert.ok(fige, 'un coucher figé est « régulier »');
  assert.doesNotMatch(fige.phrase, /± 0 min/, `« ${fige.phrase} »`);
  // Sur les 21 patients : ce qui s'affiche doit être un comptage qu'on peut refaire (« N nuits sur M »), pas un écart-type déguisé en tolérance.
  for (const { nom, r } of PATIENTS) for (const it of r.items.filter(i => i.type === 'regularite')) {
    assert.doesNotMatch(it.phrase, /±/, `${nom} : « ${it.phrase} » — un ± se lit « toutes les nuits sont dedans », ce qui est faux`);
    assert.match(it.phrase, /\d+ nuits/, `${nom} : « ${it.phrase} » — le nombre de nuits doit se lire`);
  }
});

test('un lien ne dit pas « basse (≤ 6) » et « haute (≥ 6) » avec le même nombre : si les tiers se confondent, on se tait', () => {
  // Une note à 6 sept jours sur huit, 5 ou 7 sinon ; le sommeil suit la note de la veille. Les tiers bas et haut sont tous deux à 6.
  const r = graine(11), gauss = gaussDe(r);
  let veille = 6;
  const T = table(180, () => {
    const note = r() < 0.125 ? (r() < 0.5 ? 5 : 7) : 6;
    const sommeil_h = 7 + (veille - 6) * 1.5 + 0.5 * gauss(); veille = note;
    return { note, sommeil_h, coucher: 23.5 + 0.9 * gauss() };
  });
  const notes = T.jours.map(j => j.note).sort((a, b) => a - b);
  assert.equal(notes[Math.floor(notes.length / 3)], notes[Math.floor(2 * notes.length / 3)], 'le cas voulu : tiers bas = tiers haut');
  for (const l of analyserTable(T).items.filter(i => i.type === 'lien')) {
    const m = /\(≤ ([^)]+)\).*\(≥ ([^)]+)\)/.exec(l.phrase);
    assert.ok(m, `« ${l.phrase} »`);
    assert.notEqual(m[1], m[2], `« ${l.phrase} » : le même seuil est dit « bas » puis « haut »`);
  }
});

test('une bascule dit combien de nuits elle compare : « deux semaines de chaque côté » ment quand il en manque la moitié', () => {
  // Avant la bascule, une nuit mesurée sur cinq (puis trois d'affilée) ; après, toutes.
  const T = table(180, t => ({ sommeil_h: t < 40 ? (t >= 37 || t % 5 === 0 ? 7.5 + (t % 3) * 0.1 : null) : 5 + (t % 3) * 0.1 }));
  const b = analyserTable(T).items.find(i => i.type === 'bascule');
  assert.ok(b, 'la bascule est nette : elle doit se voir');
  assert.ok(b.appui.n_avant < 12, `le cas voulu : peu de nuits avant (${b.appui.n_avant})`);
  if (/deux semaines de chaque côté/.test(b.phrase)) assert.fail(`« ${b.phrase} » — ${b.appui.n_avant} nuits avant, ${b.appui.n_apres} après : les comptes doivent se lire`);
  assert.match(b.phrase, new RegExp(`${b.appui.n_avant} nuits? .*${b.appui.n_apres}`), `« ${b.phrase} »`);
});

test('l’inertie se montre par un comptage, comme les liens : pas seulement une image (« tire », « se ressemblent »)', () => {
  for (const { nom, r } of PATIENTS) for (const it of r.items.filter(i => i.type === 'inertie')) {
    assert.match(it.phrase, /\d+ fois sur \d+/, `${nom} : « ${it.phrase} » — un φ caché n’est pas vérifiable par la personne`);
  }
});

test('les mots absolus se disent par des jours comptés, pas par une règle (« quand ta note baisse, … montent »)', () => {
  for (const { nom, r } of PATIENTS) for (const it of r.items.filter(i => i.type === 'mots')) {
    assert.doesNotMatch(it.phrase, /^Quand ta note/, `${nom} : « ${it.phrase} »`);
    assert.match(it.phrase, /pour 100 mots/, `${nom} : « ${it.phrase} » — « / 100 mots » se lit mal à voix haute`);
  }
});

test('un lien vers le sommeil parle de « la nuit qui suit », pas du « sommeil du lendemain »', () => {
  // sommeil_h(t) est la nuit t−1 → t : après un coucher du soir t−1, c'est la nuit même qui suit, pas celle du lendemain.
  for (const { nom, r } of PATIENTS) for (const it of r.items.filter(i => i.type === 'lien' && i.vers === 'sommeil_h')) {
    assert.doesNotMatch(it.phrase, /sommeil du lendemain/, `${nom} : « ${it.phrase} »`);
  }
});

/* ------------------------------------------------------------------ */
/* La vue : ce qu'elle étiquette, ce qu'elle chiffre                    */
/* ------------------------------------------------------------------ */
test('les barres d’un lien portent la condition dans les mots de la variable, pas « après un jour bas » pour un coucher tard', () => {
  const { code } = textesDeLaVue();
  assert.doesNotMatch(code, /après un jour (bas|haut)/, 'un coucher tard n’est pas « un jour haut », une nuit courte n’est pas « un jour bas »');
  // Le moteur doit fournir la condition écrite, la vue n'a pas le vocabulaire : bas.cond / haut.cond.
  for (const { nom, r } of PATIENTS) for (const it of r.items.filter(i => i.type === 'lien')) {
    assert.equal(typeof it.appui.bas.cond, 'string', `${nom} : appui.bas.cond manque sur « ${it.phrase} »`);
    assert.equal(typeof it.appui.haut.cond, 'string', `${nom} : appui.haut.cond manque`);
    assert.ok(it.phrase.includes(it.appui.bas.cond) && it.phrase.includes(it.appui.haut.cond), `${nom} : la barre et la phrase disent la même condition`);
  }
});

test('la figure d’un rythme montre les mêmes nombres que la phrase : un coucher s’écrit « 01:33 », jamais « 25,6 »', () => {
  for (const { nom, r } of PATIENTS) for (const it of r.items.filter(i => i.type === 'rythme')) {
    assert.equal(typeof it.appui.dedans_txt, 'string', `${nom} : appui.dedans_txt manque sur « ${it.phrase} »`);
    assert.equal(typeof it.appui.dehors_txt, 'string', `${nom} : appui.dehors_txt manque`);
    assert.ok(it.phrase.includes(it.appui.dedans_txt) && it.phrase.includes(it.appui.dehors_txt), `${nom} : la figure et la phrase doivent montrer les mêmes nombres`);
    if (it.variable === 'coucher') assert.match(it.appui.dedans_txt, /^\d\d:\d\d$/, `${nom} : ${it.appui.dedans_txt}`);
  }
  const { code } = textesDeLaVue();
  assert.doesNotMatch(code, /f\(it\.appui\.dedans\)/, 'la vue arrondit elle-même appui.dedans : pour un coucher, ça donne « 25,6 »');
});

test('« rien qui tienne » nomme tout ce qui a été cherché, ou rien : trois familles sur six laissent croire que les autres n’ont pas été regardées', () => {
  const { textes } = textesDeLaVue();
  const vide = textes.find(t => /pour l'instant|pour l’instant/.test(t) && /ni |aucun|pas de/.test(t));
  assert.ok(vide, 'le texte de l’état vide est introuvable');
  const familles = [/bascule/, /lien/, /semaine/, /coucher|régul/, /inertie|d’un jour à l’autre|veille/, /mots/];
  const nommees = familles.filter(f => f.test(vide)).length;
  assert.ok(nommees === 0 || nommees === familles.length, `« ${vide} » nomme ${nommees} familles sur ${familles.length}`);
  assert.doesNotMatch(vide, /^Rien/, 'un mauvais soir, le premier mot qu’on lit ne doit pas être « Rien »');
});

/* ------------------------------------------------------------------ */
/* La règle minimale elle-même                                          */
/* ------------------------------------------------------------------ */
test('MOTS_INTERDITS attrape ce qu’elle doit : la liste maison de compte-rendu.js, et les mots qu’un moteur de « fonctionnements » a envie d’écrire', () => {
  const doitAttraper = [
    'ta dépression', 'un épisode dépressif', 'bipolaire', 'hypomanie', 'des troubles du sommeil', 'un diagnostic', 'un syndrome', 'la déréalisation', 'le TDAH', 'autiste', 'en crise',
    // ceux que la regex laisse passer aujourd'hui, et qu'un mauvais soir lit comme un verdict
    'ton anxiété', 'l’angoisse', 'une insomnie', 'une hypersomnie', 'un burn-out', 'une phase haute', 'une phase basse', 'un symptôme', 'une rechute', 'une psychose', 'borderline', 'suicidaire', 'la panique', 'la dissociation',
  ];
  const laisse = doitAttraper.filter(s => !MOTS_INTERDITS.test(s));
  assert.deepEqual(laisse, [], `laissés passer : ${laisse.join(' · ')}`);
});

test('MOTS_INTERDITS ne prend pas un mot pour un autre : « maniement », « Roumanie » ne sont pas « manie »', () => {
  const doitLaisser = ['le maniement du curseur', 'la Roumanie', 'ta note est plus basse', 'une nuit longue'];
  const pris = doitLaisser.filter(s => MOTS_INTERDITS.test(s));
  assert.deepEqual(pris, [], `pris pour un trouble : ${pris.join(' · ')} — il manque des bornes de mot`);
});

test('« crise » dans les mots de la personne est légitime : la machine cite, elle ne pose pas', () => {
  // La règle s'applique à ce que la machine dit à son compte : les « … » sont retirés avant de chercher.
  assert.equal(MOTS_INTERDITS.test(laMachineDit('Tu as écrit « crise d’angoisse » douze fois ce mois-ci.')), false);
  assert.equal(MOTS_INTERDITS.test(laMachineDit('Tes mots absolus montent (« toujours », « rien », « crise »).')), false);
  assert.equal(MOTS_INTERDITS.test(laMachineDit('Tu es en crise.')), true);
});

test('les seuils du module sont ceux de la calibration du banc, à l’arrondi près : ils ne s’ajustent pas ici', () => {
  const cal = JSON.parse(readFileSync(new URL('../tools/banc-approches/calibration.json', import.meta.url), 'utf8'));
  const pres = (a, b) => Math.abs(a - b) < 0.006;
  assert.ok(pres(SEUILS.regularite.haute, cal.classes.regularity.haute) && pres(SEUILS.regularite.basse, cal.classes.regularity.basse), 'régularité');
  assert.ok(pres(SEUILS.inertie.haute, cal.classes.autocorr.high) && pres(SEUILS.inertie.basse, cal.classes.autocorr.low), 'inertie');
  assert.equal(SEUILS.lien.seuil, cal.seuils.var.seuil_var, 'lien');
  assert.equal(SEUILS.rupture.sommeil, cal.seuils.pheno.penalite, 'bascule de sommeil');
});
