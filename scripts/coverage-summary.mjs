// Prints a Markdown table of line/branch/function coverage for every workspace package that ran
// its tests with the json-summary reporter (coverage/coverage-summary.json). Used by CI for the
// job summary; run locally after `pnpm test:coverage`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rows = [];

for (const group of ['apps', 'packages']) {
  const dir = join(root, group);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    const file = join(dir, name, 'coverage', 'coverage-summary.json');
    if (!existsSync(file)) continue;
    const { total } = JSON.parse(readFileSync(file, 'utf8'));
    rows.push(`| ${group}/${name} | ${total.lines.pct}% | ${total.branches.pct}% | ${total.functions.pct}% |`);
  }
}

console.log('### Test coverage\n');
if (rows.length === 0) {
  console.log('No coverage reports found.');
} else {
  console.log('| Package | Lines | Branches | Functions |\n| --- | ---: | ---: | ---: |');
  console.log(rows.join('\n'));
}
