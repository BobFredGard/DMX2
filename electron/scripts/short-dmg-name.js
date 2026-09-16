// Copie le DMG buildé par electron-builder vers le nom court permanent :
//   LumiDMX-1.2.0-arm64.dmg  ->  LumiDMX-1.2.dmg
// Le ".0" final est retiré uniquement quand le patch vaut 0
// (1.2.0 -> 1.2, mais 1.2.1 -> 1.2.1). Suit donc les changements de version.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const product = pkg.build.productName;
const full = pkg.version;
const short = full.replace(/\.0$/, '');

const dist = path.join(root, 'dist');
const src = fs.readdirSync(dist).find((f) => f.startsWith(`${product}-${full}-`) && f.endsWith('.dmg'));
if (!src) {
    console.error(`DMG source introuvable dans dist/ pour la version ${full}`);
    process.exit(1);
}
const dest = `${product}-${short}.dmg`;
fs.copyFileSync(path.join(dist, src), path.join(dist, dest));
console.log(`${src} -> ${dest}`);
