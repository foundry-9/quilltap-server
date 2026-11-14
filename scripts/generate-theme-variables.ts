/**
 * generate-theme-variables.ts
 *
 * Regenerates `app/styles/_theme-defaults.css` and
 * `app/styles/qt-components/_variables.css` from the theme token registry (`lib/themes/registry/`) — the single source of truth for every
 * --qt-* and --theme-* default. Run after adding, removing or changing a token:
 *
 *   npm run generate:theme-variables
 *
 * `npm run lint` runs scripts/check-theme-variables.ts, which fails while the
 * committed file differs from what this writes. After regenerating, run
 * `npm run generate:storybook-css` too (the storybook mirror includes it).
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { GENERATED_THEME_SHEETS, THEME_TOKENS, TOKEN_GROUPS } from '../lib/themes/registry';

const ROOT = path.resolve(__dirname, '..');
for (const sheet of GENERATED_THEME_SHEETS) {
  writeFileSync(path.join(ROOT, sheet.path), sheet.render(TOKEN_GROUPS), 'utf8');
  console.log(`Wrote ${sheet.path}`);
}
const dark = THEME_TOKENS.filter((t) => t.defaultDark !== undefined).length;
console.log(`${THEME_TOKENS.length} tokens (${dark} with a dark value) in ${TOKEN_GROUPS.length} groups`);
