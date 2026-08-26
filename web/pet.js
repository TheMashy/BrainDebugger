/**
 * Le compagnon : son image et sa façon de parler.
 *
 * Deux choses seulement, mais ce sont celles qui font qu'on a envie de lui parler
 * plutôt que d'ouvrir un bloc-notes.
 */

/**
 * Convertit n'importe quelle image en PNG carré.
 *
 * L'utilisateur dépose ce qu'il veut — photo, JPEG, WebP, GIF, SVG — et ça
 * ressort en PNG normalisé. Deux raisons de passer par un canvas plutôt que de
 * stocker le fichier brut : une photo de 4 Mo n'a rien à faire dans une base
 * SQLite ou un localStorage, et un sprite de taille imprévisible casse la mise
 * en page. On garde le ratio et on laisse le reste transparent.
 */
export async function toPNG(file, size = 256) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("Image illisible."));
      i.src = url;
    });
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) throw new Error("Image sans dimensions.");

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const scale = Math.min(size / w0, size / h0);
    const w = w0 * scale, h = h0 * scale;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);

    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Ponctuation : on souffle, comme à l'oral. */
const pauseFor = (c, charMs) =>
  '.!?'.includes(c) ? charMs * 9 :
  ',;:'.includes(c) ? charMs * 4 :
  c === ' '         ? charMs * 2 : charMs;

/**
 * Dialogue façon RPG : le texte se dévoile lettre à lettre pendant que le sprite
 * s'agite. C'est ce décalage qui donne l'impression que quelqu'un parle — un
 * pavé de texte qui apparaît d'un coup, non.
 *
 * L'animation vit sur DEUX éléments pour que les transformations ne se marchent
 * pas dessus : le sprite porte le balancement continu, son conteneur porte le
 * à-coup de chaque mot.
 */
export const PetTalk = {
  _abort: null,

  /** @returns {Promise<void>} résolue quand le sprite a fini de parler */
  async say(artEl, bubbleEl, text, { onChar = null, charMs = 26 } = {}) {
    this.stop();
    const token = this._abort = {};
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || !artEl) {
      bubbleEl.textContent = text;
      return;
    }

    artEl.classList.add('talking');

    for (let i = 1; i <= text.length; i++) {
      if (this._abort !== token) return;               // une nouvelle réplique a démarré
      bubbleEl.textContent = text.slice(0, i);
      const c = text[i - 1];
      onChar?.(c);
      if (c === ' ') this.beat(artEl);
      await sleep(pauseFor(c, charMs));
    }

    if (this._abort === token) {
      artEl.classList.remove('talking');
      this._abort = null;
    }
  },

  /* ---------- mode flux ----------
     Un modèle distant livre par à-coups : parfois quarante caractères d'un coup,
     parfois rien pendant une seconde. Recopier les fragments tels quels donne
     une saccade. On met donc les caractères en file et on les draine à cadence
     constante — la frappe reste régulière quelle que soit la vitesse du modèle.
  */

  _q: null,

  startStream(artEl, bubbleEl, { charMs = 22, onChar = null } = {}) {
    this.stop();
    const token = this._abort = {};
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    bubbleEl.textContent = '';
    if (!reduced && artEl) artEl.classList.add('talking');

    const q = this._q = {
      token, artEl, bubbleEl, chars: [], closed: false, reduced,
      done: null, charMs, onChar
    };
    q.done = new Promise(resolve => { q.resolve = resolve; });
    this._drain(q);
    return q.done;
  },

  feed(chunk) {
    const q = this._q;
    if (!q || this._abort !== q.token || !chunk) return;
    if (q.reduced) { q.bubbleEl.textContent += chunk; return; }
    q.chars.push(...chunk);
  },

  endStream() {
    const q = this._q;
    if (!q) return Promise.resolve();
    q.closed = true;
    if (q.reduced) this._finish(q);
    return q.done;
  },

  async _drain(q) {
    while (this._abort === q.token) {
      if (q.chars.length) {
        const c = q.chars.shift();
        q.bubbleEl.textContent += c;
        q.onChar?.(c);
        if (c === ' ') this.beat(q.artEl);
        // file qui s'allonge : on accélère pour ne pas prendre du retard sur le modèle
        const rush = q.chars.length > 90 ? 0.35 : q.chars.length > 40 ? 0.6 : 1;
        await sleep(pauseFor(c, q.charMs) * rush);
      } else if (q.closed) {
        break;
      } else {
        await sleep(28);           // en attente du prochain fragment
      }
    }
    this._finish(q);
  },

  _finish(q) {
    if (this._abort !== q.token) return;
    q.artEl?.classList.remove('talking');
    this._abort = null;
    this._q = null;
    q.resolve?.();
  },

  beat(artEl) {
    if (!artEl) return;
    artEl.classList.remove('beat');
    void artEl.offsetWidth;            // force le redémarrage de l'animation
    artEl.classList.add('beat');
  },

  stop() {
    const q = this._q;
    this._abort = null;
    this._q = null;
    q?.resolve?.();
    for (const el of document.querySelectorAll('.art.talking, .art.beat')) {
      el.classList.remove('talking', 'beat');
    }
  }
};
