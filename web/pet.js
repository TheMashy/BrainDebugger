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
  async say(artEl, bubbleEl, text, { speak = false, voice = null, charMs = 26 } = {}) {
    this.stop();
    const token = this._abort = {};
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced || !artEl) {
      bubbleEl.textContent = text;
      if (speak && voice) voice.speak(text);
      return;
    }

    artEl.classList.add('talking');
    let speaking = false;
    if (speak && voice) speaking = voice.speak(text, () => { speaking = false; });

    for (let i = 1; i <= text.length; i++) {
      if (this._abort !== token) return;               // une nouvelle réplique a démarré
      bubbleEl.textContent = text.slice(0, i);
      const c = text[i - 1];
      if (c === ' ') this.beat(artEl);
      // ponctuation : on souffle, comme à l'oral
      await sleep('.!?'.includes(c) ? charMs * 9 : ',;:'.includes(c) ? charMs * 4 : c === ' ' ? charMs * 2 : charMs);
    }

    // la voix dépasse souvent le texte : on laisse le sprite bouger jusqu'au bout
    let guard = 0;
    while (speaking && this._abort === token && guard++ < 400) await sleep(80);

    if (this._abort === token) {
      artEl.classList.remove('talking');
      this._abort = null;
    }
  },

  beat(artEl) {
    artEl.classList.remove('beat');
    void artEl.offsetWidth;            // force le redémarrage de l'animation
    artEl.classList.add('beat');
  },

  stop() {
    this._abort = null;
    for (const el of document.querySelectorAll('.art.talking, .art.beat')) {
      el.classList.remove('talking', 'beat');
    }
  }
};
