/**
 * LA VOIX KOKORO : du texte français jusqu'au WAV.
 *
 * Les pièces pures se testent partout : lecture de l'archive des voix,
 * mélange des styles, jetons, découpage en propositions, en-tête WAV. La
 * phonétisation ne se teste que si espeak-ng est installé (dépendance
 * optionnelle), et la synthèse complète que si le modèle est là
 * (`npm run voix:installer`, ou BD_KOKORO vers un dossier qui le contient).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  lireNpz, lireNpy, styleDe, versJetons, propositions, normaliserPhonemes, enWav,
  phonemes, synthetiser, manque, PRESETS, PRESET_DEFAUT, VOIX_UTILES, VOCAB, TAUX
} from '../server/kokoro.js';

/** Un .npy float32 de forme (lignes, 1, 256). */
function npy(lignes, f) {
  let entete = `{'descr': '<f4', 'fortran_order': False, 'shape': (${lignes}, 1, 256), }`;
  while ((10 + entete.length + 1) % 64) entete += ' ';
  entete += '\n';
  const h = Buffer.alloc(10);
  h.write('\x93NUMPY', 0, 'latin1'); h[6] = 1; h[7] = 0; h.writeUInt16LE(entete.length, 8);
  const d = new Float32Array(lignes * 256);
  for (let l = 0; l < lignes; l++) for (let i = 0; i < 256; i++) d[l * 256 + i] = f(l, i);
  return Buffer.concat([h, Buffer.from(entete, 'latin1'), Buffer.from(d.buffer)]);
}

/** Une archive zip « stockée » (sans compression), comme np.savez. */
function zip(fichiers) {
  const locaux = [], centraux = [];
  let decalage = 0;
  for (const [nom, donnees] of Object.entries(fichiers)) {
    const n = Buffer.from(nom);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt32LE(donnees.length, 18);
    l.writeUInt32LE(donnees.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt32LE(donnees.length, 20);
    c.writeUInt32LE(donnees.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(decalage, 42);
    locaux.push(l, n, donnees); centraux.push(c, n);
    decalage += 30 + n.length + donnees.length;
  }
  const cd = Buffer.concat(centraux);
  const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(fichiers).length, 8); fin.writeUInt16LE(Object.keys(fichiers).length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, cd, fin]);
}

test('l’archive des voix se lit sans bibliothèque, et seulement ce qu’on demande', () => {
  const arch = zip({ 'bm_george.npy': npy(4, (l, i) => l + i / 1000), 'ff_siwis.npy': npy(4, () => -1),
                     'af_heart.npy': npy(4, () => 9) });
  const v = lireNpz(arch, new Set(['bm_george', 'ff_siwis']));
  assert.deepEqual([...v.keys()].sort(), ['bm_george', 'ff_siwis']);
  assert.equal(v.get('bm_george').length, 4 * 256);
  assert.ok(Math.abs(v.get('bm_george')[2 * 256 + 5] - 2.005) < 1e-6);
  assert.throws(() => lireNpy(Buffer.from('pas un npy')), /numpy/);
});

test('le style : la ligne de la longueur de phrase, et le mélange pondéré', () => {
  const v = new Map([['a', new Float32Array(510 * 256).map((_, k) => Math.floor(k / 256))],
                     ['b', new Float32Array(510 * 256).fill(100)]]);
  // 10 jetons → ligne 9
  assert.equal(styleDe(v, { a: 1 }, 10)[0], 9);
  // 70 % de a (ligne 9) + 30 % de b (100) = 6.3 + 30
  assert.ok(Math.abs(styleDe(v, { a: 0.7, b: 0.3 }, 10)[0] - 36.3) < 1e-4);
  // au-delà de 510 jetons, la dernière ligne
  assert.equal(styleDe(v, { a: 1 }, 9999)[0], 509);
  assert.throws(() => styleDe(v, { zz: 1 }, 5), /absente/);
});

test('les préréglages n’utilisent que des voix qui existent, et Jarvis est le défaut', () => {
  assert.equal(PRESET_DEFAUT, 'jarvis');
  for (const v of VOIX_UTILES) assert.match(v, /^(bm|ff)_[a-z]+$/);
  assert.ok(PRESETS.jarvis.melange.bm_george > PRESETS.jarvis.melange.ff_siwis, 'un homme d’abord');
});

test('les jetons : chaque symbole connu, rien d’inventé', () => {
  assert.deepEqual(versJetons('bɔ̃ʒˈuʁ'), ['b', 'ɔ', '̃', 'ʒ', 'ˈ', 'u', 'ʁ'].map(c => VOCAB[c]));
  assert.deepEqual(versJetons('a☃b'), [VOCAB.a, VOCAB.b], 'un symbole hors vocabulaire est ignoré');
  assert.equal(normaliserPhonemes('t^ʃa^ɪ- və'), 'ʧI və');
});

test('les propositions gardent leur ponctuation, d’où viennent les pauses', () => {
  assert.deepEqual(propositions('Bonsoir, monsieur. Ça va ?'),
    [{ mots: 'Bonsoir', ponct: ',' }, { mots: 'monsieur', ponct: '.' }, { mots: 'Ça va', ponct: '?' }]);
  assert.deepEqual(propositions('Attendez... voilà'), [{ mots: 'Attendez', ponct: '…' }, { mots: 'voilà', ponct: '' }]);
});

test('le WAV : 24 kHz, 16 bits, mono, sans saturation', () => {
  const w = enWav(Float32Array.from([0, 0.5, -2, 2]));
  assert.equal(w.toString('latin1', 0, 4), 'RIFF');
  assert.equal(w.readUInt32LE(24), TAUX);
  assert.equal(w.readUInt16LE(34), 16);
  assert.equal(w.readUInt32LE(40), 8);
  assert.equal(w.readInt16LE(48), -32767, 'écrêté plutôt que replié');
});

const aEspeak = (() => { try { createRequire(import.meta.url).resolve('espeak-ng'); return true; } catch { return false; } })();

test('le français se phonétise en français, ponctuation comprise', { skip: !aEspeak && 'espeak-ng non installé' }, async () => {
  const p = await phonemes("Bonsoir, monsieur. Voulez-vous m'en parler ?");
  assert.match(p, /^bɔ̃swˈaʁ, məsjˈø\./, p);
  assert.ok(p.includes('ʁ'), 'le r français');
  assert.ok(p.endsWith('?'), p);
  assert.equal(p.includes('-'), false);
});

test('une phrase devient du son', { skip: manque().length > 0 && `voix non installée : ${manque().join(', ')}` }, async () => {
  const pcm = await synthetiser('Bonsoir, monsieur.', { preset: 'jarvis' });
  assert.ok(pcm.length > TAUX * 0.5, 'au moins une demi-seconde');
  let crete = 0;
  for (const x of pcm) crete = Math.max(crete, Math.abs(x));
  assert.ok(crete > 0.05, 'pas du silence');
});
