/**
 * LES IMAGES QU'ON A MONTRÉES RESTENT DANS LE FIL.
 *
 * Demandé : « montre aussi les images qui ont été envoyées lorsqu'un
 * utilisateur en colle une ou en envoie une ». Elles partaient au compagnon et
 * disparaissaient : le fil ne gardait que « [capture.png] ».
 *
 * L'ORIGINAL ne touche toujours pas la base — le journal est un fichier qu'on
 * emporte. Le navigateur fabrique une MINIATURE, c'est elle qui reste. Ce
 * fichier tient : ce qui est gardé et ce qui est refusé, que le fil la porte
 * sans traîner de binaire, qu'elle n'est lisible que par son propriétaire,
 * qu'elle part avec son message, et qu'elle part avec l'export.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BD_DB = join(mkdtempSync(join(tmpdir(), 'bd-img-')), 'test.db');
process.env.ANTHROPIC_API_KEY = '';   // aucun appel payant : le tuyau, pas le modèle
const D = await import('../server/db.js');
const { OWNER, addMessage, recentMessages, messagesForDate, apercu, poserApercus,
        rembobiner, deleteDay, upsertUser, db } = D;
const { streamMessage, routes } = await import('../server/api.js');

const AUJ = new Date().toISOString().slice(0, 10);
// Un vrai WebP d'un pixel : ce que le navigateur envoie, en plus petit.
const WEBP = 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA';
const ORIGINAL = Buffer.alloc(3000, 7).toString('base64');

async function envoyer(body, userId = OWNER) {
  const evs = [];
  await streamMessage(body, (ev, data) => evs.push({ ev, data }), userId);
  return evs;
}

test('une image envoyée revient dans le fil, dès le premier rendu', async () => {
  const evs = await envoyer({ text: 'regarde ça', pieces: [
    { nom: 'capture.png', media: 'image/png', donnees: ORIGINAL,
      apercu: { media: 'image/webp', donnees: WEBP } }] });
  // L'événement `user` est celui qui redessine la bulle : l'image doit y être.
  const fil = evs.find(e => e.ev === 'user').data.messages;
  const m = fil.findLast(x => x.role === 'user');
  assert.equal(m.text, 'regarde ça');
  assert.equal(m.pieces?.length, 1, 'la miniature n’est pas accrochée au message');
  assert.equal(m.pieces[0].nom, 'capture.png');
  assert.ok(Number.isFinite(m.pieces[0].id));
  assert.equal('octets' in m.pieces[0], false, 'le fil ne doit pas traîner le binaire');

  const a = apercu(m.pieces[0].id, OWNER);
  assert.equal(a.media, 'image/webp');
  assert.equal(Buffer.from(a.octets).toString('base64'), WEBP, 'ce n’est pas la miniature qui a été gardée');
});

test('l’ORIGINAL ne touche jamais la base', () => {
  const tailles = db.prepare('SELECT LENGTH(octets) n FROM apercus').all().map(r => r.n);
  assert.ok(tailles.every(n => n < 3000), `un original a été stocké : ${tailles}`);
});

test('ce qui n’est pas une miniature n’est pas gardé', () => {
  const id = addMessage({ ts: new Date().toISOString(), date: AUJ, role: 'user', text: 'x', userId: OWNER });
  const n = poserApercus(id, [
    { nom: 'a', apercu: { media: 'text/html', donnees: Buffer.from('<script>').toString('base64') } },
    { nom: 'b', apercu: { media: 'image/webp', donnees: Buffer.alloc(500 * 1024).toString('base64') } },
    { nom: 'c', apercu: { media: 'image/webp', donnees: '' } },
    { nom: 'd' },
  ], OWNER);
  assert.equal(n, 0, 'un type hors image, un poids d’original ou une pièce vide ont été gardés');
});

test('un PDF, sans miniature, laisse le fil comme avant', async () => {
  const evs = await envoyer({ text: '', pieces: [
    { nom: 'ordonnance.pdf', media: 'application/pdf', donnees: ORIGINAL }] });
  const m = evs.find(e => e.ev === 'user').data.messages.findLast(x => x.role === 'user');
  assert.equal(m.text, '[ordonnance.pdf]');
  assert.equal(m.pieces, undefined);
});

test('une image n’est lisible que par son propriétaire', async () => {
  const m = recentMessages(80, OWNER).find(x => x.pieces);
  upsertUser({ id: 'autre', username: 'autre' });
  assert.equal(apercu(m.pieces[0].id, 'autre'), null);
  assert.equal(apercu(m.pieces[0].id, OWNER)?.media, 'image/webp');
});

test('la journée la porte aussi', () => {
  assert.ok(messagesForDate(AUJ, OWNER).some(m => m.pieces?.length));
});

test('elle part avec l’export', () => {
  const ex = routes['GET /api/export']({ userId: OWNER });
  assert.ok(ex.images.length >= 1);
  assert.equal(ex.images[0].base64, WEBP);
  assert.ok(ex.messages.some(m => m.id === ex.images[0].message_id));
});

test('REMBOBINER emporte l’image avec son message', async () => {
  await envoyer({ text: 'une autre', pieces: [
    { nom: 'b.png', media: 'image/png', donnees: ORIGINAL, apercu: { media: 'image/webp', donnees: WEBP } }] });
  const m = recentMessages(80, OWNER).findLast(x => x.pieces);
  rembobiner(m.id, OWNER);
  assert.equal(apercu(m.pieces[0].id, OWNER), null, 'une photo a survécu au message qui la portait');
});

test('EFFACER LA JOURNÉE emporte ses images', async () => {
  await envoyer({ text: 'encore', pieces: [
    { nom: 'c.png', media: 'image/png', donnees: ORIGINAL, apercu: { media: 'image/webp', donnees: WEBP } }] });
  const ids = recentMessages(80, OWNER).filter(x => x.pieces).flatMap(x => x.pieces.map(p => p.id));
  const jour = recentMessages(80, OWNER).findLast(x => x.pieces).date;
  deleteDay(jour, OWNER);
  for (const id of ids) assert.equal(apercu(id, OWNER), null);
});

test('la route sert des octets, marqués et privés', () => {
  const src = readFileSync(new URL('../server/index.js', import.meta.url), 'utf8');
  const i = src.indexOf("key === 'GET /api/apercu'");
  assert.ok(i > src.indexOf('auth.isAuthed(req)'), 'la route est servie avant la garde d’authentification');
  const bloc = src.slice(i, i + 800);
  assert.match(bloc, /currentUser\(req\)/);
  assert.match(bloc, /nosniff/);
  assert.match(bloc, /private/);
});

test('le mode privé floute les images, et empêche de les ouvrir', () => {
  const css = readFileSync(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.match(css, /\[data-pudique\] \.msg \.image img,\s*\[data-pudique\] \.jointe img \{ filter: blur\(18px\)/);
  assert.match(css, /\[data-pudique\] \.msg \.image \{ pointer-events: none; \}/);
});

test('l’écran dessine l’image, et tait « [nom] » quand il n’y a qu’elle', () => {
  const app = readFileSync(new URL('../web/app.js', import.meta.url), 'utf8');
  assert.match(app, /\$\{imagesMarkup\(m\)\}\$\{seulementLesNoms\(m\) \? ''/);
  assert.match(app, /\/api\/apercu\?id=\$\{encodeURIComponent\(p\.id\)\}/);
  // Et la miniature part bien avec la pièce.
  assert.match(app, /\.\.\.\(p\.apercu \? \{ apercu: p\.apercu \} : \{\}\)/);
});
