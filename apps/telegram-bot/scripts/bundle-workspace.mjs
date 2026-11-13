import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(BOT_DIR, '../..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const DIST_DIR = join(BOT_DIR, 'dist');
const WORKSPACE_OUT_DIR = join(DIST_DIR, '_workspace');
const TMP_TSCONFIG_PATH = join(BOT_DIR, '.tsconfig.workspace.tmp.json');

const requireFromBot = createRequire(join(BOT_DIR, 'package.json'));
const eslintRequire = createRequire(requireFromBot.resolve('eslint'));
const espree = eslintRequire('espree');

const WORKSPACE_PACKAGES = new Map([
  ['@grabbit/types', join(WORKSPACE_OUT_DIR, 'types', 'src', 'index.js')],
  ['@grabbit/utils', join(WORKSPACE_OUT_DIR, 'utils', 'src', 'index.js')],
  ['@grabbit/core', join(WORKSPACE_OUT_DIR, 'core', 'src', 'index.js')],
]);

function walkFiles(dir, extFilter) {
  const results = [];
  if (!existsSync(dir)) return results;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, extFilter));
    } else if (entry.isFile() && extFilter(full)) {
      results.push(full);
    }
  }
  return results;
}

function toPosixRelative(fromFile, toFile) {
  let rel = relative(dirname(fromFile), toFile).split(sep).join('/');
  if (!rel.startsWith('./') && !rel.startsWith('../')) {
    rel = `./${rel}`;
  }
  return rel;
}

function resolveWorkspaceTarget(specifier, outFile, sourceTsFile) {
  for (const [pkgName, entryJsPath] of WORKSPACE_PACKAGES.entries()) {
    if (specifier === pkgName) {
      return toPosixRelative(outFile, entryJsPath);
    }
    if (specifier.startsWith(`${pkgName}/`)) {
      const sub = specifier.slice(pkgName.length + 1).replace(/\.js$/, '');
      const pkgShort = pkgName.replace('@grabbit/', '');
      const subTarget = join(WORKSPACE_OUT_DIR, pkgShort, 'src', `${sub}.js`);
      return toPosixRelative(outFile, subTarget);
    }
  }

  if (sourceTsFile && (specifier.startsWith('./') || specifier.startsWith('../'))) {
    if (/\.(?:mjs|cjs|js|json|node)$/i.test(specifier)) {
      return specifier;
    }
    const sourceCandidate = resolve(dirname(sourceTsFile), specifier);
    if (existsSync(join(sourceCandidate, 'index.ts'))) {
      return `${specifier}/index.js`;
    }
    return `${specifier}.js`;
  }

  return specifier;
}

function collectSpecifierLiterals(node, targets) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectSpecifierLiterals(item, targets);
    return;
  }

  if (
    (node.type === 'ImportDeclaration' ||
      node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration' ||
      node.type === 'ImportExpression') &&
    node.source?.type === 'Literal' &&
    typeof node.source.value === 'string' &&
    Array.isArray(node.source.range)
  ) {
    targets.push(node.source);
  }

  for (const [key, val] of Object.entries(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    if (val && typeof val === 'object') {
      collectSpecifierLiterals(val, targets);
    }
  }
}

/**
 * Parses emitted JS with espree and rewrites module specifiers accurately via AST offsets.
 */
function rewriteModuleSpecifiers(code, transformSpec) {
  const ast = espree.parse(code, { ecmaVersion: 'latest', sourceType: 'module', range: true });
  const literals = [];
  collectSpecifierLiterals(ast, literals);
  if (literals.length === 0) return code;

  // Deduplicate and apply edits back-to-front so earlier offsets remain valid
  const uniqueByStart = new Map();
  for (const lit of literals) {
    uniqueByStart.set(lit.range[0], lit);
  }
  const sorted = [...uniqueByStart.values()].sort((a, b) => b.range[0] - a.range[0]);

  let result = code;
  for (const lit of sorted) {
    const [start, end] = lit.range;
    const rewritten = transformSpec(lit.value);
    if (rewritten !== lit.value) {
      const quote = code[start] === '"' ? '"' : "'";
      result = `${result.slice(0, start)}${quote}${rewritten}${quote}${result.slice(end)}`;
    }
  }
  return result;
}

function runTsc(tsconfigPath) {
  if (process.platform === 'win32') {
    const tscCmd = join(BOT_DIR, 'node_modules', '.bin', 'tsc.cmd');
    execFileSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', tscCmd, '-p', tsconfigPath], {
      cwd: BOT_DIR,
      stdio: 'inherit',
    });
    return;
  }
  const tscBin = join(BOT_DIR, 'node_modules', '.bin', 'tsc');
  execFileSync(tscBin, ['-p', tsconfigPath], {
    cwd: BOT_DIR,
    stdio: 'inherit',
  });
}

function compileWorkspacePackages() {
  rmSync(WORKSPACE_OUT_DIR, { recursive: true, force: true });

  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022', 'DOM'],
      strict: false,
      skipLibCheck: true,
      esModuleInterop: true,
      declaration: false,
      sourceMap: false,
      noEmit: false,
      rootDir: '../../packages',
      outDir: './dist/_workspace',
      paths: {
        '@grabbit/types': ['../../packages/types/src/index.ts'],
        '@grabbit/utils': ['../../packages/utils/src/index.ts'],
        '@grabbit/core': ['../../packages/core/src/index.ts'],
      },
    },
    include: [
      '../../packages/types/src/**/*.ts',
      '../../packages/utils/src/**/*.ts',
      '../../packages/core/src/**/*.ts',
    ],
    exclude: ['../../**/*.test.ts', '../../**/*.spec.ts', '../../**/*.d.ts'],
  };

  writeFileSync(TMP_TSCONFIG_PATH, JSON.stringify(tsconfig, null, 2), 'utf8');
  try {
    runTsc(TMP_TSCONFIG_PATH);
  } finally {
    rmSync(TMP_TSCONFIG_PATH, { force: true });
  }

  mkdirSync(WORKSPACE_OUT_DIR, { recursive: true });
  writeFileSync(join(WORKSPACE_OUT_DIR, 'package.json'), '{\n  "type": "module"\n}\n', 'utf8');

  for (const outJsFile of walkFiles(WORKSPACE_OUT_DIR, (p) => p.endsWith('.js'))) {
    const relFromWs = relative(WORKSPACE_OUT_DIR, outJsFile);
    const sourceTsFile = join(PACKAGES_DIR, relFromWs.replace(/\.js$/, '.ts'));
    const raw = readFileSync(outJsFile, 'utf8');
    const updated = rewriteModuleSpecifiers(raw, (spec) =>
      resolveWorkspaceTarget(spec, outJsFile, sourceTsFile)
    );
    if (updated !== raw) {
      writeFileSync(outJsFile, updated, 'utf8');
    }
  }
}

function rewriteDistWorkspaceImports() {
  for (const distJsFile of walkFiles(DIST_DIR, (p) => p.endsWith('.js'))) {
    if (distJsFile.startsWith(WORKSPACE_OUT_DIR)) continue;
    const raw = readFileSync(distJsFile, 'utf8');
    if (!raw.includes('@grabbit/')) continue;

    const updated = rewriteModuleSpecifiers(raw, (spec) =>
      resolveWorkspaceTarget(spec, distJsFile, null)
    );
    if (updated !== raw) {
      writeFileSync(distJsFile, updated, 'utf8');
    }
  }
}

compileWorkspacePackages();
rewriteDistWorkspaceImports();
