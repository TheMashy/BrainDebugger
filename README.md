# BrainDebugger

Un journal quotidien qui te rend tes propres mots au moment où tu en as besoin.

Tu parles le soir. L'outil retrouve les fois où tu as écrit quelque chose de proche,
et te montre ce qui s'est réellement passé les jours suivants.

En local : tout tourne sur ta machine, aucun compte, aucun serveur, aucune synchro.
Hébergé : un login Discord, et un journal isolé par compte.

---

## Démarrer

```bash
npm start   # → http://127.0.0.1:4173
npm test    # 25 tests sur le calcul, sans dépendance
```

SQLite est intégré à Node 22 (`node:sqlite`), le serveur est en `node:http`, le front est
du JS natif. Les modes `scripted` et `ollama` n'ont **aucune dépendance**.

Le mode Claude a besoin d'un paquet :

```bash
npm install @anthropic-ai/sdk
export ANTHROPIC_API_KEY=sk-ant-...   # ou colle la clé dans Réglages
```

Prérequis : **Node ≥ 22.5**.

## Importer un historique

```bash
node server/import-csv.js mon-export.csv        # écrit en base
node server/import-csv.js mon-export.csv --dry  # vérifie sans écrire
```

Format attendu : l'export d'une grille annuelle mois × jours (Google Sheets, Excel).
L'importeur reconnaît les blocs par année, les lignes de mois (`Jan`…`Dec`), et
récupère au passage les **ancres d'étalonnage** (`8 Good` + description) si elles
sont présentes dans la feuille.

## Déployer (Railway, Fly, un VPS)

Par défaut le serveur écoute sur `127.0.0.1` : rien ne sort de la machine. Pour l'héberger,
il faut ouvrir cette écoute — et à partir de là, **c'est un verrou qui protège ton journal,
plus l'isolement réseau**. Le serveur refuse de démarrer si `HOST` n'est pas une adresse
locale et qu'aucun verrou n'est configuré. Échouer au lancement est le seul comportement
acceptable : un avertissement dans un README ne protège personne.

Deux verrous possibles, exclusifs dans les faits :

| | **Mot de passe** | **Discord** |
|---|---|---|
| Pour | toi seul | plusieurs personnes |
| Variables | `BD_PASSWORD` | `BD_DISCORD_CLIENT_ID` + `BD_DISCORD_CLIENT_SECRET` |
| Journaux | un | un par compte, isolés |

Variables :

| Variable | Rôle |
|---|---|
| `BD_PASSWORD` | verrou mono-utilisateur |
| `BD_DISCORD_CLIENT_ID` / `BD_DISCORD_CLIENT_SECRET` | verrou multi-comptes (voir plus bas) |
| `BD_DISCORD_GUILD` | facultatif : n'accepte que les membres de ce serveur Discord |
| `BD_PUBLIC_URL` | facultatif : force l'URL publique si le proxy ment sur l'hôte |
| `BD_DB=/data/braindebugger.db` | requis, dans un volume — sinon tout est perdu au redéploiement |
| `ANTHROPIC_API_KEY` | si le backend Claude est utilisé |
| `BD_TOKEN_ALLOWANCE` | facultatif : jetons/mois affichés dans la jauge (défaut 500 000) |
| `BD_SECRET` | facultatif ; sans lui la clé de session dérive du mot de passe ou du secret Discord |
| `HOST` / `PORT` | fournis par l'hébergeur, ne pas les définir |

`HOST` et `PORT` n'ont normalement pas à être définis : l'app détecte Railway, Fly, Render,
Heroku et Cloud Run, et ouvre l'écoute sur `0.0.0.0` d'elle-même. Sur un poste de travail
elle reste sur `127.0.0.1`.

Sur Railway, trois choses à faire :

1. **Monter un volume sur `/data` avant le premier déploiement**, et pointer `BD_DB` dessus —
   sinon la base repart à zéro à chaque build.
2. Définir un verrou. Sans lui le conteneur s'arrête au démarrage, et les logs disent
   lequel manque (avec un mot de passe généré, prêt à coller).
3. **Settings › Networking › Generate Domain**, sinon le service reste « Unexposed ».

`railway.toml` fixe le reste. Si le build choisit une version de Node antérieure à 22.5,
`node:sqlite` n'existe pas et le conteneur s'arrête : `.nvmrc` fixe la version, et
`NIXPACKS_NODE_VERSION=22` la force au besoin.

La bannière de démarrage affiche la configuration réellement appliquée — écoute,
plateforme détectée, version de Node, chemin de la base, verrou en place. Sur un hébergeur
c'est la seule fenêtre qu'on ait dessus ; c'est le premier endroit à regarder quand un
déploiement échoue.

### Le login Discord

Tout le monde a déjà un compte Discord. C'est la raison entière du choix : pas
d'inscription, pas de mot de passe à retenir, pas de mail à vérifier, pas de « mot de
passe oublié » à écrire.

Dans le [Discord Developer Portal](https://discord.com/developers/applications) : une
application, onglet **OAuth2**, puis
`Redirects` → `https://TON-DOMAINE/auth/discord/callback` — exactement, à la barre finale
près. Reporte `Client ID` et `Client Secret` dans les variables.

Le scope demandé est `identify` seul : l'identifiant, le pseudo, l'avatar. Pas les mails,
pas les messages, pas les serveurs — sauf si `BD_DISCORD_GUILD` est défini, auquel cas
`guilds` s'ajoute pour vérifier l'appartenance, et rien de plus.

Ce que ça change dans la base : chaque table est indexée par `(user_id, …)`, chaque requête
est filtrée sur le compte de la session. Une base existante en mono-utilisateur est migrée
au démarrage, et le premier compte Discord qui se connecte **récupère** ce journal — c'est
le tien, tu es la seule personne à avoir pu l'écrire. Les suivants repartent d'une base vide.

### La jauge de jetons

L'API Claude est payée par BrainDebugger. Personne ne branche de clé, personne ne paie.

La pastille en haut de l'écran passe du vert au rouge selon ce qui reste dans l'enveloppe
du mois ; en cliquant dessus on voit les jetons consommés, l'estimation en dollars et la
date de remise à zéro. C'est une jauge, pas une facture.

**Elle ne coupe pas.** Enveloppe épuisée, le compagnon retombe sur les relances scriptées
et le dit — mais la conversation continue et la journée s'enregistre. Interrompre
quelqu'un en pleine phrase un mauvais soir serait exactement le contraire de ce produit.

**Elle se retire.** L'enveloppe existe parce que, d'habitude, c'est la clé de l'hébergeur
qui règle. Sur son propre journal, avec sa propre clé, elle ne protège de rien — une case
dans Réglages (« Retirer l'enveloppe de jetons ») supprime le plafond et le repli. Le
comptage, lui, continue : c'est tout ce qui reste pour savoir ce que ça coûte, et la jauge
montre alors la consommation au lieu d'une barre qui n'a plus rien à mesurer. Côté code,
zéro veut dire « aucune enveloppe », jamais « enveloppe épuisée » — sans cette distinction
explicite, lever le plafond reviendrait à l'atteindre instantanément.

**Ce que l'hébergement change vraiment.** En local, personne d'autre que toi ne peut lire
la base. Hébergé, elle vit sur le disque de quelqu'un d'autre, et l'hébergeur y a un accès
technique. Le verrou arrête les inconnus, pas l'infrastructure. Si tu héberges pour
toi seul, c'est un compromis de confort raisonnable. Dès que d'autres personnes y
écrivent, ça devient de l'hébergement de données de santé pour autrui — et en France, la
certification HDS entre dans le cadre (§9).

---

## Les deux couches

C'est la règle de conception centrale du produit. La confondre le transforme en
énième appli d'humeur.

| | **Le compagnon** | **Le miroir** |
|---|---|---|
| Rôle | te faire parler | te rendre tes mots |
| Parle ? | oui | seulement dans la lecture, voir plus bas |
| Voit tes stats ? | non | oui |
| Note tes journées ? | **jamais** | **jamais** |

Le compagnon est la couche de **saisie** : parler coûte moins cher qu'écrire, et
c'est la seule raison pour laquelle un journal quotidien tient quatre ans. Il pose
des questions courtes, il ne commente pas, il ne qualifie pas, il ne console pas à vide.

Le miroir est la couche de **restitution** : il affiche des dates, des chiffres et des
phrases déjà écrites. Le pouvoir vient de reconnaître sa propre écriture, pas d'un résumé.

**Une exception, et elle est nommée : la lecture.** « Ma carte » s'ouvre sur ce que le
compagnon comprend du fonctionnement — une carte, trois à six thèmes, sur trois fenêtres. C'est du
texte généré, et c'est assumé : ce qu'on cherche là est ce qu'un compteur ne peut pas
voir. Un mécanisme comme « les remontées ne tiennent pas trois jours » n'a aucun mot en
commun d'une occurrence à l'autre, et aucune statistique de co-occurrence ne le trouvera
jamais.

Ce qui tient la règle malgré ça : **chaque thème porte les journées exactes sur
lesquelles il repose**, et une date qui n'est pas dans le corpus est retirée par le
serveur, en silence. Un thème qui n'en garde aucune disparaît. La lecture reste donc
vérifiable et contredisable — c'est ce qui la sépare d'une étiquette. Elle décrit des
motifs, jamais une personne, et ne pose aucun nom clinique : ce n'est pas un diagnostic
et le mot n'apparaît nulle part dans l'interface.

**Les chiffres viennent du serveur, jamais du modèle.** Un thème peut porter un petit fait
comparé à la normale — les dimanches contre les autres jours, le lendemain d'une journée
basse, les deux semaines qui suivent un repère. Le serveur calcule *toutes* les
comparaisons possibles, les étiquette (`c1`, `c2`…), et le modèle ne rend qu'une étiquette :
la phrase affichée est celle d'ici. Un modèle à qui on demande « donne un chiffre » en
invente un, et il le formule si bien qu'on ne peut pas le distinguer d'un vrai ; sur une
application qui rend à quelqu'un sa propre vie, un chiffre faux se retient, se répète, et
oriente ce qu'il croit savoir de lui. Il n'y a donc aucun chemin par lequel un nombre
inventé arrive à l'écran (`server/comparer.js`).

Deux garde-fous : huit journées de chaque côté (en dessous, la moyenne d'un côté bouge d'un
demi-point quand une seule journée change) et quatre dixièmes d'écart (en dessous, l'écart
tient dans l'arrondi de la note). Et ces lignes disent « les dimanches sont plus bas que
les autres jours », un fait sur des jours ; jamais « tu vas moins bien le dimanche », un
fait sur quelqu'un.

**Il relève, il ne note pas.** Quand le ton bascule nettement dans une conversation — une
soirée correcte qui glisse d'un coup sur quelque chose de très noir, ou l'inverse — le
compagnon peut poser un *relevé* : où la personne semble être à cet instant, de 0 à 10.

Ce n'est pas une note de journée, et la différence n'est pas une nuance de vocabulaire. Une
table à part, attachée à un **message** et jamais à une journée ; aucune requête de `entries`
ne la lit, aucune moyenne ne l'inclut, aucune référence ne bouge avec elle. Il n'existe aucun
chemin, dans le schéma, pour remonter un relevé dans une journée — pas de clé étrangère, pas
de champ « appliquer ». L'absence de chemin rend la faute impossible, pas seulement
déconseillée, et c'est ce que le test verrouille.

Ce qui s'affiche est l'**écart**, jamais la moyenne : « de 2 à 8 dans la même soirée » ne
prononce aucun verdict sur la soirée, c'est un fait sur son amplitude. Une moyenne de relevés
ressemblerait à une note, se lirait comme une note, et finirait comparée à la vraie — alors
qu'elles ne mesurent pas la même chose et n'ont pas été posées par le même juge. Contouré,
jamais rempli : ces bornes sont déclarées par le compagnon, la note est mesurée par la
personne, et les deux ne peuvent pas se confondre à l'œil.

La série des notes dit la différence entre lundi et mardi ; elle ne peut rien dire d'une
soirée passée de 8 à 2 en trois heures, qui sort à 5 comme une journée tiède. Ces écarts sont
la seule trace qu'on en garde, et ils entrent dans le corpus de la lecture de fond.

Le compagnon n'en parle jamais : pas de « je dirais que tu es à 3 là ». Lui renvoyer un
chiffre sur son état est exactement ce que ce produit ne fait pas.

**On peut renoter une journée, et rattraper celles qu'on a sautées.** La note ne se posait
que sur aujourd'hui : une note mise trop vite le restait pour toujours, et une semaine
sautée gardait ses trous — ce n'est pas une lacune d'interface, c'est la seule perte de
données que ce produit ne savait pas réparer, puisque la référence glissante compte alors
avec un mois de moins.

Changer une note se fait dans la journée ouverte, en cliquant le grand chiffre : on y est
déjà, on relit ce qu'on avait écrit, et c'est le seul endroit où l'on a de quoi juger.
Rattraper se fait dans la carte de note de « Parler », qui liste les sept derniers jours
non notés — sept, pas trente : au-delà on ne se souvient plus de sa journée, et une note
posée de mémoire lointaine entre dans la même série que les autres sans avoir été calibrée
comme elles. Ils n'apparaissent que s'il y en a : une rangée permanente de cases vides
serait un reproche quotidien.

**La note reste toujours saisie à la main.** Un modèle qui scorerait les journées
casserait la comparabilité avec tout l'historique : la valeur d'une série de plusieurs
années tient au fait que c'est le même cerveau qui a calibré à chaque fois.

---

## Les trois mécanismes

1. **La preuve de résolution** — pour la note du jour, retrouver tous les épisodes
   passés au moins aussi bas, et afficher combien de temps il a fallu pour remonter
   au-dessus de la référence. Avec le nombre d'épisodes **jamais remontés**, sans quoi
   on ne montrerait que les fois où ça s'est arrangé.
2. **La similitude** — recherche BM25 sur le corpus personnel, puis la bande des
   14 jours qui ont suivi chaque jour semblable, telle qu'elle a été.
   Repli sur les journées de même note tant que le corpus texte est trop mince.
3. **La contradiction** — l'entrée d'hier, brute, sans commentaire.

## Le plancher

Sous un seuil (2/10 par défaut), **aucune statistique n'est calculée ni renvoyée**.
Uniquement les entrées passées, brutes. Un chiffre rassurant à ce moment-là est vécu
comme une invalidation.

La règle est appliquée dans `server/api.js`, pas dans l'interface : une règle qui ne
vit que dans le front finit toujours par être contournée.

---

## Le calcul

**Référence glissante** — médiane des notes des 365 jours précédant le jour courant
(jour exclu). Repli sur la médiane globale sous 20 points.

**Contraste** — `signe(x) · x² / 2,5`, borné à ±10. Écrase les journées proches du
centre, fait ressortir les extrêmes. La courbe vient du tableur d'origine ; ce qui
change, c'est **x** :

| Centre | `x` | Dérive mesurée sur 1698 jours réels |
|---|---|---|
| fixe à 5 | `note − 5` | **+0,833 / jour** |
| médiane globale | `note − 6` | −0,279 / jour |
| référence glissante | `note − référence(j)` | **−0,017 / jour** |

Un centre fixe à 5 quand la moyenne réelle est à 6,1 fait monter le cumul d'environ
un point par jour sans que rien ne s'améliore : la pente ne veut plus rien dire.
Et un centre fixe *correct* ne suffit pas non plus — le carré signé amplifie la queue
basse plus que la queue haute, il reste une dérive résiduelle. Seule la référence
glissante donne une pente lisible.

**Épisodes** — trois règles, chacune corrigeant une manière de mentir avec le chiffre :

1. **Non chevauchants.** Un jour déjà compris dans un épisode en cours n'en ouvre pas
   un nouveau, sinon le nombre d'épisodes gonfle et la médiane s'effondre.
2. **Le retour doit tenir `sustain` jours** (2 par défaut). Avec la majorité des
   journées au-dessus de la référence, un rebond d'un seul jour est quasi garanti par
   le taux de base et ne dit rien. Passer de 1 à 2 jours fait tomber la part « sous
   4 jours » de 81 % à 58 % : moins flatteur, vrai.
3. **L'horizon classe, il ne découpe pas.** Une période basse continue de 40 jours est
   *un* épisode non résolu, pas deux. Et un épisode ouvert trop près de la fin des
   données est **censuré**, pas « jamais remonté » : on n'a pas encore le recul pour
   trancher. L'épisode en cours est toujours dans ce cas — c'est précisément celui
   qu'on regarde un mauvais soir. Le compter comme non résolu serait faux et alarmiste.

---

## Architecture

```
server/
  preflight.js   garde Node ≥ 22.5, détection de plateforme
  index.js       serveur http, 127.0.0.1 en local, verrou obligatoire hébergé
  api.js         routes + application du plancher, tout filtré par compte
  db.js          schéma SQLite, réglages, ancres — clés (user_id, …)
  migrate.js     mono-utilisateur → multi-comptes, et reprise du journal d'origine
  auth.js        session signée HMAC, mot de passe
  discord.js     OAuth2 Discord (scope identify), état CSRF signé
  usage.js       comptage des jetons, enveloppe mensuelle, niveau de la jauge
  stats.js       référence, delta, contraste, cumul, épisodes
  search.js      BM25 (k1=1.5, b=0.75), stopwords FR/EN, NFD
  chat.js        3 backends : scripted (hors-ligne) | anthropic | ollama, et les outils
  lecture.js     la lecture : corpus, consigne, validation des dates et de la carte
  import-csv.js  import de la grille annuelle
web/
  app.js         4 vues : Parler, Année, Ma carte, Réglages
  relations.js   la carte organique : genres, verbes des liens, cadrage
  calendrier.js  un calendrier, une fois : jour/mois/année, plage, partagé
  chaton.js      le compagnon au trait, 21 expressions composables
  frise.js       la frise de vie : voies, domaines, dégradés (partagée serveur)
  reperes.js     thèmes et icônes des repères (partagée serveur)
  charts.js      échelle de couleur divergente, courbes SVG
  pets.js        compagnons intégrés (+ PNG personnalisé)
  pet.js         conversion en PNG, animation du sprite pendant la frappe
  blips.js       6 timbres synthétisés en Web Audio
data/
  braindebugger.db
```

En local le serveur écoute sur `127.0.0.1` et pas `0.0.0.0` : un journal intime ne doit
pas être joignable depuis le réseau local. Hébergé, il ouvre l'écoute lui-même — et exige
alors un verrou pour démarrer.

### Le modèle

Par défaut : **aucun**. Les relances sont scriptées, rien ne quitte la machine.

| Backend | Sort de la machine | Installation |
|---|---|---|
| `scripted` *(défaut)* | rien | aucune |
| `anthropic` | le texte du chat | `npm install @anthropic-ai/sdk` + une clé |
| `ollama` | rien | Ollama + un modèle |

**Ce que le mode Claude envoie, exactement.** Deux flux, et ils ne transportent pas la
même chose.

*La conversation* envoie la conversation du jour, le *texte* des N dernières journées
écrites (réglable, 14 par défaut, 0 pour rien), la grille des notes mois par mois, les
repères, les motifs suivis, les objectifs, et les notes rangées (décochable). Ce qui sort,
c'est ce qu'on vient d'écrire plus de quoi ne pas repartir de zéro chaque soir.

*La lecture de « Ma carte »* envoie **beaucoup plus** : jusqu'à 45 000 signes de journées
écrites, choisies parmi les plus fournies de la fenêtre, plus le résumé mensuel des notes
avec leur écart-type, les repères, les notes rangées. Un appel par fenêtre, relancé
seulement quand assez de journées se sont accumulées depuis le précédent. C'est l'endroit
de l'application où le plus de choses quittent la machine, et c'est pourquoi il ne se
déclenche jamais sans clé et se voit à l'écran pendant qu'il tourne.

Sans clé, il ne se passe rien de tout ça : les relances sont scriptées et la lecture
affiche qu'elle a besoin d'une clé. Le reste — la journée, le calendrier, les similitudes,
les épisodes — est du calcul local et ne fait aucun appel réseau.

Requête : `claude-opus-5`, réflexion adaptative, effort réglable (bas par défaut — la
latence compte plus que la profondeur quand quelqu'un attend une réponse le soir), et le
repli serveur `fallbacks: "default"` armé. Ce dernier point n'est pas cosmétique : sur ce
produit, un refus de modèle tomberait exactement au pire moment.

**La réponse est streamée.** Sans streaming, il y a plusieurs secondes de silence avant
que le compagnon écrive quoi que ce soit, et l'illusion de quelqu'un en face tombe. Les
fragments sont mis en file et drainés à cadence constante côté navigateur, pour que la
frappe reste régulière quelle que soit la vitesse du modèle, et chaque lettre arrive en
fondu.

**Il a une montre.** Chaque message du fil lui arrive précédé de son jour et de son heure.
L'historique partait sans une seule date : il ne pouvait donc pas savoir qu'on lui écrivait
à trois heures du matin, ni que sept heures s'étaient écoulées depuis la dernière phrase —
alors que c'est ce qu'on remarque en premier chez quelqu'un qu'on connaît. Le marqueur est
posé par l'application et la consigne lui interdit de le recopier ; elle lui demande aussi
de *supposer* plutôt que d'affirmer, parce qu'entre deux messages on ne sait pas s'il
dormait. Dans le fil, un silence de plus de trois heures se marque d'un filet.

**Sa réflexion aussi.** Les blocs de réflexion étendue sont diffusés jusqu'au fil : la
bulle s'ouvre sur trois points qui respirent, puis la pensée défile derrière une lueur qui
pulse, repliée à une ligne. Elle est gardée en base — une réflexion qui disparaît au
rechargement ne peut pas être relue, et c'est justement quand une réponse tombe à côté
qu'on veut savoir ce qu'il avait compris.

Repliée par défaut, et ce n'est pas de la timidité d'interface : une réflexion est un
brouillon, elle hésite, elle se reprend, elle formule parfois de travers ce que la réponse
dira correctement. Dépliée d'office, elle se lirait comme un deuxième avis — souvent plus
cru que le premier. Elle n'entre jamais dans le texte d'une journée : ce que la machine
s'est dit n'est pas ce que la personne a écrit.

**On peut rembobiner.** Un message ramène le fil à lui : ce qui suit disparaît, et sa
phrase revient dans le composeur. C'est le geste qu'on cherche quand le compagnon vient de
retomber hors-ligne, ou quand on se relit une faute trop tard. La suppression est réelle —
le texte d'une journée est la concaténation de ses messages, et un message « caché » qui
resterait en base resterait dans la carte, dans les échos et dans toutes les statistiques.
Le texte des journées touchées est recalculé dans la foulée.

Si un backend distant tombe — ou si le modèle décline — le serveur retombe sur les
relances scriptées **et le signale**, et l'interface remonte le numéro d'aide. Une panne
silencieuse serait un mensonge sur l'endroit où partent les données ; un silence après un
refus serait pire.

---

## Les vues

- **Parler** — le fil continu, le compagnon, la note du jour avec les ancres sous les yeux.
- **Année** — la grille mois × jours, l'écart quotidien, le cumul, les repères de vie et
  les notes rangées (repliées en pastilles : une note collée fait souvent trois mille
  signes, et dix d'entre elles déroulées remplissent quinze écrans). **Une seule fenêtre** commande les trois graphiques : il y en avait
  trois, à trois endroits, avec trois vocabulaires, et rien n'empêchait de lire un
  quotidien de 2026 au-dessus d'un cumul sur quatre ans en croyant lire la même période.
  Le cumul démarre en référence glissante — l'étalon fixe compare quatre ans de journées à
  une même constante, ce qui fait lire 2026 à l'aune de 2022.
- **Ma carte** — la lecture : la carte organique de ce qui revient, la synthèse, et les
  thèmes avec leur évolution, à trois distances. Une journée s'ouvre derrière une preuve,
  un repère ou le calendrier : la note en grand, ce qui a été écrit, le repère de ce
  jour-là s'il y en a un. Rien d'autre — le rapprochement avec les journées qui se
  ressemblent existe toujours, mais c'est le compagnon qui le dit, dans Parler, quand il
  juge que ça sert. Une colonne qui l'affiche à chaque ouverture n'est pas la même chose
  que quelqu'un qui te le rappelle.
- **Réglages** — compagnon, timbre des bips, backend, plancher, tenue du retour,
  import/export. Rien d'autre : « ce qui revient » et les notes rangées y vivaient parce
  qu'on pouvait les retirer, et « ce qu'on peut retirer » avait fini par vouloir dire
  « réglage ». C'était un classement par le geste plutôt que par le sens.

### La carte

Il y avait deux vues : l'une comprenait quelque chose, l'autre comptait des mots. Il fallait
choisir un onglet sans savoir lequel répondait. Il n'en reste qu'un.

La carte des **mots** comptait des co-occurrences : un trait quand deux mots tombent la même
journée. Elle savait dire que « fatigue » et « boulot » vont ensemble, et rien de plus — un
trait sans verbe ne dit pas ce qui se passe entre deux choses.

La carte **organique** est écrite par le compagnon à partir de tout ce qu'il a : les
journées, les repères, les notes rangées, les motifs, les objectifs. Ses nœuds sont des
choses — quelqu'un, un lieu, un moment, une sensation, un mécanisme — et **chaque trait
porte un verbe** : « précède », « fait retomber », « le seul moment où ça tient ». C'est le
verbe qui fait la carte ; un lien qui dirait seulement « lié à » est jeté côté serveur.

Elle se refait quand assez de choses ont bougé — des journées écrites, **ou des notes
apportées**. Coller trois ans de carnet est l'événement qui change le plus une carte, et
c'était exactement celui qui ne comptait pas : une note n'est pas une journée, donc elle
ne faisait pas vieillir la lecture.

**Chaque nœud porte ses journées.** Un nœud sans ses dates est une affirmation (« le
sommeil compte chez toi ») ; avec ses dates, c'est un compte rendu (« le sommeil, ces 34
journées-là »). Elles se dessinent en couronne autour du nœud, un point par journée,
chacun à la couleur de son écart — on voit qu'une chose pèse non pas parce qu'un cercle est
gros, mais parce qu'il y a quarante jours autour. Comme pour les preuves des thèmes, une
date absente du corpus est retirée en silence.

**On se promène dedans.** Clic-glissé pour se déplacer, molette ou pincement pour zoomer,
un point pour revenir au centre. Sur seize nœuds regroupés par genre, l'amas le plus dense
est justement celui qu'on veut regarder de près — et c'est celui où tout se chevauche.
La géométrie zoome, pas le texte : un libellé garde sa taille à l'écran, et zoomer revient
donc à écarter les nœuds. Chaque point de journée est cliquable et ouvre sa journée : une
carte qui dit « ces trente-quatre fois » sans jamais dire lesquelles s'arrête à mi-chemin.

**La carte est à côté de ce qu'elle dit.** La synthèse et les mécanismes occupent la
colonne de droite — la seule question qu'on se pose devant un nœud est « qu'est-ce qu'il en
dit ? », et il fallait faire défiler pour le savoir.

**Une seule liste de mécanismes.** Il y en avait deux, l'une au-dessus de l'autre : les
*motifs* (ce que le compagnon reconnaît en conversation, tout de suite, avec un compte) en
cartes colorées, et les *thèmes* (ce qu'il tire d'une relecture de tout le corpus, avec
des preuves datées et une évolution) en lignes grises dessous. Deux formes, deux couleurs,
deux endroits, pour deux façons de répondre à la même question.

Une seule forme maintenant. Ce qui les distingue reste visible, mais dans le contenu :
un motif s'ouvre sur sa couleur et son compte, un thème sur ses extraits datés et son
chiffre. Les deux portent les mêmes petites barres de récurrence — pour un motif elles
sont calculées depuis les messages où il a été reconnu, ramenées à son propre mois le plus
fourni : comparer les motifs entre eux ferait dépendre la forme de l'un du bavardage de
l'autre.

Toutes les teintes viennent de la bande déclarée (232–336), disjointe de la rampe des
notes : un mécanisme est ce que le compagnon comprend, pas ce que les journées mesurent,
et il ne peut pas emprunter le vert d'une bonne journée même par accident. Celle d'un
motif se choisit — posée dans l'ordre de création, elle était sûrement distincte mais sans
aucun rapport avec le sens.

Les nœuds sont des **anneaux**, jamais des disques ; les points, eux, sont **pleins**.
« Ce qui est rempli est mesuré, ce qui est contouré est déclaré » : le nœud est une lecture
du compagnon, chaque point est une journée réelle avec son écart. Des points mesurés dans
un anneau déclaré — l'œil lit la différence sans qu'on la lui explique. Une journée jamais
notée reste un point creux : elle existe, elle ne dit rien.

Les écarts ne sont pas stockés avec la lecture : ils se calculent contre une référence
glissante, et figés dans le JSON ils vaudraient ce qu'ils valaient le jour de la lecture.
Le serveur les décore au moment de lire.

Le calcul des mots n'est pas supprimé — `server/graph.js` et ses routes vivent toujours,
testés, avec l'invariant du carnet qu'ils portent. Ce qui a disparu est l'onglet.

Il n'y a pas de vue « Recherche ». Ouvrir un champ de recherche demande de savoir quoi
chercher ; le passé remonte tout seul.

**Mais plus sous le composeur.** Un panneau y cherchait dans le corpus pendant la frappe et
posait les journées ressemblantes juste en dessous, sous le titre « tu as déjà écrit ça ».
La recherche était juste, et l'endroit était faux : on raconte sa soirée à quelqu'un, et
l'application répond par-dessous avec les dates. La remarque est vraie, et personne ne l'a
demandée.

La même recherche, au même seuil, part maintenant vers le **compagnon**. C'est lui qui
décide s'il la rend — quand quelqu'un dit que ça n'arrive jamais, quand il croit que c'est
la première fois, quand il cherche ce qui avait marché la dernière fois. Le reste du temps,
l'avoir en tête lui suffit pour ne pas faire raconter deux fois la même chose comme s'il la
découvrait. La journée, elle, garde son « tu as déjà écrit ça » : on y va pour ça.

La conversation est **continue** : on rouvre le fil là où on l'a laissé, avec les jours
précédents visibles au-dessus, séparés par leur date. C'est un confident qu'on va voir
quand on en a besoin, pas un questionnaire du soir — le compagnon ne relance pas, ne
reproche pas une absence, et n'ouvre pas la conversation à ta place.

## Tests

`npm test` — 25 tests sur `server/stats.js`, sans dépendance (`node:test`). C'est la
partie où la justesse compte : un bug dans les épisodes est un mensonge à quelqu'un
qui va mal. Les tests couvrent la référence glissante et son repli, la reproduction
exacte de la formule de contraste, la segmentation des épisodes, la tenue du retour,
la censure à droite, les années bissextiles.

## Ce qui n'est pas fait

- Embeddings locaux (`transformers.js`) — à faire quand le corpus texte dépassera
  quelques centaines d'entrées. `search.js` est isolé pour être remplacé sans toucher au reste.
- Bot Discord (capture `#psy` + `/note`).
- Notification du soir : ouverte au §10 du spec, non tranchée.

## Ce que ce n'est pas

Pas un outil de diagnostic. Décrire, jamais qualifier. Pas un coach : aucun message
d'encouragement généré. Pas un tracker de bien-être.
