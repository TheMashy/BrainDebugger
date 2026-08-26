/**
 * Contrôles avant tout le reste.
 *
 * Importé en PREMIER par server/index.js : les modules ES s'évaluent dans
 * l'ordre des imports, donc ce fichier tourne avant que db.js ne tente
 * d'ouvrir `node:sqlite`. Sans ça, une version de Node trop ancienne produit
 * un « ERR_UNKNOWN_BUILTIN_MODULE » illisible dans les logs d'un hébergeur.
 */

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`
  ────────────────────────────────────────────────────────────
  NODE TROP ANCIEN

  Node ${process.versions.node} est installé ; il faut au moins 22.5.
  La base de données utilise \`node:sqlite\`, qui n'existe pas avant.

  Sur un hébergeur : fixe la version (fichier .nvmrc, ou la variable
  NIXPACKS_NODE_VERSION=22 sur Railway) puis redéploie.
  ────────────────────────────────────────────────────────────
`);
  process.exit(1);
}

/** Railway, Fly, Render, Heroku, Cloud Run — un conteneur, pas un poste de travail. */
export const PLATFORM =
  process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT ? 'Railway' :
  process.env.FLY_APP_NAME ? 'Fly.io' :
  process.env.RENDER ? 'Render' :
  process.env.DYNO ? 'Heroku' :
  process.env.K_SERVICE ? 'Cloud Run' :
  null;
