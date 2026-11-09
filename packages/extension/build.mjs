import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, 'src');
const distDir = join(__dirname, 'dist');

console.log('[gRabbit Extension Build] Starting build...');

// Clean dist
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true, force: true });
}
mkdirSync(distDir, { recursive: true });

// 1. Copy Manifest & Icons
cpSync(join(__dirname, 'manifest.json'), join(distDir, 'manifest.json'));
cpSync(join(__dirname, 'icons'), join(distDir, 'icons'), { recursive: true });

// 2. Copy Static assets (HTML, CSS)
const staticFiles = [
  ['content/styles.css', 'content/styles.css'],
  ['popup/index.html', 'popup/index.html'],
  ['popup/styles.css', 'popup/styles.css'],
  ['options/index.html', 'options/index.html'],
  ['options/styles.css', 'options/styles.css'],
];

for (const [src, dest] of staticFiles) {
  const fullSrc = join(srcDir, src);
  const fullDest = join(distDir, dest);
  mkdirSync(dirname(fullDest), { recursive: true });
  cpSync(fullSrc, fullDest);
}

// 3. Shared modules cache for inlining
const configTs = readFileSync(join(srcDir, 'shared', 'config.ts'), 'utf8')
  .replace(/import\s*\{[^}]*\}\s*from\s*['"]@grabbit\/config['"];?/, `
export const DEFAULT_RPC_PORT = 31542;
export const DEFAULT_INTERCEPTED_EXTENSIONS = [
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img',
  'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk',
  'mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'ts', 'm4v',
  'mp3', 'm4a', 'flac', 'wav', 'aac', 'ogg', 'opus',
  'pdf', 'epub', 'bin', 'torrent'
];
`)
  .replace(/import\s*type\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/g, '')
  .replace(/export\s+/g, '');

const rpcClientTs = readFileSync(join(srcDir, 'shared', 'rpc-client.ts'), 'utf8')
  .replace(/import\s*type\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/g, '')
  .replace(/export\s+class\s+ExtensionRpcClient/, 'class ExtensionRpcClient');

function bundleEntry(entryRelativePath) {
  const fullPath = join(srcDir, entryRelativePath);
  let content = readFileSync(fullPath, 'utf8');

  // Strip type imports
  content = content.replace(/import\s+type\s*\{[^}]*\}\s*from\s*['"][^'"]+['"];?/g, '');

  let inlinedShared = '';
  if (content.includes("from '../shared/config'") || content.includes('from "../shared/config"')) {
    content = content.replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/config['"];?/g, '');
    inlinedShared += '\n' + configTs + '\n';
  }
  if (content.includes("from '../shared/rpc-client'") || content.includes('from "../shared/rpc-client"')) {
    content = content.replace(/import\s*\{[^}]*\}\s*from\s*['"]\.\.\/shared\/rpc-client['"];?/g, '');
    inlinedShared += '\n' + rpcClientTs + '\n';
  }

  const bundledTs = inlinedShared + '\n' + content;

  // Transpile to clean ES2022 JavaScript
  const transpileResult = ts.transpileModule(bundledTs, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      removeComments: false,
    },
  });

  return transpileResult.outputText;
}

const entries = [
  'background/index.ts',
  'content/index.ts',
  'popup/index.ts',
  'options/index.ts',
];

for (const entry of entries) {
  const jsOutput = bundleEntry(entry);
  const outPath = join(distDir, entry.replace(/\.ts$/, '.js'));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, jsOutput, 'utf8');
  console.log(`  ✓ Bundled ${entry} -> ${entry.replace(/\.ts$/, '.js')}`);
}

console.log('[gRabbit Extension Build] Build complete! Extension ready in packages/extension/dist/');

