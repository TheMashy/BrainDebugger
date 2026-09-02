# Le banc de la carte

Deux bancs, qui ne répondent pas à la même question.

**`banc:synth`** — des cartes fabriquées, de formes choisies. Pas de réseau, pas
de modèle, une seconde. Il répond à : *que fait le RENDU sur telle forme ?*

**`banc:carte`** — vingt vraies conversations, lues par le vrai modèle avec le
vrai prompt système. Il répond à : *que produit le PRODUIT sur de vraies vies,
et est-ce que ça tient d'une lecture à l'autre ?*

Le second existe parce que le premier ne peut pas mentir mais ne peut pas non
plus renseigner : un amas fabriqué a la densité qu'on lui a donnée. Il ne dira
jamais combien d'îlots un modèle nomme réellement, ni s'il nomme les mêmes deux
fois de suite.

---

## Le banc fabriqué

```sh
npm run banc:synth
```

Onze formes — 6 nœuds, 64 nœuds, tout relié, presque rien relié, aucune piste,
une seule piste, seize orphelins, deux pistes qui se recoupent. Pour chacune :
recouvrement perdu, ponts, stabilité des grappes sous retrait de liens,
croisement des enveloppes, collisions, temps.

`echantillons.mjs` fabrique, `banc.mjs` mesure.

## Le banc réel

```sh
node tools/banc-carte/apporter.mjs    # les corpus (≈ 7,5 Mo, non versionnés)
node tools/banc-carte/consigne.mjs    # les 20 journaux + le prompt système
ANTHROPIC_API_KEY=… \
  node tools/banc-carte/tisser.mjs    # 20 journaux × 3 lectures → lectures/*.json
npm run banc:carte                    # le rapport
node tools/banc-carte/serveur.mjs &   # puis les images
node tools/banc-carte/tirer.mjs
```

### D'où viennent les vingt

**AnnoMI** — 133 entretiens motivationnels réels, transcrits et annotés par des
experts. Des gens qui parlent de ce qu'ils n'arrivent pas à arrêter : l'alcool,
le tabac, les drogues, le jeu, les médicaments qu'ils ne prennent pas, le sport
qu'ils ne font pas. Médiane 50 tours, 916 mots. C'est le domaine exact de cette
application — l'ambivalence, les déclencheurs, les rechutes — et c'est aussi
celui où une étiquette posée par une machine fait le plus de dégâts.

**Topical-Chat** — 539 échanges ouverts entre deux inconnus qui parlent de
football, de cinéma, d'animaux. Ils servent de **témoins** : une carte tirée
d'une conversation sur le football ne doit pas faire pousser un îlot
« dépendance ». Si elle le fait, c'est le modèle qui projette, et aucune
correction de rendu n'y changera rien.

Quatorze entretiens couvrant quatorze sujets différents, six témoins. Le choix
est déterministe : le même jeu à chaque passage, sinon deux mesures ne se
comparent pas.

**Les licences ne sont pas déclarées.** Ni `uccollab/AnnoMI` ni
`alexa/Topical-Chat` ne portent de fichier de licence, et aucun de leurs README
n'en nomme une (vérifié). Les deux sont diffusés publiquement pour la recherche,
et rien de plus ne peut être affirmé. D'où `apporter.mjs` : on télécharge, on ne
redistribue pas.

### Comment une conversation devient un journal

L'application lit des **journées**. Une conversation est une séance. On la coupe
donc en segments — et la coupe suit la conversation elle-même : on mesure le
recouvrement de vocabulaire entre ce qui précède et ce qui suit chaque
frontière, et on coupe dans les creux, là où le sujet tourne.

Rien n'est réécrit. Chaque tour est recopié tel quel, avec son locuteur :
« moi » pour la personne dont c'est le journal, « l'autre » pour son
interlocuteur. Une phrase inventée ici deviendrait un nœud inventé sur la carte,
et on ne saurait plus ce qu'on mesure.

Les **dates sont un échafaudage**, et il faut le dire : une séance n'a pas eu
lieu sur dix-huit jours. Ce qui est vrai, en revanche, c'est le **retour** d'un
sujet — quand quelqu'un reparle de sa mère au tour 40 après l'avoir mentionnée
au tour 8, deux journées différentes la portent, et le nœud « ma mère » aura
réellement deux journées. C'est cette structure-là qu'on teste, et elle, elle
vient de la conversation.

Le nombre de journées vise seize, et la longueur s'en déduit — bornée sous les
900 signes de `CAR_PAR_JOUR` pour qu'aucune ne soit tronquée, et au-dessus de
150 pour qu'une journée reste une journée. En dessous de douze journées
l'application refuse de lire (`MIN_JOURS`) : un témoin que le produit refuserait
ne témoigne de rien.

### Le tissage envoie la vraie requête

`tisser.mjs` appelle `requeteLecture()` — la requête **exacte** du produit, avec
son outil forcé, son effort, son cache — et range le **brut** de l'appel
d'outil, pas la lecture validée. `lire()` rend le résultat de `valider()`, et
c'est le bon comportement pour le produit ; ici ce serait une mesure perdue,
puisque `validerPistes()` efface justement le recouvrement qu'on veut compter.
Le banc garde le brut et fait passer la validation lui-même, pour comparer les
deux.

Trois lectures par journal, parce qu'une seule ne dit rien de la stabilité. Un
fichier déjà là est sauté : on peut relancer sans tout repayer, et n'ajouter
qu'une quatrième lecture si on en veut une.

Ce n'est pas un test qu'on lance à chaque commit — c'est une mesure qu'on refait
quand on touche au prompt, à la validation, ou à la carte.

### Le prompt système est extrait, pas recopié

`consigne.mjs` va chercher `SYSTEME` dans `server/lecture.js` à l'instant même.
Une copie vieillit en silence, et le banc se mettrait à mesurer un produit qui
n'existe plus. Si l'extraction casse parce que la constante a bougé, le script
s'arrête — mieux vaut un banc qui refuse de tourner qu'un banc qui ment.

Le brut du modèle passe ensuite par `valider()`, la vraie fonction du serveur.
Ce que le produit jette, le banc le jette aussi. Et ce qu'il jette est l'une des
mesures.

---

## Ce que chaque mesure répond

| mesure | la question |
|---|---|
| **stabilité** | Trois lectures indépendantes du même corpus. Mêmes pistes ? mêmes nœuds ? et surtout : les paires de nœuds que la carte affiche groupées se retrouvent-elles groupées à la relecture ? Un groupe qui ne tient pas est un tirage, pas un groupe. |
| **recouvrement** | Combien de nœuds le modèle place dans plus d'une piste — mesuré sur le **brut**, avant que `validerPistes()` ne les retire (`pris`), puis qu'`ilotDesNoeuds()` applique la même règle une seconde fois côté client. |
| **ponts** | Les liens qui traversent deux îlots, et les nœuds qui les portent. Aujourd'hui ils se dessinent **avant** les halos, donc sous eux. |
| **appui** | Par îlot : liens internes, liens sortants, densité. L'enveloppe se calcule sur les **positions**, jamais sur les liens — un groupe à densité nulle est dessiné aussi plein qu'un groupe saturé. |
| **boucles** | Les paires où le modèle écrit les **deux sens** — « ça soulage » et « ça aggrave ». `validerCarte()` n'en garde qu'un : le mécanisme s'efface au moment précis où il s'expliquait. |
| **témoins** | Combien de nœuds de genre `dependance`, et combien de pistes, sur une conversation sans enjeu. |

`BANC_LECTURES=/un/autre/dossier npm run banc:carte` mesure un autre jeu de
lectures — deux tissages du même corpus se comparent alors sans se marcher
dessus.
