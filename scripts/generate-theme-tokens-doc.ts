#!/usr/bin/env tsx
/**
 * Regenerates docs/developer/THEME_TOKENS.md from the theme token registry
 * (lib/themes/registry/). `npm run lint` (scripts/check-theme-references.ts)
 * fails when the committed file is stale.
 */

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { renderThemeTokensDoc, THEME_TOKENS_DOC_PATH } from '../lib/themes/registry/doc';

writeFileSync(path.join(path.resolve(__dirname, '..'), THEME_TOKENS_DOC_PATH), renderThemeTokensDoc(), 'utf8');
console.log(`Wrote ${THEME_TOKENS_DOC_PATH}`);
