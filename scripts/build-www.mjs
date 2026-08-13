/* Copies the static site into www/ so Capacitor can bundle it into the APK.
   The site itself has no build step; this just gathers the web assets. */
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';

const OUT = 'www';
const ASSETS = [
  'index.html',
  'sw.js',
  'manifest.webmanifest',
  'css',
  'js',
  'icons',
  'models',
];

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const a of ASSETS) {
  if (existsSync(a)) {
    cpSync(a, `${OUT}/${a}`, { recursive: true });
    console.log('copied', a);
  } else {
    console.warn('skip (missing)', a);
  }
}
console.log('www built ->', OUT);
