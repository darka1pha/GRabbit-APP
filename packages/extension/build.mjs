import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, 'src');
const distDir = join(__dirname, 'dist');
const firefoxDistDir = join(__dirname, 'dist-firefox');

console.log('[GRabbit Extension Build] Starting esbuild...');

for (const dir of [distDir, firefoxDistDir]) {
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true });
  }
  mkdirSync(dir, { recursive: true });
}

const staticFiles = [
  ['content/styles.css', 'content/styles.css'],
  ['popup/index.html', 'popup/index.html'],
  ['popup/styles.css', 'popup/styles.css'],
  ['options/index.html', 'options/index.html'],
  ['options/styles.css', 'options/styles.css'],
];

const entries = [
  'background/index.ts',
  'content/index.ts',
  'popup/index.ts',
  'options/index.ts',
];

await esbuild.build({
  entryPoints: entries.map((e) => join(srcDir, e)),
  outdir: distDir,
  outbase: srcDir,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome120', 'firefox121'],
  sourcemap: false,
  logLevel: 'silent',
});

for (const entry of entries) {
  console.log(`  ✓ Bundled ${entry} -> ${entry.replace(/\.ts$/, '.js')}`);
}

for (const [src, dest] of staticFiles) {
  const fullSrc = join(srcDir, src);
  const fullDest = join(distDir, dest);
  mkdirSync(dirname(fullDest), { recursive: true });
  cpSync(fullSrc, fullDest);
}
cpSync(join(__dirname, 'icons'), join(distDir, 'icons'), { recursive: true });

// Chrome MV3 manifest
const baseManifest = JSON.parse(readFileSync(join(__dirname, 'manifest.json'), 'utf8'));
writeFileSync(join(distDir, 'manifest.json'), JSON.stringify(baseManifest, null, 2) + '\n', 'utf8');

// Firefox MV3 build (uses background.scripts for broad Firefox 109+ compatibility)
cpSync(distDir, firefoxDistDir, { recursive: true });
const firefoxManifest = {
  ...baseManifest,
  background: {
    scripts: ['background/index.js'],
    type: 'module',
  },
};
writeFileSync(join(firefoxDistDir, 'manifest.json'), JSON.stringify(firefoxManifest, null, 2) + '\n', 'utf8');

console.log('[GRabbit Extension Build] Build complete! Chrome -> dist/, Firefox -> dist-firefox/');
