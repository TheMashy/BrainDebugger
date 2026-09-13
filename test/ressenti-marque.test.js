/**
 * =====================================================================
 *  UN RELEVÉ EST UN INSTANT, PAS UN BILAN DE SOIRÉE.
 *
 * L'écran affichait « 6/10 » après la bulle. Le chiffre est juste et la
 * lecture est fausse : sans heure, il se lit comme une note de journée — la
 * seule chose que ce relevé n'est pas. Ce qu'il mesure, c'est l'ÉCART d'une
 * heure à l'autre ; deux relevés dans la même soirée disent à quelle vitesse
 * ça bouge, et c'est précisément ce qu'une note de fin de journée efface.
 *
 * L'heure était jetée en chemin : le serveur la lit dans la base et ne la
 * mettait pas dans ce qu'il envoie. Ces gardes tiennent le chemin ENTIER —
 * base, route, page — parce que c'est un chemin qui s'était déjà cassé au
 * milieu sans que rien ne le dise.
 * =====================================================================
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-rmarq-')), 'test.db');
const { OWNER, addMessage, addReleve, relevesDeToi } = await import('../server/db.js');
const { routes } = await import('../server/api.js');

const AUJ = new Date().toISOString().slice(0, 10);
const A = '2026-03-01T21:06:00.000Z';

const idMsg = addMessage({ ts: A, date: AUJ, source: 'web', role: 'pet',
                           text: 'Et là, comment tu te sens ?', userId: OWNER });
addReleve({ messageId: idMsg, date: AUJ, quand: A, valeur: 6, quoi: null, source: 'toi', userId: OWNER });

test('LA BASE GARDE L’HEURE DU RELEVÉ', () => {
  const [r] = relevesDeToi([idMsg], OWNER);
  assert.ok(r, 'le relevé n’est pas relu');
  assert.equal(r.ts, A);
});

test('LA ROUTE LA TRANSMET — c’est ici qu’elle se perdait', async () => {
  /*
   * `/api/state` mappait `r => ({ message_id, valeur })` : l'heure existait
   * dans la base, était lue par la requête, et tombait sur cette ligne-là.
   * La page ne pouvait donc afficher qu'un chiffre nu, et aucun test ne
   * regardait ce que la route mettait dedans.
   */
  const s = await routes['GET /api/state']({ query: {}, userId: OWNER });
  const r = (s.ressentis ?? []).find(x => Number(x.message_id) === Number(idMsg));
  assert.ok(r, 'le relevé ne voyage pas avec le fil');
  assert.equal(r.valeur, 6);
  assert.equal(r.ts, A, 'la route jette l’heure : l’écran ne peut plus dire « à cet instant »');
});

test('LA PAGE MARQUE L’INSTANT, PAS SEULEMENT LA VALEUR', () => {
  /*
   * On lit le source parce que c'est un rendu de chaîne sans DOM ici. Ce qu'on
   * garde : que la marque appelle bien l'heure. Une marque qui n'affiche que
   * le chiffre repasserait pour une note de journée.
   */
  const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  const i = src.indexOf('function marqueRessenti');
  assert.ok(i > 0, 'la marque n’existe plus sous ce nom');
  const corps = src.slice(i, src.indexOf('\n}', i));
  assert.match(corps, /fmtTime\(/, 'la marque n’affiche pas d’heure : elle se lira comme un bilan');
  assert.match(corps, /noteScaleColor\(/, 'la marque n’est pas dans la couleur de la note');
  // Le point PLEIN, c'est la règle de la volatilité : posé par la personne.
  assert.match(corps, /class="rpt"/, 'le point posé par la personne a disparu');
});

test('LE MAGASIN DE LA PAGE PORTE L’HEURE, PAS UN NOMBRE NU', () => {
  // La régression exacte : `[Number(r.message_id), r.valeur]`. Un nombre nu
  // remonterait ici sans casser l'affichage du chiffre — juste l'heure.
  const src = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  for (const [, quoi] of src.matchAll(/ressentis \?\? \[\]\)\.map\(r => \[Number\(r\.message_id\), ([^\]]+)\]/g)) {
    assert.equal(quoi.trim(), 'releve(r)',
      `un chargement des ressentis range « ${quoi.trim()} » : l’heure est perdue au chargement`);
  }
  assert.match(src, /const releve = r => \(\{ valeur: Number\(r\.valeur\), ts: r\.ts/,
    'le magasin ne construit plus { valeur, ts }');
});
