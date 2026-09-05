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
 *   JAUNE  le suicide a été évoqué, un moyen était à portée, le réel s'est
 *          décollé, un excès (alcool, drogue, médicament hors dose) est écrit
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

const norm = s => String(s ?? '').toLowerCase()
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
  'passage a l acte', 'me pendre', 'me jeter'
];
/* « TS » est une abréviation et pas un mot : elle ne se cherche qu'entourée de
   frontières, sans quoi « ts » attrape la moitié du dictionnaire. */
const SUICIDE_SIGLES = /\bts\b/;
/* Les hyperboles de tous les jours, où ce n'est pas la personne qui se tue :
   « mon chef va me tuer », « ça va me tuer », « envie de mourir de honte ». Elles
   s'effacent AVANT la recherche — « je vais me tuer » (vais) reste entier. */
const HYPERBOLE = /\b(?:va|vont|veut|veulent|voudrait|voudraient|pourrait|pourraient|peut|peuvent|risque de|risquent de|essaie de|essaye de|cherche a|cherchent a|vas|allait|allaient) me tuer\b|\bme tuer (?:a la tache|au travail|au boulot|a l ouvrage)\b|\benvie de mourir de (?:honte|rire)\b|\bmourir de (?:honte|rire)\b/g;

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
const A_PORTEE = ['a cote', 'a portee', 'dans la main', 'dans les mains', 'je joue avec',
                  'je tiens', 'je le garde', 'je la garde', 'devant moi', 'sur la table',
                  'sous mon lit', 'dans ma poche', 'je le touche', 'je regarde la'];

/* ---------------------------------------------------------------------
 * JAUNE ENCORE : la déréalisation, quand elle se NOMME.
 *
 * On ne détecte que ce qui se dit en toutes lettres. Reconnaître un état
 * dissociatif à la syntaxe d'un message — les phrases qui se percutent, le
 * passage à la troisième personne sur soi-même — se ferait à coups de faux
 * positifs sur n'importe quel texte écrit vite, un soir, sans ponctuation. Une
 * alerte qui se déclenche parce qu'on tape mal est une alerte qu'on éteint.
 * ------------------------------------------------------------------ */
const DEREALISATION = [
  'dereal', 'derealisation', 'depersonnalisation', 'depersonnalise',
  'irreel', 'pas vraiment la', 'pas vraiment reel', 'comme dans un reve',
  'comme un film', 'je me regarde de loin', 'je me vois de l exterieur',
  'plus dans mon corps', 'plus dans mon propre corps', 'decale de la realite',
  'dans du coton', 'brouillard', 'plus rien n est reel', 'je sais plus ce qui est reel'
];

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
const UNITE_MEDOC = '(?:cachets|comprimes|medicaments|medocs|gelules|pilules|doliprane|dafalgan|efferalgan|paracetamol|ibuprofene|aspirine|xanax|lexomil|valium|temesta|seresta|imovane|stilnox|zolpidem|tramadol|codeine|benzos?)';
const SURDOSE = new RegExp([
  '\\boverdose\\b', '\\bsurdose\\b', '\\bsurdosage\\b', '\\bod\\b', '\\bintoxication (?:medicamenteuse|volontaire)\\b',
  '\\btrop de (?:cachets|comprimes|medicaments|medocs|gelules|pilules|xanax|lexomil|valium|doliprane|paracetamol|dafalgan|codeine|tramadol)\\b',
  '\\b(?:toute|tout) (?:la|ma|une|le|mon) (?:boite|plaquette|tube|flacon|stock|reserve)\\b', '\\b(?:la|ma) (?:boite|plaquette) (?:entiere|complete)\\b',
  '\\btous mes (?:cachets|comprimes|medicaments|medocs)\\b', '\\btout mon (?:xanax|lexomil|valium|traitement|stock)\\b',
  `\\b(?:avale|pris|gobe|ingere) ${NB_CACHETS} ${UNITE_MEDOC}\\b`,
  '\\b(?:double|triple|quadruple) (?:ma|la) dose\\b', `\\b${NB_CACHETS} fois (?:ma|la) dose\\b`, '\\bdose (?:doublee|triplee)\\b',
  '\\blavage d estomac\\b', '\\bcoma ethylique\\b', '\\bcoma\\b.{0,30}\\b(?:alcool|cachets|medicaments)\\b',
  '\\bmelang\\w* .{0,25}\\b(?:alcool|vodka|whisky|rhum|gin|biere|vin)\\b.{0,25}\\b(?:cachets|comprimes|medicaments|medocs|xanax|lexomil|valium|codeine|tramadol|benzo)\\b',
  '\\bmelang\\w* .{0,25}\\b(?:cachets|comprimes|medicaments|medocs|xanax|lexomil|valium|codeine|tramadol|benzo)\\b.{0,25}\\b(?:alcool|vodka|whisky|rhum|gin|biere|vin)\\b',
].join('|'));
/* L'alcool en excès : ce n'est pas « bu », c'est « trop bu ». */
const ALCOOL_EXCES = /\b(?:trop|beaucoup trop|bien trop|enormement) bu\b|\bbu (?:trop|toute la (?:soiree|nuit|journee|bouteille)|jusqu a (?:vomir|tomber|plus savoir|l oubli|pas savoir))\b|\bbourre(?:e|es)?\b|\bivre(?: morte?)?\b|\b(?:une |grosse |la )?cuite\b|\bblack ?out\b|\btrou noir\b|\bgueule de bois\b|\b(?:fini|vide|descendu|siffle) (?:la|une|toute la) bouteille\b|\bune bouteille (?:entiere|de (?:vodka|whisky|rhum|gin|vin))\b|\bbinge\b|\bdefonce(?:e|es)?\b|\btorche(?:e|es)?\b|\bcomplet(?:ement)? raide\b|\bvomi .{0,20}\balcool\b|\b(?:six|sept|huit|dix|\d+) (?:verres|bieres|shots|pintes)\b/;
/* Les drogues : un mot ne suffit pas, il faut la prise (« j'ai pris », « sniffé », « sous »). */
const DROGUE = /\b(?:coke|cocaine|cc|md|mdma|ecsta|ecstasy|taz|ket|ketamine|lsd|acide|buvard|champi|champis|champignons|speed|amphet|amphetamines|meth|crack|heroine|hero|opium|opiaces|poppers|protoxyde|proto|ballons|gaz hilarant|gbl|ghb|3 ?mmc|4 ?mmc|cathinones|chems|drogue|drogues|dope)\b/;
const PRISE = /\b(?:j ai|je me suis|on a|je) (?:pris|repris|sniffe|snife|gobe|tape|fume|consomme|avale|shoote|injecte|fait)\b|\bune trace\b|\bun rail\b|\bdes traces\b|\bdes rails\b|\bun ballon\b|\bdes ballons\b|\bje (?:prends|sniffe|gobe|tape|consomme)\b|\bsous (?:coke|cocaine|md|mdma|ecsta|ket|ketamine|lsd|acide|speed|meth|crack|hero|heroine|ghb|drogue)\b|\bme (?:suis )?drogu\w*\b|\bje me drogue\b|\bj ai (?:re)?plonge\b/;
/* La prise qui se suffit : « tapé des traces », « deux rails », « sniffé » — la substance n'est pas nommée, la prise l'est. */
const PRISE_SEULE = /\b(?:tape|sniffe|pris|fait|enchaine) (?:une|des|deux|trois|quatre|quelques|plusieurs) (?:traces?|rails?)\b|\b(?:un|deux|trois|quatre|cinq|des|quelques|plusieurs) rails?\b(?! (?:de|du) (?:train|tram|metro|securite))|\bsniffe\b|\bje me suis (?:shoote|shootee|injecte|injectee|pique|piquee)\b/;
/* Le cannabis et les médicaments : seulement en excès ou hors ordonnance. */
const CANNABIS = /\b(?:joint|joints|beuh|weed|shit|bedo|bedos|pet|pets|cannabis|spliff|spliffs|bang|bangs|bhang)\b/;
const MEDOC = /\b(?:xanax|lexomil|valium|temesta|seresta|benzo|benzos|zolpidem|stilnox|imovane|codeine|tramadol|oxy|oxycodone|morphine|ritaline|methylphenidate|somnifere|somniferes|anxiolytique|anxiolytiques|cachets|comprimes|medocs|medicaments)\b/;
const EXCES = /\btrop\b|\btoute la (?:journee|nuit|soiree)\b|\benchaine\b|\bnon stop\b|\bsans arret\b|\b(?:trois|quatre|cinq|six|sept|huit|dix|\d+) (?:joints|bedos|pets|cachets|comprimes|xanax|lexomil)\b|\bplus que (?:prevu|d habitude|la dose|prescrit)\b|\bsans ordonnance\b|\bpas prescrit\b|\bpas a moi\b|\bde ma mere\b|\bde mon pere\b|\bpour (?:dormir|planer|oublier|me calmer|tenir|m assommer|ne plus rien sentir)\b|\bavec de l alcool\b|\bavec l alcool\b/;
/* Ce qui ressemble à un excès et n'en est pas. */
const SUBSTANCE_HYPERBOLE = /\bivre de (?:joie|bonheur|rage|colere|fatigue)\b|\bbourre(?:e|es)? (?:de|d) (?!(?:vodka|whisky|rhum|gin|biere|bieres|vin|alcool|champagne|pastis|shots)\b)\w+|\bdefonce(?:e)? (?:de fatigue|par le sport|apres le sport|par la salle|par la seance)\b|\bcuite au four\b|\bcuite a la vapeur\b|\bune drogue douce\b|\bc est ma drogue\b|\bcomme une drogue\b|\bdrogue (?:du|de la|au) (?:travail|boulot|sport|sucre|serie|jeu)\b|\bcoke (?:zero|light|cola)\b|\bcoca\b|\bshit(?:ty)?\b(?= (?:day|show|storm))|\btaz(?:manie)?\b/g;
const SUBSTANCE_TIERS = /\b(?:il|elle|ils|elles|on|mon frere|ma soeur|mon pere|ma mere|mon pote|ma pote|mon ami|mon amie|ma copine|mon copain|mon mec|ma meuf|mon ex|mon coloc|ma coloc|les gens|tout le monde|quelqu un|un mec|une fille|mon oncle|ma tante|mon cousin|ma cousine|les autres|mes potes|mes amis|le voisin|la voisine)\b[^,;.]{0,30}\b(?:etait|etaient|est|sont|a |ont |s est|se sont|avait|avaient|buvait|buvaient|prenait|prenaient|prend|boit)\b/;
const SUBSTANCE_NEGATION = /\b(?:ne|n) (?:me suis )?(?:ai|suis|avais|etais|bois|prends|touche|fume) (?:pas|plus|jamais|rien)\b|\bpas (?:bu|pris|touche|fume|sniffe)\b|\bjamais (?:bu|pris|touche|fume|sniffe)\b|\bplus (?:bu|pris|touche|fume) depuis\b|\bsans (?:boire|alcool|rien prendre|toucher)\b|\bsobre\b|\barrete de (?:boire|fumer|prendre)\b|\bj ai arrete\b|\bzero alcool\b|\bpas une goutte\b|\bpas un verre\b/;
const SUBSTANCE_INTENTION = /\benvie de (?:boire|me bourrer|me defoncer|prendre|reprendre|replonger|me mettre une cuite|sniffer)\b|\bj aimerais (?:boire|prendre|reprendre|me defoncer)\b|\bje vais (?:boire|me bourrer|me defoncer|prendre|reprendre|replonger)\b|\bsi je (?:bois|prends|reprends)\b|\bpour (?:ne pas|pas) (?:boire|reprendre|replonger|craquer)\b/;

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
  `\\b(?:la|une) fois ou\\b`, `\\b(?:la|une) nuit ou\\b`, `\\ble jour ou\\b`, `\\b(?:la|une|cette) periode ou\\b`, `\\b(?:ca|cela) remonte (?:a|au)\\b`, `\\bremonte a\\b`,
  `\\ble lendemain de\\b`, `\\bla veille de\\b`, `\\bj avais (?:arrete|recommence|commence|deja)\\b`, `\\bm etais (?:deja )?\\b`, `\\bdeja\\b.*\\b(?:scarifi|taillad|mutil|coup)`,
  `\\bdepuis (?:ma|mes|sa|ses) (?:scarification|scarifications|ts|tentative|hospitalisation)\\b`,
].join('|'));
/* Le récit d'un parcours, ou un fait qui s'est répété dans le temps. */
const RACONTE_HISTOIRE = /\ba savoir\b|\bpour (?:info|contexte|te situer|que tu saches|que tu comprennes)\b|\b(?:sache|il faut que tu saches) que\b|\bje t explique\b|\bje te raconte\b|\bpar le passe\b|\bdans (?:le|mon) passe\b|\bmon (?:historique|parcours|vecu)\b|\bdans mon histoire\b|\bil m est arrive\b|\bca m est arrive\b|\bj ai (?:deja|longtemps)\b|\ba plusieurs reprises\b|\bplusieurs fois\b|\b(?:de nombreuses|maintes) fois\b|\b\d+ (?:fois|occasions?|reprises?)\b/;
/* Le RÉCENT : ce qui rattache l'acte à maintenant. « Hier » en fait partie : une scarification d'hier soir est un rouge. */
const RECENT = /\b(?:aujourd hui|ce matin|ce soir|cette nuit|ce midi|cet aprem|cet apres midi|la maintenant|maintenant|a l instant|tout de suite|la tout de suite|tout a l heure|hier|hier soir|avant hier|cette semaine|ce week ?end|en ce moment|depuis (?:hier|ce matin|ce soir|cette nuit|deux jours|trois jours|quelques jours|ce week ?end))\b|\bje viens de\b|\bla je\b|\bla j ai\b|\bla ca\b|\bet la\b|\bmais la\b/;
/* « il y a N jours » : récent jusqu'à une semaine, passé au-delà. */
const IL_Y_A_JOURS = /\bil y a (\d+|un|deux|trois|quatre|cinq|six|sept|huit|dix|quinze|vingt) jours?\b/;
const PETITS = { un: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, dix: 10, quinze: 15, vingt: 20 };
const REPRISE = /\brecommenc|\brepris\b|\brefait\b|\ba nouveau\b|\bde nouveau\b|\bencore une fois\b|\bca recommence\b|\bca revient\b/;
const TIERS = /\b(?:il|elle|on|quelqu un|qui|l heroine|le heros|le personnage|sa collegue|son ami|son amie|mon frere|ma soeur|ma mere|mon pere|un ami|une amie|ma psy|mon psy|le psy|la psy|mon (?:ancien|ancienne) )\b[^,;.]{0,40}?\b(?:s est|se |s etait|s etaient|qu il|qu elle)\b/;
const NEGATION = /\b(?:ne|n) (?:me |m )?(?:suis|ai|avais|etais) (?:pas|plus|jamais)\b|\bjamais (?:eu|fait|ose)\b|\bpremiere fois depuis\b/;
const CONDITIONNEL = /\b(?:scarifierais|taillerais|tailladerais|mutilerais|couperais|brulerais|ferais du mal|si j avais)\b/;
const TELLING = /\b(?:re)?pens(?:e|er|ais|ait) a\b|\bparl(?:e|er|ais|ait) de\b|\bon a parle\b|\ben therapie\b|\bma psy\b|\bmon psy\b|\bon est revenus? sur\b|\bje t explique\b|\bpour que tu comprennes\b|\bje te raconte\b|\bun article sur\b|\bun livre sur\b|\bdans le (?:bouquin|livre|film|roman)\b|\bdisait que\b|\bm a dit que\b|\bm a demande si\b|\bm a raconte\b/;
const NOM_BLESSURE = /\b(?:scarifications?|automutilations?|mutilations?|entailles?|tentatives?(?: de suicide)?|ts)\b/;
const IMPARFAIT = /\bme (?:scarifiais|tailladais|taillais|mutilais|coupais|brulais|faisais du mal|faisais mal)\b|\bje me faisais des entailles\b/;
const INFINITIF_QUESTION = /\?\s*$/;

const coupures = /\s*;\s*|\s*:\s*|,?\s+mais\s+(?=la\b|ce\b|hier\b|maintenant\b|depuis\b|je\b)|,?\s+et\s+(?=la\b|ce\b|hier\b|maintenant\b|depuis\b)|,\s+(?=la\b|et la\b|ce soir\b|hier\b|maintenant\b)/;
const propositions = np => np.split(coupures).map(x => x.trim()).filter(Boolean);

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
  const texteNommeUneBlessure = !!(dedans(t, BLESSURE_CERTAINE) || dedans(t, BLESSURE_POSSIBLE) || IMPARFAIT.test(t) || NOM_BLESSURE.test(t));

  const motifs = [];
  const poser = (genre, niveau, mot, p) => {
    if (motifs.some(m => m.genre === genre)) return;    // un genre, une fois
    motifs.push({ genre, niveau, mot, extrait: p.trim().slice(0, 160) });
  };
  /* Une phrase suivante qui ne dit QUE le passé (« C'était il y a longtemps. ») parle de la précédente. */
  const suivanteAuPasse = i => { const s = phrases[i + 1]; if (!s || s.length > 90) return false; const ns = norm(s); return estPasse(ns, aujourdhui) && !dedans(ns, BLESSURE_CERTAINE) && !dedans(ns, BLESSURE_POSSIBLE) && !estRecent(ns, aujourdhui); };

  phrases.forEach((p, i) => {
    const np = norm(p);
    const phraseAuPasse = estPasse(np, aujourdhui) && !estRecent(np, aujourdhui);
    for (const prop of propositions(np)) {
      const certaine = dedans(prop, BLESSURE_CERTAINE);
      const possible = certaine ? null : dedans(prop, BLESSURE_POSSIBLE);
      const imparfait = IMPARFAIT.test(prop);
      const recent = estRecent(prop, aujourdhui), passe = estPasse(prop, aujourdhui) || suivanteAuPasse(i);
      /* LA REPRISE : « et là j'ai recommencé » est une blessure d'aujourd'hui dès que le texte en a nommé une. */
      if (recent && REPRISE.test(prop) && texteNommeUneBlessure) { poser('blessure', 'rouge', 'recommence', p); continue; }
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
          if (certaine || enCrise || /\b\d+ fois\b|\bencore\b|\ba nouveau\b/.test(prop)) poser('blessure', 'rouge', mot, p);
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
      if (SUBSTANCE_TIERS.test(q) && !/\b(?:je|j ai|moi|on a)\b/.test(q)) continue;
      if (SUBSTANCE_NEGATION.test(q)) continue;
      if (SURDOSE.test(q)) {
        const mot = SURDOSE.exec(q)[0];
        if (INFINITIF_QUESTION.test(p.trim()) && !recent && !/\bj ai\b|\bje me suis\b/.test(q)) { poser('evoque_passe', 'jaune', mot, p); continue; }
        if (SUBSTANCE_INTENTION.test(q) && !recent) { poser('evoque_passe', 'jaune', mot, p); continue; }
        if (passe && !recent) poser('evoque_passe', 'jaune', mot, p);
        else poser('surdose', 'rouge', mot, p);
        continue;
      }
      let exces = null;
      if (ALCOOL_EXCES.test(q)) exces = ALCOOL_EXCES.exec(q)[0];
      else if (DROGUE.test(q) && PRISE.test(q)) exces = DROGUE.exec(q)[0];
      else if (PRISE_SEULE.test(q)) exces = PRISE_SEULE.exec(q)[0];
      else if ((CANNABIS.test(q) || MEDOC.test(q)) && EXCES.test(q)) exces = (CANNABIS.exec(q) ?? MEDOC.exec(q))[0];
      if (!exces) continue;
      if (SUBSTANCE_INTENTION.test(q) && !/\b(?:j ai|je me suis|je suis)\b/.test(q)) continue;   // l'envie n'est pas la prise
      if (passe && !recent) continue;                                                            // un récit ancien ne marque pas le jour
      poser('substance', 'jaune', exces, p);
    }

    const npSansHyperbole = np.replace(HYPERBOLE, ' ');
    const s = dedans(npSansHyperbole, SUICIDE) ?? (SUICIDE_SIGLES.test(np) ? 'ts' : null);
    if (s) poser('suicide', 'jaune', s, p);

    /* L'objet ET la proximité, dans la même phrase : c'est la paire qui
       distingue un objet mentionné d'un objet tenu. */
    const objet = dedans(np, MOYEN);
    if (objet && dedans(np, A_PORTEE)) poser('moyen', 'jaune', objet, p);

    const d = dedans(np, DEREALISATION);
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
  const contexteDuJour = msgs.map(m => m.text).join(' ');

  const tous = [];
  let passages = 0;
  for (const m of msgs) {
    const r = niveauDuTexte(m.text, { contexteDuJour, aujourdhui: date });
    if (!r.niveau) continue;
    passages++;
    for (const mo of r.motifs) if (!tous.some(x => x.genre === mo.genre)) tous.push(mo);
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
  moyen:    'quelque chose pour se faire mal était à portée',
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
