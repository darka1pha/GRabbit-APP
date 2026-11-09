import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

interface MessageInfo {
  id: string;
  variables: Set<string>;
}

function parseFtl(content: string): Map<string, MessageInfo> {
  const map = new Map<string, MessageInfo>();
  const lines = content.split(/\r?\n/);

  let currentId: string | null = null;
  let currentVariables = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const match = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.*)$/);
    if (match) {
      if (currentId) {
        map.set(currentId, { id: currentId, variables: currentVariables });
      }
      currentId = match[1];
      currentVariables = new Set<string>();

      const varMatches = match[2].matchAll(/\{\s*\$([a-zA-Z0-9_]+)\s*\}/g);
      for (const vm of varMatches) {
        currentVariables.add(vm[1]);
      }
    } else if (currentId && (line.startsWith('  ') || line.startsWith('\t'))) {
      const varMatches = line.matchAll(/\{\s*\$([a-zA-Z0-9_]+)\s*\}/g);
      for (const vm of varMatches) {
        currentVariables.add(vm[1]);
      }
    }
  }

  if (currentId) {
    map.set(currentId, { id: currentId, variables: currentVariables });
  }

  return map;
}

export function validateTranslations(localesDir: string, referenceLocale = 'en.ftl'): boolean {
  console.log(`🔍 Validating translations in: ${localesDir}`);

  const files = readdirSync(localesDir).filter((f) => f.endsWith('.ftl'));
  if (!files.includes(referenceLocale)) {
    console.error(`❌ Reference locale ${referenceLocale} not found!`);
    return false;
  }

  const refPath = join(localesDir, referenceLocale);
  const refContent = readFileSync(refPath, 'utf-8');
  const refMap = parseFtl(refContent);

  console.log(`ℹ️ Reference ${referenceLocale} contains ${refMap.size} keys.`);

  let hasErrors = false;

  for (const file of files) {
    if (file === referenceLocale) continue;

    console.log(`➡️ Checking ${file}...`);
    const filePath = join(localesDir, file);
    const content = readFileSync(filePath, 'utf-8');
    const targetMap = parseFtl(content);

    // Check missing keys
    for (const [key, refInfo] of refMap.entries()) {
      if (!targetMap.has(key)) {
        console.error(`  ❌ [${file}] Missing key: "${key}"`);
        hasErrors = true;
      } else {
        const targetInfo = targetMap.get(key)!;
        // Check missing variables
        for (const v of refInfo.variables) {
          if (!targetInfo.variables.has(v)) {
            console.error(`  ⚠️ [${file}] Key "${key}" missing variable: {$${v}}`);
            hasErrors = true;
          }
        }
      }
    }

    // Check extra keys
    for (const key of targetMap.keys()) {
      if (!refMap.has(key)) {
        console.warn(`  ⚠️ [${file}] Unknown/Extra key: "${key}"`);
      }
    }
  }

  if (hasErrors) {
    console.error('❌ Translation validation failed.');
    return false;
  }

  console.log('✅ All translations are valid and in sync!');
  return true;
}

const localesDirectory = resolve(process.cwd(), 'locales');
const success = validateTranslations(localesDirectory);
if (!success) {
  process.exit(1);
}
