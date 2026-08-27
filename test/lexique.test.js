import test from 'node:test';
import assert from 'node:assert/strict';
import { poids, saillant, expressions, lisible, CREUX } from '../server/lexique.js';
import { tokenize, buildIndex, search } from '../server/search.js';

/* ------------------------- le lexique lui-meme ------------------------- */

test('les mecanismes pesent plus que les circonstances', () => {
  assert.ok(poids('autodestruction') > poids('fatigue'));
  assert.ok(poids('fatigue') > poids('envie'));
  assert.ok(poids('envie') > poids('different'));
});

test('les mots qui annoncent un etat sans le nommer sont rabaisses', () => {
  // La demande d'origine : « anxio », « fatigue » et « autodestruction »
  // doivent battre « envie ».
  for (const m of ['anxios', 'fatigue', 'autodestruction']) {
    assert.ok(poids(m) > poids('envie'), `${m} devrait battre envie`);
  }
});

test('les racines longues attrapent leurs derives, les courtes non', () => {
  assert.equal(poids('anxios'), poids('anxio'));
  assert.equal(poids('anxiolytiques'), poids('anxio'));
  assert.ok(poids('fatiguee') > 1);
  // « mal » ne doit pas se declencher sur « malgre » ni « fier » sur n'importe quoi
  assert.equal(poids('malgre'), 1);
});

test('les mots creux sont reconnus comme tels', () => {
  for (const m of ['fois', 'autres', 'different', 'verra', 'ensemble', 'juste', 'encore'])
    assert.ok(CREUX.has(m), `${m} devrait etre creux`);
});

test('saillant separe ce qui nomme de ce qui coincide', () => {
  assert.ok(saillant('angoisse') && saillant('insomnie') && saillant('rumination'));
  assert.ok(!saillant('envie') && !saillant('juste') && !saillant('dose'));
});

/* --------------------------- les expressions --------------------------- */

test('une expression est reconnue dans le flux de mots', () => {
  assert.deepEqual(
    expressions('j ai eu une envie de me faire du mal ce soir'.split(' ')),
    ['me_faire_du_mal']
  );
});

test("l'expression bat ses propres morceaux", () => {
  assert.ok(poids('envie_de_disparaitre') > poids('envie'));
  assert.equal(lisible('envie_de_disparaitre'), 'envie de disparaitre');
});

/* --------------------------- le tokenizer ------------------------------ */

test("l'elision est decoupee -- c'est le premier bruit d'un journal francais", () => {
  const t = tokenize("c'est juste que j'etais a fond, j'ai pas d'urgence");
  for (const bruit of ["c'est", "j'etais", "j'ai", "d'urgence"])
    assert.ok(!t.includes(bruit), `${bruit} ne doit pas rester entier`);
  assert.ok(t.includes('urgence'));
});

test('le tokenizer sort les expressions comme tokens a part entiere', () => {
  assert.ok(tokenize("j'ai eu une envie de me faire du mal").includes('me_faire_du_mal'));
});

test("la phrase du 24 aout ne laisse que ce qui dit quelque chose", () => {
  const t = tokenize("là ça va je vais bien, c'est juste que je suis fatigué de tout ça");
  assert.deepEqual(t, ['fatigue']);
});

/* ------------------------ ce que ca change au Miroir ------------------- */

const CORPUS = [
  { id: 'a', text: "c'est juste que je suis fatigué, encore une fois, un truc d'autodestruction de fond" },
  { id: 'b', text: "c'est juste encore une fois différent des autres, à fond sur le taff, un projet de vidéo" },
  { id: 'c', text: "grosse angoisse ce matin, boule au ventre, j'ai pris deux anxios et j'étais épuisé" }
];

test('un rapprochement ne tient plus sur les mots de remplissage', () => {
  const idx = buildIndex(CORPUS);
  const hits = search(idx, CORPUS[0].text, { exclude: new Set(['a']) });
  const b = hits.find(h => h.id === 'b');
  // « b » partage juste/encore/fois/fond avec « a » et rien d'autre :
  // il ne doit rien avoir de saillant a montrer.
  assert.equal(b?.forts.length ?? 0, 0);
});

test("les termes montres sont classes par ce qu'ils apportent", () => {
  const idx = buildIndex(CORPUS);
  const [hit] = search(idx, 'angoisse et anxios, épuisé, une envie', { exclude: new Set(['a', 'b']) });
  assert.equal(hit.id, 'c');
  assert.ok(hit.forts.length >= 1);
  assert.ok(saillant(hit.terms[0]), `le premier terme montre est « ${hit.terms[0]} »`);
});

test('les termes montres sont plafonnes', () => {
  const idx = buildIndex(CORPUS);
  for (const h of search(idx, CORPUS[2].text)) assert.ok(h.terms.length <= 4);
});

test('le jargon clinique pèse plus que le vocabulaire courant', () => {
  // Le cas qui a motivé tout ce fichier, poussé jusqu'aux abréviations : « TS »
  // fait deux caractères, aucune racine-préfixe ne peut l'attraper.
  for (const mot of ['ts', 'toc', 'tca', 'scarification', 'suicidaire', 'purge',
                     'insomnie', 'boulimie', 'anorexie', 'abstinence']) {
    assert.ok(saillant(mot), `${mot} = ${poids(mot)}`);
    assert.ok(poids(mot) > poids('envie'), mot);
  }
});

test('une racine longue ne masque plus une racine courte plus lourde', () => {
  // « boulimie » vivait en clé exacte à 1.8 (corps) et en préfixe à 2.6 (états).
  // La clé exacte gagne avant le préfixe : le mot restait au poids le plus bas.
  assert.equal(poids('boulimie'), poids('boulimi' + 'e'));
  assert.ok(poids('boulimie') > poids('appetit'));
});

test('les expressions de tenue et de rechute sont reconnues', () => {
  const dit = t => expressions(t.split(/\s+/));
  assert.ok(dit('tentative de suicide').includes('tentative_de_suicide'));
  assert.ok(dit('j ai des idees noires').includes('idees_noires'));
  assert.ok(dit('je veux arreter de fumer').includes('arreter_de_fumer'));
  assert.ok(dit('j ai rechute hier').includes('j_ai_rechute'));
});

test('aucune expression ne chevauche deux lignes de la table', () => {
  // split('|') seul recollait la fin d'une ligne au debut de la suivante.
  // Cinq mots, c'est deja long pour une expression ; huit est le signe sur.
  const dit = t => expressions(t.split(/\s+/));
  assert.ok(dit('je sers a rien').includes('je_sers_a_rien'));
  assert.ok(dit('envie d en finir').includes('envie_d_en_finir'));
  assert.ok(dit('faire du mal').includes('faire_du_mal'));
});

test('la plus longue expression gagne, et le texte n\'est compté qu\'une fois', () => {
  const dit = t => expressions(t.split(/\s+/));
  assert.deepEqual(dit('me faire du mal'), ['me_faire_du_mal']);
  assert.deepEqual(dit('faire du mal'), ['faire_du_mal']);
  // deux occurrences distinctes restent deux tokens
  assert.equal(dit('faire du mal et faire du mal').length, 2);
});
