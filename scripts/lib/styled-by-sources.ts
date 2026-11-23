/**
 * The styled-by table as the app's stylesheets on disk say it should be —
 * shared by the generator (scripts/generate-theme-styled-by.ts) and the lint
 * gate (scripts/check-theme-references.ts). The qt-* component layer is
 * compiled in memory (scripts/lib/qt-components-css.mjs); the rest is read
 * as written.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HOOK_CATALOGUE } from '../../lib/themes/hooks';
import { buildStyledByTable, renderStyledByTable, STYLED_BY_SOURCES } from '../../lib/themes/assist/styled-by-build';
import type { StyledByTable } from '../../lib/themes/assist/styled-by';
import { compileQtComponentsCss } from './qt-components-css.mjs';

export async function expectedStyledByTable(root: string): Promise<{ table: StyledByTable; text: string }> {
  const sources = await Promise.all(
    STYLED_BY_SOURCES.map(async (s) => ({
      path: s.path,
      css: s.compiled ? await compileQtComponentsCss(root) : readFileSync(path.join(root, s.path), 'utf8'),
    })),
  );
  const table = buildStyledByTable(sources, HOOK_CATALOGUE);
  return { table, text: renderStyledByTable(table) };
}
