/**
 * Les repères, côté serveur : poser, MODIFIER, et ne pas écraser un choix.
 *
 * Sans le chemin de modification, corriger une date se faisait en supprimant le
 * repère et en le reposant — sur le fait le plus lourd d'une frise, avec un
 * « × » comme première étape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-repapi-')), 'test.db');

const { OWNER } = await import('../server/db.js');
const api = await import('../server/api.js');

const poser = body => api.routes['POST /api/events']({ body, userId: OWNER });
const trouver = (r, label) => r.events.find(e => e.label === label);

test('un repère posé sans thème garde un thème NULL en base', () => {
  // « NULL = déduit du libellé ». Y écrire le thème déduit fige l'icône, et
  // renommer le repère ne la ferait plus suivre.
  const r = poser({ date: '2024-03-02', label: 'déménagement à Lyon' });
  const e = trouver(r, 'déménagement à Lyon');
  assert.equal(e.theme, 'maison');           // rendu déduit
  const brut = api.routes['GET /api/events']({ userId: OWNER });
  assert.equal(brut.events.find(x => x.id === e.id).theme, null);   // stocké NULL
});

test('un thème choisi survit à la relecture', () => {
  // Le rendu appliquait themeDe(label) sans regarder la colonne : on pouvait
  // changer l'icône, le serveur l'enregistrait, et elle revenait au
  // rechargement suivant sans que rien ne le signale.
  const r = poser({ date: '2024-04-02', label: 'déménagement à Nantes', theme: 'crise' });
  assert.equal(trouver(r, 'déménagement à Nantes').theme, 'crise');
  const relu = api.routes['GET /api/series']({ userId: OWNER });
  assert.equal(relu.events.find(e => e.label === 'déménagement à Nantes').theme, 'crise');
});

test('on modifie un repère au lieu de le supprimer', () => {
  const id = trouver(poser({ date: '2024-05-02', label: 'contrat' }), 'contrat').id;
  const r = poser({ id, date: '2020-01-15', fin: '2022-06-30', label: 'contrat',
                    theme: 'travail', teinte: 310 });
  const e = r.events.find(x => x.id === id);
  assert.deepEqual([e.date, e.fin, e.theme, e.teinte], ['2020-01-15', '2022-06-30', 'travail', 310]);
  assert.equal(r.events.filter(x => x.label === 'contrat').length, 1, 'aucun doublon créé');
});

test('un identifiant deviné ne modifie pas le repère de quelqu’un d’autre', () => {
  const id = trouver(poser({ date: '2024-06-02', label: 'à moi' }), 'à moi').id;
  const r = api.routes['POST /api/events']({
    body: { id, date: '1999-01-01', label: 'volé' }, userId: 'quelqu-un-dautre' });
  assert.ok(r.error, 'la modification aurait dû être refusée');
  const apres = api.routes['GET /api/events']({ userId: OWNER });
  assert.equal(apres.events.find(x => x.id === id).label, 'à moi');
});

test('les dates invalides sont refusées à l’écriture', () => {
  // « 0202-04-12 » est une faute de frappe banale sur un champ date, et elle
  // donne un domaine de six cent mille jours où le journal fait deux pixels.
  assert.ok(poser({ date: 'lol', label: 'x' }).error);
  assert.ok(poser({ date: '2024-01-01', fin: '2023-01-01', label: 'x' }).error);
  assert.ok(poser({ date: '2024-01-01', label: 'x', teinte: 42 }).error);
});
