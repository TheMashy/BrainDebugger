/* Sprites integres. Geometrie simple, deux tons, meme grille 100x100
   pour qu'ils soient interchangeables sans casser la mise en page.
   L'utilisateur peut aussi charger son propre PNG (Reglages). */

const wrap = (inner, tone = '#c9a227') =>
  `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="--tone:${tone}">${inner}</svg>`;

export const PETS = {
  deer: {
    name: 'Cerf',
    svg: wrap(`
      <g fill="none" stroke="#8b6a2f" stroke-width="4.5" stroke-linecap="round">
        <path d="M34 34 L27 18 M27 18 L18 14 M27 18 L24 8"/>
        <path d="M66 34 L73 18 M73 18 L82 14 M73 18 L76 8"/>
      </g>
      <ellipse cx="50" cy="56" rx="24" ry="27" fill="#b98b4a"/>
      <ellipse cx="50" cy="72" rx="14" ry="13" fill="#e0c193"/>
      <ellipse cx="27" cy="44" rx="7" ry="11" fill="#a87d40" transform="rotate(-22 27 44)"/>
      <ellipse cx="73" cy="44" rx="7" ry="11" fill="#a87d40" transform="rotate(22 73 44)"/>
      <circle cx="41" cy="53" r="4.2" fill="#231a10"/>
      <circle cx="59" cy="53" r="4.2" fill="#231a10"/>
      <circle cx="42.4" cy="51.6" r="1.5" fill="#fff"/>
      <circle cx="60.4" cy="51.6" r="1.5" fill="#fff"/>
      <ellipse cx="50" cy="70" rx="5" ry="4" fill="#3b2b1a"/>`)
  },
  cat: {
    name: 'Chat',
    svg: wrap(`
      <path d="M26 40 L24 17 L42 28 Z" fill="#6b7280"/>
      <path d="M74 40 L76 17 L58 28 Z" fill="#6b7280"/>
      <path d="M28 37 L27 24 L39 30 Z" fill="#e8a0a8"/>
      <path d="M72 37 L73 24 L61 30 Z" fill="#e8a0a8"/>
      <ellipse cx="50" cy="57" rx="26" ry="24" fill="#8d949e"/>
      <ellipse cx="50" cy="66" rx="15" ry="11" fill="#d6dae0"/>
      <ellipse cx="40" cy="54" rx="5" ry="6.5" fill="#1d2228"/>
      <ellipse cx="60" cy="54" rx="5" ry="6.5" fill="#1d2228"/>
      <circle cx="41.6" cy="51.8" r="1.7" fill="#fff"/>
      <circle cx="61.6" cy="51.8" r="1.7" fill="#fff"/>
      <path d="M50 62 l-3.5 3 h7 Z" fill="#e8a0a8"/>
      <g stroke="#c9ced5" stroke-width="1.6" stroke-linecap="round">
        <path d="M22 60 L8 57 M22 64 L9 65 M78 60 L92 57 M78 64 L91 65"/>
      </g>`)
  },
  fox: {
    name: 'Renard',
    svg: wrap(`
      <path d="M24 42 L20 14 L44 30 Z" fill="#d4692a"/>
      <path d="M76 42 L80 14 L56 30 Z" fill="#d4692a"/>
      <path d="M27 38 L25 22 L40 31 Z" fill="#2a2320"/>
      <path d="M73 38 L75 22 L60 31 Z" fill="#2a2320"/>
      <path d="M50 84 C28 78 24 60 26 48 C34 40 66 40 74 48 C76 60 72 78 50 84 Z" fill="#e07a33"/>
      <path d="M50 84 C40 80 35 72 34 64 L66 64 C65 72 60 80 50 84 Z" fill="#f5ece2"/>
      <circle cx="39" cy="55" r="4.4" fill="#231a14"/>
      <circle cx="61" cy="55" r="4.4" fill="#231a14"/>
      <circle cx="40.5" cy="53.5" r="1.6" fill="#fff"/>
      <circle cx="62.5" cy="53.5" r="1.6" fill="#fff"/>
      <ellipse cx="50" cy="70" rx="4.6" ry="3.6" fill="#241c17"/>`)
  },
  owl: {
    name: 'Hibou',
    svg: wrap(`
      <path d="M26 34 L30 20 L40 30 Z" fill="#7d6a54"/>
      <path d="M74 34 L70 20 L60 30 Z" fill="#7d6a54"/>
      <ellipse cx="50" cy="58" rx="27" ry="28" fill="#9a8467"/>
      <path d="M50 34 C36 34 27 44 27 54 C27 62 36 66 50 66 C64 66 73 62 73 54 C73 44 64 34 50 34 Z" fill="#c4b299"/>
      <circle cx="39" cy="52" r="10" fill="#f2ece1"/>
      <circle cx="61" cy="52" r="10" fill="#f2ece1"/>
      <circle cx="39" cy="52" r="5" fill="#20180f"/>
      <circle cx="61" cy="52" r="5" fill="#20180f"/>
      <circle cx="40.7" cy="50.2" r="1.8" fill="#fff"/>
      <circle cx="62.7" cy="50.2" r="1.8" fill="#fff"/>
      <path d="M50 58 l-4.5 6 4.5 4 4.5 -4 Z" fill="#d99a2b"/>
      <path d="M32 74 q18 8 36 0" stroke="#7d6a54" stroke-width="3" fill="none" stroke-linecap="round"/>`)
  },
  blob: {
    name: 'Bloup',
    svg: wrap(`
      <path d="M50 20 C70 20 82 36 82 54 C82 72 68 84 50 84 C32 84 18 72 18 54 C18 36 30 20 50 20 Z" fill="#5b8ea8"/>
      <path d="M50 26 C64 26 74 38 74 52 C74 60 68 66 60 66 C52 66 50 60 50 60 C50 60 48 66 40 66 C32 66 26 60 26 52 C26 38 36 26 50 26 Z" fill="#79aec9"/>
      <circle cx="40" cy="50" r="6" fill="#12222b"/>
      <circle cx="60" cy="50" r="6" fill="#12222b"/>
      <circle cx="42" cy="47.6" r="2.1" fill="#fff"/>
      <circle cx="62" cy="47.6" r="2.1" fill="#fff"/>
      <path d="M43 66 q7 6 14 0" stroke="#12222b" stroke-width="2.6" fill="none" stroke-linecap="round"/>`)
  }
};

export function petMarkup(settings) {
  if (settings.petSprite === 'custom' && settings.petImage) {
    return `<img src="${settings.petImage}" alt="">`;
  }
  return (PETS[settings.petSprite] ?? PETS.deer).svg;
}
