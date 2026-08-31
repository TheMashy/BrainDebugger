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

  // Ils sont dans le DERNIER tour, et DEVANT le texte de la personne : c'est du
  // contexte pour lire ce qu'elle vient de dire, pas une remarque après coup.
  const dernier = r.messages[r.messages.length - 1];
  assert.equal(dernier.role, 'user');
  assert.equal(dernier.content[0].text, 'CE QUE TU AVAIS ÉCRIT');
  assert.match(dernier.content[1].text, /je dors mal/);

  // Et le préfixe est intact : les tours d'avant sont identiques sans échos.
  const sans = chat.assemblerPrompt({ memory: 'STABLE', history: hist });
  assert.deepEqual(r.messages.slice(0, -1), sans.messages.slice(0, -1),
                   'les échos ont déteint sur les tours précédents');
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
