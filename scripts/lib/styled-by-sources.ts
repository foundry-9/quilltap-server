/**
 * The styled-by table as the app's stylesheets on disk say it should be —
 * shared by the generator (scripts/generate-theme-styled-by.ts) and the lint
 * gate (scripts/check-theme-references.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HOOK_CATALOGUE } from '../../lib/themes/hooks';
import { buildStyledByTable, renderStyledByTable, STYLED_BY_SOURCES } from '../../lib/themes/assist/styled-by-build';
import type { StyledByTable } from '../../lib/themes/assist/styled-by';

export function expectedStyledByTable(root: string): { table: StyledByTable; text: string } {
  const sources = STYLED_BY_SOURCES.map((p) => ({ path: p, css: readFileSync(path.join(root, p), 'utf8') }));
  const table = buildStyledByTable(sources, HOOK_CATALOGUE);
  return { table, text: renderStyledByTable(table) };
}
