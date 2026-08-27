/**
 * Un calendrier, une fois, pour tout le monde.
 *
 * POURQUOI PAS <input type="date">
 * Il rend « 08/27/2026 » dans un navigateur configure en anglais, ouvre un
 * panneau que la page ne controle pas, et surtout : il ne sait selectionner
 * qu'UNE date. Une periode -- une addiction, un contrat, une relation -- se
 * saisit alors avec deux champs cote a cote, et rien ne montre l'intervalle
 * qu'on est en train de choisir. On clique une date, puis une autre, en
 * esperant qu'elles vont ensemble.
 *
 * Ici on voit la plage pendant qu'on la trace.
 *
 * TROIS NIVEAUX, PARCE QU'UN REPERE PEUT AVOIR TRENTE ANS
 * Un repere d'enfance sur un calendrier qui n'avance que d'un mois demande
 * trois cent trente-six clics. Le libelle du mois ouvre les douze mois, celui
 * de l'annee ouvre douze annees : trois clics pour aller n'importe ou.
 *
 * CE MODULE NE TOUCHE PAS AU DOM. Du texte entre, du markup sort -- comme
 * reperes.js et frise.js, et pour la meme raison : il est teste sans
 * navigateur, et il ne peut pas diverger d'un appelant a l'autre.
 */

const JOUR_MS = 86400000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MOIS_COURT = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin',
  'juil', 'août', 'sep', 'oct', 'nov', 'déc'];

/** Lundi en premier : c'est la semaine telle qu'elle se vit ici. */
const JOURS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

const jourDe = d => Date.parse(d + 'T00:00:00Z');
const iso = t => new Date(t).toISOString().slice(0, 10);

export const estDate = d => typeof d === 'string' && ISO.test(d);

/** Le mois d'une date, ou le mois courant si elle n'en est pas une. */
export const moisDe = (d, defaut) => estDate(d) ? d.slice(0, 7) : defaut;

/**
 * Decale un mois de n mois. Passe par UTC : l'arithmetique naive sur
 * « AAAA-MM » deborde a 12 et a 0, et le 31 janvier moins un mois donne le
 * 3 mars sur une Date locale.
 */
export function decalerMois(mois, n) {
  const [a, m] = mois.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Les 42 cases d'un mois : six semaines pleines, toujours.
 *
 * Toujours six, jamais cinq : un calendrier qui change de hauteur en changeant
 * de mois fait sauter tout ce qui est en dessous, et sur un panneau flottant il
 * saute sous le curseur au moment ou on vise une case.
 */
export function grilleMois(mois) {
  const [a, m] = mois.split('-').map(Number);
  const premier = Date.UTC(a, m - 1, 1);
  const dow = (new Date(premier).getUTCDay() + 6) % 7;      // lundi = 0
  const depart = premier - dow * JOUR_MS;
  return Array.from({ length: 42 }, (_, i) => {
    const d = iso(depart + i * JOUR_MS);
    return { date: d, hors: d.slice(0, 7) !== mois, dim: Number(d.slice(8)) };
  });
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const borne = (d, min, max) => (!min || d >= min) && (!max || d <= max);

/**
 * @param {object} o
 * @param {'jour'|'mois'|'an'} o.vue     le niveau ouvert
 * @param {string} o.curseur             « AAAA-MM » affiche
 * @param {string|null} o.debut          selection : la premiere borne
 * @param {string|null} o.fin            selection : la seconde, si plage
 * @param {boolean} o.plage              deux bornes au lieu d'une
 * @param {string} o.min @param {string} o.max
 * @param {string|null} o.aujourdhui
 * @param {(date:string) => ({couleur?:string, ecrit?:boolean}|null)} [o.jour]
 *        de quoi teinter une case -- le Miroir s'en sert pour montrer les notes.
 * @returns {string}
 */
export function calMarkup({ vue = 'jour', curseur, debut = null, fin = null,
                            plage = false, min = '1900-01-01', max = null,
                            aujourdhui = null, jour = null } = {}) {
  const [an, mo] = curseur.split('-').map(Number);

  const tete = `<div class="calhead">
    <button type="button" class="calnav" data-cal="prec" aria-label="Précédent">‹</button>
    <button type="button" class="calmois" data-cal="vue-mois" aria-expanded="${vue === 'mois'}">${MOIS_LONG[mo - 1]}</button>
    <button type="button" class="calan" data-cal="vue-an" aria-expanded="${vue === 'an'}">${an}</button>
    <button type="button" class="calnav" data-cal="suiv" aria-label="Suivant">›</button>
  </div>`;

  if (vue === 'mois') {
    return `<div class="cal">${tete}<div class="calgrid mois">${
      MOIS_COURT.map((nom, i) => {
        const m = `${an}-${String(i + 1).padStart(2, '0')}`;
        // Un mois est atteignable des qu'il CROISE les bornes : le mois du max
        // contient des jours valides meme si son 31 les depasse.
        const ouvert = (!min || m >= min.slice(0, 7)) && (!max || m <= max.slice(0, 7));
        return `<button type="button" data-cal="mois" data-m="${i + 1}"
          ${ouvert ? '' : 'disabled'} aria-pressed="${i + 1 === mo}">${nom}</button>`;
      }).join('')}</div></div>`;
  }

  if (vue === 'an') {
    const base = an - 5;
    return `<div class="cal">${tete}<div class="calgrid ans">${
      Array.from({ length: 12 }, (_, i) => {
        const y = base + i;
        const ouvert = (!min || y >= Number(min.slice(0, 4))) && (!max || y <= Number(max.slice(0, 4)));
        return `<button type="button" data-cal="an" data-a="${y}"
          ${ouvert ? '' : 'disabled'} aria-pressed="${y === an}">${y}</button>`;
      }).join('')}</div></div>`;
  }

  const b = estDate(debut) ? debut : null;
  const f = plage && estDate(fin) ? fin : null;
  const lo = b && f ? (b < f ? b : f) : b;
  const hi = b && f ? (b < f ? f : b) : b;

  const cases = grilleMois(curseur).map(c => {
    const info = jour?.(c.date) ?? null;
    const cls = ['calj'];
    if (c.hors) cls.push('hors');
    if (c.date === aujourdhui) cls.push('hui');
    if (c.date === lo) cls.push('borne', 'lo');
    if (hi && c.date === hi && hi !== lo) cls.push('borne', 'hi');
    if (lo && hi && c.date > lo && c.date < hi) cls.push('entre');
    if (info?.ecrit) cls.push('ecrit');
    // La teinte est une option du Miroir : elle n'a de sens que sur un journal.
    // Le calendrier d'un composeur de repère n'en reçoit jamais.
    if (info?.couleur) cls.push('teinte');
    const ok = borne(c.date, min, max);
    return `<button type="button" class="${cls.join(' ')}" data-cal="jour" data-d="${c.date}"
      ${ok ? '' : 'disabled'} ${info?.couleur ? `style="--jc:${esc(info.couleur)}"` : ''}
      >${c.dim}</button>`;
  }).join('');

  return `<div class="cal">
    ${tete}
    <div class="caldows">${JOURS.map(j => `<span>${j}</span>`).join('')}</div>
    <div class="calgrid jours">${cases}</div>
  </div>`;
}

/**
 * L'etat suivant apres un clic. Pure : rien n'est mute, rien n'est lu du DOM.
 *
 * @param {object} etat  { vue, curseur, debut, fin, plage }
 * @param {object} act   { cal, d, m, a } -- le dataset du bouton clique
 * @returns {object}     le nouvel etat
 */
export function calClic(etat, act) {
  const e = { ...etat };
  switch (act.cal) {
    case 'prec':
      e.curseur = e.vue === 'an' ? decalerMois(e.curseur, -144)
                : e.vue === 'mois' ? decalerMois(e.curseur, -12)
                : decalerMois(e.curseur, -1);
      return e;
    case 'suiv':
      e.curseur = e.vue === 'an' ? decalerMois(e.curseur, 144)
                : e.vue === 'mois' ? decalerMois(e.curseur, 12)
                : decalerMois(e.curseur, 1);
      return e;
    case 'vue-mois': e.vue = e.vue === 'mois' ? 'jour' : 'mois'; return e;
    case 'vue-an':   e.vue = e.vue === 'an' ? 'jour' : 'an';     return e;
    case 'mois':
      e.curseur = `${e.curseur.slice(0, 4)}-${String(Number(act.m)).padStart(2, '0')}`;
      e.vue = 'jour';
      return e;
    case 'an':
      e.curseur = `${act.a}-${e.curseur.slice(5)}`;
      e.vue = 'mois';
      return e;
    case 'jour': {
      const d = act.d;
      if (!e.plage) { e.debut = d; e.fin = null; return e; }
      /*
       * La plage se trace en deux clics, et le second peut tomber AVANT le
       * premier. On ordonne plutot que de refuser : quelqu'un qui clique la fin
       * puis le debut a dit exactement la meme chose, et un message d'erreur a
       * ce moment-la ne lui apprend rien qu'il ne sache deja.
       */
      if (!e.debut || e.fin) { e.debut = d; e.fin = null; return e; }
      if (d === e.debut) { e.fin = null; return e; }
      if (d < e.debut) { e.fin = e.debut; e.debut = d; } else { e.fin = d; }
      return e;
    }
    default: return e;
  }
}
