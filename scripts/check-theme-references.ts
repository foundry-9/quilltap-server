/**
 * Lint gate: the theme references generated from the engine and the token
 * registry must be current.
 *
 *  - public/schemas/qtap-theme.schema.json and qtap-theme-tokens.schema.json
 *    (lib/themes/schemas.ts, `npm run generate:theme-schemas`);
 *  - docs/developer/THEME_TOKENS.md (lib/themes/registry/doc.ts,
 *    `npm run generate:theme-tokens-doc`).
 *
 * Run standalone with `npx tsx scripts/check-theme-references.ts`.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GENERATED_THEME_SCHEMAS, THEME_SCHEMAS_REGENERATE_COMMAND } from '../lib/themes/schemas';
import { renderThemeTokensDoc, THEME_TOKENS_DOC_PATH, THEME_TOKENS_DOC_REGENERATE_COMMAND } from '../lib/themes/registry/doc';

const ROOT = path.resolve(__dirname, '..');

interface Generated {
  path: string;
  expected: string;
  command: string;
}

const files: Generated[] = [
  ...GENERATED_THEME_SCHEMAS.map((s) => ({ path: s.path, expected: s.render(), command: THEME_SCHEMAS_REGENERATE_COMMAND })),
  { path: THEME_TOKENS_DOC_PATH, expected: renderThemeTokensDoc(), command: THEME_TOKENS_DOC_REGENERATE_COMMAND },
];

let failed = false;
for (const file of files) {
  const full = path.join(ROOT, file.path);
  const committed = existsSync(full) ? readFileSync(full, 'utf8') : null;
  if (committed === file.expected) {
    console.log(`check-theme-references: ${file.path} is current.`);
    continue;
  }
  failed = true;
  if (committed === null) {
    console.error(`check-theme-references: ${file.path} is missing: run \`${file.command}\`.`);
    continue;
  }
  const a = committed.split('\n');
  const b = file.expected.split('\n');
  let line = 0;
  while (line < a.length && line < b.length && a[line] === b[line]) line++;
  console.error(`check-theme-references: ${file.path} is stale (first difference at line ${line + 1}): run \`${file.command}\`.`);
}
if (failed) process.exit(1);
