/**
 * =====================================================================
 *  CE QUE LA PERSONNE DÉCLARE SUIVRE — ET CE QU'ON NE LA LAISSE PAS FAIRE.
 *
 * Les six familles écrites à la main dans prises.js sont bornées et payées en
 * faux positifs. Elles ne connaissent pas son traitement, et elles ne peuvent
 * pas être exhaustives sans devenir un champ de mines de mots français
 * ordinaires (le piège « paris / cote / mise » y est documenté).
 *
 * D'où des familles fabriquées à partir de SES mots. Ces mots viennent d'un
 * champ de saisie et entrent dans une expression régulière : ce fichier tient
 * les deux bouts — ce qui doit marcher, et ce qui doit être refusé.
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-suivis-')), 'test.db');
const { OWNER, lesSuivis, poserSuivi, retirerSuivi } = await import('../server/db.js');
const { motsDuSuivi, familleDuSuivi } = await import('../server/prises.js');

/* ================= les mots qu'on accepte ================= */

test('UN MÉTACARACTÈRE NE DEVIENT JAMAIS UN MOTIF', () => {
  /*
   * LE DÉFAUT QUE CE TEST GARDE, ET IL NE SERAIT PAS TOMBÉ TOUT SEUL.
   * « .* » collé tel quel dans l'expression ferait compter TOUTES ses journées
   * comme des jours de prise — un tableau entièrement faux, sans erreur, sans
   * page cassée, sans rien qui prévienne. « ( » ferait l'inverse : une
   * expression invalide, donc une page qui tombe.
   */
  for (const poison of ['.*', '(', '[a-z]', '\\d+', '.+', '|', '^', '$', '?', '\\']) {
    assert.deepEqual(motsDuSuivi(poison), [],
      `« ${poison} » est passé dans les mots retenus`);
  }
  // Et le mélange : le bon mot reste, le poison tombe.
  assert.deepEqual(motsDuSuivi('anxio, .*'), ['anxio']);
});

test('CE QUI PASSE PRODUIT UNE EXPRESSION VALIDE ET FERMÉE', () => {
  const f = familleDuSuivi({ cle: 'sien:x', nom: 'x', mots: 'anxio, theralene' });
  assert.ok(f.mots instanceof RegExp);
  assert.equal(f.mots.test('j ai pris un anxio'), true);
  assert.equal(f.mots.test('anxiolytiquement'), false, 'le motif n’est pas borné aux mots');
});

test('LES ACCENTS SONT RETIRÉS DES DEUX CÔTÉS, SINON RIEN NE SE RENCONTRE', () => {
  // Le texte cherché est déjà passé par `norm` : des mots accentués rangés
  // tels quels ne croiseraient jamais le texte désaccentué.
  assert.deepEqual(motsDuSuivi('Théralène'), ['theralene']);
  const f = familleDuSuivi({ cle: 'sien:t', nom: 't', mots: 'Théralène' });
  assert.equal(f.mots.test('theralene'), true);
});

test('DEUX LETTRES NE SUFFISENT PAS', () => {
  // « md » existe dans la liste écrite à la main parce qu'on a vérifié qu'il
  // ne heurte rien. Un mot de deux lettres tapé à la volée tombe partout.
  assert.deepEqual(motsDuSuivi('xa, ap, ok'), []);
  assert.deepEqual(motsDuSuivi('xa, anxio'), ['anxio']);
});

test('un mot composé reste un mot composé', () => {
  assert.deepEqual(motsDuSuivi('fleur de cbd'), ['fleur de cbd']);
  const f = familleDuSuivi({ cle: 'sien:c', nom: 'c', mots: 'fleur de cbd' });
  assert.equal(f.mots.test('j ai pris de la fleur de cbd'), true);
  // Les blancs du texte peuvent être un retour à la ligne.
  assert.equal(f.mots.test('fleur de\ncbd'), true);
});

test('sans mot utilisable, il n’y a pas de famille — pas une famille vide', () => {
  // Une famille dont l'alternance serait vide donnerait `\b(?:)\b`, qui filtre
  // sur la chaîne vide : elle compterait chaque phrase.
  assert.equal(familleDuSuivi({ cle: 'sien:v', nom: 'v', mots: '' }), null);
  assert.equal(familleDuSuivi({ cle: 'sien:v', nom: 'v', mots: 'xa' }), null);
});

/* ================= ce que le mot seul ne doit PAS faire ================= */

test('NOMMER UN PRODUIT N’EST PAS LE PRENDRE', () => {
  /*
   * On n'a délibérément PAS donné à ces familles un `franc` sur le mot nu.
   * `franc` court-circuite la garde d'intention : « j'ai envie d'un anxio »
   * compterait comme une prise, et « faut que je rachète des anxios » aussi.
   * Le mot seul demande donc un verbe de prise, comme les familles à la main.
   */
  const f = familleDuSuivi({ cle: 'sien:a', nom: 'a', mots: 'anxio' });
  const compte = q => f.franc.test(q) || (f.mots.test(q) && f.verbe.test(q));
  assert.equal(compte('j ai pris un anxio'), true);
  assert.equal(compte('faut que je rachete des anxios'), false, 'nommer suffit à compter');
  assert.equal(compte('le medecin m a parle d anxio'), false, 'nommer suffit à compter');
});

test('UN NOMBRE COLLÉ AU PRODUIT COMPTE, LUI — c’est la question posée', () => {
  // « combien ce soir » est exactement ce qu'on cherche : un compte explicite
  // ne veut rien dire d'autre, et c'est la forme la plus courante.
  const f = familleDuSuivi({ cle: 'sien:a', nom: 'a', mots: 'anxio' });
  assert.equal(f.franc.test('deux anxios ce soir'), true);
  assert.equal(f.franc.test('3 anxio'), true);
  assert.equal(f.franc.test('un anxio'), true);
});

/* ================= la table ================= */

test('LA MÊME CHOSE POSÉE DEUX FOIS SE CORRIGE, ELLE NE SE DÉDOUBLE PAS', () => {
  // Deux lignes « le cannabis » avec deux réglages contraires n'ont plus de
  // réponse à « est-ce que j'en parle ? ».
  poserSuivi({ cle: 'cannabis', nom: 'le cannabis', demander: 1, userId: OWNER });
  poserSuivi({ cle: 'cannabis', nom: 'la weed', demander: 0, userId: OWNER });
  const l = lesSuivis(OWNER).filter(x => x.cle === 'cannabis');
  assert.equal(l.length, 1, 'deux lignes pour la même chose');
  assert.equal(l[0].nom, 'la weed');
  assert.equal(l[0].demander, 0);
});

test('« COMPTE-LE » ET « TU PEUX M’EN PARLER » SONT DEUX PERMISSIONS', () => {
  /*
   * Suivre une consommation dans un tableau qu'on ouvre quand on veut, et se
   * la faire demander au milieu d'une conversation, ne sont pas la même chose.
   * Les confondre ferait de la seconde le prix de la première.
   */
  const s = poserSuivi({ cle: 'sien:b', nom: 'b', mots: 'bidule', actif: 1, userId: OWNER });
  assert.equal(s.actif, 1);
  assert.equal(s.demander, 0, 'poser un suivi donne au compagnon le droit d’en parler');
});

test('LE DÉFAUT DE « TU PEUX M’EN PARLER » EST NON', () => {
  // Sur ce terrain, l'oubli tombe du côté du silence : personne ne se fait
  // questionner sur sa consommation pour avoir omis de décocher.
  const s = poserSuivi({ cle: 'sien:c', nom: 'c', mots: 'chose', userId: OWNER });
  assert.equal(s.demander, 0);
});

test('un suivi se retire vraiment, il ne se range pas désactivé', () => {
  // Garder « le cannabis, désactivé » dans une base qu'on exporte, c'est
  // conserver l'aveu de ce qu'on a voulu retirer.
  poserSuivi({ cle: 'sien:d', nom: 'd', mots: 'dada', userId: OWNER });
  assert.equal(retirerSuivi('sien:d', OWNER), true);
  assert.equal(lesSuivis(OWNER).some(x => x.cle === 'sien:d'), false);
});

test('un genre inconnu retombe sur « réduire », il n’invente pas', () => {
  const s = poserSuivi({ cle: 'sien:e', nom: 'e', mots: 'ecko', genre: 'nimporte', userId: OWNER });
  assert.equal(s.genre, 'reduire');
});

/* ================= de bout en bout ================= */

test('UNE SUBSTANCE DÉCLARÉE APPARAÎT DANS LE TABLEAU, AVEC SES MOTS À ELLE', async () => {
  const { analyserPrises } = await import('../server/prises.js');
  const jour = (d, t) => ({ date: d, note: 5, text: t });
  const entrees = [
    jour('2026-03-01', 'soirée calme, j’ai pris un anxio pour dormir'),
    jour('2026-03-02', 'rien de spécial'),
    jour('2026-03-03', 'deux anxios ce soir, ça descendait pas'),
    jour('2026-03-04', 'j’ai pris mon anxio comme d’hab'),
  ];
  const suivis = [{ cle: 'sien:anxio', nom: 'mon anxio', mots: 'anxio', genre: 'traitement',
                    actif: 1, demander: 1 }];
  const r = analyserPrises(entrees, { aujourdhui: '2026-03-05', suivis });
  const p = r.prises.find(x => x.cle === 'sien:anxio');
  assert.ok(p, `« mon anxio » n’est pas compté — trouvé : ${r.prises.map(x => x.cle).join(', ') || 'rien'}`);
  assert.equal(p.n, 3, 'les trois journées où il est écrit ne sont pas toutes comptées');
  assert.equal(p.nom, 'mon anxio', 'la vue dirait « les calmants » à quelqu’un qui n’a jamais écrit ce mot');
  assert.equal(p.genre, 'traitement');
  assert.equal(p.parle, true);
});

test('DÉSACTIVER UN SUIVI LE FAIT DISPARAÎTRE DU TABLEAU, PAS SEULEMENT DU COMPAGNON', async () => {
  const { analyserPrises } = await import('../server/prises.js');
  const entrees = ['2026-03-01', '2026-03-02', '2026-03-03'].map(d =>
    ({ date: d, note: 5, text: 'j’ai pris un anxio' }));
  const r = analyserPrises(entrees, { aujourdhui: '2026-03-04',
    suivis: [{ cle: 'sien:anxio', nom: 'mon anxio', mots: 'anxio', actif: 0, demander: 1 }] });
  assert.equal(r.prises.some(x => x.cle === 'sien:anxio'), false,
    'un suivi désactivé continue d’être compté et montré');
});

test('LE MÉMO NE SERT PAS LE RÉSULTAT D’AVANT QUAND LES MOTS CHANGENT', async () => {
  /*
   * LE PIÈGE, ÉVITÉ DE JUSTESSE. Le mémo de `luDuTexte` était clavé sur le seul
   * texte. Dès que les familles peuvent changer, la même journée rendait
   * indéfiniment le résultat d'avant : on ajoute un mot, on relit son journal,
   * rien n'apparaît, et on conclut que la détection ne marche pas.
   */
  const { analyserPrises } = await import('../server/prises.js');
  const entrees = ['2026-04-01', '2026-04-02', '2026-04-03'].map(d =>
    ({ date: d, note: 5, text: 'j’ai pris du zolmitruc ce soir' }));
  const sans = analyserPrises(entrees, { aujourdhui: '2026-04-04', suivis: [] });
  assert.equal(sans.prises.some(x => x.cle === 'sien:z'), false);
  // MÊME texte, mots déclarés maintenant : il doit compter.
  const avec = analyserPrises(entrees, { aujourdhui: '2026-04-04',
    suivis: [{ cle: 'sien:z', nom: 'le zolmitruc', mots: 'zolmitruc', actif: 1 }] });
  assert.equal(avec.prises.some(x => x.cle === 'sien:z'), true,
    'le mémo a resservi l’analyse d’avant : ajouter un mot ne change plus rien');
});

test('UNE FAMILLE DÉCLARÉE N’ACHÈTE PAS LE DROIT DE COMPTER CE QU’UN AUTRE A PRIS', async () => {
  // Toutes les gardes du moteur valent pour elle aussi — le tiers, la négation.
  const { analyserPrises } = await import('../server/prises.js');
  const entrees = ['2026-05-01', '2026-05-02', '2026-05-03'].map(d =>
    ({ date: d, note: 5, text: 'mon frère a pris un zolmitruc' }));
  const r = analyserPrises(entrees, { aujourdhui: '2026-05-04',
    suivis: [{ cle: 'sien:z', nom: 'z', mots: 'zolmitruc', actif: 1 }] });
  assert.equal(r.prises.some(x => x.cle === 'sien:z'), false,
    'ce que le frère a pris est compté comme une prise');
});

/* ================= les routes ================= */

test('UNE CHOSE QU’ON NE SAIT PAS CHERCHER EST REFUSÉE, ET ON DIT POURQUOI', async () => {
  /*
   * LA PIRE DES DEUX ERREURS SERAIT DE L’ACCEPTER EN SILENCE. Rangée muette,
   * elle apparaîtrait dans la liste, cochée, sans jamais rien compter — et un
   * tableau vide sur une chose qu’on suit se lit « il n’y en a pas eu ».
   */
  const { routes } = await import('../server/api.js');
  const r = await routes['POST /api/suivis']({ body: { cle: 'sien:zz', nom: 'zz', mots: 'zz' }, userId: OWNER });
  assert.match(r.erreur ?? '', /trois lettres/);
  assert.equal(lesSuivis(OWNER).some(x => x.cle === 'sien:zz'), false, 'rangé quand même');
});

test('une famille que le moteur connaît déjà n’a pas besoin de mots', async () => {
  // « cannabis » a sa propre expression, écrite à la main et meilleure : la
  // ligne ne sert qu’à porter le genre et les deux permissions.
  const { routes } = await import('../server/api.js');
  const r = await routes['POST /api/suivis']({ body: { cle: 'cannabis', nom: 'le cannabis' }, userId: OWNER });
  assert.equal(r.suivi?.cle, 'cannabis');
  assert.equal(r.erreur, undefined);
});

test('ÉCRIRE UN SUIVI VIDE LE CALCUL MÉMOISÉ', async () => {
  /*
   * Sans ça : on ajoute un mot, la page se recharge, et rien n’a bougé — le
   * calcul des prises est mémoisé par utilisateur, et le détecteur l’est sur
   * les familles déclarées. On conclut que la détection ne marche pas.
   */
  const src = readFileSync(new URL('../server/api.js', import.meta.url), 'utf8');
  const i = src.indexOf("'POST /api/suivis'");
  const j = src.indexOf("'DELETE /api/suivis'");
  assert.ok(i > 0 && j > i);
  for (const [nom, bout] of [['POST', src.slice(i, j)], ['DELETE', src.slice(j, j + 900)]])
    assert.match(bout, /invalidate\(userId\)/,
      `${nom} /api/suivis n’invalide pas le cache : la modification ne se verra pas`);
});

/* ================= l'éditeur ================= */

test('LES DEUX CASES SONT DEUX GESTES DISTINCTS À L’ÉCRAN', () => {
  /*
   * Une seule case ferait de « le compagnon peut m’en parler » le prix de
   * « compte-le ». Ce test lit le source parce que le rendu est une chaîne :
   * ce qu'il garde, c'est que les deux champs existent séparément côté vue.
   */
  const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const i = src.indexOf('function casesMarkup');
  assert.ok(i > 0, 'les cases n’existent plus sous ce nom');
  const corps = src.slice(i, src.indexOf('\n}', i));
  assert.match(corps, /'actif'/);
  assert.match(corps, /'demander'/);
});

test('DÉCOCHER « COMPTER » DÉCOCHE AUSSI « EN PARLER »', () => {
  // Le compagnon ne peut pas avoir le droit de parler d'une chose qu'on vient
  // de retirer du tableau — il aurait la permission et plus les chiffres.
  const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(src, /if \(!etat\.actif\) etat\.demander = false;/,
    'décocher « compter » laisse « en parler » allumé');
});

test('UNE CHOSE AJOUTÉE À LA MAIN NE PEUT PAS ÉCRASER UNE FAMILLE DU MOTEUR', () => {
  /*
   * Sans préfixe, quelqu'un qui tape « cannabis » poserait la clé « cannabis »
   * et écraserait la ligne de la famille écrite à la main — celle dont
   * l'expression est bien meilleure que tout ce qu'on fabriquerait depuis
   * quelques mots.
   */
  const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const i = src.indexOf('async function ajouterSuivi');
  assert.ok(i > 0);
  assert.match(src.slice(i, i + 1200), /cle: `sien:\$\{base\}`/,
    'la clé n’est plus préfixée : une saisie peut prendre la place d’une famille du moteur');
});

test('LE GENRE SE VOIT SUR LA LIGNE', () => {
  // Un traitement n'a ni record, ni pente, ni signes. Trois absences sans
  // explication se lisent « il ne se passe rien » au lieu de « on ne surveille
  // pas ».
  const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(src, /p\.genre === 'traitement' \? `<span class="ptraite/);
});
