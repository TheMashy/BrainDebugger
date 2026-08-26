/**
 * La voix du compagnon : un blip par syllabe, comme dans les RPG.
 *
 * Pas de synthèse vocale. Une voix TTS lisant « qu'est-ce qui s'est passé
 * aujourd'hui ? » sonne comme un serveur vocal — et un serveur vocal, on ne
 * s'y confie pas. Un blip ne prétend rien : il signale juste que quelqu'un
 * parle, et le cerveau fait le reste.
 *
 * Tout est synthétisé à la volée avec l'API Web Audio : aucun fichier, aucun
 * téléchargement, et la page publiée reste autonome.
 */

export const VOICES = [
  {
    id: 'aa',
    name: 'aa a aa a',
    hint: 'clair et sec',
    wave: 'square', freq: 540, jitter: 95, dur: 0.055, glide: 1,
    filter: 3000, detune: 0, gain: 0.13, every: 2
  },
  {
    id: 'bheuu',
    name: 'bheuu bheu',
    hint: 'grave et traînant',
    wave: 'triangle', freq: 205, jitter: 38, dur: 0.14, glide: 0.8,
    filter: 850, detune: 9, gain: 0.22, every: 3
  },
  {
    id: 'ti',
    name: 'ti ti ti',
    hint: 'petit et aigu',
    wave: 'sine', freq: 880, jitter: 150, dur: 0.04, glide: 1.12,
    filter: null, detune: 0, gain: 0.11, every: 2
  },
  {
    id: 'brou',
    name: 'brou brou',
    hint: 'rond et bas',
    wave: 'sawtooth', freq: 150, jitter: 26, dur: 0.11, glide: 0.9,
    filter: 620, detune: 6, gain: 0.16, every: 3
  },
  {
    id: 'bip',
    name: 'bip bip',
    hint: 'métallique',
    wave: 'square', freq: 700, jitter: 0, dur: 0.035, glide: 1,
    filter: null, detune: 0, gain: 0.09, every: 3
  },
  {
    id: 'ouep',
    name: 'ouèp ouèp',
    hint: 'nasillard',
    wave: 'sawtooth', freq: 330, jitter: 70, dur: 0.075, glide: 1.18,
    filter: 1400, detune: 14, gain: 0.14, every: 2
  }
];

const byId = id => VOICES.find(v => v.id === id) ?? VOICES[0];

/** Silencieux : espaces et ponctuation marquent le rythme, ils ne sonnent pas. */
const SILENT = new Set([' ', '\n', '\t', '.', ',', ';', ':', '!', '?', "'", '’', '-', '—', '(', ')', '"', '«', '»']);

export const Blip = {
  ctx: null,
  master: null,
  _n: 0,
  _last: 0,

  /** L'AudioContext ne peut naître que d'un geste utilisateur (politique navigateur). */
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  },

  /**
   * Un caractère révélé. Ne sonne qu'un caractère sur `every`, et jamais plus
   * d'une fois toutes les 45 ms : à la cadence de frappe, un blip par lettre
   * devient un bourdonnement continu au lieu d'une voix.
   */
  tick(char, settings) {
    if (!settings?.blipEnabled) return;
    if (SILENT.has(char)) { this._n = 0; return; }
    if (++this._n < (byId(settings.blipVoice).every)) return;
    this._n = 0;

    const now = performance.now();
    if (now - this._last < 45) return;
    this._last = now;

    this.play(char, settings);
  },

  play(char, settings) {
    if (!this.ensure()) return;
    const v = byId(settings.blipVoice);
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Hauteur dérivée du caractère : déterministe, donc la même phrase sonne
    // toujours pareil, mais assez variée pour ne pas faire métronome.
    const code = char.charCodeAt(0);
    const spread = (((code * 37) % 101) / 100 - 0.5) * 2;      // -1 .. 1
    const pitch = Number(settings.blipPitch ?? 1);
    const f0 = Math.max(60, (v.freq + spread * v.jitter) * pitch);

    const gain = ctx.createGain();
    const vol = Number(settings.blipVolume ?? 0.7);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, v.gain * vol), t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);

    let node = gain;
    if (v.filter) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = v.filter * pitch;
      lp.Q.value = 0.9;
      gain.connect(lp);
      node = lp;
    }
    node.connect(this.master);

    const oscs = [];
    const mk = detune => {
      const o = ctx.createOscillator();
      o.type = v.wave;
      o.detune.value = detune;
      o.frequency.setValueAtTime(f0, t);
      if (v.glide !== 1) o.frequency.exponentialRampToValueAtTime(Math.max(40, f0 * v.glide), t + v.dur);
      o.connect(gain);
      o.start(t);
      o.stop(t + v.dur + 0.02);
      oscs.push(o);
    };
    mk(0);
    if (v.detune) mk(v.detune);

    const last = oscs[oscs.length - 1];
    last.onended = () => { try { gain.disconnect(); } catch {} };
  },

  /** Écoute d'un timbre depuis les réglages. */
  preview(id, settings) {
    const s = { ...settings, blipEnabled: true, blipVoice: id };
    const phrase = 'bonjour toi';
    let i = 0;
    const step = () => {
      if (i >= phrase.length) return;
      const c = phrase[i++];
      if (!SILENT.has(c)) this.play(c, s);
      setTimeout(step, SILENT.has(c) ? 90 : 62);
    };
    this.ensure();
    step();
  },

  reset() { this._n = 0; this._last = 0; }
};
