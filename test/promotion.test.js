/*
 * UN MOTIF MONTE S'IL TIENT.
 *
 * Le produit avait cinq façons de dire « voilà ce qui revient chez toi » et
 * elles ne se parlaient pas : la liste des motifs vivait SOUS la carte sans
 * jamais la toucher. Or les deux sont faites de la même matière — un motif est
 * une liste de dates portant un nom, un nœud de la carte aussi.
 *
 * Ces tests fixent surtout ce que la promotion NE fait PAS : monter toute
 * seule, monter une salve d'une semaine, monter un mécanisme sans lien compté,
 * ou grossir avec la fréquence. Chacun de ces quatre défauts transformerait
 * l'option retenue en celle qu'on avait écartée.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { reprises, ancragesDe, etats, injecterPromus, SEUILS_PROMOTION, VERBE } from '../server/promotion.js';
import { suiteDe } from '../server/sens.js';

const jour = n => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);
/* Un journal quotidien sur six mois : chaque journée écrite a un lendemain
   écrit, donc « la journée écrite suivante » de sens.js est le lendemain civil
   et les comptes se lisent à la main. */
const CORPUS = Array.from({ length: 180 }, (_, i) => jour(i));
const SUITE = suiteDe(CORPUS);

const serie = (id, jours) => new Map([[id, jours.map(j => ({ periode: j, n: 1 }))]]);

/*
 * DOUZE JOURNÉES ISOLÉES, EN QUATRE RETOURS, ET LE NŒUD TOUJOURS LE LENDEMAIN.
 *
 * Les journées ne se touchent pas : une première version les avait par paquets
 * de trois consécutifs, et le nœud tombait alors AUSSI la veille d'une journée
 * du motif — `sensDuLien` rendait « deux », une cohabitation, ce qui était
 * juste et n'était pas ce que le test voulait montrer. Un fixture qui ne
 * discrimine pas ne prouve rien.
 */
const PORTE = [0, 10, 20, 40, 50, 60, 80, 90, 100, 120, 130, 140].map(jour);
const LENDEMAIN = PORTE.map(j => jour(CORPUS.indexOf(j) + 1));
const CARTE = () => ({ noeuds: [{ nom: 'le vin le soir', jours: LENDEMAIN }], liens: [] });
const motif = (o = {}) => ({ id: 1, nom: 'bon bref c’était rien', mecanisme: 'minimiser après coup',
                             teinte: 210, vues: 12, promu: 0, ecarte_le: null, ...o });

test('les reprises comptent les RETOURS, pas les journées', () => {
  // Dix journées d'affilée : une seule salve.
  const salve = Array.from({ length: 10 }, (_, i) => jour(i));
  assert.equal(reprises(salve).length, 1);
  // Trois paquets espacés de plus de quinze jours : trois retours.
  const repartis = [0, 1, 2, 40, 41, 42, 90, 91, 92].map(jour);
  assert.equal(reprises(repartis).length, 3);
  // Une journée isolée est un retour à elle seule ; zéro journée, zéro retour.
  assert.equal(reprises([jour(3)]).length, 1);
  assert.equal(reprises([]).length, 0);
});

test('une salve d’une semaine ne monte pas, même avec assez de journées', () => {
  const salve = Array.from({ length: 14 }, (_, i) => jour(i));
  const carte = { noeuds: [{ nom: 'le vin le soir', jours: salve.map((_, i) => jour(i + 1)) }] };
  const [e] = etats([motif()], serie(1, salve), carte, CORPUS);
  assert.ok(e.mesure >= SEUILS_PROMOTION.min_journees, 'les journées sont là');
  assert.equal(e.reprises, 1);
  assert.notEqual(e.etat, 'proposable',
    'quatorze journées d’affilée puis plus rien, ce n’est pas un mécanisme qui revient : c’est une période');
  assert.deepEqual(e.manque.map(m => m.quoi), ['reprises']);
});

test('sans lien compté vers un nœud, un motif reste dans sa liste', () => {
  // Le motif est présent, réparti, nombreux — mais le nœud vit ailleurs.
  const ailleurs = [5, 6, 55, 56, 105, 106].map(jour);
  const [e] = etats([motif()], serie(1, PORTE), { noeuds: [{ nom: 'le sport', jours: ailleurs }] }, CORPUS);
  assert.equal(e.ancrages.length, 0);
  assert.equal(e.etat, 'reconnu');
  assert.ok(e.manque.some(m => m.quoi === 'ancrage'));
});

test('un motif nombreux, réparti et ancré devient PROPOSABLE — jamais promu', () => {
  const [e] = etats([motif()], serie(1, PORTE), CARTE(), CORPUS);
  assert.equal(e.ancrages.length, 1);
  assert.equal(e.ancrages[0].noeud, 'le vin le soir');
  assert.equal(e.ancrages[0].sens, 'de', 'le motif vient AVANT le nœud');
  assert.equal(e.etat, 'proposable',
    'proposable, pas promu : rien ne monte sans que la personne le dise');
  assert.deepEqual(e.manque, []);
});

test('le refus est mémorisé — on ne repose pas la question à chaque ouverture', () => {
  const [e] = etats([motif({ ecarte_le: '2026-06-01T10:00:00.000Z' })],
                    serie(1, PORTE), CARTE(), CORPUS);
  assert.equal(e.etat, 'ecarte');
});

test('un nom emprunté au vocabulaire du diagnostic retient la montée', () => {
  /*
   * PREMIÈRE VERSION : une simple alerte, le motif montait quand même. Le
   * raisonnement était qu'un refus sec effacerait le mécanisme le plus repéré
   * de quelqu'un pour une question de mots. Il tient pour la LISTE — le motif y
   * garde son nom — et pas pour la CARTE : elle dure, elle se relit, et un
   * mécanisme nommé dans le vocabulaire du DSM y devient une identité, qui se
   * cherche ensuite des confirmations. Le nom se renomme, en un geste ; ce
   * qu'une étiquette clinique installe ne se retire pas.
   */
  const [e] = etats([motif({ nom: 'épisode dépressif' })], serie(1, PORTE), CARTE(), CORPUS);
  assert.equal(e.nom_a_revoir, true);
  assert.notEqual(e.etat, 'proposable');
  assert.equal(e.retenu, true, 'retenu, pas « pas encore assez » : les comptes y sont');
  assert.ok(e.manque.some(x => x.quoi === 'nom'));
  // Un nom dans les mots de la personne ne se signale pas.
  const [ok] = etats([motif()], serie(1, PORTE), CARTE(), CORPUS);
  assert.equal(ok.nom_a_revoir, undefined);
  assert.equal(ok.retenu, undefined);
});

test('un motif qui porte le nom d’un nœud du modèle est retenu, et l’écran peut le dire', () => {
  /*
   * `injecterPromus` le sauterait — deux nœuds du même nom en rendraient un
   * inatteignable — et il le sauterait EN SILENCE : on cliquerait « le mettre
   * sur ma carte » et rien n'apparaîtrait, sans que rien ne l'explique.
   */
  const carte = { noeuds: [{ nom: 'Le Vin Le Soir', jours: LENDEMAIN }], liens: [] };
  const [e] = etats([motif({ nom: 'le vin le soir' })], serie(1, PORTE), carte, CORPUS);
  assert.equal(e.collision, true);
  assert.equal(e.retenu, true);
  assert.notEqual(e.etat, 'proposable');
});

test('un nœud promu ne grossit pas avec sa fréquence', () => {
  const carte = { noeuds: [{ nom: 'le vin le soir', jours: LENDEMAIN, genre: 'activite', poids: 2 }],
                  liens: [] };
  const es = etats([motif({ promu: 1, vues: 240 })], serie(1, PORTE), carte, CORPUS);
  const c = injecterPromus(carte, es);
  const n = c.noeuds.find(x => x.promu);
  assert.equal(n.poids, 1,
    '`poids` fait la taille du rond : le faire suivre la fréquence dessinerait ' +
    '« voilà ton plus gros problème », un score de gravité déguisé en géométrie');
  assert.equal(n.genre, 'mecanisme');
  assert.deepEqual(n.jours, PORTE);
});

test('la flèche posée par un comptage décrit le compte, pas un mécanisme', () => {
  const carte = CARTE();
  const es = etats([motif({ promu: 1 })], serie(1, PORTE), carte, CORPUS);
  const c = injecterPromus(carte, es);
  const l = c.liens.find(x => x.compte);
  assert.deepEqual({ de: l.de, vers: l.vers, quoi: l.quoi },
    { de: 'bon bref c’était rien', vers: 'le vin le soir', quoi: 'revient avant' });
});

test('rien n’est injecté quand rien n’est promu, et la carte est rendue telle quelle', () => {
  const carte = CARTE();
  const es = etats([motif()], serie(1, PORTE), carte, CORPUS);
  assert.equal(injecterPromus(carte, es), carte, 'le même objet : aucune copie inutile');
});

test('un motif promu qui porte le nom d’un nœud du modèle n’est pas ajouté deux fois', () => {
  const carte = { noeuds: [{ nom: 'Le Vin Le Soir', jours: LENDEMAIN }], liens: [] };
  const es = etats([motif({ nom: 'le vin le soir', promu: 1 })], serie(1, PORTE), carte, CORPUS);
  assert.equal(es[0].collision, undefined, 'promu : la collision ne se signale plus, elle se subit');
  const c = injecterPromus(carte, es);
  assert.equal(c.noeuds.length, 1,
    'deux nœuds du même nom rendraient l’un des deux inatteignable');
});

test('l’ancrage n’a pas de seuil à lui : c’est celui de la carte', () => {
  // Deux occurrences suivies : sous `min_apres` de sens.js, donc rien.
  const jours = [0, 40].map(jour);
  const suivant = [1, 41].map(jour);
  const a = ancragesDe(jours, [{ nom: 'n', jours: suivant }], SUITE);
  assert.equal(a.length, 0, 'deux fois, ce n’est pas un lien — sens.js en demande trois');
});

/*
 * ================================================================
 * CE QUE LA PROMOTION ÉCRIT À L'ÉCRAN.
 *
 * `MOTS_INTERDITS` n'est pas un filtre à l'exécution : c'est une règle que
 * seuls des tests appliquent. Croire qu'elle protège les sorties de la
 * promotion parce que promotion.js l'importe serait faux — elle n'y sert qu'à
 * examiner le NOM d'un motif. Les phrases de la vue, elles, ne passent devant
 * personne.
 *
 * Ce test les relit avec la grille du sceptique (la même que
 * fonctionnements-sceptique-langue.test.js, volontairement plus large que
 * MOTS_INTERDITS) : pas de nom de trouble, pas de cause affirmée, pas de
 * conseil, pas de prédiction, pas de mot d'atelier. C'est ici que
 * l'autodiagnostic entrerait, et il entrerait par le vocabulaire.
 * ================================================================
 */
import { readFileSync } from 'node:fs';
import { MOTS_INTERDITS } from '../server/fonctionnements.js';

/* Ce qui est entre guillemets vient de la personne : ses mots à elle ne sont
   pas jugés. C'est la même convention que le test du sceptique. */
const laMachineDit = s => String(s).replace(/«[^»]*»/g, '');

const TOURNURES = [
  { quoi: 'un nom de trouble ou un mot de clinique',
    re: /d[ée]pr[eé]ss|d[ée]prim|bipol|tdah|autis|\btroubles?\b|diagnos|pathol|maladie|syndrome|dissoci|anxi|angoiss|panique|insomni|burn.?out|borderline|schizo|n[ée]vros|sympt[ôo]m|rechute|s[ée]v[ée]rit|clinique|th[ée]rap|traitement|m[ée]dica|suicid|[ée]pisode|\bcrises?\b/i },
  { quoi: 'une cause affirmée — un comptage ne cause rien',
    re: /à cause|parce que|\bcauses?\b|provoqu|entra[îi]n|expliqu|d[ée]clench|est d[ûu]e? à|fait (monter|baisser|que)/i },
  { quoi: 'un conseil ou une étiquette sur la personne',
    re: /tu devrais|il faut que tu|tu dois|essaie|fais attention|tu ferais|conseil|tu es (trop|un|une)\b|tu vas mal|anormal|\bfragile|\binstable|chaotique|malade/i },
  { quoi: 'une prédiction, ou de quoi avoir peur',
    re: /\bva (baisser|monter|changer|revenir)|risque|bient[ôo]t|annonc|pr[ée]vo|pr[ée]di|\bpeur\b|inqui[eè]t|danger|\bgrave/i },
  { quoi: 'un mot d’atelier que la personne ne peut pas vérifier',
    re: /\bbanc\b|bootstrap|r[ée]gression|fisher|welch|spearman|[ée]cart-type|quantile|significati|\bp-?valeur|corr[ée]lation|\bseuil/i },
];

/* Les chaînes du bloc « UN MOTIF MONTE S'IL TIENT » de app.js, plus le
   paragraphe du panneau d'un nœud promu. C'est ce qui arrive sous les yeux. */
function textesDeLaVue() {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const bornes = [
    ["UN MOTIF MONTE S'IL TIENT =====", 'function mecaGroupes'],
    ['CE NŒUD EST MONTÉ DEPUIS TES MOTIFS', '${p.extraits.length'],
    ["L'ANCRAGE REMPLACE LA RESSEMBLANCE DE NOMS", 'function mecanismes('],
  ];
  const textes = [];
  for (const [a, b] of bornes) {
    const i = app.indexOf(a);
    assert.ok(i > 0, `repère introuvable dans app.js : ${a}`);
    const j = app.indexOf(b, i);
    assert.ok(j > i, `fin introuvable dans app.js : ${b}`);
    // Les commentaires ne se lisent pas : on ne juge que ce qui s'affiche.
    const code = app.slice(i, j).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      const t = (m[1] ?? m[2] ?? m[3] ?? '')
        .replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, ' ')
        .replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.length > 12 && /[a-zà-ÿ]{4}/i.test(t)) textes.push(t);
    }
  }
  assert.ok(textes.length >= 8, `trop peu de phrases relues (${textes.length}) — les repères ont bougé`);
  return textes;
}

test('aucune phrase de la promotion ne porte une tournure interdite', () => {
  const fautes = [];
  for (const t of textesDeLaVue()) {
    const dit = laMachineDit(t);
    for (const { quoi, re } of TOURNURES) {
      const m = re.exec(dit);
      if (m) fautes.push(`« ${m[0]} » (${quoi}) dans « ${t} »`);
    }
  }
  assert.deepEqual([...new Set(fautes)], [], '\n' + [...new Set(fautes)].join('\n'));
});

test('les verbes des flèches décrivent un compte, et rien d’autre', () => {
  const mots = Object.values(VERBE);
  assert.equal(mots.length, 3);
  for (const m of mots) {
    assert.equal(MOTS_INTERDITS.test(m), false, m);
    for (const { quoi, re } of TOURNURES) assert.equal(re.test(m), false, `${m} — ${quoi}`);
  }
});
