/**
 * LE CACHE DE PROMPT, ET CE QUI LE CASSE SANS BRUIT.
 *
 * Un échange avec outils coûte deux ou trois appels, et chacun renvoyait
 * l'intégralité du prompt : le système, les schémas des huit outils, la
 * mémoire, et tout l'historique. Le même bloc, plein tarif, trois fois de
 * suite, pour une réponse de deux phrases.
 *
 * Le cache est un ACCORD DE PRÉFIXE : un octet qui change quelque part
 * invalide tout ce qui suit. Ce qui est tenu ici, c'est l'ordre de stabilité —
 * parce qu'une régression sur ce point ne casse rien, ne lève rien, et se voit
 * seulement sur une facture à la fin du mois.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-cache-')), 'test.db');

const { OWNER, setNote, setSettings, addMessage, DEFAULT_SETTINGS } = await import('../server/db.js');
const api = await import('../server/api.js');
const chat = await import('../server/chat.js');
const usage = await import('../server/usage.js');

/* ============ LE PROMPT ============ */

test('le prompt système ne contient rien qui change d’une requête à l’autre', async () => {
  /*
   * Il est le tout premier bloc du préfixe : une date, une heure, un identifiant
   * de session posés là invalideraient TOUT ce qui suit, à chaque message. Le
   * marqueur de cache serait posé, ne rendrait jamais rien, et coûterait en plus
   * le quart de surcoût de l'écriture.
   */
  const p = chat.SYSTEM_PROMPT;
  assert.ok(p.length > 1000, 'le prompt système est introuvable');
  // Pas la date du jour, ni l'année en cours : ce sont les deux formes que
  // prend une interpolation quand elle se glisse là.
  const jour = new Date().toISOString().slice(0, 10);
  assert.equal(p.includes(jour), false, `la date ${jour} est écrite dans le prompt système`);
  assert.equal(p.includes(String(new Date().getFullYear())), false, "l'année en cours y est écrite");

  /*
   * ET SURTOUT : PAS D'INTERPOLATION DU TOUT. C'est la garde qui tient dans le
   * temps — une date se remarquerait, un `${'$'}{quelqueChose}` glissé dans le
   * gabarit dans six mois ne se remarquerait pas, et suffirait à ce que le
   * cache ne prenne plus jamais sans qu'aucun test ne tombe.
   */
  const src = await import('node:fs').then(fs => fs.readFileSync('server/chat.js', 'utf8'));
  const i = src.indexOf('export const SYSTEM_PROMPT = `');
  assert.ok(i >= 0, 'le gabarit du prompt système est introuvable dans la source');
  const debut = i + 'export const SYSTEM_PROMPT = `'.length;
  const gabarit = src.slice(debut, src.indexOf('`', debut));
  assert.ok(gabarit.length > 1000, 'le gabarit lu est trop court pour être le bon');
  assert.equal(gabarit.includes('${'), false,
               'le prompt système est interpolé : le cache ne prendra jamais');
});

test('la mémoire se sépare en ce qui tient la journée et ce qui change à chaque phrase', () => {
  setSettings({ memoryDays: 14 }, OWNER);
  for (const [d, n, t] of [['2026-01-05', 3, "crise d'angoisse avant la réunion, boule au ventre"],
                           ['2026-01-19', 3, "encore une crise d'angoisse, la même boule au ventre"],
                           ['2026-02-02', 7, "j'ai repeint la cuisine tout le week-end"]]) {
    setNote(d, n, OWNER);
    addMessage({ ts: `${d}T20:00:00.000Z`, date: d, source: 'web', role: 'user', text: t, userId: OWNER });
  }
  const a = api.recentMemory('2026-03-01', OWNER, "crise d'angoisse ce matin, la boule au ventre est revenue");
  const b = api.recentMemory('2026-03-01', OWNER, "je me demande quel film regarder ce soir");

  assert.deepEqual(Object.keys(a).sort(), ['echos', 'stable']);
  /*
   * LA GARDE QUI COMPTE. Deux messages différents dans la même journée doivent
   * produire exactement la même partie stable — sinon elle n'est pas stable, le
   * cache ne prend jamais, et personne ne s'en aperçoit.
   */
  assert.equal(a.stable, b.stable, 'la partie « stable » change avec le message');
  assert.notEqual(a.echos, b.echos, 'les échos ne dépendent pas de ce qui vient d’être écrit');
});

test('la fenêtre du fil est bornée, et la borne est un chiffre nommé', () => {
  // Soixante messages renvoyés à chaque tour, deux ou trois tours par échange :
  // le fil traversait le réseau trois fois pour une réponse de deux phrases.
  assert.equal(typeof api.FIL_TRANSMIS, 'number');
  assert.ok(api.FIL_TRANSMIS > 0 && api.FIL_TRANSMIS <= 30,
            `${api.FIL_TRANSMIS} messages : la mémoire longue ne passe pas par le fil`);
});

/* ============ LES DEUX MODÈLES ============ */

test('le compagnon et la lecture n’ont pas le même modèle par défaut', () => {
  // Deux métiers : tenir une conversation du soir quarante fois par jour, et
  // relire quatre ans de journal une fois par semaine.
  assert.equal(DEFAULT_SETTINGS.anthropicModelChat, 'claude-sonnet-5');
  assert.equal(DEFAULT_SETTINGS.anthropicModel, 'claude-opus-5');
  assert.notEqual(DEFAULT_SETTINGS.anthropicModelChat, DEFAULT_SETTINGS.anthropicModel);
});

test('changer le modèle du compagnon ne touche pas celui de la lecture', () => {
  const s = setSettings({ anthropicModelChat: 'claude-haiku-4-5' }, OWNER);
  assert.equal(s.anthropicModelChat, 'claude-haiku-4-5');
  assert.equal(s.anthropicModel, 'claude-opus-5');
  setSettings({ anthropicModelChat: 'claude-sonnet-5' }, OWNER);
});

/* ============ CE QUE ÇA COÛTE ============ */

test('un jeton relu du cache ne coûte pas un jeton neuf', () => {
  /*
   * C'est le seul chiffre du produit qui dit ce qu'il coûte. Compter les trois
   * sortes d'entrée ensemble ferait afficher presque dix fois la dépense réelle
   * sur une conversation bien mise en cache — et on conclurait que le cache n'a
   * rien changé.
   */
  usage.record('cout', 'claude-sonnet-5', 1_000_000, 0, 0, 0);
  const plein = usage.usageFor('cout').costUsd;
  assert.equal(plein, 2, 'un million de jetons Sonnet en entrée coûte 2 $');

  usage.record('cout2', 'claude-sonnet-5', 0, 0, 1_000_000, 0);
  const cache = usage.usageFor('cout2').costUsd;
  assert.equal(cache, 0.2, 'un million de jetons relus coûte un dixième');

  usage.record('cout3', 'claude-sonnet-5', 0, 0, 0, 1_000_000);
  assert.equal(usage.usageFor('cout3').costUsd, 2.5, 'écrire dans le cache coûte un quart de plus');
});

test('l’enveloppe compte tous les jetons, cache compris', () => {
  // Elle mesure ce qui a traversé le modèle, pas ce que ça a coûté : un jeton
  // relu est un jeton lu. Les deux questions sont séparées exprès.
  usage.record('env', 'claude-sonnet-5', 100, 50, 900, 40);
  const u = usage.usageFor('env');
  assert.equal(u.used, 1090);
  assert.equal(u.cacheLu, 900);
  assert.equal(u.cacheEcrit, 40);
});

/* ============ L'ASSEMBLAGE, QUI PORTE L'INVARIANT ============ */

test('deux points de reprise, sur ce qui ne bouge pas et sur ce qui tient la journée', () => {
  const r = chat.assemblerPrompt({ memory: 'LA MÉMOIRE STABLE', history: [
    { role: 'user', text: 'bonjour', ts: '2026-01-01T10:00:00Z' }
  ] });
  assert.equal(r.system.length, 2);
  assert.equal(r.system[0].text, chat.SYSTEM_PROMPT);
  assert.deepEqual(r.system[0].cache_control, { type: 'ephemeral' });
  assert.deepEqual(r.system[1].cache_control, { type: 'ephemeral' });
  // L'ordre de rendu est outils → système → messages : le bloc figé doit être
  // PREMIER, sinon il ne protège rien de ce qui le suit.
  assert.equal(r.system[1].text, 'LA MÉMOIRE STABLE');
});

test('les échos ne touchent jamais le système', () => {
  /*
   * C'est LA régression qui coûterait cher sans se voir : posés dans le
   * système, ils invalident à chaque phrase le cache de toute la conversation
   * qui suit — et on paierait en plus le quart de surcoût de l'écriture pour un
   * cache qui ne prend jamais.
   */
  const hist = [
    { role: 'user', text: 'bonjour', ts: '2026-01-01T10:00:00Z' },
    { role: 'pet', text: 'salut', ts: '2026-01-01T10:01:00Z' },
    { role: 'user', text: 'je dors mal en ce moment', ts: '2026-01-01T10:02:00Z' }
  ];
  const r = chat.assemblerPrompt({ memory: 'STABLE', echos: 'CE QUE TU AVAIS ÉCRIT', history: hist });
  assert.equal(JSON.stringify(r.system).includes('CE QUE TU AVAIS ÉCRIT'), false);

  // Ils sont dans le DERNIER tour, APRÈS le texte de la personne, qui porte le
  // point de reprise : ce qui est écrit en cache s'arrête au texte, et c'est
  // exactement ce que le tour suivant présentera.
  const dernier = r.messages[r.messages.length - 1];
  assert.equal(dernier.role, 'user');
  assert.match(dernier.content[0].text, /je dors mal/);
  assert.deepEqual(dernier.content[0].cache_control, { type: 'ephemeral' });
  assert.equal(dernier.content[1].text, 'CE QUE TU AVAIS ÉCRIT');
  assert.equal(dernier.content[1].cache_control, undefined);

  // Et le préfixe est intact : les tours d'avant sont identiques sans échos.
  const sans = chat.assemblerPrompt({ memory: 'STABLE', history: hist });
  assert.deepEqual(r.messages.slice(0, -1), sans.messages.slice(0, -1),
                   'les échos ont déteint sur les tours précédents');
});

test('ce que la requête N a écrit en cache est un préfixe exact de la requête N+1', () => {
  /*
   * LA GARDE QUI MANQUAIT. Le cache est relu là où une requête précédente a
   * écrit. Les échos posés DEVANT le texte faisaient écrire une entrée que le
   * tour suivant, qui rend ce message sans échos, ne présentait jamais : le fil
   * entier repartait plein tarif à chaque échange, sans qu'aucun test ne tombe.
   */
  const hist = [
    { role: 'user', text: 'bonjour', ts: '2026-01-01T10:00:00Z' },
    { role: 'pet', text: 'salut', ts: '2026-01-01T10:01:00Z' },
    { role: 'user', text: 'je dors mal en ce moment', ts: '2026-01-01T10:02:00Z' }
  ];
  const n = chat.assemblerPrompt({ memory: 'STABLE', echos: 'ÉCHOS DU TOUR N', history: hist });
  const n1 = chat.assemblerPrompt({ memory: 'STABLE', echos: 'ÉCHOS DU TOUR N+1', history: [
    ...hist,
    { role: 'pet', text: 'depuis quand ?', ts: '2026-01-01T10:03:00Z' },
    { role: 'user', text: 'une semaine', ts: '2026-01-01T10:04:00Z' }
  ] });
  // Ce qui est écrit en cache par N : tout, jusqu'au bloc qui porte le marqueur.
  const sansMarqueur = o => JSON.parse(JSON.stringify(o, (k, v) => k === 'cache_control' ? undefined : v));
  const ecrit = sansMarqueur(n.messages);
  const dernierBloc = ecrit.at(-1).content;
  dernierBloc.length = dernierBloc.findIndex(b => b.text === 'je dors mal en ce moment' || /je dors mal/.test(b.text)) + 1;
  const presente = sansMarqueur(n1.messages).slice(0, ecrit.length);
  presente.at(-1).content = presente.at(-1).content.slice(0, dernierBloc.length);
  assert.deepEqual(presente, ecrit, 'le tour N+1 ne présente pas ce que le tour N a écrit : le fil ne sera jamais relu');
});

test('au plus quatre points de reprise, l’automatique compris', () => {
  // L'API en accepte quatre. Deux explicites ici, plus le `cache_control`
  // automatique de la requête : on en utilise trois, et dépasser serait un 400.
  const r = chat.assemblerPrompt({ memory: 'M', echos: 'E', history: [
    { role: 'user', text: 'a', ts: '2026-01-01T10:00:00Z' }
  ] });
  const marqueurs = JSON.stringify(r).split('"cache_control"').length - 1;
  assert.ok(marqueurs <= 3, `${marqueurs} marqueurs explicites : l’automatique en prend un quatrième`);
});

/* ============ LA LECTURE EN LOT ============ */

test('la requête part par un seul chemin, quel que soit le tuyau', async () => {
  /*
   * Elle part maintenant tout de suite ou en lot à moitié prix. Deux copies du
   * même prompt finissent toujours par diverger, et la divergence se lirait dans
   * une lecture légèrement différente selon le chemin — ce que personne ne
   * saurait expliquer.
   */
  const lecture = await import('../server/lecture.js');
  const r = lecture.requeteLecture({ etendue: 400, texte: 'le corpus' },
                                   { anthropicModel: 'claude-opus-5' });
  assert.equal(r.model, 'claude-opus-5');
  assert.ok(r.tools?.length, 'la lecture répond par un outil, ou elle ne répond pas');
  assert.deepEqual(r.tool_choice, { type: 'tool', name: 'rendre_lecture' });
  assert.equal(r.output_config.effort, 'high');
  // `fallbacks` est REFUSÉ par l'API des lots : un paramètre accepté ici et
  // rejeté là ferait échouer le lot entier sur une validation.
  assert.equal('fallbacks' in r, false);
  assert.equal('betas' in r, false);
  // Le corpus est un bloc de contenu depuis qu'il porte une marque de cache :
  // c'est le seul moyen d'en poser une, et le texte lui-même n'a pas bougé.
  assert.match(r.messages[0].content[0].text, /le corpus/);
});

test('le lot est un réglage, et il est allumé par défaut', () => {
  // La lecture de fond tourne toute seule une fois par semaine, l'écran garde
  // la précédente affichée : personne ne la regarde apparaître.
  assert.equal(DEFAULT_SETTINGS.lectureEnLot, true);
  assert.equal(DEFAULT_SETTINGS.lectureLot, null);
  assert.equal(DEFAULT_SETTINGS.lectureLotErreur, null);
});

test('un lot en cours empêche d’en lancer un deuxième', async () => {
  // Sans ce garde, l'écran affiche « relire » pendant qu'une lecture est déjà
  // partie, et cliquer en lancerait une deuxième — payante, sur le même corpus,
  // pour le même résultat.
  setSettings({ lectureLot: { id: 'msgbatch_x', depuis: new Date().toISOString() } }, OWNER);
  const e = await api.routes['GET /api/lecture']({ userId: OWNER });
  assert.equal(e.enLot, true);
  assert.equal(e.arelire, false, 'la relance automatique repartirait sur un lot déjà en cours');
  setSettings({ lectureLot: null }, OWNER);
});

/* ============ CE QUI CASSAIT LE CACHE SANS BRUIT ============ */

test('marquer un motif entre deux messages ne change pas la partie stable', async () => {
  /*
   * Le bloc des motifs est dans le préfixe mis en cache. Il portait
   * « (reconnu N fois) » et suivait l'ordre par fréquence : chaque
   * `marquer_motif` en cours de conversation changeait le texte, parfois
   * l'ordre, et toute la conversation repartait plein tarif au message suivant.
   */
  const { addMotif, marquerMotif } = await import('../server/db.js');
  setSettings({ memoryDays: 14 }, OWNER);
  const a = addMotif({ nom: 'minimiser', mecanisme: "dire « c'est rien » juste après avoir décrit une crise", userId: OWNER });
  const b = addMotif({ nom: 'anticiper', mecanisme: 'la peur monte la veille d’une sortie, pas pendant', userId: OWNER });
  const id = addMessage({ ts: '2026-03-01T20:00:00.000Z', date: '2026-03-01', source: 'web', role: 'user',
                          text: 'demain je dois sortir et déjà ça serre', userId: OWNER });
  // b passe devant a par le nombre de vues : l'ordre en base change, le bloc non.
  marquerMotif(b.id, id, OWNER);
  const avant = api.recentMemory('2026-03-01', OWNER, 'rien de spécial').stable;
  marquerMotif(b.id, id + 1000, OWNER);
  marquerMotif(b.id, id + 1001, OWNER);
  marquerMotif(a.id, id + 1002, OWNER);
  const apres = api.recentMemory('2026-03-01', OWNER, 'rien de spécial').stable;

  assert.ok(avant.includes(`[${a.id}] minimiser`), 'le motif est bien transmis');
  assert.equal(avant.includes('reconnu'), false, 'le compte des vues est écrit dans le préfixe en cache');
  assert.equal(apres, avant, 'marquer un motif a changé la partie stable : la conversation repart plein tarif');
  assert.ok(avant.indexOf(`[${a.id}]`) < avant.indexOf(`[${b.id}]`), 'les motifs ne sont pas dans un ordre stable');
});

test('le fil transmis garde le même début pendant plusieurs échanges', async () => {
  /*
   * « Les 25 derniers messages » glissait de deux à chaque échange : passé le
   * vingt-sixième, le premier message envoyé n'était plus jamais le même, et
   * le fil entier repartait plein tarif à chaque tour. La fenêtre est ancrée :
   * son début ne bouge que par paliers.
   */
  const { filAncre, FIL_PAS } = await import('../server/db.js');
  const U = 'fil-ancre';
  const t = i => `2026-04-01T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`;
  let n = 0;
  const echange = () => {
    addMessage({ ts: t(n++), date: '2026-04-01', source: 'web', role: 'user', text: `moi ${n}`, userId: U });
    addMessage({ ts: t(n++), date: '2026-04-01', source: 'web', role: 'pet', text: `lui ${n}`, userId: U });
  };
  for (let i = 0; i < 12; i++) echange();          // 24 messages : tout tient
  const f0 = filAncre(24, U);
  assert.equal(f0.length, 24);
  assert.equal(f0[0].role, 'user', 'c’est la personne qui ouvre');

  const debuts = new Set();
  for (let i = 0; i < FIL_PAS / 2 - 1; i++) {      // sept échanges de plus : 26 à 38 messages
    echange();
    const f = filAncre(24, U);
    debuts.add(f[0].id);
    assert.ok(f.length >= 24 && f.length < 24 + FIL_PAS, `${f.length} messages transmis`);
    assert.equal(f[0].role, 'user');
  }
  assert.equal(debuts.size, 1, 'le début de la fenêtre a bougé : le cache du fil ne prend plus');
  // Et au palier suivant, il avance d'un coup, puis se stabilise de nouveau.
  echange();
  const f1 = filAncre(24, U);
  assert.notEqual(f1[0].id, f0[0].id, 'le palier n’avance jamais : la fenêtre grandirait sans fin');
  assert.equal(f1.length, 24);
  // La fenêtre ne perd rien de récent : le dernier message est toujours là.
  assert.equal(f1.at(-1).text, `lui ${n}`);
});

test('la jauge dit aussi ce que les jetons valent au tarif plein', () => {
  usage.record('equiv', 'claude-sonnet-5', 100_000, 10_000, 1_000_000, 40_000);
  const u = usage.usageFor('equiv');
  assert.equal(u.used, 1_150_000, 'ce qui a traversé le modèle, cache compris');
  assert.equal(u.equivalent, 100_000 + 10_000 + 100_000 + 50_000, 'relu à un dixième, écrit à cinq quarts');
  assert.ok(u.equivalent < u.used / 4, 'l’équivalent doit rendre visible l’effet du cache');
});
