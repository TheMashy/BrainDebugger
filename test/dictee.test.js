/**
 * LA DICTÉE : LA VOIX DEVIENT DU TEXTE SUR LE PC, ET NE VA NULLE PART AILLEURS.
 *
 * Demandé : intégrer le speech-to-text local de Handy pour écrire dans
 * BrainDebugger. Le moteur tourne dans Machi Tool (Parakeet V3, en local) ; la
 * page tient le micro et lui envoie un WAV 16 kHz par 127.0.0.1.
 *
 * Ce fichier tient : un WAV que Python lit sans bibliothèque, un texte posé
 * au curseur avec des espaces justes, un son qui ne va QU'À Machi Tool (jamais
 * au serveur du site, jamais à la dictée du navigateur qui l'envoie à Google),
 * et une dictée qui ne part jamais toute seule au compagnon.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FREQ, MAX_S, wavDe, reechantillonner, recoller, inserer } from '../web/dictee.js';

const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
const glue = app.slice(app.indexOf('LA DICTÉE, CÔTÉ PAGE'), app.indexOf('ENVOYER — au clavier'));

test('le WAV est celui que Machi Tool lit : PCM 16 bits, mono, 16 kHz', () => {
  const buf = wavDe([new Float32Array([0, 0.5, -0.5, 1, -1])]);
  const v = new DataView(buf);
  const txt = (o, n) => String.fromCharCode(...new Uint8Array(buf, o, n));
  assert.equal(txt(0, 4), 'RIFF');
  assert.equal(txt(8, 4), 'WAVE');
  assert.equal(v.getUint16(20, true), 1, 'PCM');
  assert.equal(v.getUint16(22, true), 1, 'mono');
  assert.equal(v.getUint32(24, true), FREQ);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 10, 'cinq échantillons = dix octets');
  assert.equal(buf.byteLength, 44 + 10);
  assert.deepEqual([44, 46, 48, 50, 52].map(o => v.getInt16(o, true)), [0, 16383, -16384, 32767, -32768]);
});

test('un son qui sature est écrêté, pas replié', () => {
  const v = new DataView(wavDe([new Float32Array([3, -3, NaN])]));
  assert.deepEqual([44, 46, 48].map(o => v.getInt16(o, true)), [32767, -32768, 0]);
});

test('capté à 48 kHz, ramené à 16 kHz', () => {
  const s = new Float32Array(48000).fill(0.25);
  const r = reechantillonner(s, 48000);
  assert.equal(r.length, 16000);
  assert.ok(Math.abs(r[100] - 0.25) < 1e-6);
  assert.equal(reechantillonner(s, FREQ), s, 'déjà à 16 kHz : rien à faire');
});

test('les morceaux du micro se recollent dans l’ordre', () => {
  assert.deepEqual([...recoller([new Float32Array([1, 2]), new Float32Array([3])])], [1, 2, 3]);
});

test('le texte se pose AU CURSEUR, avec des espaces justes', () => {
  assert.deepEqual(inserer('Ce soir', 7, 7, 'je suis rentré'), { valeur: 'Ce soir je suis rentré', curseur: 22 });
  assert.equal(inserer('Ce soir  tard', 8, 8, 'très').valeur, 'Ce soir très tard');
  assert.equal(inserer('', 0, 0, '  bonjour  ').valeur, 'bonjour');
  assert.equal(inserer('Fin.', 3, 3, 'du film').valeur, 'Fin du film.', 'pas d’espace avant la ponctuation');
  assert.equal(inserer('abc XYZ def', 4, 7, 'remplacé').valeur, 'abc remplacé def', 'une sélection est remplacée');
  assert.deepEqual(inserer('rien', 4, 4, '   '), { valeur: 'rien', curseur: 4 }, 'rien entendu : rien ne bouge');
});

test('le son ne va QU’À Machi Tool, sur 127.0.0.1', () => {
  // L'unique envoi du WAV est vers l'URL de Machi Tool, jamais vers une route du site.
  const envois = [...glue.matchAll(/versMachiTool\(([^,]+),/g)].map(m => m[1].trim());
  assert.ok(envois.length >= 3);
  for (const u of envois) assert.match(u, /^(mt|d\.mt)\.url \+ '\/dictee/, `envoi vers ${u}`);
  assert.doesNotMatch(glue, /api\(['"]\/api\/[^'"]*dict/, 'le son part au serveur du site');
  assert.match(app, /'GET \/api\/passerelle\/local'|passerelle\/local/, 'l’URL vient de la passerelle locale');
  assert.doesNotMatch(glue, /SpeechRecognition|webkitSpeechRecognition/,
    'la dictée du navigateur envoie la voix à Google');
});

test('la dictée ne part jamais toute seule au compagnon', () => {
  assert.doesNotMatch(glue, /\bsend\(/, 'le texte dicté serait envoyé sans être relu');
  assert.match(glue, /inserer\(input\.value, input\.selectionStart, input\.selectionEnd, j\.texte\)/);
});

test('avant 456 Mo, on demande — et on dit que la voix ne sort pas du PC', () => {
  assert.match(glue, /if \(!confirm\(question\)\) return;/);
  assert.match(glue, /Mo\)\. `\s*\+ 'Il reste sur ton PC, et ta voix n’en sort jamais/);
  assert.match(glue, /reprendre le modèle de dictée de Handy/);
});

test('le micro s’éteint dès qu’on s’arrête, et Échap annule sans rien envoyer', () => {
  assert.match(glue, /getTracks\(\)\.forEach\(t => t\.stop\(\)\)/);
  assert.match(glue, /e\.key === 'Escape' && DICTEE_EN_COURS\) \{ e\.preventDefault\(\); finirDictee\(\{ annuler: true \}\)/);
  const i = glue.indexOf('if (annuler)');
  assert.ok(i > 0 && i < glue.indexOf("'Content-Type': 'audio/wav'"), 'l’annulation doit sortir avant l’envoi');
  assert.equal(MAX_S, 300);
});

test('trop lent et injoignable ne se disent pas pareil — et l’injoignable est relancé', () => {
  assert.match(glue, /versMachiTool\(mt\.url \+ '\/dictee', \{ headers: h \}, 10000\)/,
    'quatre secondes : un Machi Tool occupé passait pour éteint');
  assert.match(glue, /err\?\.name === 'AbortError'/);
  const i = glue.indexOf("err?.name === 'AbortError'");
  assert.ok(glue.indexOf('lancerApp();', i) > i, 'l’injoignable doit être relancé, comme pour la synchro');
});
