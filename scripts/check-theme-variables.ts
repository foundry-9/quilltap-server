/**
 * Lint gate: app/styles/_theme-defaults.css and
 * app/styles/qt-components/_variables.css must be exactly what the theme token
 * registry (lib/themes/registry/) generates.
 *
 * The file is build output; the registry is where tokens are edited. This
 * renders the registry in memory and compares, so a hand edit to the CSS, or a
 * registry change that forgets to regenerate, fails lint.
 *
 * Run standalone with `npx tsx scripts/check-theme-variables.ts`; `npm run lint`
 * runs it alongside the other repo-wide guards.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { GENERATED_THEME_SHEETS, THEME_VARIABLES_REGENERATE_COMMAND, TOKEN_GROUPS } from '../lib/themes/registry';

const ROOT = path.resolve(__dirname, '..');

let failed = false;
for (const sheet of GENERATED_THEME_SHEETS) {
  let committed: string;
  try {
    committed = readFileSync(path.join(ROOT, sheet.path), 'utf8');
  } catch (error) {
    console.error(`check-theme-variables: cannot read ${sheet.path}: ${(error as Error).message}`);
    failed = true;
    continue;
  }
  const expected = sheet.render(TOKEN_GROUPS);
  if (committed === expected) {
    console.log(`check-theme-variables: ${sheet.path} is current.`);
    continue;
  }
  failed = true;
  const a = committed.split('\n');
  const b = expected.split('\n');
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line++;
  console.error(`check-theme-variables: ${sheet.path} differs from the registry (first difference at line ${line + 1}).`);
  console.error(`  committed: ${a[line] ?? '<end of file>'}`);
  console.error(`  expected:  ${b[line] ?? '<end of file>'}`);
}
if (failed) {
  console.error(`Edit lib/themes/registry/, not the CSS, then run \`${THEME_VARIABLES_REGENERATE_COMMAND}\`.`);
  process.exit(1);
}
