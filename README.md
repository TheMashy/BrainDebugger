# BrainDebugger

Un journal quotidien qui te rend tes propres mots au moment où tu en as besoin.

Tu parles le soir. L'outil retrouve les fois où tu as écrit quelque chose de proche,
et te montre ce qui s'est réellement passé les jours suivants.

Tout tourne sur ta machine. Aucun compte, aucun serveur, aucune synchro.

---

## Démarrer

```bash
npm start
# → http://127.0.0.1:4173
```

Aucune dépendance à installer. SQLite est intégré à Node 22 (`node:sqlite`), le
serveur est en `node:http`, le front est du JS natif. `npm install` ne télécharge rien.

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

---

## Les deux couches

C'est la règle de conception centrale du produit. La confondre le transforme en
énième appli d'humeur.

| | **Le compagnon** | **Le miroir** |
|---|---|---|
| Rôle | te faire parler | te rendre tes mots |
| Parle ? | oui | **jamais** |
| Voit tes stats ? | non | oui |
| Note tes journées ? | **jamais** | non |

Le compagnon est la couche de **saisie** : parler coûte moins cher qu'écrire, et
c'est la seule raison pour laquelle un journal quotidien tient quatre ans. Il pose
des questions courtes, il ne commente pas, il ne qualifie pas, il ne console pas à vide.

Le miroir est la couche de **restitution** : il n'affiche que des dates, des chiffres
et des phrases déjà écrites. Il ne génère rien. Le pouvoir vient de reconnaître sa
propre écriture, pas d'un résumé.

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

**Épisodes** — non chevauchants : un jour déjà compris dans un épisode en cours n'en
ouvre pas un nouveau. Le retour à la référence doit **tenir `sustain` jours** (2 par
défaut) : avec 62 % des journées au-dessus de la référence, un rebond d'un seul jour
est quasi garanti par le taux de base et ne dit rien.

---

## Architecture

```
server/
  index.js       serveur http, 127.0.0.1 uniquement
  api.js         routes + application du plancher
  db.js          schéma SQLite, réglages, ancres
  stats.js       référence, delta, contraste, cumul, épisodes
  search.js      BM25 (k1=1.5, b=0.75), stopwords FR/EN, NFD
  chat.js        3 backends : scripted (hors-ligne) | ollama | API compatible OpenAI
  import-csv.js  import de la grille annuelle
web/
  app.js         4 vues : Ce soir, Année, Miroir, Réglages
  charts.js      échelle de couleur divergente, courbes SVG
  pets.js        compagnons intégrés (+ PNG personnalisé)
data/
  braindebugger.db
```

Le serveur écoute sur `127.0.0.1` et pas `0.0.0.0` : un journal intime ne doit pas
être joignable depuis le réseau local.

### Le modèle

Par défaut : **aucun**. Les relances sont scriptées, rien ne quitte la machine.

- **Ollama local** — conversation réelle, tout reste sur le disque. Demande une installation.
- **API distante** — le texte des journées part chez un tiers. C'est le seul mode où
  les données sortent. L'interface le dit explicitement.

Si un backend distant tombe, le serveur retombe sur les relances scriptées **et le
signale**. Une panne silencieuse serait un mensonge sur l'endroit où partent les données.

---

## Ce qui n'est pas fait

- Embeddings locaux (`transformers.js`) — à faire quand le corpus texte dépassera
  quelques centaines d'entrées. `search.js` est isolé pour être remplacé sans toucher au reste.
- Bot Discord (capture `#psy` + `/note`).
- Table `events` remplie : le schéma et l'affichage sur la courbe existent, la saisie non.

## Ce que ce n'est pas

Pas un outil de diagnostic. Décrire, jamais qualifier. Pas un coach : aucun message
d'encouragement généré. Pas un tracker de bien-être.
