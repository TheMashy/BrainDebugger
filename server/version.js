/**
 * CE QUI TOURNE — LU UNE FOIS, AU DÉMARRAGE.
 *
 * « Est-ce que le site est à jour ? » n'avait aucune réponse vérifiable de
 * l'extérieur : la sonde de santé ne disait que `{ok: true}`. Un déploiement
 * qui n'est pas parti, un déploiement en échec et un cache de navigateur se
 * ressemblent tous les trois depuis un écran, et il fallait deviner.
 *
 * Ce module vit à part parce qu'`index.js` ouvre un serveur dès qu'on
 * l'importe : mettre ces trois valeurs là-dedans rendrait impossible de les
 * vérifier sans laisser une écoute derrière soi.
 */
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/*
 * Railway pose le commit déployé dans l'environnement ; les autres hébergeurs
 * ont chacun le leur, et en local il n'y en a aucun. On prend le premier qui
 * répond et on le coupe à SEPT caractères — la longueur qu'on compare à l'œil
 * avec la dernière ligne de `git log`. « inconnu » est une réponse honnête
 * quand personne ne le dit, et plus honnête qu'un commit inventé.
 */
export function commitDeploye(env = process.env) {
  const brut = env.RAILWAY_GIT_COMMIT_SHA ?? env.SOURCE_COMMIT
            ?? env.GIT_COMMIT ?? env.VERCEL_GIT_COMMIT_SHA ?? '';
  return String(brut).trim().slice(0, 7) || 'inconnu';
}

export async function versionDuPaquet(racine = ROOT) {
  try {
    return JSON.parse(await readFile(join(racine, 'package.json'), 'utf8')).version ?? '0.0.0';
  } catch {
    // Pas de package.json lisible : la version reste par défaut plutôt que de
    // faire tomber le démarrage pour un champ d'affichage.
    return '0.0.0';
  }
}

/** Quand ce processus a démarré. Un redéploiement remet la pendule à zéro. */
export const DEMARRE_LE = new Date().toISOString();
