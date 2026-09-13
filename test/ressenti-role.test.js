/**
 * =====================================================================
 *  L'ÉCHELLE N'EST JAMAIS APPARUE, ET AUCUN TEST NE L'A VU.
 *
 * Le compagnon demande « comment tu te sens, là ? » et une échelle doit
 * s'ouvrir sous la bulle. Elle ne s'est jamais ouverte en production : le
 * serveur écrit ses messages avec `role: 'pet'`, et `proposerLechelle`
 * exigeait `role === 'assistant'` — un rôle que ce produit n'écrit nulle part.
 * La page cherchait la dernière prise de parole du compagnon avec le même
 * mot et ne trouvait jamais rien.
 *
 * POURQUOI LA SUITE ÉTAIT VERTE. Le décor du test l'inventait :
 * `const msg = () => ({ role: 'assistant', ... })`. Il ne testait pas le
 * produit, il testait une version du produit qui n'existe pas. Un décor qui
 * contredit la réalité ne prouve pas qu'une fonctionnalité marche — il prouve
 * qu'elle marcherait ailleurs.
 *
 * D'où ce fichier : il ne nomme AUCUN rôle en dur. Il fait écrire un message
 * par le serveur, le relit par où la page le lit, et demande à l'échelle ce
 * qu'elle en pense. Le jour où le rôle change de nom, ce test suit tout seul.
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-rrole-')), 'test.db');
const { db, OWNER, addMessage, recentMessages } = await import('../server/db.js');
const { proposerLechelle, demandeUnRessenti } = await import('../web/ressenti.js');

const AUJ = new Date().toISOString().slice(0, 10);
const QUESTION = 'Et là, maintenant, comment tu te sens ?';

/** Ce que le serveur écrit vraiment quand le compagnon répond (api.js:1872). */
function leCompagnonRepond(text) {
  return addMessage({ ts: new Date().toISOString(), date: AUJ, source: 'web',
                      role: 'pet', text, userId: OWNER });
}
function laPersonneEcrit(text) {
  return addMessage({ ts: new Date().toISOString(), date: AUJ, source: 'web',
                      role: 'user', text, userId: OWNER });
}

test('LE RÔLE QUE LE SERVEUR ÉCRIT EST CELUI QUE L’ÉCHELLE ACCEPTE', () => {
  laPersonneEcrit('soirée bizarre');
  leCompagnonRepond(QUESTION);
  // On relit par où la page relit : c'est le seul chemin qui compte.
  const fil = recentMessages(80, OWNER);
  const dernier = fil.at(-1);
  assert.equal(dernier.text, QUESTION, 'le fil ne rend pas ce qui vient d’être écrit');
  assert.equal(proposerLechelle(dernier, { dernier: true, repondus: new Set() }), true,
    `l’échelle refuse un message que le serveur vient d’écrire (rôle « ${dernier.role} ») : `
    + `elle ne s’ouvrira jamais sous une vraie question`);
});

test('AUCUN CODE NE CHERCHE UN RÔLE QUE LA BASE N’ÉCRIT PAS', () => {
  /*
   * L'AUTRE MOITIÉ DU MÊME BUG, et elle vit dans la page. Elle calculait
   *   [...messages].reverse().find(x => x.role === 'assistant')
   * et obtenait `undefined` à tous les coups : `dernier` valait donc toujours
   * faux, et l'échelle n'aurait pas paru même si `proposerLechelle` avait dit
   * oui. Corriger un seul des deux endroits n'aurait rien changé À L'ÉCRAN —
   * c'est pourquoi ce test lit le fichier plutôt que d'appeler une fonction.
   *
   * On ne compare pas à une liste de rôles écrite ici : on demande à la BASE
   * quels rôles existent. Le jour où un rôle est renommé, ce test suit.
   */
  const ROLES = new Set(db.prepare('SELECT DISTINCT role FROM messages').all().map(r => r.role));
  assert.ok(ROLES.size >= 2, 'décor trop pauvre : il faut au moins les deux rôles');

  /*
   * LE SERVEUR EST DANS LA LISTE, ET IL A FALLU SE FAIRE AVOIR POUR L'Y METTRE.
   *
   * Ce test ne lisait que `web/`. Il est passé au vert pendant que
   * `POST /api/releve` cherchait encore la dernière prise de parole du
   * compagnon avec le mauvais mot — donc la route refusait tout relevé posé
   * sur un message, en silence, exactement comme les deux autres endroits.
   *
   * Trois endroits, un seul mot faux. Un garde qui n'en couvre que deux laisse
   * la fonctionnalité cassée ET la suite verte : c'est pire que pas de garde.
   */
  for (const f of ['web/app.js', 'web/ressenti.js', 'server/api.js']) {
    const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
    for (const [, role] of src.matchAll(/\brole\s*[=!]==\s*'([a-z]+)'/g)) {
      assert.ok(ROLES.has(role),
        `${f} compare le rôle d’un message à « ${role} », que la base n’écrit jamais `
        + `(elle écrit ${[...ROLES].map(r => `« ${r} »`).join(', ')}) : ce test est toujours faux`);
    }
  }
});

test('ce qui vient de la personne ne déclenche rien, même si elle pose la question', () => {
  // La garde qui empêche la correction ci-dessus d'ouvrir l'échelle partout.
  const id = laPersonneEcrit(QUESTION);
  const m = recentMessages(80, OWNER).find(x => x.id === id);
  assert.equal(proposerLechelle(m, { dernier: true }), false,
    'l’échelle s’ouvre sous ce que la personne écrit elle-même');
});

test('la question reste reconnue pour ce qu’elle dit, pas pour qui la dit', () => {
  // Si la correction du rôle avait été faite en élargissant la reconnaissance,
  // ce test ne le verrait pas — d'où celui-ci, sur la phrase seule.
  assert.equal(demandeUnRessenti(QUESTION), true);
  assert.equal(demandeUnRessenti('Comment tu te sentais hier ?'), false);
  assert.equal(demandeUnRessenti('Je te laisse là-dessus.'), false);
});
