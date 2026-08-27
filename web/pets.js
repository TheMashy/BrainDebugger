/* Les compagnons.
 *
 * Direction : pate a modeler. Chaque bestiole est une petite figurine posee sous
 * une lampe haute et legerement a gauche. Trois regles tenues sur les cinq :
 *
 *   1. chaque masse a son degrade radial (clair en haut-gauche, sombre en bas),
 *      son ombre interne au pied et un rebond de lumiere sur le contour haut —
 *      c'est ce contour clair qui decolle la silhouette du fond #0a0c0b ;
 *   2. deux masses voisines ne se touchent jamais sans un ecart de valeur net
 *      (tete claire sur poitrail sombre, museau creme sur fourrure). A 76px,
 *      sans cet ecart, tout fusionne en bouillie ;
 *   3. le regard est une bille, et c'est la meme bille pour les cinq :
 *      degrade radial chaud par en dessous, ombre de paupiere gravee dans le
 *      haut de la bille, rebond lumineux en bas, eclat franc en haut a gauche,
 *      paupiere sculptee posee sur le bord superieur. Voir gaze().
 *
 * Contraintes : viewBox 100x100, aucun <style> (les selecteurs fuiraient sur la
 * page), aucun id nu — tous prefixes par l'animal, sinon deux compagnons
 * affiches cote a cote dans les Reglages se volent leurs degrades. Rien ne
 * suppose la racine immobile : le <svg> porte la respiration en CSS.
 */

const f = n => Math.round(n * 100) / 100;

/* Les trois degrades du regard. Un jeu par animal, la teinte du rebond change,
   la recette non. */
function eyeDefs(p, { lift, iris, deep, socket, lidTop, lidBot }) {
  return `<radialGradient id="${p}-eye" cx="50%" cy="74%" r="82%">
      <stop offset="0" stop-color="${lift}"/>
      <stop offset=".46" stop-color="${iris}"/>
      <stop offset="1" stop-color="${deep}"/>
    </radialGradient>
    <radialGradient id="${p}-socket" cx="50%" cy="50%" r="50%">
      <stop offset=".34" stop-color="${socket}" stop-opacity=".46"/>
      <stop offset="1" stop-color="${socket}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${p}-lid" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${lidTop}"/>
      <stop offset="1" stop-color="${lidBot}"/>
    </linearGradient>`;
}

/* Une bille. `drop` = de combien la paupiere mord sur la bille — 1.5 laisse
   l'oeil grand ouvert, 1.85 l'adoucit. Les deux yeux d'un meme animal ne
   recoivent jamais la meme valeur : c'est ce demi-millimetre d'asymetrie qui
   empeche l'effet clipart.

   L'ordre est tout. La paupiere est de la couleur de la fourrure, et si on la
   pose simplement sur le museau son contour se lit comme un SOURCIL : les cinq
   prennent aussitot un air inquiet. D'ou la deuxieme passe d'orbite (voile
   sombre et flou) repassee PAR DESSUS la paupiere : elle noie le bord de la
   paupiere dans l'ombre de l'arcade, les deux masses redeviennent une seule
   surface. L'eclat blanc passe en dernier pour garder tout son mordant. */
function gaze(p, x, y, r, glow, drop) {
  const s = r / 6;
  const hw = 7.15 * s;
  const ye = y - r + 0.8 * s;
  const yb = y - r + drop * s;
  const ct = y - r - 4.3 * s;
  const cb = 2 * yb - ye;
  const socket = o => `<ellipse cx="${f(x)}" cy="${f(y + 0.7 * s)}" rx="${f(9.6 * s)}" ry="${f(9 * s)}" fill="url(#${p}-socket)"${o}/>`;
  return `${socket('')}
    <circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#${p}-eye)"/>
    <ellipse cx="${f(x)}" cy="${f(y - 2.85 * s)}" rx="${f(4.5 * s)}" ry="${f(2.35 * s)}" fill="#0b0806" opacity=".42"/>
    <ellipse cx="${f(x + 0.5 * s)}" cy="${f(y + 3.05 * s)}" rx="${f(3.1 * s)}" ry="${f(1.95 * s)}" fill="${glow}" opacity=".34"/>
    <path d="M${f(x - hw)} ${f(ye)} Q${f(x)} ${f(ct)} ${f(x + hw)} ${f(ye)} Q${f(x)} ${f(cb)} ${f(x - hw)} ${f(ye)} Z" fill="url(#${p}-lid)"/>
    ${socket(' opacity=".38"')}
    <circle cx="${f(x - 2.3 * s)}" cy="${f(y - 1.98 * s)}" r="${f(1.8 * s)}" fill="#ffffff" opacity=".92"/>`;
}

/* Silhouettes. Chaque contour est ecrit une fois puis repeint plusieurs fois
   (matiere, ombre au pied, speculaire, liseret) : pas de clipPath a maintenir,
   et les masses ne peuvent pas deborder. */
const DEER_H = 'M50.4 23.4C65.2 23.4 76.2 33.6 76.2 46.8 76.2 57.4 69.6 65 58.8 68.8 55.6 72 44.8 72 41.6 68.8 30.8 65 24.4 57.4 24.4 46.4 24.4 33.4 35.4 23.4 50.4 23.4Z';
const DEER_B = 'M50 59.6C63.2 59.6 71.4 66.8 71.4 76.6 71.4 85.8 62.4 91.6 50 91.6 37.6 91.6 28.6 85.8 28.6 76.6 28.6 66.8 36.8 59.6 50 59.6Z';

const CAT_H = 'M50.3 24.6C65 24.6 76.4 34.2 76.4 46.6 76.4 56 71.6 62.6 63.6 66.4 59 68.6 41 68.6 36.4 66.4 28.4 62.6 23.6 56 23.6 46.6 23.6 34.2 35 24.6 50.3 24.6Z';
const CAT_B = 'M50 59.8C62.8 59.8 71 67 71 76.6 71 85.8 62.2 91.4 50 91.4 37.8 91.4 29 85.8 29 76.6 29 67 37.2 59.8 50 59.8Z';

const FOX_H = 'M50.4 24.8C64.6 24.8 76.6 33.4 77.4 45.2 78.1 55.4 71.6 61.4 63.4 65.2 57.6 67.9 55 71.8 50 71.8 45 71.8 42.4 67.9 36.6 65.2 28.4 61.4 21.9 55.4 22.6 45.2 23.4 33.4 35.4 24.8 50.4 24.8Z';
const FOX_B = 'M50 60.4C62.6 60.4 70.6 67.4 70.6 76.8 70.6 86 61.8 91.5 50 91.5 38.2 91.5 29.4 86 29.4 76.8 29.4 67.4 37.4 60.4 50 60.4Z';

const OWL_M = 'M50.6 21.5C68 21.5 79.8 35.5 79.8 55 79.8 75 67 89.6 50 89.6 33 89.6 20.8 75 20.8 55 20.8 35.5 33 21.5 50.6 21.5Z';
const OWL_D = 'M50 28.5C61 28.5 69.6 35.6 71 46.5 72.2 56 66.6 62.6 60 65.6 55.6 67.6 53 69.4 50 73 47 69.4 44.4 67.6 40 65.6 33.4 62.6 27.8 56 29 46.5 30.4 35.6 39 28.5 50 28.5Z';

const BLOB_M = 'M50.4 21.8C67.4 21.8 80.2 37 80.2 56.2 80.2 75.4 66.2 88.6 50 88.6 33.8 88.6 19.8 75.4 19.8 56 19.8 36.8 33.4 21.8 50.4 21.8Z';

export const PETS = {
  deer: {
    name: 'Cerf',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>
    <radialGradient id="bd-deer-head" cx="36%" cy="23%" r="86%">
      <stop offset="0" stop-color="#dcb98e"/><stop offset=".5" stop-color="#b0855b"/><stop offset="1" stop-color="#5f4429"/>
    </radialGradient>
    <radialGradient id="bd-deer-chest" cx="40%" cy="14%" r="92%">
      <stop offset="0" stop-color="#a67c53"/><stop offset=".55" stop-color="#82603d"/><stop offset="1" stop-color="#4b3722"/>
    </radialGradient>
    <linearGradient id="bd-deer-floor" gradientUnits="userSpaceOnUse" x1="0" y1="49" x2="0" y2="72">
      <stop offset="0" stop-color="#3b2714" stop-opacity="0"/><stop offset="1" stop-color="#3b2714" stop-opacity=".5"/>
    </linearGradient>
    <linearGradient id="bd-deer-bfloor" gradientUnits="userSpaceOnUse" x1="0" y1="72" x2="0" y2="92">
      <stop offset="0" stop-color="#2c1d0f" stop-opacity="0"/><stop offset="1" stop-color="#2c1d0f" stop-opacity=".55"/>
    </linearGradient>
    <radialGradient id="bd-deer-spec" gradientUnits="userSpaceOnUse" cx="38" cy="32" r="25">
      <stop offset="0" stop-color="#fff2da" stop-opacity=".3"/><stop offset="1" stop-color="#fff2da" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-deer-neck" gradientUnits="userSpaceOnUse" cx="50" cy="63" r="23">
      <stop offset="0" stop-color="#2b1c0e" stop-opacity=".66"/><stop offset="1" stop-color="#2b1c0e" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-deer-muz" cx="40%" cy="24%" r="90%">
      <stop offset="0" stop-color="#f4e0c2"/><stop offset=".6" stop-color="#dcbf9a"/><stop offset="1" stop-color="#a4835d"/>
    </radialGradient>
    <radialGradient id="bd-deer-nose" gradientUnits="userSpaceOnUse" cx="47.6" cy="57.8" r="10">
      <stop offset="0" stop-color="#70503f"/><stop offset="1" stop-color="#32211b"/>
    </radialGradient>
    <radialGradient id="bd-deer-ear" cx="38%" cy="18%" r="96%">
      <stop offset="0" stop-color="#c0946a"/><stop offset="1" stop-color="#644729"/>
    </radialGradient>
    <radialGradient id="bd-deer-earin" cx="44%" cy="24%" r="92%">
      <stop offset="0" stop-color="#a3705a"/><stop offset="1" stop-color="#5e3c2e"/>
    </radialGradient>
    <linearGradient id="bd-deer-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4ddb8" stop-opacity=".85"/><stop offset=".33" stop-color="#f4ddb8" stop-opacity="0"/>
      <stop offset=".78" stop-color="#f4ddb8" stop-opacity="0"/><stop offset="1" stop-color="#f4ddb8" stop-opacity=".22"/>
    </linearGradient>
    ${eyeDefs('bd-deer', { lift: '#6d4f36', iris: '#2c1e14', deep: '#0f0a06', socket: '#3a2413', lidTop: '#b98a5e', lidBot: '#8a6440' })}
  </defs>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M38.4 33.6C34.2 26.4 32 19.4 31.2 11.8" stroke="#7b5b3d" stroke-width="4.2"/>
    <path d="M34.8 24C31 22 26.6 20.8 22.6 20.6" stroke="#7b5b3d" stroke-width="3.6"/>
    <path d="M61.8 33.2C66.4 26.2 69 19.6 70.2 12.6" stroke="#7b5b3d" stroke-width="4.2"/>
    <path d="M65.6 24.8C69.4 22.6 73.8 21.4 77.8 21.6" stroke="#7b5b3d" stroke-width="3.6"/>
    <g stroke="#b58f63" stroke-width="1.7" opacity=".85">
      <path d="M37.6 33C33.6 26.1 31.4 19.5 30.6 12.2"/>
      <path d="M34.4 23.1C30.8 21.2 26.6 20.1 22.9 19.9"/>
      <path d="M62.6 32.6C66.9 25.9 69.4 19.7 70.6 13"/>
      <path d="M66 24.1C69.6 22 73.8 20.8 77.5 21"/>
    </g>
  </g>
  <ellipse cx="19.8" cy="44.4" rx="6.4" ry="12.6" transform="rotate(-40 19.8 44.4)" fill="url(#bd-deer-ear)"/>
  <ellipse cx="21.2" cy="45" rx="3.4" ry="8.2" transform="rotate(-40 21.2 45)" fill="url(#bd-deer-earin)"/>
  <ellipse cx="80.4" cy="43" rx="6.2" ry="12.2" transform="rotate(38 80.4 43)" fill="url(#bd-deer-ear)"/>
  <ellipse cx="79" cy="43.6" rx="3.2" ry="7.9" transform="rotate(38 79 43.6)" fill="url(#bd-deer-earin)"/>
  <path d="${DEER_B}" fill="url(#bd-deer-chest)"/>
  <path d="${DEER_B}" fill="url(#bd-deer-bfloor)"/>
  <g fill="#ecd6b3" opacity=".3">
    <circle cx="38.4" cy="74.8" r="2.5"/><circle cx="44.8" cy="81.6" r="2"/>
    <circle cx="60" cy="76.4" r="2.4"/><circle cx="55.2" cy="84.4" r="1.9"/>
  </g>
  <path d="${DEER_B}" fill="none" stroke="url(#bd-deer-rim)" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="${DEER_B}" fill="url(#bd-deer-neck)"/>
  <path d="${DEER_H}" fill="url(#bd-deer-head)"/>
  <path d="${DEER_H}" fill="url(#bd-deer-floor)"/>
  <path d="${DEER_H}" fill="url(#bd-deer-spec)"/>
  <ellipse cx="50" cy="63.4" rx="9.6" ry="6.8" fill="url(#bd-deer-muz)"/>
  <path d="M50 56.8C53 56.8 54.7 57.9 54.7 59.4 54.7 61.4 52.3 62.9 50 62.9 47.7 62.9 45.3 61.4 45.3 59.4 45.3 57.9 47 56.8 50 56.8Z" fill="url(#bd-deer-nose)"/>
  <ellipse cx="47.8" cy="58.2" rx="1.8" ry="1.1" fill="#ffffff" opacity=".24"/>
  <path d="M50 63.2V64.7M46.2 65.9Q50 68.4 53.8 65.9" fill="none" stroke="#6d5136" stroke-width="1.5" stroke-linecap="round" opacity=".7"/>
  ${gaze('bd-deer', 38.4, 49.8, 6, '#ffd9a8', 1.5)}
  ${gaze('bd-deer', 61.6, 50.4, 5.8, '#ffd9a8', 1.85)}
  <path d="${DEER_H}" fill="none" stroke="url(#bd-deer-rim)" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`
  },

  cat: {
    name: 'Chat',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>
    <radialGradient id="bd-cat-head" cx="35%" cy="22%" r="87%">
      <stop offset="0" stop-color="#cbc4bd"/><stop offset=".5" stop-color="#948d89"/><stop offset="1" stop-color="#4c4642"/>
    </radialGradient>
    <radialGradient id="bd-cat-chest" cx="40%" cy="14%" r="92%">
      <stop offset="0" stop-color="#8e8782"/><stop offset=".55" stop-color="#6f6864"/><stop offset="1" stop-color="#3c3733"/>
    </radialGradient>
    <linearGradient id="bd-cat-floor" gradientUnits="userSpaceOnUse" x1="0" y1="48" x2="0" y2="69">
      <stop offset="0" stop-color="#2f2a27" stop-opacity="0"/><stop offset="1" stop-color="#2f2a27" stop-opacity=".5"/>
    </linearGradient>
    <linearGradient id="bd-cat-bfloor" gradientUnits="userSpaceOnUse" x1="0" y1="72" x2="0" y2="92">
      <stop offset="0" stop-color="#241f1c" stop-opacity="0"/><stop offset="1" stop-color="#241f1c" stop-opacity=".55"/>
    </linearGradient>
    <radialGradient id="bd-cat-spec" gradientUnits="userSpaceOnUse" cx="38" cy="33" r="24">
      <stop offset="0" stop-color="#fbf6ee" stop-opacity=".28"/><stop offset="1" stop-color="#fbf6ee" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-cat-neck" gradientUnits="userSpaceOnUse" cx="50" cy="62" r="22">
      <stop offset="0" stop-color="#221d1a" stop-opacity=".66"/><stop offset="1" stop-color="#221d1a" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-cat-muz" cx="40%" cy="22%" r="92%">
      <stop offset="0" stop-color="#efe9df"/><stop offset=".6" stop-color="#d5cec4"/><stop offset="1" stop-color="#9c948c"/>
    </radialGradient>
    <radialGradient id="bd-cat-nose" gradientUnits="userSpaceOnUse" cx="47.6" cy="57.8" r="10">
      <stop offset="0" stop-color="#d29a95"/><stop offset="1" stop-color="#96635f"/>
    </radialGradient>
    <radialGradient id="bd-cat-ear" cx="36%" cy="86%" r="96%">
      <stop offset="0" stop-color="#a29b96"/><stop offset="1" stop-color="#565049"/>
    </radialGradient>
    <radialGradient id="bd-cat-earin" cx="46%" cy="82%" r="90%">
      <stop offset="0" stop-color="#b8837f"/><stop offset="1" stop-color="#6d4744"/>
    </radialGradient>
    <linearGradient id="bd-cat-tail" gradientUnits="userSpaceOnUse" x1="66" y1="87" x2="84" y2="68">
      <stop offset="0" stop-color="#5d5753"/><stop offset="1" stop-color="#8f8883"/>
    </linearGradient>
    <linearGradient id="bd-cat-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e6e9e2" stop-opacity=".78"/><stop offset=".33" stop-color="#e6e9e2" stop-opacity="0"/>
      <stop offset=".78" stop-color="#e6e9e2" stop-opacity="0"/><stop offset="1" stop-color="#e6e9e2" stop-opacity=".2"/>
    </linearGradient>
    ${eyeDefs('bd-cat', { lift: '#6d6a3f', iris: '#242120', deep: '#0b0a09', socket: '#2b2725', lidTop: '#a49d97', lidBot: '#786f6b' })}
  </defs>
  <path d="M28.6 41L30.6 14.8 47.6 29.6Z" fill="url(#bd-cat-ear)" stroke="url(#bd-cat-ear)" stroke-width="3" stroke-linejoin="round"/>
  <path d="M31.4 37.6L32.8 20.4 43.8 30.6Z" fill="url(#bd-cat-earin)" stroke="url(#bd-cat-earin)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M71.4 40.8L70.2 14 52.6 29.2Z" fill="url(#bd-cat-ear)" stroke="url(#bd-cat-ear)" stroke-width="3" stroke-linejoin="round"/>
  <path d="M68.7 37.4L67.8 19.8 56.4 30.2Z" fill="url(#bd-cat-earin)" stroke="url(#bd-cat-earin)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M67 84.2C78 84.6 83.6 78 81.6 70.4" fill="none" stroke="url(#bd-cat-tail)" stroke-width="8" stroke-linecap="round"/>
  <path d="${CAT_B}" fill="url(#bd-cat-chest)"/>
  <path d="${CAT_B}" fill="url(#bd-cat-bfloor)"/>
  <ellipse cx="50" cy="80.6" rx="10.6" ry="8" fill="#ddd6cc" opacity=".2"/>
  <path d="${CAT_B}" fill="none" stroke="url(#bd-cat-rim)" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="${CAT_B}" fill="url(#bd-cat-neck)"/>
  <path d="${CAT_H}" fill="url(#bd-cat-head)"/>
  <path d="${CAT_H}" fill="url(#bd-cat-floor)"/>
  <path d="${CAT_H}" fill="url(#bd-cat-spec)"/>
  <ellipse cx="44.4" cy="62.2" rx="7.8" ry="5.4" fill="url(#bd-cat-muz)"/>
  <ellipse cx="55.6" cy="62.2" rx="7.8" ry="5.4" fill="url(#bd-cat-muz)"/>
  <path d="M50 57C52.9 57 54.6 58.2 54.6 59.8 54.6 61.8 52.3 63.6 50 63.6 47.7 63.6 45.4 61.8 45.4 59.8 45.4 58.2 47.1 57 50 57Z" fill="url(#bd-cat-nose)"/>
  <ellipse cx="48" cy="58.4" rx="1.7" ry="1.1" fill="#ffffff" opacity=".3"/>
  <path d="M50 63.8V65.2M50 65.2Q46.8 67.9 44 65.4M50 65.2Q53.2 67.9 56 65.4" fill="none" stroke="#4f4844" stroke-width="1.5" stroke-linecap="round" opacity=".8"/>
  <g fill="none" stroke="#dfe2da" stroke-width="1.5" stroke-linecap="round" opacity=".42">
    <path d="M31 60.4C24 58.8 17 58 10.6 58.8"/>
    <path d="M31.6 64.6C24.6 65 17.6 66.6 11.8 69"/>
    <path d="M69 60C76 58.4 83 57.8 89.4 58.6"/>
    <path d="M68.6 64.4C75.4 65 82.4 66.6 88.2 69.2"/>
  </g>
  ${gaze('bd-cat', 38.6, 50.2, 6, '#ffe0c0', 1.55)}
  ${gaze('bd-cat', 61.4, 50.8, 5.8, '#ffe0c0', 1.85)}
  <path d="${CAT_H}" fill="none" stroke="url(#bd-cat-rim)" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`
  },

  fox: {
    name: 'Renard',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>
    <radialGradient id="bd-fox-head" cx="35%" cy="21%" r="87%">
      <stop offset="0" stop-color="#e29b5f"/><stop offset=".5" stop-color="#bd7040"/><stop offset="1" stop-color="#6a3a20"/>
    </radialGradient>
    <radialGradient id="bd-fox-chest" cx="40%" cy="14%" r="92%">
      <stop offset="0" stop-color="#b06437"/><stop offset=".55" stop-color="#8c4d2a"/><stop offset="1" stop-color="#502b18"/>
    </radialGradient>
    <linearGradient id="bd-fox-floor" gradientUnits="userSpaceOnUse" x1="0" y1="50" x2="0" y2="72">
      <stop offset="0" stop-color="#48230f" stop-opacity="0"/><stop offset="1" stop-color="#48230f" stop-opacity=".5"/>
    </linearGradient>
    <linearGradient id="bd-fox-bfloor" gradientUnits="userSpaceOnUse" x1="0" y1="73" x2="0" y2="92">
      <stop offset="0" stop-color="#361a0d" stop-opacity="0"/><stop offset="1" stop-color="#361a0d" stop-opacity=".55"/>
    </linearGradient>
    <radialGradient id="bd-fox-spec" gradientUnits="userSpaceOnUse" cx="38" cy="33" r="24">
      <stop offset="0" stop-color="#fff0d8" stop-opacity=".3"/><stop offset="1" stop-color="#fff0d8" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-fox-neck" gradientUnits="userSpaceOnUse" cx="50" cy="64" r="23">
      <stop offset="0" stop-color="#3a1a0b" stop-opacity=".66"/><stop offset="1" stop-color="#3a1a0b" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-fox-muz" cx="40%" cy="20%" r="92%">
      <stop offset="0" stop-color="#f6e8d3"/><stop offset=".58" stop-color="#dccbb0"/><stop offset="1" stop-color="#a38a6d"/>
    </radialGradient>
    <radialGradient id="bd-fox-ruff" cx="42%" cy="20%" r="94%">
      <stop offset="0" stop-color="#eddcc2"/><stop offset=".6" stop-color="#c8b192"/><stop offset="1" stop-color="#7d6448"/>
    </radialGradient>
    <radialGradient id="bd-fox-nose" gradientUnits="userSpaceOnUse" cx="47.4" cy="53" r="11">
      <stop offset="0" stop-color="#6a4737"/><stop offset="1" stop-color="#2e1f19"/>
    </radialGradient>
    <radialGradient id="bd-fox-ear" cx="34%" cy="88%" r="96%">
      <stop offset="0" stop-color="#d4823f"/><stop offset="1" stop-color="#7a3f1e"/>
    </radialGradient>
    <radialGradient id="bd-fox-earin" cx="46%" cy="84%" r="92%">
      <stop offset="0" stop-color="#5a4038"/><stop offset="1" stop-color="#2c1e1a"/>
    </radialGradient>
    <linearGradient id="bd-fox-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd6a4" stop-opacity=".82"/><stop offset=".33" stop-color="#ffd6a4" stop-opacity="0"/>
      <stop offset=".78" stop-color="#ffd6a4" stop-opacity="0"/><stop offset="1" stop-color="#ffd6a4" stop-opacity=".2"/>
    </linearGradient>
    ${eyeDefs('bd-fox', { lift: '#7a5326', iris: '#2e1d10', deep: '#100a05', socket: '#4a2712', lidTop: '#cb7c47', lidBot: '#96552e' })}
  </defs>
  <path d="M26.4 40.6L23.4 13.2 46.4 28.4Z" fill="url(#bd-fox-ear)" stroke="url(#bd-fox-ear)" stroke-width="3" stroke-linejoin="round"/>
  <path d="M29.6 37L27.4 19.8 42 29.4Z" fill="url(#bd-fox-earin)" stroke="url(#bd-fox-earin)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M73.8 40L77.4 14.2 54 28.8Z" fill="url(#bd-fox-ear)" stroke="url(#bd-fox-ear)" stroke-width="3" stroke-linejoin="round"/>
  <path d="M70.8 36.6L73 20.6 58.4 29.6Z" fill="url(#bd-fox-earin)" stroke="url(#bd-fox-earin)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M34.6 49.4 21.4 55.6 27.8 58.6 18.6 64.4 27.2 66.2 22.8 72.2 35.8 70.6Z" fill="url(#bd-fox-ruff)" stroke="url(#bd-fox-ruff)" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M65.6 50 78.4 56.4 72.2 59.2 81.2 65 72.6 66.6 76.8 72.6 64.2 71.2Z" fill="url(#bd-fox-ruff)" stroke="url(#bd-fox-ruff)" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="${FOX_B}" fill="url(#bd-fox-chest)"/>
  <path d="${FOX_B}" fill="url(#bd-fox-bfloor)"/>
  <ellipse cx="50" cy="81" rx="11" ry="8.4" fill="#f0dcc0" opacity=".22"/>
  <path d="${FOX_B}" fill="none" stroke="url(#bd-fox-rim)" stroke-width="1.5" stroke-linejoin="round"/>
  <path d="${FOX_B}" fill="url(#bd-fox-neck)"/>
  <path d="${FOX_H}" fill="url(#bd-fox-head)"/>
  <path d="${FOX_H}" fill="url(#bd-fox-floor)"/>
  <path d="${FOX_H}" fill="url(#bd-fox-spec)"/>
  <path d="M50 51.4C56.2 51.4 61.6 56.2 61.6 62.2 61.6 67.8 56.2 71.6 50 71.6 43.8 71.6 38.4 67.8 38.4 62.2 38.4 56.2 43.8 51.4 50 51.4Z" fill="url(#bd-fox-muz)"/>
  <path d="M50 52.2C53.6 52.2 55.9 53.6 55.9 55.5 55.9 57.9 52.8 60 50 60 47.2 60 44.1 57.9 44.1 55.5 44.1 53.6 46.4 52.2 50 52.2Z" fill="url(#bd-fox-nose)"/>
  <ellipse cx="47.4" cy="54" rx="2" ry="1.3" fill="#ffffff" opacity=".24"/>
  <path d="M50 60.4V62.1M50 62.1Q46.4 65.6 43.4 62.6M50 62.1Q53.6 65.6 56.6 62.6" fill="none" stroke="#63432c" stroke-width="1.5" stroke-linecap="round" opacity=".75"/>
  ${gaze('bd-fox', 38.2, 47.4, 6, '#ffd0a0', 1.5)}
  ${gaze('bd-fox', 61.8, 48, 5.8, '#ffd0a0', 1.85)}
  <path d="${FOX_H}" fill="none" stroke="url(#bd-fox-rim)" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`
  },

  owl: {
    name: 'Hibou',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>
    <radialGradient id="bd-owl-body" cx="34%" cy="18%" r="88%">
      <stop offset="0" stop-color="#b0916c"/><stop offset=".5" stop-color="#836a4c"/><stop offset="1" stop-color="#3c2f20"/>
    </radialGradient>
    <linearGradient id="bd-owl-floor" gradientUnits="userSpaceOnUse" x1="0" y1="62" x2="0" y2="90">
      <stop offset="0" stop-color="#2e2317" stop-opacity="0"/><stop offset="1" stop-color="#2e2317" stop-opacity=".6"/>
    </linearGradient>
    <radialGradient id="bd-owl-spec" gradientUnits="userSpaceOnUse" cx="36" cy="32" r="24">
      <stop offset="0" stop-color="#fff3dc" stop-opacity=".28"/><stop offset="1" stop-color="#fff3dc" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-owl-disc" cx="38%" cy="20%" r="90%">
      <stop offset="0" stop-color="#f7e6c8"/><stop offset=".58" stop-color="#e0c9a3"/><stop offset="1" stop-color="#a98d68"/>
    </radialGradient>
    <linearGradient id="bd-owl-dfloor" gradientUnits="userSpaceOnUse" x1="0" y1="52" x2="0" y2="73">
      <stop offset="0" stop-color="#5b4526" stop-opacity="0"/><stop offset="1" stop-color="#5b4526" stop-opacity=".42"/>
    </linearGradient>
    <radialGradient id="bd-owl-chest" cx="42%" cy="18%" r="92%">
      <stop offset="0" stop-color="#d9c19c" stop-opacity=".85"/><stop offset="1" stop-color="#a98c66" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bd-owl-wing" gradientUnits="userSpaceOnUse" x1="26" y1="44" x2="34" y2="78">
      <stop offset="0" stop-color="#7a6146"/><stop offset="1" stop-color="#2f2417"/>
    </linearGradient>
    <linearGradient id="bd-owl-wing2" gradientUnits="userSpaceOnUse" x1="74" y1="44" x2="66" y2="78">
      <stop offset="0" stop-color="#725a41"/><stop offset="1" stop-color="#2b2115"/>
    </linearGradient>
    <linearGradient id="bd-owl-beak" gradientUnits="userSpaceOnUse" x1="46" y1="55" x2="54" y2="69">
      <stop offset="0" stop-color="#e8b45c"/><stop offset="1" stop-color="#9c6a24"/>
    </linearGradient>
    <radialGradient id="bd-owl-tuft" cx="40%" cy="82%" r="96%">
      <stop offset="0" stop-color="#a68a67"/><stop offset="1" stop-color="#57452f"/>
    </radialGradient>
    <linearGradient id="bd-owl-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f6e2be" stop-opacity=".82"/><stop offset=".3" stop-color="#f6e2be" stop-opacity="0"/>
      <stop offset=".8" stop-color="#f6e2be" stop-opacity="0"/><stop offset="1" stop-color="#f6e2be" stop-opacity=".2"/>
    </linearGradient>
    <clipPath id="bd-owl-clip"><path d="${OWL_M}"/></clipPath>
    ${eyeDefs('bd-owl', { lift: '#8a6326', iris: '#2a1d0e', deep: '#0e0904', socket: '#3d2c16', lidTop: '#e4cda9', lidBot: '#b09877' })}
  </defs>
  <path d="M34.2 30.6 29.6 15.4 39.2 23 39.2 30Z" fill="url(#bd-owl-tuft)" stroke="url(#bd-owl-tuft)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M65.8 30.2 70.6 15 61 22.6 61 29.6Z" fill="url(#bd-owl-tuft)" stroke="url(#bd-owl-tuft)" stroke-width="2" stroke-linejoin="round"/>
  <path d="${OWL_M}" fill="url(#bd-owl-body)"/>
  <path d="${OWL_M}" fill="url(#bd-owl-floor)"/>
  <path d="${OWL_M}" fill="url(#bd-owl-spec)"/>
  <g clip-path="url(#bd-owl-clip)">
    <path d="M28.2 45.6C22.8 50.4 21 60 23.2 69.2 24.8 75.8 29.4 78.2 33 74.6 36.2 71.4 37.6 61.8 36.4 52.6 35.4 45.8 31.6 42.8 28.2 45.6Z" fill="url(#bd-owl-wing)" stroke="#b0906a" stroke-width="1.4" stroke-linejoin="round" stroke-opacity=".5"/>
    <path d="M72 45C77.4 49.6 79.4 59.2 77.4 68.4 75.9 75 71.4 77.6 67.7 74.1 64.4 71 62.8 61.4 63.8 52.2 64.7 45.4 68.5 42.3 72 45Z" fill="url(#bd-owl-wing2)" stroke="#a3855f" stroke-width="1.4" stroke-linejoin="round" stroke-opacity=".5"/>
  </g>
  <ellipse cx="50" cy="75.6" rx="15.4" ry="11.4" fill="url(#bd-owl-chest)"/>
  <g fill="none" stroke="#6b5539" stroke-width="1.6" stroke-linecap="round" opacity=".42">
    <path d="M42.6 71.6Q45.6 74.2 48.6 71.6"/><path d="M52.4 72Q55.4 74.6 58.4 72"/>
    <path d="M39.6 78.6Q42.6 81.2 45.6 78.6"/><path d="M46.4 79.4Q49.4 82 52.4 79.4"/>
    <path d="M55.6 78.4Q58.6 81 61.6 78.4"/>
  </g>
  <ellipse cx="41" cy="88.4" rx="4.6" ry="3.3" fill="url(#bd-owl-beak)"/>
  <ellipse cx="59.2" cy="88.6" rx="4.4" ry="3.2" fill="url(#bd-owl-beak)"/>
  <path d="${OWL_D}" fill="url(#bd-owl-disc)" stroke="#6b563a" stroke-width="1.4" stroke-linejoin="round" stroke-opacity=".45"/>
  <path d="${OWL_D}" fill="url(#bd-owl-dfloor)"/>
  <path d="M50 55.6C53.2 55.6 55.2 57.2 55.2 59.4 55.2 62.8 52.6 66.6 50 68.6 47.4 66.6 44.8 62.8 44.8 59.4 44.8 57.2 46.8 55.6 50 55.6Z" fill="url(#bd-owl-beak)"/>
  <path d="M46.6 58.4C48.4 57.4 51.6 57.4 53.4 58.4" fill="none" stroke="#ffe2ab" stroke-width="1.3" stroke-linecap="round" opacity=".45"/>
  ${gaze('bd-owl', 38.9, 48.2, 7, '#ffd79a', 1.5)}
  ${gaze('bd-owl', 61.1, 48.8, 6.8, '#ffd79a', 1.85)}
  <path d="${OWL_M}" fill="none" stroke="url(#bd-owl-rim)" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`
  },

  blob: {
    name: 'Bloup',
    svg: `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"><defs>
    <radialGradient id="bd-blob-body" cx="34%" cy="20%" r="88%">
      <stop offset="0" stop-color="#a8d0c1"/><stop offset=".48" stop-color="#6f9d93"/><stop offset="1" stop-color="#2e4f4e"/>
    </radialGradient>
    <linearGradient id="bd-blob-floor" gradientUnits="userSpaceOnUse" x1="0" y1="60" x2="0" y2="89">
      <stop offset="0" stop-color="#1d3838" stop-opacity="0"/><stop offset="1" stop-color="#1d3838" stop-opacity=".6"/>
    </linearGradient>
    <radialGradient id="bd-blob-spec" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="#eafcf4" stop-opacity=".4"/><stop offset="1" stop-color="#eafcf4" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-blob-belly" gradientUnits="userSpaceOnUse" cx="50" cy="64" r="22">
      <stop offset="0" stop-color="#bfe2d5" stop-opacity=".62"/><stop offset=".68" stop-color="#a5d2c5" stop-opacity=".3"/>
      <stop offset="1" stop-color="#a5d2c5" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="bd-blob-arm" cx="40%" cy="24%" r="94%">
      <stop offset="0" stop-color="#82b2a6"/><stop offset="1" stop-color="#33574f"/>
    </radialGradient>
    <linearGradient id="bd-blob-curl" gradientUnits="userSpaceOnUse" x1="50" y1="26" x2="57" y2="12">
      <stop offset="0" stop-color="#4b7770"/><stop offset="1" stop-color="#87bcae"/>
    </linearGradient>
    <radialGradient id="bd-blob-bulb" cx="36%" cy="26%" r="92%">
      <stop offset="0" stop-color="#c8ecdc"/><stop offset="1" stop-color="#5d908a"/>
    </radialGradient>
    <linearGradient id="bd-blob-rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#d5f2e4" stop-opacity=".8"/><stop offset=".3" stop-color="#d5f2e4" stop-opacity="0"/>
      <stop offset=".78" stop-color="#d5f2e4" stop-opacity="0"/><stop offset="1" stop-color="#d5f2e4" stop-opacity=".24"/>
    </linearGradient>
    ${eyeDefs('bd-blob', { lift: '#43776f', iris: '#173231', deep: '#071616', socket: '#1d3c3b', lidTop: '#8fbcae', lidBot: '#5f8b83' })}
  </defs>
  <ellipse cx="17.6" cy="69.4" rx="5.6" ry="7" transform="rotate(-22 17.6 69.4)" fill="url(#bd-blob-arm)"/>
  <ellipse cx="82.8" cy="67.6" rx="5.4" ry="6.8" transform="rotate(20 82.8 67.6)" fill="url(#bd-blob-arm)"/>
  <path d="M50.6 26.4C50.8 20.6 52.6 16.4 55.6 13.6" fill="none" stroke="url(#bd-blob-curl)" stroke-width="3.6" stroke-linecap="round"/>
  <circle cx="57.2" cy="11.8" r="3.5" fill="url(#bd-blob-bulb)"/>
  <path d="${BLOB_M}" fill="url(#bd-blob-body)"/>
  <path d="${BLOB_M}" fill="url(#bd-blob-floor)"/>
  <ellipse cx="38" cy="34.6" rx="15.4" ry="10" transform="rotate(-26 38 34.6)" fill="url(#bd-blob-spec)"/>
  <ellipse cx="50" cy="66" rx="21.4" ry="17" fill="url(#bd-blob-belly)"/>
  <ellipse cx="28.8" cy="62.6" rx="5.8" ry="3.7" fill="#d98a72" opacity=".26"/>
  <ellipse cx="71.4" cy="63.2" rx="5.6" ry="3.6" fill="#d98a72" opacity=".26"/>
  ${gaze('bd-blob', 38.8, 50.8, 6.4, '#cfeee0', 1.5)}
  ${gaze('bd-blob', 61.2, 51.4, 6.2, '#cfeee0', 1.85)}
  <path d="M42.2 65.8Q50 72.8 57.8 65.6" fill="none" stroke="#23413f" stroke-width="2.8" stroke-linecap="round" opacity=".9"/>
  <path d="M43.4 66.6Q50 72.2 56.6 66.4" fill="none" stroke="#7fb6a8" stroke-width="1.3" stroke-linecap="round" opacity=".35"/>
  <path d="${BLOB_M}" fill="none" stroke="url(#bd-blob-rim)" stroke-width="1.6" stroke-linejoin="round"/>
</svg>`
  }
};

export function petMarkup(settings) {
  if (settings.petSprite === 'custom' && settings.petImage) {
    return `<img src="${settings.petImage}" alt="">`;
  }
  return (PETS[settings.petSprite] ?? PETS.deer).svg;
}
