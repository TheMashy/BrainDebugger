/**
 * Fait lire les vingt journaux par le vrai modèle, plusieurs fois chacun.
 *
 *   ANTHROPIC_API_KEY=… node tools/banc-carte/tisser.mjs [relectures]
 *
 * Il envoie `requeteLecture()` — la requête EXACTE que le produit envoie, avec
 * son prompt système, son outil forcé, son effort et son cache — et range le
 * BRUT de l'appel d'outil dans `lectures/<id>-r<k>.json`.
 *
 * LE BRUT, ET PAS LA LECTURE VALIDÉE. `lire()` rend le résultat de `valider()`,
 * et c'est le bon comportement pour le produit. Ici ce serait une mesure
 * perdue : `validerPistes()` retire un nœud à toute piste qui le réclame en
 * second, donc mesurer le recouvrement après validation rendrait toujours zéro.
 * On garde le brut ; `mesurer.mjs` fait passer la validation lui-même, et
 * compare les deux.
 *
 * TROIS LECTURES PAR JOURNAL, par défaut. Une seule ne dit rien de la
 * stabilité, et la stabilité est la première des cinq questions. Elles partent
 * en parallèle par petits paquets — la lecture est le plus gros appel du
 * produit, soixante à quatre-vingt mille jetons d'entrée, et vingt en même
 * temps se font limiter.
 *
 * CE QUE ÇA COÛTE. Vingt journaux de deux à quarante mille signes, trois fois.
 * Ce n'est pas un test qu'on lance à chaque commit : c'est une mesure qu'on
 * refait quand on touche au prompt, à la validation, ou à la carte.
 */
import fs from 'node:fs';
import path from 'node:path';
import { requeteLecture } from '../../server/lecture.js';
import { getSettings } from '../../server/db.js';
import { resolveKey, repliServeur } from '../../server/chat.js';

const ICI = path.dirname(new URL(import.meta.url).pathname);
const JOURNAUX = path.join(ICI, 'journaux');
const VERS = process.env.BANC_LECTURES || path.join(ICI, 'lectures');
const RELECTURES = Number(process.argv[2] || 3);
const FRONT = 4;   // combien d'appels en vol à la fois

if (!fs.existsSync(path.join(JOURNAUX, 'index.json')))
  throw new Error('Lance d’abord : node tools/banc-carte/consigne.mjs');
const index = JSON.parse(fs.readFileSync(path.join(JOURNAUX, 'index.json'), 'utf8'));

/*
 * Les réglages du produit, clé comprise — la même résolution qu'en production
 * (base d'abord, puis ANTHROPIC_API_KEY). Le banc n'a pas sa propre façon
 * d'aller chercher une clé : il n'y en aurait qu'une de trop à maintenir, et
 * elle finirait par diverger de celle qui compte.
 */
let settings;
try { settings = getSettings(); }
catch { settings = {}; }        // pas de base ici : l'environnement suffira
const { key, source } = resolveKey(settings);
if (!key) throw new Error('Pas de clé API. Définis ANTHROPIC_API_KEY, ou lance le serveur une fois pour la ranger en base.');
console.log(`clé : ${source} · modèle : ${settings.anthropicModel || 'claude-opus-5'} · ${RELECTURES} lectures par journal`);

const { default: Anthropic } = await import('@anthropic-ai/sdk');
const client = new Anthropic({ apiKey: key });
fs.mkdirSync(VERS, { recursive: true });

const travaux = [];
for (const j of index)
  for (let k = 1; k <= RELECTURES; k++)
    travaux.push({ j, k, vers: path.join(VERS, `${j.id}-r${k}.json`) });

let faits = 0, sautes = 0, rates = 0;

async function une({ j, k, vers }) {
  if (fs.existsSync(vers)) { sautes++; return; }
  const texte = fs.readFileSync(path.join(JOURNAUX, j.id + '.txt'), 'utf8');
  /* `corpusPour()` rend bien d'autres blocs — notes, repères, mesures — mais un
     journal de banc n'en a aucun. On lui donne donc le corpus tel quel, avec ses
     dates et son étendue, ce qui est tout ce que `requeteLecture` en lit. */
  const corpus = { texte, dates: new Set(j.dates), jours: j.jours, etendue: j.jours,
                   comparaisons: [], precedente: null, lignes: null };
  try {
    const res = await client.beta.messages.create({
      ...repliServeur(settings.anthropicModel || 'claude-opus-5'),
      ...requeteLecture(corpus, settings)
    });
    const appel = res?.content?.find(b => b.type === 'tool_use');
    if (!appel) throw new Error("rien d'exploitable");
    fs.writeFileSync(vers, JSON.stringify(appel.input, null, 2));
    faits++;
    const u = res.usage ?? {};
    console.log(`${j.id}·r${k} — ${appel.input?.carte?.noeuds?.length ?? 0} nœuds, `
      + `${appel.input?.pistes?.length ?? 0} pistes · ${u.input_tokens ?? 0}+${u.cache_read_input_tokens ?? 0}c `
      + `→ ${u.output_tokens ?? 0}`);
  } catch (e) {
    rates++;
    console.log(`${j.id}·r${k} — ÉCHEC : ${e.message}`);
  }
}

/* Un front de quatre : on relance dès qu'une place se libère, plutôt que par
   vagues — une vague attend son plus lent, et le plus lent ici est un journal
   de quarante mille signes. */
const file = travaux.slice();
await Promise.all(Array.from({ length: FRONT }, async () => {
  for (let t = file.shift(); t; t = file.shift()) await une(t);
}));

console.log(`\n${faits} écrites, ${sautes} déjà là, ${rates} en échec → ${VERS}`);
if (rates) process.exitCode = 1;
