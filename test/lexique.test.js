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
