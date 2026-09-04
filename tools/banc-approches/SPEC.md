# Banc d'essai des approches de cartographie — cahier des charges (v0, à critiquer)

Question : parmi six façons de cartographier un état mental, laquelle **retrouve le plus de fonctionnements plantés** dans des données synthétiques réalistes, sur sept profils ?

Tout est en Node ESM pur (`node tools/banc-approches/banc.mjs`), sans dépendance, sans réseau, déterministe (graine).

## 1. Les données synthétiques : un « patient » = T jours de mesures quotidiennes

Variables par jour (toutes numériques ; les binaires valent 0/1) :

| clé | sens | échelle |
|---|---|---|
| `humeur` | humeur du jour | 1–10 (entier, arrondi, avec plancher/plafond) |
| `energie` | énergie | 1–10 |
| `sommeil_h` | heures dormies la nuit précédente | 0–12 |
| `coucher` | heure de coucher (décimale, peut dépasser 24 → 0–6 du matin = 24–30) | 20–30 |
| `anxio` | crise d'anxiété ce jour | 0/1 |
| `substance` | consommation (weed/alcool…) ce jour | 0/1 |
| `social` | journée sociale | 0/1 |
| `declencheur` | événement stressant / rupture de routine | 0/1 |
| `dereel` | épisode de déréalisation | 0/1 |
| `ecran_min` | minutes d'écran | 0–900 |
| `absolus` | mots absolus pour 100 mots (marqueur de langage) | 0–8 |
| `ecrit` | y a-t-il une note ce jour (sinon les valeurs déclaratives sont manquantes) | 0/1 |

Manquants : trois niveaux (0 %, 15 %, 35 % de jours sans note → `humeur`, `anxio`, `dereel`, `absolus` = null ces jours-là ; les variables passives `sommeil_h`, `coucher`, `ecran_min` restent, comme avec une appli de suivi).

Longueurs : T = 60 et T = 180 jours (la densité compte : certaines méthodes n'ont rien à dire à 60 jours).

N = 40 patients par profil × 3 niveaux de manquants × 2 longueurs.

## 2. Les profils et leurs fonctionnements plantés (vérité terrain)

Chaque profil est un petit modèle d'état à temps discret. Chaque fonctionnement planté a un **type** (voir §3) pour être noté.

**temoin** (fonctionnement ordinaire)
- humeur AR(1) faible (φ≈0,3) autour de 6,5, bruit modéré
- rythme hebdomadaire : week-end +0,6 d'humeur, coucher +1 h → `rhythm(7)`
- `edge(sommeil_h → humeur, +, lag 0/1, faible)`

**depression**
- humeur basse (≈3,5), AR(1) forte (φ≈0,75), variance faible → `autocorr_high`
- sommeil long ou réveil précoce (bimodal), énergie basse, social rare
- `edge(sommeil_h → humeur, +, lag 1)`, `edge(social → humeur, +, lag 0)`
- 1–2 aggravations sur 180 j (paliers de −1,5 pendant 3–4 semaines) → `episode(depressif)` avec **ralentissement critique** avant (AR et variance montent 10–14 j avant) → `ews`
- `language` : `absolus` suit la sévérité (corr. négative avec humeur, ≈ −0,5)

**anxiete**
- humeur ≈6, variance haute, réactive
- `declencheur` p≈0,15/j → `anxio` le jour même (p≈0,8) → `sommeil_h` −2 h cette nuit → `humeur` −1,5 le lendemain, retour en 2 j → `chain([declencheur, anxio, sommeil_court, humeur_bas])`
- `edge(anxio → sommeil_h, −, lag 0)`, `edge(sommeil_h → humeur, +, lag 1)`
- `substance` plus probable les soirs d'anxio (p 0,5 vs 0,1) → `edge(anxio → substance, +, lag 0)`

**bipolarite**
- trois régimes : euthymie (humeur 6, sommeil 7,5), manie (humeur 8,5–9,5, sommeil 3–4, énergie 9, écran ×2, social ↑) 10–20 j, dépression (humeur 2,5, sommeil 9–10, énergie 2) 20–40 j
- transitions avec ralentissement critique (AR/variance montent 10 j avant) → `episode(manie)`, `episode(depressif)`, `ews`
- `coupling_sign(sommeil_h ↔ humeur, négatif en manie)` : la signature — moins on dort, plus l'humeur monte

**tdah**
- humeur : variance haute, AR(1) ≈0 (chaque jour repart) → `autocorr_low`
- coucher irrégulier : SD ≈2,5 h, tardif → `regularity(coucher, haute variance)`
- dette de sommeil (2 nuits < 5 h) → énergie et humeur ↓ le lendemain → `edge(sommeil_h → energie, +, lag 1)`
- écran en rafales (jours à 700+ min), corrélé au coucher tardif → `edge(ecran_min → coucher, +, lag 0)`
- pas d'épisode

**autisme** (profil autistique)
- humeur stable (variance basse), coucher très régulier (SD ≈0,5 h) → `regularity(coucher, basse variance)`
- journée sociale → énergie −3 le lendemain → humeur −1 → `chain([social, energie_bas, humeur_bas])`, `edge(social → energie, −, lag 1)`
- `declencheur` (rupture de routine, p≈0,08) → `anxio` 2–3 jours → `edge(declencheur → anxio, +, lag 0–2)`

**derealisation**
- humeur ≈5,5 ; `dereel` déclenché par (2 nuits < 5,5 h) ET (`declencheur` ou `anxio` dans les 2 j) → `chain([sommeil_court, sommeil_court, dereel])`
- jours `dereel` : humeur plate (variance ≈0), `absolus` ↑ → `language`
- `edge(dereel → humeur, −, lag 0)`

Bruit commun : arrondis, plancher/plafond, jours manquants, et 5 % de valeurs déclaratives aberrantes (saisie erronée).

## 3. Les types de fonctionnements et la règle de notation

| type | ce qui est planté | ce que la méthode doit rendre pour marquer |
|---|---|---|
| `edge(a→b, signe, lag)` | une arête dirigée | même a, b, signe ; lag 0/1 accepté. **Arête non dirigée du bon couple = 0,5** |
| `chain([s1,…,sk])` | une séquence ordonnée d'états discrétisés | la même séquence (sous-séquence ordonnée, fenêtre ≤ 4 j) ; ⅔ des maillons dans l'ordre = 0,5 |
| `episode(genre)` | des débuts de régime (dates) | un début détecté à ±5 j (F1 sur les débuts) |
| `ews` | des débuts précédés d'un ralentissement critique | une alerte dans les 14 j AVANT le début (taux de hits) ; fausses alertes comptées à part |
| `rhythm(7)` | périodicité hebdomadaire | une période 7 détectée |
| `regularity(var, haute/basse)` | variabilité du coucher | classer haute/basse correctement (seuil appris sur le témoin) |
| `autocorr_high/low` | l'inertie de l'humeur | classer correctement |
| `coupling_sign` | le signe d'un couplage dans un régime | le signe correct au moins dans le régime concerné |
| `language` | `absolus` suit la sévérité | corrélation retrouvée (|r| ≥ 0,3, bon signe) |

Score d'une méthode sur un patient = **rappel pondéré** (fonctionnements retrouvés / plantés) et **précision** (ce qu'elle rend en plus est compté : arêtes, chaînes, épisodes en trop). On rend rappel, précision, F1, par type et global. Le témoin sert aussi à mesurer les **fausses découvertes** sur un profil presque vide.

## 4. Les méthodes (chacune un module `methodes/<nom>.mjs` exportant `analyser(serie, options) → Trouvailles`)

`Trouvailles` = `{ edges:[{a,b,signe,lag,poids}], chains:[[etats…]], episodes:[{jour,genre?}], alertes:[jour], rhythm:[periode], regularity:{var,classe}, autocorr:'high'|'low'|null, couplings:[{a,b,signe}], language:{r} }` — les champs absents valent vide. **Aucune méthode ne voit la vérité terrain ni le profil.**

1. `cooccurrence` — la carte actuelle, réduite à sa structure : binariser chaque variable (haut/bas vs sa médiane), corrélation φ **le même jour**, arêtes non dirigées au-dessus d'un seuil. Ne rend que `edges` (sans signe de direction → crédit 0,5).
2. `var` — réseau temporel : régression ridge lag-1 de chaque variable sur toutes les autres (et lag 0 pour les binaires → simultané), arêtes dirigées signées au-dessus d'un seuil (stabilité par bootstrap ≥ 60 % des tirages). Rend `edges`, `autocorr` (φ diagonal de `humeur`).
3. `ews` — signaux précoces : AR(1) et variance glissantes (fenêtre 14) de `humeur` ; alerte quand la tendance des deux (Kendall τ sur 14 j) dépasse un seuil. Rend `alertes`, `autocorr`.
4. `chaine` — analyse en chaîne : discrétiser les états (`sommeil_court` si < 5,5 h, `humeur_bas` si < 4, `energie_bas` si < 4, les binaires tels quels), puis fouiller les séquences ordonnées fréquentes sur des fenêtres de 4 jours (support ≥ 3 occurrences et lift ≥ 2 vs permutation). Rend `chains`.
5. `frise` — life-chart : détection de ruptures (segmentation binaire / CUSUM) sur `humeur` et `sommeil_h` → `episodes` (genre par le niveau) ; autocorrélation au lag 7 → `rhythm` ; SD du coucher → `regularity` ; AR(1) de l'humeur → `autocorr`.
6. `pheno` — phénotypage digital : **variables passives seulement** (`sommeil_h`, `coucher`, `ecran_min`) : ruptures sur le sommeil → `episodes` ; SD coucher → `regularity` ; lag-1 sommeil → énergie non disponible (pas d'humeur) → ne rend que ce que le poste voit.
7. `langage` — marqueurs : corrélation `absolus`↔`humeur` → `language` ; tendance de `absolus` sur 14 j → `alertes`.
8. `composite` — la proposition : union de `frise` + `chaine` + `ews` (les trouvailles se cumulent, la précision paie les doublons).

Seuils : fixés **une fois** sur un jeu de calibration (profil témoin + un profil anxiété, graine séparée), jamais sur le jeu de test.

## 5. Sorties

- `resultats.json` : par méthode × profil × manquants × T : rappel/précision/F1 global et par type, fausses découvertes sur le témoin, et l'écart-type entre patients.
- `exemples.json` : pour chaque profil, UN patient (T=180, 15 % manquants) avec sa série complète et les trouvailles de chaque méthode — pour dessiner ce que chaque carte rend.
- Le rapport console : un tableau méthodes × profils (F1), puis le classement.
