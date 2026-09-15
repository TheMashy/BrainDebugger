/*
 * IL RÉPOND À LA QUESTION D'UN GESTE, ET LA CONVERSATION CONTINUE.
 *
 * Toucher l'échelle posait un relevé et s'arrêtait là : le compagnon venait de
 * demander « comment tu te sens ? », la réponse était en base, et il n'en
 * savait rien. Il fallait la lui RÉÉCRIRE au clavier pour qu'il enchaîne — on
 * répondait donc deux fois à la même question, une fois du doigt et une fois à
 * la main. Le geste n'était pas une réponse, c'était une case à cocher avant
 * de répondre.
 *
 * Ces tests tiennent les trois choses qui peuvent mal tourner : le relevé se
 * pose bien SUR LA QUESTION, le même instant n'est pas relevé DEUX FOIS, et un
 * refus n'écrit RIEN — ni bulle orpheline, ni appel au modèle payé pour rien.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-ench-')), 'test.db');
/*
 * AUCUN APPEL PAYANT. On teste le TUYAU, pas le modèle : sans clé, `reply`
 * retombe sur les réponses hors-ligne, ce qui suffit — le compagnon répond
 * quelque chose, et c'est tout ce que ces tests regardent. On vide la variable
 * plutôt que de compter sur son absence : la suite peut tourner sur une
 * machine où elle est posée, et chaque tour deviendrait alors un appel réel.
 */
process.env.ANTHROPIC_API_KEY = '';
const { OWNER, addMessage, recentMessages, relevesDuJour, relevesDeToi } = await import('../server/db.js');
const { DU_COMPAGNON } = await import('../web/ressenti.js');
const { streamMessage, ressentisDuFil } = await import('../server/api.js');

const AUJ = new Date().toISOString().slice(0, 10);
const ecrire = (role, text) =>
  addMessage({ ts: new Date().toISOString(), date: AUJ, source: 'web', role, text, userId: OWNER });

/** Rejoue un tour de conversation et rend les événements diffusés. */
async function tour(body) {
  const evs = [];
  await streamMessage(body, (ev, data) => evs.push({ ev, data }), OWNER);
  return { evs, de: n => evs.filter(e => e.ev === n) };
}

test('le geste fait parler le compagnon', async () => {
  ecrire('user', 'je viens de rentrer des courses et c’était vraiment dur');
  const q = ecrire(DU_COMPAGNON, 'Comment tu te sens, là, maintenant ?');

  const { de } = await tour({ ressenti: { messageId: q, valeur: 3 } });

  assert.equal(de('error').length, 0, 'le relevé aurait dû être accepté');
  assert.equal(de('done').length, 1, 'sans réponse, le geste n’est qu’une case cochée');
  const fil = recentMessages(10, OWNER);
  assert.equal(fil.at(-1).role, DU_COMPAGNON, 'le compagnon a le dernier mot');
  assert.equal(fil.at(-2).text, '3/10', 'le chiffre est le tour de parole');
});

test('le relevé se pose SUR LA QUESTION, pas sur la réponse', async () => {
  /* C'est ce qui éteint l'échelle sous la bulle : accroché ailleurs, elle
     resterait cliquable et le même instant se relèverait deux fois. */
  const q = ecrire(DU_COMPAGNON, 'Tu te sens comment, là ?');
  await tour({ ressenti: { messageId: q, valeur: 8 } });
  assert.deepEqual(relevesDeToi([q], OWNER).map(r => r.valeur), [8]);
});

test('UN SEUL relevé pour un seul geste', async () => {
  /* `noterNoteDite` lit « 3/10 » dans une phrase et en fait un relevé — c'est
     exactement ce qu'on vient de poser à la main. Le laisser tourner ici
     relèverait le même geste deux fois : deux points dans la journée, et deux
     unités mangées au budget qui décide quand il peut redemander. */
  const avant = relevesDuJour(AUJ, OWNER).length;
  const q = ecrire(DU_COMPAGNON, 'Ça donne quoi là, maintenant ?');
  await tour({ ressenti: { messageId: q, valeur: 5 } });
  assert.equal(relevesDuJour(AUJ, OWNER).length, avant + 1);
});

test('une question qui n’en est pas une : rien n’est écrit', async () => {
  /* Le refus doit tomber AVANT le message et AVANT l'appel au modèle :
     sinon le fil garde une bulle « 6/10 » à laquelle personne ne répond, et
     on a payé pour ça. */
  const pas = ecrire(DU_COMPAGNON, 'D’accord, je note. On en reparle demain.');
  const combien = recentMessages(80, OWNER).length;

  const { de } = await tour({ ressenti: { messageId: pas, valeur: 6 } });

  assert.equal(de('error').length, 1);
  assert.match(de('error')[0].data.error, /ne demande pas/);
  assert.equal(de('done').length, 0, 'aucune réponse ne doit être générée');
  assert.equal(recentMessages(80, OWNER).length, combien, 'aucune bulle orpheline');
  assert.equal(relevesDeToi([pas], OWNER).length, 0);
});

test('les relevés repartent avec le fil, à l’aller comme au retour', async () => {
  /* La page fait `new Map(data.ressentis ?? [])` sur ces deux événements :
     sans le champ, elle reconstruisait une table VIDE à chaque échange et
     toutes les échelles déjà répondues disparaissaient de l'écran — y compris
     celle qu'on venait de toucher. */
  const q = ecrire(DU_COMPAGNON, 'Où tu en es, là ?');
  const { de } = await tour({ ressenti: { messageId: q, valeur: 4 } });

  for (const nom of ['user', 'done']) {
    const r = de(nom)[0]?.data?.ressentis;
    assert.ok(Array.isArray(r) && r.length, `l’événement « ${nom} » n’emporte aucun relevé`);
    assert.ok(r.some(x => Number(x.message_id) === Number(q) && Number(x.valeur) === 4),
      `le relevé qu’on vient de poser manque dans « ${nom} »`);
  }
});

test('un message écrit normalement garde son relevé lu dans le texte', async () => {
  /* L'autre moitié du garde-fou : on n'a pas coupé `noterNoteDite` pour tout
     le monde, seulement pour le geste qui pose déjà son relevé. */
  const avant = relevesDuJour(AUJ, OWNER).length;
  await tour({ text: 'je dirais 7/10 ce soir, ça va mieux qu’hier' });
  assert.equal(relevesDuJour(AUJ, OWNER).length, avant + 1,
    'une note écrite en toutes lettres reste un relevé');
});
