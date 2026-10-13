/**
 * LA MÉMOIRE DES CONVERSATIONS DE JARVIS.
 *
 * « Fais en sorte que Jarvis se souvienne beaucoup mieux des conversations
 * passées […] si l'utilisateur demande « on parlait de quoi ce matin », il
 * pourra répondre précisément. » La source est le fil (`via: 'Jarvis'`), mot
 * pour mot : on le relit par jour, par mot, et les dernières heures partent
 * avec chaque question.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-memoire-')), 'test.db');

const { OWNER, addMessage } = await import('../server/db.js');
const M = await import('../server/jarvis-memoire.js');
const J = await import('../server/jarvis.js');

const U = OWNER;
const poser = (ts, date, role, text, via = 'Jarvis') => addMessage({ ts, date, source: 'connecteur', role, text, via, userId: U });

// une matinée, un après-midi, une veille ; et une phrase du journal, qui n'est pas à Jarvis
poser('2026-10-13T07:12:00Z', '2026-10-13', 'user', 'Trouve-moi un garage-témoin ouvert le samedi à Nantes-témoin.');
poser('2026-10-13T07:12:05Z', '2026-10-13', 'pet', 'Le garage Martin-témoin, rue des Lilas-témoin, ouvre le samedi de 9 h à 12 h.');
poser('2026-10-13T14:30:00Z', '2026-10-13', 'user', 'Mets du jazz.');
poser('2026-10-13T14:30:03Z', '2026-10-13', 'pet', 'Voilà du jazz.');
poser('2026-10-12T19:00:00Z', '2026-10-12', 'user', 'Combien coûte une carte graphique-témoin ?');
poser('2026-10-12T19:00:04Z', '2026-10-12', 'pet', 'Autour de 600 euros-témoin.');
addMessage({ ts: '2026-10-13T08:00:00Z', date: '2026-10-13', source: 'web', role: 'user',
             text: 'une page de journal-témoin', userId: U });

const ctx = { userId: U, zone: 'Europe/Paris', langue: 'fr', jourDefaut: () => '2026-10-13',
              maintenant: new Date('2026-10-13T15:00:00Z') };

test('relire un jour : chaque échange, mot pour mot, à son heure locale', () => {
  const t = M.lireConversations({ jour: '2026-10-13' }, ctx);
  assert.match(t, /09:12 La personne : Trouve-moi un garage-témoin/);
  assert.match(t, /09:12 Toi : Le garage Martin-témoin, rue des Lilas-témoin/);
  assert.match(t, /16:30 La personne : Mets du jazz/);
  assert.ok(!t.includes('carte graphique'), 'pas la veille');
  assert.ok(!t.includes('page de journal'), 'pas le journal : seulement ses conversations à lui');
  assert.ok(t.indexOf('garage') < t.indexOf('jazz'), 'dans l’ordre du temps');
  // sans jour : la journée vécue
  assert.equal(M.lireConversations({}, ctx), t);
  assert.match(M.lireConversations({ jour: '2026-01-01' }, ctx), /Aucune conversation/);
});

test('chercher un mot, sur les dernières semaines, avec la date', () => {
  const t = M.lireConversations({ recherche: 'graphique' }, ctx);
  assert.match(t, /^12\/10 21:00 La personne : Combien coûte une carte graphique-témoin/);
  assert.match(M.lireConversations({ recherche: 'licorne' }, ctx), /Rien sur « licorne »/);
  assert.match(M.lireConversations({ recherche: '100%' }, ctx), /Rien sur/, 'le % ne joue pas le joker');
});

test('le fil récent : les dernières heures seulement, et coupé par le début s’il est trop long', () => {
  const fil = M.filRecent(ctx);
  assert.match(fil, /Mets du jazz/);
  assert.ok(!fil.includes('garage'), 'ce matin dépasse les trois heures');
  const long = Array.from({ length: 50 }, (_, i) => ({ ts: '2026-10-13T10:00:00Z', date: '2026-10-13',
                                                     role: 'user', text: 'x'.repeat(500) + i }));
  const t = M.echangesEnTexte(long, { max: 2000 });
  assert.ok(t.length <= 2100);
  assert.match(t, /^\(échanges plus anciens coupés\)/);
  assert.match(t, /x49$/, 'le plus récent est gardé');
});

function fauxClient(reponses) {
  const appels = [];
  const file = [...reponses];
  return {
    appels,
    messages: {
      create: async req => {
        appels.push({ ...req, messages: structuredClone(req.messages),
                      system: Array.isArray(req.system) ? req.system.map(b => b.text).join('\n\n') : req.system });
        const r = file.length > 1 ? file.shift() : file[0];
        return { model: req.model, usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn', ...r };
      }
    }
  };
}

test('« on parlait de quoi ce matin ? » : il relit, et répond avec les détails', async () => {
  const c = fauxClient([
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'm1', name: 'conversations_passees',
                                           input: { jour: '2026-10-13' } }] },
    { content: [{ type: 'text', text: 'Du garage Martin-témoin, ouvert le samedi de 9 h à 12 h.' }] }]);
  const conversations = { lire: e => M.lireConversations(e, ctx), recent: () => M.filRecent(ctx) };
  const r = await J.repondreJarvis({ texte: 'on parlait de quoi ce matin ?' },
                                   { client: async () => c, versLeCompagnon: async () => '', conversations });
  assert.ok(c.appels[0].tools.some(t => t.name === 'conversations_passees'));
  assert.match(c.appels[0].system, /DERNIÈRES HEURES DE CONVERSATION/);
  assert.match(c.appels[0].system, /Mets du jazz/, 'le fil récent part avec la question');
  const relu = JSON.stringify(c.appels[1].messages.at(-1));
  assert.match(relu, /rue des Lilas-témoin/, 'l’outil a rendu les mots exacts, exécuté ici');
  assert.equal(r.texte, 'Du garage Martin-témoin, ouvert le samedi de 9 h à 12 h.');
  assert.ok(!r.outils, 'rien ne part au PC');
});

test('sans la mémoire (un appel qui ne la passe pas), ni outil ni fil', async () => {
  const c = fauxClient([{ content: [{ type: 'text', text: 'Bien.' }] }]);
  await J.repondreJarvis({ texte: 'bonjour' }, { client: async () => c, versLeCompagnon: async () => '' });
  assert.ok(!c.appels[0].tools.some(t => t.name === 'conversations_passees'));
  assert.doesNotMatch(c.appels[0].system, /DERNIÈRES HEURES/);
});

test('l’historique de la conversation en cours tient 40 répliques, et les résumés gardent les détails', async () => {
  assert.equal(J.HISTORIQUE_MAX, 40);
  const c = fauxClient([{ content: [{ type: 'text', text: 'A cherché un garage-témoin à Nantes-témoin.' }] }]);
  await J.repondreJarvis({ transition: 'resume', historique: [{ role: 'user', texte: 'un garage ?' },
                                                              { role: 'assistant', texte: 'Martin-témoin.' }] },
                         { client: async () => c, versLeCompagnon: async () => '' });
  assert.match(c.appels[0].system, /noms, titres, chiffres/);
  assert.match(c.appels[0].system, /resté en suspens/);
});
