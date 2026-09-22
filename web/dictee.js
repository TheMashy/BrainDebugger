/**
 * =====================================================================
 *  LA DICTÉE — CE QUI SE CALCULE, SANS NAVIGATEUR.
 *
 * Le micro est tenu par la page (avec l'autorisation du navigateur) ; la
 * reconnaissance tourne dans Machi Tool, sur le même PC, avec le moteur de
 * Handy (Parakeet V3). Entre les deux, du son brut au format le plus simple
 * qui soit : un WAV 16 bits, mono, 16 kHz — ce que Parakeet lit sans rien
 * convertir, et ce que Python lit sans bibliothèque.
 *
 * LE SON NE VA QU'À 127.0.0.1. Jamais au serveur du site, jamais ailleurs :
 * c'est la seule raison de passer par Machi Tool plutôt que par la dictée du
 * navigateur, qui l'envoie à Google.
 * =====================================================================
 */

export const FREQ = 16000;
/** Au-delà, ce n'est plus une phrase qu'on dicte : on coupe et on envoie. */
export const MAX_S = 300;

/** Des morceaux Float32 (-1..1) → un WAV PCM 16 bits mono, prêt à envoyer. */
export function wavDe(morceaux, freq = FREQ) {
  const n = morceaux.reduce((s, m) => s + m.length, 0);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const ecrire = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ecrire(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); ecrire(8, 'WAVE');
  ecrire(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, freq, true); v.setUint32(28, freq * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ecrire(36, 'data'); v.setUint32(40, n * 2, true);
  let o = 44;
  for (const m of morceaux) {
    for (let i = 0; i < m.length; i++, o += 2) {
      const x = Math.max(-1, Math.min(1, m[i] || 0));
      v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
  }
  return buf;
}

/**
 * Ramener à 16 kHz quand le navigateur a refusé de capter à cette fréquence
 * (Firefox relie mal un micro à 48 kHz à un contexte à 16 kHz). Une moyenne
 * par fenêtre : un filtre grossier, mais la parole tient sous 8 kHz et c'est
 * tout ce qu'on garde.
 */
export function reechantillonner(son, de, vers = FREQ) {
  if (!de || de === vers) return son;
  const ratio = de / vers;
  const n = Math.floor(son.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio), b = Math.min(son.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += son[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

/** Les morceaux reçus du micro, bout à bout. */
export function recoller(morceaux) {
  const out = new Float32Array(morceaux.reduce((s, m) => s + m.length, 0));
  let o = 0;
  for (const m of morceaux) { out.set(m, o); o += m.length; }
  return out;
}

/**
 * Le texte dicté, posé LÀ OÙ EST LE CURSEUR — pas à la fin, pas à la place de
 * ce qu'on avait écrit. Une espace de chaque côté quand il en faut une, aucune
 * avant une ponctuation.
 * @returns {{valeur: string, curseur: number}}
 */
export function inserer(valeur, debut, fin, texte) {
  const t = String(texte ?? '').trim();
  const v = String(valeur ?? '');
  if (!t) return { valeur: v, curseur: fin ?? v.length };
  const d0 = Number.isFinite(debut) ? debut : v.length;
  const f0 = Number.isFinite(fin) ? fin : d0;
  const avant = v.slice(0, d0), apres = v.slice(f0);
  const gauche = avant && !/\s$/.test(avant) ? ' ' : '';
  const droite = apres && !/^[\s.,;:!?)»]/.test(apres) ? ' ' : '';
  return { valeur: avant + gauche + t + droite + apres, curseur: (avant + gauche + t).length };
}
