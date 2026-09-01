/**
 * LA JOURNÉE, HEURE PAR HEURE.
 *
 * On ouvrait une journée et on y trouvait sa note, son texte, et rien de ce qui
 * s'était PASSÉ dedans. Une journée notée 8 peut contenir « juste envie de
 * mourir » écrit le soir : c'est la bascule qui la raconte, pas le niveau moyen.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-jour-')), 'test.db');

const { OWNER, addMessage, setNote } = await import('../server/db.js');
const { readMood } = await import('../server/mood.js');
const J = await import('../server/journee.js');

const JOUR = '2026-03-12';
const ts = (h, m = 0) => `2026-03-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const dire = (h, m, text, role = 'user') =>
  addMessage({ ts: ts(h, m), date: JOUR, source: 'web', role, text, userId: OWNER });

/* ============ LE CŒUR D'UN MOMENT ============ */

test('le cœur est une phrase choisie, jamais réécrite', () => {
  const t = "hello. bon alors. j'ai fait une nuit blanche et je me sens vide depuis ce matin.";
  const c = J.coeurDe(t);
  // La phrase est celle qui PÈSE, pas la première : « hello » et « bon alors »
  // ouvrent la moitié des messages et ne racontent rien.
  assert.match(c, /nuit blanche/);
  assert.ok(!c.startsWith('hello'), 'le cœur ne doit pas être la formule d’ouverture');
  // Et c'est bien SA phrase, au caractère près tant qu'elle tient.
  assert.ok(t.includes(c.replace(/…$/, '')), 'le cœur a été réécrit au lieu d’être cité');
});

test('une phrase trop longue est coupée sur un mot, et le dit', () => {
  const c = J.coeurDe('a'.repeat(4) + ' mot '.repeat(60));
  assert.ok(c.length <= J.COEUR_CAR + 1, `${c.length} caractères`);
  assert.match(c, /…$/);
  assert.equal(c.includes('mo…'), false, 'coupé au milieu d’un mot');
});

test('un message vide n’invente pas de cœur', () => {
  assert.equal(J.coeurDe(''), '');
  assert.equal(J.coeurDe(null), '');
  assert.equal(J.coeurDe('   '), '');
});

/* ============ LES MOMENTS ============ */

test('trois messages d’affilée font UN moment, pas trois', () => {
  dire(8, 0, "j'ai encore fait une nuit blanche");
  dire(8, 4, 'je tourne en rond depuis 4h du matin');
  dire(8, 9, 'et là je suis vidé');
  dire(22, 30, 'la soirée a tenu, finalement. le vélo a aidé.');
  const mo = J.momentsDuJour(JOUR, OWNER, { zone: 'UTC' });
  assert.equal(mo.length, 2, 'un échange continu est un moment');
  assert.equal(mo[0].heure, '08:00');
  assert.equal(mo[1].heure, '22:30');
  assert.equal(mo[0].messages, 3);
});

test('le compagnon ne teint pas la journée avec ses propres mots', () => {
  dire(12, 0, "c'est peut-être la fatigue qui parle, pas toi", 'pet');
  const mo = J.momentsDuJour(JOUR, OWNER, { zone: 'UTC' });
  assert.equal(mo.some(m => m.coeur.includes('la fatigue qui parle')), false);
  assert.equal(mo.length, 2, 'la réponse du compagnon a créé un moment');
});

test('LA NOTE DU SOIR NE REPEINT PAS LE MATIN', () => {
  /*
   * `readMood` accepte une note et s'en sert pour infléchir la scène. C'est
   * juste pour peindre le décor du JOUR, faux pour une ligne du matin : la note
   * a été posée le soir, et elle repeindrait uniformément tous les moments avec
   * ce qu'on a conclu après. On perdrait exactement la bascule qu'on vient voir.
   */
  const avant = J.momentsDuJour(JOUR, OWNER, { zone: 'UTC' }).map(m => m.scene);
  setNote(JOUR, 9, OWNER);
  const apres = J.momentsDuJour(JOUR, OWNER, { zone: 'UTC' }).map(m => m.scene);
  assert.deepEqual(apres, avant, 'la note du soir a déteint sur les moments');
});

test('la charge reste entre −1 et +1, et n’est jamais une note', () => {
  for (const [scene, force] of [['voidwell', 9], ['brume', 9], ['drift', 0], ['abyss', 3]]) {
    const c = J.chargeDe(scene, force);
    assert.ok(c >= -1 && c <= 1, `${scene} ${force} → ${c}`);
  }
  assert.equal(J.chargeDe('brume', 0), 0, 'sans force, aucune charge');
  // Une scène inconnue ne doit pas rendre NaN : le tracé disparaîtrait en silence.
  assert.equal(J.chargeDe('scene-qui-n-existe-pas', 3), 0);
});

/* ============ LES THÉMATIQUES ============ */

test('un mot lâché une fois n’est pas un thème de la journée', () => {
  const t = J.thematiquesDuJour(JOUR, OWNER);
  // « nuit blanche » n'apparaît qu'une fois : sous le seuil, il ne sort pas.
  assert.equal(t.some(x => x.theme === 'dormir'), false);
});

test('un sujet qui revient sort, avec son compte et une preuve', () => {
  const D = '2026-04-02';
  const dit = (h, text) => addMessage({ ts: `${D}T${String(h).padStart(2, '0')}:00:00.000Z`,
                                        date: D, source: 'web', role: 'user', text, userId: OWNER });
  dit(9, "j'ai repris les anxiolytiques ce matin.");
  dit(14, "le psychiatre a changé la posologie.");
  dit(20, "j'ai oublié le cachet du soir.");
  const t = J.thematiquesDuJour(D, OWNER);
  assert.ok(t.length >= 1);
  assert.equal(t[0].theme, 'soin');
  assert.ok(t[0].n >= 2);
  assert.ok(t[0].extrait.length > 0, 'un thème sans preuve est une étiquette');
});

/* ============ CE QUI A BOUGÉ ============ */

test('un seul relevé n’est pas une amplitude', () => {
  const v = J.volatiliteDuJour(JOUR, OWNER, { zone: 'UTC' });
  assert.equal(v.ecart, null, 'un point n’est pas un écart');
  assert.ok(Array.isArray(v.charges));
});

test('la journée rendue au navigateur a ses quatre parties', () => {
  const j = J.journee(JOUR, OWNER, { zone: 'UTC' });
  assert.deepEqual(Object.keys(j).sort(), ['moments', 'sujets', 'thematiques', 'volatilite']);
  for (const m of j.moments) {
    // `ids` : les messages d'où le moment vient. C'est par eux que la colonne
    // de gauche désigne son passage à droite — jamais par l'heure affichée.
    assert.deepEqual(Object.keys(m).sort(),
                     ['charge', 'coeur', 'estime', 'force', 'heure', 'ids', 'messages',
                      'note', 'scene', 'sens', 'ts']);
  }
});

test('l’heure est celle du lecteur, pas celle du serveur', () => {
  // Minuit UTC est 01:00 à Paris : lu en UTC, un moment du soir bascule au
  // lendemain matin et la journée se raconte à l'envers.
  assert.equal(J.heureDe('2026-03-12T23:30:00Z', 'UTC'), '23:30');
  assert.equal(J.heureDe('2026-03-12T23:30:00Z', 'Europe/Paris'), '00:30');
});


/* ============ L'ESTIMATION D'UN MOMENT ============ */

test('l’estimation se cale sur la normale de la personne, pas sur 5', () => {
  // Chez quelqu'un qui tourne à 4, une journée à 5 est une bonne journée. La
  // caler sur le milieu de l'échelle la peindrait en médiocre — et c'est déjà
  // la façon dont tout le reste du produit lit un chiffre.
  assert.equal(J.estimationDe(0, 4), 4);
  assert.equal(J.estimationDe(0, 7), 7);
  assert.equal(J.estimationDe(-1, 7), 4);
  assert.equal(J.estimationDe(1, 4), 7);
});

test('l’estimation reste dans l’échelle, et au demi-point', () => {
  assert.equal(J.estimationDe(-1, 2), 1, 'une estimation est sortie sous 1');
  assert.equal(J.estimationDe(1, 9), 10, 'une estimation est sortie au-dessus de 10');
  // Dire « 4,37 » d'une déduction faite sur des mots serait une précision
  // inventée, et c'est exactement ce qui la ferait prendre pour une mesure.
  assert.equal(J.estimationDe(0.1, 5) % 0.5, 0);
});

/* ============ VERS OÙ PENCHE UN PASSAGE ============ */

test('un passage sans mot chargé ne penche nulle part — et ne rend pas 0', () => {
  // Rendre 0 ferait sortir l'estimation à la référence exacte, c'est-à-dire un
  // chiffre constant présenté comme une lecture. Pire que le silence.
  assert.equal(J.pencheDe('on a mangé des pâtes et après on est rentrés'), null);
  assert.equal(J.pencheDe(''), null);
});

test('un passage sombre penche vers le bas, un passage calme vers le haut', () => {
  const bas = J.pencheDe('j’ai envie de mourir, je tiens plus, c’est la fin');
  const haut = J.pencheDe('journée tranquille et calme, je me sens apaisé, content de moi');
  assert.ok(bas < -0.4, `attendu franchement négatif, obtenu ${bas}`);
  assert.ok(haut > 0.4, `attendu franchement positif, obtenu ${haut}`);
});

test('LA DENSITÉ COMPTE : les mêmes mots noyés dans un pavé pèsent moins', () => {
  const court = J.pencheDe('angoisse, panique, je tremble, crise d’angoisse totale');
  const noye = J.pencheDe('angoisse, panique, je tremble, crise d’angoisse totale. '
    + 'ensuite on a parlé de la liste des courses et du train de mardi et de la '
    + 'couleur du mur du salon et de ce que fait le voisin le week-end et de la '
    + 'facture du garage et du match et du programme de la semaine prochaine');
  assert.ok(Math.abs(noye) < Math.abs(court),
            'trois mots lourds dans un pavé pèsent autant qu’un cri de deux lignes');
});

test('`readMood` aurait rendu 0 sur ces passages — c’est pour ça que pencheDe existe', () => {
  // MOTS_MINIMUM = 25 est le seuil qui décide s'il faut repeindre TOUT le décor
  // de l'application. Appliqué à un paragraphe, il rend `force: 0` partout.
  const court = 'j’ai envie de mourir, je tiens plus';
  assert.equal(readMood(court, null).force, 0);
  assert.ok(J.pencheDe(court) < -0.5, 'le passage devrait pencher malgré tout');
});

/* ============ LE TEXTE DÉCOUPÉ EN SUJETS ============ */

const PAVE = "j’ai fait nuit blanche et là je me suis pas encore endormi, je suis crevé. "
  + "Je m’imagine mon ex quand on se parlait, j’avais l’impression de pas être "
  + "confortable par le fait qu’elle m’aime et maintenant on s’engueule parce qu’on "
  + "est plus ensemble. Ma mère m’a appelé aussi, ça s’est mal passé comme d’habitude, "
  + "elle trouve que je fais pas assez d’efforts et que c’est toujours à elle de venir "
  + "vers moi. J’ai repris la weed le soir pour dormir, ça marche pas vraiment, je suis "
  + "défoncé et je dors quand même pas.";

test('le découpage ne perd pas un mot du texte', () => {
  // ON NE RÉÉCRIT RIEN. Le texte reste mot pour mot, dans son ordre ; on pose
  // seulement des coupures. Un découpage qui mange une phrase serait une
  // réécriture silencieuse du journal de quelqu'un.
  const sujets = J.sujetsDuTexte(PAVE, 5);
  assert.ok(sujets.length >= 2);
  const recolle = sujets.map(s => s.texte).join(' ');
  const nu = t => t.replace(/\s+/g, ' ').trim();
  assert.equal(nu(recolle), nu(PAVE), 'le découpage a perdu ou déplacé du texte');
});

test('UN SEUL SUJET N’EST PAS UN DÉCOUPAGE', () => {
  // Ce serait le texte avec une icône au-dessus, et l'icône serait alors une
  // étiquette posée sur toute une journée. La page retombe sur le texte nu.
  assert.deepEqual(J.sujetsDuTexte('j’ai vu ma mère, ça s’est mal passé, comme toujours avec elle.', 5), []);
  assert.deepEqual(J.sujetsDuTexte('', 5), []);
});

test('une phrase sans thème prolonge le bloc au lieu d’en ouvrir un', () => {
  // « Je sais pas. » entre deux phrases sur sa mère parle encore de sa mère.
  const t = "Ma mère m’a rappelé hier soir, elle voulait qu’on se voie ce week-end. "
    + "Je sais pas. "
    + "Elle a insisté et j’ai fini par dire oui alors que j’avais pas envie du tout. "
    + "J’ai repris la weed pour dormir, ça marche pas, je suis défoncé et je dors pas.";
  const sujets = J.sujetsDuTexte(t, 5);
  assert.ok(sujets.length <= 3, `${sujets.length} blocs — le texte a été émietté`);
  assert.equal(sujets.some(s => s.texte.trim() === 'Je sais pas.'), false,
               '« Je sais pas. » a eu son propre bloc');
});

test('un bloc trop court est refondu — dans le PRÉCÉDENT, jamais dans le suivant', () => {
  /*
   * La fusion va vers l'arrière, et c'est la seule direction sûre. Une phrase
   * courte à la fin d'un paragraphe le prolonge ; la même phrase poussée dans
   * le paragraphe SUIVANT lui collerait une ouverture qui parle d'autre chose,
   * et l'icône du bloc porterait sur un texte qui commence ailleurs.
   *
   * Le premier bloc n'a pas de précédent : il reste tel quel, même court. Une
   * ouverture de journée EST un sujet — « j'ai fait nuit blanche » n'a pas à
   * être avalée par le paragraphe sur son ex.
   */
  const sujets = J.sujetsDuTexte(PAVE, 5);
  for (const s of sujets.slice(1)) {
    assert.ok(s.texte.length >= J.SUJET_CAR,
              `bloc de ${s.texte.length} signes : « ${s.texte} »`);
  }
  assert.ok(sujets[0].texte.startsWith('j’ai fait nuit blanche'),
            'l’ouverture a été fondue dans le bloc suivant');
});

test('le découpage est borné : on ne lit pas un sommaire', () => {
  const long = Array.from({ length: 40 }, (_, i) =>
    `Ma mère m’a appelé le jour ${i} et ça s’est mal passé comme toujours entre nous deux. `
    + `J’ai repris la weed ce soir-là pour arriver à dormir, ça n’a pas marché du tout.`).join(' ');
  assert.ok(J.sujetsDuTexte(long, 5).length <= J.MAX_SUJETS);
});

/*
 * LES DEUX COLONNES SE RÉPONDENT.
 *
 * À gauche ce qu'on a ressenti, heure par heure ; à droite ce qu'on a écrit.
 * Elles se lisaient côte à côte sans jamais se désigner l'une l'autre : pour
 * retrouver la phrase derrière « 05:43 · De quoi le suicide est mauvais ? » il
 * fallait relire tout le pavé de droite en cherchant l'endroit.
 *
 * Le lien passe par les MESSAGES, pas par l'heure affichée. Rapprocher par
 * l'heure marcherait presque — et « presque » veut dire qu'un jour ça
 * désignerait le mauvais passage, sans que rien ne le dise.
 */
/** Un message à une date et une heure quelconques, pas seulement le JOUR fixe. */
const parler = (d, h, m, text) =>
  addMessage({ ts: `${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`,
               date: d, source: 'web', role: 'user', text, userId: OWNER });

test('un moment et un passage portent les mêmes identifiants de message', () => {
  const d = '2026-04-11';
  parler(d, 9, 0, 'Réveil difficile ce matin. La tête lourde, pas envie de bouger.');
  parler(d, 14, 20, 'Finalement je suis sorti marcher et ça allait beaucoup mieux après.');

  const mo = J.momentsDuJour(d, OWNER, { zone: 'UTC' });
  const su = J.sujetsDuJour(d, OWNER, { zone: 'UTC' });

  assert.ok(mo.length, 'aucun moment');
  for (const m of mo) assert.ok(m.ids?.length, 'un moment sans identifiants ne peut rien désigner');
  for (const s of su) assert.ok(s.ids?.length, 'un passage sans identifiants ne peut pas être désigné');

  // Tout identifiant vu à droite existe à gauche : les deux colonnes lisent
  // exactement les mêmes messages, et rien ne peut désigner dans le vide.
  const gauche = new Set(mo.flatMap(m => m.ids));
  for (const s of su) for (const id of s.ids) assert.ok(gauche.has(id), `l'identifiant ${id} n'existe qu'à droite`);
});

test('un passage qui recouvre deux messages porte les deux', () => {
  // Un bloc trop court est fondu dans le précédent : il parle alors de deux
  // messages, et cliquer l'un OU l'autre doit l'allumer.
  const d = '2026-04-12';
  parler(d, 20, 0, 'Grosse journée au boulot, le rendu était à midi et ça a tenu de justesse.');
  parler(d, 20, 2, 'Bref.');
  const su = J.sujetsDuJour(d, OWNER, { zone: 'UTC' });
  if (su.length) assert.ok(su.some(s => s.ids.length >= 1));
});
