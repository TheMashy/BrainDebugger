/**
 * LES TÂCHES DE FOND DE JARVIS, ET LE CONTEXTE DES PROJETS.
 *
 * Demandé : « que Jarvis puisse accomplir des tâches (rechercher des choses sur
 * le côté ?) et qu'il puisse avoir accès à Claude pour réfléchir sur des idées
 * simples avec un peu de contexte des projets ».
 *
 * Tenu ici :
 *   - une tâche part à côté et se termine seule : un résumé à dire, le texte
 *     complet, ses sources ; la recherche web est offerte, la réflexion aussi ;
 *   - les projets arrivent dans la consigne de la tâche, de Jarvis et de Claude consulté ;
 *   - une longue recherche qui s'interrompt (`pause_turn`) est relancée ;
 *   - pas plus de trois en même temps ; une erreur se dit ;
 *   - Jarvis a les outils quand Machi Tool les annonce, et ils partent chez lui.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-taches-')), 'test.db');
process.env.ANTHROPIC_API_KEY = '';

const T = await import('../server/taches.js');
const J = await import('../server/jarvis.js');

function fauxClient(reponses) {
  const appels = [];
  const file = [...reponses];
  return {
    appels,
    messages: {
      create: async req => {
        appels.push(req);
        const r = file.length > 1 ? file.shift() : file[0];
        if (r instanceof Error) throw r;
        return { model: req.model, usage: { input_tokens: 1000, output_tokens: 300 }, stop_reason: 'end_turn', ...r };
      }
    }
  };
}

const texte = t => ({ content: [{ type: 'text', text: t }] });

test('la réponse se sépare : ce qu\'il dit, et le travail complet', () => {
  const r = T.separerReponse('À DIRE : Trois cartes tiennent la route, la 5070 en tête.\n\n## Comparatif\nLa suite.');
  assert.equal(r.resume, 'Trois cartes tiennent la route, la 5070 en tête.');
  assert.match(r.texte, /^## Comparatif/);
  assert.equal(T.separerReponse('**À DIRE :** Voilà.\n\nDétail').resume, 'Voilà.');
  assert.equal(T.separerReponse('TO SAY: Done.\n\nMore').resume, 'Done.');
  // sans la ligne : les deux premières phrases
  const sans = T.separerReponse('Premier point. Deuxième point. Troisième.');
  assert.equal(sans.resume, 'Premier point. Deuxième point.');
  assert.equal(sans.texte, 'Premier point. Deuxième point. Troisième.');
});

test('une recherche : le web offert, les projets dans la consigne, les sources jointes', async () => {
  const c = fauxClient([{ content: [
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'x' } },
    { type: 'text', text: 'À DIRE : La 5070 est le meilleur rapport qualité-prix.\n\nDétail du comparatif.',
      citations: [{ url: 'https://exemple.org/a', title: 'Banc A' }, { url: 'https://exemple.org/a', title: 'Banc A' }] }
  ] }]);
  const r = await T.executerTache(c, { demande: 'Compare les cartes graphiques à 600 euros.', genre: 'recherche',
                                       projets: '- Irontide : un jeu de robots sous Godot' });
  assert.equal(r.resume, 'La 5070 est le meilleur rapport qualité-prix.');
  assert.match(r.texte, /Détail du comparatif\.\n\nSources :\n- Banc A — https:\/\/exemple\.org\/a$/);
  assert.equal(r.sources.length, 1, 'sans doublon');
  const req = c.appels[0];
  assert.equal(req.model, T.TACHE_MODELE);
  assert.deepEqual(req.tools.map(t => t.type), ['web_search_20260209', 'web_fetch_20260209']);
  assert.match(req.system, /CHERCHER/);
  assert.match(req.system, /Irontide : un jeu de robots/);
  assert.match(req.system, /À DIRE :/);
  assert.ok(req.max_tokens <= 21000, 'sans streaming : sous le seuil du SDK');
});

test('une réflexion : dite comme telle', async () => {
  const c = fauxClient([texte('À DIRE : Bonne idée, commencez petit.\n\nLe plan.')]);
  await T.executerTache(c, { demande: 'Une idée de mode coop pour Irontide ?', genre: 'reflexion' });
  assert.match(c.appels[0].system, /RÉFLÉCHIR/);
});

test('une longue recherche interrompue est relancée', async () => {
  const c = fauxClient([
    { stop_reason: 'pause_turn', content: [{ type: 'server_tool_use', id: 's1', name: 'web_search', input: {} }] },
    texte('À DIRE : Trouvé.\n\nTout.')
  ]);
  const r = await T.executerTache(c, { demande: 'x' });
  assert.equal(c.appels.length, 2);
  assert.equal(c.appels[1].messages.at(-1).role, 'assistant');
  assert.equal(r.resume, 'Trouvé.');
  assert.equal(r.usages.length, 2, 'les deux tours sont comptés');
});

test('le registre : la tâche part, se termine seule, se relit', async () => {
  const reg = T.creerRegistre();
  const c = fauxClient([texte('À DIRE : Prêt.\n\nLe texte.')]);
  const notes = [];
  const t = reg.lancer('moi', { demande: 'Cherche les horaires du musée d\'Orsay dimanche', genre: 'recherche' },
                       { client: async () => c, noter: (u, m) => notes.push(m) });
  assert.equal(t.etat, 'en_cours');
  assert.equal(t.titre, 'Cherche les horaires du musée d\'Orsay dimanche');
  assert.equal(t.promesse, undefined, 'rien d\'interne ne sort');
  await reg.attendre('moi', t.id);
  const fini = reg.lire('moi', t.id);
  assert.equal(fini.etat, 'fini');
  assert.equal(fini.resume, 'Prêt.');
  assert.equal(fini.texte, 'Le texte.');
  assert.deepEqual(notes, [T.TACHE_MODELE], 'la dépense est relevée');
  assert.equal(reg.lire('quelqu_un_d_autre', t.id), null, 'chacun ses tâches');
  assert.equal(reg.lister('moi')[0].texte, undefined, 'la liste reste courte');
});

test('trois en même temps au plus ; une demande vide est refusée ; une erreur se dit', async () => {
  const reg = T.creerRegistre();
  let lacher;
  const bloque = new Promise(r => { lacher = r; });
  const lent = { messages: { create: async () => { await bloque; return { ...texte('À DIRE : ok.'), usage: {} }; } } };
  for (let i = 0; i < T.TACHES_EN_COURS_MAX; i++) reg.lancer('moi', { demande: 'tâche ' + i }, { client: lent });
  assert.throws(() => reg.lancer('moi', { demande: 'une de trop' }, { client: lent }), e => e.statut === 429);
  assert.throws(() => reg.lancer('moi', { demande: '  ' }, { client: lent }), e => e.statut === 400);
  lacher();
  const casse = fauxClient([Object.assign(new Error('credit balance too low'), { status: 400 })]);
  const reg2 = T.creerRegistre();
  const t = reg2.lancer('moi', { demande: 'x' }, { client: casse });
  await reg2.attendre('moi', t.id);
  assert.equal(reg2.lire('moi', t.id).etat, 'erreur');
  assert.match(reg2.lire('moi', t.id).erreur, /credit/);
});

test('une tâche trop longue est arrêtée', async () => {
  const reg = T.creerRegistre({ duree: 20 });
  const jamais = { messages: { create: () => new Promise(() => {}) } };
  const t = reg.lancer('moi', { demande: 'x' }, { client: jamais });
  await reg.attendre('moi', t.id);
  assert.equal(reg.lire('moi', t.id).etat, 'erreur');
  assert.match(reg.lire('moi', t.id).erreur, /trop long/);
});

test('Jarvis : les outils des tâches quand Machi Tool les annonce, et les projets dans sa consigne', async () => {
  const c = fauxClient([texte('Bien.')]);
  await J.demanderAJarvis(c, { texte: 'bonjour', taches: true, projets: '- Machi Tool : la guirlande et Jarvis' });
  const noms = c.appels[0].tools.map(t => t.name);
  for (const n of ['lancer_tache', 'taches', 'noter_projet']) assert.ok(noms.includes(n), n);
  assert.match(c.appels[0].system, /TÂCHES DE FOND/);
  assert.match(c.appels[0].system, /Machi Tool : la guirlande et Jarvis/);
  const sans = fauxClient([texte('Bien.')]);
  await J.demanderAJarvis(sans, { texte: 'bonjour' });
  assert.ok(!sans.appels[0].tools.map(t => t.name).includes('lancer_tache'), 'un vieux Machi Tool ne les a pas');
});

test('Jarvis lance une tâche : l\'outil part chez Machi Tool, sans les mains sur le PC', async () => {
  const c = fauxClient([{ stop_reason: 'tool_use', content: [
    { type: 'text', text: 'Je m\'en occupe.' },
    { type: 'tool_use', id: 't1', name: 'lancer_tache', input: { demande: 'Compare…', genre: 'recherche', titre: 'Cartes graphiques' } }
  ] }]);
  const r = await J.demanderAJarvis(c, { texte: 'cherche-moi une carte graphique à 600 euros', taches: true });
  assert.deepEqual(r.outils.map(o => o.nom), ['lancer_tache']);
  assert.ok(r.suite.length >= 2);
});

test('Claude consulté reçoit les projets', async () => {
  const c = fauxClient([texte('Réponse.')]);
  await J.consulterClaude(c, 'Une idée pour le nom du jeu ?', 'fr', '- Irontide : robots');
  assert.match(c.appels[0].system, /Ses projets/);
  assert.match(c.appels[0].system, /Irontide : robots/);
  const sans = fauxClient([texte('Réponse.')]);
  await J.consulterClaude(sans, 'x');
  assert.doesNotMatch(sans.appels[0].system, /projets/);
});
