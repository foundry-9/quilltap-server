/**
 * Generate lib/themes/assist/styled-by.generated.json — for each catalogued
 * hook, what the app's stylesheets set on it (Calliope Live, Spec J
 * decision 6). `scripts/check-theme-references.ts` fails `npm run lint` while
 * the committed file is stale.
 *
 * Run with `npm run generate:theme-styled-by`. Prints how many hooks the
 * table covers.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { HOOK_CATALOGUE } from '../lib/themes/hooks';
import { STYLED_BY_TABLE_PATH } from '../lib/themes/assist/styled-by-build';
import { expectedStyledByTable } from './lib/styled-by-sources';

const ROOT = path.resolve(__dirname, '..');
const { table, text } = expectedStyledByTable(ROOT);
writeFileSync(path.join(ROOT, STYLED_BY_TABLE_PATH), text);

const withToken = Object.values(table.hooks).filter((rows) => rows.some((r) => r.properties.some((p) => p.vars.length > 0))).length;
const covered = Object.keys(table.hooks).length;
const total = HOOK_CATALOGUE.hooks.length;
console.log(`generate-theme-styled-by: wrote ${STYLED_BY_TABLE_PATH}`);
console.log(`  ${total} hooks: ${covered} selected by an app rule, ${withToken} of them reading at least one token; ${total - withToken} with none.`);
