/**
 * LE COMPTE RENDU POUR LE PRATICIEN.
 *
 * Trois choses se testent, et la troisième est la plus importante :
 *
 *   — le DÉCOUPAGE. « Depuis la dernière fois » est la question de la séance,
 *     et un intervalle mal borné rend tout le reste faux sans le dire.
 *   — les CHIFFRES : médiane, extrêmes, comparaison avec l'intervalle
 *     précédent. Ils sont calculés, jamais rédigés — donc vérifiables.
 *   — la LIMITE. Le produit reconnaît des motifs, il ne nomme pas de trouble.
 *     Ce que la machine écrit d'elle-même ne contient aucune étiquette
 *     clinique, et c'est un test, pas une intention.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-cr-')), 'test.db');

const {
  OWNER, setNote, setAnchor, addEvent, addMotif, marquerMotif, addMessage,
  allSeances, addSeance, updateSeance, deleteSeance, seanceAvant, motifsEntre
} = await import('../server/db.js');
const CR = await import('../server/compte-rendu.js');
const api = await import('../server/api.js');

const notes = liste => liste.map(([date, note]) => ({ date, note, text: '' }));

/* ============ LE DÉCOUPAGE ============ */

test('l’intervalle va de la séance précédente à celle qu’on prépare', () => {
  const iv = CR.intervalle([{ date: '2026-06-01' }, { date: '2026-07-15' }], '2026-08-01');
  assert.equal(iv.debut, '2026-07-15');
  assert.equal(iv.fin, '2026-08-01');
  assert.equal(iv.precedente, '2026-07-15');
});

test('LE JOUR MÊME D’UNE SÉANCE, on rapporte l’intervalle qui vient de finir', () => {
  // Quelqu'un qui prépare son compte rendu le matin du rendez-vous doit y
  // trouver les six dernières semaines, pas zéro jour.
  const iv = CR.intervalle([{ date: '2026-07-15' }, { date: '2026-08-01' }], '2026-08-01');
  assert.equal(iv.debut, '2026-07-15', 'la séance du jour s’est prise elle-même pour borne');
  assert.ok(iv.jours > 1);
});

test('sans séance précédente, la période couvre tout le journal', () => {
  // Le premier compte rendu est un état des lieux. Le couper à trente jours
  // ferait disparaître ce qui a amené la personne à consulter.
  const iv = CR.intervalle([], '2026-08-01', '2024-01-10');
  assert.equal(iv.debut, '2024-01-10');
  assert.equal(iv.precedente, null);
});

test('une séance future ne borne rien', () => {
  const iv = CR.intervalle([{ date: '2026-09-01' }], '2026-08-01', '2026-01-01');
  assert.equal(iv.debut, '2026-01-01');
});

/* ============ L'AMPLITUDE ============ */

test('la médiane et non la moyenne — une journée à 1 ne tire pas la ligne', () => {
  const a = CR.amplitudeDe(notes([
    ['2026-01-01', 1], ['2026-01-02', 6], ['2026-01-03', 6], ['2026-01-04', 7], ['2026-01-05', 6]
  ]));
  assert.equal(a.mediane, 6);
  assert.equal(a.min, 1);
  assert.equal(a.max, 7);
});

test('les extrêmes sont datés, parce que c’est là qu’ils ont un sens', () => {
  const a = CR.amplitudeDe(notes([['2026-01-01', 2], ['2026-01-02', 9], ['2026-01-03', 5]]));
  assert.equal(a.creux[0].date, '2026-01-01');
  assert.equal(a.pics[0].date, '2026-01-02');
});

test('les journées sous l’ancre basse sont comptées, avec les mots de la personne', () => {
  const a = CR.amplitudeDe(
    notes([['2026-01-01', 2], ['2026-01-02', 3], ['2026-01-03', 8]]),
    [{ note: 3, label: 'Bas', descr: 'Je tiens, mais je compte les heures' },
     { note: 8, label: 'Good', descr: 'Chill' }]
  );
  assert.equal(a.sousPlancher, 2);
  assert.equal(a.surPlafond, 1);
  assert.equal(a.ancres[0].label, 'Bas');
});

test('aucune journée notée : pas d’amplitude inventée', () => {
  assert.equal(CR.amplitudeDe([]), null);
  assert.equal(CR.amplitudeDe([{ date: '2026-01-01', note: null }]), null);
});

/* ============ LA COMPARAISON ============ */

test('l’évolution se refuse sous cinq journées de part et d’autre', () => {
  // Une comparaison sur trois journées écrites se lirait comme une tendance et
  // n'en est pas une.
  const petit = CR.amplitudeDe(notes([['2026-01-01', 5], ['2026-01-02', 5]]));
  const grand = CR.amplitudeDe(notes(
    Array.from({ length: 8 }, (_, i) => [`2026-02-0${i + 1}`, 6])));
  assert.equal(CR.evolution(petit, grand), null);
  assert.equal(CR.evolution(grand, petit), null);
});

test('l’évolution dit le sens, et compte aussi les journées écrites', () => {
  const avant = CR.amplitudeDe(notes(Array.from({ length: 8 }, (_, i) => [`2026-01-0${i + 1}`, 4])));
  const apres = CR.amplitudeDe(notes(Array.from({ length: 6 }, (_, i) => [`2026-02-0${i + 1}`, 7])));
  const e = CR.evolution(apres, avant);
  assert.equal(e.sens, 'haut');
  assert.equal(e.mediane, 3);
  // Arrêter d'écrire est souvent le premier signe, avant que les notes ne
  // baissent : le compte se lit à côté de la médiane, jamais à sa place.
  assert.equal(e.ecrites, -2);
});

test('un écart de moins d’un demi-point est « stable », pas une tendance', () => {
  const a = CR.amplitudeDe(notes(Array.from({ length: 6 }, (_, i) => [`2026-01-0${i + 1}`, 6])));
  const b = CR.amplitudeDe(notes(Array.from({ length: 6 }, (_, i) => [`2026-02-0${i + 1}`, 6])));
  assert.equal(CR.evolution(a, b).sens, 'stable');
});

/* ============ LES FAITS ============ */

test('UNE PÉRIODE QUI TRAVERSE L’INTERVALLE EST UN FAIT DE L’INTERVALLE', () => {
  // Une addiction commencée il y a deux ans et toujours en cours est même
  // souvent le fait principal. La filtrer sur sa seule date de début l'aurait
  // fait disparaître de tous les comptes rendus sauf le premier.
  const f = CR.faitsDe([
    { id: 1, date: '2024-01-01', fin: null, ouvert: 1, label: 'consommation quotidienne' },
    { id: 2, date: '2026-07-20', fin: null, label: 'arrêt du traitement' },
    { id: 3, date: '2020-01-01', fin: '2020-06-01', label: 'vieux contrat' }
  ], '2026-07-01', '2026-08-01');
  const labels = f.map(x => x.label);
  assert.ok(labels.includes('consommation quotidienne'));
  assert.ok(labels.includes('arrêt du traitement'));
  assert.equal(labels.includes('vieux contrat'), false, 'un fait bien antérieur est ressorti');
});

test('« posé sur la période » se distingue de « en cours depuis avant »', () => {
  const f = CR.faitsDe([
    { id: 1, date: '2024-01-01', ouvert: 1, label: 'ancien' },
    { id: 2, date: '2026-07-20', label: 'récent' }
  ], '2026-07-01', '2026-08-01');
  assert.equal(f.find(x => x.label === 'ancien').nouveau, false);
  assert.equal(f.find(x => x.label === 'récent').nouveau, true);
});

test('la liste des faits est bornée : un mur ne se lit pas en consultation', () => {
  const beaucoup = Array.from({ length: 40 }, (_, i) => ({ id: i, date: '2026-07-10', label: `f${i}` }));
  assert.equal(CR.faitsDe(beaucoup, '2026-07-01', '2026-08-01').length, CR.MAX_FAITS);
});

/* ============ LA LIMITE — CE QUE LA MACHINE N'ÉCRIT JAMAIS ============ */

test('AUCUNE ÉTIQUETTE CLINIQUE DANS CE QUE LE MODULE ÉCRIT DE LUI-MÊME', () => {
  // Poser un mot clinique sur quelqu'un est un acte médical, et il se fait dans
  // la pièce. Le module cite ; il ne nomme pas.
  const src = readFileSync(new URL('../server/compte-rendu.js', import.meta.url), 'utf8');
  // Les COMMENTAIRES tombent d'abord : ils parlent de la règle, et ils ont le
  // droit de nommer ce qu'ils interdisent. Ne restent que le code et ses
  // chaînes — c'est-à-dire ce qui peut arriver jusqu'à un écran.
  // AVERTISSEMENT est l'exception nommée, et la seule : nier un diagnostic
  // n'est pas en poser un. Sans repère unique, la seule façon de laisser passer
  // la négation serait de retirer le mot de la liste des interdits.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ')
                  .replace(/export const AVERTISSEMENT[\s\S]*?;\n/, ' ');
  const chaines = [...code.matchAll(/'([^'\\\n]{3,})'|`([^`\\$]{3,})`/g)]
    .map(m => (m[1] ?? m[2]).toLowerCase())
    .filter(t => !CR.SANS_DIAGNOSTIC.includes(t));      // la liste elle-même
  for (const mot of CR.SANS_DIAGNOSTIC) {
    const fautif = chaines.find(t => t.includes(mot));
    assert.equal(fautif, undefined, `« ${mot} » sort d'une chaîne du module : « ${fautif} »`);
  }
});

test('NI DANS LA PAGE QUI L’AFFICHE — c’est elle qui arrive sous les yeux', () => {
  // Le module calcule, la page écrit les phrases. Garder le module propre et
  // laisser « rechute » dans un titre de section reviendrait à avoir vérifié la
  // moitié qui ne se lit pas.
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  /*
   * LA PAGE A ÉTÉ DÉBRANCHÉE, et ce test se réarme tout seul si elle revient.
   *
   * L'onglet « Suivi » a été retiré : le calcul et ses routes restent, la page
   * qui les affichait n'existe plus. Un test qui passerait « parce qu'il n'a
   * rien trouvé » serait exactement le genre de faux vert qu'on a déjà payé
   * ailleurs — on vérifie donc un fait VRAI AUJOURD'HUI : la vue est bien
   * débranchée. Le jour où elle revient, la première branche reprend la main
   * et le scan des étiquettes cliniques s'applique de nouveau.
   */
  const debut = app.indexOf('let SUIVI = {');
  if (debut < 0) {
    assert.equal(/renderSuivi|data-view="suivi"/.test(app), false,
                 'la vue Suivi est à moitié branchée : ni page complète, ni retrait franc');
    return;
  }
  const fin = app.indexOf('============================= routage', debut);
  assert.ok(fin > debut, 'la section Suivi de app.js est introuvable — repères déplacés ?');
  const code = app.slice(debut, fin)
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  // La page ne l'écrit plus : elle rend `r.avertissement`, qui vient du serveur.
  assert.match(code, /avertissement/, 'la page a cessé de porter la phrase qui délimite');
  for (const mot of CR.SANS_DIAGNOSTIC) {
    assert.equal(code.toLowerCase().includes(mot), false,
                 `« ${mot} » est écrit dans la page du compte rendu`);
  }
});

test('la liste des interdits couvre ce qu’un modèle sortirait spontanément', () => {
  for (const mot of ['bipolaire', 'borderline', 'dépression', 'diagnostic', 'trouble']) {
    assert.ok(CR.SANS_DIAGNOSTIC.some(x => mot.includes(x) || x.includes(mot)),
              `« ${mot} » n'est pas couvert`);
  }
});

/* ============ L'IMPRESSION : le document quitte l'écran ============ */

test('la feuille de style d’impression ne masque pas le document lui-même', () => {
  // Le piège, et il est passé une fois : `header { display: none }` masque la
  // barre de l'application ET la bannière du compte rendu — qui est un
  // <header>, et qui porte la PÉRIODE COUVERTE, la ligne la plus importante de
  // la feuille pour qui la reçoit. Elle disparaissait sans rien casser.
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  const i = css.indexOf('@media print');
  assert.ok(i > 0, 'la feuille d’impression a disparu');
  // On compte les accolades plutôt que de chercher la dernière : la règle
  // d'impression n'est la dernière du fichier que jusqu'au prochain ajout.
  const bloc = (() => {
    let n = 0;
    for (let k = css.indexOf('{', i); k < css.length; k++) {
      if (css[k] === '{') n++;
      else if (css[k] === '}' && --n === 0) return css.slice(i, k + 1);
    }
    throw new Error('bloc @media print non refermé');
  })();

  const cache = [...bloc.matchAll(/^\s*([^{}\n]+?)\s*\{[^}]*display:\s*none/gm)]
    .flatMap(m => m[1].split(',').map(x => x.trim()));
  for (const sel of cache) {
    assert.notEqual(sel, 'header', 'un `header` nu masque aussi la bannière du compte rendu');
    assert.equal(/^(article|\.cr|\.crsec|\.crtete|\.crpied|main|body)$/.test(sel), false,
                 `l'impression masque « ${sel} », qui porte le document`);
  }
  // Le fond noir n'est pas sur `body` : il est peint par le canvas de la scène.
  assert.match(bloc, /canvas/, 'le canvas de la scène n’est pas retiré à l’impression');
  // La coquille est une grille à deux colonnes : cacher le rail ne libère pas
  // sa colonne, et le document sortait dans 184 px de large.
  assert.match(bloc, /\.shell\s*\{[^}]*display:\s*block/, 'la grille de la coquille n’est pas aplatie');
});

/* ============ LES SÉANCES, EN BASE ============ */

test('une séance s’ajoute, se corrige et se retire', () => {
  const s = addSeance({ date: '2026-03-10', praticien: 'Dr M.' });
  assert.equal(allSeances(OWNER).length, 1);
  const m = updateSeance(s.id, { apporter: 'parler du sommeil' }, OWNER);
  assert.equal(m.apporter, 'parler du sommeil');
  assert.equal(m.praticien, 'Dr M.', 'corriger un champ en a effacé un autre');
  assert.equal(deleteSeance(s.id, OWNER), true);
  assert.equal(allSeances(OWNER).length, 0);
});

test('seanceAvant est STRICTEMENT antérieure', () => {
  addSeance({ date: '2026-05-01' });
  addSeance({ date: '2026-06-01' });
  assert.equal(seanceAvant('2026-06-01', OWNER).date, '2026-05-01');
  assert.equal(seanceAvant('2026-05-01', OWNER), null);
});

/* ============ BOUT EN BOUT, PAR LA ROUTE ============ */

test('la route rend un compte rendu complet et daté', () => {
  for (let i = 0; i < 40; i++) {
    const d = new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString().slice(0, 10);
    setNote(d, 4 + (i % 5));
  }
  setAnchor(3, 'Bas', 'Je tiens, mais je compte les heures');
  setAnchor(8, 'Good', 'Chill');
  addEvent({ date: '2026-06-20', label: 'arrêt du traitement' });
  const mot = addMotif({ nom: 'minimisation après coup', mecanisme: 'il referme la phrase' });
  const msg = addMessage({ ts: '2026-06-22T21:00:00Z', date: '2026-06-22', role: 'user', text: 'bref' });
  marquerMotif(mot.id, msg);

  const { rendu } = api.routes['GET /api/compte-rendu']({ query: { date: '2026-07-01' }, userId: OWNER });
  assert.equal(rendu.periode.fin, '2026-07-01');
  assert.ok(rendu.ecrites > 0);
  assert.equal(rendu.faits.some(f => f.label === 'arrêt du traitement'), true);
  assert.equal(rendu.motifs[0].nom, 'minimisation après coup');
  assert.equal(rendu.motifs[0].n, 1);
  assert.equal(rendu.assezDeMatiere, true);
});

test('un intervalle trop court ou vide se déclare sans matière', () => {
  addSeance({ date: '2026-07-01' });
  const { rendu } = api.routes['GET /api/compte-rendu']({ query: { date: '2026-07-02' }, userId: OWNER });
  assert.equal(rendu.assezDeMatiere, false,
               'deux jours ont produit un compte rendu comme si c’était un mois');
});

test('la route refuse une date qui n’en est pas une, sans planter', () => {
  const r = api.routes['GET /api/compte-rendu']({ query: { date: 'demain' }, userId: OWNER });
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('POST /api/seances refuse une date invalide', () => {
  assert.match(api.routes['POST /api/seances']({ body: { date: 'hier' }, userId: OWNER }).error, /date/);
});
