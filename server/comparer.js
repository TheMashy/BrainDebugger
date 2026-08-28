/**
 * Comparer à la normale.
 *
 * LE MODELE CHOISIT LE FAIT, LE SERVEUR POSSEDE LE NOMBRE.
 *
 * Un modele a qui on demande « donne un chiffre » en invente un, et il le
 * formule si bien qu'on ne peut pas le distinguer d'un vrai. Sur une
 * application qui rend a quelqu'un sa propre vie, un chiffre faux est pire
 * qu'aucun chiffre : il se retient, il se repete, et il oriente ce que la
 * personne croit savoir d'elle.
 *
 * Alors ce fichier calcule TOUTES les comparaisons possibles, les etiquette
 * (c1, c2...), et le modele ne rend qu'une etiquette. La phrase affichee est
 * celle d'ici. Il n'y a aucun chemin par lequel un nombre invente puisse
 * arriver a l'ecran.
 *
 * CE QU'ON NE COMPARE PAS
 * Rien qui puisse se lire comme un verdict. Ces lignes disent « les dimanches
 * sont plus bas que les autres jours », un fait sur des jours ; jamais « tu vas
 * moins bien le dimanche », un fait sur quelqu'un. La difference n'est pas
 * cosmetique : la premiere se verifie, la seconde s'encaisse.
 */

const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
              'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/*
 * DEUX GARDE-FOUS, ET ILS FONT TOUT LE TRAVAIL.
 *
 * MIN_COTE : huit journees de chaque cote. En dessous, la moyenne d'un cote
 * bouge d'un demi-point quand une seule journee change, et on aurait publie du
 * bruit avec la meme assurance qu'un fait.
 *
 * MIN_ECART : quatre dixiemes. En dessous, l'ecart tient dans l'arrondi de la
 * note elle-meme -- quelqu'un qui hesite entre 6 et 7 produit cet ecart-la sans
 * que rien n'ait change dans sa vie.
 */
export const MIN_COTE = 8;
export const MIN_ECART = 0.4;

const arrondi = n => Math.round(n * 10) / 10;
const moyenne = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const jourSemaine = d => (new Date(Date.parse(d + 'T00:00:00Z')).getUTCDay() + 6) % 7;
const jourMs = d => Date.parse(d + 'T00:00:00Z');

/** Une comparaison, ou null si elle ne tient pas debout. */
function comparer(id, phrase, dedans, dehors) {
  if (dedans.length < MIN_COTE || dehors.length < MIN_COTE) return null;
  const a = moyenne(dedans), b = moyenne(dehors);
  if (Math.abs(a - b) < MIN_ECART) return null;
  return {
    id,
    phrase: phrase(arrondi(a), arrondi(b), dedans.length),
    ecart: arrondi(a - b),
    n: dedans.length
  };
}

/**
 * @param {{date:string, note:number|null, text:string|null}[]} rows
 * @param {{date:string, fin:string|null, label:string}[]} events
 * @returns {{id:string, phrase:string, ecart:number, n:number}[]}
 */
export function comparaisons(rows, events = []) {
  const notees = (rows ?? []).filter(r => r.note !== null && r.note !== undefined);
  if (notees.length < MIN_COTE * 2) return [];

  const out = [];
  let n = 0;
  const pousser = c => { if (c) out.push(c); };
  const id = () => `c${++n}`;

  /* --- les jours de la semaine --- */
  for (let j = 0; j < 7; j++) {
    const dedans = notees.filter(r => jourSemaine(r.date) === j).map(r => r.note);
    const dehors = notees.filter(r => jourSemaine(r.date) !== j).map(r => r.note);
    pousser(comparer(id(), (a, b, k) =>
      `les ${JOURS[j]}s sont à ${a} de moyenne, contre ${b} les autres jours (${k} ${JOURS[j]}s)`,
      dedans, dehors));
  }

  /* --- les mois de l'année --- */
  for (let m = 1; m <= 12; m++) {
    const cle = String(m).padStart(2, '0');
    const dedans = notees.filter(r => r.date.slice(5, 7) === cle).map(r => r.note);
    const dehors = notees.filter(r => r.date.slice(5, 7) !== cle).map(r => r.note);
    pousser(comparer(id(), (a, b, k) =>
      `les mois de ${MOIS[m - 1]} sont à ${a}, contre ${b} le reste de l'année (${k} journées)`,
      dedans, dehors));
  }

  /* --- écrire, ou ne pas écrire ---
     Une corrélation, jamais une cause : on ne sait pas si écrire fait remonter
     ou si remonter donne envie d'écrire, et la phrase ne le suppose pas. */
  {
    const dedans = notees.filter(r => r.text && r.text.trim()).map(r => r.note);
    const dehors = notees.filter(r => !r.text || !r.text.trim()).map(r => r.note);
    pousser(comparer(id(), (a, b, k) =>
      `les journées où tu écris sont à ${a}, celles où tu ne notes qu'un chiffre à ${b} (${k} journées écrites)`,
      dedans, dehors));
  }

  /* --- les journées longues ---
     Le cinquieme le plus fourni contre le reste. Le seuil est un QUANTILE et
     pas un nombre de signes : « long » ne veut pas dire la meme chose chez
     quelqu'un qui ecrit trois lignes et chez quelqu'un qui en ecrit trente. */
  {
    const ecrites = notees.filter(r => r.text && r.text.trim());
    if (ecrites.length >= MIN_COTE * 2) {
      const tailles = ecrites.map(r => r.text.length).sort((a, b) => a - b);
      const seuil = tailles[Math.floor(tailles.length * 0.8)];
      const dedans = ecrites.filter(r => r.text.length >= seuil).map(r => r.note);
      const dehors = ecrites.filter(r => r.text.length < seuil).map(r => r.note);
      pousser(comparer(id(), (a, b, k) =>
        `tes journées les plus écrites sont à ${a}, les autres à ${b} (${k} journées)`,
        dedans, dehors));
    }
  }

  /* --- le lendemain d'une journée basse --- */
  {
    const parDate = new Map(notees.map(r => [r.date, r.note]));
    const apresBasse = [], reste = [];
    for (const r of notees) {
      const veille = parDate.get(new Date(jourMs(r.date) - 86400000).toISOString().slice(0, 10));
      if (veille === undefined) continue;
      (veille <= 3 ? apresBasse : reste).push(r.note);
    }
    pousser(comparer(id(), (a, b, k) =>
      `le lendemain d'une journée à 3 ou moins, tu es à ${a} ; les autres lendemains, à ${b} (${k} fois)`,
      apresBasse, reste));
  }

  /* --- les deux semaines qui suivent un repère --- */
  {
    const bornes = (events ?? []).map(e => e.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (bornes.length) {
      const proche = d => bornes.some(b => {
        const k = (jourMs(d) - jourMs(b)) / 86400000;
        return k >= 0 && k < 14;
      });
      const dedans = notees.filter(r => proche(r.date)).map(r => r.note);
      const dehors = notees.filter(r => !proche(r.date)).map(r => r.note);
      pousser(comparer(id(), (a, b, k) =>
        `les deux semaines qui suivent un repère sont à ${a}, le reste à ${b} (${k} journées)`,
        dedans, dehors));
    }
  }

  // Les plus gros écarts d'abord : c'est ce qui a une chance d'apprendre
  // quelque chose. Douze, parce qu'au-delà on demande au modèle de choisir dans
  // un catalogue au lieu de lire.
  return out.sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart)).slice(0, 12);
}

/** Le bloc transmis au modèle. Les identifiants sont ce qu'il rendra. */
export function comparaisonBlock(liste) {
  if (!liste?.length) return null;
  return `DES COMPARAISONS DÉJÀ CALCULÉES. Elles sont exactes — elles sortent de ses notes,
pas de toi. Chacune porte un identifiant.

Quand un thème repose sur l'une d'elles, mets son identifiant dans « chiffre ». Tu ne
recopies PAS le nombre et tu n'en écris aucun autre : l'application affichera la phrase
exacte à la place. Un chiffre inventé se retient, se répète, et oriente ce qu'elle croit
savoir d'elle.

Si aucune ne correspond au thème, laisse « chiffre » vide. Un thème sans chiffre est un
thème normal ; un thème avec le mauvais chiffre est un thème faux.

${liste.map(c => `[${c.id}] ${c.phrase}`).join('\n')}`;
}
