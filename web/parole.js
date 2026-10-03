/**
 * LA VOIX PARLÉE DU COMPAGNON, À CÔTÉ DES BLIPS.
 *
 * Les blips restent le défaut : ils ne prétendent rien. Mais quand on veut
 * une vraie conversation, à l'oral, il faut une voix — et une voix qui
 * commence à parler TOUT DE SUITE. On ne lit donc pas la réponse à la fin :
 * on la lit au fil du flux, phrase par phrase, dès que la première est
 * complète. Le modèle écrit la deuxième pendant qu'on entend la première.
 *
 * La synthèse est celle du navigateur (Web Speech API) : aucune clé, aucun
 * fichier, aucun coût. MAIS certaines voix ne sont pas sur la machine — les
 * « Google » de Chrome, les « Online (Natural) » d'Edge envoient le texte à
 * leur éditeur pour le lire. Ce sont souvent les plus belles. On les propose,
 * en le disant, et on n'en choisit jamais une par défaut : par défaut, la
 * meilleure voix LOCALE.
 *
 * Le découpage et le nettoyage sont des fonctions pures, testées sans
 * navigateur ; seul l'objet `Parole` touche à `speechSynthesis`.
 */

/** Une première phrase courte part plus tôt : on coupe à la virgule dès ce seuil. */
export const PREMIER_MORCEAU = 40;
/** Au-delà, on n'attend plus la fin de phrase pour parler : on coupe à la virgule. */
export const MORCEAU_MAX = 220;

/**
 * Ce qui se lit mal à voix haute : le balisage, les émojis, les tirets
 * typographiques qu'une voix prononce « tiret ».
 */
export function nettoyerPourVoix(t) {
  return String(t ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_#>~]+/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+[—–]\s+/g, ', ')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Coupe ce qui est prêt à être dit dans le tampon du flux.
 *
 * @param {string} tampon  le texte reçu et pas encore dit
 * @param {{premier?: boolean, fin?: boolean}} [o]
 *        `premier` : rien n'a encore été dit dans cette réponse ;
 *        `fin` : le flux est terminé, tout ce qui reste part.
 * @returns {{ morceaux: string[], reste: string }}
 */
export function decouper(tampon, { premier = false, fin = false } = {}) {
  const morceaux = [];
  let reste = tampon;
  for (;;) {
    // Une fin de phrase SUIVIE d'un blanc : « 3.5 » ou « etc.) » en cours de
    // flux ne coupent pas, parce qu'on ne sait pas encore ce qui suit.
    const m = reste.match(/^([\s\S]*?[.!?…]+["»)]?)(\s+)/) ?? reste.match(/^([\s\S]*?)(\n+)/);
    if (m && m[1].trim()) {
      morceaux.push(m[1].trim());
      reste = reste.slice(m[0].length);
      premier = false;
      continue;
    }
    // Pas de fin de phrase : couper à la dernière virgule si le morceau est
    // déjà long — ou, pour le tout premier, dès qu'il y a de quoi dire.
    const seuil = premier ? PREMIER_MORCEAU : MORCEAU_MAX;
    if (reste.length >= seuil) {
      const i = Math.max(reste.lastIndexOf(', '), reste.lastIndexOf('; '), reste.lastIndexOf(': '));
      if (i >= 12) {
        morceaux.push(reste.slice(0, i + 1).trim());
        reste = reste.slice(i + 2);
        premier = false;
        continue;
      }
    }
    break;
  }
  if (fin && reste.trim()) { morceaux.push(reste.trim()); reste = ''; }
  return { morceaux, reste };
}

/** Une voix est-elle de celles qui sonnent bien ? (les noms le disent, faute de mieux) */
const BELLE = /natural|neural|premium|enhanced|wavenet|siri|online/i;

/**
 * Les voix françaises, les meilleures d'abord, les locales avant les en-ligne
 * à qualité égale. Ne garde que le français : une voix anglaise qui lit du
 * français est pire que des blips.
 */
export function classerVoix(voix = []) {
  const fr = voix.filter(v => String(v.lang ?? '').toLowerCase().replace('_', '-').startsWith('fr'));
  const note = v => (BELLE.test(v.name) ? 4 : 0)
    + (String(v.lang).toLowerCase().replace('_', '-') === 'fr-fr' ? 2 : 0)
    + (v.localService ? 1 : 0);
  return [...fr].sort((a, b) => note(b) - note(a) || a.name.localeCompare(b.name));
}

/** La voix par défaut : la mieux classée parmi celles qui restent sur la machine. */
export const voixParDefaut = voix => classerVoix(voix).find(v => v.localService) ?? null;

/* ---------------- ce qui parle vraiment ---------------- */

const synth = () => (typeof window !== 'undefined' && window.speechSynthesis) || null;

export const Parole = {
  _tampon: '',
  _premier: true,
  _actif: false,
  _reglages: null,

  /** La voix du navigateur existe-t-elle ? (Kokoro, lui, dépend du serveur.) */
  disponible: () => !!synth(),

  /** Les voix, quand le navigateur a fini de les charger (il les charge tard). */
  voix() {
    const s = synth();
    if (!s) return Promise.resolve([]);
    const v = s.getVoices();
    if (v.length) return Promise.resolve(v);
    return new Promise(resolve => {
      const fini = () => resolve(s.getVoices());
      s.addEventListener('voiceschanged', fini, { once: true });
      setTimeout(fini, 1500);              // certains navigateurs ne préviennent jamais
    });
  },

  _choisir(reglages) {
    const toutes = synth()?.getVoices() ?? [];
    return toutes.find(v => v.voiceURI === reglages?.paroleVoix) ?? voixParDefaut(toutes);
  },

  _dire(texte) {
    const t = nettoyerPourVoix(texte);
    if (!t) return;
    if (this._reglages?.voixMode === 'kokoro') return this._direKokoro(t);
    this._direNavigateur(t);
  },

  _direNavigateur(t) {
    const s = synth();
    if (!s || !t) return;
    const u = new SpeechSynthesisUtterance(t);
    const v = this._choisir(this._reglages);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'fr-FR';
    u.rate = Number(this._reglages?.paroleDebit ?? 1.05);
    u.volume = Math.max(0, Math.min(1, Number(this._reglages?.blipVolume ?? 0.8)));
    s.speak(u);
  },

  /*
   * KOKORO : LA VOIX CALCULÉE PAR LE SERVEUR, SUR CETTE MACHINE.
   *
   * Chaque phrase est demandée dès qu'elle est complète — le serveur les
   * calcule une par une, dans l'ordre — et les sons se jouent à la file. La
   * deuxième phrase se calcule donc pendant qu'on entend la première. Si le
   * serveur ne sait pas (voix non installée), la phrase part par la voix du
   * navigateur plutôt que de laisser un trou.
   */
  _file: Promise.resolve(),
  _abandon: null,
  _son: null,

  _direKokoro(t) {
    const abandon = this._abandon ??= new AbortController();
    const r = this._reglages;
    const requete = fetch('/api/voix/kokoro', {
      method: 'POST', signal: abandon.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texte: t, preset: r?.kokoroPreset, debit: r?.kokoroDebit })
    }).then(rep => rep.ok && /^audio\//.test(rep.headers.get('Content-Type') ?? '') ? rep.blob() : null)
      .catch(() => null);
    this._file = this._file.then(async () => {
      const son = await requete;
      if (abandon.signal.aborted) return;
      if (!son) return this._direNavigateur(t);
      const url = URL.createObjectURL(son);
      const audio = this._son = new Audio(url);
      audio.volume = Math.max(0, Math.min(1, Number(r?.blipVolume ?? 0.8)));
      await new Promise(fin => {
        audio.onended = audio.onerror = fin;
        abandon.signal.addEventListener('abort', fin, { once: true });
        audio.play().catch(fin);
      });
      URL.revokeObjectURL(url);
    });
  },

  /** Une nouvelle réplique commence : on coupe la précédente. */
  debut(reglages) {
    this.stop();
    this._reglages = reglages;
    this._actif = true;
  },

  nourrir(fragment) {
    if (!this._actif || !fragment) return;
    this._tampon += fragment;
    const { morceaux, reste } = decouper(this._tampon, { premier: this._premier });
    this._tampon = reste;
    for (const m of morceaux) { this._premier = false; this._dire(m); }
  },

  fin() {
    if (!this._actif) return;
    const { morceaux } = decouper(this._tampon, { premier: this._premier, fin: true });
    for (const m of morceaux) this._dire(m);
    this._tampon = '';
    this._actif = false;
  },

  /** Une phrase seule, pour essayer une voix dans Réglages. */
  essayer(reglages, texte = "Je t'écoute. Raconte-moi ta journée.") {
    this.debut(reglages);
    this.nourrir(texte);
    this.fin();
  },

  stop() {
    synth()?.cancel();
    this._abandon?.abort();
    this._abandon = null;
    this._son?.pause();
    this._son = null;
    this._file = Promise.resolve();
    this._tampon = '';
    this._premier = true;
    this._actif = false;
  }
};
