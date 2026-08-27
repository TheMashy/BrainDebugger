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

**Une exception, et elle est nommée : la lecture.** Le Miroir s'ouvre sur ce que le
compagnon comprend du fonctionnement — trois à six thèmes, sur trois fenêtres. C'est du
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
  lecture.js     la lecture du Miroir : corpus, consigne, validation des dates
  import-csv.js  import de la grille annuelle
web/
  app.js         5 vues : Parler, Année, Miroir, Je remarque, Réglages
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

*La lecture du Miroir* envoie **beaucoup plus** : jusqu'à 45 000 signes de journées
écrites, choisies parmi les plus fournies de la fenêtre, plus le résumé mensuel des notes
avec leur écart-type, les repères, les notes rangées. Un appel par fenêtre, relancé
seulement quand assez de journées se sont accumulées depuis le précédent. C'est l'endroit
de l'application où le plus de choses quittent la machine, et c'est pourquoi il ne se
déclenche jamais sans clé et se voit à l'écran pendant qu'il tourne.

Sans clé, il ne se passe rien de tout ça : les relances sont scriptées et la lecture
affiche qu'elle a besoin d'une clé. Le reste du Miroir — la journée, le calendrier, les
similitudes, les épisodes — est du calcul local et ne fait aucun appel réseau.

Requête : `claude-opus-5`, réflexion adaptative, effort réglable (bas par défaut — la
latence compte plus que la profondeur quand quelqu'un attend une réponse le soir), et le
repli serveur `fallbacks: "default"` armé. Ce dernier point n'est pas cosmétique : sur ce
produit, un refus de modèle tomberait exactement au pire moment.

**La réponse est streamée.** Sans streaming, il y a plusieurs secondes de silence avant
que le compagnon écrive quoi que ce soit, et l'illusion de quelqu'un en face tombe. Les
fragments sont mis en file et drainés à cadence constante côté navigateur, pour que la
frappe reste régulière quelle que soit la vitesse du modèle.

Si un backend distant tombe — ou si le modèle décline — le serveur retombe sur les
relances scriptées **et le signale**, et l'interface remonte le numéro d'aide. Une panne
silencieuse serait un mensonge sur l'endroit où partent les données ; un silence après un
refus serait pire.

---

## Les vues

- **Parler** — le fil continu, le compagnon, la note du jour avec les ancres sous les yeux.
- **Année** — la grille mois × jours, le cumul commutable entre les trois centres, et les
  repères de vie (saisie et affichage en pointillés sur la courbe).
- **Miroir** — la lecture : ce que le compagnon comprend du fonctionnement, à trois
  distances, avec la carte des thèmes. Une journée s'ouvre derrière une preuve, un repère
  ou le calendrier, et garde les trois mécanismes.
- **Je remarque** — la carte des mots : ce que compte l'application elle-même, sans modèle.
- **Réglages** — compagnon, timbre des bips, backend, plancher, tenue du retour, import/export.

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
découvrait. Le Miroir, lui, garde son « tu as déjà écrit ça » : on y va pour ça.

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
