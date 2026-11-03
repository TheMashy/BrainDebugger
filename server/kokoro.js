/**
 * LA VOIX KOKORO, CALCULÉE SUR CETTE MACHINE.
 *
 * Kokoro est un petit modèle de synthèse vocale (82 M de paramètres) qui
 * tourne sans GPU. Tout se passe ici : le texte ne sort pas, il n'y a ni clé
 * ni compte. Seuls le modèle et les voix se téléchargent, une fois, avec
 * `npm run voix:installer`.
 *
 * CE QUE KOKORO N'A PAS : UNE VOIX D'HOMME FRANÇAISE. Son jeu complet compte
 * une seule voix française, `ff_siwis`, une voix de femme. Pour un compagnon
 * à la Jarvis — grave, posé —, on prend le TIMBRE d'une voix d'homme
 * britannique et l'INTONATION de la voix française (voir PRESETS), sur un
 * texte phonétisé en français. C'est un personnage, pas l'imitation de qui
 * que ce soit, et ça se juge à l'oreille — d'où plusieurs préréglages.
 *
 * La chaîne :
 *   texte → phonèmes français (espeak-ng compilé en WebAssembly)
 *         → jetons (le vocabulaire de Kokoro, embarqué ci-dessous)
 *         → modèle ONNX + vecteur de style de la voix → PCM 24 kHz → WAV.
 *
 * Dépendances OPTIONNELLES, chargées à la demande : `espeak-ng`, et
 * `onnxruntime-node` (natif, rapide) ou à défaut `onnxruntime-web`
 * (WebAssembly). Absentes, la voix Kokoro est simplement indisponible et
 * l'application garde la voix du navigateur ou les blips.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DOSSIER = process.env.BD_KOKORO ?? join(ROOT, 'data', 'kokoro');
// Le modèle complet (fp32) : 3,5 fois plus rapide sur processeur que la version
// quantifiée int8, mesuré — l'int8 est plus léger, pas plus vif.
export const FICHIER_MODELE = 'kokoro-v1.0.onnx';
export const FICHIER_VOIX = 'voices-v1.0.bin';
export const TAUX = 24000;
/** Au-delà, le modèle ne prend plus : on découpe avant. */
export const MAX_JETONS = 510;

/** Le vocabulaire phonétique de Kokoro v1.0 : un symbole, un jeton. */
export const VOCAB = {";":1,":":2,",":3,".":4,"!":5,"?":6,"—":9,"…":10,"\"":11,"(":12,")":13,"“":14,"”":15," ":16,"̃":17,"ʣ":18,"ʥ":19,"ʦ":20,"ʨ":21,"ᵝ":22,"ꭧ":23,"A":24,"I":25,"O":31,"Q":33,"S":35,"T":36,"W":39,"Y":41,"ᵊ":42,"a":43,"b":44,"c":45,"d":46,"e":47,"f":48,"h":50,"i":51,"j":52,"k":53,"l":54,"m":55,"n":56,"o":57,"p":58,"q":59,"r":60,"s":61,"t":62,"u":63,"v":64,"w":65,"x":66,"y":67,"z":68,"ɑ":69,"ɐ":70,"ɒ":71,"æ":72,"β":75,"ɔ":76,"ɕ":77,"ç":78,"ɖ":80,"ð":81,"ʤ":82,"ə":83,"ɚ":85,"ɛ":86,"ɜ":87,"ɟ":90,"ɡ":92,"ɥ":99,"ɨ":101,"ɪ":102,"ʝ":103,"ɯ":110,"ɰ":111,"ŋ":112,"ɳ":113,"ɲ":114,"ɴ":115,"ø":116,"ɸ":118,"θ":119,"œ":120,"ɹ":123,"ɾ":125,"ɻ":126,"ʁ":128,"ɽ":129,"ʂ":130,"ʃ":131,"ʈ":132,"ʧ":133,"ʊ":135,"ʋ":136,"ʌ":138,"ɣ":139,"ɤ":140,"χ":142,"ʎ":143,"ʒ":147,"ʔ":148,"ˈ":156,"ˌ":157,"ː":158,"ʰ":162,"ʲ":164,"↓":169,"→":171,"↗":172,"↘":173,"ᵻ":177};

/*
 * LES PRÉRÉGLAGES.
 *
 * LE STYLE D'UNE VOIX A DEUX MOITIÉS, et c'est ce qui permet de lui ôter son
 * accent. Dans Kokoro, les 128 premières valeurs vont au DÉCODEUR — le
 * timbre, le grain de la voix — et les 128 dernières au PRÉDICTEUR — les
 * durées et la mélodie de la phrase, c'est-à-dire l'intonation. L'accent
 * britannique de George tenait surtout à cette mélodie : on garde donc son
 * timbre d'homme et on lui donne la prosodie de la voix française.
 *
 * `timbre` et `prosodie` sont deux mélanges pondérés. `grave` abaisse la voix
 * après coup (0.85 ≈ deux tons et demi plus bas) sans ralentir le débit : on
 * synthétise plus vite, puis on étire. C'est aussi ce qui rend masculine la
 * seule voix vraiment française du modèle, qui est une voix de femme.
 */
export const PRESETS = {
  'jarvis':          { nom: 'Jarvis — timbre de George, intonation française',
                       timbre: { bm_george: 0.8, ff_siwis: 0.2 }, prosodie: { ff_siwis: 1 }, debit: 0.95 },
  'jarvis-grave':    { nom: 'Jarvis grave — idem, un ton plus bas',
                       timbre: { bm_george: 0.8, ff_siwis: 0.2 }, prosodie: { ff_siwis: 1 }, grave: 0.92, debit: 0.95 },
  'jarvis-lewis':    { nom: 'Jarvis profond — timbre de Lewis, intonation française',
                       timbre: { bm_lewis: 0.8, ff_siwis: 0.2 }, prosodie: { ff_siwis: 1 }, debit: 0.95 },
  'siwis-grave':     { nom: 'Voix française abaissée — aucun accent, plus synthétique',
                       timbre: { ff_siwis: 1 }, prosodie: { ff_siwis: 1 }, grave: 0.8, debit: 0.95 },
  'jarvis-anglais':  { nom: 'George d’origine — accent britannique',
                       timbre: { bm_george: 1 }, prosodie: { bm_george: 1 }, debit: 0.95 },
  'siwis':           { nom: 'Siwis — la voix française du modèle (femme)',
                       timbre: { ff_siwis: 1 }, prosodie: { ff_siwis: 1 }, debit: 1 },
};
export const PRESET_DEFAUT = 'jarvis';
export const VOIX_UTILES = [...new Set(Object.values(PRESETS)
  .flatMap(p => [...Object.keys(p.timbre), ...Object.keys(p.prosodie)]))];

/* ---------------- les voix : une archive .npz, lue à la main ---------------- */

/**
 * Lit l'archive des voix (un .npz : un zip de tableaux numpy) sans bibliothèque.
 * Chaque voix est un tableau float32 de forme (510, 1, 256) : une ligne de
 * style par longueur de phrase.
 * @param {Buffer} buf
 * @param {Set<string>|null} garder  les voix à extraire (toutes si null)
 * @returns {Map<string, Float32Array>}
 */
export function lireNpz(buf, garder = null) {
  const voix = new Map();
  // Fin du répertoire central : signature 0x06054b50, cherchée depuis la fin.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('archive des voix illisible');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let k = 0; k < n; k++) {
    const methode = buf.readUInt16LE(p + 10);
    const taille = buf.readUInt32LE(p + 20);
    const lNom = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lCom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nom = buf.toString('utf8', p + 46, p + 46 + lNom).replace(/\.npy$/, '');
    p += 46 + lNom + lExtra + lCom;
    if (garder && !garder.has(nom)) continue;
    const debut = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const brut = buf.subarray(debut, debut + taille);
    const npy = methode === 0 ? brut : inflateRawSync(brut);
    voix.set(nom, lireNpy(npy));
  }
  return voix;
}

/** Un .npy float32 petit-boutiste : en-tête, puis les données à plat. */
export function lireNpy(npy) {
  if (npy.toString('latin1', 1, 6) !== 'NUMPY') throw new Error('tableau numpy invalide');
  const v = npy[6];
  const lEntete = v === 1 ? npy.readUInt16LE(8) : npy.readUInt32LE(8);
  const debut = (v === 1 ? 10 : 12) + lEntete;
  const entete = npy.toString('latin1', v === 1 ? 10 : 12, debut);
  if (!/'descr':\s*'<f4'/.test(entete)) throw new Error(`type non pris en charge : ${entete}`);
  const octets = npy.subarray(debut);
  // Copie : les données d'un Buffer ne sont pas forcément alignées sur 4 octets.
  return new Float32Array(octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.length));
}

/** Le mélange pondéré de quelques voix, sur une plage [debut, fin) du style. */
function melanger(voix, melange, ligne, style, debut, fin) {
  const total = Object.values(melange).reduce((a, b) => a + b, 0) || 1;
  for (const [nom, poids] of Object.entries(melange)) {
    const v = voix.get(nom);
    if (!v) throw new Error(`voix absente : ${nom}`);
    for (let i = debut; i < fin; i++) style[i] += v[ligne * 256 + i] * (poids / total);
  }
}

/**
 * Le vecteur de style d'un préréglage pour une phrase de `n` jetons : la
 * ligne n-1 de chaque voix, le timbre (0–127) et la prosodie (128–255)
 * mêlés séparément.
 */
export function styleDe(voix, preset, n) {
  const ligne = Math.max(0, Math.min(n, MAX_JETONS) - 1);
  const style = new Float32Array(256);
  melanger(voix, preset.timbre, ligne, style, 0, 128);
  melanger(voix, preset.prosodie, ligne, style, 128, 256);
  return style;
}

/**
 * Abaisse une voix sans la ralentir, à appliquer à un son synthétisé
 * `1/facteur` fois plus vite : on étire le signal d'autant (interpolation
 * linéaire), ce qui baisse la hauteur et rend sa durée d'origine.
 */
export function abaisser(pcm, facteur) {
  if (!(facteur > 0 && facteur < 1)) return pcm;
  const n = Math.floor(pcm.length / facteur);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * facteur, k = Math.floor(x), f = x - k;
    out[i] = (pcm[k] ?? 0) * (1 - f) + (pcm[k + 1] ?? pcm[k] ?? 0) * f;
  }
  return out;
}

/* ---------------- texte → phonèmes → jetons ---------------- */

/**
 * Les substitutions que Kokoro attend sur la sortie d'espeak (celles du
 * phonétiseur officiel, misaki, pour les langues non anglaises en v1.0).
 */
const E2M = [['a^ɪ', 'I'], ['a^ʊ', 'W'], ['d^z', 'ʣ'], ['d^ʒ', 'ʤ'], ['e^ɪ', 'A'],
             ['o^ʊ', 'O'], ['ə^ʊ', 'Q'], ['s^s', 'S'], ['t^s', 'ʦ'], ['t^ʃ', 'ʧ'], ['ɔ^ɪ', 'Y']];

export function normaliserPhonemes(ps) {
  let s = ps;
  for (const [a, b] of E2M) s = s.split(a).join(b);
  return s.replace(/\^/g, '').replace(/-/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Découpe une phrase en propositions et ponctuations : espeak perd la
 * ponctuation, or c'est elle qui donne au modèle ses pauses et ses
 * intonations. On phonétise les propositions, et on remet la ponctuation
 * entre elles telle quelle.
 */
export function propositions(texte) {
  const t = String(texte).replace(/[«»“”]/g, '"').replace(/[’]/g, "'").replace(/\s+/g, ' ').trim();
  const morceaux = [];
  const re = /([^,;:.!?…—"()]+)([,;:.!?…—"()]*)/g;
  for (const m of t.matchAll(re)) {
    const mots = m[1].trim();
    const ponct = m[2].replace(/\.{3}/g, '…');
    if (mots || ponct) morceaux.push({ mots, ponct });
  }
  return morceaux;
}

export function versJetons(phonemes) {
  const jetons = [];
  for (const c of phonemes) { const j = VOCAB[c]; if (j !== undefined) jetons.push(j); }
  return jetons;
}

/* ---------------- les moteurs, chargés à la demande ---------------- */

const exiger = createRequire(import.meta.url);

let espeakPret = null;
async function espeak() {
  if (!espeakPret) espeakPret = (async () => {
    const { default: ESpeakNg } = await import('espeak-ng');
    const chemin = exiger.resolve('espeak-ng').replace(/espeak-ng\.js$/, 'espeak-ng.wasm');
    // Compilé une fois : chaque phrase ne paie plus que l'instanciation.
    const module = await WebAssembly.compile(readFileSync(chemin));
    return { ESpeakNg, module };
  })();
  return espeakPret;
}

/** Les propositions phonétisées en un seul appel à espeak, une par ligne. */
async function phonetiser(textes, langue) {
  const { ESpeakNg, module } = await espeak();
  // Un point SUIVI D'UN SAUT DE LIGNE force espeak à rendre chaque proposition
  // sur sa ligne. « . » seul ne suffit pas : devant une minuscule, espeak
  // n'y voit pas une fin de phrase et recolle les deux.
  const entree = textes.map(t => t.replace(/[.\n]/g, ' ')).join('.\n');
  const e = await ESpeakNg({
    arguments: ['--phonout', 'sortie', '-q', '--ipa=3', '--tie=^', '-v', langue, entree],
    instantiateWasm: (imports, ok) => { WebAssembly.instantiate(module, imports).then(i => ok(i)); return {}; },
    print: () => {}, printErr: () => {}
  });
  return e.FS.readFile('sortie', { encoding: 'utf8' }).split('\n').map(l => l.trim()).filter(Boolean);
}

/** Texte français → chaîne de phonèmes Kokoro, ponctuation comprise. */
export async function phonemes(texte, langue = 'fr-fr') {
  const morceaux = propositions(texte);
  const avecMots = morceaux.filter(m => m.mots);
  const lignes = avecMots.length ? await phonetiser(avecMots.map(m => m.mots), langue) : [];
  // Si espeak a coupé autrement que nous, on ne devine pas : tout à la suite.
  if (lignes.length !== avecMots.length) {
    const fin = morceaux.at(-1)?.ponct?.trim() || '.';
    return normaliserPhonemes(lignes.join(' ')) + fin;
  }
  let i = 0, sortie = '';
  for (const m of morceaux) {
    if (m.mots) sortie += (sortie && !sortie.endsWith(' ') ? ' ' : '') + normaliserPhonemes(lignes[i++]);
    if (m.ponct) sortie += m.ponct.replace(/"/g, '');
  }
  return sortie.replace(/\s+([,;:.!?…])/g, '$1').trim();
}

async function chargerOnnx() {
  try { return { ort: await import('onnxruntime-node'), natif: true }; }
  catch {
    const ort = await import('onnxruntime-web');
    // La version WebAssembly n'a que le processeur, sur un seul fil par
    // défaut : on lui donne les coeurs de la machine.
    ort.env.wasm.numThreads = Math.max(1, Math.min(8, (await import('node:os')).cpus().length));
    return { ort, natif: false };
  }
}

/* ---------------- le moteur ---------------- */

/** Ce qui manque pour que la voix Kokoro marche, en clair. Vide si rien. */
export function manque(dossier = DOSSIER) {
  const m = [];
  for (const p of ['espeak-ng']) { try { exiger.resolve(p); } catch { m.push(`le paquet ${p}`); } }
  let onnx = false;
  for (const p of ['onnxruntime-node', 'onnxruntime-web']) { try { exiger.resolve(p); onnx = true; break; } catch {} }
  if (!onnx) m.push('le paquet onnxruntime-node (ou onnxruntime-web)');
  if (!existsSync(join(dossier, FICHIER_MODELE))) m.push(`le modèle (${FICHIER_MODELE})`);
  if (!existsSync(join(dossier, FICHIER_VOIX))) m.push(`les voix (${FICHIER_VOIX})`);
  return m;
}

/*
 * LA CARTE GRAPHIQUE D'ABORD, LE PROCESSEUR SI ELLE NE RÉPOND PAS.
 *
 * Kokoro est petit : sur processeur, une seconde de parole coûte ~0,4 s de
 * calcul ; sur une carte graphique, quelques centièmes. C'est ce qui rend la
 * voix réactive — la phrase suivante est prête avant que la précédente soit
 * dite. On essaie donc les accélérateurs disponibles pour la plateforme, dans
 * l'ordre, et on garde le premier qui accepte le modèle :
 *   - Windows : DirectML (toute carte DirectX 12, rien à installer), puis WebGPU ;
 *   - Linux   : CUDA (demande CUDA 12 et cuDNN 9, et les binaires CUDA
 *               d'onnxruntime-node), puis WebGPU ;
 *   - macOS   : CoreML, puis WebGPU.
 * BD_KOKORO_GPU force un choix (« dml », « cuda », « webgpu », « coreml »,
 * ou « cpu » pour s'en passer).
 */
export function fournisseurs(plateforme = process.platform, force = process.env.BD_KOKORO_GPU) {
  if (force && force !== 'auto') return force === 'cpu' ? ['cpu'] : [force, 'cpu'];
  if (plateforme === 'win32') return ['dml', 'webgpu', 'cpu'];
  if (plateforme === 'linux') return ['cuda', 'webgpu', 'cpu'];
  if (plateforme === 'darwin') return ['coreml', 'webgpu', 'cpu'];
  return ['cpu'];
}

const NOM_FOURNISSEUR = { dml: 'carte graphique (DirectML)', cuda: 'carte graphique (CUDA)',
  webgpu: 'carte graphique (WebGPU)', coreml: 'puce graphique (CoreML)', cpu: 'processeur', wasm: 'processeur (WebAssembly)' };
export const nomFournisseur = f => NOM_FOURNISSEUR[f] ?? f;

/** Ce que le moteur chargé utilise vraiment, ou null s'il n'est pas chargé. */
export let fournisseurActif = null;

let moteur = null;

/** Le moteur, chargé une fois et gardé : le modèle met une seconde à charger. */
export async function kokoro(dossier = DOSSIER) {
  if (moteur) return moteur;
  const absent = manque(dossier);
  if (absent.length) throw new Error(`Voix Kokoro non installée — il manque ${absent.join(', ')}. Lance : npm run voix:installer`);
  moteur = (async () => {
    const { ort, natif } = await chargerOnnx();
    const octets = readFileSync(join(dossier, FICHIER_MODELE));
    let session = null, choisi = null;
    const essais = [];
    for (const f of natif ? fournisseurs() : ['wasm']) {
      try {
        session = await ort.InferenceSession.create(octets, {
          executionProviders: [f],
          graphOptimizationLevel: 'all',
          // DirectML refuse la réutilisation de mémoire et l'exécution parallèle.
          ...(f === 'dml' ? { enableMemPattern: false, executionMode: 'sequential' } : {})
        });
        choisi = f;
        break;
      } catch (err) {
        essais.push(`${f} : ${String(err?.message ?? err).split('\n')[0].slice(0, 160)}`);
      }
    }
    if (!session) throw new Error(`Aucun moteur n'a accepté le modèle — ${essais.join(' ; ')}`);
    if (essais.length) console.log(`[kokoro] ${nomFournisseur(choisi)} (essayés avant : ${essais.join(' ; ')})`);
    else console.log(`[kokoro] ${nomFournisseur(choisi)}`);
    fournisseurActif = choisi;
    const voix = lireNpz(readFileSync(join(dossier, FICHIER_VOIX)), new Set(VOIX_UTILES));
    const m = { ort, session, voix, entreeJetons: session.inputNames.includes('input_ids') ? 'input_ids' : 'tokens' };
    // UN TOUR DE CHAUFFE : la première exécution compile les noyaux du
    // processeur graphique et charge espeak. Mieux vaut que ce soit ici, à
    // l'ouverture de « Parler », que sur la première phrase qu'on attend.
    await synthetiserAvec(m, 'Bonjour.', PRESETS[PRESET_DEFAUT]).catch(() => {});
    return m;
  })().catch(err => { moteur = null; throw err; });
  return moteur;
}

/**
 * Une phrase → PCM float32 à 24 kHz.
 * @param {string} texte
 * @param {{preset?: string, debit?: number}} [o]
 */
export async function synthetiser(texte, { preset = PRESET_DEFAUT, debit = null } = {}) {
  const p = PRESETS[preset] ?? PRESETS[PRESET_DEFAUT];
  return synthetiserAvec(await kokoro(), texte, p, debit);
}

async function synthetiserAvec(m, texte, p, debit = null) {
  const ph = await phonemes(texte);
  const jetons = versJetons(ph).slice(0, MAX_JETONS - 2);
  if (!jetons.length) return new Float32Array(0);
  const style = styleDe(m.voix, p, jetons.length);
  // Une voix abaissée se synthétise plus vite, puis s'étire : même débit final.
  const vitesse = Math.max(0.5, Math.min(2.5, Number(debit ?? p.debit) / (p.grave ?? 1)));
  const types = Object.fromEntries((m.session.inputMetadata ?? []).map?.(x => [x.name, x.type]) ?? []);
  const ids = [0, ...jetons, 0];
  const entree = types[m.entreeJetons] === 'int32'
    ? new m.ort.Tensor('int32', Int32Array.from(ids), [1, ids.length])
    : new m.ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
  const sorties = await m.session.run({
    [m.entreeJetons]: entree,
    style: new m.ort.Tensor('float32', style, [1, 256]),
    speed: new m.ort.Tensor('float32', Float32Array.from([vitesse]), [1])
  });
  return abaisser(sorties[m.session.outputNames[0]].data, p.grave);
}

/** PCM float32 → fichier WAV 16 bits mono. */
export function enWav(pcm, taux = TAUX) {
  const n = pcm.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(taux, 24); buf.writeUInt32LE(taux * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
  return buf;
}
