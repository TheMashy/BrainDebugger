/*
 * OÙ C'ÉTAIT, QUAND LE TITRE NE DIT PAS DE QUOI IL PARLE.
 *
 * La barre des sujets finissait sur « 95 % que rien ne classe ». En relisant
 * les onglets derrière ce chiffre, il n'y manquait pas des mots-clés : la
 * moitié n'avaient aucun sujet à trouver. « youtube », « x », « google »,
 * « reddit - the heart of the internet » sont des pages d'accueil. On sait OÙ
 * c'était ; de quoi ça parlait, non.
 *
 * Machi Tool envoie donc `temps_par_lieu_web_s`, À PART des thèmes. Ce qui se
 * teste ici est surtout ce qui ne doit JAMAIS arriver : un lieu qui se range
 * parmi les sujets, un lieu qui s'additionne à eux, et un « % que rien ne
 * classe » qui continue de compter ce qu'on vient de situer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-lieux-')), 'test.db');

const { upsertUser, poserActiviteJour } = await import('../server/db.js');
const { posteDuJour } = await import('../server/api.js');

const U = 'lieux';
upsertUser({ id: U, username: U });

const poser = (jour, digest) => {
  poserActiviteJour(U, jour, { date: jour, plage: { de: '09:00', a: '23:00' }, ...digest });
  return posteDuJour(jour, U);
};

test('un lieu remonte, et JAMAIS parmi les sujets', () => {
  const p = poser('2026-05-01', {
    temps_par_contexte_s: { 'web:youtube': 3600, 'web:google': 1200 },
    temps_par_theme_web_s: { guerre: 1200 },
    temps_par_lieu_web_s: { recherche: 1200, video: 2400 },
  });
  // Le plus long en tête, et la fixture le donne dans l'autre sens : sans ça
  // l'ordre des clés suffisait, et le tri n'était jamais exercé.
  assert.deepEqual(p.ecran.lieux, [{ nom: 'video', min: 40 }, { nom: 'recherche', min: 20 }]);
  const noms = p.ecran.themes.map(x => x.nom);
  assert.deepEqual(noms, ['guerre'],
    'un lieu rangé parmi les sujets raconterait qu’on sait ce qui a été regardé');
});

test('LES DEUX NE S’ADDITIONNENT PAS : ensemble ils ne dépassent pas l’écran', () => {
  /*
   * Le compte qui rendrait tout faux. Machi Tool ne remplit un lieu que
   * lorsque aucun sujet n'a répondu — si jamais les deux se recouvraient, la
   * barre dépasserait 100 % et la journée durerait plus longtemps qu'elle n'a
   * duré. Le test le vérifie sur les minutes, là où ça se verrait.
   */
  const p = poser('2026-05-02', {
    temps_par_contexte_s: { 'web:youtube': 3600, 'web:google': 1200 },
    temps_par_theme_web_s: { guerre: 1200 },
    temps_par_lieu_web_s: { video: 2400, recherche: 1200 },
  });
  const ecran = p.ecran.app_min + p.ecran.web_min;
  const sujets = p.ecran.themes.reduce((n, x) => n + x.min, 0);
  const lieux = p.ecran.lieux.reduce((n, x) => n + x.min, 0);
  assert.ok(sujets + lieux <= ecran,
    `${sujets} min de sujets + ${lieux} min de lieux dépassent ${ecran} min d’écran`);
});

test('UNE JOURNÉE SANS AUCUN SUJET a quand même ses lieux', () => {
  /*
   * LE CAS FRÉQUENT, et celui qui a motivé tout l'exercice : sur les onze
   * onglets relevés à l'écran, neuf n'avaient pas de sujet. Si les lieux
   * n'arrivaient qu'accrochés à un thème, l'écran resterait aussi vide
   * qu'avant — c'est-à-dire « 95 % que rien ne classe », et rien d'autre.
   */
  const p = poser('2026-05-03', {
    temps_par_contexte_s: { 'web:youtube': 3600 },
    temps_par_lieu_web_s: { video: 3600 },
  });
  assert.equal(p.ecran.themes, null, 'aucun sujet, et on ne fait pas semblant');
  assert.deepEqual(p.ecran.lieux, [{ nom: 'video', min: 60 }]);
});

test('AUCUN LIEU reste null — on ne fabrique pas un champ vide', () => {
  const p = poser('2026-05-04', {
    temps_par_contexte_s: { 'web:lemonde': 1200 },
    temps_par_theme_web_s: { actu: 1200 },
  });
  assert.equal(p.ecran.lieux, null);
});

test('une minute effleurée ne fait pas une ligne', () => {
  const p = poser('2026-05-05', {
    temps_par_contexte_s: { 'web:youtube': 3600 },
    temps_par_lieu_web_s: { video: 3600, boutique: 20 },
  });
  assert.deepEqual(p.ecran.lieux, [{ nom: 'video', min: 60 }],
    'vingt secondes de boutique ne disent rien de la journée');
});

/* ============ ET SUR QUEL TOTAL CES MINUTES SE COMPTENT ============ */
/*
 * LE CHIFFRE QUI A DÉCLENCHÉ LA QUESTION. « 88 % que rien ne classe »,
 * disait l'écran. Mesuré sur une vraie journée : 58 % de cet écran était FL
 * Studio, Premiere et Discord — des APPLICATIONS, que deux champs « web » ne
 * classeront jamais, et qui sont nommées une par une dans la barre juste
 * au-dessus. La barre divisait par l'écran entier ; elle ne mesure que le
 * navigateur. Sur cette journée : 87 % → 71 % rien qu'en corrigeant ça.
 */
test('le digest dit à quel total ses thèmes appartiennent', () => {
  const p = poser('2026-05-06', {
    temps_par_contexte_s: { 'web:youtube': 3600, blender: 7200 },
    temps_par_theme_web_s: { guerre: 1200 },
  });
  assert.equal(p.ecran.themes_sur, 'web');
});

test('UNE VIEILLE JOURNÉE garde son propre total', () => {
  /*
   * `temps_par_theme_web_s` n'a pas toujours existé. Les journées d'avant
   * n'ont que `temps_par_theme_s`, qui MÊLE les applications — les compter
   * sur le navigateur seul ferait dépasser 100 % et la barre mentirait dans
   * l'autre sens.
   */
  const p = poser('2026-05-07', {
    temps_par_contexte_s: { 'web:youtube': 1200, blender: 7200 },
    temps_par_theme_s: { creation: 7200, guerre: 1200 },
  });
  assert.equal(p.ecran.themes_sur, 'ecran');
  const classe = p.ecran.themes.reduce((n, x) => n + x.min, 0);
  assert.ok(classe > p.ecran.web_min,
    'la fixture ne prouve rien si les thèmes tiennent déjà dans le navigateur');
});

test('AUCUN THÈME : pas de total à annoncer', () => {
  const p = poser('2026-05-08', {
    temps_par_contexte_s: { 'web:youtube': 3600 },
    temps_par_lieu_web_s: { video: 3600 },
  });
  assert.equal(p.ecran.themes_sur, null);
});

/* ===================== ET CE QUE L'ÉCRAN EN FAIT ===================== */
/*
 * Vérifié une fois dans un vrai navigateur sur une journée semée : quatre
 * segments hachurés, « 63 % dont on sait seulement l'endroit », puis « 28 %
 * que rien ne classe ». Ce qui suit garde les décisions qui rendaient ce
 * rendu honnête — celles qu'une retouche défait sans s'en apercevoir.
 */
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const sansCommentaires = t => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const barre = (() => {
  const p = sansCommentaires(app);
  return p.slice(p.indexOf('const barreThemes ='), p.indexOf('const ecran = repartition()'));
})();

test('LA BARRE S’AFFICHE SANS UN SEUL SUJET', () => {
  /*
   * Le cas fréquent, et celui qui a motivé tout l'exercice : sur les onze
   * onglets relevés, neuf n'avaient pas de sujet. `if (!th?.length) return ''`
   * laissait l'écran exactement aussi vide qu'avant.
   */
  assert.match(barre, /if \(!th\.length && !lx\.length\) return ''/);
  assert.equal(/if \(!th\?\.length\) return ''/.test(barre), false,
    'un jour sans sujet perdrait ses lieux avec lui');
});

test('un lieu ne prend AUCUNE teinte de la palette des sujets', () => {
  /*
   * Une couleur de sujet le ferait lire comme un sujet — le contraire exact de
   * ce qu'il dit. La hachure grise porte « on sait où, pas de quoi ».
   */
  const seg = barre.slice(barre.indexOf('const segLieu ='), barre.indexOf('const reste ='));
  assert.equal(/TEINTE_THEME/.test(seg), false,
    'le segment d’un lieu emprunte une couleur de sujet');
  assert.match(seg, /class="jrseg jrlieu"/);
});

test('LE SENS NE TIENT PAS À LA COULEUR SEULE', () => {
  /*
   * Une hachure de neuf pixels de haut ne se distingue pas pour tout le monde,
   * et un `data-tip` demande un survol — donc rien au clavier ni au doigt. La
   * phrase au-dessus de la liste dit en toutes lettres ce qu'on sait.
   */
  assert.match(barre, /dont on sait seulement l’endroit/);
});

test('« % que rien ne classe » NE COMPTE PLUS CE QU’ON VIENT DE SITUER', () => {
  /*
   * LE CHIFFRE QUI A DÉCLENCHÉ TOUT ÇA. Laisser « 95 % » intact en affichant
   * les lieux à côté serait pire qu'avant : l'écran se contredirait lui-même,
   * et le plus gros chiffre gagnerait.
   */
  assert.match(barre, /const reste = base - classe - situe/);
});

test('LA BARRE SE COMPTE SUR LE NAVIGATEUR, PAS SUR L’ÉCRAN', () => {
  /*
   * Sans ça, les applications — 58 % de la journée mesurée — tombaient dans
   * « rien ne classe » alors qu'elles sont nommées au-dessus. Le plus gros
   * chiffre de l'écran disait « on ne sait rien » d'un temps connu.
   */
  assert.match(barre, /const base = surWeb \? \(p\.ecran\?\.web_min \?\? 0\) : ecranTotal/);
  assert.match(barre, /const pct = m => \(100 \* m \/ base\)/);
  assert.match(barre, /const reste = base - classe - situe/);
  assert.equal(/100 \* m \/ ecranTotal/.test(barre), false,
    'un pourcentage de la barre se compte encore sur l’écran entier');
});

test('LE TOTAL EST ÉCRIT SOUS LA BARRE', () => {
  /*
   * Deux barres l'une sous l'autre qui ne se comptent pas sur la même chose
   * doivent le dire : sinon la plus courte se lit comme un manque, et c'est
   * exactement la lecture qu'on vient de corriger.
   */
  assert.match(barre, /heure\(base \+ ' min'\)/);
  assert.match(barre, /surWeb \? 'de navigateur' : 'd’écran'/);
});
