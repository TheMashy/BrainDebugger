/**
 * LES SCHÉMAS : ce que le serveur refuse de laisser passer, comme pour les
 * thèmes. Un schéma sans preuve datée est une boucle sortie d'un manuel ; une
 * fonction inconnue retombe sur « soulager » ; un motif du fil ne se rattache
 * que par son nom exact ; une lecture porte sa version.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { valider, validerSchemas, corpusPour, VERSION_LECTURE, BUDGET_COMPLET, FONCTIONS } from '../server/lecture.js';

const DATES = new Set(['2024-03-12', '2024-04-02', '2024-05-20']);
const brut = (x = {}) => ({
  nom: 'la porte', declencheur: 'sortir de chez toi', reaction: 'la peur monte', comportement: 'un anxio',
  effet: 'la porte se franchit', cout: 'la peur ne redescend jamais seule', fonction: 'éviter', force: 2,
  preuves: [{ date: '2024-03-12', extrait: 'j’ai pris un truc avant de sortir' }], jours: ['2024-03-12', '2024-04-02', '1999-01-01'], ...x
});

test('un schéma sans preuve datée dans le corpus n’est pas rendu', () => {
  const r = validerSchemas([brut({ preuves: [{ date: '1999-01-01', extrait: 'inventé' }] })], DATES);
  assert.equal(r.length, 0);
});

test('les journées inventées sont retirées, celles des preuves sont ajoutées', () => {
  const [s] = validerSchemas([brut({ jours: ['2024-04-02', '1999-01-01'] })], DATES);
  assert.deepEqual(s.jours, ['2024-03-12', '2024-04-02']);
});

test('la fonction s’écrit sans accent et retombe sur « soulager » si elle est inconnue', () => {
  assert.equal(validerSchemas([brut({ fonction: 'éviter' })], DATES)[0].fonction, 'eviter');
  assert.equal(validerSchemas([brut({ fonction: 'se punir' })], DATES)[0].fonction, 'se_punir');
  assert.equal(validerSchemas([brut({ fonction: 'nimportequoi' })], DATES)[0].fonction, 'soulager');
  for (const f of FONCTIONS) assert.equal(validerSchemas([brut({ fonction: f })], DATES)[0].fonction, f);
});

test('un motif du fil ne se rattache que par son nom exact', () => {
  const [s] = validerSchemas([brut({ motifs: ['Peur avant de sortir', 'un motif inventé'] })], DATES, new Set(['peur avant de sortir']));
  assert.deepEqual(s.motifs, ['peur avant de sortir']);
});

test('sans déclencheur, réaction ou geste, ce n’est pas une boucle', () => {
  assert.equal(validerSchemas([brut({ comportement: '' })], DATES).length, 0);
  assert.equal(validerSchemas([brut({ declencheur: '  ' })], DATES).length, 0);
});

test('six schémas au plus, jamais deux fois le même nom, les plus forts d’abord', () => {
  const r = validerSchemas([...Array(9)].map((_, i) => brut({ nom: `s${i % 8}`, force: (i % 3) + 1 })), DATES);
  assert.equal(r.length, 6);
  assert.equal(new Set(r.map(s => s.nom)).size, 6);
  for (let i = 1; i < r.length; i++) assert.ok(r[i - 1].force >= r[i].force);
});

test('la continuité reprend un nom connu et voit un renommage', () => {
  const precedente = { schemas: [{ nom: 'la porte' }, { nom: 'l’aube' }] };
  const r = valider({ synthese: 'x', themes: [], pistes: [], carte: { noeuds: [], liens: [] },
    schemas: [brut(), brut({ nom: 'l’aube qui écrit', avant: ['l’aube'] })] }, DATES, [], precedente);
  assert.equal(r.schemas.find(s => s.nom === 'la porte').suite, 'repris');
  assert.equal(r.schemas.find(s => s.nom === 'l’aube qui écrit').suite, 'renomme');
});

test('une lecture validée porte sa version, et une lecture sans schémas reste valide', () => {
  const r = valider({ synthese: 'x', themes: [], pistes: [], carte: { noeuds: [], liens: [] } }, DATES);
  assert.equal(r.version, VERSION_LECTURE);
  assert.deepEqual(r.schemas, []);
});

test('le corpus complet garde toutes les journées écrites, l’ordinaire en garde une partie', () => {
  const rows = [...Array(400)].map((_, i) => ({ date: new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10), note: 5, text: 'x'.repeat(700) }));
  const ordinaire = corpusPour({ rows });
  const complet = corpusPour({ rows, complet: true });
  assert.ok(ordinaire.dates.size < 400, `l’échantillon en garde ${ordinaire.dates.size}`);
  assert.equal(complet.dates.size, 400);
  assert.equal(complet.complet, true);
  assert.ok(BUDGET_COMPLET > 400 * 724);
});

test('les motifs du fil voyagent avec le corpus, en minuscules', () => {
  const c = corpusPour({ rows: [{ date: '2024-03-12', note: 5, text: 'x' }], motifs: [{ nom: 'Peur avant de sortir', mecanisme: 'm', vues: 3 }] });
  assert.ok(c.motifsConnus.has('peur avant de sortir'));
});
