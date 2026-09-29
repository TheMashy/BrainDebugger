/*
 * =====================================================================
 * LA VEILLE : DEUX SIGNES, ET RIEN D'AUTRE.
 *
 * « Détecter des patterns destructeurs, des dangers, des périodes à risque. »
 * C'est le premier mot du produit, et jusqu'ici la seule chose qui s'en
 * approchait était une pastille « crise 5 » à côté de « création 3 » — le même
 * poids visuel pour cinq passages sur une crise et trois sur un projet.
 *
 * Deux niveaux, pas plus :
 *   JAUNE  le suicide a été évoqué, l'envie de se faire du mal est écrite, un
 *          moyen était à portée, le réel s'est décollé, un excès (alcool,
 *          drogue, médicament hors dose) est écrit
 *   ROUGE  il y a eu une blessure, ou une surdose
 *
 * ---------------------------------------------------------------------
 * CE QUE CE FICHIER NE FAIT PAS.
 *
 * Il ne diagnostique rien, il ne prédit rien, il n'évalue personne. Il COMPTE
 * ce que la personne a écrit elle-même, et il montre la phrase qui a déclenché
 * le signe. C'est la seule forme sous laquelle une alerte est acceptable ici :
 * vérifiable, et donc contestable.
 *
 * Un signe sans sa preuve serait un verdict de machine. Avec sa preuve, c'est
 * un rappel de ce qu'on a écrit — et si le signe est faux, ça se voit tout de
 * suite, ce qui est exactement ce qu'il faut pour qu'on continue à le croire
 * quand il est juste.
 *
 * ---------------------------------------------------------------------
 * L'ASYMÉTRIE, QUI DÉCIDE DES SEUILS.
 *
 * Manquer un rouge, c'est manquer la seule chose que cette application a promis
 * de voir. En poser un faux, c'est apprendre à quelqu'un à ignorer ses propres
 * alertes — et un signe qu'on ignore ne sert plus à rien le jour où il est
 * vrai. Les deux coûtent cher, et pas de la même façon.
 *
 * D'où la règle : le JAUNE est large — parler de suicide, même de loin, mérite
 * une trace. Le ROUGE est étroit — il demande soit un mot qui ne peut rien
 * vouloir dire d'autre (« scarification »), soit une blessure ET un contexte de
 * crise dans la même journée. « Je me suis coupé en cuisinant » n'est pas une
 * blessure de ce fichier.
 * =====================================================================
 */

import { messagesForDate } from './db.js';

export const norm = s => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/['’`\-]/g, ' ').replace(/\s+/g, ' ');   // « j'en peux plus » doit trouver « j en peux plus », « week-end » « week end »

/* ---------------------------------------------------------------------
 * NIVEAU JAUNE : le suicide évoqué.
 *
 * Large exprès. Une question au compagnon — « de quoi le suicide est
 * mauvais ? » — compte : ce n'est pas un passage à l'acte, ce n'est pas non
 * plus une journée comme une autre, et c'est très exactement ce qu'un signe
 * jaune veut dire.
 * ------------------------------------------------------------------ */
const SUICIDE = [
  'suicide', 'suicidaire', 'suicider', 'me tuer', 'me foutre en l air',
  'en finir', 'plus envie de vivre', 'envie de mourir', 'envie de crever',
  'autolyse', 'ideation', 'ideations', 'tentative de suicide',
  'passage a l acte', 'me pendre', 'me jeter',
  /*
   * LE VOULOIR, PAS SEULEMENT L'ENVIE.
   *
   * « envie de mourir » y était, « je veux mourir » non — et c'est l'une des
   * façons les plus ordinaires de l'écrire en français. Un balayage de phrases
   * banales l'a sorti : la ligne la plus grave du produit ne se déclenchait pas
   * sur « je veux mourir, je n'en peux plus ». Rien ne le signalait, parce
   * qu'une liste qui rate ressemble exactement à une liste qui trouve.
   *
   * « je ne veux pas mourir » ne contient pas « veux mourir » (il y a « pas »
   * au milieu), et « je veux mourir de rire » est effacé par HYPERBOLE avant
   * d'arriver ici.
   */
  'veux mourir', 'voudrais mourir', 'aimerais mourir',
  'veux crever', 'voudrais crever', 'aimerais crever',
  'veux etre mort', 'voudrais etre mort', 'aimerais etre mort',
  'veux plus vivre', 'veux plus etre la', 'veux disparaitre',
  'envie de disparaitre', 'me supprimer',
  'mettre fin a mes jours', 'mettre fin a ma vie',
  'aimerais ne pas me reveiller', 'voudrais ne pas me reveiller',
  'envie de ne pas me reveiller',
  /*
   * L'INFINITIF, ET CE QUI NE PORTE PAS LE MOT MOURIR SOUS SA FORME ATTENDUE.
   *
   * La liste connaissait « veux », « voudrais », « envie de » — pas « vouloir » :
   * « encore cette sensation de vouloir mourir ce soir » ne donnait rien, et un
   * jour réel est resté sans aucun signe. Même silence sur se laisser mourir,
   * « autant mourir », « me buter », « m'endormir pour toujours » — gravite.js
   * connaissait pourtant cette dernière. « mon père va me buter si je rate »
   * est effacé par HYPERBOLE, comme « mon chef va me tuer ».
   */
  'vouloir mourir', 'vouloir crever',
  'envie de me laisser mourir', 'envie de se laisser mourir',
  'me buter', 'autant mourir', 'm endormir pour toujours', 'dormir pour toujours'
];
/* Le plan daté : « je vais me tuer ce soir », « ce soir j'en finis », « c'est
   décidé, je me pends demain ». Nié (« je vais pas me tuer »), il ne compte pas. */
const PLAN_PROCHE = /\b(?:ce soir|cette nuit|demain|maintenant) j en finis\b|\bj en finis (?:ce soir|cette nuit|demain|maintenant)\b|\b(?:je vais|je compte|j ai decide de|c est decide|ce soir je|cette nuit je)\b[^.;!?]{0,40}\b(?:me tuer|me pendre|me pends|me jeter|en finir|en finis|me suicider|me suicide|me foutre en l air|mourir|crever)\b|\b(?:me tuer|me pendre|me pends|en finir|en finis|me suicider|me suicide)\b[^.;!?]{0,30}\b(?:ce soir|cette nuit|maintenant|tout de suite|demain)\b/;
const PLAN_NIE = /\bje (?:vais|compte) (?:pas|jamais|surtout pas|absolument pas)\b|\bje (?:ne )?(?:vais|compte) (?:pas|jamais)\b|\bpas (?:me tuer|en finir|me pendre)\b/;
/* « TS » est une abréviation et pas un mot : elle ne se cherche qu'entourée de
   frontières, sans quoi « ts » attrape la moitié du dictionnaire. */
const SUICIDE_SIGLES = /\bts\b/;
/* Les hyperboles de tous les jours, où ce n'est pas la personne qui se tue :
   « mon chef va me tuer », « ça va me tuer », « envie de mourir de honte ». Elles
   s'effacent AVANT la recherche — « je vais me tuer » (vais) reste entier. */
const HYPERBOLE = /\b(?:va|vont|veut|veulent|voudrait|voudraient|pourrait|pourraient|peut|peuvent|risque de|risquent de|essaie de|essaye de|cherche a|cherchent a|vas|allait|allaient) me (?:tuer|buter)\b|\bme tuer (?:a la tache|au travail|au boulot|a l ouvrage)\b|\benvie de mourir de (?:honte|rire)\b|\bmourir de (?:honte|rire)\b/g;

/* ---------------------------------------------------------------------
 * JAUNE AUSSI : L'ENVIE DE SE FAIRE DU MAL, ÉCRITE.
 *
 * « hier soir j'ai eu envie de me faire du mal » : « me faire du mal » ne
 * servait que de CONTEXTE à une blessure, jamais de signe à lui seul — une
 * vraie nuit est restée muette, alors que le compagnon y est revenu plusieurs
 * fois. C'est
 * son propre genre, jaune : une envie nommée n'est pas un geste.
 *
 * La négation reste dehors — « j'ai pas envie de me faire du mal », « je n'ai
 * plus envie », « pas d'envie de me faire du mal » —, et « me détruire » nu
 * aussi : « je vais me détruire le dos au boulot ». Se couper les cheveux, ou
 * du monde, n'est pas se couper.
 * ------------------------------------------------------------------ */
/* La négation qui gouverne l'envie, pas n'importe quel « pas » posé devant :
   dans une dictée sans virgule, « rien ne va plus envie de me faire du mal »
   et « je sais pas envie de me faire du mal » étaient effacés. */
const ENVIE_MAL = /(?<!\b(?:ai|avais|a|as|n ai|n avais|meme) (?:pas|plus|jamais) (?:eu )?(?:d )?)(?<!\b(?:pas|sans) d )(?<!\bsans )\b(?:envie de me faire (?:du )?mal|envie de me (?:blesser|scarifier)|envie de me couper(?! (?:les |des |une |un |la |le |du |de |d |mes |ma |mon )?(?:cheveux|frange|meche|ongles|barbe|pointes|monde|autres|tout|parole|pain))|m auto detruire)\b/;

/* ---------------------------------------------------------------------
 * JAUNE AUSSI : UN MOYEN À PORTÉE.
 *
 * « Là je suis devant l'ordi, je joue avec un couteau et je te parle », écrit à
 * 5 h 53. Pas un mot de suicide, pas de blessure — la première version de ce
 * fichier ne voyait donc RIEN. C'est pourtant le signe le plus concret qu'un
 * texte puisse porter : un moyen, à portée de main, maintenant.
 *
 * Il faut les DEUX : l'objet et la proximité. « J'ai acheté un couteau de
 * cuisine » n'est pas « j'ai un couteau à côté ». C'est cette paire qui fait la
 * différence entre un objet mentionné et un objet tenu.
 * ------------------------------------------------------------------ */
const MOYEN = ['couteau', 'cutter', 'lame', 'rasoir', 'ciseaux', 'corde',
               'boite de cachets', 'boite de medicaments', 'plaquette', 'flingue', 'arme'];
const EN_MAIN_IMPARFAIT = /\bje (?:jouais|m amusais|tenais|serrais|touchais|posais|passais)\b|\bj avais\b[^,;.]{0,20}\b(?:dans la main|dans les mains|sur moi)\b/;
const A_PORTEE = ['a cote', 'a portee', 'devant moi', 'sur la table',
                  'sous mon lit', 'dans ma poche', 'je le garde', 'je la garde',
                  'je regarde la'];
/*
 * EN MAIN, MAINTENANT : c'est un ROUGE, pas un jaune.
 *
 * « Là je suis devant l'ordi, je joue avec un couteau et je te parle », écrit à
 * 5 h 55. Un objet POSÉ à côté est un moyen à portée — un signe, pas un geste.
 * Un objet qu'on a DANS LA MAIN pendant qu'on écrit est autre chose : la
 * distance entre l'intention et l'acte a déjà été franchie, et c'est très
 * exactement le moment où un signe sert.
 *
 * On ne demande pas de contexte de crise en plus : la phrase se suffit. Le prix
 * d'un rouge de trop ici est un rouge de trop ; le prix d'un jaune de trop est
 * une soirée où personne ne regarde.
 */
const EN_MAIN = ['dans la main', 'dans les mains', 'je joue avec', 'je m amuse avec',
                 'je tiens', 'je le tiens', 'je la tiens', 'je le touche', 'je la touche',
                 'je le passe sur', 'je la passe sur', 'contre ma peau', 'sur mon poignet',
                 'sur mes bras', 'contre mon bras', 'je le pose sur', 'je la pose sur'];

/* ---------------------------------------------------------------------
 * JAUNE ENCORE : la déréalisation, quand elle se NOMME.
 *
 * On ne détecte que ce qui se dit en toutes lettres. Reconnaître un état
 * dissociatif à la syntaxe d'un message — les phrases qui se percutent, le
 * passage à la troisième personne sur soi-même — se ferait à coups de faux
 * positifs sur n'importe quel texte écrit vite, un soir, sans ponctuation. Une
 * alerte qui se déclenche parce qu'on tape mal est une alerte qu'on éteint.
 * ------------------------------------------------------------------ */
/*
 * « pas vraiment la » et « brouillard », tels quels, attrapaient « c'est pas
 * vraiment la solution », le brouillard de la route — et un faux signe de ce
 * genre a fixé l'heure d'un jour de crise. À l'inverse, « je crois ne pas être
 * réel » ne donnait rien. Le « là »
 * ne compte que dit de soi, et le brouillard que quand on est dedans — pas
 * celui de la route.
 */
const DEREALISATION = [
  'dereal', 'derealisation', 'depersonnalisation', 'depersonnalise',
  'irreel', 'pas vraiment reel', 'comme dans un reve',
  'comme un film', 'je me regarde de loin', 'je me vois de l exterieur',
  'plus dans mon corps', 'plus dans mon propre corps', 'decale de la realite',
  'dans du coton', 'plus rien n est reel', 'je sais plus ce qui est reel',
  'pas etre reel', 'pas etre vraiment la', 'hors de la realite',
  'la tete dans le brouillard', 'je suis dans le brouillard', 'dans un brouillard', 'comme un brouillard'
];
const DEREALISATION_LA = /\b(?:je suis|j etais|je me sens|suis) pas vraiment la\b(?! (?:question|peur|peine|solution|raison|probleme|bonne|meilleure?|personne|seule?|pour)\b)/;

/* ---------------------------------------------------------------------
 * LES SUBSTANCES : un excès (jaune), une surdose (rouge).
 *
 * « J'ai trop bu hier », « j'ai pris de la coke à la soirée », « j'ai avalé
 * toute la plaquette » : trois phrases que la première version de ce fichier
 * laissait passer sans un mot, alors qu'elles disent exactement ce que la
 * veille doit voir — un danger pris avec le corps.
 *
 * Deux niveaux, comme pour le reste :
 *   JAUNE  un EXCÈS est écrit : trop bu, ivre, défoncé, une drogue prise,
 *          un médicament pris hors de sa dose ou sans ordonnance ;
 *   ROUGE  une SURDOSE est écrite : overdose, trop de cachets, la boîte
 *          entière, la dose doublée, alcool et cachets mélangés.
 *
 * Et ce qui ne compte PAS : « un verre de vin au dîner », « j'ai pris mon
 * traitement », « une bière avec Léa ». Un usage n'est pas un excès ; ce
 * fichier ne juge pas ce que les gens boivent, il compte ce qu'ils disent
 * avoir dépassé. Les mêmes règles de temps que pour les blessures : un récit
 * ancien ne marque pas le jour, un tiers (« mon frère était bourré ») non
 * plus, une négation (« je n'ai pas bu ce soir ») non plus.
 * ------------------------------------------------------------------ */
/* À partir de cinq : « j'ai pris deux cachets » n'est pas une surdose. */
const NB_CACHETS = '(?:[5-9]|[1-9]\\d+|cinq|six|sept|huit|neuf|dix|douze|quinze|vingt|trente|quarante|cinquante)';
/*
 * LES MOTS DE LA PERSONNE, PAS CEUX DE LA NOTICE.
 *
 * « là je viens de prendre 7 anxios » ne donnait RIEN, quand « j'ai pris 7
 * xanax » donnait rouge : « anxio(s) », le mot de la personne pour son
 * traitement — et ses fautes de frappe —, n'était dans aucune liste, et la
 * règle du compte voulait « pris » collé au nombre. Deux nuits de prise
 * massive sont restées sans rouge ni 3114.
 */
const ANXIO = 'an+xios?|anxiolytiques?|oxazepam';
const UNITE_MEDOC = `(?:cachets|comprimes|medicaments|medocs|gelules|pilules|doliprane|dafalgan|efferalgan|paracetamol|ibuprofene|aspirine|xanax|lexomil|valium|temesta|seresta|imovane|stilnox|zolpidem|tramadol|codeine|benzos?|${ANXIO}|izalgi|lamaline)`;
const SURDOSE = new RegExp([
  '\\boverdose\\b', '\\bsurdose\\b', '\\bsurdosage\\b', '\\bod\\b', '\\bintoxication (?:medicamenteuse|volontaire)\\b',
  `\\btrop (?:de|d) (?:cachets|comprimes|medicaments|medocs|gelules|pilules|xanax|lexomil|valium|doliprane|paracetamol|dafalgan|codeine|tramadol|${ANXIO})\\b`,
  '\\b(?:toute|tout) (?:la|ma|une|le|mon) (?:boite|plaquette|tube|flacon|stock|reserve)\\b', '\\b(?:la|ma) (?:boite|plaquette) (?:entiere|complete)\\b',
  '\\btous mes (?:cachets|comprimes|medicaments|medocs)\\b',
  /* « j'ai avalé tous mes anxios » ne donnait RIEN quand l'envie de le faire
     donnait un jaune. Avaler, gober, vider : pas « pris toutes mes gélules
     comme prévu ». */
  `\\b(?:avale|gobe|englouti|ingere|vide) tou[ts]e?s? mes ${UNITE_MEDOC}\\b`,
  /* « j'ai avalé une boîte de cachets » n'avait ni « toute » ni chiffre : la
     tentative racontée sans le mot passait entière à travers. « avalé » et
     « gobé » ne se disent pas d'une boîte qu'on achète ; « pris » si, donc il
     lui faut le contenu. */
  '\\b(?:avale|avalee|gobe|ingere) (?:une|la|ma|toute une) (?:boite|plaquette)\\b',
  `\\bpris (?:une|la|ma|toute une) (?:boite|plaquette) (?:de|d) ${UNITE_MEDOC}\\b`, '\\btout mon (?:xanax|lexomil|valium|traitement|stock)\\b',
  `\\b(?:avale|pris|prendre|prends|repris|gobe|ingere|envoye) ${NB_CACHETS} ${UNITE_MEDOC}\\b`,
  '\\b(?:double|triple|quadruple) (?:ma|la) dose\\b', `\\b${NB_CACHETS} fois (?:ma|la) dose\\b`, '\\bdose (?:doublee|triplee)\\b',
  '\\blavage d estomac\\b', '\\bcoma ethylique\\b', '\\bcoma\\b.{0,30}\\b(?:alcool|cachets|medicaments)\\b',
  '\\bmelang\\w* .{0,25}\\b(?:alcool|vodka|whisky|rhum|gin|biere|vin)\\b.{0,25}\\b(?:cachets|comprimes|medicaments|medocs|xanax|lexomil|valium|codeine|tramadol|benzo)\\b',
  '\\bmelang\\w* .{0,25}\\b(?:cachets|comprimes|medicaments|medocs|xanax|lexomil|valium|codeine|tramadol|benzo)\\b.{0,25}\\b(?:alcool|vodka|whisky|rhum|gin|biere|vin)\\b',
].join('|'));
const SURDOSE_TOUTES = new RegExp(SURDOSE.source, 'g');
/* La règle du compte : « pris 8 xanax ». */
const COMPTE = new RegExp(`^(?:avale|pris|prendre|prends|repris|gobe|ingere|envoye) ${NB_CACHETS} `);
/* L'alcool en excès : ce n'est pas « bu », c'est « trop bu ». */
const ALCOOL_EXCES = /\b(?:trop|beaucoup trop|bien trop|enormement) bu\b|\bbu (?:trop|toute la (?:soiree|nuit|journee|bouteille)|jusqu a (?:vomir|tomber|plus savoir|l oubli|pas savoir))\b|\bbourre(?:e|es)?\b|\bivre(?: morte?)?\b|\b(?:une |grosse |la )?cuite\b|\bblack ?out\b|\btrou noir\b|\bgueule de bois\b|\b(?:fini|vide|descendu|siffle) (?:la|une|toute la) bouteille\b(?! (?:de|d) (?:vinaigre|shampoing|lessive|gel|huile|sirop|jus|lait|eau|soda|liquide|savon))|\bune bouteille (?:entiere|de (?:vodka|whisky|rhum|gin|vin))\b|\bbinge\b|\bdefonce(?:e|es)?\b|\btorche(?:e|es)?\b|\bcomplet(?:ement)? raide\b|\bvomi .{0,20}\balcool\b|\b(?:six|sept|huit|dix|\d+) (?:verres|bieres|shots|pintes)\b/;
/* Les drogues : un mot ne suffit pas, il faut la prise (« j'ai pris », « sniffé », « sous »). */
const DROGUE = /\b(?:coke|cocaine|cc|md|mdma|ecsta|ecstasy|taz|ket|ketamine|lsd|acide|buvard|champi|champis|champignons|speed|amphet|amphetamines|meth|crack|heroine|hero|opium|opiaces|poppers|protoxyde|proto|ballons|gaz hilarant|gbl|ghb|3 ?mmc|4 ?mmc|cathinones|chems|drogue|drogues|dope)\b/;
const PRISE = /\b(?:j ai|je me suis|on a|je) (?:pris|repris|sniffe|snife|gobe|tape|fume|consomme|avale|shoote|injecte|fait)\b|\bune trace\b|\bun rail\b|\bdes traces\b|\bdes rails\b|\bun ballon\b|\bdes ballons\b|\bje (?:prends|sniffe|gobe|tape|consomme)\b|\bsous (?:coke|cocaine|md|mdma|ecsta|ket|ketamine|lsd|acide|speed|meth|crack|hero|heroine|ghb|drogue)\b|\bme (?:suis )?drogu\w*\b|\bje me drogue\b|\bj ai (?:re)?plonge\b/;
/* La prise qui se suffit : « tapé des traces », « deux rails », « sniffé » — la substance n'est pas nommée, la prise l'est. */
const PRISE_SEULE = /\b(?:tape|sniffe|pris|fait|enchaine) (?:une|des|deux|trois|quatre|quelques|plusieurs) (?:traces?|rails?)\b|\b(?:un|deux|trois|quatre|cinq|des|quelques|plusieurs) rails?\b(?! (?:de|du) (?:train|tram|metro|securite))|\bsniffe\b|\bje me suis (?:shoote|shootee|injecte|injectee|pique|piquee)\b/;
/* Le cannabis et les médicaments : seulement en excès ou hors ordonnance. */
const CANNABIS = /\b(?:joint|joints|beuh|weed|shit|bedo|bedos|pet|pets|cannabis|spliff|spliffs|bang|bangs|bhang)\b/;
const MEDOC = /\b(?:xanax|lexomil|valium|temesta|seresta|benzo|benzos|zolpidem|stilnox|imovane|codeine|tramadol|oxy|oxycodone|morphine|ritaline|methylphenidate|somnifere|somniferes|anxiolytique|anxiolytiques|an+xios?|oxazepam|cachets|comprimes|medocs|medicaments)\b/;
/*
 * « TROP » SE DIT DE LA PRISE, PAS DE LA PHRASE.
 *
 * Nu, il attrapait « je sais pas trop si la beuh me détend » — et dans une
 * dictée de cent mots sans ponctuation, n'importe quel « trop » loin de la
 * weed. « j'ai pris deux anxios et après j'étais trop content » aurait fait un
 * jour « substance ». Il doit porter sur la prise.
 * Et « 2 joints » ne compte pas plus que « deux joints » : à partir de trois.
 */
const EXCES = /\btrop (?:fume|bu|pris|de|d)\b|\b(?:fume|pris|prends|bois|consomme)(?: beaucoup| bien)? trop\b|\b(?:beaucoup|largement) trop\b|\b(?:bien|vraiment) trop(?=\s*(?:$|[,.!?…]))|\btoute la (?:journee|nuit|soiree)\b|\benchaine\b|\bnon stop\b|\bsans arret\b|\b(?:trois|quatre|cinq|six|sept|huit|dix|[3-9]|\d{2,}) (?:joints|bedos|pets|cachets|comprimes|xanax|lexomil)\b|\bplus que (?:prevu|d habitude|la dose|prescrit)\b|\bpas la bonne dose\b|\bhors dose\b|\bsans ordonnance\b|\bpas prescrit\b|\bpas a moi\b|\bde ma mere\b|\bde mon pere\b|\bpour (?:dormir|planer|oublier|me calmer|tenir|m assommer|ne plus rien sentir)\b|\bavec de l alcool\b|\bavec l alcool\b/;
/* Un anxio « pour dormir », « pour me calmer », « pour tenir » : c'est l'usage
   prescrit en appoint, pas un excès. Le même mot garde son sens pour le reste. */
const ANXIO_RE = new RegExp(`^(?:${ANXIO})$`);
const USAGE_ANXIO = /\bpour (?:dormir|me calmer|tenir)\b/g;
/* Ce qui ressemble à un excès et n'en est pas. « je me suis fait défoncer par
   mon chef » est une réunion, pas une prise — sauf si c'est par la weed. */
const SUBSTANCE_HYPERBOLE = /\b(?:fait|fais|faire) defonce(?:e|es|r)? par\b(?! (?:la |le |les |l |du |des )?(?:weed|beuh|shit|joints?|alcool|vodka|cachets|medocs|an+xios?|drogue|coke|md|ket)\b)|\bivre de (?:joie|bonheur|rage|colere|fatigue)\b|\bbourre(?:e|es)? (?:de|d) (?!(?:vodka|whisky|rhum|gin|biere|bieres|vin|alcool|champagne|pastis|shots)\b)\w+|\bdefonce(?:e)? (?:de fatigue|par le sport|apres le sport|par la salle|par la seance)\b|\bcuite au four\b|\bcuite a la vapeur\b|\bune drogue douce\b|\bc est ma drogue\b|\bcomme une drogue\b|\bdrogue (?:du|de la|au) (?:travail|boulot|sport|sucre|serie|jeu)\b|\bcoke (?:zero|light|cola)\b|\bcoca\b|\bshit(?:ty)?\b(?= (?:day|show|storm))|\btaz(?:manie)?\b/g;
/* « il y a » n'est personne : « il y a des gens qui disent qu'une overdose… » était effacé.
   Mais « il y a des gens qui prennent toute la plaquette » reste l'acte des
   autres : « des gens », « certains » qui prennent, avalent, font. Pour eux,
   seuls les verbes d'une prise — « des gens qui disent qu'une overdose c'est
   doux » reste l'idée, et reste un jaune. */
const SUBSTANCE_TIERS = /\b(?:il(?! y a)|elle|ils|elles|on|mon frere|ma soeur|mon pere|ma mere|mon pote|ma pote|mon ami|mon amie|ma copine|mon copain|mon mec|ma meuf|mon ex|mon coloc|ma coloc|les gens|tout le monde|quelqu un|un mec|une fille|mon oncle|ma tante|mon cousin|ma cousine|les autres|mes potes|mes amis|le voisin|la voisine)\b[^,;.]{0,30}\b(?:etait|etaient|est|sont|a |ont |s est|se sont|avait|avaient|buvait|buvaient|prenait|prenaient|prend|boit|prennent|avalent|boivent|font)\b|\b(?:des gens|certains|certaines personnes|beaucoup de gens)\b[^,;.]{0,30}\b(?:prennent|avalent|boivent|font|prenaient|avalaient|buvaient|faisaient|ont pris|ont avale|ont fait)\b/;
const SUBSTANCE_NEGATION = /\b(?:ne|n) (?:me suis )?(?:ai|suis|avais|etais|bois|prends|touche|fume) (?:pas|plus|jamais|rien)\b|\bpas (?:bu|pris|touche|fume|sniffe)\b|\bjamais (?:bu|pris|touche|fume|sniffe)\b|\bplus (?:bu|pris|touche|fume) depuis\b|\bsans (?:boire|alcool|rien prendre|toucher)\b|(?<!(?:moi|quand je suis|si je suis|quand j etais) )\bsobre\b|\barrete de (?:boire|fumer|prendre)\b|\bj ai arrete\b(?! de (?:compter|reflechir|y penser|me justifier|me plaindre|chercher|lutter))|\bzero alcool\b|\bpas une goutte\b|\bpas un verre\b/;
const SUBSTANCE_INTENTION = /\benvie de (?:boire|me bourrer|me defoncer|prendre|reprendre|replonger|me mettre une cuite|sniffer)\b|\bj aimerais (?:boire|prendre|reprendre|me defoncer)\b|\bje vais (?:boire|me bourrer|me defoncer|prendre|reprendre|replonger)\b|\bsi je (?:bois|prends|reprends)\b|\bpour (?:ne pas|pas) (?:boire|reprendre|replonger|craquer)\b|\bpeur de (?:vraiment )?(?:tomber|retomber|finir|devenir)\b/;
/*
 * L'ENVIE, OU LE CONDITIONNEL, D'UNE SURDOSE : UN JAUNE « SUICIDE », PAS UN SOUVENIR.
 *
 * « je pourrais prendre toute la plaquette » donnait rouge, « envie de prendre
 * toute la plaquette » un jaune « blessure ou surdose PASSÉE » — ni l'un ni
 * l'autre n'est ce qui est écrit. C'est une idée, au présent : le jaune du
 * suicide. Avec un « ce soir », un « là », elle reste ROUGE : « je vais prendre
 * toute la plaquette ce soir » est le moment où le 3114 sert.
 */
const INTENTION_SURDOSE = new RegExp(SUBSTANCE_INTENTION.source
  + '|\\bj aimerais\\b|\\bje voudrais\\b|\\benvie de\\b|\\bje pourrais\\b|\\bje prendrais\\b|\\bm empecherait\\b');
/* L'acte, lui, reste un rouge même quand une envie est écrite à côté : « j'avais
   envie de dormir et j'ai tout avalé ». */
const ACTE_SURDOSE = /\bje viens de\b|\bj (?:en )?ai (?:\w+ ){0,2}(?:pris|avale|gobe|ingere|englouti|bouffe|fini|vide)\b|\bje me suis (?:\w+ ){0,2}(?:pris|envoye|enfile|avale)\b|\by (?:est|sont) passee?s?\b/;
/*
 * L'ENVIE DOIT PORTER SUR LA SURDOSE ELLE-MÊME.
 *
 * « envie de » tout nu rétrogradait n'importe quelle surdose de la proposition :
 * « envie de dormir alors pris 8 xanax », « envie de mourir, toute la boîte
 * avalée » passaient du rouge au jaune — l'envie était écrite, l'acte aussi, et
 * c'est l'envie qui l'emportait. L'idée ne compte que si le verbe qui mène à la
 * surdose est à l'infinitif ou au conditionnel, juste devant elle (« je
 * pourrais prendre toute la plaquette »). Et un acte écrit sans « j'ai » — un
 * participe (« toute la plaquette avalée »), un passé en tête (« pris 8
 * xanax ») — reste un acte.
 */
const VERS_SURDOSE = /\b(?:prendre|reprendre|avaler|gober|ingerer|engloutir|bouffer|faire|envoyer|enfiler|prendrais|avalerais|goberais|ferais|pourrais)\b/;
const SURDOSE_AU_PASSE = /^(?:avale|avalee|pris|repris|gobe|ingere|envoye)\b/;
const PARTICIPE_APRES = /^\s*(?:\S+\s+){0,2}(?:avalee?s?|prises?|gobee?s?|ingeree?s?|englouti(?:e|es|s)?|passee?s?|videe?s?|finie?s?)\b/;
const envieDeSurdose = (q, m) => {
  const avant = q.slice(0, m.index).trim().split(' ').slice(-5).join(' ');
  return VERS_SURDOSE.test(avant) || /^prendre\b/.test(m[0]);   // « envie de prendre 8 xanax »
};
const acteDeSurdose = (q, m) => SURDOSE_AU_PASSE.test(m[0]) || PARTICIPE_APRES.test(q.slice(m.index + m[0].length));
/* « tous mes anxios », seul, se rachète et se prend comme prévu ; dans une
   envie, ou un « je vais », c'est la même idée que la plaquette entière. */
const TOUS_MES_MEDOCS = new RegExp(`\\btou[ts]e?s? mes ${UNITE_MEDOC}\\b`);
const ENVIE_TOUS_MES = new RegExp(INTENTION_SURDOSE.source + '|\\benvie du\\b|\\bje veux\\b|\\bje vais\\b');
const AVALER = /\b(?:prendre|prendrais|avaler|gober|ingerer|engloutir|bouffer|m envoyer|m enfiler|me prendre)\b/;
const AVALER_TOUT = /\b(?:avaler|gober|ingerer|engloutir|bouffer|m envoyer|m enfiler)\b/;
/*
 * LA DOSE PRESCRITE N'EST PAS UNE SURDOSE.
 *
 * Avec « prends » et les anxios dans le compte, « je prends 5 anxios par jour »
 * devenait un rouge — et la personne en prend tous les jours : un rouge tous
 * les soirs est une alerte qu'on finit par éteindre. Un compte dit avec sa
 * posologie reste écrit (jaune « substance »), pas crié. « pas prescrit »,
 * « sans ordonnance » disent le contraire, et restent dehors.
 */
const DOSE_PRESCRITE = /\bpar (?:jour|nuit)\b|\bchaque (?:jour|soir|matin|nuit)\b|\bcomme (?:prescrit|prevu|d habitude)\b|(?<!\b(?:pas|sans|hors|que|non) )\bprescrits?\b|(?<!\b(?:sans|hors) )\bordonnance\b/;
/* Le compte fait par morceaux — « 2 le matin, 2 à midi, 2 le soir, donc 6 » —
   est le même compte que « j'en ai pris 6 » : à partir de cinq, une surdose. Il
   faut la prise d'un médicament dans la même proposition, et que le nombre soit
   bien celui des cachets : suivi de la fin de la proposition, d'un cachet, ou
   d'un « au total », « ce soir ». « donc 5 personnes m'ont appelé », « au total
   6 cette semaine » ne comptent pas des cachets. */
const PRISE_MEDOC = new RegExp(`\\b(?:pris|avale|gobe|prendre|prends|repris|envoye)\\b[^.!?]{0,20}\\b${UNITE_MEDOC}\\b`);
const TOTAL_PRIS = new RegExp(`\\b(?:donc|soit|en tout|au total)\\s+${NB_CACHETS}(?=(?:\\s+(?:je crois|je pense|il me semble|environ))?\\s*(?:$|[,.!?…])|\\s+(?:${UNITE_MEDOC}|au total|en tout|dans la journee|ce soir|cette nuit|aujourd hui|ajd|auj)\\b)`);
/* Le nom seul, sans « j'ai » ni « je suis » devant : « une overdose ça doit
   être doux » parle de l'idée, pas d'une nuit aux urgences. */
const SURDOSE_NOM = /^(?:overdose|surdose|surdosage|od)$/;
/* … sauf si ce qui l'entoure dit la nuit elle-même : « j'étais en overdose »,
   « mon overdose », « une overdose, je sors des urgences » — ou la détresse en
   cours : « aidez-moi overdose », « je suis à deux doigts de l'overdose ». */
const SURDOSE_VECUE_AVANT = /\b(?:j ai|j avais|je suis|j etais|me suis|m etais|mon|ma|fait|fais|faire|frole|failli)\b|\ben\s*$/;
const SURDOSE_VECUE_LOIN = /\b(?:j ai|je suis|me suis)\b/;   // à 40 signes : « je suis à deux doigts de l'overdose »
const SURDOSE_VECUE = /\b(?:urgences?|samu|pompiers|hopital|hosto|lavage|reanimation|rea|centre antipoison)\b|\baide[zr]? moi\b|\ba l aide\b|\bau secours\b|\bdeux doigts\b|\ben train d(?:e)?\b|\bje me sens\b|\bje sens\b|\bje vais (?:mourir|y passer)\b|\bappele[rz]? (?:le )?(?:15|112|samu)\b/;

/*
 * LES GARDES DES SUBSTANCES, PARTAGÉES.
 *
 * `server/prises.js` compte les mêmes mots sur toute la durée du journal. S'il
 * les recopiait, les deux écrans finiraient par ne plus dire la même chose du
 * même jour — et c'est la copie qui aurait tort, parce que ces quatre filtres
 * sont ce qui a été corrigé le plus souvent (« bourré de travail », « mon frère
 * a bu », « j'ai arrêté », « j'ai envie de boire »). Un seul jeu, un seul
 * endroit où le réparer.
 */
export const GARDES_SUBSTANCE = {
  hyperbole: SUBSTANCE_HYPERBOLE,   // /g : à utiliser avec .replace, jamais avec .test
  tiers: SUBSTANCE_TIERS,
  negation: SUBSTANCE_NEGATION,
  intention: SUBSTANCE_INTENTION
};

/* ---------------------------------------------------------------------
 * NIVEAU ROUGE : une blessure a eu lieu.
 * ------------------------------------------------------------------ */

/** Ce qui ne peut rien vouloir dire d'autre. Un seul de ces mots suffit. */
const BLESSURE_CERTAINE = [
  'scarification', 'scarifications', 'scarifie', 'scarifiee', 'scarifier',
  'automutilation', 'automutile', 'auto mutilation',
  'me suis taillade', 'me suis mutile', 'me suis mutilee',
  'me taillade', 'me mutile'
];

/*
 * LE PASSÉ COMPOSÉ AVEC LA PARTIE DU CORPS.
 *
 * La liste au-dessus avait « me suis tailladé » et l'imparfait « je me
 * taillais », pas « je me suis taillé les bras » — la tournure la plus
 * courante. On ne pouvait pas l'ajouter à la liste telle quelle : « je me suis
 * taillé de la fête » veut dire qu'on est parti. C'est la partie du corps qui
 * tranche, et elle exclut du même coup l'accident de cuisine — « je me suis
 * coupé le doigt » reste un doigt, et reste possible, pas certain.
 */
/* Le geste AU PRÉSENT et le petit mot glissé au milieu : « je viens de me
   couper les bras », « je me suis ouvert le bras », « je me suis encore coupé
   les poignets » ne donnaient RIEN -- la liste attendait le participe collé à
   « me suis », et ne connaissait ni « ouvert » ni « les veines ». */
const PARTIE_DU_CORPS = '(?:les? |la |le |mes |mon |ma )?(?:bras|avant bras|jambes?|cuisses?|poignets?|ventre|peau|mollets?|chevilles?|hanches?|epaules?|veines?)';
const BLESSURE_CERTAINE_RE = new RegExp(
  `\\bme suis (?:(?:encore|a nouveau|de nouveau|deja|re) )?(?:taille|taillee|coupe|coupee|recoupe|recoupee|entaille|entaillee|brule|brulee|scarifie|scarifiee|lacere|laceree|ouvert|ouverte) ${PARTIE_DU_CORPS}\\b`
  + `|\\bje me (?:taille|coupe|entaille|brule|ouvre) les (?:bras|cuisses|jambes|poignets|veines)\\b`
  + `|\\bje viens de (?:me |m )(?:couper|tailler|taillader|entailler|bruler|scarifier|ouvrir|lacerer) ${PARTIE_DU_CORPS}\\b`);

/**
 * Ce qui peut être un accident. Ne compte qu'accompagné d'un contexte de crise
 * dans la même journée — sans quoi une cuisine devient une urgence.
 */
const BLESSURE_POSSIBLE = [
  'me couper', 'me bruler', 'ca saigne',
  'me suis coupe', 'me suis coupee', 'me suis brule', 'me suis brulee',
  'me suis fait mal', 'me suis fait du mal', 'me suis frappe', 'me suis cogne',
  'j ai saigne', 'ca saignait', 'entaille', 'entailles', 'coupures'
];
/* « je me suis encore coupé » : le mot glissé au milieu cassait la liste. */
const BLESSURE_POSSIBLE_RE = /\bme suis (?:(?:encore|a nouveau|de nouveau|re) )?(?:coupe|coupee|recoupe|recoupee|brule|brulee)\b/;
/*
 * L'ACCIDENT DIT. Une coupure ambiguë, récente, sans crise écrite autour, donnait
 * RIEN -- même « je me suis coupé ce soir, ça saigne ». Elle donne désormais un
 * jaune, sauf quand le texte dit l'accident : la cuisine reste une cuisine,
 * même quand on s'y coupe « encore ».
 */
const ACCIDENT = /\b(?:cuisin\w*|en coupant|legumes?|oignons?|pain|tomates?|viande|mandoline|bricol\w*|en me rasant|rasage|rasoir de|tombe\w*|chute|velo|accident|papier|verre casse|conserve|jardin\w*|au travail|au boulot)\b/;

/**
 * LE CONTEXTE QUI FAIT BASCULER UNE BLESSURE POSSIBLE EN ROUGE.
 *
 * Ce n'est pas « des mots tristes » : c'est le vocabulaire de la crise déjà
 * défini pour la frise, plus l'intention de se faire du mal. Une coupure dans
 * une journée qui parle de suicide n'est pas la même coupure que dans une
 * journée qui parle de recette.
 */
const CONTEXTE_CRISE = [
  ...SUICIDE, 'crise', 'angoisse', 'panique', 'craque', 'craquer', 'effondre',
  'me punir', 'me faire du mal', 'me faire mal', 'je vais pas bien',
  'je tiens plus', 'j en peux plus'
];
/*
 * ET LES OBJETS N'EN FONT PAS PARTIE — c'est un vrai piège, attrapé par un
 * test. « Lame » était à la fois une blessure possible ET un contexte de
 * crise : la phrase se validait donc ELLE-MÊME et passait au rouge. « Il faut
 * que je change les lames du rasoir » devenait une alerte rouge.
 *
 * Un objet à portée est désormais son propre genre (`moyen`, en jaune). Ce qui
 * fait basculer une blessure ambiguë au rouge, c'est un état — pas un ustensile.
 */

/* ---------------------------------------------------------------------
 * UN FAIT ANCIEN RACONTÉ N'EST PAS UNE BLESSURE DE CE JOUR-LÀ.
 *
 * « Le lendemain de ma scarification en mai, je suis allé au travail direct »,
 * « la fois où je me suis scarifié, j'ai fini aux urgences », « mon frère m'a
 * dit qu'il s'était scarifié ado » : la personne RACONTE, elle ne se blesse pas
 * aujourd'hui. Compter ça comme un rouge, c'est le faux positif qui apprend à
 * ignorer le signe — exactement ce que l'asymétrie interdit dans l'autre sens.
 *
 * LA RÈGLE, PROPOSITION PAR PROPOSITION. Une phrase se coupe à « ; », « : »,
 * « mais », « et là » : dans « il m'est arrivé de me scarifier, mais là ce
 * soir je vais pas bien », le passé et le présent ne parlent pas de la même
 * chose. Dans chaque proposition qui porte une blessure :
 *   — un RÉCENT (hier, ce soir, ce week-end, depuis hier, je viens de, là, une
 *     date de la semaine) l'emporte : rouge — mieux vaut un rouge de trop ;
 *   — sauf si ce qui est écrit N'EST PAS UN ACTE de la personne : négation
 *     (« je ne me suis pas scarifié aujourd'hui »), conditionnel, un tiers
 *     (« sa collègue s'est scarifiée »), une question sur l'envie, un NOM
 *     rapporté au passé (« repensé à ma scarification de l'an dernier »),
 *     l'imparfait d'habitude (« je me scarifiais ») : jaune, évoqué ;
 *   — sinon un PASSÉ (un mois, une année, « il y a trois ans », « la fois où »,
 *     « quand j'avais », « pendant des années », le plus-que-parfait) : jaune ;
 *   — sinon : rouge (mot certain) ou rouge si la journée est en crise (mot
 *     ambigu). Et une phrase suivante qui ne dit QUE le passé (« C'était il y a
 *     longtemps ») requalifie la précédente.
 * Une REPRISE — « et là j'ai recommencé », « depuis hier ça recommence » — est
 * rouge dès que le texte a nommé une blessure : c'est le passé qui revient.
 * ------------------------------------------------------------------ */
const NOMBRE = '(?:\\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|quinze|vingt|trente|quelques|plusieurs)';
const MOIS_RE = '(?:janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)';
const RECIT_PASSE = new RegExp([
  `\\b(?:en |au mois de |depuis )?${MOIS_RE}\\b`, `\\b(?:19|20)\\d{2}\\b`,
  `\\bil y a (?:longtemps|des annees|des mois|des semaines|${NOMBRE} (?:ans?|annees?|mois|semaines?))\\b`,
  `\\bca fait ${NOMBRE} (?:ans?|annees?|mois|semaines?) que\\b`, `\\bpendant (?:des|${NOMBRE}) (?:annees?|ans?|mois|semaines?)\\b`, `\\bpendant (?:presque |plus d )?un an\\b`,
  `\\bl (?:an|annee|ete|hiver|automne|printemps) (?:derniere|dernier|passee|passe|d avant)\\b`, `\\b(?:la semaine|le mois|le week ?end) (?:derniere|dernier|passee|passe|d avant)\\b`,
  `\\bannees? (?:passees?|precedentes?|d avant)\\b`, `\\bquand j (?:etais|avais)\\b`, `\\bquand (?:il|elle) (?:etait|avait)\\b`, `\\ba l epoque\\b`, `\\bautrefois\\b`, `\\bplus jeune\\b`,
  `\\betant (?:petit|petite|jeune|ado|adolescent|adolescente|enfant)\\b`, `\\b(?:mon|ma|d|de l) (?:adolescence|enfance)\\b`, `\\bado,`, `^ado\\b`, `\\ba ${NOMBRE} ans\\b`, `\\bau (?:lycee|college)\\b`,
  `\\bla derniere fois que\\b`, `\\b(?:la|une) fois ou\\b`, `\\b(?:la|une) nuit ou\\b`, `\\ble jour ou\\b`, `\\b(?:la|une|cette) periode ou\\b`, `\\b(?:ca|cela) remonte (?:a|au)\\b`, `\\bremonte a\\b`,
  `\\ble lendemain de\\b`, `\\bla veille de\\b`, `\\bj avais (?:arrete|recommence|commence|deja)\\b`, `\\bm etais (?:deja )?\\b`, `\\bdeja\\b.*\\b(?:scarifi|taillad|mutil|coup)`,
  `\\bdepuis (?:ma|mes|sa|ses) (?:scarification|scarifications|ts|tentative|hospitalisation)\\b`,
  /* La langue d'un courrier médical : « antécédent de scarification » a fait
     un rouge « blessure » un jour où il n'y en avait aucune. */
  `\\bantecedents? (?:de|d)\\b`, `\\batcd\\b`, `\\bhistorique de\\b`,
].join('|'));
/* Le récit d'un parcours, ou un fait qui s'est répété dans le temps. */
const RACONTE_HISTOIRE = /\ba savoir\b|\bpour (?:info|contexte|te situer|que tu saches|que tu comprennes)\b|\b(?:sache|il faut que tu saches) que\b|\bje t explique\b|\bje te raconte\b|\bpar le passe\b|\bdans (?:le|mon) passe\b|\bmon (?:historique|parcours|vecu)\b|\bdans mon histoire\b|\bil m est arrive\b|\bca m est arrive\b|\bj ai (?:deja|longtemps)\b|\ba plusieurs reprises\b|\bplusieurs fois\b|\bquelques fois\b|\b(?:de nombreuses|maintes) fois\b|\b\d+ (?:fois|occasions?|reprises?)\b/;
/* Le RÉCENT : ce qui rattache l'acte à maintenant. « Hier » en fait partie : une scarification d'hier soir est un rouge. */
const RECENT = /\b(?:aujourd hui|ce matin|ce soir|cette nuit|ce midi|cet aprem|cet apres midi|la maintenant|maintenant|a l instant|tout de suite|la tout de suite|tout a l heure|hier|hier soir|avant hier|cette semaine|ce week ?end|en ce moment|depuis (?:hier|ce matin|ce soir|cette nuit|deux jours|trois jours|quelques jours|ce week ?end))\b|\bje viens de\b|\bla je\b|\bla j ai\b|\bla ca\b|\bet la\b|\bmais la\b/;
/* « il y a N jours » : récent jusqu'à une semaine, passé au-delà. */
const IL_Y_A_JOURS = /\bil y a (\d+|un|deux|trois|quatre|cinq|six|sept|huit|dix|quinze|vingt) jours?\b/;
const PETITS = { un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, quinze: 15, vingt: 20 };
const REPRISE = /\brecommenc|\brepris\b|\brefait\b|\ba nouveau\b|\bde nouveau\b|\bencore une fois\b|\bca recommence\b|\bca revient\b/;
const TIERS = /\b(?:il|elle|on|quelqu un|qui|l heroine|le heros|le personnage|sa collegue|son ami|son amie|mon frere|ma soeur|ma mere|mon pere|un ami|une amie|ma psy|mon psy|le psy|la psy|mon (?:ancien|ancienne) )\b[^,;.]{0,40}?\b(?:s est|se |s etait|s etaient|qu il|qu elle)\b/;
const NEGATION = /\b(?:ne|n) (?:me |m )?(?:suis|ai|avais|etais) (?:pas|plus|jamais)\b|\bjamais (?:eu|fait|ose)\b|\bpremiere fois depuis\b/;
const CONDITIONNEL = /\b(?:scarifierais|taillerais|tailladerais|mutilerais|couperais|brulerais|ferais du mal|si j avais)\b/;
/* « je me serais bien tailladé hier soir mais j'ai tenu » : aucune liste ne le
   reconnaissait, donc RIEN. C'est pourtant l'envie nommée ET tenue — le jaune
   existe exactement pour ça, et le silence était la pire des trois réponses. */
const CONDITIONNEL_PASSE = /\bme serais (?:bien |presque )?(?:taillade|tailladee|taille|taillee|scarifie|scarifiee|coupe|coupee|mutile|mutilee|brule|brulee|fait du mal)\b|\bj aurais (?:pu|bien) me (?:taillader|tailler|scarifier|couper|mutiler|faire du mal)\b/;
const TELLING = /\b(?:re)?pens(?:e|er|ais|ait) a\b|\bparl(?:e|er|ais|ait) de\b|\bon a parle\b|\ben therapie\b|\bma psy\b|\bmon psy\b|\bon est revenus? sur\b|\bje t explique\b|\bpour que tu comprennes\b|\bje te raconte\b|\bun article sur\b|\bun livre sur\b|\bdans le (?:bouquin|livre|film|roman)\b|\bdisait que\b|\bm a dit que\b|\bm a demande si\b|\bm a raconte\b/;
const NOM_BLESSURE = /\b(?:scarifications?|automutilations?|mutilations?|entailles?|tentatives?(?: de suicide)?|ts)\b/;
const IMPARFAIT = /\bme (?:scarifiais|tailladais|taillais|mutilais|coupais|brulais|faisais du mal|faisais mal)\b|\bje me faisais des entailles\b/;
const INFINITIF_QUESTION = /\?\s*$/;

const coupures = /\s*;\s*|\s*:\s*|,?\s+mais\s+(?=la\b|ce\b|hier\b|maintenant\b|depuis\b|je\b)|,?\s+et\s+(?=la\b|ce\b|hier\b|maintenant\b|depuis\b)|,\s+(?=la\b|et la\b|ce soir\b|hier\b|maintenant\b)/;
export const propositions = np => np.split(coupures).map(x => x.trim()).filter(Boolean);

/** Une date « le 3 septembre » : récente si elle tombe dans les huit derniers jours (ou aujourd'hui), passée sinon. */
function dateRecente(np, aujourdhui) {
  const m = new RegExp(`\\ble (\\d{1,2}) (${MOIS_RE})\\b`).exec(np);
  if (!m) return null;
  if (!aujourdhui) aujourdhui = new Date().toISOString().slice(0, 10);
  const mois = ['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'].indexOf(m[2]) + 1;
  const [y] = aujourdhui.split('-').map(Number);
  const essai = an => Date.UTC(an, mois - 1, +m[1]);
  const ref = Date.parse(aujourdhui + 'T00:00:00Z');
  let d = essai(y); if (d > ref) d = essai(y - 1);
  const jours = (ref - d) / 864e5;
  return jours >= 0 && jours <= 8;
}
function estRecent(np, aujourdhui) {
  if (RECENT.test(np)) return true;
  const m = IL_Y_A_JOURS.exec(np); if (m) { const n = PETITS[m[1]] ?? +m[1]; return n <= 7; }
  const d = dateRecente(np, aujourdhui); return d === true;
}
function estPasse(np, aujourdhui) {
  const d = dateRecente(np, aujourdhui); if (d !== null) return !d;   // « le 3 septembre » se juge sur la date, pas sur le mois
  if (RECIT_PASSE.test(np) || RACONTE_HISTOIRE.test(np)) return true;
  const m = IL_Y_A_JOURS.exec(np); if (m) { const n = PETITS[m[1]] ?? +m[1]; return n > 7; }
  return false;
}

const dedans = (t, mots) => mots.find(m => t.includes(m)) ?? null;

/*
 * LA PREUVE CONTIENT LE MOT QUI L'A DÉCLENCHÉE.
 *
 * L'extrait était les 160 premiers signes de la phrase. Sur une dictée de mille
 * signes sans un point, le mot tombait bien après : le bandeau montrait une
 * « preuve » qui ne prouvait rien — et un signe qu'on ne peut pas vérifier, on
 * ne peut pas non plus le contester. On coupe donc autour du mot, à 80 signes
 * de part et d'autre, sans couper un mot en deux.
 */
const FENETRE = 80;
function extraitAutour(p, mot) {
  const brut = String(p).trim();
  if (brut.length <= 2 * FENETRE) return brut;
  // Le texte normalisé comme `norm`, et pour chaque signe sa place dans le brut.
  let n = ''; const place = [];
  for (let i = 0; i < brut.length; i++) {
    let c = brut[i].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`\-]/g, ' ');
    if (/^\s+$/.test(c)) { if (n.endsWith(' ')) continue; c = ' '; }
    for (let k = 0; k < c.length; k++) { n += c[k]; place.push(i); }
  }
  const j = mot ? n.indexOf(mot) : -1;
  if (j < 0) return brut.slice(0, 2 * FENETRE);
  const debut = place[j], fin = place[j + mot.length - 1] + 1;
  let a = Math.max(0, debut - FENETRE), b = Math.min(brut.length, fin + FENETRE);
  if (a > 0) { const s = brut.indexOf(' ', a); if (s >= 0 && s < debut) a = s + 1; }
  if (b < brut.length) { const s = brut.lastIndexOf(' ', b); if (s >= fin) b = s; }
  return brut.slice(a, b).trim();
}

/*
 * UNE PREUVE QUI AFFIRME PLUTÔT QU'UNE PREUVE QUI DÉMENT.
 *
 * Un démenti (« je ne veux pas me tuer ») a été la preuve affichée d'un
 * jour où la même personne écrivait, plus loin, vouloir dormir pour toujours. Le
 * signe était juste, sa preuve disait le contraire. La règle « une négation
 * reste un jaune » ne change pas ; seul l'extrait montré change, quand un autre
 * passage du même genre dit la chose sans la nier.
 */
function motNie(extrait, mot) {
  const n = norm(extrait), j = mot ? n.indexOf(mot) : -1;
  if (j < 0) return false;
  return /\b(?:pas|plus|jamais|sans|non)\b/.test(n.slice(Math.max(0, j - 25), j));
}
const meilleurePreuve = (deja, neuf) => motNie(deja.extrait, deja.mot) && !motNie(neuf.extrait, neuf.mot);

/* Les gardes d'une surdose se lisent près d'elle : à dix mots de part et d'autre. */
function autourDe(q, i, n, mots = 10) {
  const avant = q.slice(0, i).split(' ').slice(-(mots + 1)).join(' ');
  const apres = q.slice(i + n).split(' ').slice(0, mots + 1).join(' ');
  return avant + q.slice(i, i + n) + apres;
}

/*
 * CE QUI N'EST PAS LA JOURNÉE DE LA PERSONNE : AU PLUS UN JAUNE « ÉVOQUÉ ».
 *
 * Un courrier de psychiatre collé un soir — des antécédents, dans la langue
 * du dossier — a fait un rouge « blessure » et un 3114 sur un jour où il n'y
 * avait aucune blessure. Un message RANGÉ au carnet (« ce texte ne compte
 * plus comme sa journée ») et un courrier entre soignants (« cher confrère »)
 * sont encore lus — on ne tait jamais un texte —, mais tout ce qu'ils portent
 * descend en jaune « une blessure ou une surdose passée a été évoquée ». On ne
 * reconnaît le courrier qu'à ses formules entre confrères, jamais à « le
 * patient » : « je suis la patiente du Dr X, j'ai envie de mourir » reste un
 * jaune « suicide ».
 *
 * LE COURRIER NE PLAFONNE QUE LA JOURNÉE, ET PAS CE QUE LA PERSONNE DIT D'ELLE.
 * Posé dans `niveauDuTexte`, il plafonnait tout le message, jusque dans le chat
 * en direct : « Cher confrère, je vous adresse ce patient. Et moi ce soir j'ai
 * avalé 10 cachets » ne donnait plus de réponse de crise. Il ne s'applique donc
 * qu'à ce qui lit la journée (`veilleDuJour`, `passagesDuJour`, comme le rangé ;
 * les moments de `journee.js` et l'heure des jours surveillés, pour ne jamais
 * être plus graves que le bandeau), et seulement aux motifs dont la phrase n'a
 * pas un « je » ET un maintenant.
 */
const COURRIER = /\bcher(?:e)? (?:confrere|cons(?:oe|œ)ur)\b|\bconfraternellement\b/;
export function auPasse(r) {
  if (!r?.niveau) return r;
  const { mot, extrait } = r.motifs[0];
  return { niveau: 'jaune', motifs: [{ genre: 'evoque_passe', niveau: 'jaune', mot, extrait }], motif: mot, extrait };
}
const PREMIERE_PERSONNE = /\b(?:je|j|me|m|moi)\b/;
export function plafondCourrier(texte, r, aujourdhui = null) {
  if (!r?.niveau || !COURRIER.test(norm(texte))) return r;
  const vecu = mo => { const n = norm(mo.extrait); return PREMIERE_PERSONNE.test(n) && estRecent(n, aujourdhui); };
  const garde = r.motifs.filter(vecu), bas = r.motifs.filter(mo => !vecu(mo));
  if (!bas.length) return r;
  const motifs = [...garde];
  if (!garde.some(mo => mo.genre === 'evoque_passe')) motifs.push(auPasse({ niveau: 'jaune', motifs: bas }).motifs[0]);
  motifs.sort((a, b) => (b.niveau === 'rouge' ? 1 : 0) - (a.niveau === 'rouge' ? 1 : 0));
  return { niveau: motifs.some(mo => mo.niveau === 'rouge') ? 'rouge' : 'jaune', motifs, motif: motifs[0].mot, extrait: motifs[0].extrait };
}

/**
 * LE NIVEAU D'UN TEXTE, ET LA PHRASE QUI L'A DÉCLENCHÉ.
 *
 * On découpe en phrases pour que la preuve soit une phrase et pas six cents
 * mots : ce qu'on veut montrer, c'est ce qu'on a écrit à cet endroit-là.
 *
 * @returns {{niveau: 'rouge'|'jaune'|null, motif, extrait}}
 */
export function niveauDuTexte(texte, { contexteDuJour = '', aujourdhui = null } = {}) {
  const t = norm(texte);
  if (!t.trim()) return { niveau: null, motifs: [] };
  const phrases = String(texte).split(/(?<=[.!?…])\s+|\n+/).filter(p => p.trim());
  const ctx = norm(contexteDuJour) + ' ' + t;
  const enCrise = !!dedans(ctx, CONTEXTE_CRISE);
  const texteNommeUneBlessure = !!(dedans(t, BLESSURE_CERTAINE) || BLESSURE_CERTAINE_RE.test(t) || dedans(t, BLESSURE_POSSIBLE) || BLESSURE_POSSIBLE_RE.test(t) || IMPARFAIT.test(t) || NOM_BLESSURE.test(t));
  const accidentDit = ACCIDENT.test(t);
  const tSansHyperbole = t.replace(HYPERBOLE, ' ');

  const motifs = [];
  const poser = (genre, niveau, mot, p) => {
    const neuf = { genre, niveau, mot, extrait: extraitAutour(p, mot) };
    const i = motifs.findIndex(m => m.genre === genre);   // un genre, une fois
    if (i < 0) motifs.push(neuf);
    else if (meilleurePreuve(motifs[i], neuf)) motifs[i] = neuf;
  };
  /* Une phrase suivante qui ne dit QUE le passé (« C'était il y a longtemps. ») parle de la précédente. */
  const suivanteAuPasse = i => { const s = phrases[i + 1]; if (!s || s.length > 90) return false; const ns = norm(s); return estPasse(ns, aujourdhui) && !dedans(ns, BLESSURE_CERTAINE) && !dedans(ns, BLESSURE_POSSIBLE) && !estRecent(ns, aujourdhui); };

  phrases.forEach((p, i) => {
    const np = norm(p);
    const phraseAuPasse = estPasse(np, aujourdhui) && !estRecent(np, aujourdhui);
    for (const prop of propositions(np)) {
      const certaine = dedans(prop, BLESSURE_CERTAINE) ?? BLESSURE_CERTAINE_RE.exec(prop)?.[0] ?? null;
      const possible = certaine ? null : (dedans(prop, BLESSURE_POSSIBLE) ?? BLESSURE_POSSIBLE_RE.exec(prop)?.[0] ?? null);
      const imparfait = IMPARFAIT.test(prop);
      const recent = estRecent(prop, aujourdhui), passe = estPasse(prop, aujourdhui) || suivanteAuPasse(i);
      /* LA REPRISE : « et là j'ai recommencé » est une blessure d'aujourd'hui dès que le texte en a nommé une. */
      if (recent && REPRISE.test(prop) && texteNommeUneBlessure) { poser('blessure', 'rouge', 'recommence', p); continue; }
      if (CONDITIONNEL_PASSE.test(prop)) { poser('evoque_passe', 'jaune', CONDITIONNEL_PASSE.exec(prop)[0], p); continue; }
      if (certaine || possible || imparfait) {
        const mot = certaine ?? possible ?? 'imparfait';
        const pasUnActe = NEGATION.test(prop) || CONDITIONNEL.test(prop) || TIERS.test(prop)
          || (INFINITIF_QUESTION.test(p.trim()) && /\b(?:se |me )?(?:scarifier|couper|bruler|faire du mal)\b/.test(prop) && !recent)
          || (NOM_BLESSURE.test(prop) && passe && (TELLING.test(prop) || !/\bme suis\b/.test(prop)))
          || (NOM_BLESSURE.test(prop) && !/\b(?:me suis|je me|j ai|me )\b/.test(prop) && phraseAuPasse)   // « scarifications : mars 2019, juillet 2020 » — un nom, une chronologie
          || (imparfait && !recent);
        if (pasUnActe) { poser('evoque_passe', 'jaune', mot, p); continue; }
        if (recent) {
          // un mot ambigu, récent : rouge s'il y a la crise, ou une répétition (« coupé 3 fois depuis hier »)
          // qui n'est pas un accident dit ; sinon jaune, sauf l'accident dit -- plutôt jaune que rien
          if (certaine || enCrise || (/\b\d+ fois\b|\bencore\b|\ba nouveau\b/.test(prop) && !accidentDit)) poser('blessure', 'rouge', mot, p);
          else if (possible && !accidentDit && !imparfait) poser('blessure', 'jaune', mot, p);
          continue;
        }
        if (passe) { poser('evoque_passe', 'jaune', mot, p); continue; }
        if (certaine) poser('blessure', 'rouge', mot, p);
        else if (possible && enCrise) poser('blessure', 'rouge', mot, p);
      }
      /* « je viens de me faire du mal » : l'intention de crise devient un acte quand elle est récente et accomplie. */
      if (recent && /\b(?:je viens de|j ai fini par|j ai encore|je me suis) (?:me )?(?:faire du mal|faire mal|fait du mal|fait mal)\b/.test(prop) && !NEGATION.test(prop)) poser('blessure', 'rouge', 'me faire du mal', p);
    }

    /* LES SUBSTANCES, PROPOSITION PAR PROPOSITION, AVEC LE TEMPS DU RESTE. */
    for (const prop of propositions(np)) {
      const q = prop.replace(SUBSTANCE_HYPERBOLE, ' ');
      const recent = estRecent(q, aujourdhui), passe = estPasse(q, aujourdhui) || suivanteAuPasse(i);
      const tiers = s => SUBSTANCE_TIERS.test(s) && !/\b(?:je|j ai|moi|on a)\b/.test(s);
      /*
       * LA SURDOSE, AVEC SES GARDES PRÈS D'ELLE.
       *
       * Une proposition dictée fait parfois cent mots. Un « sobre », un « il »
       * placés loin devant effaçaient toute la proposition — et avec elle
       * l'idée d'avaler la plaquette. La négation et le tiers ne comptent donc,
       * pour une surdose, qu'à dix mots d'elle.
       */
      /* Chaque surdose de la proposition est lue, et la plus grave l'emporte :
         « overdose, j'ai avalé toute la plaquette » ne se jugeait que sur le
         premier mot, un nom nu — et l'acte écrit juste après était perdu. */
      const lire = (surdose, total) => {
        const autour = autourDe(q, surdose.index, surdose[0].length);
        if (tiers(autour) || SUBSTANCE_NEGATION.test(autour)) return null;
        const mot = surdose[0], avant = n => q.slice(Math.max(0, surdose.index - n), surdose.index);
        if (INFINITIF_QUESTION.test(p.trim()) && !recent && !/\bj ai\b|\bje me suis\b/.test(q)) return ['evoque_passe', 'jaune', mot];
        const acte = ACTE_SURDOSE.test(q) || acteDeSurdose(q, surdose);
        if (INTENTION_SURDOSE.test(q) && envieDeSurdose(q, surdose) && !acte && !recent) return ['suicide', 'jaune', mot];
        if (passe && !recent) return ['evoque_passe', 'jaune', mot];
        if (SURDOSE_NOM.test(mot) && !recent && !ACTE_SURDOSE.test(autour) && !SURDOSE_VECUE.test(q)
            && !SURDOSE_VECUE_AVANT.test(avant(25)) && !SURDOSE_VECUE_LOIN.test(avant(40))) return ['suicide', 'jaune', mot];
        if ((total || COMPTE.test(mot)) && DOSE_PRESCRITE.test(autourDe(q, surdose.index, mot.length, 5))) return ['substance', 'jaune', mot];
        return ['surdose', 'rouge', mot];
      };
      const lus = [...q.matchAll(SURDOSE_TOUTES)].map(s => lire(s, false));
      const total = PRISE_MEDOC.test(q) ? TOTAL_PRIS.exec(q) : null;
      if (total) lus.push(lire(total, true));
      const pire = lus.find(l => l?.[1] === 'rouge') ?? lus.find(Boolean);
      if (pire) { poser(pire[0], pire[1], pire[2], p); continue; }
      if (tiers(q)) continue;
      if (SUBSTANCE_NEGATION.test(q)) continue;
      /* « tous mes anxios » dans une envie, un « je vais » : l'idée (jaune). Un
         « je vais » décidé, avec « ce soir », « là » et un verbe d'avalage, c'est
         le moment (rouge) ; un souhait reste un souhait, même près d'un « à
         partir de maintenant » ; avec sa posologie, c'est le traitement (rien). */
      if (TOUS_MES_MEDOCS.test(q) && ENVIE_TOUS_MES.test(q) && AVALER.test(q) && !ACTE_SURDOSE.test(q) && !DOSE_PRESCRITE.test(q)) {
        const mot = TOUS_MES_MEDOCS.exec(q)[0];
        if (recent && AVALER_TOUT.test(q) && /\bje (?:vais|veux)\b/.test(q)) poser('surdose', 'rouge', mot, p); else poser('suicide', 'jaune', mot, p);
        continue;
      }
      let exces = null;
      if (ALCOOL_EXCES.test(q)) exces = ALCOOL_EXCES.exec(q)[0];
      else if (DROGUE.test(q) && PRISE.test(q)) exces = DROGUE.exec(q)[0];
      else if (PRISE_SEULE.test(q)) exces = PRISE_SEULE.exec(q)[0];
      else if (CANNABIS.test(q) || MEDOC.test(q)) {
        const medocs = q.match(new RegExp(MEDOC.source, 'g')) ?? [];
        const qExces = !CANNABIS.test(q) && medocs.length && medocs.every(m => ANXIO_RE.test(m)) ? q.replace(USAGE_ANXIO, ' ') : q;
        if (EXCES.test(qExces)) exces = (CANNABIS.exec(q) ?? MEDOC.exec(q))[0];
      }
      if (!exces) continue;
      if (SUBSTANCE_INTENTION.test(q) && !/\bj ai\b(?! (?:peur|envie|l impression|besoin)\b)|\bje me suis\b|\bje suis\b/.test(q)) continue;   // l'envie n'est pas la prise
      if (passe && !recent) continue;                                                            // un récit ancien ne marque pas le jour
      poser('substance', 'jaune', exces, p);
    }

    const npSansHyperbole = np.replace(HYPERBOLE, ' ');
    const presents = SUICIDE.filter(m => npSansHyperbole.includes(m));
    const s = presents.find(m => !motNie(p, m)) ?? presents[0] ?? (SUICIDE_SIGLES.test(np) ? 'ts' : null);
    if (s) poser('suicide', 'jaune', s, p);

    const mal = ENVIE_MAL.exec(np);
    if (mal) poser('envie_mal', 'jaune', mal[0], p);

    /* L'objet ET la proximité, dans la même phrase : c'est la paire qui
       distingue un objet mentionné d'un objet tenu. */
    const objet = dedans(np, MOYEN);
    /* L'INTENTION DATÉE ET LE MOYEN PRÊT : un ROUGE. « je vais me tuer ce soir,
       j'ai la corde » ne donnait qu'un jaune « suicide » -- l'idée, sans voir le
       plan. Le plan peut être dans une autre phrase que le moyen : on les lit
       sur tout le texte, et le moyen doit être à soi, prêt (« j'ai la corde »). */
    if (objet && PLAN_PROCHE.test(tSansHyperbole) && !PLAN_NIE.test(tSansHyperbole)
        && new RegExp(`\\b(?:j ai|j ai achete|j ai prepare|j ai sorti|j ai pris|je tiens|je garde) (?:la |le |les |l |une |un |des |mon |ma |mes )?(?:${MOYEN.join('|')})\\b`).test(np)
        && !TIERS.test(np)) {
      poser('moyen', 'rouge', objet, p);
    }
    if (objet) {
      // Un tiers qui tient un couteau, une négation, un souvenir : pas un geste.
      const pasLui = TIERS.test(np) || NEGATION.test(np) || estPasse(np, aujourdhui);
      /* L'IMPARFAIT EST LUI-MÊME LA MARQUE DU PASSÉ. « ado je jouais avec un
         couteau quand j'allais mal » ne déclenchait rien : EN_MAIN ne connaît
         que le présent (« je joue avec »). L'ajouter au présent en ferait un
         rouge sur un souvenir d'adolescence ; il lui faut donc sa propre
         branche, et elle est jaune par construction. */
      if (EN_MAIN_IMPARFAIT.test(np)) poser('evoque_passe', 'jaune', objet, p);
      else if (dedans(np, EN_MAIN) && !pasLui) poser('en_main', 'rouge', objet, p);
      else if (dedans(np, A_PORTEE)) poser('moyen', 'jaune', objet, p);
    }

    const d = dedans(np, DEREALISATION) ?? DEREALISATION_LA.exec(np)?.[0];
    if (d) poser('dereel', 'jaune', d, p);
  });

  if (!motifs.length) return { niveau: null, motifs: [] };
  const niveau = motifs.some(m => m.niveau === 'rouge') ? 'rouge' : 'jaune';
  // Le motif le plus grave d'abord : c'est celui qu'on lit si on n'en lit qu'un.
  motifs.sort((a, b) => (b.niveau === 'rouge' ? 1 : 0) - (a.niveau === 'rouge' ? 1 : 0));
  return { niveau, motifs, motif: motifs[0].mot, extrait: motifs[0].extrait };
}

/**
 * LA VEILLE D'UNE JOURNÉE.
 *
 * Elle ne lit QUE ce que la personne a écrit — `role === 'user'`. Ce que le
 * compagnon répond ne compte pas : il lui arrive de nommer ce qu'il a compris,
 * et un signe rouge déclenché par la phrase d'une machine serait une machine
 * qui s'alarme d'elle-même.
 *
 * @returns {{niveau, motif, extrait, passages} | null}
 */
export function veilleDuJour(date, userId, { messages = null } = {}) {
  const msgs = (messages ?? messagesForDate(date, userId))
    .filter(m => m.role === 'user' && m.text?.trim());
  if (!msgs.length) return null;

  // Le contexte de la journée entière : c'est lui qui fait basculer une
  // blessure possible en rouge, et il ne se lit pas message par message.
  // Un texte rangé au carnet n'en fait pas partie : il n'est pas la journée.
  const contexteDuJour = msgs.filter(m => !m.rangee).map(m => m.text).join(' ');

  const tous = [];
  let passages = 0;
  for (const m of msgs) {
    let r = plafondCourrier(m.text, niveauDuTexte(m.text, { contexteDuJour, aujourdhui: date }), date);
    if (m.rangee) r = auPasse(r);          // lu quand même, mais au plus un jaune « évoqué »
    if (!r.niveau) continue;
    passages++;
    for (const mo of r.motifs) {
      const i = tous.findIndex(x => x.genre === mo.genre);
      if (i < 0) tous.push(mo);
      else if (meilleurePreuve(tous[i], mo)) tous[i] = mo;
    }
  }
  if (!tous.length) return null;
  tous.sort((a, b) => (b.niveau === 'rouge' ? 1 : 0) - (a.niveau === 'rouge' ? 1 : 0));
  return {
    niveau: tous.some(m => m.niveau === 'rouge') ? 'rouge' : 'jaune',
    motifs: tous, motif: tous[0].mot, extrait: tous[0].extrait, passages
  };
}

/** Le pire niveau d'un ensemble de jours — pour un mois, une année. */
export const NIVEAUX = { rouge: 2, jaune: 1 };
export function pireNiveau(veilles) {
  let pire = null;
  for (const v of veilles ?? []) {
    if (!v?.niveau) continue;
    if (!pire || NIVEAUX[v.niveau] > NIVEAUX[pire]) pire = v.niveau;
  }
  return pire;
}

/**
 * CE QU'ON ÉCRIT À CÔTÉ DU SIGNE.
 *
 * Des faits, au passé, sur ce qui a été écrit. Pas « tu vas mal », pas « fais
 * attention » : la personne sait déjà comment elle va, et un rappel formulé
 * comme un reproche est un rappel qu'on ferme.
 */
/**
 * CE QU'ON ÉCRIT À CÔTÉ DU SIGNE — par GENRE, pas par couleur.
 *
 * « Le suicide a été évoqué » et « un objet dangereux était à portée » sont
 * deux jaunes, et ce ne sont pas la même journée. Une couleur seule range ; ce
 * qui informe, c'est le mot.
 */
export const DIT = {
  suicide:  'le suicide a été évoqué ce jour-là',
  envie_mal: 'l’envie de se faire du mal est écrite ce jour-là',
  moyen:    'quelque chose pour se faire mal était à portée',
  en_main:  'quelque chose pour se faire mal était dans ta main, en écrivant',
  dereel:   'un moment où le réel s’est décollé',
  blessure: 'une blessure est écrite ce jour-là',
  // Une blessure ANCIENNE, racontée. Pas « ce jour-là » : c'est un souvenir qui
  // remonte, pas un geste du jour. Le distinguer, c'est ne pas crier « blessure
  // aujourd'hui » quand quelqu'un revient sur ce qui lui est arrivé.
  evoque_passe: 'une blessure ou une surdose passée a été évoquée',
  substance: 'un excès d’alcool ou une prise de substance est écrite ce jour-là',
  surdose:  'une surdose est écrite ce jour-là'
};

/*
 * LE 3114, ET LE SEUL ENDROIT OÙ IL A SA PLACE.
 *
 * Affiché en permanence, un numéro d'urgence devient du décor : on cesse de le
 * voir en trois jours, et il n'est plus là le jour où il compte. Il apparaît
 * donc sur un jour ROUGE, et seulement là.
 *
 * Pas sur un jaune : parler de suicide n'est pas être en train de passer à
 * l'acte, et répondre à quelqu'un qui y pense en lui tendant un numéro est une
 * façon de ne pas l'écouter.
 */
export const AIDE = 'Si tu as besoin de parler à quelqu’un maintenant : 3114, gratuit, 24 h/24, partout en France.';
