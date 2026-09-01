import { DatabaseSync } from 'node:sqlite';
import { TEINTES_DECLAREES as TEINTES } from '../web/reperes.js';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, ensureUserTables, OWNER } from './migrate.js';
export { OWNER };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.BD_DB ?? join(ROOT, 'data', 'braindebugger.db');

try {
  mkdirSync(dirname(DB_PATH), { recursive: true });
} catch (err) {
  // Cas classique sur un hébergeur : BD_DB pointe dans un volume qui n'a pas
  // été monté. Le message par défaut (EACCES sur un chemin) n'aide personne.
  console.error(`
  ────────────────────────────────────────────────────────────
  BASE DE DONNÉES INACCESSIBLE

  Impossible de créer ${dirname(DB_PATH)} (${err.code ?? err.message}).

  BD_DB=${DB_PATH} pointe dans un répertoire où le processus ne peut pas
  écrire. Sur un hébergeur, monte un volume sur ce chemin avant de déployer,
  ou laisse BD_DB vide pour utiliser ./data (perdu à chaque redéploiement).
  ────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Schema cible : multi-comptes. Chaque table porte user_id, et les cles
// naturelles (date, note, key) sont composites avec lui -- deux personnes ont
// chacune leur 2026-08-26.
//
// Sur une base creee avant les comptes, ces CREATE ... IF NOT EXISTS ne font
// rien : les tables existent deja, a l'ancienne forme. C'est migrate() juste
// en dessous qui les reecrit. Une base neuve, elle, nait directement a la
// bonne forme et n'a rien a migrer.
db.exec(`
CREATE TABLE IF NOT EXISTS entries (
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  date    TEXT NOT NULL,          -- 'YYYY-MM-DD'
  note    REAL,                   -- 0..10, nullable
  text    TEXT,                   -- concatenation des messages utilisateur du jour
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS messages (
  id      INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  ts      TEXT NOT NULL,          -- ISO 8601
  date    TEXT NOT NULL,          -- 'YYYY-MM-DD', jour de rattachement
  source  TEXT,                   -- 'web' | 'discord'
  role    TEXT NOT NULL,          -- 'user' | 'pet'
  text    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);

-- Les reperes. La colonne date est le debut ; fin n'existe que pour ce qui DURE.
--
-- Un repere ponctuel et une periode ne sont pas deux objets differents : une
-- addiction de trois ans, un contrat, une relation sont des faits dates comme
-- les autres, ils ont seulement deux bornes au lieu d'une. Une table separee
-- aurait double chaque requete et chaque affichage pour la meme chose.
CREATE TABLE IF NOT EXISTS events (
  id      INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  date    TEXT NOT NULL,
  fin     TEXT,                        -- NULL = un instant, sinon une periode
  ouvert  INTEGER,                     -- 1 = periode en cours. ouvert=1 => fin IS NULL
  label   TEXT NOT NULL,
  theme   TEXT,                        -- NULL = deduit du libelle
  teinte  INTEGER,                     -- degres HSL, uniquement TEINTES_DECLAREES
  fort    INTEGER                      -- 1 = mis en avant : de la TAILLE, jamais de la couleur
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);

-- Ancres d'etalonnage : la legende de l'echelle, dans les mots de l'utilisateur.
-- Affichee au moment de noter pour limiter la derive pluriannuelle (SPEC 10.1).
CREATE TABLE IF NOT EXISTS anchors (
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  note    INTEGER NOT NULL,       -- 0..10
  label   TEXT NOT NULL,
  descr   TEXT,
  PRIMARY KEY (user_id, note)
);

-- Le carnet : ce que la personne a ecrit AILLEURS et apporte ici.
--
-- Ce n'est PAS une journee. Une journee est vecue, ecrite ce jour-la, notee, et
-- elle sert de denominateur a tout ce que l'application compte. Une note
-- apportee n'a rien de tout ca. Comptee comme une journee, elle deplacerait le
-- plancher et le plafond de la carte (qui sont des proportions du nombre de
-- jours), le denominateur de Jaccard, et la moyenne de reference de tous les
-- ecarts. D'ou une table a elle, et l'invariant qui tient tout : une note
-- n'entre jamais dans un compte de journees.
CREATE TABLE IF NOT EXISTS carnet (
  id      INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  cree_le TEXT NOT NULL,   -- quand la note a ete APPORTEE. Toujours connu.
  jour    TEXT,            -- le jour dont elle PARLE, ou NULL.
                           -- NULL, jamais '' ni la date du jour : une chaine vide
                           -- est fausse contre une comparaison de fenetre, et la
                           -- date du jour ferait ressortir un souvenir de 1998
                           -- comme s'il avait ete ecrit ce soir.
  quand   TEXT,            -- « vers 2019 », « je sais plus » : les mots de la
                           -- personne quand il n'y a pas de date. Affiche tel
                           -- quel, JAMAIS analyse, jamais trie, jamais converti.
  texte   TEXT NOT NULL,
  source  TEXT NOT NULL DEFAULT 'saisie'
);
CREATE INDEX IF NOT EXISTS idx_carnet_user ON carnet(user_id, jour);

-- LA COLONNE QU'ON N'AJOUTE JAMAIS : une note chiffree. Un seul /10 dans le
-- carnet translaterait la moyenne globale, donc TOUS les ecarts de la carte, y
-- compris ceux de mots sans aucun rapport avec ce qui a ete colle. L'absence de
-- colonne rend la faute impossible, pas seulement deconseillee.

-- Motifs : ce que le compagnon a decide de suivre de lui-meme.
--
-- Ce ne sont pas des mots-cles. Un mot-cle se cherche ; un motif se reconnait,
-- et seul un modele peut dire que « bon bref c'etait rien » et « t'inquiete
-- j'ai l'habitude » sont deux fois la meme chose. La table stocke donc ce que
-- le compagnon a nomme, pas un lexique -- et le compte des fois ou il l'a
-- reconnu, qui est la seule mesure honnete de la duree d'un motif.
CREATE TABLE IF NOT EXISTS motifs (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT '${OWNER}',
  nom        TEXT NOT NULL,
  mecanisme  TEXT NOT NULL,
  teinte     INTEGER NOT NULL,         -- degres HSL, choisis par l'app
  cree_le    TEXT NOT NULL,
  vu_le      TEXT NOT NULL,
  vues       INTEGER NOT NULL DEFAULT 1
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_motifs_nom ON motifs(user_id, nom);

-- Quel message porte quel motif. C'est ce qui teinte le fil : la couleur suit
-- le message, elle ne suit pas la conversation entiere.
CREATE TABLE IF NOT EXISTS motif_vues (
  motif_id   INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  PRIMARY KEY (motif_id, message_id)
);
CREATE INDEX IF NOT EXISTS idx_motif_vues_msg ON motif_vues(message_id);

/*
 * Les objectifs : ce que la personne a decide d'arreter, de tenir, de changer.
 *
 * CE N'EST PAS UNE LISTE DE TACHES, et la difference tient dans ce que la table
 * ne contient pas : ni echeance, ni rappel, ni score. Une resolution qu'on ne
 * tient pas n'est pas un echec a signaler -- c'est une information, et la seule
 * chose que l'application en fasse est de la montrer telle quelle.
 *
 * « depuis » est la date du DEBUT DE LA SERIE EN COURS, pas celle de la
 * decision. C'est le seul chiffre qui compte quand on regarde : « douze jours »
 * veut dire douze jours d'affilee, pas douze jours depuis qu'on s'est dit qu'on
 * arreterait. « reprises » garde le reste -- recommencer trois fois est un
 * fait, et l'effacer a chaque rupture rendrait la ligne fausse dans l'autre
 * sens.
 */
CREATE TABLE IF NOT EXISTS objectifs (
  id       INTEGER PRIMARY KEY,
  user_id  TEXT NOT NULL DEFAULT '${OWNER}',
  quoi     TEXT NOT NULL,       -- dans SES mots : « arreter la cigarette »
  genre    TEXT NOT NULL,       -- un theme de reperes.js, pour l'icone
  cree_le  TEXT NOT NULL,
  depuis   TEXT NOT NULL,       -- 'AAAA-MM-JJ', debut de la serie en cours
  tenu     INTEGER NOT NULL DEFAULT 1,
  reprises INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_objectifs_user ON objectifs(user_id);

-- LA COLONNE QU'ON N'AJOUTE JAMAIS : un pourcentage de reussite. Un objectif
-- tenu a 62 % n'apprend rien a la personne qui le vit, et transforme un
-- indicateur en note.

/*
 * Les lectures : ce que le compagnon a compris du fonctionnement, par horizon.
 *
 * Une ligne par (personne, horizon), remplacee a chaque analyse. On ne garde
 * pas l'historique des lectures, et c'est un choix : l'evolution d'un theme est
 * DANS le theme (sa serie periode par periode), calculee sur tout le corpus a
 * chaque fois. La deduire d'une suite de lectures ferait dependre la courbe des
 * jours ou on a pense a lancer l'analyse.
 *
 * « jusqu_au » est ce qui dit qu'une lecture est perimee : la derniere journee
 * qu'elle a vue. Une date de calcul ne suffirait pas -- une lecture faite hier
 * sur un journal auquel on n'a rien ajoute est toujours juste.
 */
CREATE TABLE IF NOT EXISTS lectures (
  user_id  TEXT NOT NULL DEFAULT '${OWNER}',
  horizon  TEXT NOT NULL,          -- 'court' | 'moyen' | 'long'
  fait_le  TEXT NOT NULL,          -- ISO 8601
  jusqu_au TEXT,                   -- derniere journee ecrite du corpus
  jours    INTEGER NOT NULL,       -- journees ecrites derriere cette lecture
  modele   TEXT,
  contenu  TEXT NOT NULL,          -- JSON { synthese, themes }
  PRIMARY KEY (user_id, horizon)
);

/*
 * LES RELEVES : OU QUELQU'UN SEMBLE ETRE, A UN INSTANT.
 *
 * CE N'EST PAS UNE NOTE, ET LA TABLE EXISTE POUR QUE CA RESTE VRAI.
 *
 * La note d'une journee est saisie a la main, une fois, par la personne. C'est
 * la regle qui tient toute la valeur du journal : quatre ans de notes ne valent
 * quelque chose que si c'est le meme jugement qui les a posees. Un modele qui
 * noterait a sa place casserait la comparabilite de la serie entiere, et rien
 * ne le signalerait -- les chiffres auraient l'air des memes chiffres.
 *
 * Ce qui est stocke ici est autre chose : ou quelqu'un semble etre A CE
 * MOMENT-LA de la conversation, releve quand le ton bascule nettement. Trois
 * releves dans une soiree ne font pas une note de la soiree ; ils font une
 * AMPLITUDE, et c'est la seule chose qu'on en tire.
 *
 * D'ou une table a part, attachee a un MESSAGE et jamais a une journee, et
 * l'invariant qui tient tout : aucune requete de « entries » ne la lit, aucune
 * moyenne ne l'inclut, aucune reference ne bouge avec elle.
 */
CREATE TABLE IF NOT EXISTS releves (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL DEFAULT '${OWNER}',
  message_id INTEGER NOT NULL,
  date       TEXT NOT NULL,          -- 'YYYY-MM-DD', le jour du message
  ts         TEXT NOT NULL,          -- ISO 8601, l'instant du releve
  valeur     INTEGER NOT NULL,       -- 0..10, DECLARE par le compagnon
  quoi       TEXT NOT NULL           -- a quoi il l'a vu, dans ses mots
);
CREATE INDEX IF NOT EXISTS idx_releves_jour ON releves(user_id, date);

-- LA COLONNE QU'ON N'AJOUTE JAMAIS ICI NON PLUS : rien qui permette de
-- remonter un releve dans « entries ». Pas de cle etrangere vers une journee,
-- pas de champ « appliquer ». L'absence de chemin rend la faute impossible,
-- pas seulement deconseillee.

CREATE TABLE IF NOT EXISTS embeddings (   -- phase 2
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  date    TEXT NOT NULL,
  vec     BLOB,
  PRIMARY KEY (user_id, date)
);

/*
 * LES MESURES : ce qu'une AUTRE application sait de la personne.
 *
 * Montre, telephone, balance, tracker de sommeil, appli de suivi. Elles
 * mesurent en continu ce que personne ne pense a ecrire le soir -- l'heure de
 * coucher, les pas, le temps d'ecran, la cafeine -- et c'est precisement le
 * genre de fait qui explique une journee a 3 quand la personne, elle, ne voit
 * qu'une journee a 3.
 *
 * UNE MESURE N'EST PAS UNE NOTE, et l'invariant est le meme que pour le
 * carnet : elle n'entre jamais dans un compte de journees. Une journee est
 * vecue et notee a la main ; une mesure est relevee par une machine, souvent a
 * l'insu de la personne. Les compter ensemble deplacerait le plancher, la
 * reference, et le denominateur de tout ce que l'application affiche -- au
 * profit de journees ou personne n'a rien dit.
 *
 * L'INDEX UNIQUE EST LA FONCTIONNALITE PRINCIPALE. Une application de suivi
 * resynchronise : elle renvoie la semaine entiere a chaque reveil, parce que
 * c'est plus simple que de savoir ce qu'elle a deja envoye. Sans contrainte
 * d'unicite, huit mille pas deviennent vingt-quatre mille en trois envois, et
 * la serie ment sans que rien ne le signale. La cle est (source, jour, mesure)
 * et le dernier envoi remplace le precedent.
 */
CREATE TABLE IF NOT EXISTS mesures (
  id      INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  date    TEXT NOT NULL,        -- 'AAAA-MM-JJ' : le jour auquel elle appartient
  ts      TEXT,                 -- l'instant exact, si l'application l'a donne
  source  TEXT NOT NULL,        -- qui l'a envoyee : 'montre', 'machitool'...
  cle     TEXT NOT NULL,        -- normalisee : 'sommeil_h', 'pas', 'ecran_min'
  valeur  REAL,                 -- numerique, ou NULL
  texte   TEXT,                 -- si la mesure n'est pas un nombre
  unite   TEXT,
  recu_le TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mesures_cle ON mesures(user_id, source, date, cle);
CREATE INDEX IF NOT EXISTS idx_mesures_date ON mesures(user_id, date);

/*
 * LE JOURNAL DES ENVOIS : ce qui est arrive, et ce qui a ete refuse.
 *
 * Sans lui, brancher une application exterieure se debogue a l'aveugle : elle
 * envoie, le site repond 200 ou 401, et personne ne peut voir ce que le site a
 * COMPRIS de ce qui est arrive. Une cle mal orthographiee, une date au mauvais
 * format, un tableau la ou on attendait un objet -- tout ca se voit ici, dans
 * l'application, sans ouvrir un terminal.
 *
 * ON N'Y MET PAS D'ADRESSE IP. Elle n'aiderait a rien pour deboguer -- c'est
 * toujours la meme machine -- et un journal d'adresses horodate est un fichier
 * de deplacements dont personne n'a besoin ici.
 */
CREATE TABLE IF NOT EXISTS qs_journal (
  id      INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  quand   TEXT NOT NULL,
  source  TEXT,
  statut  INTEGER NOT NULL,     -- le code HTTP rendu
  recues  INTEGER NOT NULL DEFAULT 0,
  gardees INTEGER NOT NULL DEFAULT 0,
  refus   TEXT,                 -- la raison, en francais, s'il y en a une
  apercu  TEXT                  -- les premieres cles vues : on reconnait son app
);
CREATE INDEX IF NOT EXISTS idx_qs_journal ON qs_journal(user_id, id DESC);

/*
 * Les seances : les rendez-vous chez le praticien.
 *
 * La table est minuscule, et c'est le point. Elle ne stocke ni compte rendu ni
 * contenu de seance -- ce qui se dit dans un cabinet ne se saisit pas dans une
 * application, et une case pour l'y mettre serait une invitation a le faire.
 * Elle stocke une DATE, qui est la seule chose dont le compte rendu a besoin :
 * elle decoupe le journal en intervalles « depuis la derniere fois ».
 *
 * « apporter » est la note qu'on se laisse a soi-meme entre deux seances -- la
 * chose qu'on veut penser a dire et qu'on aura oubliee le jour venu. Elle
 * appartient a la personne, pas au praticien.
 *
 * LA COLONNE QU'ON N'AJOUTE JAMAIS : une humeur d'apres-seance, notee de 0 a
 * 10. Elle transformerait le suivi en evaluation du praticien, et le fait de
 * savoir qu'on va etre note change ce qu'on dit en seance.
 */
CREATE TABLE IF NOT EXISTS seances (
  id        INTEGER PRIMARY KEY,
  user_id   TEXT NOT NULL DEFAULT '${OWNER}',
  date      TEXT NOT NULL,       -- 'AAAA-MM-JJ'
  praticien TEXT,                -- libre : « Dr M. », « la psy », NULL
  apporter  TEXT,                -- ce qu'on veut penser a dire la prochaine fois
  cree_le   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_seances_date ON seances(user_id, date);

/*
 * LE JOURNAL D'ACTIVITE : un digest par jour, envoye par Machi Tool.
 *
 * C'est l'ENVELOPPE d'une journee de travail -- combien de temps par
 * application et par site, combien de bascules entre fenetres, la plage de
 * reveil a coucher, les trous. Jamais le CONTENU : pas une phrase tapee, pas
 * un message. Machi Tool le mesure comme ActivityWatch, sur la seule fenetre
 * au premier plan, et le renvoie ici une fois par jour, reecrit a chaque fois
 * que la journee avance.
 *
 * Une ligne par (personne, jour). Le digest entier est garde tel quel, en
 * JSON : sa forme evolue cote application, et le site n'a pas a la figer pour
 * la ranger. La console Quantified Self le relit et le consolide.
 */
CREATE TABLE IF NOT EXISTS activite_jours (
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  date    TEXT NOT NULL,          -- 'AAAA-MM-JJ'
  recu_le TEXT NOT NULL,
  digest  TEXT NOT NULL,          -- le resume du jour, en JSON, tel qu'envoye
  PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_activite_date ON activite_jours(user_id, date DESC);

CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT NOT NULL DEFAULT '${OWNER}',
  key     TEXT NOT NULL,
  value   TEXT NOT NULL,          -- JSON
  PRIMARY KEY (user_id, key)
);
`);

const _m = migrate(db);
if (_m.migrated) console.log('  base migrée vers le mode multi-utilisateurs');
ensureUserTables(db);

/* ---------- utilisateurs ---------- */

export function upsertUser({ id, username, avatar }) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users(id, username, avatar, created_at, seen_at) VALUES(?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET username = excluded.username,
                                  avatar   = excluded.avatar,
                                  seen_at  = excluded.seen_at
  `).run(id, username ?? null, avatar ?? null, now, now);
  return getUser(id);
}
export const getUser = id => db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
export const countUsers = () => db.prepare('SELECT COUNT(*) c FROM users').get().c;

/* ---------- settings ---------- */

export const DEFAULT_SETTINGS = {
  petName: 'Chaton',
  petSprite: 'chaton',        // id integre, ou 'custom'
  petImage: null,             // data URL si petSprite === 'custom'
  blipEnabled: true,          // la voix du compagnon : un blip par syllabe
  blipVoice: 'aa',            // identifiant de timbre (voir web/blips.js)
  blipPitch: 1,               // 0.6 .. 1.6
  blipVolume: 0.7,            // 0 .. 1
  chatBackend: 'scripted',    // 'scripted' | 'anthropic' | 'ollama'
  ollamaUrl: 'http://127.0.0.1:11434',
  ollamaModel: 'qwen2.5:7b',
  apiKey: '',                 // cle Anthropic ; repli sur ANTHROPIC_API_KEY
  /*
   * DEUX MODELES, PARCE QUE C'EST DEUX METIERS.
   *
   * `anthropicModel` sert la LECTURE de fond : relire quatre ans de journal et
   * en tirer des mecanismes. C'est la seule tache du produit ou l'intelligence
   * se voit vraiment, et elle tourne une fois par semaine.
   *
   * `anthropicModelChat` sert le COMPAGNON : tenir une conversation du soir.
   * Ca demande de la justesse et de la vitesse, pas la meme profondeur -- et
   * ca tourne quarante fois par jour. Sonnet 5 par defaut : deux fois et demie
   * moins cher en entree, deux fois et demie en sortie.
   */
  anthropicModel: 'claude-opus-5',
  anthropicModelChat: 'claude-sonnet-5',
  /*
   * LA LECTURE DE FOND PART EN LOT, A MOITIE PRIX.
   *
   * Elle tourne toute seule une fois par semaine, l'ecran dit « Il relit ton
   * journal » et garde la lecture precedente affichee : personne ne la regarde
   * apparaitre. C'est exactement la charge que l'API des lots est faite pour
   * absorber -- elle rend en une heure au lieu de deux minutes, et facture la
   * moitie.
   *
   * Le bouton « relire » reste DIRECT quoi qu'il arrive : quelqu'un qui vient
   * de cliquer attend une reponse.
   */
  lectureEnLot: true,
  /*
   * Le lot en cours : `{ id, depuis }`. Vide quand il n'y en a pas. C'est un
   * REGLAGE et pas une table, parce qu'il n'y en a jamais qu'un a la fois et
   * qu'il ne survit a rien -- un lot perdu se relance.
   */
  lectureLot: null,
  /*
   * Ce qui a fait echouer le dernier lot, s'il a echoue. Efface au lancement du
   * suivant. Sans lui, un lot expire laisserait l'ecran sur « il relit » pour
   * toujours, et la seule facon de s'en apercevoir serait de remarquer que la
   * date de la lecture ne bouge plus.
   */
  lectureLotErreur: null,
  /*
   * QUAND LA TOILE A ETE RETISSEE POUR LA DERNIERE FOIS.
   *
   * Ecrit UNIQUEMENT par un retissage manuel qui a abouti : ni la relecture de
   * fond ni un echec ne consomment le tour. C'est ce champ qui porte les douze
   * heures de battement.
   *
   * Il doit etre declare ICI et pas ailleurs : `setSettings` ignore en silence
   * toute cle absente de cette table. Un reglage oublie ici ne leve rien, ne
   * casse rien, et ne s'enregistre jamais -- le battement n'aurait tout
   * simplement jamais pris.
   */
  dernierRetissage: null,
  anthropicEffort: 'low',     // 'low' | 'medium' | 'high' -- latence contre profondeur
  /*
   * LA CLE DE LA PASSERELLE. Vide tant qu'on n'en a pas cree une.
   *
   * Elle n'ouvre qu'une route, en lecture, et ce que cette route rend n'est
   * jamais le journal (voir server/passerelle.js). Elle part vers le navigateur
   * avec le reste des reglages, contrairement a la cle Anthropic : il faut
   * pouvoir la LIRE pour la recopier dans l'application qui s'en sert, et le
   * seul navigateur qui la recoit est celui de la session deja ouverte.
   */
  passerelleCle: '',
  /*
   * L'enveloppe de jetons levee. UN OUTIL DE DEVELOPPEUR, ET RIEN D'AUTRE.
   *
   * L'enveloppe existe parce que c'est la cle de l'instance qui regle, pas la
   * personne : elle dit ou on en est, et a zero le compagnon retombe hors-ligne
   * plutot que de couper quelqu'un au milieu d'une phrase. Sur un journal
   * personnel, ou celui qui ecrit est aussi celui qui paie, elle ne protege de
   * rien -- elle empeche juste de travailler.
   *
   * Ce reglage la retire donc COMPLETEMENT : plus de plafond, plus de repli
   * hors-ligne. Le comptage, lui, ne s'arrete pas -- on veut toujours savoir ce
   * qu'on consomme, et c'est meme la seule chose qui reste quand la limite
   * disparait.
   */
  sansEnveloppe: false,
  /*
   * Le mode pudique -- « je montre l'application, pas ma vie ».
   *
   * Partager son ecran, c'est montrer a quelqu'un d'autre un journal ecrit pour
   * soi. Le reflexe serait de tout cacher ; ce serait montrer une coquille
   * vide. On separe donc les MOTS des FORMES : le texte des messages, des
   * journees, des reperes, des mecanismes, le nom du compte -- tout ce qui dit
   * QUOI -- devient illisible ; les notes, les couleurs, les courbes, les
   * amas de la carte -- tout ce qui dit COMBIEN et QUELLE FORME -- reste.
   * L'application se demontre entiere, sans que personne puisse la lire.
   *
   * Le reglage est stocke comme les autres : quelqu'un qui partage son ecran
   * tous les jeudis ne veut pas y repenser chaque jeudi.
   */
  pudique: false,
  memoryDays: 14,             // journees passees transmises au compagnon (0 = aucune)
  carnetMemoire: true,        // le carnet est transmis au compagnon
                              // (coupe de toute facon quand memoryDays vaut 0 :
                              //  l'interface promet qu'a 0 il ne connait que la
                              //  conversation du jour, et ca doit rester vrai)
  floor: 2,                   // SPEC 4.1 - sous ce seuil, aucune statistique
  floorMode: 'fixed',         // 'fixed' | 'relative' (reference - 3)
  sustain: 2,                 // jours consecutifs >= reference pour valider un retour
  /*
   * L'etalon : la constante a laquelle chaque journee se compare dans le mode
   * « etalon ». 5, et pas la moyenne reelle : c'est le milieu de l'echelle, ce
   * que la personne a en tete quand elle note. Une constante calee sur SA
   * moyenne rend le cumul plat par construction -- il ne dit plus rien, il
   * decrit sa propre origine.
   */
  etalon: 5,
  // La naissance. Elle ne sert qu'a une chose : donner une origine a la frise,
  // pour qu'un repere d'enfance ait ou se poser. Aucun calcul ne s'en sert, et
  // surtout aucun ne calcule d'age -- ce serait une donnee sur la personne, pas
  // sur ses journees.
  naissance: null,            // 'AAAA-MM-JJ' ou null
  cumMode: 'etalon',          // 'etalon' | 'reference'
  contrastCenter: 'reference', // 'fixed5' (formule tableur) | 'reference' (glissante)
  // Debut du fil courant. « Nouveau chat » avance ce curseur : les messages
  // anterieurs quittent la conversation, mais RIEN n'est efface -- le texte des
  // journees reste dans le journal, et c'est lui que le miroir fouille et que
  // le compagnon garde en memoire. Effacer pour de bon des annees d'ecriture
  // sur un clic serait irreparable, et ce n'est pas ce qu'on demande a un
  // bouton qui sert a changer de sujet.
  chatSince: null             // ISO 8601, ou null = tout le fil
};

export function getSettings(userId = OWNER) {
  const rows = db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId);
  const stored = new Set(rows.map(r => r.key));
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { /* ignore */ }
  }
  // Une cle fournie par l'environnement et aucun backend choisi : on part sur
  // Claude. Sinon la cle est en place, tout fonctionne, et il faut quand meme
  // deviner qu'il reste une case a cocher quelque part.
  if (!stored.has('chatBackend') && process.env.ANTHROPIC_API_KEY) out.chatBackend = 'anthropic';
  return out;
}

/**
 * Version transmissible au navigateur.
 * La cle API n'en fait JAMAIS partie : elle est stockee en base et n'a aucune
 * raison de repartir vers le client a chaque chargement. On envoie seulement
 * de quoi afficher son etat.
 */
export function publicSettings(s = getSettings()) {
  const { apiKey, ...rest } = s;
  return {
    ...rest,
    hasStoredKey: !!apiKey,
    hasEnvKey: !!process.env.ANTHROPIC_API_KEY,
    // Meme ordre que resolveKey() dans chat.js. Deux endroits qui repondent
    // « quelle cle sert ? » differemment, c'est une interface qui ment.
    keySource: process.env.ANTHROPIC_API_KEY ? 'env' : (apiKey ? 'stored' : 'none')
  };
}

export function setSettings(patch, userId = OWNER) {
  const stmt = db.prepare(
    'INSERT INTO settings(user_id, key, value) VALUES(?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
  );
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    stmt.run(userId, k, JSON.stringify(v));
  }
  return getSettings(userId);
}

/* ---------- entries ---------- */

export function allEntries(userId = OWNER) {
  return db.prepare('SELECT date, note, text FROM entries WHERE user_id = ? ORDER BY date ASC').all(userId);
}

export function getEntry(date, userId = OWNER) {
  return db.prepare('SELECT date, note, text FROM entries WHERE user_id = ? AND date = ?').get(userId, date) ?? null;
}

export function setNote(date, note, userId = OWNER) {
  db.prepare(`
    INSERT INTO entries(user_id, date, note) VALUES(?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET note = excluded.note
  `).run(userId, date, note);
  return getEntry(date, userId);
}

/**
 * entries.text est la concatenation des messages *utilisateur* du jour.
 * SPEC 4.3 : les mots exacts. On ne stocke jamais les phrases du pet
 * dans le corpus qui sera rendu a l'utilisateur.
 */
/**
 * REDATER DES MESSAGES PRECIS, ET RIEN D'AUTRE.
 *
 * Sert a une seule chose : quand quelqu'un dit « je vais me coucher » a 6 h du
 * matin, ce qu'il a ecrit cette nuit-la appartient a la journee qui se termine,
 * pas a celle qui commence. On apprend la frontiere APRES coup, et les messages
 * sont deja ranges.
 *
 * La liste d'identifiants vient de l'appelant, qui seul connait le fuseau de la
 * personne et l'heure de la coupure. Cette fonction ne decide rien : elle
 * deplace ce qu'on lui nomme. C'est ce qui la rend sure -- elle ne peut pas
 * reecrire une grille entiere sur une erreur de calcul ailleurs.
 */
export function redaterMessages(ids, versDate, userId = OWNER) {
  const liste = (ids ?? []).map(Number).filter(Number.isInteger);
  if (!liste.length) return 0;
  const trous = liste.map(() => '?').join(',');
  const info = db.prepare(
    `UPDATE messages SET date = ? WHERE user_id = ? AND id IN (${trous})`
  ).run(versDate, userId, ...liste);
  return info.changes;
}

export function rebuildEntryText(date, userId = OWNER) {
  // `range = 1` : des notes prises ailleurs, collees ici. Elles ne sont pas la
  // journee de la personne et n'entrent donc pas dans son texte -- sinon le
  // soir ou elle colle trois ans de notes devient la journee la plus dense de
  // tout le journal, et la carte relie tout ce vocabulaire a ce mardi-la.
  const rows = db.prepare(
    "SELECT text FROM messages WHERE user_id = ? AND date = ? AND role = 'user' AND COALESCE(rangee, 0) = 0 ORDER BY ts ASC"
  ).all(userId, date);
  const text = rows.map(r => r.text).join('\n');
  db.prepare(`
    INSERT INTO entries(user_id, date, text) VALUES(?, ?, ?)
    ON CONFLICT(user_id, date) DO UPDATE SET text = excluded.text
  `).run(userId, date, text);
  return text;
}

/* ---------- messages ---------- */

export function addMessage({ ts, date, source = 'web', role, text, reflexion = null, userId = OWNER }) {
  const info = db.prepare(
    'INSERT INTO messages(user_id, ts, date, source, role, text, reflexion) VALUES(?,?,?,?,?,?,?)'
  ).run(userId, ts, date, source, role, text, reflexion || null);
  if (role === 'user') rebuildEntryText(date, userId);
  return Number(info.lastInsertRowid);
}

/**
 * REMBOBINER LE FIL JUSQU'A UN MESSAGE.
 *
 * Ce qui a ete dit apres ce message disparait, et le message lui-meme revient
 * a celui qui l'a ecrit pour qu'il le reprenne. C'est le geste qu'on cherche
 * quand le compagnon vient de retomber hors-ligne, quand la reponse est a cote,
 * ou quand on s'est relu une phrase trop tard.
 *
 * ON SUPPRIME VRAIMENT, ET C'EST LE CHOIX DIFFICILE. Marquer les messages
 * « caches » aurait garde une trace, mais le texte de la journee est la
 * concatenation des messages de la journee : un message rembobine qui resterait
 * en base resterait dans la journee, donc dans la carte, dans les echos, dans
 * toutes les statistiques. On aurait retire une phrase de l'ecran en la
 * laissant dans tout ce que l'application en deduit -- c'est-a-dire le
 * contraire de ce qu'on demande.
 *
 * D'ou : suppression, et le texte des journees touchees recalcule dans la meme
 * transaction. Sans ce recalcul, la journee garderait la phrase effacee
 * jusqu'au prochain message, et personne ne saurait pourquoi.
 */
export function rembobiner(id, userId = OWNER) {
  const cible = db.prepare(
    'SELECT id, ts, date, role, text FROM messages WHERE user_id = ? AND id = ?'
  ).get(userId, id);
  if (!cible) return null;

  // Par (ts, id), pas par id seul : un message importe ou venu de Discord peut
  // porter un identifiant plus grand qu'un message anterieur, et l'ordre du fil
  // est celui du temps. C'est exactement l'ordre de recentMessages().
  const suite = db.prepare(
    'SELECT id, date, role FROM messages WHERE user_id = ? AND (ts > ? OR (ts = ? AND id >= ?)) ORDER BY ts ASC, id ASC'
  ).all(userId, cible.ts, cible.ts, cible.id);

  const jours = [...new Set(suite.filter(m => m.role === 'user').map(m => m.date))];

  db.exec('BEGIN');
  try {
    const del = db.prepare('DELETE FROM messages WHERE user_id = ? AND id = ?');
    const delVues = db.prepare('DELETE FROM motif_vues WHERE message_id = ?');
    for (const m of suite) { delVues.run(m.id); del.run(userId, m.id); }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }

  // Hors transaction : rebuildEntryText ecrit dans entries, et une journee qui
  // se retrouve vide n'a plus de raison d'exister -- sauf si elle porte une
  // note, qui, elle, a ete saisie a la main et n'appartient pas au fil.
  for (const d of jours) {
    rebuildEntryText(d, userId);
    db.prepare(
      "DELETE FROM entries WHERE user_id = ? AND date = ? AND note IS NULL AND (text IS NULL OR TRIM(text) = '')"
    ).run(userId, d);
  }

  return { texte: cible.role === 'user' ? cible.text : '', supprimes: suite.length, date: cible.date };
}

/**
 * Le fil, en continu. Une conversation qui repart de zero chaque matin n'est
 * pas une conversation : on revient vers quelqu'un qu'on connait, pas vers un
 * formulaire quotidien. Le changement de jour devient un simple repere dans le
 * fil, pas une coupure.
 */
/**
 * Le fil courant. `since` borne le debut : c'est « Nouveau chat ».
 *
 * Les messages plus anciens ne sont pas supprimes, seulement hors du fil. Le
 * journal, lui, les garde -- c'est la difference entre changer de sujet et
 * effacer ce qu'on a ecrit.
 */
export function recentMessages(limit = 80, userId = OWNER) {
  const since = getSettings(userId).chatSince;
  const rows = since
    ? db.prepare('SELECT id, ts, date, source, role, text, reflexion FROM messages WHERE user_id = ? AND ts >= ? ORDER BY ts DESC, id DESC LIMIT ?').all(userId, since, limit)
    : db.prepare('SELECT id, ts, date, source, role, text, reflexion FROM messages WHERE user_id = ? ORDER BY ts DESC, id DESC LIMIT ?').all(userId, limit);
  return rows.reverse();
}

export function messagesForDate(date, userId = OWNER) {
  return db.prepare(
    'SELECT id, ts, source, role, text FROM messages WHERE user_id = ? AND date = ? ORDER BY ts ASC'
  ).all(userId, date);
}

export function recentUserMessages(limit = 40, userId = OWNER) {
  return db.prepare(
    "SELECT id, ts, date, role, text FROM messages WHERE user_id = ? AND role = 'user' ORDER BY ts DESC LIMIT ?"
  ).all(userId, limit).reverse();
}

/**
 * Suppression d'une journee : la note, le texte, et les messages qui l'ont
 * produit. Les trois ensemble, sinon rebuildEntryText la ferait renaitre au
 * prochain message.
 */
export function deleteDay(date, userId = OWNER) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM messages WHERE user_id = ? AND date = ?').run(userId, date);
    db.prepare('DELETE FROM entries  WHERE user_id = ? AND date = ?').run(userId, date);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return true;
}

/** Efface la note d'une journee en gardant ce qui a ete ecrit ce jour-la. */
export function clearNote(date, userId = OWNER) {
  db.prepare('UPDATE entries SET note = NULL WHERE user_id = ? AND date = ?').run(userId, date);
  // Une journee qui n'a plus ni note ni texte n'a plus de raison d'exister.
  db.prepare(
    "DELETE FROM entries WHERE user_id = ? AND date = ? AND note IS NULL AND (text IS NULL OR TRIM(text) = '')"
  ).run(userId, date);
  return true;
}

/**
 * Remise a zero. Trois portees, de la plus etroite a la plus large.
 *
 * C'est la seule fonction du fichier qui detruit sans retour. Elle est
 * volontairement explicite : pas de valeur par defaut sur `portee`, pas de
 * suppression partielle silencieuse. Ce que l'appelant demande est ce qui part,
 * et le compte de ce qui a ete efface est rendu pour pouvoir le dire.
 */
export function wipe(portee, userId = OWNER) {
  const compte = {};
  const n = (t, sql, ...a) => { compte[t] = db.prepare(sql).run(...a).changes; };

  db.exec('BEGIN');
  try {
    if (portee === 'notes') {
      // Les notes seules : le texte reste, le journal ecrit survit.
      compte.notes = db.prepare('UPDATE entries SET note = NULL WHERE user_id = ? AND note IS NOT NULL').run(userId).changes;
      db.prepare("DELETE FROM entries WHERE user_id = ? AND note IS NULL AND (text IS NULL OR TRIM(text) = '')").run(userId);
    } else if (portee === 'texte') {
      // Le texte seul : les notes restent, la courbe survit.
      // Le carnet part avec le texte, et le compte rendu le dit. Quelqu'un qui
      // clique « effacer le texte » et retrouve son carnet intact -- et toujours
      // dans le contexte du compagnon -- a ete trompe.
      n('carnet',   'DELETE FROM carnet   WHERE user_id = ?', userId);
      n('messages', 'DELETE FROM messages WHERE user_id = ?', userId);
      compte.texte = db.prepare('UPDATE entries SET text = NULL WHERE user_id = ? AND text IS NOT NULL').run(userId).changes;
      db.prepare('DELETE FROM entries WHERE user_id = ? AND note IS NULL').run(userId);
    } else if (portee === 'tout') {
      n('entries',    'DELETE FROM entries    WHERE user_id = ?', userId);
      n('messages',   'DELETE FROM messages   WHERE user_id = ?', userId);
      n('events',     'DELETE FROM events     WHERE user_id = ?', userId);
      n('anchors',    'DELETE FROM anchors    WHERE user_id = ?', userId);
      n('carnet',     'DELETE FROM carnet     WHERE user_id = ?', userId);
      db.prepare('DELETE FROM motif_vues WHERE motif_id IN (SELECT id FROM motifs WHERE user_id = ?)').run(userId);
      n('motifs',     'DELETE FROM motifs     WHERE user_id = ?', userId);
      n('embeddings', 'DELETE FROM embeddings WHERE user_id = ?', userId);
      // Les reglages ne partent pas : le compagnon choisi, le timbre, la cle.
      // Remettre a zero son journal n'est pas redemander son prenom.
      db.prepare("DELETE FROM settings WHERE user_id = ? AND key = 'chatSince'").run(userId);
    } else {
      throw new Error(`portée inconnue : ${portee}`);
    }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return compte;
}

/* ---------- events ---------- */

export function allEvents(userId = OWNER) {
  return db.prepare('SELECT id, date, fin, label, theme, teinte, fort, ouvert FROM events WHERE user_id = ? ORDER BY date ASC').all(userId);
}
/*
 * Un objet, pas des positions.
 *
 * `fin` etait un quatrieme argument positionnel derriere un `userId` a valeur
 * par defaut : l'appelant de l'API ecrivait addEvent(date, label, userId) et
 * aucune periode ne pouvait donc jamais etre creee -- la colonne existait,
 * l'affectation en voies etait ecrite et testee, et rien ne pouvait s'en
 * servir. Un jour quelqu'un aurait ecrit une date dans user_id.
 */
export function addEvent({ date, fin = null, label, theme = null, teinte = null,
                           fort = 0, ouvert = 0, userId = OWNER }) {
  if (ouvert) fin = null;               // l'invariant, tenu a l'ecriture
  const info = db.prepare(
    'INSERT INTO events(user_id, date, fin, label, theme, teinte, fort, ouvert) VALUES(?,?,?,?,?,?,?,?)'
  ).run(userId, date, fin, label, theme, teinte, fort ? 1 : 0, ouvert ? 1 : 0);
  return { id: Number(info.lastInsertRowid), date, fin, label, theme, teinte, fort, ouvert };
}

/** Champs autorises seulement, et filtre sur user_id comme deleteEvent. */
export function updateEvent(id, patch, userId = OWNER) {
  const cur = db.prepare('SELECT * FROM events WHERE id = ? AND user_id = ?').get(id, userId);
  if (!cur) return null;
  const n = { ...cur, ...patch };
  if (n.ouvert) n.fin = null;
  db.prepare(`UPDATE events SET date=?, fin=?, label=?, theme=?, teinte=?, fort=?, ouvert=?
              WHERE id = ? AND user_id = ?`)
    .run(n.date, n.fin, n.label, n.theme ?? null, n.teinte ?? null,
         n.fort ? 1 : 0, n.ouvert ? 1 : 0, id, userId);
  return db.prepare('SELECT id, date, fin, label, theme, teinte, fort, ouvert FROM events WHERE id = ?').get(id);
}
export function deleteEvent(id, userId = OWNER) {
  // filtre sur l'utilisateur : un identifiant devine ne doit pas suffire
  db.prepare('DELETE FROM events WHERE id = ? AND user_id = ?').run(id, userId);
}

/* ---------- carnet ---------- */

export function addCarnet({ texte, jour = null, quand = null, source = 'saisie',
                            userId = OWNER, quandCree = new Date().toISOString() }) {
  // N'appelle NI addMessage NI rebuildEntryText, et c'est le point entier de
  // cette table. rebuildEntryText REMPLACE entries.text par la concatenation
  // des messages du jour : une note posee a cote serait effacee au prochain
  // message. Et passer par messages ferait DIRE ces mots a la personne -- ils
  // repartiraient dans le fil, dans le decor, et dans le Miroir comme sa parole
  // de ce jour-la. Surtout : une note posee sur une journee sans texte
  // transformerait une journee NON ECRITE en journee ecrite, et tous les
  // comptes de la carte bougeraient.
  const info = db.prepare(
    'INSERT INTO carnet(user_id, cree_le, jour, quand, texte, source) VALUES(?,?,?,?,?,?)'
  ).run(userId, quandCree, jour, quand, texte, source);
  return { id: Number(info.lastInsertRowid), cree_le: quandCree, jour, quand, texte, source };
}

/** Dans l'ordre d'AJOUT : c'est la seule chose que la personne controle. */
export const allCarnet = (userId = OWNER) => db.prepare(
  'SELECT id, cree_le, jour, quand, texte, source FROM carnet WHERE user_id = ? ORDER BY cree_le ASC, id ASC'
).all(userId);

export const carnetDuJour = (date, userId = OWNER) => db.prepare(
  'SELECT id, cree_le, jour, quand, texte, source FROM carnet WHERE user_id = ? AND jour = ? ORDER BY cree_le ASC, id ASC'
).all(userId, date);

export function updateCarnet(id, { texte, jour, quand }, userId = OWNER) {
  const c = db.prepare('SELECT * FROM carnet WHERE id = ? AND user_id = ?').get(id, userId);
  if (!c) return null;
  db.prepare('UPDATE carnet SET texte = ?, jour = ?, quand = ? WHERE id = ?').run(
    texte ?? c.texte,
    jour === undefined ? c.jour : jour,
    quand === undefined ? c.quand : quand,
    id);
  return db.prepare('SELECT id, cree_le, jour, quand, texte, source FROM carnet WHERE id = ?').get(id);
}

export function deleteCarnet(id, userId = OWNER) {
  return db.prepare('DELETE FROM carnet WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

/**
 * Ranger un message de la personne : il quitte sa journee et devient une note.
 *
 * C'EST LE SEUL CHEMIN D'ECRITURE VERS LE CARNET DEPUIS LA CONVERSATION, et il
 * ne prend PAS de texte. Le texte vient de la ligne `messages`, telle qu'elle a
 * ete ecrite. Le compagnon peut declencher le rangement, jamais dicter ce qui
 * est range : du texte genere qui se glisserait ici lui reviendrait ensuite,
 * dans « explorer un theme », comme si elle l'avait ecrit elle-meme.
 *
 * Le message reste dans le fil. Il a bien ete envoye ; c'est seulement qu'il ne
 * raconte pas ce jour-la.
 */
export function rangerMessage(id, { jour = null, quand = null } = {}, userId = OWNER) {
  const m = db.prepare(
    "SELECT id, date, role, text, COALESCE(rangee,0) rangee FROM messages WHERE id = ? AND user_id = ?"
  ).get(id, userId);
  if (!m) return { erreur: 'Message introuvable.' };
  if (m.role !== 'user') return { erreur: "On ne range que les mots de la personne." };
  if (m.rangee) return { erreur: 'Ce message est déjà rangé.' };

  db.exec('BEGIN');
  try {
    db.prepare('UPDATE messages SET rangee = 1 WHERE id = ?').run(id);
    const note = addCarnet({ texte: m.text, jour, quand, source: 'conversation', userId });
    db.exec('COMMIT');
    rebuildEntryText(m.date, userId);      // hors transaction : il relit la table
    return { note };
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}

export function countCarnet(userId = OWNER) {
  const r = db.prepare('SELECT COUNT(*) t, COUNT(jour) d FROM carnet WHERE user_id = ?').get(userId);
  return { total: r.t, datees: r.d, libres: r.t - r.d };
}

/* ---------- lectures ---------- */

/*
 * LA LECTURE. Il n'y en a plus qu'une -- « tout le journal ».
 *
 * La colonne `horizon` reste, avec la valeur 'tout'. Pas par negligence : une
 * migration qui renomme des lignes peut echouer, et ce qu'elle detruirait est
 * la seule lecture que quelqu'un possede. On ecrit donc sous une cle unique, et
 * les anciennes lignes ('court', 'moyen', 'long') restent la sans gener.
 *
 * Tant que la nouvelle n'existe pas, on rend la plus RECENTE des anciennes.
 * Elle est perimee -- l'interface le dit et propose de relire -- mais un ecran
 * vide a la place d'une lecture qui existe serait une regression pour quelqu'un
 * qui vient de mettre a jour.
 */
export const CLE_LECTURE = 'tout';

export function getLecture(userId = OWNER) {
  const r = db.prepare('SELECT * FROM lectures WHERE user_id = ? AND horizon = ?').get(userId, CLE_LECTURE)
    ?? db.prepare('SELECT * FROM lectures WHERE user_id = ? ORDER BY fait_le DESC LIMIT 1').get(userId);
  if (!r) return null;
  try { return { ...r, contenu: JSON.parse(r.contenu), ancienne: r.horizon !== CLE_LECTURE }; }
  catch { return null; }        // un JSON casse vaut une lecture absente
}

export function setLecture({ contenu, jusqu_au, jours, modele, userId = OWNER,
                             quand = new Date().toISOString() }) {
  const horizon = CLE_LECTURE;
  db.prepare(`
    INSERT INTO lectures(user_id, horizon, fait_le, jusqu_au, jours, modele, contenu)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(user_id, horizon) DO UPDATE SET
      fait_le = excluded.fait_le, jusqu_au = excluded.jusqu_au,
      jours = excluded.jours, modele = excluded.modele, contenu = excluded.contenu
  `).run(userId, horizon, quand, jusqu_au, jours, modele ?? null, JSON.stringify(contenu));
  return getLecture(userId);
}

export const deleteLectures = (userId = OWNER) =>
  db.prepare('DELETE FROM lectures WHERE user_id = ?').run(userId).changes;

/* ---------- objectifs ---------- */

/** Les plus fragiles d'abord : un objectif rompu est celui dont on parle. */
export const allObjectifs = (userId = OWNER) => db.prepare(
  'SELECT id, quoi, genre, cree_le, depuis, tenu, reprises FROM objectifs WHERE user_id = ? ORDER BY tenu ASC, depuis DESC'
).all(userId);

export function addObjectif({ quoi, genre = 'jalon', depuis, userId = OWNER,
                              quandCree = new Date().toISOString() }) {
  const info = db.prepare(
    'INSERT INTO objectifs(user_id, quoi, genre, cree_le, depuis, tenu, reprises) VALUES(?,?,?,?,?,1,0)'
  ).run(userId, quoi, genre, quandCree, depuis);
  return { id: Number(info.lastInsertRowid), quoi, genre, cree_le: quandCree, depuis, tenu: 1, reprises: 0 };
}

/**
 * Rompu, ou repris.
 *
 * Une rupture ne remet PAS `depuis` a la date de rupture : on veut pouvoir dire
 * « rompu, apres onze jours ». C'est la reprise qui redemarre la serie, et qui
 * incremente `reprises` -- recommencer est un fait, pas une remise a zero.
 */
export function marquerObjectif(id, { tenu, date }, userId = OWNER) {
  const o = db.prepare('SELECT * FROM objectifs WHERE id = ? AND user_id = ?').get(id, userId);
  if (!o) return null;
  if (tenu) {
    db.prepare('UPDATE objectifs SET tenu = 1, depuis = ?, reprises = reprises + ? WHERE id = ?')
      .run(date, o.tenu ? 0 : 1, id);
  } else {
    db.prepare('UPDATE objectifs SET tenu = 0 WHERE id = ?').run(id);
  }
  return db.prepare('SELECT id, quoi, genre, cree_le, depuis, tenu, reprises FROM objectifs WHERE id = ?').get(id);
}

export function deleteObjectif(id, userId = OWNER) {
  return db.prepare('DELETE FROM objectifs WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;
}

/* ---------- motifs ---------- */

/*
 * Les teintes des motifs viennent de la table DECLAREE, partagee avec la frise.
 *
 * Le commentaire qui vivait ici promettait « aucune dans l'intervalle 0-150,
 * celui de l'echelle des notes » et « au moins 20 degres d'ecart ». Les deux
 * etaient faux, et le test qui les gardait -- TEINTES.every(t => t > 150) --
 * passait sans rien empecher : la rampe des notes ne s'arrete pas a 150, elle
 * monte jusqu'a 208 et redescend par 357. Six des dix teintes etaient donc en
 * collision, dont 205 a trois degres de « +4, une de tes meilleures journees ».
 * Mesure : hsl(205 55% 55%) = rgb(77,151,203) contre deltaColor(+4) =
 * rgb(61,134,198) -- seize unites RGB. Le meme bleu.
 */
// `export … from` NE cree PAS de liaison locale : addMotif() se serait retrouve
// avec un TEINTES indefini, et seuls les tests qui creent un motif l'auraient vu.
export { TEINTES };

export function allMotifs(userId = OWNER) {
  return db.prepare(
    'SELECT id, nom, mecanisme, teinte, cree_le, vu_le, vues FROM motifs WHERE user_id = ? ORDER BY vues DESC, id ASC'
  ).all(userId);
}

/**
 * LES OCCURRENCES D'UN MOTIF, MOIS PAR MOIS.
 *
 * Un motif portait un compte -- « 7 fois » -- et rien d'autre. Sept fois en un
 * an et sept fois en un mois ne sont pas la meme chose, et le compte seul ne
 * permet pas de les distinguer : c'est exactement l'information qui manque
 * quand on se demande si quelque chose s'aggrave.
 *
 * Les dates viennent des MESSAGES ou le compagnon l'a reconnu, pas d'un champ
 * a part : c'est la seule source qui ne puisse pas diverger de ce qui est
 * affiche dans le fil.
 */
export function motifSeries(userId = OWNER) {
  const rows = db.prepare(`
    SELECT v.motif_id AS id, substr(m.date, 1, 7) AS mois, COUNT(*) AS n
    FROM motif_vues v
    JOIN messages m ON m.id = v.message_id
    JOIN motifs f ON f.id = v.motif_id
    WHERE f.user_id = ? AND m.user_id = ?
    GROUP BY v.motif_id, mois
    ORDER BY mois ASC
  `).all(userId, userId);
  const par = new Map();
  for (const r of rows) {
    if (!par.has(r.id)) par.set(r.id, []);
    par.get(r.id).push({ periode: r.mois, n: r.n });
  }
  return par;
}

/**
 * LES OCCURRENCES D'UN MOTIF DANS UN INTERVALLE, DATEES.
 *
 * `motifSeries` groupe par mois, ce qui suffit a une courbe et pas a un compte
 * rendu : un intervalle entre deux seances tombe rarement sur des bornes de
 * mois, et « 4 fois en aout » ne dit pas si les quatre sont d'avant ou d'apres
 * le rendez-vous. On rend donc les JOURS, et l'appelant compte.
 *
 * Bornes incluses des deux cotes : `debut` est le jour de la seance
 * precedente, `fin` celui de la seance a preparer, et ce qui s'est dit ces
 * jours-la appartient a l'intervalle.
 */
export function motifsEntre(debut, fin, userId = OWNER) {
  const rows = db.prepare(`
    SELECT f.id, f.nom, f.mecanisme, f.teinte, m.date
    FROM motif_vues v
    JOIN messages m ON m.id = v.message_id
    JOIN motifs f   ON f.id = v.motif_id
    WHERE f.user_id = ? AND m.user_id = ? AND m.date >= ? AND m.date <= ?
    ORDER BY m.date ASC
  `).all(userId, userId, debut, fin);
  const par = new Map();
  for (const r of rows) {
    if (!par.has(r.id)) par.set(r.id, { id: r.id, nom: r.nom, mecanisme: r.mecanisme, teinte: r.teinte, jours: [] });
    par.get(r.id).jours.push(r.date);
  }
  return [...par.values()].sort((a, b) => b.jours.length - a.jours.length || a.id - b.id);
}

export function addMotif({ nom, mecanisme, userId = OWNER, quand = new Date().toISOString() }) {
  const deja = db.prepare('SELECT id FROM motifs WHERE user_id = ? AND nom = ?').get(userId, nom);
  if (deja) return { id: deja.id, existait: true };
  // La teinte suit l'ordre de creation, pas un hasard : deux motifs crees a la
  // suite doivent etre visiblement distincts, ce qu'un tirage ne garantit pas.
  const n = db.prepare('SELECT COUNT(*) c FROM motifs WHERE user_id = ?').get(userId).c;
  const info = db.prepare(
    'INSERT INTO motifs(user_id, nom, mecanisme, teinte, cree_le, vu_le, vues) VALUES(?,?,?,?,?,?,0)'
  ).run(userId, nom, mecanisme, TEINTES[n % TEINTES.length], quand, quand);
  return { id: Number(info.lastInsertRowid), existait: false };
}

/** Une occurrence : le motif remonte, et le message porte sa couleur. */
export function marquerMotif(motifId, messageId, userId = OWNER, quand = new Date().toISOString()) {
  const m = db.prepare('SELECT id, nom FROM motifs WHERE id = ? AND user_id = ?').get(motifId, userId);
  if (!m) return null;
  const info = db.prepare('INSERT OR IGNORE INTO motif_vues(motif_id, message_id) VALUES(?,?)').run(motifId, messageId);
  if (info.changes) {
    db.prepare('UPDATE motifs SET vues = vues + 1, vu_le = ? WHERE id = ?').run(quand, motifId);
  }
  return m;
}

/** Les motifs portes par une liste de messages : {messageId: [motif, ...]}. */
export function motifsDesMessages(ids, userId = OWNER) {
  if (!ids?.length) return {};
  const trous = ids.map(() => '?').join(',');
  /*
   * LE RANG, PAS LE TOTAL.
   *
   * La puce sous un message dit maintenant combien de fois ce mecanisme avait
   * ete reconnu A CE MOMENT-LA. Le total aurait ete plus simple a calculer et
   * faux a lire : en remontant le fil, chaque puce d'un meme motif afficherait
   * le meme chiffre, celui d'aujourd'hui, sur des phrases separees de six mois.
   * Le rang, lui, raconte l'accumulation -- c'est exactement ce qu'on vient
   * chercher en remontant.
   *
   * Il se compte sur TOUTES les vues du motif, pas sur celles de la fenetre
   * demandee : sinon le premier message affiche remettrait le compteur a un.
   *
   * L'ordre est celui du TEMPS, pas des identifiants. Les deux coincident tant
   * qu'on ecrit au fil de l'eau, et divergent des qu'on ne le fait pas -- une
   * conversation importee, un journal restaure. Compter sur l'identifiant
   * donnerait alors « 3x » avant « 1x » dans un fil qu'on remonte, ce qui n'a
   * aucun sens a lire. L'identifiant ne sert plus qu'a departager deux messages
   * de la meme seconde.
   */
  const rows = db.prepare(`
    WITH rangs AS (
      SELECT v.message_id, v.motif_id,
             ROW_NUMBER() OVER (PARTITION BY v.motif_id ORDER BY msg.ts, v.message_id) AS rang
      FROM motif_vues v
      JOIN motifs m ON m.id = v.motif_id
      JOIN messages msg ON msg.id = v.message_id
      WHERE m.user_id = ?
    )
    SELECT r.message_id, m.id, m.nom, m.mecanisme, m.teinte, r.rang
    FROM rangs r JOIN motifs m ON m.id = r.motif_id
    WHERE r.message_id IN (${trous})
  `).all(userId, ...ids);
  const par = {};
  for (const r of rows) {
    // Le mecanisme voyage avec : c'est ce qui repond a « qu'est-ce qu'il entend
    // par la ? » au survol, sans quitter le fil ni ouvrir quoi que ce soit.
    (par[r.message_id] ??= []).push({
      id: r.id, nom: r.nom, mecanisme: r.mecanisme, teinte: r.teinte, vues: r.rang
    });
  }
  return par;
}

/**
 * La couleur d'un motif, choisie par la personne.
 *
 * Elle est posee a la creation dans l'ordre des TEINTES_DECLAREES -- deux
 * motifs crees a la suite sont ainsi surement distincts. Mais l'ordre de
 * creation n'a aucun rapport avec le sens : deux mecanismes qui vont ensemble
 * se retrouvent de deux couleurs etrangeres, et rien ne permettait de les
 * rapprocher a l'oeil.
 *
 * La bande reste celle des DECLAREES (232-336). Ce n'est pas une preference
 * d'interface : ces teintes sont disjointes de la rampe des notes, et laisser
 * choisir un vert de note ferait passer une declaration pour une mesure.
 */
export function teinterMotif(id, teinte, userId = OWNER) {
  const t = Number(teinte);
  if (!TEINTES.includes(t)) return false;
  const info = db.prepare('UPDATE motifs SET teinte = ? WHERE id = ? AND user_id = ?').run(t, id, userId);
  return info.changes > 0;
}

/**
 * RENOMMER UN MOTIF SANS PERDRE SON HISTOIRE.
 *
 * Le nom d'un motif est une hypothese, et une hypothese se corrige : « humour
 * de defense » devient « minimisation » quand on a compris que ce n'etait pas
 * de l'humour. Sans ce chemin, la seule facon de corriger etait d'en creer un
 * nouveau -- et de perdre les quarante occurrences deja marquees, c'est-a-dire
 * exactement ce qui donnait sa valeur au motif.
 *
 * L'IDENTIFIANT, LA TEINTE ET LES OCCURRENCES NE BOUGENT PAS. Le motif est le
 * meme objet ; il a change de nom, pas de nature. Un motif qui changerait de
 * couleur en changeant de nom se lirait comme un motif neuf partout ou sa
 * pastille apparait.
 *
 * @returns {{ok: true, motif} | {erreur: string}}
 */
export function renommerMotif(id, { nom, mecanisme }, userId = OWNER) {
  const cur = db.prepare('SELECT * FROM motifs WHERE id = ? AND user_id = ?').get(id, userId);
  if (!cur) return { erreur: 'introuvable' };
  const n = nom == null ? cur.nom : String(nom).trim().replace(/\s+/g, ' ');
  const m = mecanisme == null ? cur.mecanisme : String(mecanisme).trim().replace(/\s+/g, ' ');
  if (n !== cur.nom) {
    // Deux motifs du meme nom rendraient l'un des deux inatteignable : c'est le
    // nom qui sert a les distinguer partout ailleurs dans le produit.
    const pris = db.prepare('SELECT id FROM motifs WHERE user_id = ? AND nom = ? AND id <> ?').get(userId, n, id);
    if (pris) return { erreur: 'ce nom est déjà pris' };
  }
  db.prepare('UPDATE motifs SET nom = ?, mecanisme = ? WHERE id = ? AND user_id = ?').run(n, m, id, userId);
  return { ok: true, motif: db.prepare('SELECT * FROM motifs WHERE id = ?').get(id) };
}

export function deleteMotif(id, userId = OWNER) {
  const m = db.prepare('SELECT id FROM motifs WHERE id = ? AND user_id = ?').get(id, userId);
  if (!m) return false;
  db.prepare('DELETE FROM motif_vues WHERE motif_id = ?').run(id);
  db.prepare('DELETE FROM motifs WHERE id = ?').run(id);
  return true;
}

/* ---------- releves ---------- */

export function addReleve({ messageId, date, valeur, quoi, userId = OWNER,
                            quand = new Date().toISOString() }) {
  const v = Math.max(0, Math.min(10, Math.round(Number(valeur))));
  if (!Number.isFinite(v)) return null;
  const info = db.prepare(
    'INSERT INTO releves(user_id, message_id, date, ts, valeur, quoi) VALUES(?,?,?,?,?,?)'
  ).run(userId, messageId, date, quand, v, String(quoi).trim());
  return { id: Number(info.lastInsertRowid), date, ts: quand, valeur: v, quoi };
}

export const relevesDuJour = (date, userId = OWNER) =>
  db.prepare('SELECT id, message_id, ts, valeur, quoi FROM releves WHERE user_id = ? AND date = ? ORDER BY ts ASC')
    .all(userId, date);

/**
 * L'AMPLITUDE D'UNE JOURNEE, ET RIEN D'AUTRE.
 *
 * On rend l'ecart entre le plus haut et le plus bas releve, pas leur moyenne.
 * Une moyenne de releves ressemblerait a une note, se lirait comme une note, et
 * finirait par etre comparee a la vraie -- alors qu'elles ne mesurent pas la
 * meme chose et n'ont pas ete posees par le meme juge.
 *
 * Il en faut DEUX. Un seul releve n'est pas une amplitude, c'est un point : le
 * publier comme « ta journee a bouge de 0 » serait faux dans les deux sens.
 */
export function amplitude(date, userId = OWNER) {
  const r = relevesDuJour(date, userId);
  if (r.length < 2) return null;
  const v = r.map(x => x.valeur);
  return { n: r.length, bas: Math.min(...v), haut: Math.max(...v), ecart: Math.max(...v) - Math.min(...v) };
}

/** Les journees a plusieurs releves, pour la lecture de fond. */
export function amplitudes(userId = OWNER, depuis = null) {
  const rows = db.prepare(`
    SELECT date, COUNT(*) n, MIN(valeur) bas, MAX(valeur) haut
    FROM releves WHERE user_id = ?${depuis ? ' AND date >= ?' : ''}
    GROUP BY date HAVING n >= 2 ORDER BY date ASC
  `).all(...(depuis ? [userId, depuis] : [userId]));
  return rows.map(r => ({ ...r, ecart: r.haut - r.bas }));
}

/* ---------- mesures (quantified self) ---------- */

/** Combien d'envois on garde. Au-dela, on ne debogue plus, on fouille. */
export const JOURNAL_QS = 120;

/**
 * Ecrire une mesure, ou remplacer celle du meme jour.
 *
 * `INSERT ... ON CONFLICT DO UPDATE` et non `INSERT OR REPLACE` : le second
 * supprime la ligne puis en cree une neuve, ce qui change son `id` a chaque
 * resynchronisation. Un identifiant qui bouge tout seul casse tout ce qui
 * pourrait un jour pointer dessus.
 */
export function poserMesure({ date, ts = null, source, cle, valeur = null,
                              texte = null, unite = null, userId = OWNER }) {
  const info = db.prepare(`
    INSERT INTO mesures(user_id, date, ts, source, cle, valeur, texte, unite, recu_le)
    VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id, source, date, cle) DO UPDATE SET
      ts = excluded.ts, valeur = excluded.valeur, texte = excluded.texte,
      unite = excluded.unite, recu_le = excluded.recu_le
  `).run(userId, date, ts, source, cle, valeur, texte, unite, new Date().toISOString());
  return info.changes > 0;
}

/** Toutes les mesures numériques : ce que la recherche de liens croise avec les notes. */
export const toutesMesures = (userId = OWNER) => db.prepare(
  'SELECT date, source, cle, valeur, unite FROM mesures WHERE user_id = ? AND valeur IS NOT NULL ORDER BY date ASC'
).all(userId);

/**
 * DE QUOI SAVOIR SI LE CALCUL DES LIENS EST PERIME, EN UNE REQUETE.
 *
 * Il croise toute la base contre tout le journal ; le refaire à chaque
 * ouverture d'une journée, alors qu'on en feuillette vingt d'affilée, est du
 * travail jeté. Un simple compte ne suffit pas : une application de suivi
 * REMPLACE une valeur sans changer le nombre de lignes, et le lien resterait
 * calculé sur l'ancienne. On y joint donc la date de réception la plus récente.
 */
export const signatureQS = (userId = OWNER) => {
  const m = db.prepare(
    'SELECT COUNT(*) n, MAX(recu_le) dernier FROM mesures WHERE user_id = ?'
  ).get(userId);
  const e = db.prepare(
    'SELECT COUNT(*) n, MAX(date) dernier FROM entries WHERE user_id = ? AND note IS NOT NULL'
  ).get(userId);
  return `${m.n}:${m.dernier ?? ''}:${e.n}:${e.dernier ?? ''}`;
};

export const mesuresDuJour = (date, userId = OWNER) => db.prepare(
  'SELECT source, cle, valeur, texte, unite, ts FROM mesures WHERE user_id = ? AND date = ? ORDER BY cle ASC'
).all(userId, date);

export const mesuresEntre = (debut, fin, userId = OWNER) => db.prepare(
  'SELECT date, source, cle, valeur, texte, unite FROM mesures WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC, cle ASC'
).all(userId, debut, fin);

/**
 * L'INVENTAIRE : une ligne par serie recue, avec de quoi juger si elle est
 * saine. Le compte, l'etendue, la derniere valeur et la derniere date.
 *
 * C'est ce que l'onglet montre en premier, avant le journal : une serie qui
 * s'appelle `pas` et une autre `Pas (jour)` sautent aux yeux ici, alors
 * qu'elles se noient dans une liste d'envois.
 */
export const inventaireMesures = (userId = OWNER) => db.prepare(`
  SELECT source, cle, unite, COUNT(*) n,
         MIN(date) depuis, MAX(date) jusqu_au,
         AVG(valeur) moyenne, MIN(valeur) bas, MAX(valeur) haut,
         SUM(CASE WHEN valeur IS NULL THEN 1 ELSE 0 END) sansNombre
  FROM mesures WHERE user_id = ?
  GROUP BY source, cle
  ORDER BY n DESC, cle ASC
`).all(userId);

/** La derniere valeur connue d'une serie -- celle qu'on affiche a cote de son nom. */
export const derniereMesure = (source, cle, userId = OWNER) => db.prepare(
  'SELECT date, valeur, texte, unite FROM mesures WHERE user_id = ? AND source = ? AND cle = ? ORDER BY date DESC LIMIT 1'
).get(userId, source, cle) ?? null;

/** Retirer une serie entiere : une integration ratee doit pouvoir s'annuler. */
export const oublierMesure = (source, cle, userId = OWNER) =>
  db.prepare('DELETE FROM mesures WHERE user_id = ? AND source = ? AND cle = ?').run(userId, source, cle).changes;

export function noterEnvoi({ source = null, statut, recues = 0, gardees = 0,
                             refus = null, apercu = null, userId = OWNER }) {
  db.prepare(`
    INSERT INTO qs_journal(user_id, quand, source, statut, recues, gardees, refus, apercu)
    VALUES(?,?,?,?,?,?,?,?)
  `).run(userId, new Date().toISOString(), source, statut, recues, gardees, refus, apercu);
  // On taille a chaque ecriture plutot qu'a l'ouverture de l'onglet : une
  // application qui envoie toutes les cinq minutes remplirait la table entre
  // deux visites, et c'est justement celle qu'on n'ouvre jamais.
  db.prepare(`
    DELETE FROM qs_journal WHERE user_id = ? AND id NOT IN (
      SELECT id FROM qs_journal WHERE user_id = ? ORDER BY id DESC LIMIT ?
    )
  `).run(userId, userId, JOURNAL_QS);
}

export const journalQS = (userId = OWNER, limite = JOURNAL_QS) => db.prepare(
  'SELECT id, quand, source, statut, recues, gardees, refus, apercu FROM qs_journal WHERE user_id = ? ORDER BY id DESC LIMIT ?'
).all(userId, limite);

export const viderJournalQS = (userId = OWNER) =>
  db.prepare('DELETE FROM qs_journal WHERE user_id = ?').run(userId).changes;

/* ---------- journal d'activité (Machi Tool) ---------- */

/**
 * Range le digest d'un jour, en REMPLAÇANT celui qui existait.
 *
 * Machi Tool renvoie la même journée plusieurs fois — elle grossit au fil des
 * heures — et c'est la dernière version qui compte. La clé (personne, jour) le
 * garantit : le second envoi écrase le premier, il n'empile pas.
 */
export function poserActiviteJour(userId, date, digest) {
  db.prepare(`
    INSERT INTO activite_jours(user_id, date, recu_le, digest)
    VALUES(?,?,?,?)
    ON CONFLICT(user_id, date) DO UPDATE SET
      recu_le = excluded.recu_le, digest = excluded.digest
  `).run(userId, date, new Date().toISOString(), JSON.stringify(digest));
}

/** Les derniers jours d'activité, du plus récent au plus ancien, digest déjà relu. */
export const activiteJours = (userId = OWNER, limite = 120) =>
  db.prepare(
    'SELECT date, recu_le, digest FROM activite_jours WHERE user_id = ? ORDER BY date DESC LIMIT ?'
  ).all(userId, limite).map(r => {
    let d = null;
    try { d = JSON.parse(r.digest); } catch { d = null; }
    return { date: r.date, recu_le: r.recu_le, digest: d };
  });

/* ---------- séances ---------- */

export const allSeances = (userId = OWNER) => db.prepare(
  'SELECT id, date, praticien, apporter FROM seances WHERE user_id = ? ORDER BY date DESC'
).all(userId);

/**
 * La seance qui precede une date -- le debut de l'intervalle a raconter.
 *
 * Strictement anterieure : le jour meme d'une seance, l'intervalle a rapporter
 * est celui qui vient de se terminer, pas un intervalle vide qui commencerait a
 * l'instant. Quelqu'un qui prepare son compte rendu le matin du rendez-vous
 * doit y trouver les six dernieres semaines, pas zero jour.
 */
export const seanceAvant = (date, userId = OWNER) => db.prepare(
  'SELECT id, date, praticien, apporter FROM seances WHERE user_id = ? AND date < ? ORDER BY date DESC LIMIT 1'
).get(userId, date) ?? null;

export function addSeance({ date, praticien = null, apporter = null, userId = OWNER }) {
  const info = db.prepare(
    'INSERT INTO seances(user_id, date, praticien, apporter, cree_le) VALUES(?,?,?,?,?)'
  ).run(userId, date, praticien || null, apporter || null, new Date().toISOString());
  return { id: Number(info.lastInsertRowid), date, praticien: praticien || null, apporter: apporter || null };
}

export function updateSeance(id, patch, userId = OWNER) {
  const cols = ['date', 'praticien', 'apporter'].filter(k => k in patch);
  if (!cols.length) return null;
  db.prepare(`UPDATE seances SET ${cols.map(c => `${c} = ?`).join(', ')} WHERE id = ? AND user_id = ?`)
    .run(...cols.map(c => patch[c] || null), id, userId);
  return db.prepare('SELECT id, date, praticien, apporter FROM seances WHERE id = ? AND user_id = ?').get(id, userId) ?? null;
}

export const deleteSeance = (id, userId = OWNER) =>
  db.prepare('DELETE FROM seances WHERE id = ? AND user_id = ?').run(id, userId).changes > 0;

/* ---------- anchors ---------- */

export function allAnchors(userId = OWNER) {
  return db.prepare('SELECT note, label, descr FROM anchors WHERE user_id = ? ORDER BY note DESC').all(userId);
}
export function setAnchor(note, label, descr, userId = OWNER) {
  db.prepare(`
    INSERT INTO anchors(user_id, note, label, descr) VALUES(?,?,?,?)
    ON CONFLICT(user_id, note) DO UPDATE SET label = excluded.label, descr = excluded.descr
  `).run(userId, note, label, descr);
}
